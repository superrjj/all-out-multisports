import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Info, Loader2, Search, X } from 'lucide-react'
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
      className="scroll-mt-24 border-t border-slate-200/90 bg-gradient-to-b from-slate-100 to-slate-50 px-4 py-14 sm:px-6 lg:px-8 lg:py-20"
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-8 max-w-xl">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Participant lookup</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-[1.65rem]">
            Search riders
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Confirmed entries only. Use the rider&apos;s registered name as it appears on the registration form.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200/90 bg-white p-5 shadow-[0_2px_20px_-4px_rgba(15,23,42,0.08)] sm:p-6">
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
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(normalizeRiderSearchQuery(e.target.value))}
                  maxLength={100}
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runSearch()
                  }}
                  placeholder="e.g. Juan dela Cruz"
                  className="w-full rounded-md border border-slate-200 bg-slate-50/50 py-2.5 pl-10 pr-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-1 focus:ring-slate-300"
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
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
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
                className="inline-flex h-[42px] min-w-[7.5rem] items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
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
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-slate-600">
                          Rider name
                        </th>
                        <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-slate-600">
                          Bib
                        </th>
                        <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-slate-600">
                          Event type
                        </th>
                        <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-slate-600">
                          Discipline
                        </th>
                        <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold text-slate-600">
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
                            className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}
                          >
                            <td className="px-4 py-3.5 text-[15px] font-medium leading-snug text-slate-900">
                              {sanitizeRiderSearchDisplay(row.riderName)}
                            </td>
                            <td className="px-4 py-3.5">
                              <span className="inline-flex min-w-[2.75rem] items-center justify-center rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs font-semibold tabular-nums text-slate-800">
                                {sanitizeRiderSearchDisplay(row.bibNumber, 32)}
                              </span>
                            </td>
                            <td className="max-w-[200px] px-4 py-3.5 text-slate-700 leading-snug">
                              {sanitizeRiderSearchDisplay(row.eventType)}
                            </td>
                            <td className="px-4 py-3.5 text-slate-700">{sanitizeRiderSearchDisplay(row.discipline)}</td>
                            <td className="px-4 py-3.5 text-slate-700">{sanitizeRiderSearchDisplay(row.category)}</td>
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

        <div className="mt-10 flex flex-col gap-3 rounded-lg border border-amber-200/70 bg-amber-50/90 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="flex items-start gap-2.5 text-sm leading-relaxed text-amber-950/90">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-800/80" aria-hidden />
            <span>Wear your bib number visibly during the race so marshals can identify you quickly.</span>
          </p>
          <Link
            to="/register/info"
            className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[#0c2340] underline decoration-slate-400 underline-offset-4 transition hover:decoration-[#0c2340]"
          >
            Need help? Contact us
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  )
}
