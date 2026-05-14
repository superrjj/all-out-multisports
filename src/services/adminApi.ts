import { supabase } from '../lib/supabase'

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'unknown'

export interface AdminRegistrationRow {
  id: string
  created_at?: string
  event_id?: string | null
  bib_number?: string | null
  race_type?: string | null
  entry_event_type_label?: string | null
  entry_event_type_slug?: string | null
  discipline?: string | null
  age_category?: string | null
  event_title?: string | null
  team_name?: string | null
  jersey_size?: string | null
  rider_full_name?: string | null
  registrant_email?: string | null
  status?: string | null
  payment_status?: PaymentStatus | string | null
  payment_order_status?: string | null
  payment_order_id?: string | null
  merchant_reference?: string | null
  provider_reference?: string | null
  paid_at?: string | null
  user_id?: string | null
  race_category_id?: string | null
}

export interface AdminRiderDetailRow {
  registration_id: string
  first_name?: string | null
  last_name?: string | null
  gender?: string | null
  birth_date?: string | null
  address?: string | null
  contact_number?: string | null
  emergency_contact_name?: string | null
  emergency_contact_number?: string | null
  team_name?: string | null
  discipline?: string | null
  age_category?: string | null
  jersey_size?: string | null
}

/** Turn raw Postgres duplicate-bib errors into a short admin-facing message. */
function humanizeDuplicateBibError(text: string): string {
  const t = String(text ?? '').trim()
  const lower = t.toLowerCase()
  if (
    lower.includes('registration_forms_bib_number_key') ||
    (lower.includes('duplicate key') && lower.includes('bib_number')) ||
    (lower.includes('unique constraint') && lower.includes('bib_number'))
  ) {
    return 'That bib number is already used by another registration. Click Generate again. If it keeps failing, search registration_forms in Supabase for the duplicate bib_number.'
  }
  return t
}

async function invokeEdgeErrorMessage(error: unknown, responseData: unknown, fallback: string): Promise<string> {
  const wrap = (raw: string) => {
    const t = String(raw ?? '').trim()
    if (!t) return fallback
    if (!t.startsWith('{')) return t
    try {
      const o = JSON.parse(t) as { message?: string; error?: string }
      return String(o.message ?? o.error ?? t)
    } catch {
      return t
    }
  }

  const ctx = (error as { context?: { text?: () => Promise<string>; json?: () => Promise<unknown> } })?.context
  if (ctx && typeof ctx.text === 'function') {
    try {
      const text = await ctx.text()
      if (text?.trim()) return wrap(text)
    } catch {
      /* ignore */
    }
  }

  if (responseData && typeof responseData === 'object') {
    const o = responseData as { message?: string; error?: string }
    const inline = String(o.message ?? o.error ?? '').trim()
    if (inline) return inline
  }

  const msg = (error as { message?: string } | null)?.message
  return msg?.trim() ? msg.trim() : fallback
}

/** Matches `tally-import-{submissionId}-{criterium|individual-time-trial}` from CSV import rows. */
function extractTallyImportSubmissionId(merchantReference: string | null | undefined): string | null {
  const mr = String(merchantReference ?? '')
  const m = mr.match(/^tally-import-(.+)-(criterium|individual-time-trial)$/)
  return m ? m[1] : null
}

function normalizePaymentStatus(args: { orderStatus?: string | null; txStatus?: string | null; registrationStatus?: string | null }): PaymentStatus {
  const order = String(args.orderStatus ?? '').toLowerCase()
  const tx = String(args.txStatus ?? '').toLowerCase()
  const reg = String(args.registrationStatus ?? '').toLowerCase()
  const s = tx || order
  if (['paid', 'succeeded', 'success', 'completed', 'complete', 'confirmed'].includes(s)) return 'paid'
  // Import flow writes registration_forms.status = confirmed.
  // If payment rows are missing/partial, still treat imported records as paid.
  if (reg === 'confirmed') return 'paid'
  if (['pending', 'processing', 'created'].includes(s)) return 'pending'
  if (['failed', 'cancelled', 'canceled', 'expired'].includes(s)) return 'failed'
  if (['refunded'].includes(s)) return 'refunded'
  return 'unknown'
}

export const adminApi = {
  async registrationsList() {
    // 1) Base registrations: registration_forms + event_step1 race_type/title
    // Avoid `event:events(...)` embedding because it depends on schema-cache relationships
    // which can break when events is split into step tables.
    const { data: forms, error: formsError } = await supabase
      .from('registration_forms')
      .select(
        'id, created_at, status, registrant_email, user_id, event_id, bib_number, race_category_id, checkout_bundle_id, entry_event_type_label, entry_event_type_slug',
      )
      .order('created_at', { ascending: false })
      .limit(200)

    if (formsError) throw formsError
    const base = (forms ?? []) as Array<{
      id: string
      created_at?: string
      bib_number?: string | null
      status?: string | null
      registrant_email?: string | null
      user_id?: string | null
      event_id?: string | null
      race_category_id?: string | null
      checkout_bundle_id?: string | null
      entry_event_type_label?: string | null
      entry_event_type_slug?: string | null
    }>

    const registrationIds = base.map((f) => f.id)
    if (registrationIds.length === 0) {
      return [] as AdminRegistrationRow[]
    }

    const eventIds = Array.from(
      new Set(base.map((f) => String(f.event_id ?? '')).filter(Boolean)),
    )

    const { data: events, error: eventsError } = eventIds.length
      ? await supabase.from('events').select('id, race_type, title').in('id', eventIds)
      : { data: [], error: null }

    if (eventsError) throw eventsError

    const eventById = new Map<string, { race_type?: string | null; title?: string | null }>(
      (events ?? []).map((e) => [String(e.id), { race_type: e.race_type ?? null, title: e.title ?? null }]),
    )

    // 1.5) Rider full names for table display
    const { data: riderDetails, error: riderDetailsError } = await supabase
      .from('registration_rider_details')
      .select('registration_id, first_name, last_name, discipline, age_category, team_name, jersey_size')
      .in('registration_id', registrationIds)

    if (riderDetailsError) throw riderDetailsError
    const riderByReg = new Map<string, { first_name?: string | null; last_name?: string | null; discipline?: string | null; age_category?: string | null; team_name?: string | null; jersey_size?: string | null }>()
    for (const rider of riderDetails ?? []) {
      riderByReg.set(rider.registration_id, {
        first_name: rider.first_name ?? null,
        last_name: rider.last_name ?? null,
        discipline: rider.discipline ?? null,
        age_category: rider.age_category ?? null,
        team_name: rider.team_name ?? null,
        jersey_size: rider.jersey_size ?? null,
      })
    }

    // 2) Latest payment order per registration (paymongo)
    const { data: orders, error: ordersError } = await supabase
      .from('payment_orders')
      .select('id, registration_id, status, merchant_reference, provider_reference, updated_at, created_at')
      .in('registration_id', registrationIds)
      .order('created_at', { ascending: false })

    if (ordersError) throw ordersError
    const latestOrderByReg = new Map<string, (typeof orders)[number]>()
    for (const o of orders ?? []) {
      if (!latestOrderByReg.has(o.registration_id)) latestOrderByReg.set(o.registration_id, o)
    }

    // Bundle import: second registration has provider_reference=null (unique constraint). Share pay_ via Tally submission id.
    const payIdByTallySubmission = new Map<string, string>()
    for (const o of orders ?? []) {
      const sid = extractTallyImportSubmissionId(o.merchant_reference ?? null)
      const pref = String(o.provider_reference ?? '').trim()
      if (sid && pref.startsWith('pay_')) payIdByTallySubmission.set(sid, pref)
    }

    const bundleIdsForFallback = Array.from(
      new Set(
        base
          .filter((f) => !latestOrderByReg.has(f.id) && f.checkout_bundle_id)
          .map((f) => String(f.checkout_bundle_id)),
      ),
    )
    if (bundleIdsForFallback.length > 0) {
      const { data: bundleOrders, error: bundleOrdersError } = await supabase
        .from('payment_orders')
        .select('id, registration_id, status, merchant_reference, provider_reference, updated_at, created_at, checkout_bundle_id')
        .in('checkout_bundle_id', bundleIdsForFallback)
        .order('created_at', { ascending: false })
      if (bundleOrdersError) throw bundleOrdersError
      const latestOrderByBundle = new Map<string, (typeof bundleOrders)[number]>()
      for (const o of bundleOrders ?? []) {
        const bid = String(o.checkout_bundle_id ?? '')
        if (bid && !latestOrderByBundle.has(bid)) latestOrderByBundle.set(bid, o)
      }
      for (const f of base) {
        if (!latestOrderByReg.has(f.id) && f.checkout_bundle_id) {
          const bo = latestOrderByBundle.get(String(f.checkout_bundle_id))
          if (bo) latestOrderByReg.set(f.id, bo)
        }
      }
    }

    // 3) Latest transaction per latest payment order
    const orderIds = Array.from(latestOrderByReg.values()).map((o) => o.id)
    let latestTxByOrder = new Map<string, { status?: string | null; paid_at?: string | null; provider_reference?: string | null }>()
    if (orderIds.length > 0) {
      const { data: txs, error: txsError } = await supabase
        .from('payment_transactions')
        .select('payment_order_id, status, paid_at, provider_reference, created_at')
        .in('payment_order_id', orderIds)
        .order('created_at', { ascending: false })

      if (txsError) throw txsError
      for (const t of txs ?? []) {
        if (!latestTxByOrder.has(t.payment_order_id)) {
          latestTxByOrder.set(t.payment_order_id, {
            status: t.status,
            paid_at: t.paid_at,
            provider_reference: t.provider_reference ?? null,
          })
        }
      }
    }

    return base.map((f) => {
      const order = latestOrderByReg.get(f.id)
      const tx = order ? latestTxByOrder.get(order.id) : undefined
      const payment_status = normalizePaymentStatus({ orderStatus: order?.status, txStatus: tx?.status, registrationStatus: f.status })
      const rider = riderByReg.get(f.id)
      const riderFullName = [rider?.first_name, rider?.last_name].filter(Boolean).join(' ').trim()
      const ev = f.event_id ? eventById.get(String(f.event_id)) : undefined

      let providerRef = order?.provider_reference ?? tx?.provider_reference ?? null
      if (!providerRef && order?.merchant_reference) {
        const sid = extractTallyImportSubmissionId(order.merchant_reference)
        if (sid) {
          const shared = payIdByTallySubmission.get(sid)
          if (shared) providerRef = shared
        }
      }

      return {
        id: f.id,
        created_at: f.created_at,
        event_id: f.event_id ?? null,
        bib_number: f.bib_number ?? null,
        race_type: ev?.race_type ?? null,
        entry_event_type_label: f.entry_event_type_label ?? null,
        entry_event_type_slug: f.entry_event_type_slug ?? null,
        discipline: rider?.discipline ?? null,
        age_category: rider?.age_category ?? null,
        event_title: ev?.title ?? null,
        team_name: rider?.team_name ?? null, 
        jersey_size: rider?.jersey_size ?? null,
        rider_full_name: riderFullName || null,
        registrant_email: f.registrant_email ?? null,
        status: f.status ?? null,
        payment_status,
        payment_order_status: order?.status ?? null,
        payment_order_id: order?.id ?? null,
        merchant_reference: order?.merchant_reference ?? null,
        provider_reference: providerRef,
        paid_at: tx?.paid_at ?? null,
        user_id: f.user_id ?? null,
        race_category_id: f.race_category_id ?? null,
      } satisfies AdminRegistrationRow
    })
  },

  async registrationDetails(registrationId: string) {
    const { data: reg, error: regError } = await supabase
      .from('registration_forms')
      .select('id, created_at, status, registrant_email, user_id, event_id, race_category_id, checkout_bundle_id, entry_event_type_slug, entry_event_type_label')
      .eq('id', registrationId)
      .maybeSingle()

    if (regError) throw regError

    const { data: rider, error: riderError } = await supabase
      .from('registration_rider_details')
      .select(
        'registration_id, first_name, last_name, gender, birth_date, address, contact_number, emergency_contact_name, emergency_contact_number, team_name, discipline, age_category, jersey_size',
      )
      .eq('registration_id', registrationId)
      .maybeSingle()

    if (riderError) throw riderError

    let { data: order, error: orderError } = await supabase
      .from('payment_orders')
      .select('id, status, merchant_reference, provider_reference, amount, currency, created_at, updated_at')
      .eq('registration_id', registrationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (orderError) throw orderError

    const bundleRef = reg?.checkout_bundle_id ? String(reg.checkout_bundle_id) : ''
    if (!order?.id && bundleRef) {
      const r2 = await supabase
        .from('payment_orders')
        .select('id, status, merchant_reference, provider_reference, amount, currency, created_at, updated_at')
        .eq('checkout_bundle_id', bundleRef)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (r2.error) throw r2.error
      order = r2.data
    }

    const { data: tx, error: txError } = order
      ? await supabase
          .from('payment_transactions')
          .select('status, paid_at, paymongo_payment_id, paymongo_intent_id, paymongo_source_id, created_at')
          .eq('payment_order_id', order.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null, error: null }

    if (txError) throw txError

    const payment_status = normalizePaymentStatus({
      orderStatus: order?.status ?? null,
      txStatus: tx?.status ?? null,
      registrationStatus: reg?.status ?? null,
    })

    const evId = reg?.event_id ? String(reg.event_id) : null
    const { data: ev, error: evError } = evId
      ? await supabase.from('events').select('id, race_type, title').eq('id', evId).maybeSingle()
      : { data: null, error: null }

    if (evError) throw evError

    return {
      registration: (reg
        ? ({
            id: reg.id,
            created_at: reg.created_at,
            race_type: ev?.race_type ?? null,
            event_id: reg.event_id ?? null,
            race_category_id: reg.race_category_id ?? null,
            entry_event_type_label: reg.entry_event_type_label ?? null,
            entry_event_type_slug: reg.entry_event_type_slug ?? null,
            event_title: ev?.title ?? null,
            registrant_email: reg.registrant_email ?? null,
            status: reg.status ?? null,
            payment_status,
            payment_order_status: order?.status ?? null,
            payment_order_id: order?.id ?? null,
            merchant_reference: order?.merchant_reference ?? null,
            provider_reference: order?.provider_reference ?? null,
            paid_at: tx?.paid_at ?? null,
            user_id: reg.user_id ?? null,
          } satisfies AdminRegistrationRow)
        : null),
      rider: rider as AdminRiderDetailRow | null,
      paymentOrder: order,
      paymentTransaction: tx,
    }
  },

  async adminGenerateBib(registrationId: string) {
    const { data, error } = await supabase.functions.invoke('admin-generate-bib', {
      body: { registrationId },
    })
    if (error) {
      const raw = await invokeEdgeErrorMessage(error, data, 'Could not assign bib.')
      throw new Error(humanizeDuplicateBibError(raw))
    }
    const bodyError = data && typeof data === 'object' ? String((data as { error?: string }).error ?? '').trim() : ''
    if (bodyError) throw new Error(humanizeDuplicateBibError(bodyError))
    return data as { ok: boolean; bib_number?: string; provider_reference?: string; error?: string }
  },

  async adminUpdateRegistration(input: {
    registrationId: string
    patch: {
      registrantEmail: string
      entryEventTypeSlug: string
      entryEventTypeLabel: string
      raceCategoryId: string
      ageCategoryLabel?: string
      discipline?: string
    }
    rider: {
      firstName: string
      lastName: string
      gender: string
      birthDate: string
      address: string
      contactNumber: string
      emergencyContactName: string
      emergencyContactNumber: string
      teamName: string
      jerseySize: string
    }
    payment?: {
      paymentOrderId?: string
      providerReference?: string
      paymentOrderStatus?: string
    }
  }) {
    const { data, error } = await supabase.functions.invoke('admin-update-registration', {
      body: input,
    })
    if (error) throw new Error(await invokeEdgeErrorMessage(error, data, 'Could not save registration changes.'))
    return data as { ok: boolean; error?: string; bib_reassigned?: boolean; bib_number?: string }
  },

  async adminSendRaceKitEmail(registrationId: string) {
    const { data, error } = await supabase.functions.invoke('send-race-claim-certificate-email', {
      body: { registrationId, registrationIds: [registrationId], adminSend: true, forceResend: true },
    })
    if (error) throw new Error(await invokeEdgeErrorMessage(error, data, 'Could not send email.'))
    return data as { ok: boolean; sent_count?: number; error?: string }
  },

  /** Hard-delete a single unpaid checkout row; server enforces pending rules and 10-minute window. */
  async adminDeletePendingRegistration(registrationId: string) {
    const { data, error } = await supabase.functions.invoke('admin-delete-pending-registration', {
      body: { registrationId },
    })
    if (error) throw new Error(await invokeEdgeErrorMessage(error, data, 'Could not delete registration.'))
    return data as { ok?: boolean; error?: string }
  },

  /** Removes abandoned `pending_payment` / `payment_processing` registrations older than 2 hours (service-side rules). */
  async adminPurgeStalePendingRegistrations() {
    const { data, error } = await supabase.functions.invoke('admin-delete-pending-registration', {
      body: { purgeStaleOnly: true },
    })
    if (error) throw new Error(await invokeEdgeErrorMessage(error, data, 'Could not purge stale registrations.'))
    return data as { ok?: boolean; purged_count?: number; errors?: string[]; error?: string }
  },

  async adminGenerateRaceKitCertificate(registrationId: string) {
    const { data, error } = await supabase.functions.invoke('send-race-claim-certificate-email', {
      body: { registrationId, registrationIds: [registrationId], adminSend: true, forceResend: false, generateOnly: true },
    })
    if (error) throw new Error(await invokeEdgeErrorMessage(error, data, 'Could not generate certificate file.'))
    return data as { ok: boolean; generated_count?: number; error?: string }
  },
}