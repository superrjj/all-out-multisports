import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Loader2, Search, X } from 'lucide-react'
import { publicRiderSearchApi, type PublicRiderSearchRow } from '../../services/publicRiderSearchApi'
import { normalizeRiderSearchQuery, sanitizeRiderSearchDisplay } from '../../utils/riderSearchSecurity'

const navy = '#0c2340'

export function RiderSearchSection() {
  const location = useLocation()
  const sectionRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [results, setResults] = useState<PublicRiderSearchRow[]>([])
  const [showResultsPanel, setShowResultsPanel] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (location.hash !== '#rider-search') return
    const scrollAndFocus = () => {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      inputRef.current?.focus({ preventScroll: true })
    }
    const id0 = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(scrollAndFocus)
    })
    const id1 = window.setTimeout(scrollAndFocus, 160)
    return () => {
      window.cancelAnimationFrame(id0)
      window.clearTimeout(id1)
    }
  }, [location.hash, location.pathname])

  const runSearch = useCallback(async () => {
    const q = normalizeRiderSearchQuery(query)
    setQuery(q)
    setSubmittedQuery(q)
    setError(null)
    if (q.length < 2) {
      setShowResultsPanel(false)
      setResults([])
      setError('Enter at least 2 characters to search.')
      return
    }
    setShowResultsPanel(true)
    setLoading(true)
    try {
      const rows = await publicRiderSearchApi.searchByName(q)
      setResults(rows)
    } catch (e) {
      setError(sanitizeRiderSearchDisplay((e as Error).message || 'Search failed.', 400))
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [query])

  const count = results.length
  const countLabel = count === 1 ? '1 match' : `${count} matches`

  return (
    <section
      ref={sectionRef}
      id="rider-search"
      className="scroll-mt-24 bg-slate-50 px-4 py-14 sm:px-6 lg:px-8 lg:py-20"
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-8 max-w-xl">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Participant lookup</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-[1.65rem]">
            Search riders
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Only confirmed registrations are shown. Please search using the rider’s registered name.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:gap-3">
            <label className="block min-w-0 flex-1">
              <span className="mb-1.5 block text-xs font-medium text-slate-600">Name</span>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => {
                    const val = normalizeRiderSearchQuery(e.target.value)
                    setQuery(val)
                    if (val === '') {
                      setResults([])
                      setSubmittedQuery('')
                      setShowResultsPanel(false)
                      setError(null)
                    }
                  }}
                  maxLength={100}
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runSearch()
                  }}
                  inputMode="search"
                  placeholder="e.g. Juan dela Cruz"
                  className="h-12 w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                  autoComplete="off"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setResults([])
                      setSubmittedQuery('')
                      setShowResultsPanel(false)
                      setError(null)
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                ) : null}
              </div>
            </label>
            <div className="flex shrink-0 flex-col justify-end sm:w-auto">
              <span className="mb-1.5 hidden text-xs font-medium text-transparent sm:block" aria-hidden>
                &nbsp;
              </span>
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={loading}
                className="inline-flex h-12 min-w-[7.5rem] items-center justify-center gap-2 rounded-lg px-6 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
                style={{ backgroundColor: navy }}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4 opacity-90" aria-hidden />}
                Search
              </button>
            </div>
          </div>
        </div>

        {error && !showResultsPanel ? (
          <p className="mt-4 text-center text-sm text-rose-600" role="alert">
            {sanitizeRiderSearchDisplay(error, 400)}
          </p>
        ) : null}

        {showResultsPanel && submittedQuery.length >= 2 ? (
          <div className="mt-10">
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-slate-200 pb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Results</h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  Query:{' '}
                  <span className="font-medium text-slate-700">
                    &ldquo;{sanitizeRiderSearchDisplay(submittedQuery, 100)}&rdquo;
                  </span>
                </p>
              </div>
              <span className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 tabular-nums">
                {error ? '—' : countLabel}
              </span>
            </div>

            {error ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
                {sanitizeRiderSearchDisplay(error, 400)}
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70">
                        <th className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          Rider name
                        </th>
                        <th className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          Bib
                        </th>
                        <th className="hidden whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600 sm:table-cell">
                          Event type
                        </th>
                        <th className="hidden whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600 md:table-cell">
                          Discipline
                        </th>
                        <th className="whitespace-nowrap px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                          Category
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loading ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                            <span className="inline-flex items-center gap-2.5">
                              <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden />
                              <span className="text-sm">Searching…</span>
                            </span>
                          </td>
                        </tr>
                      ) : count === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-500">
                            No riders matched that name.
                          </td>
                        </tr>
                      ) : (
                        results.map((row, i) => (
                          <tr
                            key={row.registrationId ?? `${row.riderName}-${row.bibNumber}`}
                            className={(i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40') + ' transition hover:bg-slate-50'}
                          >
                            <td className="px-4 py-3.5 text-sm font-semibold leading-snug text-slate-900">
                              <span className="block max-w-[14rem] truncate sm:max-w-none">
                                {sanitizeRiderSearchDisplay(row.riderName)}
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              <span className="inline-flex min-w-[2.75rem] items-center justify-center rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs font-semibold tabular-nums text-slate-800">
                                {sanitizeRiderSearchDisplay(row.bibNumber, 32)}
                              </span>
                            </td>
                            <td className="hidden max-w-[220px] px-4 py-3.5 text-slate-700 sm:table-cell">
                              <span className="block truncate" title={sanitizeRiderSearchDisplay(row.eventType, 120)}>
                                {sanitizeRiderSearchDisplay(row.eventType)}
                              </span>
                            </td>
                            <td className="hidden max-w-[200px] px-4 py-3.5 text-slate-700 md:table-cell">
                              <span className="block truncate" title={sanitizeRiderSearchDisplay(row.discipline, 120)}>
                                {sanitizeRiderSearchDisplay(row.discipline)}
                              </span>
                            </td>
                            <td className="max-w-[240px] px-4 py-3.5 text-slate-700">
                              <span className="block truncate" title={sanitizeRiderSearchDisplay(row.category, 120)}>
                                {sanitizeRiderSearchDisplay(row.category)}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
