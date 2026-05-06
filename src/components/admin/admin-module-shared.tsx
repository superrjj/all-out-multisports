import { useEffect, useState } from 'react'

export type TableRow = Record<string, unknown>

export function formatDate(value: unknown) {
  if (!value) return '—'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-PH', { 
    year: 'numeric', month: 'short', day: 'numeric',
    timeZone: 'Asia/Manila'
  })
}

/** Date and time for admin tables (e.g. QR scan history). */
export function formatDateTime(value: unknown) {
  if (!value) return '—'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  })
}

export function formatMoney(value: unknown) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(value ?? 0))
}

export function formatDuration(ms: unknown) {
  const totalMs = Number(ms ?? 0)
  if (!Number.isFinite(totalMs) || totalMs <= 0) return '—'
  const totalSeconds = Math.floor(totalMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

export function EmptyState({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">{text}</p>
}

export function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}

export function StatGrid({ items }: { items: Array<{ label: string; value: string | number }> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{item.value}</p>
        </div>
      ))}
    </div>
  )
}

export function DataTable({
  columns,
  rows,
}: {
  columns: Array<{ key: string; label: string; render?: (row: TableRow) => React.ReactNode }>
  rows: TableRow[]
}) {
  if (rows.length === 0) return <EmptyState text="No records found yet for this module." />
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className="px-3 py-2 text-left font-semibold text-slate-600">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {columns.map((column) => (
                <td key={column.key} className="px-3 py-2 text-slate-700">
                  {column.render ? column.render(row) : String(row[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function useModuleLoader<T>(loader: () => Promise<T>, deps: React.DependencyList) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    void loader()
      .then((result) => {
        if (!active) return
        setData(result)
      })
      .catch((e) => {
        if (!active) return
        setError((e as Error).message || 'Failed to load module data.')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, deps)

  return { data, loading, error }
}

export function ModuleShell({
  loading,
  error,
  children,
}: {
  loading: boolean
  error: string | null
  children: React.ReactNode
}) {
  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-72 rounded bg-slate-100" />
        </section>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="h-3 w-24 rounded bg-slate-200" />
              <div className="mt-3 h-7 w-16 rounded bg-slate-100" />
            </div>
          ))}
        </div>
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-10 w-full rounded-lg bg-slate-100" />
          <div className="mt-3 space-y-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-16 rounded-lg border border-slate-100 bg-slate-50" />
            ))}
          </div>
        </section>
      </div>
    )
  }
  if (error) return <EmptyState text={error} />
  return <div className="space-y-6">{children}</div>
}
