import { supabase } from '../lib/supabase'

export type RegistrationEventKey = string
export type PendingPaymentDraft = {
  paymentOrderId: string
  registrationId: string
  amount: number
  currency: string
  status: string
  merchantReference: string
  createdAt: string | null
  eventTitle: string
  raceType: string
}
export type CheckoutItem = {
  registrationId: string
  eventTitle: string
  raceType: string
  amount: number
  currency: string
  /** Number of registrations in the same checkout bundle (one per event type line). */
  lineItemCount?: number
}

export type CheckoutPaymentStatus = {
  action: 'continue' | 'paid' | 'restart'
  reason?: string
  message?: string | null
  checkoutUrl?: string | null
  checkoutSessionId?: string | null
  registrationStatus?: string | null
  checkoutSessionStatus?: string | null
}

export type RegistrationCheckoutEntry = {
  slug: string
  label: string
}

/** One payable registration line (event type × race category). */
export type RegistrationCheckoutLine = {
  slug: string
  label: string
  raceCategoryId: string
  /** Race category display name for rider details on this registration row. */
  categoryName?: string
}

/** Serialized on the payment step immediately before PayMongo (DB row created on Proceed). */
export type RegistrationCheckoutPayload = {
  raceType: RegistrationEventKey
  eventId?: string
  raceCategoryId?: string
  registrantEmail: string
  /** Per selected event-entry line item (fee x count = total payable). */
  registrationFeePerEntry: number
  /** Sum of registrationFeePerEntry x entries — total PayMongo charge. */
  registrationFeeTotal: number
  /** Stable id linking rows that share one PayMongo checkout. */
  checkoutBundleId: string
  /** One DB registration per selected event type. */
  eventEntries: RegistrationCheckoutEntry[]
  /** Canonical lines: one DB registration per event-type + category pair (preferred over eventEntries alone). */
  checkoutLines?: RegistrationCheckoutLine[]
  /** For payment UI before a DB row exists */
  eventTitle?: string
  raceTypeLabel?: string
  rider: {
    firstName: string
    lastName: string
    gender: string
    birthDate: string
    address: string
    contactNumber: string
    emergencyContactName: string
    emergencyContactNumber: string
    teamName?: string
    discipline?: string
    ageCategory?: string
    jerseySize?: string
    birthYear?: number | null
  }
}

export const REGISTRATION_CHECKOUT_STORAGE_KEY = 'hna_registration_checkout_v1'

function dedupeCheckoutLines(lines: RegistrationCheckoutLine[]): RegistrationCheckoutLine[] {
  const seen = new Set<string>()
  const out: RegistrationCheckoutLine[] = []
  for (const l of lines) {
    const slug = String(l.slug ?? '').trim()
    const raceCategoryId = String(l.raceCategoryId ?? '').trim()
    if (!raceCategoryId) continue
    const k = `${slug}|${raceCategoryId}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({
      slug,
      label: String(l.label ?? '').trim() || slug || 'Event',
      raceCategoryId,
      categoryName: typeof l.categoryName === 'string' ? l.categoryName.trim() || undefined : undefined,
    })
  }
  return out
}

/** Resolves stored checkout into one row per registration to create (event type × category). */
export function resolveCheckoutLines(payload: RegistrationCheckoutPayload | null): RegistrationCheckoutLine[] {
  if (!payload) return []
  const rawLines = payload.checkoutLines
  if (Array.isArray(rawLines) && rawLines.length > 0) {
    return dedupeCheckoutLines(rawLines as RegistrationCheckoutLine[])
  }
  const cat = String(payload.raceCategoryId ?? '').trim()
  const entries =
    Array.isArray(payload.eventEntries) && payload.eventEntries.length > 0
      ? payload.eventEntries
      : [{ slug: '', label: String(payload.raceType ?? '').trim() || 'Event' }]
  if (!cat) return []
  return dedupeCheckoutLines(
    entries.map((e) => ({
      slug: String(e.slug ?? '').trim(),
      label: String(e.label ?? '').trim() || String(payload.raceType ?? 'Event'),
      raceCategoryId: cat,
      categoryName: undefined,
    })),
  )
}

export function loadRegistrationCheckoutPayload(): RegistrationCheckoutPayload | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(REGISTRATION_CHECKOUT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RegistrationCheckoutPayload
    if (!parsed?.rider?.firstName || !parsed.registrantEmail) return null
    const p = parsed as RegistrationCheckoutPayload & {
      registrationFee?: number
      eventEntries?: RegistrationCheckoutEntry[]
      checkoutBundleId?: string
      checkoutLines?: RegistrationCheckoutLine[]
    }
    if (!Array.isArray(p.eventEntries) || p.eventEntries.length === 0) {
      const legacyFee = Number(p.registrationFee ?? p.registrationFeeTotal ?? p.registrationFeePerEntry ?? 0)
      p.eventEntries = [{ slug: '', label: String(p.raceType ?? '') }]
      p.registrationFeePerEntry = legacyFee || 1
      p.registrationFeeTotal = legacyFee || 1
      p.checkoutBundleId =
        typeof p.checkoutBundleId === 'string' && p.checkoutBundleId.trim()
          ? p.checkoutBundleId
          : globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-legacy`
    } else if (!Number.isFinite(Number(p.registrationFeePerEntry)) || !(Number(p.registrationFeeTotal) >= 0)) {
      const lineCount = Math.max(
        1,
        Array.isArray(p.checkoutLines) && p.checkoutLines.length > 0 ? p.checkoutLines.length : p.eventEntries.length,
      )
      const total = Number(p.registrationFeeTotal ?? p.registrationFee ?? p.registrationFeePerEntry ?? 0)
      p.registrationFeeTotal = total > 0 ? total : lineCount
      p.registrationFeePerEntry = total > 0 ? total / lineCount : 1
    }
    if (!p.checkoutBundleId?.trim())
      p.checkoutBundleId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-fallback`

    const resolved = resolveCheckoutLines(p as RegistrationCheckoutPayload)
    if (resolved.length > 0) {
      ;(p as RegistrationCheckoutPayload).checkoutLines = resolved
    }
    return p as RegistrationCheckoutPayload
  } catch {
    return null
  }
}

export function saveRegistrationCheckoutPayload(payload: RegistrationCheckoutPayload) {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem(REGISTRATION_CHECKOUT_STORAGE_KEY, JSON.stringify(payload))
}

export function clearRegistrationCheckoutPayload() {
  if (typeof window === 'undefined') return
  window.sessionStorage.removeItem(REGISTRATION_CHECKOUT_STORAGE_KEY)
}

export type RegistrationCertificateData = {
  registrationId: string
  riderName: string
  category: string
  categoryCode: string
  discipline: string
  eventType: string
  bibNumber: string
  eventTitle: string
  eventId: string
  registrantEmail: string
  qrValue: string
  verificationId: string
  verificationToken: string
  paymentStatus: string
  isPaid: boolean
  paidAt: string | null
}

async function getEdgeFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context
  if (context && typeof context === 'object' && 'text' in context) {
    try {
      const text = await (context as { text: () => Promise<string> }).text()
      if (text?.trim()) return text
    } catch {
      // Ignore and fall back to other parsing
    }
  }

  const message = (error as { message?: string } | null)?.message
  return message?.trim() ? message : fallback
}

const AUTH_RELOAD_GUARD_KEY = 'hna_edge_auth_reload_ts'

function parseEdgeFunctionErrorBody(raw: string): { message: string; code: string } {
  const t = String(raw ?? '').trim()
  if (t.startsWith('{')) {
    try {
      const o = JSON.parse(t) as { message?: string; error?: string; code?: string }
      return {
        message: String(o.message ?? o.error ?? raw),
        code: String(o.code ?? ''),
      }
    } catch {
      /* keep raw */
    }
  }
  return { message: raw, code: '' }
}

function isSessionExpiredEdgeError(raw: string): boolean {
  const parsed = parseEdgeFunctionErrorBody(raw)
  const blob = `${parsed.code} ${parsed.message} ${raw}`.toLowerCase()
  return (
    parsed.code === 'UNAUTHORIZED_INVALID_TOKEN' ||
    parsed.code === 'UNAUTHORIZED_NO_AUTH_HEADER' ||
    blob.includes('invalid or expired token') ||
    blob.includes('jwt expired') ||
    blob.includes('token expired') ||
    blob.includes('session expired')
  )
}

export async function reloadPageIfSessionExpiredInvokeError(error: unknown, fallbackForParse: string): Promise<boolean> {
  const raw = await getEdgeFunctionErrorMessage(error, fallbackForParse)
  if (!isSessionExpiredEdgeError(raw)) return false
  if (typeof window === 'undefined') return false
  const prev = Number(window.sessionStorage.getItem(AUTH_RELOAD_GUARD_KEY) ?? '0')
  const now = Date.now()
  if (prev && now - prev < 5000) return false
  window.sessionStorage.setItem(AUTH_RELOAD_GUARD_KEY, String(now))
  try {
    await supabase.auth.refreshSession()
  } catch {
    /* ignore */
  }
  window.location.reload()
  return true
}

async function getAuthHeaders(): Promise<Record<string, string>>{
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function getStableVerificationToken(input: {
  registrationId: string
  paymentOrderId?: string | null
  paymentTxId?: string | null
  bibNumber: string
}) {
  const base = `${input.registrationId}:${input.paymentOrderId ?? 'order'}:${input.paymentTxId ?? 'tx'}:${input.bibNumber}`
  const encoded = btoa(base).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return encoded.slice(0, 48)
}

function normalizeEventType(raw: string | null | undefined) {
  const first = String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0]
  if (!first) return 'Criterium'
  return first
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export const registrationService = {
  async createRegistration(args: {
    raceType: RegistrationEventKey
    eventId?: string
    raceCategoryId?: string
    registrantEmail: string
    registrationFee: number
    checkoutBundleId?: string | null
    entryEventTypeSlug?: string | null
    entryEventTypeLabel?: string | null
    rider: {
      firstName: string
      lastName: string
      gender: string
      birthDate: string
      address: string
      contactNumber: string
      emergencyContactName: string
      emergencyContactNumber: string
      teamName?: string
      discipline?: string
      ageCategory?: string
      jerseySize?: string
      birthYear?: number | null
    }
  }) {
    const headers = await getAuthHeaders()
    const { data, error } = await supabase.functions.invoke('public-register', {
      headers,
      body: {
        raceType: args.raceType,
        eventId: args.eventId,
        raceCategoryId: args.raceCategoryId,
        registrantEmail: args.registrantEmail,
        registrationFee: args.registrationFee,
        checkoutBundleId: args.checkoutBundleId ?? null,
        entryEventTypeSlug: args.entryEventTypeSlug ?? null,
        entryEventTypeLabel: args.entryEventTypeLabel ?? null,
        rider: args.rider,
      },
    })
    if (error) {
      const raw = await getEdgeFunctionErrorMessage(error, 'Unable to create registration.')
      let msg = raw
      if (raw.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(raw) as { message?: string }
          if (parsed?.message) msg = String(parsed.message)
        } catch {
          /* keep raw */
        }
      }
      throw new Error(msg)
    }
    return { registrationId: data.registrationId as string }
  },

  async checkCheckoutPaymentStatus(registrationId: string): Promise<CheckoutPaymentStatus> {
    const headers = await getAuthHeaders()
    const { data, error } = await supabase.functions.invoke('public-check-checkout-status', {
      headers,
      body: { registrationId },
    })
    if (error) throw new Error(await getEdgeFunctionErrorMessage(error, 'Unable to verify payment link.'))
    return data as CheckoutPaymentStatus
  },

  async createPaymentOrder(args: {
    registrationId: string
    amount: number
    merchantReference?: string
    acceptLiability: boolean
    acceptRules: boolean
  }) {
    const headers = await getAuthHeaders()
    const { data, error } = await supabase.functions.invoke('public-create-payment', {
      headers,
      body: {
        registrationId: args.registrationId,
        amount: args.amount,
        merchantReference: args.merchantReference,
        acceptLiability: args.acceptLiability,
        acceptRules: args.acceptRules,
      },
    })
    if (error) throw new Error(await getEdgeFunctionErrorMessage(error, 'Unable to create payment order.'))
    return {
      paymentOrderId: data.paymentOrderId as string,
      checkoutUrl: data.checkoutUrl as string | undefined,
      checkoutSessionId: (data.checkoutSessionId as string | undefined) ?? undefined,
    }
  },

  async getPendingPaymentDraft(_registrationId?: string): Promise<PendingPaymentDraft | null> {
    void _registrationId
    return null
  },

  async cancelPendingPaymentDraft(registrationId: string) {
    const { data: reg, error: regMetaError } = await supabase
      .from('registration_forms')
      .select('id, checkout_bundle_id, user_id')
      .eq('id', registrationId)
      .maybeSingle()
    if (regMetaError) throw regMetaError

    const { error: orderError } = await supabase
      .from('payment_orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('registration_id', registrationId)
      .in('status', ['created', 'pending', 'processing'])
    if (orderError) throw orderError

    const stamp = new Date().toISOString()
    let regCancel = supabase
      .from('registration_forms')
      .update({ status: 'cancelled', updated_at: stamp })
      .in('status', ['payment_processing', 'pending_payment'])
    if (reg?.checkout_bundle_id) {
      regCancel = regCancel.eq('checkout_bundle_id', reg.checkout_bundle_id as string)
    } else {
      regCancel = regCancel.eq('id', registrationId)
    }
    const { error: registrationError } = await regCancel
    if (registrationError) throw registrationError
  },

  async getCheckoutItem(registrationId: string): Promise<CheckoutItem | null> {
    const { data: registration, error: registrationError } = await supabase
      .from('registration_forms')
      .select('id, event_id, registration_fee, checkout_bundle_id, user_id')
      .eq('id', registrationId)
      .maybeSingle()
    if (registrationError) throw registrationError
    if (!registration) return null

    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('title, race_type')
      .eq('id', registration.event_id)
      .maybeSingle()
    if (eventError) throw eventError

    let amount = Number(registration.registration_fee ?? 0)
    let raceTypeLine = ''
    let lineItemCount = 1

    const bundleId = registration.checkout_bundle_id ? String(registration.checkout_bundle_id) : ''
    if (bundleId) {
      const { data: rows, error: bundleErr } = await supabase
        .from('registration_forms')
        .select('registration_fee, entry_event_type_label')
        .eq('checkout_bundle_id', bundleId)
        .order('created_at', { ascending: true })

      if (!bundleErr && rows?.length) {
        lineItemCount = rows.length
        amount = rows.reduce((sum, row) => sum + Number(row.registration_fee ?? 0), 0) || amount
        raceTypeLine = rows
          .map((row) => String(row.entry_event_type_label ?? '').trim())
          .filter(Boolean)
          .join(', ')
      }
    }

    if (!raceTypeLine) raceTypeLine = normalizeEventType(event?.race_type)

    return {
      registrationId: registration.id,
      eventTitle: String(event?.title ?? 'Event Registration'),
      raceType: raceTypeLine || String(event?.race_type ?? '-'),
      amount: amount > 0 ? amount : Number(registration.registration_fee ?? 0),
      currency: 'PHP',
      lineItemCount,
    }
  },

  /** Other registrations purchased in the same PayMongo checkout (for certificate links). */
  async listCheckoutBundleCertificates(registrationId: string): Promise<
    Array<{ id: string; entry_event_type_label: string | null }>
  > {
    const { data: reg, error: e1 } = await supabase
      .from('registration_forms')
      .select('checkout_bundle_id')
      .eq('id', registrationId)
      .maybeSingle()
    if (e1) throw e1
    const bundleId = reg?.checkout_bundle_id ? String(reg.checkout_bundle_id) : ''
    if (!bundleId) return []

    const { data: rows, error: e2 } = await supabase
      .from('registration_forms')
      .select('id, entry_event_type_label')
      .eq('checkout_bundle_id', bundleId)
      .order('created_at', { ascending: true })
    if (e2) throw e2
    return (rows ?? []).map((r) => ({
      id: String(r.id),
      entry_event_type_label: r.entry_event_type_label ?? null,
    }))
  },

  /** All registration row ids in the same checkout bundle (including `registrationId`), creation order. */
  async listCheckoutBundleRegistrationIds(registrationId: string): Promise<string[]> {
    const { data: reg, error: e1 } = await supabase
      .from('registration_forms')
      .select('checkout_bundle_id')
      .eq('id', registrationId)
      .maybeSingle()
    if (e1) throw e1
    const bundleId = reg?.checkout_bundle_id ? String(reg.checkout_bundle_id) : ''
    if (!bundleId) return [registrationId]

    const { data: rows, error: e2 } = await supabase
      .from('registration_forms')
      .select('id')
      .eq('checkout_bundle_id', bundleId)
      .order('created_at', { ascending: true })
    if (e2) throw e2
    const ids = (rows ?? []).map((r) => String(r.id)).filter(Boolean)
    return ids.length > 0 ? ids : [registrationId]
  },

  async markRegistrationAsPaidAfterPaymongoRedirect(
    registrationId: string,
    opts?: { checkoutSessionId?: string | null },
  ) {
    const headers = await getAuthHeaders()
    const checkoutSessionId = String(opts?.checkoutSessionId ?? '').trim()
    const { data, error } = await supabase.functions.invoke('finalize-paymongo-success', {
      headers,
      body: {
        registrationId,
        ...(checkoutSessionId ? { checkoutSessionId } : {}),
      },
    })
    if (error) {
      const raw = await getEdgeFunctionErrorMessage(error, 'Unable to finalize payment and assign bib.')
      let msg = raw
      if (raw.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(raw) as { error?: string; message?: string }
          if (parsed?.error) msg = String(parsed.error)
          else if (parsed?.message) msg = String(parsed.message)
        } catch {
          /* keep raw */
        }
      }
      throw new Error(msg)
    }
    const payload = data as { ok?: boolean; bib_number?: string; error?: string } | null
    if (payload?.error) throw new Error(String(payload.error))
    if (!payload?.ok) throw new Error('Payment finalization returned an unexpected response.')
  },

  async getRegistrationCertificateData(registrationId: string): Promise<RegistrationCertificateData | null> {
    const { data: registration, error: registrationError } = await supabase
      .from('registration_forms')
      .select(
        'id, event_id, race_category_id, bib_number, registrant_email, status, entry_event_type_slug, entry_event_type_label, checkout_bundle_id',
      )
      .eq('id', registrationId)
      .maybeSingle()
    if (registrationError) throw registrationError
    if (!registration) return null

    let orderQuery = supabase
      .from('payment_orders')
      .select('id, status, paid_at, created_at, provider_reference')
      .eq('registration_id', registrationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const [{ data: rider, error: riderError }, { data: event, error: eventError }, { data: raceCategory, error: raceCategoryError }, orderResult] =
      await Promise.all([
        supabase
          .from('registration_rider_details')
          .select('first_name, last_name, age_category, discipline')
          .eq('registration_id', registrationId)
          .maybeSingle(),
        supabase.from('events').select('id, title, race_type').eq('id', registration.event_id).maybeSingle(),
        registration.race_category_id
          ? supabase.from('race_categories').select('category_name, code').eq('id', registration.race_category_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        orderQuery,
      ])

    let { data: order, error: orderError } = orderResult
    const bundleRef = registration.checkout_bundle_id ? String(registration.checkout_bundle_id) : ''
    if (!order?.id && bundleRef) {
      const r2 = await supabase
        .from('payment_orders')
        .select('id, status, paid_at, created_at, provider_reference')
        .eq('checkout_bundle_id', bundleRef)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      order = r2.data
      orderError = r2.error
    }

    if (riderError) throw riderError
    if (eventError) throw eventError
    if (orderError) throw orderError
    if (raceCategoryError) throw raceCategoryError

    let txStatus: string | null = null
    let txPaidAt: string | null = null
    let txId: string | null = null
    if (order?.id) {
      const { data: tx, error: txError } = await supabase
        .from('payment_transactions')
        .select('id, status, paid_at, created_at')
        .eq('payment_order_id', order.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (txError) throw txError
      txId = tx?.id ?? null
      txStatus = tx?.status ?? null
      txPaidAt = tx?.paid_at ?? null
    }

    const riderName = [rider?.first_name, rider?.last_name].filter(Boolean).join(' ').trim() || 'Registered Rider'
    const category = String(rider?.age_category ?? raceCategory?.category_name ?? 'Open Category')
    const discipline = String(rider?.discipline ?? event?.race_type ?? 'Cycling')
    const entryLabel = String(registration.entry_event_type_label ?? '').trim()
    const eventType = entryLabel || normalizeEventType(event?.race_type)
    const categoryCode = String(raceCategory?.code ?? '').trim() || '00'
    const rawBib = String(registration.bib_number ?? '').trim()
    const paymentStatus = String(txStatus ?? order?.status ?? registration.status ?? 'pending')
    const normalizedStatus = paymentStatus.toLowerCase()
    const isPaid =
      normalizedStatus === 'paid' ||
      normalizedStatus === 'confirmed' ||
      String(registration.status ?? '').toLowerCase() === 'confirmed'
    const bibNumber = rawBib
    const verificationId = bibNumber
      ? `REG-${new Date().getFullYear()}-${bibNumber}`
      : `REG-${new Date().getFullYear()}-${registration.id.replace(/-/g, '').slice(0, 10)}`
    const verificationToken = getStableVerificationToken({
      registrationId: registration.id,
      paymentOrderId: order?.id ?? null,
      paymentTxId: txId,
      bibNumber,
    })
    const qrPayload = JSON.stringify({
      version: 2,
      type: 'registration_qr',
      bib_number: bibNumber,
      verification_id: verificationId,
      event_id: String(event?.id ?? registration.event_id ?? ''),
      registration_id: registration.id,
      event_type_slug: String(registration.entry_event_type_slug ?? '').trim() || null,
      event_type_label: String(registration.entry_event_type_label ?? '').trim() || null,
      category_code: categoryCode || null,
    })

    return {
      registrationId: registration.id,
      riderName,
      category,
      categoryCode,
      discipline,
      eventType,
      bibNumber,
      eventTitle: String(event?.title ?? 'Hari ng Ahon'),
      eventId: String(event?.id ?? registration.event_id ?? ''),
      registrantEmail: String(registration.registrant_email ?? ''),
      qrValue: qrPayload,
      verificationId,
      verificationToken,
      paymentStatus,
      isPaid,
      paidAt: txPaidAt ?? order?.paid_at ?? null,
    }
  },

  async queueCertificateEmail(args: {
    registrationId: string
    recipient: string
    subject: string
  }) {
    const recipient = args.recipient.trim()
    if (!recipient) throw new Error('Missing recipient email.')
    const { data: existingDelivery, error: existingDeliveryError } = await supabase
      .from('notification_deliveries')
      .select('id, status')
      .eq('registration_id', args.registrationId)
      .eq('channel', 'email')
      .eq('recipient', recipient)
      .eq('payload->>type', 'registration_certificate')
      .in('status', ['queued', 'processing', 'sent'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existingDeliveryError) throw existingDeliveryError
    if (existingDelivery?.id) {
      return { queued: false, reason: 'already_queued' as const }
    }
    const { error } = await supabase.from('notification_deliveries').insert({
      user_id: null,
      registration_id: args.registrationId,
      channel: 'email',
      recipient,
      subject: args.subject,
      payload: {
        type: 'registration_certificate',
        registration_id: args.registrationId,
      },
      status: 'queued',
      created_at: new Date().toISOString(),
    })
    if (error) throw error
    return { queued: true as const }
  },

  // agreements handled inside public-create-payment
}

