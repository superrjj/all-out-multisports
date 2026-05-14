// @ts-nocheck
/** Invalidate PayMongo Checkout so an old browser tab cannot complete payment after we drop the DB row. */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export async function expirePaymongoCheckoutSessionById(checkoutSessionId: string): Promise<{ ok: boolean; status: number }> {
  const key = String(Deno.env.get('PAYMONGO_SECRET_KEY') ?? '').trim()
  const cs = String(checkoutSessionId ?? '').trim()
  if (!key || !cs) return { ok: true, status: 204 }

  const auth = btoa(`${key}:`)
  const res = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(cs)}/expire`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Basic ${auth}`,
      'content-type': 'application/json',
    },
    body: '{}',
  })
  // 200: expired. 400: often already paid/expired — idempotent cleanup.
  if (res.ok || res.status === 400) return { ok: true, status: res.status }
  return { ok: false, status: res.status }
}

/**
 * Expire every checkout session tied to this registration row or its bundle checkout.
 * Call while registration + payment_orders rows still exist (before cascade delete).
 */
export async function expirePaymongoSessionsForRegistrationRelatedOrders(
  supabase: SupabaseClient,
  registrationId: string,
): Promise<void> {
  const rid = String(registrationId ?? '').trim()
  if (!rid) return

  const { data: reg, error: regErr } = await supabase
    .from('registration_forms')
    .select('id, checkout_bundle_id')
    .eq('id', rid)
    .maybeSingle()
  if (regErr) {
    console.error('[expirePaymongoSessions] registration lookup:', regErr.message)
    return
  }
  if (!reg?.id) return

  const bundleId = String(reg.checkout_bundle_id ?? '').trim()
  let q = supabase.from('payment_orders').select('paymongo_checkout_session_id')
  if (bundleId) {
    q = q.or(`registration_id.eq.${rid},checkout_bundle_id.eq.${bundleId}`)
  } else {
    q = q.eq('registration_id', rid)
  }

  const { data: orders, error: oErr } = await q
  if (oErr) {
    console.error('[expirePaymongoSessions] payment_orders:', oErr.message)
    return
  }

  const seen = new Set<string>()
  for (const row of orders ?? []) {
    const sid = String(row?.paymongo_checkout_session_id ?? '').trim()
    if (!sid || seen.has(sid)) continue
    seen.add(sid)
    const r = await expirePaymongoCheckoutSessionById(sid)
    if (!r.ok) {
      console.error('[expirePaymongoSessions] PayMongo expire failed', sid, 'http', r.status)
    }
  }
}
