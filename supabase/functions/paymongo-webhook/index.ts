// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { assignBibIfMissing, finalizeBundleSiblingsPaid } from '../_shared/registration-finale.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const PAYMONGO_WEBHOOK_SECRET = Deno.env.get('PAYMONGO_WEBHOOK_SECRET')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

type PayMongoEvent = {
  data?: {
    id?: string
    attributes?: {
      type?: string
      data?: {
        id?: string
        attributes?: {
          status?: string
          metadata?: {
            merchant_reference?: string
          }
          amount?: number
          currency?: string
          paid_at?: number
          [key: string]: unknown
        }
      }
    }
  }
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

async function hmacSHA256(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function verifySignature(rawBody: string, signatureHeader: string | null) {
  if (!signatureHeader) return false
  const expected = await hmacSHA256(PAYMONGO_WEBHOOK_SECRET, rawBody)
  return timingSafeEqual(expected, signatureHeader)
}

function normalizeStatus(paymongoStatus: string | undefined) {
  switch (paymongoStatus) {
    case 'paid':
      return 'paid'
    case 'processing':
      return 'processing'
    case 'failed':
      return 'failed'
    case 'expired':
      return 'expired'
    default:
      return 'pending'
  }
}

function normalizeRegistrationStatus(paymentStatus: string) {
  switch (paymentStatus) {
    case 'paid':
      return 'confirmed'
    case 'failed':
      return 'cancelled'
    case 'expired':
      return 'expired'
    case 'processing':
    case 'pending':
    default:
      return 'payment_processing'
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const rawBody = await req.text()
  const signatureHeader = req.headers.get('paymongo-signature')

  let parsed: PayMongoEvent
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON payload', { status: 400 })
  }

  const signatureValid = await verifySignature(rawBody, signatureHeader)
  if (!signatureValid) {
    return new Response('Invalid webhook signature', { status: 401 })
  }

  const providerEventId = parsed?.data?.id
  const eventType = parsed?.data?.attributes?.type ?? 'unknown'
  const paymentData = parsed?.data?.attributes?.data
  const paymentAttrs = paymentData?.attributes
  const merchantReference = paymentAttrs?.metadata?.merchant_reference

  if (!providerEventId || !merchantReference) {
    return new Response('Missing providerEventId or merchantReference', { status: 400 })
  }

  // Idempotency guard: insert once, skip reprocessing duplicates
  const { error: webhookInsertError } = await supabase
    .from('payment_webhook_events')
    .insert({
      provider_event_id: providerEventId,
      event_type: eventType,
      signature_valid: true,
      raw_payload: JSON.parse(rawBody),
      processed: false,
    })

  if (webhookInsertError) {
    if (webhookInsertError.code === '23505') {
      return new Response('Webhook already processed', { status: 200 })
    }
    return new Response(`Failed to store webhook event: ${webhookInsertError.message}`, { status: 500 })
  }

  const { data: order, error: orderError } = await supabase
    .from('payment_orders')
    .select('id, registration_id')
    .eq('merchant_reference', merchantReference)
    .maybeSingle()

  if (orderError || !order) {
    await supabase
      .from('payment_webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('provider_event_id', providerEventId)
    return new Response('Payment order not found for merchant reference', { status: 404 })
  }

  const { data: regRow, error: regErr } = await supabase
    .from('registration_forms')
    .select('id')
    .eq('id', order.registration_id)
    .maybeSingle()
  if (regErr || !regRow?.id) {
    await supabase
      .from('payment_webhook_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('provider_event_id', providerEventId)
    // DB row was removed (e.g. stale purge) but PayMongo may still deliver a late event — do not attach money to a ghost id.
    return new Response('Registration not found for payment order', { status: 404 })
  }

  const normalizedStatus = normalizeStatus(paymentAttrs?.status)
  const paidAt = paymentAttrs?.paid_at ? new Date(Number(paymentAttrs.paid_at) * 1000).toISOString() : null
  const paymongoPaymentId = paymentData?.id ? String(paymentData.id).trim() : ''

  const { error: txError } = await supabase.from('payment_transactions').insert({
    payment_order_id: order.id,
    paymongo_payment_id: paymentData?.id ?? null,
    provider_reference: paymongoPaymentId || null,
    status: normalizedStatus,
    amount: (paymentAttrs?.amount ?? 0) / 100,
    currency: paymentAttrs?.currency ?? 'PHP',
    paid_at: paidAt,
    raw_payload: paymentAttrs ?? {},
  })

  if (txError) {
    return new Response(`Failed to record payment transaction: ${txError.message}`, { status: 500 })
  }

  const orderPatch: Record<string, unknown> = {
    status: normalizedStatus,
    updated_at: new Date().toISOString(),
  }
  if (normalizedStatus === 'paid') {
    orderPatch.paid_at = paidAt ?? new Date().toISOString()
  }
  // Admin "Reference No." reads payment_orders.provider_reference; PayMongo dashboard Payment ID is pay_…
  if (paymongoPaymentId) {
    orderPatch.provider_reference = paymongoPaymentId
  }

  const { error: orderUpdateError } = await supabase.from('payment_orders').update(orderPatch).eq('id', order.id)

  if (orderUpdateError) {
    return new Response(`Failed to update payment order: ${orderUpdateError.message}`, { status: 500 })
  }

  if (normalizedStatus === 'paid') {
    const paidNow = new Date().toISOString()
    const { error: paidFinalizeError } = await supabase
      .from('registration_forms')
      .update({
        status: 'confirmed',
        confirmed_at: paidNow,
        updated_at: paidNow,
      })
      .eq('id', order.registration_id)
    if (paidFinalizeError) {
      return new Response(`Failed to finalize paid registration: ${paidFinalizeError.message}`, { status: 500 })
    }
    try {
      await assignBibIfMissing(supabase, order.registration_id)
      await finalizeBundleSiblingsPaid(supabase, order.registration_id)
    } catch (e) {
      return new Response(`Payment processed but bib assignment failed: ${(e as Error).message}`, { status: 500 })
    }
  } else {
    const { error: registrationUpdateError } = await supabase
      .from('registration_forms')
      .update({
        status: normalizeRegistrationStatus(normalizedStatus),
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.registration_id)

    if (registrationUpdateError) {
      return new Response(`Failed to update registration status: ${registrationUpdateError.message}`, { status: 500 })
    }
  }

  const { error: webhookProcessedError } = await supabase
    .from('payment_webhook_events')
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq('provider_event_id', providerEventId)

  if (webhookProcessedError) {
    return new Response(`Processed but failed to mark webhook done: ${webhookProcessedError.message}`, { status: 500 })
  }

  return new Response('Webhook processed', { status: 200 })
})
