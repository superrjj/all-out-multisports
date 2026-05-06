import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { api } from '../../services/api'
import { supabase } from '../../lib/supabase'
import type { Event } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RaceCategory {
  id: string
  discipline: string
  category_name: string
  code: string
  rider_limit: number | null
  active: boolean
  created_at?: string
}

interface DisciplineGroup {
  discipline: string
  categories: RaceCategory[]
}

const DISCIPLINE_TIRE_HINTS: Record<string, string> = {
  'Road Bike': 'Tire Size: <32mm / <1.25"',
  'Mountain Bike': 'Tire Size: >50mm / 1.95"',
  'Gravel Bike': 'Tire Size: 33–49mm / 1.3–1.9"',
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return 'TBA'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'TBA'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatEventRaceDateRange(event: Event | null): string {
  if (!event) return 'TBA'
  const start = (event.start_date ?? event.event_date ?? '').trim()
  const end = (event.end_date ?? '').trim()
  if (start && end && start.slice(0, 10) !== end.slice(0, 10)) {
    return `${formatDateShort(start)} – ${formatDateShort(end)}`
  }
  if (start) return formatDateShort(start)
  return 'TBA'
}

function formatRegistrationEnds(event: Event | null): string {
  if (!event) return 'TBA'
  const raw = (event.registration_deadline ?? event.registration_closes_at ?? '').trim()
  if (!raw) return 'TBA'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return 'TBA'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function ShimmerBlock({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 bg-[length:200%_100%] ${className ?? ''}`}
      style={{ animationDuration: '1.5s' }}
    />
  )
}

function HeaderMetaSkeleton() {
  return (
    <dl className="grid grid-cols-1 gap-2 text-sm sm:gap-3 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.28),0_6px_14px_-8px_rgba(15,23,42,0.2)]"
        >
          <ShimmerBlock className="mb-2 h-3 w-16" />
          <ShimmerBlock className="h-4 w-full max-w-[9rem]" />
        </div>
      ))}
    </dl>
  )
}

function CategorySkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-slate-200 bg-white p-4 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.28),0_6px_14px_-8px_rgba(15,23,42,0.2)] sm:p-5">
      <div className="mb-2 h-4 w-32 rounded bg-slate-200" />
      <div className="mb-4 h-3 w-40 rounded bg-slate-100" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-3 w-3/4 rounded bg-slate-100" />
        ))}
      </div>
    </div>
  )
}

function FeesCardSkeleton() {
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.28),0_6px_14px_-8px_rgba(15,23,42,0.2)] sm:p-5">
      <ShimmerBlock className="h-6 w-40" />
      <ShimmerBlock className="h-4 w-full" />
      <ShimmerBlock className="h-4 w-4/5" />
      <div className="flex gap-2">
        <ShimmerBlock className="h-8 w-20" />
        <ShimmerBlock className="h-8 w-48" />
      </div>
    </section>
  )
}

function DescriptionSkeleton() {
  return (
    <section className="space-y-3">
      <ShimmerBlock className="h-6 w-48" />
      <ShimmerBlock className="h-3 w-full" />
      <ShimmerBlock className="h-3 w-full" />
      <ShimmerBlock className="h-3 w-5/6" />
    </section>
  )
}

// ─── Discipline Card ──────────────────────────────────────────────────────────

function DisciplineCard({ group }: { group: DisciplineGroup }) {
  const tireHint = DISCIPLINE_TIRE_HINTS[group.discipline] ?? null
  const activeCategories = group.categories.filter((c) => c.active)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.28),0_6px_14px_-8px_rgba(15,23,42,0.2)] sm:p-5">
      <div className="mb-1 flex items-center gap-2">
        <h4 className="text-sm font-semibold">{group.discipline}</h4>
      </div>
      {tireHint && <p className="mt-0.5 text-xs text-slate-500">{tireHint}</p>}
      {activeCategories.length === 0 ? (
        <p className="mt-3 text-xs italic text-slate-400">No active categories.</p>
      ) : (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700 marker:text-slate-500">
          {activeCategories.map((cat) => (
            <li key={cat.id}>{cat.category_name}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function RegistrationInfo() {
  const { session } = useAuth()
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [disciplineGroups, setDisciplineGroups] = useState<DisciplineGroup[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [categoriesError, setCategoriesError] = useState<string | null>(null)
  const [eventTypeLabels, setEventTypeLabels] = useState<string[]>([])
  const [eventTypesLoading, setEventTypesLoading] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    void api
      .upcomingEvents()
      .then((data) => {
        if (!active) return
        setEvents(data)
      })
      .catch((e) => {
        if (!active) return
        setError((e as Error).message || 'Failed to load events.')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const selectedEvent = useMemo(() => events[0] ?? null, [events])

  useEffect(() => {
    if (!selectedEvent?.id) {
      setEventTypeLabels([])
      return
    }
    const rawSlugs = String(selectedEvent.race_type ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (rawSlugs.length === 0) {
      setEventTypeLabels([])
      return
    }

    let active = true
    setEventTypesLoading(true)
    void (async () => {
      try {
        const { data, error: err } = await supabase.from('event_types').select('slug, name').in('slug', rawSlugs)
        if (!active) return
        if (err || !data?.length) {
          setEventTypeLabels(rawSlugs.map(formatSlug))
          return
        }
        const bySlug = new Map((data as { slug: string; name: string }[]).map((t) => [t.slug.toLowerCase(), t.name]))
        setEventTypeLabels(rawSlugs.map((slug) => bySlug.get(slug) ?? formatSlug(slug)))
      } catch {
        if (!active) return
        setEventTypeLabels(rawSlugs.map(formatSlug))
      } finally {
        if (active) setEventTypesLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [selectedEvent?.id, selectedEvent?.race_type])

  useEffect(() => {
    if (!selectedEvent?.id) {
      setDisciplineGroups([])
      return
    }
    let active = true
    setCategoriesLoading(true)
    setCategoriesError(null)

    void (async () => {
      try {
        const { data, error: err } = await supabase
          .from('race_categories')
          .select('id, discipline, category_name, code, rider_limit, active, created_at')
          .eq('event_id', selectedEvent.id)

        if (!active) return
        if (err) {
          setCategoriesError(err.message || 'Failed to load categories.')
          setDisciplineGroups([])
          return
        }
        const rows = (data ?? []) as RaceCategory[]
        const rowsSorted = [...rows].sort((a, b) => {
          const ta = a.created_at ? new Date(a.created_at).getTime() : 0
          const tb = b.created_at ? new Date(b.created_at).getTime() : 0
          return ta - tb
        })

        const groupMap = new Map<string, RaceCategory[]>()
        for (const row of rowsSorted) {
          const disc = (row.discipline ?? '').trim() || 'General'
          if (!groupMap.has(disc)) groupMap.set(disc, [])
          groupMap.get(disc)!.push(row)
        }

        const groups: DisciplineGroup[] = Array.from(groupMap.entries()).map(([discipline, categories]) => ({
          discipline,
          categories,
        }))
        setDisciplineGroups(groups)
      } catch (e) {
        if (!active) return
        setCategoriesError((e as Error).message || 'Failed to load categories.')
        setDisciplineGroups([])
      } finally {
        if (!active) return
        setCategoriesLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [selectedEvent?.id])

  const raceDateRange = formatEventRaceDateRange(selectedEvent)
  const registrationEnds = formatRegistrationEnds(selectedEvent)
  const headlineEventTypes =
    eventTypeLabels.length > 0 ? eventTypeLabels.join(' · ') : selectedEvent ? formatSlug(String(selectedEvent.race_type ?? '').split(',')[0] || 'race') : '—'

  const nextPath = selectedEvent ? `/register/form?eventId=${encodeURIComponent(selectedEvent.id)}` : '/register/form'
  const registrationFee = Number(selectedEvent?.registration_fee ?? 0)
  const showHeroSkeleton = loading || eventTypesLoading

  return (
    <section className="bg-white px-4 py-8 text-slate-900 sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto w-full max-w-[760px] space-y-8 sm:space-y-10">
        {showHeroSkeleton ? (
          <ShimmerBlock className="h-40 w-full rounded-lg sm:h-48" />
        ) : (
          <img src="/hna-banner-1.png" alt="Hari ng Ahon 2026 banner" className="w-full rounded-lg object-cover" />
        )}

        <header className="space-y-3">
          <p className="text-sm font-medium text-slate-600">{selectedEvent?.title ?? 'Hari ng Ahon'}</p>
          {showHeroSkeleton ? (
            <>
              <ShimmerBlock className="h-9 w-4/5 max-w-xl sm:h-10" />
              <HeaderMetaSkeleton />
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">{headlineEventTypes}</h1>
              <dl className="grid grid-cols-1 gap-2 text-sm text-slate-800 sm:gap-3 md:grid-cols-3">
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.28),0_6px_14px_-8px_rgba(15,23,42,0.2)]">
                  <dt className="text-xs text-slate-500">Race dates</dt>
                  <dd className="font-medium">{raceDateRange}</dd>
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.28),0_6px_14px_-8px_rgba(15,23,42,0.2)]">
                  <dt className="text-xs text-slate-500">Venue</dt>
                  <dd className="font-medium">{selectedEvent?.venue ?? 'TBA'}</dd>
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.28),0_6px_14px_-8px_rgba(15,23,42,0.2)]">
                  <dt className="text-xs text-slate-500">Registration ends</dt>
                  <dd className="font-medium">{registrationEnds}</dd>
                </div>
              </dl>
            </>
          )}
        </header>

        {loading ? (
          <DescriptionSkeleton />
        ) : (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Bike Challenge Series</h2>
            <p className="text-sm leading-relaxed text-slate-700">
              Baguio City is nestled almost 1500 meters above sea level. This is the reason why it is usually taunted as
              the killer lap in most national road bike races since biking towards the city would always mean several
              kilometers of unforgiving climbs.
            </p>
            <p className="text-sm leading-relaxed text-slate-700">
              Hari ng Ahon bike challenge series is a sporting event organized by All Out Multisports in partnership with
              the Metropolitan Baguio-La Trinidad-Itogon-Sablan-Tuba-Tublay Development Authority (MBLISTTDA).
            </p>
            <p className="text-sm leading-relaxed text-slate-700">
              This highly anticipated event consists of a thrilling five-leg bike race, covering various routes leading to
              the breathtaking city of Baguio from its neighboring municipalities.
            </p>
            <p className="text-sm leading-relaxed text-slate-700">
              The series is now on its 4th and 5th legs to complete Season 4.
            </p>
          </section>
        )}

        {loading ? (
          <FeesCardSkeleton />
        ) : (
          <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.28),0_6px_14px_-8px_rgba(15,23,42,0.2)] sm:p-5">
            <h3 className="text-lg font-semibold">Registration fees</h3>
            <p className="text-sm text-slate-600">
              Race Inclusions: Finisher Shirt, Drawstring bag, Race Bib, Bike plate, Post-Race Meal, Finisher Medal
              (Metal), and Timing Chip (Rental)
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-md bg-[#cfae3f] px-3 py-1 text-sm font-semibold text-black">Tier 1</span>
              <span className="text-sm text-slate-800">
                {registrationFee > 0
                  ? `₱${registrationFee.toLocaleString()} per event type`
                  : 'Contact organizer for pricing'}
              </span>
              <span className="text-xs text-slate-500">Current</span>
            </div>
            <p className="text-xs text-slate-500">
              *Slots are limited to ensure a safe and manageable race experience for all participants*
            </p>
          </section>
        )}

        <section className="space-y-4">
          <h3 className="text-lg font-semibold">Categories</h3>

          {categoriesLoading && (
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <CategorySkeleton key={i} />
              ))}
            </div>
          )}

          {!categoriesLoading && categoriesError && <p className="text-sm text-rose-600">{categoriesError}</p>}

          {!categoriesLoading && !categoriesError && disciplineGroups.length === 0 && selectedEvent && (
            <p className="text-sm italic text-slate-500">No categories have been configured for this event yet.</p>
          )}

          {!categoriesLoading && disciplineGroups.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {disciplineGroups.map((group) => (
                <DisciplineCard key={group.discipline} group={group} />
              ))}
            </div>
          )}
        </section>

        <div className="pt-2">
          {loading ? <ShimmerBlock className="h-4 w-40" /> : null}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
          <Link
            to={session ? nextPath : `/auth?redirect=${encodeURIComponent(nextPath)}`}
            className={`mt-3 inline-flex w-full items-center justify-center rounded-md px-5 py-2.5 text-sm font-semibold text-black transition sm:w-auto ${
              loading ? 'pointer-events-none bg-slate-200 text-slate-500' : 'bg-[#cfae3f] hover:bg-[#dab852]'
            }`}
          >
            Next
          </Link>
        </div>
      </div>
    </section>
  )
}
