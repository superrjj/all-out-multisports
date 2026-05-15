// @ts-nocheck
/** PayMongo Checkout Session helpers — status is `active` | `expired` (see PayMongo docs). */

export type PaymongoCheckoutSessionSnapshot = {
  id: string
  status: string
  checkoutUrl: string | null
  isPaid: boolean
  isActive: boolean
  isExpired: boolean
}

function paymongoAuthHeader(): string | null {
  const key = String(Deno.env.get('PAYMONGO_SECRET_KEY') ?? '').trim()
  if (!key) return null
  return `Basic ${btoa(`${key}:`)}`
}

function sessionIsPaid(attrs: Record<string, unknown> | null | undefined): boolean {
  const payments = attrs?.payments
  if (!Array.isArray(payments)) return false
  for (const p of payments) {
    const st = String(p?.attributes?.status ?? '').toLowerCase()
    if (st === 'paid' || st === 'succeeded' || st === 'success') return true
    const id = String(p?.id ?? '').trim()
    if (id.startsWith('pay_') && st !== 'failed') return true
  }
  return false
}

export async function retrievePaymongoCheckoutSession(
  checkoutSessionId: string,
): Promise<PaymongoCheckoutSessionSnapshot | null> {
  const auth = paymongoAuthHeader()
  const cs = String(checkoutSessionId ?? '').trim()
  if (!auth || !cs) return null

  const res = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(cs)}`, {
    headers: { accept: 'application/json', authorization: auth },
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) return null

  const data = json?.data
  const attrs = data?.attributes ?? {}
  const status = String(attrs?.status ?? '').toLowerCase()
  const isPaid = sessionIsPaid(attrs)
  const isExpired = status === 'expired'
  const isActive = status === 'active' && !isPaid

  return {
    id: String(data?.id ?? cs),
    status: status || 'unknown',
    checkoutUrl: attrs?.checkout_url ? String(attrs.checkout_url) : null,
    isPaid,
    isActive,
    isExpired,
  }
}
