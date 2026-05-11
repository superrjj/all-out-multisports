// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

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

  const { data: regUpdated, error: regErr } = await supabase
    .from('registration_forms')
    .update({
      registrant_email: String(patch?.registrantEmail ?? '').trim() || null,
      entry_event_type_slug: String(patch?.entryEventTypeSlug ?? '').trim() || null,
      entry_event_type_label: String(patch?.entryEventTypeLabel ?? '').trim() || null,
      race_category_id: raceCategoryId,
      updated_at: now,
    })
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

  return jsonResponse({ ok: true }, 200)
})

