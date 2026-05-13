import { supabase } from '../lib/supabase'

type IdRow = { id: string }

async function countRows(table: string) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

export const adminModulesApi = {
  async eventsDashboard() {
    const [{ data: events, error }, eventCount, categoryCount] = await Promise.all([
      supabase
        .from('events')
        .select(
          'id, title, description, race_type, venue, event_date, start_date, end_date, start_time, end_time, registration_fee, status, rider_limit, registration_deadline, registration_closes_at, published_at, poster_url, route_map_url, prize_pool, short_description, banner_url, organizer_name, organizer_contact, organizer_email, bib_claim_instructions, google_maps_link, organizer_website, slug',
        )
        .order('event_date', { ascending: false })
        .limit(12),
      countRows('events'),
      countRows('race_categories'),
    ])
    if (error) throw error
    return {
      events: (events ?? []) as Array<Record<string, unknown>>,
      stats: {
        events: eventCount,
        categories: categoryCount,
        published: (events ?? []).filter((item) => item.status === 'published').length,
      },
    }
  },

  async paymentsDashboard() {
    const [{ data: orders, error }, orderCount, txCount] = await Promise.all([
      supabase
        .from('payment_orders')
        .select('id, registration_id, amount, currency, status, payment_method, merchant_reference, provider_reference, created_at, paid_at')
        .order('created_at', { ascending: false })
        .limit(15),
      countRows('payment_orders'),
      countRows('payment_transactions'),
    ])
    if (error) throw error
    return {
      orders: (orders ?? []) as Array<Record<string, unknown>>,
      stats: {
        orders: orderCount,
        transactions: txCount,
        paid: (orders ?? []).filter((item) => item.status === 'paid').length,
      },
    }
  },

  async bibsDashboard() {
    const [{ data: bibs, error }, bibCount] = await Promise.all([
      supabase
        .from('race_bibs')
        .select('id, registration_id, bib_number, bib_prefix, status, generated_at, printed_at, claimed_at')
        .order('generated_at', { ascending: false })
        .limit(15),
      countRows('race_bibs'),
    ])
    if (error) throw error
    return {
      bibs: (bibs ?? []) as Array<Record<string, unknown>>,
      stats: {
        bibs: bibCount,
        claimed: (bibs ?? []).filter((item) => item.status === 'claimed').length,
      },
    }
  },

  async resultsDashboard() {
    const [{ data: results, error }, resultCount] = await Promise.all([
      supabase
        .from('race_results')
        .select('id, registration_id, bib_number, result_status, rank_overall, rank_category, chip_time_ms, gun_time_ms, published_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(15),
      countRows('race_results'),
    ])
    if (error) throw error
    return {
      results: (results ?? []) as Array<Record<string, unknown>>,
      stats: {
        results: resultCount,
        published: (results ?? []).filter((item) => item.result_status === 'published').length,
      },
    }
  },

  async announcementsDashboard() {
    const [{ data: announcements, error }, totalCount] = await Promise.all([
      supabase
        .from('announcements')
        .select('id, title, excerpt, is_pinned, is_published, published_at, expires_at, updated_at')
        .order('updated_at', { ascending: false })
        .limit(12),
      countRows('announcements'),
    ])
    if (error) throw error
    return {
      announcements: (announcements ?? []) as Array<Record<string, unknown>>,
      stats: {
        posts: totalCount,
        pinned: (announcements ?? []).filter((item) => item.is_pinned).length,
      },
    }
  },

  async galleryDashboard() {
    const [{ data: items, error }, totalCount] = await Promise.all([
      supabase
        .from('gallery')
        .select('id, title, media_type, file_url, is_featured, created_at')
        .order('created_at', { ascending: false })
        .limit(18),
      countRows('gallery'),
    ])
    if (error) throw error
    return {
      items: (items ?? []) as Array<Record<string, unknown>>,
      stats: {
        items: totalCount,
        featured: (items ?? []).filter((item) => item.is_featured).length,
      },
    }
  },

  async reportsDashboard() {
    const [events, registrations, payments, results] = await Promise.all([
      countRows('events'),
      countRows('registration_forms'),
      countRows('payment_orders'),
      countRows('race_results'),
    ])

    const { data: paidOrders, error } = await supabase
      .from('payment_orders')
      .select('amount')
      .eq('status', 'paid')
      .limit(500)
    if (error) throw error

    const revenue = (paidOrders ?? []).reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    return {
      stats: { events, registrations, payments, results, revenue },
    }
  },

  async settingsDashboard() {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value, description, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20)
    if (error) throw error
    return (data ?? []) as Array<Record<string, unknown>>
  },

  async qrDashboard() {
    const [{ data: scans, error }, scanCount] = await Promise.all([
      supabase
        .from('qr_checkins')
        .select('id, registration_id, scanned_code, scan_status, scanned_at')
        .order('scanned_at', { ascending: false })
        .limit(80),
      countRows('qr_checkins'),
    ])
    if (error) throw error
    const registrationIds = Array.from(new Set((scans ?? []).map((item) => String(item.registration_id ?? '')).filter(Boolean)))
    let riderByRegistration = new Map<
      string,
      { rider_name: string; discipline: string; category: string }
    >()
    let registrationById = new Map<string, { event_id: string | null; bib_number: string | null }>()
    let eventById = new Map<string, { title: string; race_type: string }>()
    if (registrationIds.length > 0) {
      const [{ data: riders, error: riderError }, { data: registrations, error: registrationError }] = await Promise.all([
        supabase
          .from('registration_rider_details')
          .select('registration_id, first_name, last_name, discipline, age_category')
          .in('registration_id', registrationIds),
        supabase
          .from('registration_forms')
          .select('id, event_id, bib_number')
          .in('id', registrationIds),
      ])
      if (riderError) throw riderError
      if (registrationError) throw registrationError

      riderByRegistration = new Map(
        (riders ?? []).map((rider) => [
          String(rider.registration_id),
          {
            rider_name: [rider.first_name, rider.last_name].filter(Boolean).join(' ').trim() || 'Registered rider',
            discipline: String(rider.discipline ?? '—'),
            category: String(rider.age_category ?? '—'),
          },
        ]),
      )

      registrationById = new Map(
        (registrations ?? []).map((registration) => [
          String(registration.id),
          {
            event_id: registration.event_id ? String(registration.event_id) : null,
            bib_number: registration.bib_number != null ? String(registration.bib_number) : null,
          },
        ]),
      )

      const eventIds = Array.from(
        new Set((registrations ?? []).map((registration) => String(registration.event_id ?? '')).filter(Boolean)),
      )
      if (eventIds.length > 0) {
        const { data: events, error: eventError } = await supabase
          .from('events')
          .select('id, title, race_type')
          .in('id', eventIds)
        if (eventError) throw eventError
        eventById = new Map(
          (events ?? []).map((event) => [String(event.id), { title: String(event.title ?? 'Current event'), race_type: String(event.race_type ?? '—') }]),
        )
      }
    }
    const scansWithRider = (scans ?? []).map((scan) => ({
      ...scan,
      rider_name: riderByRegistration.get(String(scan.registration_id ?? ''))?.rider_name ?? 'Registered rider',
      discipline: riderByRegistration.get(String(scan.registration_id ?? ''))?.discipline ?? '—',
      category: riderByRegistration.get(String(scan.registration_id ?? ''))?.category ?? '—',
      bib_number: registrationById.get(String(scan.registration_id ?? ''))?.bib_number ?? null,
      event_type:
        eventById.get(String(registrationById.get(String(scan.registration_id ?? ''))?.event_id ?? ''))?.race_type ?? '—',
      event_title:
        eventById.get(String(registrationById.get(String(scan.registration_id ?? ''))?.event_id ?? ''))?.title ?? 'Current event',
    }))
    const scansWithAssignedBib = scansWithRider
      .filter((row) => String(row.bib_number ?? '').trim().length > 0)
      .slice(0, 15)
    return {
      scans: scansWithAssignedBib as Array<Record<string, unknown>>,
      stats: {
        scans: scanCount,
        valid: scansWithAssignedBib.filter((item) => item.scan_status === 'valid').length,
      },
    }
  },

  async emailDashboard() {
    const [{ data: templates, error: templatesError }, { data: deliveries, error: deliveriesError }] = await Promise.all([
      supabase
        .from('email_templates')
        .select('id, code, name, trigger_event, is_active, updated_at')
        .order('updated_at', { ascending: false })
        .limit(10),
      supabase
        .from('notification_deliveries')
        .select('id, recipient, status, subject, sent_at, created_at')
        .order('created_at', { ascending: false })
        .limit(12),
    ])
    if (templatesError) throw templatesError
    if (deliveriesError) throw deliveriesError
    return {
      templates: (templates ?? []) as Array<Record<string, unknown>>,
      deliveries: (deliveries ?? []) as Array<Record<string, unknown>>,
    }
  },

  async digitalWaiverDashboard() {
    const { data, error } = await supabase
      .from('registration_agreements')
      .select('registration_id, liability_waiver_accepted, race_rules_accepted, accepted_at, waiver_version, signed_at')
      .order('accepted_at', { ascending: false })
      .limit(15)
    if (error) throw error
    return (data ?? []) as Array<Record<string, unknown>>
  },

  async systemLogsDashboard() {
    const [{ data: logs, error: logsError }, { data: webhooks, error: webhookError }] = await Promise.all([
      supabase
        .from('system_audit_logs')
        .select('id, module, action, entity_table, entity_id, created_at')
        .order('created_at', { ascending: false })
        .limit(15),
      supabase
        .from('payment_webhook_events')
        .select('id, provider_event_id, event_type, signature_valid, processed, processed_at, created_at')
        .order('created_at', { ascending: false })
        .limit(10),
    ])
    if (logsError) throw logsError
    if (webhookError) throw webhookError
    return {
      logs: (logs ?? []) as Array<Record<string, unknown>>,
      webhooks: (webhooks ?? []) as Array<Record<string, unknown>>,
    }
  },

  async riderDashboard() {
    const [{ data: registrations, error }, registrationCount, bibCount, resultCount] = await Promise.all([
      supabase
        .from('registration_forms')
        .select('id, status, registrant_email, bib_number, confirmed_at, created_at')
        .order('created_at', { ascending: false })
        .limit(15),
      countRows('registration_forms'),
      countRows('race_bibs'),
      countRows('race_results'),
    ])
    if (error) throw error
    return {
      registrations: (registrations ?? []) as Array<Record<string, unknown>>,
      stats: {
        registrations: registrationCount,
        bibs: bibCount,
        results: resultCount,
      },
    }
  },

  async usersDashboard() {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, role, city')
      .order('full_name', { ascending: true })
      .limit(25)
    if (error) throw error
    return (data ?? []) as Array<Record<string, unknown>>
  },

  async createQuickEvent(payload: {
    title: string
    race_type: string
    venue: string
    event_date: string
    registration_fee: number
  }) {
    const { data, error } = await supabase.from('events').insert(payload).select('id').single<IdRow>()
    if (error) throw error
    return data
  },
}
