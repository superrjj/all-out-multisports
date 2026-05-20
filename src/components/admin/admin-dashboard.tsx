import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Doughnut, Line } from 'react-chartjs-2'
import {
  Bike,
  Check,
  ChevronDown,
  Download,
  Hourglass,
  Info,
  Shirt,
  UserRound,
  Users,
} from 'lucide-react'
import { adminApi, type AdminRegistrationRow } from '../../services/adminApi'
import { supabase } from '../../lib/supabase'

ChartJS.register(ArcElement, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

const SHIRT_SIZES = ['XS', 'Small', 'Medium', 'Large', 'XL'] as const

const SHIRT_PANELS = [
  {
    key: 'criterium' as const,
    title: 'FINISHER SHIRT (CRITERIUM)',
    theme: 'purple' as const,
  },
  {
    key: 'itt' as const,
    title: 'FINISHER SHIRT (INDIVIDUAL TIME TRIAL)',
    theme: 'blue' as const,
  },
]

type ShirtPanelKey = (typeof SHIRT_PANELS)[number]['key']
type TimeRange = '7d' | '30d' | '12m'

function normalizeShirtSize(raw: string | null | undefined): (typeof SHIRT_SIZES)[number] | null {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return null
  if (s === 'extra small' || s === 'xs' || s === 'x-small') return 'XS'
  if (s === 'small' || s === 's') return 'Small'
  if (s === 'medium' || s === 'm') return 'Medium'
  if (s === 'large' || s === 'l') return 'Large'
  if (s === 'extra large' || s === 'xl' || s === 'x-large') return 'XL'
  return null
}

function shirtPanelKey(row: AdminRegistrationRow): ShirtPanelKey | null {
  const slug = String(row.entry_event_type_slug ?? '').toLowerCase()
  const label = String(row.entry_event_type_label ?? '').toLowerCase()
  const blob = `${slug} ${label}`
  if (blob.includes('criterium')) return 'criterium'
  if (blob.includes('itt') || blob.includes('individual-time-trial') || blob.includes('time trial')) return 'itt'
  return null
}

function isPaid(row: AdminRegistrationRow) {
  return String(row.payment_status ?? '').toLowerCase() === 'paid'
}

function isPending(row: AdminRegistrationRow) {
  const s = String(row.payment_status ?? '').toLowerCase()
  return s === 'pending' || s === 'pending_payment' || s === 'processing'
}

function pct(part: number, total: number) {
  if (total <= 0) return 0
  return Math.round((part / total) * 100)
}

type FinisherShirtCounts = {
  panels: Record<ShirtPanelKey, Record<(typeof SHIRT_SIZES)[number], number>>
  totals: Record<ShirtPanelKey, number>
}

function escapeSpreadsheetXml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function finisherShirtSpreadsheetRow(
  cells: (string | number)[],
  styleId: 'Header' | 'Default' | 'Total',
  height: number,
): string {
  const cellXml = cells
    .map((value) => {
      if (typeof value === 'number') {
        return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`
      }
      return `<Cell><Data ss:Type="String">${escapeSpreadsheetXml(value)}</Data></Cell>`
    })
    .join('')
  return `<Row ss:StyleID="${styleId}" ss:Height="${height}">${cellXml}</Row>`
}

function buildFinisherShirtSpreadsheetMl(shirtCounts: FinisherShirtCounts): string {
  const rowParts: string[] = [
    finisherShirtSpreadsheetRow(['Event Type', 'Size', 'Count'], 'Header', 22),
  ]

  SHIRT_PANELS.forEach((panel, panelIndex) => {
    if (panelIndex > 0) {
      rowParts.push('<Row ss:Height="14"/>')
    }
    for (const size of SHIRT_SIZES) {
      rowParts.push(
        finisherShirtSpreadsheetRow(
          [panel.title, size, shirtCounts.panels[panel.key][size]],
          'Default',
          18,
        ),
      )
    }
    rowParts.push(
      finisherShirtSpreadsheetRow(
        [panel.title, 'TOTAL', shirtCounts.totals[panel.key]],
        'Total',
        18,
      ),
    )
  })

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Header">
   <Font ss:Bold="1" ss:Size="11"/>
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Default">
   <Font ss:Size="11"/>
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="Total">
   <Font ss:Bold="1" ss:Size="11"/>
   <Alignment ss:Vertical="Center"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Finisher Shirt Status">
  <Table>
   <Column ss:Index="1" ss:Width="240"/>
   <Column ss:Index="2" ss:Width="72"/>
   <Column ss:Index="3" ss:Width="56"/>
   ${rowParts.join('\n   ')}
  </Table>
 </Worksheet>
</Workbook>`
}

function downloadFinisherShirtStatus(shirtCounts: FinisherShirtCounts) {
  const xml = buildFinisherShirtSpreadsheetMl(shirtCounts)
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'finisher-shirt-status.xls'
  a.click()
  URL.revokeObjectURL(url)
}

function Shimmer({ className }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-md bg-slate-200/80 ${className ?? ''}`}>
      <div
        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/70 to-transparent"
        style={{
          animation: 'admin-dashboard-shimmer 2s ease-in-out infinite',
          transform: 'translateX(-100%)',
          backgroundSize: '200% 100%',
        }}
      />
    </div>
  )
}

function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <Shimmer className="mb-4 h-10 w-10 rounded-full" />
      <Shimmer className="mb-2 h-3 w-28" />
      <Shimmer className="mb-3 h-8 w-16" />
      <Shimmer className="h-3 w-36" />
    </div>
  )
}

function ShirtPanelSkeleton({ theme }: { theme: 'purple' | 'blue' }) {
  const footerBg = theme === 'purple' ? 'bg-violet-50' : 'bg-sky-50'
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Shimmer className="h-4 w-4 rounded" />
        <Shimmer className="h-3.5 w-44 max-w-full" />
      </div>
      <ul className="flex-1 divide-y divide-slate-100 px-4 py-1">
        {SHIRT_SIZES.map((size) => (
          <li key={size} className="flex items-center justify-between py-2.5">
            <Shimmer className="h-4 w-14" />
            <Shimmer className="h-4 w-8" />
          </li>
        ))}
      </ul>
      <div className={`flex items-center justify-between px-4 py-3.5 ${footerBg}`}>
        <div className="space-y-2">
          <Shimmer className="h-4 w-20" />
          <Shimmer className="h-9 w-16" />
        </div>
        <Shimmer className="h-10 w-10 rounded-lg" />
      </div>
    </div>
  )
}

function FinisherShirtSectionSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm xl:col-span-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Shimmer className="h-5 w-56 max-w-full" />
          <Shimmer className="h-4 w-72 max-w-full" />
        </div>
        <Shimmer className="h-9 w-24 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ShirtPanelSkeleton theme="purple" />
        <ShirtPanelSkeleton theme="blue" />
      </div>
      <Shimmer className="mt-4 h-12 w-full rounded-xl" />
    </div>
  )
}

function GoblinCardSkeleton() {
  return (
    <div className="h-full min-h-[280px] overflow-hidden rounded-2xl border border-amber-100 bg-[#fff9eb] shadow-sm">
      <Shimmer className="h-full min-h-[280px] w-full rounded-2xl" />
    </div>
  )
}

function LineChartCardSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Shimmer className="h-5 w-44" />
        <Shimmer className="h-9 w-28 rounded-lg" />
      </div>
      <Shimmer className="h-56 w-full rounded-lg" />
    </div>
  )
}

function DonutChartCardSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Shimmer className="h-5 w-44" />
        <Shimmer className="h-9 w-32 rounded-lg" />
      </div>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <Shimmer className="mx-auto h-44 w-44 shrink-0 rounded-full" />
        <ul className="min-w-0 w-full flex-1 space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <Shimmer className="h-4 max-w-[200px] flex-1" />
              <Shimmer className="h-4 w-16 shrink-0" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  icon,
  iconWrap,
  footerTo,
  footerLabel,
  badge,
  extraIcon,
}: {
  title: string
  value: string
  icon: React.ReactNode
  iconWrap: string
  footerTo: string
  footerLabel: string
  badge?: { text: string; className: string }
  extraIcon?: React.ReactNode
}) {
  return (
    <div className="relative rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      {badge ? (
        <span className={`absolute right-4 top-4 rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}>
          {badge.text}
        </span>
      ) : null}
      {extraIcon ? <div className="absolute right-4 top-4 text-violet-400">{extraIcon}</div> : null}
      <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-full ${iconWrap}`}>{icon}</div>
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      <Link to={footerTo} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-[#1e4a8e]">
        {footerLabel}
        <span aria-hidden>→</span>
      </Link>
    </div>
  )
}

function ShirtPanel({
  title,
  theme,
  counts,
  total,
  loading,
}: {
  title: string
  theme: 'purple' | 'blue'
  counts: Record<(typeof SHIRT_SIZES)[number], number>
  total: number
  loading: boolean
}) {
  const isPurple = theme === 'purple'
  const headerIcon = isPurple ? 'text-violet-500' : 'text-sky-500'
  const footerBg = isPurple ? 'bg-violet-50' : 'bg-sky-50'
  const footerText = isPurple ? 'text-violet-700' : 'text-sky-700'
  const footerIcon = isPurple ? 'text-violet-400' : 'text-sky-400'

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Shirt className={`h-4 w-4 ${headerIcon}`} strokeWidth={2} />
        <p className="text-xs font-bold tracking-wide text-slate-800">{title}</p>
      </div>
      <ul className="flex-1 divide-y divide-slate-100 px-4 py-1">
        {SHIRT_SIZES.map((size) => (
          <li key={size} className="flex items-center justify-between py-2.5 text-sm">
            <span className="font-medium text-slate-700">{size}</span>
            <span className="tabular-nums font-semibold text-slate-900">
              {loading ? '—' : counts[size].toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
      <div className={`flex items-center justify-between px-4 py-3 ${footerBg}`}>
        <div>
          <p className="text-sm font-medium text-slate-600">Total shirts</p>
          <p className={`mt-0.5 text-3xl font-semibold tabular-nums tracking-tight ${footerText}`}>
            {loading ? '—' : total.toLocaleString()}
          </p>
        </div>
        <Shirt className={`h-10 w-10 ${footerIcon}`} strokeWidth={1.5} />
      </div>
    </div>
  )
}

function WarehouseGoblinCard() {
  return (
    <div className="h-full min-h-[280px] overflow-hidden rounded-2xl border border-amber-100 bg-[#fff9eb] shadow-sm">
      <img src="/goblin-tshirt.png" alt="" className="h-full w-full object-cover object-center" />
    </div>
  )
}

export function AdminDashboard() {
  const [rows, setRows] = useState<AdminRegistrationRow[]>([])
  const [eventCount, setEventCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState<TimeRange>('7d')
  const [eventFilter, setEventFilter] = useState('all')

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [registrations, eventsResult] = await Promise.all([
          adminApi.registrationsList(),
          supabase.from('events').select('id', { count: 'exact', head: true }),
        ])
        if (!active) return
        setRows(registrations)
        setEventCount(eventsResult.count ?? 0)
      } catch {
        if (!active) return
        setRows([])
        setEventCount(0)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const paidRows = useMemo(() => rows.filter(isPaid), [rows])

  const stats = useMemo(() => {
    const total = rows.length
    const paid = paidRows.length
    const pending = rows.filter(isPending).length
    return { total, paid, pending }
  }, [rows, paidRows])

  const shirtCounts = useMemo(() => {
    const empty = () =>
      SHIRT_SIZES.reduce(
        (acc, size) => {
          acc[size] = 0
          return acc
        },
        {} as Record<(typeof SHIRT_SIZES)[number], number>,
      )

    const panels: Record<ShirtPanelKey, Record<(typeof SHIRT_SIZES)[number], number>> = {
      criterium: empty(),
      itt: empty(),
    }

    for (const row of paidRows) {
      const panel = shirtPanelKey(row)
      const size = normalizeShirtSize(row.jersey_size)
      if (!panel || !size) continue
      panels[panel][size] += 1
    }

    const totals: Record<ShirtPanelKey, number> = {
      criterium: Object.values(panels.criterium).reduce((a, b) => a + b, 0),
      itt: Object.values(panels.itt).reduce((a, b) => a + b, 0),
    }

    return { panels, totals }
  }, [paidRows])

  const registrationsOverTime = useMemo(() => {
    const now = new Date()
    const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 365
    const labels: string[] = []
    const keys: string[] = []
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      keys.push(d.toISOString().slice(0, 10))
      labels.push(
        d.toLocaleDateString('en-PH', {
          month: 'short',
          day: 'numeric',
          ...(timeRange === '12m' ? { year: '2-digit' } : {}),
        }),
      )
    }
    const byDay = new Map(keys.map((k) => [k, 0]))
    for (const row of rows) {
      if (!row.created_at) continue
      const key = row.created_at.slice(0, 10)
      if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + 1)
    }
    if (timeRange === '12m') {
      const byMonth = new Map<string, number>()
      const monthLabels: string[] = []
      for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        byMonth.set(k, 0)
        monthLabels.push(d.toLocaleString('en-PH', { month: 'short', year: '2-digit' }))
      }
      for (const row of rows) {
        if (!row.created_at) continue
        const d = new Date(row.created_at)
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        if (byMonth.has(k)) byMonth.set(k, (byMonth.get(k) ?? 0) + 1)
      }
      return {
        labels: monthLabels,
        data: Array.from(byMonth.values()),
      }
    }
    return { labels, data: keys.map((k) => byDay.get(k) ?? 0) }
  }, [rows, timeRange])

  const registrationsByEvent = useMemo(() => {
    const byEvent = new Map<string, number>()
    for (const row of rows) {
      const title = String(row.event_title ?? 'Unknown event').trim() || 'Unknown event'
      byEvent.set(title, (byEvent.get(title) ?? 0) + 1)
    }
    const sorted = Array.from(byEvent.entries()).sort((a, b) => b[1] - a[1])
    const filtered =
      eventFilter === 'all' ? sorted : sorted.filter(([name]) => name === eventFilter)
    const total = filtered.reduce((sum, [, n]) => sum + n, 0)
    const colors = ['#0ea5e9', '#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#64748b']
    return {
      total,
      items: filtered.map(([label, count], idx) => ({
        label,
        count,
        pct: total > 0 ? Math.round((count / total) * 100) : 0,
        color: colors[idx % colors.length],
      })),
    }
  }, [rows, eventFilter])

  const eventOptions = useMemo(() => {
    const names = new Set<string>()
    for (const row of rows) {
      const t = String(row.event_title ?? '').trim()
      if (t) names.add(t)
    }
    return ['all', ...Array.from(names).sort((a, b) => a.localeCompare(b))]
  }, [rows])

  const lineChartData = useMemo(
    () => ({
      labels: registrationsOverTime.labels,
      datasets: [
        {
          label: 'Registrations',
          data: registrationsOverTime.data,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointBackgroundColor: '#2563eb',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
        },
      ],
    }),
    [registrationsOverTime],
  )

  const donutChartData = useMemo(
    () => ({
      labels: registrationsByEvent.items.map((i) => i.label),
      datasets: [
        {
          data: registrationsByEvent.items.map((i) => i.count),
          backgroundColor: registrationsByEvent.items.map((i) => i.color),
          borderWidth: 0,
        },
      ],
    }),
    [registrationsByEvent],
  )

  const handleExportShirts = () => {
    downloadFinisherShirtStatus(shirtCounts)
  }

  return (
    <>
      <style>{`
        @keyframes admin-dashboard-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
      <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
        ) : (
          <>
            <StatCard
              title="Total Registrations"
              value={stats.total.toLocaleString()}
              icon={<UserRound className="h-5 w-5 text-emerald-600" strokeWidth={2} />}
              iconWrap="bg-emerald-50 ring-1 ring-emerald-100"
              footerTo="/admin/registrations"
              footerLabel="View all registrations"
              extraIcon={<Users className="h-5 w-5" />}
            />
            <StatCard
              title="Paid"
              value={stats.paid.toLocaleString()}
              icon={<Check className="h-5 w-5 text-emerald-600" strokeWidth={2.5} />}
              iconWrap="bg-emerald-50 ring-1 ring-emerald-100"
              footerTo="/admin/registrations"
              footerLabel="View all paid"
              badge={{
                text: `${pct(stats.paid, stats.total)}%`,
                className: 'bg-emerald-100 text-emerald-800',
              }}
            />
            <StatCard
              title="Unpaid / Pending"
              value={stats.pending.toLocaleString()}
              icon={<Hourglass className="h-5 w-5 text-amber-600" strokeWidth={2} />}
              iconWrap="bg-amber-50 ring-1 ring-amber-100"
              footerTo="/admin/registrations"
              footerLabel="View all pending"
              badge={{
                text: `${pct(stats.pending, stats.total)}%`,
                className: 'bg-slate-100 text-slate-600',
              }}
            />
            <StatCard
              title="Total Events"
              value={eventCount.toLocaleString()}
              icon={<Bike className="h-5 w-5 text-sky-600" strokeWidth={2} />}
              iconWrap="bg-sky-50 ring-1 ring-sky-100"
              footerTo="/admin/events"
              footerLabel="View all events"
            />
          </>
        )}
      </div>

      {/* Finisher shirt + goblin */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {loading ? (
          <>
            <FinisherShirtSectionSkeleton />
            <div className="xl:col-span-4">
              <GoblinCardSkeleton />
            </div>
          </>
        ) : (
          <>
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm xl:col-span-8">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Shirt className="h-5 w-5 text-slate-700" strokeWidth={2} />
                <h2 className="text-sm font-bold tracking-wide text-slate-900">FINISHER SHIRT STATUS</h2>
              </div>
              <p className="mt-1 text-sm text-slate-500">Paid registrations only — shirt sizes per discipline</p>
            </div>
            <button
              type="button"
              onClick={handleExportShirts}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {SHIRT_PANELS.map((panel) => (
              <ShirtPanel
                key={panel.key}
                title={panel.title}
                theme={panel.theme}
                counts={shirtCounts.panels[panel.key]}
                total={shirtCounts.totals[panel.key]}
                loading={loading}
              />
            ))}
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
            <p>Paid registrations only. Counts update as new payments are confirmed.</p>
          </div>
        </div>

        <div className="xl:col-span-4">
          <WarehouseGoblinCard />
        </div>
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {loading ? (
          <>
            <LineChartCardSkeleton />
            <DonutChartCardSkeleton />
          </>
        ) : (
          <>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">Registrations Over Time</h3>
            <div className="relative">
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value as TimeRange)}
                className="appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="12m">Last 12 months</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
          <div className="h-56">
            {loading ? (
              <Shimmer className="h-full w-full rounded-lg" />
            ) : (
              <Line
                data={lineChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                  },
                }}
              />
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">Registrations by Event</h3>
            <div className="relative">
              <select
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="max-w-[220px] appearance-none truncate rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">All Events</option>
                {eventOptions
                  .filter((v) => v !== 'all')
                  .map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="h-44 w-44 shrink-0">
              {loading || registrationsByEvent.items.length === 0 ? (
                <Shimmer className="mx-auto h-44 w-44 rounded-full" />
              ) : (
                <Doughnut
                  data={donutChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '62%',
                    plugins: { legend: { display: false } },
                  }}
                />
              )}
            </div>
            <ul className="min-w-0 flex-1 space-y-2 text-sm">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => <Shimmer key={i} className="h-4 w-full" />)
              ) : registrationsByEvent.items.length === 0 ? (
                <li className="text-slate-500">No registrations yet.</li>
              ) : (
                registrationsByEvent.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="truncate text-slate-700" title={item.label}>
                        {item.label}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums font-medium text-slate-900">
                      {item.count} ({item.pct}%)
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
          </>
        )}
      </div>
    </div>
  
    </>
  )
}