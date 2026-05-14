// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { expirePaymongoSessionsForRegistrationRelatedOrders } from '../_shared/paymongo-checkout-expire.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const STALE_MS = 10 * 60 * 1000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

async function assertAdmin(jwt: string): Promise<{ ok: true; userId: string } | { ok: false; status: number; body: Record<string, unknown> }> {
  const { data: authData, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !authData?.user?.id) {
    return { ok: false, status: 401, body: { code: 'UNAUTHORIZED_INVALID_TOKEN', message: 'Invalid or expired token' } }
  }
  const actorUserId = authData.user.id
  const { data: actor, error: actorErr } = await supabase.from('users').select('role').eq('id', actorUserId).maybeSingle()
  if (actorErr) return { ok: false, status: 500, body: { error: actorErr.message } }
  if (String(actor?.role ?? '').toLowerCase() !== 'admin') {
    return { ok: false, status: 403, body: { code: 'FORBIDDEN', message: 'Admin access required.' } }
  }
  return { ok: true, userId: actorUserId }
}

function normalizePaymentStatus(args: { orderStatus?: string | null; txStatus?: string | null; registrationStatus?: string | null }): string {
  const order = String(args.orderStatus ?? '').toLowerCase()
  const tx = String(args.txStatus ?? '').toLowerCase()
  const reg = String(args.registrationStatus ?? '').toLowerCase()
  const s = tx || order
  if (['paid', 'succeeded', 'success', 'completed', 'complete', 'confirmed'].includes(s)) return 'paid'
  if (reg === 'confirmed') return 'paid'
  if (['pending', 'processing', 'created'].includes(s)) return 'pending'
  if (['failed', 'cancelled', 'canceled', 'expired'].includes(s)) return 'failed'
  if (['refunded'].includes(s)) return 'refunded'
  return 'unknown'
}

async function registrationPaymentSnapshot(registrationId: string): Promise<{
  reg: { id: string; created_at: string | null; status: string | null; bib_number: string | null } | null
  payment_status: string
}> {
  const { data: reg, error: regErr } = await supabase
    .from('registration_forms')
    .select('id, created_at, status, bib_number')
    .eq('id', registrationId)
    .maybeSingle()
  if (regErr) throw new Error(regErr.message)
  if (!reg?.id) return { reg: null, payment_status: 'unknown' }

  const { data: orders, error: ordersError } = await supabase
    .from('payment_orders')
    .select('id, status, created_at')
    .eq('registration_id', registrationId)
    .order('created_at', { ascending: false })
  if (ordersError) throw new Error(ordersError.message)
  const order = orders?.[0]

  let txStatus: string | null = null
  if (order?.id) {
    const { data: txs, error: txsError } = await supabase
      .from('payment_transactions')
      .select('status, created_at')
      .eq('payment_order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(1)
    if (txsError) throw new Error(txsError.message)
    txStatus = txs?.[0]?.status ?? null
  }

  const payment_status = normalizePaymentStatus({
    orderStatus: order?.status ?? null,
    txStatus,
    registrationStatus: reg.status ?? null,
  })
  return { reg, payment_status }
}

function isDeletableUnpaidDraft(payment_status: string, regStatus: string): boolean {
  const ps = String(payment_status ?? '').toLowerCase()
  if (ps === 'paid') return false
  if (ps === 'pending') return true
  const st = String(regStatus ?? '').toLowerCase()
  if (['pending_payment', 'payment_processing'].includes(st) && ps === 'unknown') return true
  return false
}

async function deleteRegistrationCascade(registrationId: string): Promise<void> {
  await expirePaymongoSessionsForRegistrationRelatedOrders(supabase, registrationId)

  const { data: orders, error: oErr } = await supabase.from('payment_orders').select('id').eq('registration_id', registrationId)
  if (oErr) throw new Error(oErr.message)
  const orderIds = (orders ?? []).map((o) => o.id).filter(Boolean)
  if (orderIds.length > 0) {
    const { error: txDelErr } = await supabase.from('payment_transactions').delete().in('payment_order_id', orderIds)
    if (txDelErr) throw new Error(txDelErr.message)
  }
  const { error: poErr } = await supabase.from('payment_orders').delete().eq('registration_id', registrationId)
  if (poErr) throw new Error(poErr.message)
  const { error: agErr } = await supabase.from('registration_agreements').delete().eq('registration_id', registrationId)
  if (agErr) throw new Error(agErr.message)
  const { error: rdErr } = await supabase.from('registration_rider_details').delete().eq('registration_id', registrationId)
  if (rdErr) throw new Error(rdErr.message)
  const { error: rfErr } = await supabase.from('registration_forms').delete().eq('id', registrationId)
  if (rfErr) throw new Error(rfErr.message)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ code: 'UNAUTHORIZED_NO_AUTH_HEADER', message: 'Missing authorization header' }, 401)

  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  const authResult = await assertAdmin(jwt)
  if (!authResult.ok) return jsonResponse(authResult.body, authResult.status)

  let body: { registrationId?: string; purgeStaleOnly?: boolean }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const now = Date.now()
  const cutoff = new Date(now - STALE_MS).toISOString()

  /** Purge abandoned checkout rows older than 10 minutes (registration still in draft payment states). */
  if (body.purgeStaleOnly === true) {
    const { data: candidates, error: cErr } = await supabase
      .from('registration_forms')
      .select('id, created_at, status')
      .lt('created_at', cutoff)
      .in('status', ['pending_payment', 'payment_processing'])
    if (cErr) return jsonResponse({ error: cErr.message }, 500)

    let deleted = 0
    const errors: string[] = []
    for (const row of candidates ?? []) {
      try {
        const snap = await registrationPaymentSnapshot(String(row.id))
        if (!snap.reg) continue
        if (!isDeletableUnpaidDraft(snap.payment_status, String(snap.reg.status ?? ''))) continue
        if (String(snap.payment_status).toLowerCase() === 'paid') continue
        await deleteRegistrationCascade(String(row.id))
        deleted += 1
      } catch (e) {
        errors.push(`${row.id}: ${(e as Error).message}`)
      }
    }
    return jsonResponse({ ok: true, purged_count: deleted, errors: errors.length ? errors : undefined }, 200)
  }

  const registrationId = String(body.registrationId ?? '').trim()
  if (!registrationId) return jsonResponse({ error: 'Missing registrationId' }, 400)

  const snap = await registrationPaymentSnapshot(registrationId)
  if (!snap.reg) return jsonResponse({ error: 'Registration not found.' }, 404)

  const createdMs = snap.reg.created_at ? new Date(snap.reg.created_at).getTime() : 0
  const ageMs = now - createdMs

  if (!isDeletableUnpaidDraft(snap.payment_status, String(snap.reg.status ?? ''))) {
    return jsonResponse({ error: 'Only unpaid / pending checkout registrations can be deleted.' }, 400)
  }

  if (String(snap.payment_status).toLowerCase() === 'paid') {
    return jsonResponse({ error: 'Paid registrations cannot be deleted here.' }, 400)
  }

  if (ageMs > STALE_MS) {
    return jsonResponse(
      {
        error:
          'This pending entry is older than 10 minutes. It will be removed automatically on the next admin refresh, or run purge again.',
      },
      400,
    )
  }

  if (String(snap.reg.bib_number ?? '').trim()) {
    return jsonResponse({ error: 'Cannot delete a registration that already has a bib number.' }, 400)
  }

  try {
    await deleteRegistrationCascade(registrationId)
    return jsonResponse({ ok: true }, 200)
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Delete failed.' }, 500)
  }
})
