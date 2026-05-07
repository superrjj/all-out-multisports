// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { assignBibIfMissing, finalizeBundleSiblingsPaid } from '../_shared/registration-finale.ts'
import { resolveRaceCategoryIdForEvent } from '../_shared/race-category-resolve.ts'

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

  let body: { registrationId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }
  const registrationId = String(body.registrationId ?? '').trim()
  if (!registrationId) return jsonResponse({ error: 'Missing registrationId' }, 400)

  const now = new Date().toISOString()
  const { data: reg, error: regErr } = await supabase
    .from('registration_forms')
    .select('id, status, bib_number, checkout_bundle_id, registration_fee, event_id, race_category_id')
    .eq('id', registrationId)
    .maybeSingle()
  if (regErr) return jsonResponse({ error: regErr.message }, 500)
  if (!reg?.id) return jsonResponse({ error: 'Registration not found.' }, 404)

  // Tally / legacy imports often omitted race_category_id; bib logic requires it. Backfill from rider row.
  if (!reg.race_category_id && reg.event_id) {
    const { data: rider, error: riderErr } = await supabase
      .from('registration_rider_details')
      .select('age_category, discipline, gender')
      .eq('registration_id', registrationId)
      .maybeSingle()
    if (riderErr) return jsonResponse({ error: riderErr.message }, 500)
    const resolved = await resolveRaceCategoryIdForEvent(
      supabase,
      String(reg.event_id),
      String(rider?.age_category ?? '').trim(),
      String(rider?.discipline ?? '').trim(),
      String(rider?.gender ?? '').trim(),
    )
    if (resolved) {
      const { error: patchErr } = await supabase
        .from('registration_forms')
        .update({ race_category_id: resolved, updated_at: now })
        .eq('id', registrationId)
      if (patchErr) return jsonResponse({ error: patchErr.message }, 500)
      reg.race_category_id = resolved
    }
  }

  if (!reg.race_category_id) {
    return jsonResponse(
      {
        error:
          'Missing race category on this registration. Set race_category_id in the database, or ensure registration_rider_details.age_category matches an Admin → Events category name for this event.',
      },
      400,
    )
  }

  if (String(reg.status ?? '').toLowerCase() !== 'confirmed') {
    const { error: confirmErr } = await supabase
      .from('registration_forms')
      .update({ status: 'confirmed', confirmed_at: now, updated_at: now })
      .eq('id', registrationId)
    if (confirmErr) return jsonResponse({ error: confirmErr.message }, 500)
  }

  let { data: order, error: orderErr } = await supabase
    .from('payment_orders')
    .select('id, registration_id, checkout_bundle_id, status, merchant_reference, provider_reference')
    .eq('registration_id', registrationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (orderErr) return jsonResponse({ error: orderErr.message }, 500)

  if (!order?.id && reg.checkout_bundle_id) {
    const r2 = await supabase
      .from('payment_orders')
      .select('id, registration_id, checkout_bundle_id, status, merchant_reference, provider_reference')
      .eq('checkout_bundle_id', String(reg.checkout_bundle_id))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (r2.error) return jsonResponse({ error: r2.error.message }, 500)
    order = r2.data
  }

  if (!order?.id) {
    let amount = Number(reg?.registration_fee ?? 0)
    if (!(amount > 0) && reg?.event_id) {
      const { data: ev } = await supabase
        .from('events')
        .select('registration_fee')
        .eq('id', reg.event_id)
        .maybeSingle()
      amount = Number(ev?.registration_fee ?? 0)
    }
    if (!(amount > 0)) amount = 1
    const { data: created, error: createErr } = await supabase
      .from('payment_orders')
      .insert({
        registration_id: registrationId,
        provider: 'paymongo',
        amount,
        currency: 'PHP',
        status: 'paid',
        paid_at: now,
      })
      .select('id, provider_reference')
      .single()
    if (createErr) return jsonResponse({ error: createErr.message }, 500)
    order = { id: created.id, provider_reference: created.provider_reference }
  } else {
    const existingProvider = String(order.provider_reference ?? '').trim()
    if (!existingProvider) {
      const nextProvider = String(order.merchant_reference ?? '').trim()
      if (!nextProvider) {
        order.provider_reference = ''
      } else {
        const { error: refErr } = await supabase
          .from('payment_orders')
          .update({ provider_reference: nextProvider, updated_at: now, status: 'paid', paid_at: now })
          .eq('id', order.id)
        if (refErr) return jsonResponse({ error: refErr.message }, 500)
        order.provider_reference = nextProvider
      }
    }
  }

  try {
    await assignBibIfMissing(supabase, registrationId)
    await finalizeBundleSiblingsPaid(supabase, registrationId)
  } catch (e) {
    return jsonResponse({ error: (e as Error).message || 'Failed to generate bib number.' }, 500)
  }

  const { data: updated } = await supabase
    .from('registration_forms')
    .select('id, bib_number')
    .eq('id', registrationId)
    .maybeSingle()

  return jsonResponse(
    {
      ok: true,
      bib_number: String(updated?.bib_number ?? '').trim(),
      provider_reference: String(order?.provider_reference ?? '').trim(),
    },
    200,
  )
})
