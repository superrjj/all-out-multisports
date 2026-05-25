import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function textResponse(message: string, status: number) {
  return new Response(message, { status, headers: corsHeaders })
}

type Body = {
  raceType?: string
  eventId?: string
  raceCategoryId?: string
  registrantEmail: string
  registrationFee?: number
  checkoutBundleId?: string | null
  entryEventTypeSlug?: string | null
  entryEventTypeLabel?: string | null
  rider: {
    firstName: string
    lastName: string
    gender: string
    birthDate: string
    birthYear?: number | null
    address: string
    contactNumber: string
    emergencyContactName: string
    emergencyContactNumber: string
    teamName?: string
    discipline?: string
    ageCategory?: string
    jerseySize?: string
  }
}

function createAttemptId() {
  return `REGATT-${Date.now()}-${crypto.randomUUID()}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return textResponse('Method not allowed', 405)

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader) return textResponse(JSON.stringify({ code: 'UNAUTHORIZED_NO_AUTH_HEADER', message: 'Missing authorization header' }), 401)
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  const { data: authData, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !authData?.user?.id) {
    return textResponse(JSON.stringify({ code: 'UNAUTHORIZED_INVALID_TOKEN', message: 'Invalid or expired token' }), 401)
  }
  const userId = authData.user.id

  let body: Body
  try {
    body = await req.json()
  } catch {
    return textResponse('Invalid JSON', 400)
  }

  const normalizedEmail = String(body.registrantEmail ?? '').trim().toLowerCase()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
    return textResponse('Invalid registrantEmail', 400)
  }

  if (!body.rider?.firstName || !body.rider?.lastName || !body.rider?.birthDate) {
    return textResponse('Missing required fields', 400)
  }

  const requestedFee = Number(body.registrationFee)
  const effectiveFee = Number.isFinite(requestedFee) && requestedFee > 0 ? requestedFee : null

  let eventQuery = supabase
    .from('events')
    .select('id, registration_fee, race_type, registration_deadline, registration_closes_at')
    .eq('status', 'published')
  if (body.eventId) {
    eventQuery = eventQuery.eq('id', body.eventId)
  } else {
    eventQuery = eventQuery
      .eq('race_type', body.raceType)
      .order('event_date', { ascending: false })
      .limit(1)
  }
  const { data: event, error: eventError } = await eventQuery.maybeSingle()

  if (eventError) return textResponse(eventError.message, 500)

  if (!event?.id) return textResponse(`No published event found for ${body.raceType}`, 400)

  const closesAt = String(event.registration_deadline ?? event.registration_closes_at ?? '').trim()
  if (closesAt) {
    const endMs = new Date(closesAt).getTime()
    if (!Number.isNaN(endMs) && Date.now() > endMs) {
      return textResponse(
        JSON.stringify({ code: 'REGISTRATION_CLOSED', message: 'Registration for this event has closed.' }),
        403,
      )
    }
  }

  let resolvedRaceCategoryId: string | null = null
  if (body.raceCategoryId) {
    const { data: raceCategory, error: raceCategoryError } = await supabase
      .from('race_categories')
      .select('id')
      .eq('id', body.raceCategoryId)
      .eq('event_id', event.id)
      .eq('active', true)
      .maybeSingle()
    if (raceCategoryError) return textResponse(raceCategoryError.message, 500)
    if (!raceCategory?.id) return textResponse('Selected category is invalid for this event.', 400)
    resolvedRaceCategoryId = raceCategory.id
  }

  const slugTrim =
    typeof body.entryEventTypeSlug === 'string' ? String(body.entryEventTypeSlug).trim() || null : body.entryEventTypeSlug ?? null
  const bundleStr = typeof body.checkoutBundleId === 'string' ? String(body.checkoutBundleId).trim() || null : null

  const registrationAttemptId = createAttemptId()
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()

  const labelTrim =
    typeof body.entryEventTypeLabel === 'string' ? String(body.entryEventTypeLabel).trim().slice(0, 320) || null : null

  const { data: form, error: formError } = await supabase
    .from('registration_forms')
    .insert({
      user_id: userId,
      event_id: event.id,
      race_category_id: resolvedRaceCategoryId,
      status: 'pending_payment',
      registration_fee: effectiveFee ?? Number(event.registration_fee ?? 0),
      registrant_email: normalizedEmail,
      submitted_at: new Date().toISOString(),
      expires_at: expiresAt,
      checkout_bundle_id: bundleStr,
      entry_event_type_slug: slugTrim,
      entry_event_type_label: labelTrim,
    })
    .select('id')
    .single()

  if (formError) {
    if (String(formError.code ?? '') === '23505') {
      const duplicateDetails = String((formError as { details?: string } | null)?.details ?? '')
      if (/registration_forms_(user|email)_event_unique|ux_registration_forms_(user|email)_event/i.test(duplicateDetails)) {
        return textResponse(
          JSON.stringify({
            code: 'REGISTRATION_UNIQUE_CONSTRAINT_BLOCK',
            message: 'Database unique constraint is still blocking multiple riders for the same event. Apply allow-multiple-riders SQL first.',
          }),
          409,
        )
      }
    }
    return textResponse(formError.message, 500)
  }

  const { error: detailsError } = await supabase.from('registration_rider_details').insert({
    registration_id: form.id,
    first_name: body.rider.firstName,
    last_name: body.rider.lastName,
    gender: body.rider.gender,
    birth_date: body.rider.birthDate,
    birth_year: body.rider.birthYear ?? null,
    address: body.rider.address,
    contact_number: body.rider.contactNumber,
    emergency_contact_name: body.rider.emergencyContactName,
    emergency_contact_number: body.rider.emergencyContactNumber,
    team_name: body.rider.teamName ?? null,
    discipline: body.rider.discipline ?? null,
    age_category: body.rider.ageCategory ?? null,
    jersey_size: body.rider.jerseySize ?? null,
  })

  if (detailsError) return textResponse(detailsError.message, 500)

  const { error: agreementError } = await supabase.from('registration_agreements').insert({
    registration_id: form.id,
    liability_waiver_accepted: false,
    race_rules_accepted: false,
  })
  if (agreementError) return textResponse(agreementError.message, 500)

  return Response.json({ registrationId: form.id, registrationAttemptId }, { headers: corsHeaders })
})

