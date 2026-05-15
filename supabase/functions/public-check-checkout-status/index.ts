// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { retrievePaymongoCheckoutSession } from '../_shared/paymongo-checkout-session.ts'

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
  if (!authHeader) return jsonResponse({ code: 'UNAUTHORIZED', message: 'Missing authorization' }, 401)

  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  const { data: authData, error: authError } = await supabase.auth.getUser(jwt)
  if (authError || !authData?.user?.id) {
    return jsonResponse({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' }, 401)
  }
  const userId = authData.user.id

  let body: { registrationId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const registrationId = String(body?.registrationId ?? '').trim()
  if (!registrationId) return jsonResponse({ error: 'Missing registrationId' }, 400)

  const { data: reg, error: regErr } = await supabase
    .from('registration_forms')
    .select('id, status, user_id, checkout_bundle_id')
    .eq('id', registrationId)
    .maybeSingle()
  if (regErr) return jsonResponse({ error: regErr.message }, 500)

  if (!reg?.id) {
    return jsonResponse({
      action: 'restart',
      reason: 'not_found',
      message: 'This checkout link is no longer valid. Please start registration again.',
    }, 200)
  }

  const regStatus = String(reg.status ?? '').toLowerCase()
  if (regStatus === 'confirmed' || regStatus === 'paid') {
    return jsonResponse({ action: 'paid', registrationStatus: reg.status }, 200)
  }
  if (regStatus === 'cancelled') {
    return jsonResponse({
      action: 'restart',
      reason: 'cancelled',
      message: 'This registration was cancelled. Please start again.',
    }, 200)
  }

  if (String(reg.user_id ?? '') !== userId) {
    const bid = String(reg.checkout_bundle_id ?? '').trim()
    if (!bid) return jsonResponse({ code: 'FORBIDDEN', message: 'Not your registration' }, 403)
    const { data: bundlePay } = await supabase
      .from('payment_orders')
      .select('registration_id')
      .eq('checkout_bundle_id', bid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!bundlePay?.registration_id) return jsonResponse({ code: 'FORBIDDEN', message: 'Not your registration' }, 403)
    const { data: owner } = await supabase
      .from('registration_forms')
      .select('user_id')
      .eq('id', bundlePay.registration_id)
      .maybeSingle()
    if (String(owner?.user_id ?? '') !== userId) {
      return jsonResponse({ code: 'FORBIDDEN', message: 'Not your registration' }, 403)
    }
  }

  let { data: order } = await supabase
    .from('payment_orders')
    .select('id, status, paymongo_checkout_session_id')
    .eq('registration_id', registrationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!order?.id && reg.checkout_bundle_id) {
    const { data: bundleOrder } = await supabase
      .from('payment_orders')
      .select('id, status, paymongo_checkout_session_id')
      .eq('checkout_bundle_id', String(reg.checkout_bundle_id))
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    order = bundleOrder
  }

  const orderStatus = String(order?.status ?? '').toLowerCase()
  if (orderStatus === 'paid') {
    return jsonResponse({ action: 'paid', registrationStatus: reg.status }, 200)
  }

  const sessionId = String(order?.paymongo_checkout_session_id ?? '').trim()
  if (!sessionId) {
    return jsonResponse({
      action: 'continue',
      registrationStatus: reg.status,
      checkoutSessionStatus: null,
      message: null,
    }, 200)
  }

  const session = await retrievePaymongoCheckoutSession(sessionId)
  if (!session) {
    return jsonResponse({
      action: 'restart',
      reason: 'session_missing',
      message: 'Payment link is invalid. Please start registration again.',
    }, 200)
  }

  if (session.isPaid) {
    return jsonResponse({ action: 'paid', registrationStatus: reg.status, checkoutSessionStatus: session.status }, 200)
  }

  if (session.isExpired) {
    return jsonResponse({
      action: 'restart',
      reason: 'session_expired',
      checkoutSessionStatus: session.status,
      message: 'Your PayMongo payment link has expired. Please start registration again for a new link.',
    }, 200)
  }

  if (session.isActive && session.checkoutUrl) {
    return jsonResponse({
      action: 'continue',
      registrationStatus: reg.status,
      checkoutSessionStatus: session.status,
      checkoutUrl: session.checkoutUrl,
      checkoutSessionId: session.id,
    }, 200)
  }

  return jsonResponse({
    action: 'restart',
    reason: 'session_unusable',
    checkoutSessionStatus: session.status,
    message: 'Payment link is no longer available. Please start registration again.',
  }, 200)
})
