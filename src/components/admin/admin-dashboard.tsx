import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { TooltipItem } from 'chart.js'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import {
  Bike,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileBarChart,
  Megaphone,
  QrCode,
  Settings,
  TrendingUp,
  Trophy,
  Upload,
  Users,
} from 'lucide-react'
import { adminApi, type AdminRegistrationRow } from '../../services/adminApi'
import { supabase } from '../../lib/supabase'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler)

function StatCard({
  label,
  value,
  trend,
  icon: Icon,
  iconBg,
}: {
  label: string
  value: string
  trend: string
  icon: typeof Users
  iconBg: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-[26px]">{value}</p>
          <p className="mt-1 flex items-center gap-1 text-xs font-medium text-slate-600">
            <TrendingUp className="h-3.5 w-3.5" />
            {trend}
          </p>
        </div>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
          <Icon className="h-5 w-5 text-white" strokeWidth={2} />
        </div>
      </div>
    </div>
  )
}

function ChartPlaceholder({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-4 h-48 rounded-lg bg-slate-50/80">{children}</div>
    </div>
  )
}

const lineChartOptionsBase = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0 } },
    y: { beginAtZero: true },
  },
}

function MonthlyRegistrationsChartJs({ labels, data }: { labels: string[]; data: number[] }) {
  const empty = data.every((p) => p === 0)
  const chartData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: 'Registrations',
          data,
          borderColor: '#1e4a8e',
          backgroundColor: 'rgba(30, 74, 142, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: '#1e4a8e',
        },
      ],
    }),
    [labels, data],
  )
  const options = useMemo(
    () => ({
      ...lineChartOptionsBase,
      scales: {
        ...lineChartOptionsBase.scales,
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    }),
    [],
  )
  if (empty) return <p className="flex h-full items-center justify-center text-xs text-slate-500">No data yet.</p>
  return (
    <div className="h-full min-h-[12rem] w-full">
      <Line data={chartData} options={options} />
    </div>
  )
}

function RevenueChartJs({ labels, data }: { labels: string[]; data: number[] }) {
  const empty = data.every((p) => p === 0)
  const chartData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: 'Revenue',
          data,
          borderColor: '#0d9488',
          backgroundColor: 'rgba(13, 148, 136, 0.15)',
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: '#0d9488',
        },
      ],
    }),
    [labels, data],
  )
  const options = useMemo(
    () => ({
      ...lineChartOptionsBase,
      plugins: {
        ...lineChartOptionsBase.plugins,
        tooltip: {
          callbacks: {
            label: (item: TooltipItem<'line'>) =>
              `₱${Number(item.parsed.y ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0 } },
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value: string | number) =>
              `₱${Number(value).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`,
          },
        },
      },
    }),
    [],
  )
  if (empty) return <p className="flex h-full items-center justify-center text-xs text-slate-500">No data yet.</p>
  return (
    <div className="h-full min-h-[12rem] w-full">
      <Line data={chartData} options={options} />
    </div>
  )
}

function EventParticipationBarChartJs({
  labels,
  data,
  usePercentScale,
}: {
  labels: string[]
  data: number[]
  usePercentScale: boolean
}) {
  const empty = labels.length === 0
  const chartData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: usePercentScale ? 'Capacity filled' : 'Registrations',
          data,
          backgroundColor: 'rgba(99, 102, 241, 0.85)',
          borderRadius: 4,
        },
      ],
    }),
    [labels, data, usePercentScale],
  )
  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true } },
        y: usePercentScale
          ? {
              beginAtZero: true,
              max: 100,
              ticks: {
                callback: (value: string | number) => `${value}%`,
              },
            }
          : { beginAtZero: true, ticks: { precision: 0 } },
      },
    }),
    [usePercentScale],
  )
  if (empty) return <p className="flex h-full items-center justify-center text-xs text-slate-500">No data yet.</p>
  return (
    <div className="h-full min-h-[12rem] w-full">
      <Bar data={chartData} options={options} />
    </div>
  )
}

function DonutCategory({ segments, total }: { segments: Array<{ label: string; pct: number; color: string }>; total: number }) {
  if (segments.length === 0 || total === 0) {
    return <p className="flex h-full items-center justify-center text-xs text-slate-500">No data yet.</p>
  }
  let acc = 0
  const gradientStops = segments
    .map((s) => {
      const start = acc
      acc += s.pct
      return `${s.color} ${start}% ${acc}%`
    })
    .join(', ')
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-2 sm:flex-row sm:gap-6">
      <div
        className="relative h-28 w-28 shrink-0 rounded-full"
        style={{
          background: `conic-gradient(${gradientStops})`,
        }}
      >
        <div className="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-white text-center shadow-inner">
          <span className="text-lg font-bold text-slate-900">{total.toLocaleString()}</span>
          <span className="text-[10px] text-slate-500">total</span>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:block">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-slate-700">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label} ({s.pct}%)
          </li>
        ))}
      </ul>
    </div>
  )
}

const quickActions = [
  { label: 'Create Event', to: '/admin/events', icon: CalendarDays },
  { label: 'Manage Registrations', to: '/admin/registrations', icon: ClipboardList },
  { label: 'View Payments', to: '/admin/payments', icon: CreditCard },
  { label: 'QR Code Race Kit', to: '/admin/qr-code-race-kit', icon: QrCode },
  { label: 'Upload Results', to: '/admin/results', icon: Upload },
  { label: 'Create Announcement', to: '/admin/announcements', icon: Megaphone },
  { label: 'View Reports', to: '/admin/reports', icon: FileBarChart },
  { label: 'System Settings', to: '/admin/settings', icon: Settings },
] as const

function initialsFromEmail(email: string) {
  const local = email.split('@')[0] ?? '?'
  return local.slice(0, 2).toUpperCase()
}

function riderDisplayName(row: AdminRegistrationRow) {
  const name = row.rider_full_name?.trim()
  if (name) return name
  return row.registrant_email?.trim() ?? '—'
}

function riderAvatarInitials(row: AdminRegistrationRow) {
  const name = row.rider_full_name?.trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }
  if (row.registrant_email) return initialsFromEmail(row.registrant_email)
  return '—'
}

function statusPill(status: string) {
  const s = status.toLowerCase()
  if (s === 'paid') return 'bg-emerald-100 text-emerald-800'
  if (s === 'pending' || s === 'pending_payment') return 'bg-amber-100 text-amber-800'
  if (s === 'failed') return 'bg-rose-100 text-rose-800'
  return 'bg-slate-100 text-slate-700'
}

export function AdminDashboard() {
  const [rows, setRows] = useState<AdminRegistrationRow[]>([])
  const [events, setEvents] = useState<
    Array<{
      id: string
      title: string | null
      event_date: string | null
      status: string | null
      rider_limit: number | null
      poster_url: string | null
      banner_url: string | null
    }>
  >([])
  const [announcements, setAnnouncements] = useState<Array<{ id: string; title: string | null; excerpt: string | null; published_at: string | null; updated_at: string | null; is_published: boolean | null }>>([])
  const [paidOrders, setPaidOrders] = useState<Array<{ amount: number | null; created_at: string | null }>>([])
  const [registrationCountByEvent, setRegistrationCountByEvent] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    void (async () => {
      try {
        const registrations = await adminApi.registrationsList()
        const [eventsResult, announcementsResult, paidOrdersResult, registrationFormsResult] = await Promise.all([
          supabase
            .from('events')
            .select('id, title, event_date, status, rider_limit, poster_url, banner_url')
            .order('event_date', { ascending: true })
            .limit(100),
          supabase.from('announcements').select('id, title, excerpt, published_at, updated_at, is_published').order('updated_at', { ascending: false }).limit(5),
          supabase.from('payment_orders').select('amount, created_at, status').eq('status', 'paid').order('created_at', { ascending: false }).limit(500),
          supabase.from('registration_forms').select('event_id').limit(5000),
        ])

        if (eventsResult.error) throw eventsResult.error
        if (paidOrdersResult.error) throw paidOrdersResult.error
        if (registrationFormsResult.error) throw registrationFormsResult.error
        if (announcementsResult.error) {
          console.warn('Announcements unavailable:', announcementsResult.error.message)
        }

        const eventCounts = new Map<string, number>()
        for (const form of registrationFormsResult.data ?? []) {
          const eventId = String(form.event_id ?? '').trim()
          if (!eventId) continue
          eventCounts.set(eventId, (eventCounts.get(eventId) ?? 0) + 1)
        }

        if (!active) return
        setRows(registrations)
        setEvents(
          (eventsResult.data ?? []) as Array<{
            id: string
            title: string | null
            event_date: string | null
            status: string | null
            rider_limit: number | null
            poster_url: string | null
            banner_url: string | null
          }>,
        )
        setAnnouncements((announcementsResult.data ?? []) as Array<{ id: string; title: string | null; excerpt: string | null; published_at: string | null; updated_at: string | null; is_published: boolean | null }>)
        setPaidOrders((paidOrdersResult.data ?? []) as Array<{ amount: number | null; created_at: string | null }>)
        setRegistrationCountByEvent(eventCounts)
      } catch (e) {
        if (!active) return
        setError((e as Error).message || 'Failed to load admin data.')
      } finally {
        if (!active) return
        setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const monthlyRegistrationSeries = useMemo(() => {
    const now = new Date()
    const keys: string[] = []
    const labels: string[] = []
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      labels.push(d.toLocaleString('en-PH', { month: 'short', year: '2-digit' }))
    }
    const byMonth = new Map<string, number>(keys.map((k) => [k, 0]))
    for (const row of rows) {
      if (!row.created_at) continue
      const d = new Date(row.created_at)
      if (Number.isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) ?? 0) + 1)
    }
    return { labels, data: keys.map((k) => byMonth.get(k) ?? 0) }
  }, [rows])

  const monthlyRevenueSeries = useMemo(() => {
    const now = new Date()
    const keys: string[] = []
    const labels: string[] = []
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      labels.push(d.toLocaleString('en-PH', { month: 'short', year: '2-digit' }))
    }
    const byMonth = new Map<string, number>(keys.map((k) => [k, 0]))
    for (const order of paidOrders) {
      if (!order.created_at) continue
      const d = new Date(order.created_at)
      if (Number.isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) ?? 0) + Number(order.amount ?? 0))
    }
    return { labels, data: keys.map((k) => byMonth.get(k) ?? 0) }
  }, [paidOrders])

  const eventParticipationSeries = useMemo(() => {
    const slice = events.slice(0, 12)
    const labels = slice.map((e) => {
      const t = (e.title ?? 'Event').trim() || 'Event'
      return t.length > 14 ? `${t.slice(0, 14)}…` : t
    })
    const usePercentScale = slice.length > 0 && slice.every((e) => Number(e.rider_limit ?? 0) > 0)
    const data = slice.map((event) => {
      const total = registrationCountByEvent.get(event.id) ?? 0
      const limit = Number(event.rider_limit ?? 0)
      if (limit > 0) return Math.round(Math.max(0, Math.min(100, (total / limit) * 100)))
      return total
    })
    return { labels, data, usePercentScale }
  }, [events, registrationCountByEvent])

  const categorySegments = useMemo(() => {
    const byDiscipline = new Map<string, number>()
    for (const row of rows) {
      const key = String(row.discipline ?? 'Unspecified').trim() || 'Unspecified'
      byDiscipline.set(key, (byDiscipline.get(key) ?? 0) + 1)
    }
    const sorted = Array.from(byDiscipline.entries()).sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 5)
    const remainder = sorted.slice(5).reduce((sum, [, count]) => sum + count, 0)
    if (remainder > 0) top.push(['Other', remainder])
    const total = top.reduce((sum, [, count]) => sum + count, 0)
    const colors = ['#1e4a8e', '#0d9488', '#d97706', '#7c3aed', '#64748b', '#ef4444']
    return {
      total,
      segments: top.map(([label, count], idx) => ({
        label,
        pct: total > 0 ? Math.round((count / total) * 100) : 0,
        color: colors[idx % colors.length],
      })),
    }
  }, [rows])

  const stats = useMemo(() => {
    const totalRegs = rows.length
    const paid = rows.filter((r) => String(r.payment_status ?? '').toLowerCase() === 'paid').length
    const uniqueEmails = new Set(rows.map((r) => r.registrant_email).filter(Boolean)).size
    const activeEvents = events.filter((event) => String(event.status ?? '').toLowerCase() === 'published').length
    const completedEvents = events.filter((event) => String(event.status ?? '').toLowerCase() === 'completed').length
    const revenue = paidOrders.reduce((sum, order) => sum + Number(order.amount ?? 0), 0)
    return {
      totalRegs,
      paid,
      cyclists: uniqueEmails || totalRegs,
      activeEvents,
      completedEvents,
      revenue,
    }
  }, [rows, events, paidOrders])

  const recent = rows.slice(0, 5)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Total Cyclists"
          value={stats.cyclists.toLocaleString()}
          trend={`${stats.cyclists.toLocaleString()} unique riders`}
          icon={Users}
          iconBg="bg-blue-600"
        />
        <StatCard
          label="Total Registrations"
          value={stats.totalRegs.toLocaleString()}
          trend="Latest registrations snapshot"
          icon={ClipboardList}
          iconBg="bg-emerald-600"
        />
        <StatCard
          label="Active Events"
          value={String(stats.activeEvents)}
          trend="Published events"
          icon={CalendarDays}
          iconBg="bg-violet-600"
        />
        <StatCard
          label="Completed Events"
          value={String(stats.completedEvents)}
          trend="Marked as completed"
          icon={Trophy}
          iconBg="bg-orange-500"
        />
        <StatCard
          label="Paid Registrations"
          value={stats.paid.toLocaleString()}
          trend="Successful payment status"
          icon={CreditCard}
          iconBg="bg-teal-600"
        />
        <StatCard
          label="Revenue Summary"
          value={`₱${stats.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`}
          trend="From paid payment orders"
          icon={Bike}
          iconBg="bg-lime-600"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <ChartPlaceholder title="Monthly Registrations">
          <MonthlyRegistrationsChartJs labels={monthlyRegistrationSeries.labels} data={monthlyRegistrationSeries.data} />
        </ChartPlaceholder>
        <ChartPlaceholder title="Revenue Analytics">
          <RevenueChartJs labels={monthlyRevenueSeries.labels} data={monthlyRevenueSeries.data} />
        </ChartPlaceholder>
        <ChartPlaceholder title="Event Participation Trends">
          <EventParticipationBarChartJs
            labels={eventParticipationSeries.labels}
            data={eventParticipationSeries.data}
            usePercentScale={eventParticipationSeries.usePercentScale}
          />
        </ChartPlaceholder>
        <ChartPlaceholder title="Category Participation">
          <DonutCategory segments={categorySegments.segments} total={categorySegments.total} />
        </ChartPlaceholder>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm xl:col-span-1">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Recent Registrations</h3>
            <Link to="/admin/registrations" className="text-xs font-medium text-[#1e4a8e] hover:underline">
              View all
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Rider</th>
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : null}
                {error ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-rose-600">
                      {error}
                    </td>
                  </tr>
                ) : null}
                {!loading &&
                  recent.map((r) => (
                    <tr key={r.id} className="text-slate-800">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                            {riderAvatarInitials(r)}
                          </span>
                          <span className="max-w-[140px] truncate text-xs sm:text-sm" title={riderDisplayName(r)}>
                            {riderDisplayName(r)}
                          </span>
                        </div>
                      </td>
                      <td className="max-w-[100px] truncate px-4 py-3 text-xs sm:text-sm">
                        {r.event_title ?? r.race_type ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusPill(String(r.payment_status ?? 'pending'))}`}
                        >
                          {String(r.payment_status ?? 'pending')}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                {!loading && !error && recent.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                      No registrations yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Upcoming Events</h3>
            <Link to="/admin/events" className="text-xs font-medium text-[#1e4a8e] hover:underline">
              Manage
            </Link>
          </div>
          <ul className="divide-y divide-slate-100 p-2">
            {events.slice(0, 5).map((ev) => {
              const registered = registrationCountByEvent.get(ev.id) ?? 0
              const cap = Number(ev.rider_limit ?? 0)
              const posterSrc = (ev.poster_url ?? ev.banner_url)?.trim() || '/bg2.png'
              return (
              <li key={ev.id} className="flex gap-3 rounded-lg p-2 hover:bg-slate-50">
                <img
                  src={posterSrc}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-lg object-cover bg-slate-200"
                  onError={(e) => {
                    e.currentTarget.src = '/bg2.png'
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{ev.title ?? 'Untitled event'}</p>
                  <p className="text-xs text-slate-500">{ev.event_date ? new Date(ev.event_date).toLocaleDateString() : 'TBA'}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Registration: {cap > 0 ? `${registered} / ${cap}` : `${registered} total`}
                  </p>
                </div>
                <span
                  className={`h-fit shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    String(ev.status ?? '').toLowerCase() === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                  }`}
                >
                  {String(ev.status ?? '').toLowerCase() === 'published' ? 'Published' : 'Draft'}
                </span>
              </li>
            )})}
            {!loading && events.length === 0 ? (
              <li className="px-3 py-4 text-xs text-slate-500">No events found.</li>
            ) : null}
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Latest Announcements</h3>
            <Link to="/admin/announcements" className="text-xs font-medium text-[#1e4a8e] hover:underline">
              New
            </Link>
          </div>
          <ul className="divide-y divide-slate-100 p-2">
            {announcements.map((a) => (
              <li key={a.id} className="flex gap-3 rounded-lg p-2 hover:bg-slate-50">
                <div className="h-12 w-12 shrink-0 rounded-lg bg-[#cfae3f]/30" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{a.title ?? 'Untitled announcement'}</p>
                  <p className="line-clamp-2 text-xs text-slate-600">{a.excerpt ?? 'No summary available.'}</p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {a.published_at || a.updated_at ? new Date(a.published_at ?? a.updated_at ?? '').toLocaleDateString() : 'Draft'}
                  </p>
                </div>
              </li>
            ))}
            {!loading && announcements.length === 0 ? (
              <li className="px-3 py-4 text-xs text-slate-500">No announcements found.</li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h3 className="text-sm font-semibold text-slate-900">Quick Actions</h3>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {quickActions.map(({ label, to, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-4 text-center text-xs font-medium text-slate-800 transition hover:border-[#1e4a8e]/40 hover:bg-slate-50"
            >
              <Icon className="h-5 w-5 text-[#1e4a8e]" strokeWidth={2} />
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
