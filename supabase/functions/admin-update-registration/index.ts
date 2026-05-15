// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { assignBibIfMissing } from '../_shared/registration-finale.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ code: 'UNAUTHORIZED_NO_AUTH_HEADER', message: 'Missing authorization header' }, 401)

  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  const { data: authData, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !authData?.user?.id) {
    return jsonResponse({ code: 'UNAUTHORIZED_INVALID_TOKEN', message: 'Invalid or expired token' }, 401)
  }
  const actorUserId = authData.user.id

  const { data: actor, error: actorErr } = await supabase.from('users').select('role').eq('id', actorUserId).maybeSingle()
  if (actorErr) return jsonResponse({ error: actorErr.message }, 500)
  if (String(actor?.role ?? '').toLowerCase() !== 'admin') {
    return jsonResponse({ code: 'FORBIDDEN', message: 'Admin access required.' }, 403)
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const registrationId = String(body?.registrationId ?? '').trim()
  if (!registrationId) return jsonResponse({ error: 'Missing registrationId' }, 400)

  const now = new Date().toISOString()

  const patch = body?.patch ?? {}
  const rider = body?.rider ?? {}
  const payment = body?.payment ?? {}

  const raceCategoryId = String(patch?.raceCategoryId ?? '').trim() || null
  let disciplineNext = String(patch?.discipline ?? '').trim()
  let categoryNext = String(patch?.ageCategoryLabel ?? '').trim()

  if (raceCategoryId) {
    const { data: cat, error: catErr } = await supabase
      .from('race_categories')
      .select('category_name, discipline')
      .eq('id', raceCategoryId)
      .maybeSingle()
    if (catErr) return jsonResponse({ error: catErr.message }, 500)
    if (cat) {
      disciplineNext = String(cat.discipline ?? disciplineNext ?? '').trim()
      categoryNext = String(cat.category_name ?? categoryNext ?? '').trim()
    }
  }

  const { data: existingReg, error: existingErr } = await supabase
    .from('registration_forms')
    .select('race_category_id, bib_number, status')
    .eq('id', registrationId)
    .maybeSingle()
  if (existingErr) return jsonResponse({ error: existingErr.message }, 500)

  const prevCat = String(existingReg?.race_category_id ?? '').trim()
  const nextCat = String(raceCategoryId ?? '').trim()
  const categoryChanged = prevCat !== nextCat
  const hadBib = Boolean(String(existingReg?.bib_number ?? '').trim())
  const isConfirmed = String(existingReg?.status ?? '').toLowerCase() === 'confirmed'
  /** Paid/confirmed rider switched race category: drop old bib so the next assignment uses the new class prefix. */
  const reassignBibAfterCategoryChange = categoryChanged && hadBib && isConfirmed && Boolean(nextCat)

  const registrationStatusRaw = String(patch?.registrationStatus ?? '').trim()
  const registrationFeeRaw = patch?.registrationFee
  const regPatch = {
    registrant_email: String(patch?.registrantEmail ?? '').trim() || null,
    entry_event_type_slug: String(patch?.entryEventTypeSlug ?? '').trim() || null,
    entry_event_type_label: String(patch?.entryEventTypeLabel ?? '').trim() || null,
    race_category_id: raceCategoryId,
    updated_at: now,
    ...(registrationStatusRaw ? { status: registrationStatusRaw } : {}),
    ...(registrationFeeRaw != null && Number.isFinite(Number(registrationFeeRaw))
      ? { registration_fee: Math.max(0, Number(registrationFeeRaw)) }
      : {}),
    ...(reassignBibAfterCategoryChange ? { bib_number: null } : {}),
  }

  const { data: regUpdated, error: regErr } = await supabase
    .from('registration_forms')
    .update(regPatch)
    .eq('id', registrationId)
    .select('id')

  if (regErr) return jsonResponse({ error: regErr.message }, 500)
  if (!regUpdated?.length) return jsonResponse({ error: 'Registration not updated.' }, 400)

  const { data: riderUpdated, error: riderErr } = await supabase
    .from('registration_rider_details')
    .upsert(
      {
        registration_id: registrationId,
        first_name: String(rider?.firstName ?? '').trim(),
        last_name: String(rider?.lastName ?? '').trim(),
        gender: String(rider?.gender ?? '').trim() || null,
        birth_date: String(rider?.birthDate ?? '').trim() || null,
        address: String(rider?.address ?? '').trim() || null,
        contact_number: String(rider?.contactNumber ?? '').trim() || null,
        emergency_contact_name: String(rider?.emergencyContactName ?? '').trim() || null,
        emergency_contact_number: String(rider?.emergencyContactNumber ?? '').trim() || null,
        team_name: String(rider?.teamName ?? '').trim() || null,
        discipline: disciplineNext || null,
        age_category: categoryNext || null,
        jersey_size: String(rider?.jerseySize ?? '').trim() || null,
      },
      { onConflict: 'registration_id' },
    )
    .select('registration_id')

  if (riderErr) return jsonResponse({ error: riderErr.message }, 500)
  if (!riderUpdated?.length) return jsonResponse({ error: 'Rider details not updated.' }, 400)

  const paymentOrderId = String(payment?.paymentOrderId ?? '').trim()
  if (paymentOrderId) {
    const { data: payUpdated, error: payErr } = await supabase
      .from('payment_orders')
      .update({
        provider_reference: String(payment?.providerReference ?? '').trim() || null,
        status: String(payment?.paymentOrderStatus ?? '').trim() || null,
        updated_at: now,
      })
      .eq('id', paymentOrderId)
      .select('id')
    if (payErr) return jsonResponse({ error: payErr.message }, 500)
    if (!payUpdated?.length) return jsonResponse({ error: 'Payment order not updated.' }, 400)
  }

  if (reassignBibAfterCategoryChange) {
    try {
      await assignBibIfMissing(supabase, registrationId)
    } catch (e) {
      const raw = (e as Error).message || 'Could not assign a new bib after category change.'
      return jsonResponse({ ok: false, error: raw }, 500)
    }
    const { data: bibRow } = await supabase
      .from('registration_forms')
      .select('bib_number')
      .eq('id', registrationId)
      .maybeSingle()
    return jsonResponse({
      ok: true,
      bib_reassigned: true,
      bib_number: String(bibRow?.bib_number ?? '').trim(),
    }, 200)
  }

  return jsonResponse({ ok: true }, 200)
})

