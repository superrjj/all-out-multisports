import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi, type AdminRegistrationRow } from '../../services/adminApi'
import { supabase } from '../../lib/supabase'
import { AlertTriangle, CalendarDays, Check, CheckCircle2, ClipboardList, Copy, Printer, Search, ShieldX, Users, X } from 'lucide-react'

function formatEventTypeSlugLabel(slug: string | null | undefined) {
  const raw = String(slug ?? '').trim()
  if (!raw) return '—'
  return raw
    .split(/[,_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function pill(status: string) {
  const s = status.toLowerCase()
  if (s === 'paid') return 'bg-emerald-50 text-emerald-700'
  if (s === 'pending') return 'bg-amber-50 text-amber-700'
  if (s === 'failed') return 'bg-rose-50 text-rose-700'
  if (s === 'refunded') return 'bg-slate-100 text-slate-700'
  return 'bg-slate-100 text-slate-700'
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="py-3 pl-4 pr-3">
        <div className="h-3 w-32 rounded bg-slate-200 mb-1.5" />
        <div className="h-2.5 w-44 rounded bg-slate-100" />
      </td>
      <td className="py-3 pr-3"><div className="h-3 w-36 rounded bg-slate-200" /></td>
      <td className="py-3 pr-3"><div className="h-3 w-20 rounded bg-slate-200" /></td>
      <td className="py-3 pr-3"><div className="h-3 w-20 rounded bg-slate-200" /></td>
      <td className="py-3 pr-3"><div className="h-3 w-24 rounded bg-slate-200" /></td>
      <td className="py-3 pr-3">
        <div className="h-3 w-20 rounded bg-slate-200 mb-1.5" />
        <div className="h-2.5 w-16 rounded bg-slate-100" />
      </td>
      <td className="py-3 pr-3"><div className="h-5 w-16 rounded-full bg-slate-200" /></td>
      <td className="py-3 pr-3"><div className="h-3 w-24 rounded bg-slate-200" /></td>
      <td className="py-3 pr-3"><div className="h-3 w-10 rounded bg-slate-200" /></td>
      <td className="py-3 pr-4 text-right"><div className="ml-auto h-6 w-12 rounded-md bg-slate-200" /></td>
    </tr>
  )
}

type BibLedgerRow = {
  id: string
  race_category_id: string | null
  entry_event_type_slug: string | null
  bib_class_code: number | string | null
  created_at: string | null
}

type LedgerCategoryRow = {
  id: string
  discipline: string | null
  category_name: string | null
}

type EventTypeRow = {
  slug: string
  name: string
}

export function AdminRegistrations() {
  const PAGE_SIZE = 50
  const [rows, setRows] = useState<AdminRegistrationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [raceFilter, setRaceFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'created_desc' | 'created_asc' | 'cyclist_asc' | 'cyclist_desc'>('created_desc')
  const [page, setPage] = useState(1)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [ledgerEventId, setLedgerEventId] = useState('')
  const [ledgerDiscipline, setLedgerDiscipline] = useState('all')
  const [ledgerCategoryId, setLedgerCategoryId] = useState('all')
  const [ledgerCategories, setLedgerCategories] = useState<LedgerCategoryRow[]>([])
  const [ledgerEventTypes, setLedgerEventTypes] = useState<EventTypeRow[]>([])
  const [ledgerRows, setLedgerRows] = useState<BibLedgerRow[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState('')

  function fetchData() {
    return adminApi
      .registrationsList()
      .then((data) => {
        setRows(data)
        setError('')
      })
      .catch((e) => {
        setError((e as Error).message || 'Failed to load registrations.')
      })
      .finally(() => {
        setLoading(false)
      })
  }

  useEffect(() => {
    setLoading(true)
    void fetchData()

    const channel = supabase
      .channel('admin-registrations-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registration_forms' }, () => { void fetchData() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_orders' }, () => { void fetchData() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_transactions' }, () => { void fetchData() })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [])

  const raceOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => String(r.race_type ?? '').trim()).filter(Boolean))),
    [rows],
  )
  const categoryOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => String(r.age_category ?? '').trim()).filter(Boolean))),
    [rows],
  )
  const ledgerEventOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const row of rows) {
      const id = String(row.event_id ?? '').trim()
      if (!id) continue
      if (!byId.has(id)) byId.set(id, String(row.event_title ?? row.race_type ?? id))
    }
    return Array.from(byId.entries()).map(([id, title]) => ({ id, title }))
  }, [rows])
  const ledgerDisciplineOptions = useMemo(
    () => Array.from(new Set(ledgerCategories.map((c) => String(c.discipline ?? '').trim()).filter(Boolean))),
    [ledgerCategories],
  )
  const ledgerCategoryOptions = useMemo(
    () => ledgerCategories.filter((c) => {
      if (ledgerDiscipline === 'all') return true
      return String(c.discipline ?? '') === ledgerDiscipline
    }),
    [ledgerCategories, ledgerDiscipline],
  )

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    let result = rows.filter((r) => {
      const matchesSearch =
        r.id.toLowerCase().includes(query) ||
        String(r.rider_full_name ?? '').toLowerCase().includes(query) ||
        String(r.registrant_email ?? '').toLowerCase().includes(query) ||
        String(r.race_type ?? '').toLowerCase().includes(query) ||
        String(r.age_category ?? '').toLowerCase().includes(query) ||
        String(r.payment_status ?? '').toLowerCase().includes(query)
      const matchesRace = raceFilter === 'all' || String(r.race_type ?? '') === raceFilter
      const matchesPayment = paymentFilter === 'all' || String(r.payment_status ?? '') === paymentFilter
      const matchesCategory = categoryFilter === 'all' || String(r.age_category ?? '') === categoryFilter
      return matchesSearch && matchesRace && matchesPayment && matchesCategory
    })

    result = [...result].sort((a, b) => {
      if (sortBy === 'created_asc' || sortBy === 'created_desc') {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0
        const db = b.created_at ? new Date(b.created_at).getTime() : 0
        return sortBy === 'created_asc' ? da - db : db - da
      }
      const na = String(a.rider_full_name ?? '').toLowerCase()
      const nb = String(b.rider_full_name ?? '').toLowerCase()
      return sortBy === 'cyclist_asc' ? na.localeCompare(nb) : nb.localeCompare(na)
    })

    return result
  }, [q, rows, raceFilter, paymentFilter, categoryFilter, sortBy])

  const paidCount = filtered.filter((r) => String(r.payment_status ?? '').toLowerCase() === 'paid').length
  const pendingCount = filtered.filter((r) => String(r.payment_status ?? '').toLowerCase() !== 'paid').length

  const duplicateNonPaidKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of filtered) {
      if (String(r.payment_status ?? '').toLowerCase() === 'paid') continue
      const key = `${String(r.registrant_email ?? '').toLowerCase()}|${String(r.event_title ?? '')}|${String(r.race_category_id ?? r.age_category ?? '')}|${String(r.entry_event_type_label ?? '').toLowerCase()}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const dups = new Set<string>()
    for (const [key, n] of counts.entries()) {
      if (n > 1) dups.add(key)
    }
    return dups
  }, [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const startIndex = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE
  const paginated = filtered.slice(startIndex, startIndex + PAGE_SIZE)
  const showingFrom = filtered.length === 0 ? 0 : startIndex + 1
  const showingTo = filtered.length === 0 ? 0 : Math.min(startIndex + PAGE_SIZE, filtered.length)
  const pageNumbers = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
    if (currentPage <= 3) return [1, 2, 3, 4, 5]
    if (currentPage >= totalPages - 2) return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    return [currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2]
  }, [currentPage, totalPages])

  useEffect(() => { setPage(1) }, [q, raceFilter, paymentFilter, categoryFilter, sortBy])
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])

  useEffect(() => {
    if (!ledgerOpen) return
    if (ledgerEventId) return
    const first = ledgerEventOptions[0]?.id ?? ''
    if (first) setLedgerEventId(first)
  }, [ledgerOpen, ledgerEventId, ledgerEventOptions])

  useEffect(() => {
    if (!ledgerOpen || !ledgerEventId) return
    let active = true
    void (async () => {
      try {
        const { data, error: qErr } = await supabase
          .from('race_categories')
          .select('id, discipline, category_name')
          .eq('event_id', ledgerEventId)
          .order('discipline', { ascending: true })
          .order('category_name', { ascending: true })
        if (!active) return
        if (qErr) throw qErr
        setLedgerCategories((data ?? []) as LedgerCategoryRow[])
      } catch (e) {
        if (!active) return
        setLedgerError((e as Error).message || 'Failed to load event categories.')
        setLedgerCategories([])
      }
    })()
    return () => { active = false }
  }, [ledgerOpen, ledgerEventId])

  useEffect(() => {
    if (!ledgerEventId) return
    void supabase
      .from('event_types')
      .select('slug, name')
      .then(({ data }) => setLedgerEventTypes((data ?? []) as EventTypeRow[]))
  }, [ledgerEventId])

  useEffect(() => {
    if (!ledgerOpen || !ledgerEventId) return
    let active = true
    setLedgerLoading(true)
    setLedgerError('')
    void (async () => {
      try {
        let query = supabase
          .from('event_race_bib_classes')
          .select('id, race_category_id, entry_event_type_slug, bib_class_code, created_at')
          .eq('event_id', ledgerEventId)
          .order('entry_event_type_slug', { ascending: true })
          .order('bib_class_code', { ascending: true })

        if (ledgerCategoryId !== 'all') {
          query = query.eq('race_category_id', ledgerCategoryId)
        } else if (ledgerDiscipline !== 'all') {
          const ids = ledgerCategoryOptions.map((c) => c.id)
          if (ids.length === 0) {
            if (!active) return
            setLedgerRows([])
            setLedgerLoading(false)
            return
          }
          query = query.in('race_category_id', ids)
        }

        const { data, error: qErr } = await query
        if (!active) return
        if (qErr) throw qErr
        setLedgerRows((data ?? []) as BibLedgerRow[])
      } catch (e) {
        if (!active) return
        setLedgerError((e as Error).message || 'Failed to load category legend.')
        setLedgerRows([])
      } finally {
        if (active) setLedgerLoading(false)
      }
    })()
    return () => { active = false }
  }, [ledgerOpen, ledgerEventId, ledgerDiscipline, ledgerCategoryId, ledgerCategoryOptions])

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Registrations</h2>
            <p className="text-sm text-slate-500">Manage and monitor all event registrations</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Users className="h-3.5 w-3.5" />
              Import Participants
            </button>
            <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Printer className="h-3.5 w-3.5" />
              Print Race Bibs
            </button>
            <button
              type="button"
              onClick={() => setLedgerOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              View Legend
            </button>
            <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-[#1e4a8e] px-3 py-2 text-xs font-semibold text-white hover:bg-[#163b72]">
              <ShieldX className="h-3.5 w-3.5" />
              Assign Manual Bib
            </button>
          </div>
        </div>

        <div className="border-b border-slate-100 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Filters</p>
          <div className="grid gap-2 md:grid-cols-[1.3fr_repeat(4,minmax(0,1fr))_auto]">
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search registrations..."
                className="h-10 w-full rounded-md border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]"
              />
            </div>
            <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]">
              <option value="all">All Payment Status</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
              <option value="unknown">Unknown</option>
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]">
              <option value="created_desc">All Registration Status</option>
              <option value="created_asc">Created (Oldest)</option>
              <option value="cyclist_asc">Cyclist A-Z</option>
              <option value="cyclist_desc">Cyclist Z-A</option>
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]">
              <option value="all">All Categories</option>
              {categoryOptions.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <select value={raceFilter} onChange={(e) => setRaceFilter(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]">
              <option value="all">All Events</option>
              {raceOptions.map((race) => <option key={race} value={race}>{race}</option>)}
            </select>
            <input type="date" className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]" />
          </div>
        </div>

        <div className="grid gap-3 border-b border-slate-100 px-4 py-3 md:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Paid" value={paidCount} icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" loading={loading} />
          <StatCard label="Unpaid / pending" value={pendingCount} icon={<CalendarDays className="h-4 w-4" />} tone="amber" loading={loading} />
          <StatCard label="Total Registrations" value={filtered.length} icon={<Users className="h-4 w-4" />} tone="violet" loading={loading} />
        </div>

        {error ? <p className="px-4 py-3 text-sm text-rose-600">{error}</p> : null}

        <div className="overflow-x-auto overflow-y-auto max-h-[600px]">
          <table className="min-w-[1320px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500">
              <tr>
                <th className="py-3 pl-4 pr-3 font-semibold">Rider Name</th>
                <th className="py-3 pr-3 font-semibold">Event</th>
                <th className="py-3 pr-3 font-semibold">Category</th>
                <th className="py-3 pr-3 font-semibold">Discipline</th>
                <th className="py-3 pr-3 font-semibold">Team</th>
                <th className="py-3 pr-3 font-semibold">Registration Date</th>
                <th className="py-3 pr-3 font-semibold">Payment Status</th>
                <th className="py-3 pr-3 font-semibold">Reference No.</th>
                <th className="py-3 pr-3 font-semibold">Bib Number</th>
                <th className="py-3 pr-4 text-right font-semibold">Admin Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : paginated.length === 0 ? (
                <tr>
                  <td className="py-12 text-center" colSpan={10}>
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Users className="h-8 w-8 opacity-40" />
                      <p className="text-sm font-medium">No registrations found.</p>
                      <p className="text-xs">Try adjusting your filters or search query.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map((r) => {
                  const payment = String(r.payment_status ?? 'unknown')
                  const isPaid = payment.toLowerCase() === 'paid'
                  const dupKey = `${String(r.registrant_email ?? '').toLowerCase()}|${String(r.event_title ?? '')}|${String(r.race_category_id ?? r.age_category ?? '')}|${String(r.entry_event_type_label ?? '').toLowerCase()}`
                  const showDupWarning = !isPaid && duplicateNonPaidKeys.has(dupKey)
                  const referenceNo = (r.provider_reference ?? '').trim()
                  return (
                    <tr key={r.id} className="text-slate-800 transition-colors hover:bg-slate-50/70">
                      <td className="py-3 pl-4 pr-3">
                        <p className="text-xs font-semibold">{r.rider_full_name ?? '-'}</p>
                        <p className="text-[11px] text-slate-500">{r.registrant_email ?? '-'}</p>
                      </td>
                      <td className="py-3 pr-3 text-xs">
                        <p className="font-medium text-slate-900">{r.event_title ?? r.race_type ?? '-'}</p>
                        {r.entry_event_type_label ? (
                          <p className="mt-0.5 text-[10px] text-slate-500">{r.entry_event_type_label}</p>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3 text-xs">{r.age_category ?? '-'}</td>
                      <td className="py-3 pr-3 text-xs">{r.discipline ?? '-'}</td>
                      <td className="py-3 pr-3 text-xs">{r.team_name ?? '-'}</td>
                      <td className="py-3 pr-3 text-xs text-slate-600">
                        {r.created_at ? new Date(r.created_at).toLocaleDateString() : '-'}
                        <p className="text-[10px] text-slate-400">{r.created_at ? new Date(r.created_at).toLocaleTimeString() : ''}</p>
                      </td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${pill(payment)}`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                          {payment}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-xs">
                        {isPaid ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="font-semibold text-emerald-700">{referenceNo || '-'}</span>
                            {referenceNo ? (
                              <span
                                title={copiedId === r.id ? 'Copied!' : 'Copy reference number'}
                                onClick={() => {
                                  void navigator.clipboard.writeText(referenceNo)
                                  setCopiedId(r.id)
                                  setTimeout(() => setCopiedId(null), 2000)
                                }}
                                className="cursor-pointer"
                              >
                                {copiedId === r.id ? (
                                  <Check className="h-3 w-3 shrink-0 text-emerald-500 transition-colors" />
                                ) : (
                                  <Copy className="h-3 w-3 shrink-0 text-slate-400 hover:text-slate-600 transition-colors" />
                                )}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-xs font-semibold text-slate-700">
                        <span className="inline-flex items-center gap-1">
                          {showDupWarning ? (
                            <span title="Multiple unpaid registrations for the same rider, event, and category.">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                            </span>
                          ) : null}
                          <span title={isPaid ? undefined : 'Bib is assigned only after payment is confirmed.'}>
                            {isPaid && r.bib_number ? r.bib_number : '—'}
                          </span>
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <Link
                          to={`/admin/registrations/${encodeURIComponent(r.id)}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <p>Showing {showingFrom} to {showingTo} of {filtered.length} registrations</p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:text-slate-400" disabled={currentPage === 1}>‹</button>
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={pageNumber === currentPage ? 'rounded-md bg-[#0f5ea8] px-2.5 py-1 font-semibold text-white' : 'rounded-md border border-slate-200 px-2.5 py-1 text-slate-600 hover:bg-slate-50'}
              >
                {pageNumber}
              </button>
            ))}
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:text-slate-400" disabled={currentPage === totalPages}>›</button>
          </div>
        </div>
      </section>

      {ledgerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white">
                  <ClipboardList className="h-3.5 w-3.5" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Category Legend</h3>
                  <p className="text-xs text-slate-500">View bib classes by event, discipline, and category.</p>
                </div>
              </div>
              <button type="button" onClick={() => setLedgerOpen(false)} className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close legend">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-slate-100 px-4 py-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  value={ledgerEventId}
                  onChange={(e) => { setLedgerEventId(e.target.value); setLedgerDiscipline('all'); setLedgerCategoryId('all') }}
                  className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]"
                >
                  {ledgerEventOptions.length === 0 ? <option value="">No events available</option> : null}
                  {ledgerEventOptions.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
                </select>
                <select
                  value={ledgerDiscipline}
                  onChange={(e) => { setLedgerDiscipline(e.target.value); setLedgerCategoryId('all') }}
                  className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]"
                >
                  <option value="all">All Disciplines</option>
                  {ledgerDisciplineOptions.map((disc) => <option key={disc} value={disc}>{disc}</option>)}
                </select>
                <select
                  value={ledgerCategoryId}
                  onChange={(e) => setLedgerCategoryId(e.target.value)}
                  className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]"
                >
                  <option value="all">All Categories</option>
                  {ledgerCategoryOptions.map((cat) => <option key={cat.id} value={cat.id}>{cat.category_name ?? cat.id}</option>)}
                </select>
              </div>
            </div>

            <div className="max-h-[55vh] overflow-auto p-4">
              {ledgerLoading ? <p className="text-sm text-slate-500">Loading legend…</p> : null}
              {!ledgerLoading && ledgerError ? <p className="text-sm text-rose-600">{ledgerError}</p> : null}
              {!ledgerLoading && !ledgerError && ledgerRows.length === 0 ? (
                <p className="text-sm text-slate-500">No legend entries found for this filter.</p>
              ) : null}
              {!ledgerLoading && !ledgerError && ledgerRows.length > 0 ? (
                <>
                  <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Discipline</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Category</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Event Type</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Bib Class Code</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {ledgerRows.map((item) => {
                        const category = ledgerCategories.find((c) => c.id === item.race_category_id)
                        const eventTypeName = ledgerEventTypes.find((t) => t.slug === item.entry_event_type_slug)?.name ?? formatEventTypeSlugLabel(item.entry_event_type_slug)
                        return (
                          <tr key={item.id}>
                            <td className="px-3 py-2 text-slate-700">{category?.discipline ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-700">{category?.category_name ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-700">{eventTypeName}</td>
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center rounded-md bg-[#1e4a8e] px-2.5 py-1 text-xs font-bold text-white">
                                {item.bib_class_code ?? '—'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs text-slate-500">Total {ledgerRows.length} records</p>
                </>
              ) : null}
            </div>

            <div className="flex justify-end border-t border-slate-100 px-4 py-3">
              <button
                type="button"
                onClick={() => setLedgerOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  tone,
  loading,
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone: 'emerald' | 'amber' | 'blue' | 'rose' | 'violet'
  loading?: boolean
}) {
  const iconClass =
    tone === 'emerald' ? 'bg-emerald-50 text-emerald-600'
    : tone === 'amber' ? 'bg-amber-50 text-amber-600'
    : tone === 'blue' ? 'bg-blue-50 text-blue-600'
    : tone === 'rose' ? 'bg-rose-50 text-rose-600'
    : 'bg-violet-50 text-violet-600'
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] text-slate-500">{label}</p>
          {loading ? (
            <div className="mt-1 h-7 w-10 animate-pulse rounded bg-slate-200" />
          ) : (
            <p className="text-2xl font-semibold text-slate-900">{value}</p>
          )}
        </div>
        <span className={`rounded-md p-2 ${iconClass}`}>{icon}</span>
      </div>
    </div>
  )
}