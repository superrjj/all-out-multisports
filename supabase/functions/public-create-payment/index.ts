// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PAYMONGO_SECRET_KEY = Deno.env.get('PAYMONGO_SECRET_KEY')!

/** Same window as admin stale purge: unpaid checkout must restart after this. */
const PAYABLE_REGISTRATION_MAX_AGE_MS = 2 * 60 * 60 * 1000

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function textResponse(message: string, status: number) {
  return new Response(message, { status, headers: corsHeaders })
}

type Body = {
  registrationId: string
  amount?: number
  acceptLiability: boolean
  acceptRules: boolean
}

async function createPayMongoCheckoutSession(args: {
  amount: number
  registrationId: string
  merchantReference: string
  email?: string | null
  origin?: string | null
}) {
  const appOrigin = args.origin?.startsWith('http') ? args.origin : 'http://localhost:5173'
  const auth = btoa(`${PAYMONGO_SECRET_KEY}:`)
  const payload = {
    data: {
      attributes: {
        billing: args.email ? { email: args.email } : undefined,
        send_email_receipt: Boolean(args.email),
        show_line_items: true,
        line_items: [
          {
            currency: 'PHP',
            amount: Math.round(Number(args.amount ?? 0) * 100),
            name: 'Hari ng Ahon Registration',
            description: `Registration payment for ${args.registrationId}`,
            quantity: 1,
          },
        ],
        payment_method_types: ['gcash', 'paymaya', 'card'],
        // Land on success page immediately after PayMongo "back to merchant" (avoid staging on /register/payment).
        success_url: `${appOrigin}/register/payment-success?registrationId=${encodeURIComponent(args.registrationId)}`,
        cancel_url: `${appOrigin}/register/payment?registrationId=${encodeURIComponent(args.registrationId)}&payment=cancelled`,
        metadata: {
          registration_id: args.registrationId,
          merchant_reference: args.merchantReference,
        },
      },
    },
  }

  const response = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Basic ${auth}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const json = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = json?.errors?.[0]?.detail ?? 'PayMongo checkout session creation failed'
    throw new Error(String(detail))
  }

  return {
    checkoutUrl: json?.data?.attributes?.checkout_url as string,
    checkoutSessionId: json?.data?.id as string,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return textResponse('Method not allowed', 405)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return textResponse('Invalid JSON', 400)
  }

  if (!body.registrationId) {
    return textResponse('Missing registrationId', 400)
  }

  if (!body.acceptLiability || !body.acceptRules) {
    return textResponse('Agreements not accepted', 400)
  }

  const { data: registration, error: registrationError } = await supabase
    .from('registration_forms')
    .select('id, registration_fee, status, checkout_bundle_id, user_id, created_at')
    .eq('id', body.registrationId)
    .maybeSingle()

  if (registrationError) return textResponse(registrationError.message, 500)
  if (!registration) return textResponse('Registration not found', 404)
  if (!['pending_payment', 'payment_processing'].includes(registration.status)) {
    return textResponse('Registration is not payable in current status', 400)
  }

  const createdMs = registration.created_at ? new Date(String(registration.created_at)).getTime() : 0
  if (createdMs > 0 && Date.now() - createdMs > PAYABLE_REGISTRATION_MAX_AGE_MS) {
    return textResponse(
      'This registration checkout has expired. Please go back and submit a new registration to get a fresh payment link.',
      400,
    )
  }

  const clientAmount = Number(body.amount ?? 0)
  const fallbackFee = Number(registration.registration_fee ?? 0)
  const resolvedAmount =
    Number.isFinite(clientAmount) && clientAmount > 0 ? clientAmount : fallbackFee > 0 ? fallbackFee : 0

  async function bundleTotalIfNeeded(): Promise<number> {
    if (!registration.checkout_bundle_id) return resolvedAmount
    const { data: rows, error: sumErr } = await supabase
      .from('registration_forms')
      .select('registration_fee')
      .eq('checkout_bundle_id', registration.checkout_bundle_id)
    if (sumErr || !rows?.length) return resolvedAmount
    const sum = rows.reduce((s, r) => s + Number(r.registration_fee ?? 0), 0)
    return sum > 0 ? sum : resolvedAmount
  }

  let chargeAmount = resolvedAmount > 0 ? resolvedAmount : await bundleTotalIfNeeded()
  if (!(chargeAmount > 0)) chargeAmount = fallbackFee > 0 ? fallbackFee : 1

  const { error: agreementError } = await supabase
    .from('registration_agreements')
    .update({
      liability_waiver_accepted: true,
      race_rules_accepted: true,
      accepted_at: new Date().toISOString(),
    })
    .eq('registration_id', body.registrationId)

  if (agreementError) return textResponse(agreementError.message, 500)

  const { data: form, error: formError } = await supabase
    .from('registration_forms')
    .select('registrant_email')
    .eq('id', body.registrationId)
    .maybeSingle()
  if (formError) return textResponse(formError.message, 500)

  // Reuse an in-flight order if one already exists for this registration.
  const { data: existingOrder, error: existingOrderError } = await supabase
    .from('payment_orders')
    .select('id, merchant_reference, status, amount')
    .eq('registration_id', body.registrationId)
    .in('status', ['created', 'pending', 'processing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingOrderError) return textResponse(existingOrderError.message, 500)
  if (existingOrder?.id) {
    try {
      const reuseAmt = Number(existingOrder.amount ?? 0) || chargeAmount
      const checkout = await createPayMongoCheckoutSession({
        amount: reuseAmt,
        registrationId: body.registrationId,
        merchantReference: existingOrder.merchant_reference,
        email: form?.registrant_email ?? null,
        origin: req.headers.get('origin'),
      })
      const { error: csErr } = await supabase
        .from('payment_orders')
        .update({
          paymongo_checkout_session_id: checkout.checkoutSessionId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingOrder.id)
      if (csErr) return textResponse(csErr.message, 500)

      return Response.json(
        {
          paymentOrderId: existingOrder.id,
          merchantReference: existingOrder.merchant_reference,
          checkoutUrl: checkout.checkoutUrl,
          checkoutSessionId: checkout.checkoutSessionId,
          reused: true,
        },
        { headers: corsHeaders }
      )
    } catch (e) {
      return textResponse((e as Error).message, 500)
    }
  }

  const merchantReference = `HNA-${Date.now()}-${crypto.randomUUID()}`

  const bundleIdInsert = registration.checkout_bundle_id ? String(registration.checkout_bundle_id) : null

  const { data: order, error: orderError } = await supabase
    .from('payment_orders')
    .insert({
      registration_id: body.registrationId,
      checkout_bundle_id: bundleIdInsert,
      provider: 'paymongo',
      amount: chargeAmount,
      currency: 'PHP',
      status: 'created',
      merchant_reference: merchantReference,
      created_by: null,
    })
    .select('id, merchant_reference')
    .single()

  if (orderError) return textResponse(orderError.message, 500)

  let checkout
  try {
    checkout = await createPayMongoCheckoutSession({
      amount: chargeAmount,
      registrationId: body.registrationId,
      merchantReference,
      email: form?.registrant_email ?? null,
      origin: req.headers.get('origin'),
    })
  } catch (e) {
    return textResponse((e as Error).message, 500)
  }

  const stamp = new Date().toISOString()
  let statusUpdateError
  if (registration.checkout_bundle_id) {
    const r = await supabase
      .from('registration_forms')
      .update({ status: 'payment_processing', updated_at: stamp })
      .eq('checkout_bundle_id', registration.checkout_bundle_id)
      .in('status', ['pending_payment', 'payment_processing'])
    statusUpdateError = r.error
  } else {
    const r = await supabase
      .from('registration_forms')
      .update({ status: 'payment_processing', updated_at: stamp })
      .eq('id', body.registrationId)
      .in('status', ['pending_payment', 'payment_processing'])
    statusUpdateError = r.error
  }

  if (statusUpdateError) return textResponse(statusUpdateError.message, 500)

  const { error: csErr } = await supabase
    .from('payment_orders')
    .update({
      paymongo_checkout_session_id: checkout.checkoutSessionId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
  if (csErr) return textResponse(csErr.message, 500)

  return Response.json(
    {
      paymentOrderId: order.id,
      merchantReference: order.merchant_reference,
      checkoutUrl: checkout.checkoutUrl,
      checkoutSessionId: checkout.checkoutSessionId,
      reused: false,
    },
    { headers: corsHeaders }
  )
})

