import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../services/api'
import { supabase } from '../../lib/supabase'
import { saveRegistrationCheckoutPayload, type RegistrationCheckoutLine } from '../../services/registrationService'
import type { Event } from '../../types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface EventType {
  slug: string
  name: string
}

type GenderEligibility = 'all' | 'male' | 'female'

interface RaceCategory {
  id: string
  discipline: string
  category_name: string
  code: string
  rider_limit: number | null
  active: boolean
  gender_eligibility?: GenderEligibility | string | null
  created_at?: string
}

interface DisciplineGroup {
  discipline: string
  categories: RaceCategory[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

const shirtSizes = ['XS', 'S', 'M', 'L', 'XL']
const cardClass =
  'rounded-xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.28),0_6px_14px_-8px_rgba(15,23,42,0.2)] sm:p-5'

function ShimmerBar({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200 ${className ?? ''}`} />
}

function FormCardSkeleton({ tall }: { tall?: boolean }) {
  return (
    <div className={`${cardClass} space-y-3`}>
      <ShimmerBar className="h-5 w-40" />
      <ShimmerBar className="h-3 w-full max-w-md" />
      <div className={`grid gap-3 ${tall ? 'min-h-[120px]' : ''} md:grid-cols-2`}>
        <ShimmerBar className="h-10 w-full" />
        <ShimmerBar className="h-10 w-full" />
        <ShimmerBar className="h-10 w-full" />
        <ShimmerBar className="h-10 w-full" />
      </div>
    </div>
  )
}

// ─── Age category detection & resolution ────────────────────────────────────

// Patterns that indicate a category is age-graded (not open/heavyweight/etc.)
const AGE_PATTERNS = [
  /youth/i,
  /junior/i,
  /under\s*23/i,
  /u23/i,
  /masters?/i,
  /\b15\b/,
  /\b16\b/,
  /18\b/,
  /19\b/,
  /\b22\b/,
  /\b23\b/,
  /\b34\b/,
  /\b35\b/,
  /\b44\b/,
  /\b45\b/,
  /\b54\b/,
  /\b55\b/,
]

/**
 * Returns true if the category list for this discipline contains
 * at least one age-graded entry (Youth, Junior, Masters, etc.).
 */
function disciplineHasAgeCategories(categoryNames: string[]): boolean {
  return categoryNames.some((name) => AGE_PATTERNS.some((re) => re.test(name)))
}

/**
 * Compute race age per the rules: age on December 31 of the competition year.
 * Uses the full birth date so month/day are taken into account.
 */
function computeRaceAge(birthDateStr: string): number | null {
  if (!birthDateStr) return null
  const dob = new Date(birthDateStr)
  if (Number.isNaN(dob.getTime())) return null
  const competitionYear = new Date().getFullYear()
  // December 31 of competition year
  const dec31 = new Date(competitionYear, 11, 31)
  let age = dec31.getFullYear() - dob.getFullYear()
  // Adjust if birthday hasn't occurred yet by Dec 31 (it always has, but keep safe)
  const m = dec31.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && dec31.getDate() < dob.getDate())) age--
  return age
}

/**
 * Match an age to an age-graded category by keyword-scanning the category names.
 * This is robust to DB ordering changes.
 */
function resolveAgeCategoryByKeyword(age: number, categoryNames: string[]): string {
  // Only consider age-graded categories
  const ageCats = categoryNames.filter((name) => AGE_PATTERNS.some((re) => re.test(name)))

  // Try explicit bracket matching first (e.g. "15 and Below", "16-18", "19-22", etc.)
  for (const name of ageCats) {
    if (age <= 15 && (/15\s*(and\s*)?below/i.test(name) || /youth/i.test(name))) return name
    if (age >= 16 && age <= 18 && (/16[-–]18/i.test(name) || /junior/i.test(name))) return name
    if (age >= 19 && age <= 22 && (/19[-–]22/i.test(name) || /under\s*23/i.test(name) || /u23/i.test(name))) return name
    if (age >= 23 && age <= 34 && (/23[-–]34/i.test(name) || /masters?\s*a/i.test(name))) return name
    if (age >= 35 && age <= 44 && (/35[-–]44/i.test(name) || /masters?\s*b/i.test(name))) return name
    if (age >= 45 && age <= 54 && (/45[-–]54/i.test(name) || /masters?\s*c/i.test(name))) return name
    if (age >= 55 && (/55\s*(and\s*)?above/i.test(name) || /masters?\s*d/i.test(name))) return name
  }

  // Fallback: pick last age-graded category for seniors
  if (ageCats.length > 0) return ageCats[ageCats.length - 1]
  return ''
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function normalizeGenderEligibility(raw: unknown): GenderEligibility {
  const s = String(raw ?? 'all').toLowerCase()
  if (s === 'male' || s === 'female') return s
  return 'all'
}

/**
 * Admin column wins. If still "all", infer only obvious open women's / men's class names so
 * legacy rows work before every category has Eligibility set — avoids showing Youth/Masters/etc.
 * to female riders when only "Open Female" should apply.
 */
function effectiveGenderEligibility(cat: RaceCategory): GenderEligibility {
  const fromDb = normalizeGenderEligibility(cat.gender_eligibility)
  if (fromDb !== 'all') return fromDb
  const name = String(cat.category_name ?? '')
  if (/\bopen\s*female\b/i.test(name) || /\bwomen'?s?\s+open\b/i.test(name) || /\bladies\s+open\b/i.test(name)) {
    return 'female'
  }
  if (/\bopen\s*male\b/i.test(name)) return 'male'
  return 'all'
}

/** Uses race_categories.gender_eligibility plus conservative name inference when DB is still "all". */
function categoryMatchesRiderGender(cat: RaceCategory, riderGender: string): boolean {
  const rule = effectiveGenderEligibility(cat)
  if (rule === 'all') return true
  const g = riderGender.trim().toLowerCase()
  if (rule === 'female') return g === 'female'
  if (rule === 'male') return g === 'male'
  return true
}

function nameLooksLikeWomenCategory(name: string): boolean {
  const n = String(name ?? '')
  if (/\bopen\s*female\b/i.test(n) || /\bwomen'?s?\s+open\b/i.test(n) || /\bladies\s+open\b/i.test(n)) return true
  if (/\bfemale\b/i.test(n) && /\bopen\b/i.test(n)) return true
  return false
}

/** When DB still has "all" on age/open rows, treat as men's field for filtering (no "female" in name). */
function nameLooksLikeMenOnlyAgeOrOpen(name: string): boolean {
  const n = String(name ?? '')
  if (nameLooksLikeWomenCategory(n)) return false
  if (AGE_PATTERNS.some((re) => re.test(n))) return true
  if (/\bopen\s*\/\s*elite\b/i.test(n)) return true
  if (/\b(mtb|road|gravel)\s+open\b/i.test(n)) return true
  if (/\bopen\s*elite\b/i.test(n)) return true
  return false
}

function disciplineHasFemaleSpecificCategory(categories: RaceCategory[]): boolean {
  return categories.some((c) => effectiveGenderEligibility(c) === 'female')
}

/** Earliest category `created_at` in the list — older disciplines sort first. */
function minCategoryCreatedAtMs(cats: RaceCategory[]): number {
  let m = Infinity
  for (const c of cats) {
    if (!c.created_at) continue
    const t = new Date(c.created_at).getTime()
    if (!Number.isNaN(t) && t < m) m = t
  }
  return m === Infinity ? Number.MAX_SAFE_INTEGER : m
}

/**
 * DB eligibility first; for female riders, if this discipline also defines a women's class,
 * hide legacy `all` rows that look like men's age brackets or generic open/elite (auto-hide without editing every row).
 */
function categoryMatchesRiderGenderInDiscipline(
  cat: RaceCategory,
  riderGender: string,
  allInDiscipline: RaceCategory[],
): boolean {
  if (!categoryMatchesRiderGender(cat, riderGender)) return false
  const g = riderGender.trim().toLowerCase()
  if (g !== 'female') return true
  if (!disciplineHasFemaleSpecificCategory(allInDiscipline)) return true
  if (effectiveGenderEligibility(cat) !== 'all') return true
  if (nameLooksLikeWomenCategory(cat.category_name)) return true
  if (nameLooksLikeMenOnlyAgeOrOpen(cat.category_name)) return false
  return true
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function RegistrationForm() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  // ── Form state ─────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    gender: '',
    birthDate: '',
    address: '',
    contactNumber: '',
    emergencyContactName: '',
    emergencyContactNumber: '',
    teamName: '',
    discipline: '',
  })
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [shirtSize, setShirtSize] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }
  const updateFormField = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    clearFieldError(key)
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  const [events, setEvents] = useState<Event[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventId, setEventId] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      if (!active) return
      setEventsLoading(true)
      try {
        const data = await api.upcomingEvents()
        if (!active) return
        setEvents(data)
        const queryEventId = params.get('eventId')
        const matched = queryEventId ? data.find((item) => item.id === queryEventId) : null
        const fallback = data[0]?.id ?? ''
        setEventId(matched?.id ?? fallback)
      } catch (e) {
        if (!active) return
        setError((e as Error).message || 'Failed to load events.')
      } finally {
        if (active) {
          setEventsLoading(false)
        }
      }
    })()
    return () => { active = false }
  }, [params])

  const selectedEvent = useMemo(() => events.find((item) => item.id === eventId) ?? null, [events, eventId])
  const registrationFee = Number(selectedEvent?.registration_fee ?? 0)

  // ── Event Types (from event_types table + event's race_type slugs) ─────────
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [eventTypesLoading, setEventTypesLoading] = useState(false)
  const [selectedEventTypeSlugs, setSelectedEventTypeSlugs] = useState<string[]>([])

  useEffect(() => {
    let active = true
    void (async () => {
      if (!selectedEvent) {
        if (!active) return
        setEventTypes([])
        setSelectedEventTypeSlugs([])
        return
      }

      // Parse slugs from the event's race_type field (comma-separated)
      const rawSlugs = String(selectedEvent.race_type ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      if (rawSlugs.length === 0) {
        if (!active) return
        setEventTypes([])
        setSelectedEventTypeSlugs([])
        return
      }

      if (!active) return
      setEventTypesLoading(true)
      setSelectedEventTypeSlugs([])

      try {
        const { data, error: err } = await supabase
          .from('event_types')
          .select('slug, name')
          .in('slug', rawSlugs)

        if (!active) return
        if (err || !data || data.length === 0) {
          // Fallback: derive name from slug if table query fails or returns nothing
          setEventTypes(rawSlugs.map((slug) => ({ slug, name: formatSlug(slug) })))
        } else {
          // Preserve order from rawSlugs
          const bySlug = new Map((data as EventType[]).map((t) => [t.slug, t]))
          setEventTypes(rawSlugs.map((slug) => bySlug.get(slug) ?? { slug, name: formatSlug(slug) }))
        }
      } catch {
        if (!active) return
        setEventTypes(rawSlugs.map((slug) => ({ slug, name: formatSlug(slug) })))
      } finally {
        if (active) {
          setEventTypesLoading(false)
        }
      }
    })()

    return () => { active = false }
  }, [selectedEvent])

  const toggleEventType = (slug: string) => {
    setSelectedEventTypeSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    )
    clearFieldError('eventTypes')
  }

  const toggleCategory = (raceCategoryId: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(raceCategoryId) ? prev.filter((id) => id !== raceCategoryId) : [...prev, raceCategoryId],
    )
    clearFieldError('category')
  }

  // ── Race Categories from DB ────────────────────────────────────────────────
  const [disciplineGroups, setDisciplineGroups] = useState<DisciplineGroup[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      if (!selectedEvent?.id) {
        if (!active) return
        setDisciplineGroups([])
        setForm((p) => ({ ...p, discipline: '' }))
        setSelectedCategoryIds([])
        return
      }
      if (!active) return
      setCategoriesLoading(true)
      try {
        const { data, error: err } = await supabase
          .from('race_categories')
          .select('id, discipline, category_name, code, rider_limit, active, gender_eligibility, created_at')
          .eq('event_id', selectedEvent.id)
          .eq('active', true)

        if (!active) return
        if (err || !data) {
          setDisciplineGroups([])
          return
        }
        const rowsSorted = [...(data as RaceCategory[])].sort((a, b) => {
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
        const groups: DisciplineGroup[] = Array.from(groupMap.entries())
          .map(([discipline, categories]) => ({ discipline, categories }))
          .sort((a, b) => minCategoryCreatedAtMs(a.categories) - minCategoryCreatedAtMs(b.categories))
        setDisciplineGroups(groups)

        // Auto-select first discipline
        const firstDisc = groups[0]?.discipline ?? ''
        setForm((p) => ({ ...p, discipline: firstDisc }))
        setSelectedCategoryIds([])
      } finally {
        if (active) {
          setCategoriesLoading(false)
        }
      }
    })()

    return () => { active = false }
  }, [selectedEvent?.id])

  /**
   * After gender is chosen, only disciplines that have ≥1 matching category appear,
   * and each discipline lists only categories allowed for that gender (all / male / female).
   */
  const disciplineGroupsForRider = useMemo(() => {
    if (!form.gender.trim()) return []
    return disciplineGroups
      .map((g) => ({
        discipline: g.discipline,
        categories: g.categories.filter((c) => categoryMatchesRiderGenderInDiscipline(c, form.gender, g.categories)),
      }))
      .filter((g) => g.categories.length > 0)
      .sort((a, b) => minCategoryCreatedAtMs(a.categories) - minCategoryCreatedAtMs(b.categories))
  }, [disciplineGroups, form.gender])

  const currentDisciplineGroup = useMemo(
    () => disciplineGroupsForRider.find((g) => g.discipline === form.discipline) ?? null,
    [disciplineGroupsForRider, form.discipline],
  )

  /** Same as categories in the visible discipline (already filtered by gender when gender is set). */
  const categoriesEligibleForRider = useMemo(
    () => currentDisciplineGroup?.categories ?? [],
    [currentDisciplineGroup],
  )

  /** Keep discipline in sync when gender hides the current tab (e.g. male-only MTB no longer listed for Female). */
  useEffect(() => {
    if (!form.gender.trim()) return
    const visible = disciplineGroupsForRider
    if (visible.length === 0) {
      setForm((p) => (p.discipline ? { ...p, discipline: '' } : p))
      setSelectedCategoryIds([])
      return
    }
    if (!visible.some((g) => g.discipline === form.discipline)) {
      setForm((p) => ({ ...p, discipline: visible[0].discipline }))
      setSelectedCategoryIds([])
    }
  }, [form.gender, disciplineGroupsForRider, form.discipline])

  const selectedCategoryIdsInDiscipline = useMemo(() => {
    const allowed = new Set(categoriesEligibleForRider.map((c) => c.id))
    return selectedCategoryIds.filter((id) => allowed.has(id))
  }, [categoriesEligibleForRider, selectedCategoryIds])

  useEffect(() => {
    if (!form.gender.trim()) return
    setSelectedCategoryIds((prev) => {
      const eligible = new Set(categoriesEligibleForRider.map((c) => c.id))
      return prev.filter((id) => eligible.has(id))
    })
  }, [form.gender, categoriesEligibleForRider])

  useEffect(() => {
    if (categoriesEligibleForRider.length !== 1 || !form.gender.trim()) return
    const only = categoriesEligibleForRider[0]
    setSelectedCategoryIds([only.id])
  }, [categoriesEligibleForRider, form.gender])

  const totalFee = useMemo(
    () =>
      registrationFee *
      Math.max(1, selectedEventTypeSlugs.length) *
      Math.max(1, selectedCategoryIdsInDiscipline.length),
    [registrationFee, selectedEventTypeSlugs.length, selectedCategoryIdsInDiscipline.length],
  )

  const showFormSkeleton =
    eventsLoading || (!!selectedEvent?.id && (categoriesLoading || eventTypesLoading))

  const currentCategoryNames = useMemo(
    () => categoriesEligibleForRider.map((c) => c.category_name),
    [categoriesEligibleForRider],
  )
  const selectedCategoryLabels = useMemo(() => {
    const cats = categoriesEligibleForRider
    return selectedCategoryIdsInDiscipline
      .map((id) => cats.find((c) => c.id === id)?.category_name)
      .filter(Boolean) as string[]
  }, [categoriesEligibleForRider, selectedCategoryIdsInDiscipline])

  const primaryCategoryForRider = useMemo(() => {
    const cats = categoriesEligibleForRider
    const firstId = selectedCategoryIdsInDiscipline[0]
    return firstId ? cats.find((c) => c.id === firstId) ?? null : null
  }, [categoriesEligibleForRider, selectedCategoryIdsInDiscipline])

  // Does this discipline have age-graded categories (Youth / Junior / Masters)?
  const hasAgeCategories = useMemo(
    () => disciplineHasAgeCategories(currentCategoryNames),
    [currentCategoryNames],
  )

  // Race age computed from the DOB field (December 31 of competition year rule)
  const raceAge = useMemo(() => computeRaceAge(form.birthDate), [form.birthDate])

  // The category that best matches the rider's age (only meaningful when discipline has age cats)
  const suggestedAgeCategory = useMemo(() => {
    if (!hasAgeCategories || raceAge === null) return ''
    return resolveAgeCategoryByKeyword(raceAge, currentCategoryNames)
  }, [hasAgeCategories, raceAge, currentCategoryNames])

  // ── Submit ─────────────────────────────────────────────────────────────────
  const onSubmit = async () => {
    setFieldErrors({})
    setError(null)

    const errors: Record<string, string> = {}
    if (!form.email) errors.email = 'Email is required.'
    if (!form.firstName) errors.firstName = 'First name is required.'
    if (!form.lastName) errors.lastName = 'Last name is required.'
    if (!form.gender) errors.gender = 'Please select a gender.'
    if (!form.birthDate) errors.birthDate = 'Date of birth is required.'
    if (!form.address) errors.address = 'Address is required.'
    if (!form.contactNumber) errors.contactNumber = 'Contact number is required.'
    if (!form.emergencyContactName) errors.emergencyContactName = 'Emergency contact name is required.'
    if (!form.emergencyContactNumber) errors.emergencyContactNumber = 'Emergency contact number is required.'
    if (form.gender.trim() && disciplineGroupsForRider.length === 0) {
      errors.category = 'No disciplines or categories match your gender for this event. Contact the organizer.'
    } else if (form.gender.trim() && categoriesEligibleForRider.length === 0) {
      errors.category = 'No categories are available for your gender in this discipline. Contact the organizer.'
    } else if (selectedCategoryIdsInDiscipline.length === 0) {
      errors.category = 'Please select at least one category.'
    }
    if (!shirtSize) errors.shirtSize = 'Please select a shirt size.'
    if (!selectedEvent) errors.event = 'Please select an event.'
    if (selectedEventTypeSlugs.length === 0) errors.eventTypes = 'Please select at least one event type.'

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    setSubmitting(true)
    try {
      const eventEntries = selectedEventTypeSlugs.map((slug) => ({
        slug,
        label: eventTypes.find((t) => t.slug === slug)?.name ?? formatSlug(slug),
      }))
      const raceTypeLabel = eventEntries.map((e) => e.label).join(', ')
      const checkoutBundleId = globalThis.crypto?.randomUUID?.() ?? `bundle-${Date.now()}`

      const cats = categoriesEligibleForRider
      const checkoutLines: RegistrationCheckoutLine[] = selectedEventTypeSlugs.flatMap((slug) =>
        selectedCategoryIdsInDiscipline.map((raceCategoryId) => {
          const cat = cats.find((c) => c.id === raceCategoryId)
          return {
            slug,
            label: eventTypes.find((t) => t.slug === slug)?.name ?? formatSlug(slug),
            raceCategoryId,
            categoryName: cat?.category_name,
          }
        }),
      )

      saveRegistrationCheckoutPayload({
        raceType: raceTypeLabel || (selectedEvent!.race_type ?? ''),
        eventId: selectedEvent!.id,
        raceCategoryId: selectedCategoryIdsInDiscipline[0] ?? '',
        registrationFeePerEntry: registrationFee,
        registrationFeeTotal: totalFee,
        checkoutBundleId,
        eventEntries,
        checkoutLines,
        registrantEmail: form.email,
        eventTitle: selectedEvent?.title ?? '',
        raceTypeLabel: selectedEvent?.race_type ?? '',
        rider: {
          firstName: form.firstName,
          lastName: form.lastName,
          gender: form.gender,
          birthDate: form.birthDate,
          birthYear: form.birthDate ? new Date(form.birthDate).getFullYear() : null,
          address: form.address,
          contactNumber: form.contactNumber,
          emergencyContactName: form.emergencyContactName,
          emergencyContactNumber: form.emergencyContactNumber,
          teamName: form.teamName,
          discipline: form.discipline,
          ageCategory: primaryCategoryForRider?.category_name ?? '',
          jerseySize: shirtSize,
        },
      })

      navigate('/register/payment')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (showFormSkeleton) {
    return (
      <section className="bg-white px-4 py-8 text-slate-900 sm:px-6 sm:py-10 lg:px-8">
        <div className="mx-auto w-full max-w-[760px] space-y-5 sm:space-y-6">
          <ShimmerBar className="h-44 w-full rounded-lg sm:h-52" />
          <Link to="/register/info" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
            &larr; Back
          </Link>
          <div className="space-y-1">
            <ShimmerBar className="h-8 w-56" />
            <ShimmerBar className="h-4 w-72 max-w-full" />
          </div>
          <FormCardSkeleton tall />
          <FormCardSkeleton tall />
          <FormCardSkeleton tall />
          <FormCardSkeleton />
          <ShimmerBar className="h-12 w-full max-w-xs rounded-md" />
        </div>
      </section>
    )
  }

  return (
    <section className="bg-white px-4 py-8 text-slate-900 sm:px-6 sm:py-10 lg:px-8">
      <div className="mx-auto w-full max-w-[760px] space-y-5 sm:space-y-6">
        <img src="/hna-banner-1.png" alt="Hari ng Ahon 2026 banner" className="w-full rounded-lg object-cover" />

        <Link to="/register/info" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          &larr; Back
        </Link>

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">Registration</h1>
          <p className="text-sm text-slate-600">Fill up the rider information and choose your category.</p>
        </div>

        {/* ── Event & Event Types Card ────────────────────────────────────── */}
        <div className={`${cardClass} space-y-4`}>
          {/* Event selector (hidden visually if only one event) */}
          {events.length > 1 && (
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-900">
                Event <span className="text-rose-500">*</span>
              </label>
              <div className="flex flex-col gap-2">
                {eventsLoading ? <p className="text-xs text-slate-500">Loading events…</p> : null}
                {events.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setEventId(event.id)}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ${eventId === event.id ? 'border-[#cfae3f] bg-[#fff6d6]' : 'border-slate-300 bg-white'
                      }`}
                  >
                    <span
                      className={`h-3 w-3 rounded-sm border ${eventId === event.id ? 'bg-[#cfae3f] border-[#cfae3f]' : 'border-slate-400'
                        }`}
                    />
                    <span className="flex-1">{event.title}</span>
                    <span className="text-xs text-slate-500">₱{Number(event.registration_fee ?? 0).toLocaleString()} / type</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Event Types as checkboxes */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-900">
              Event Type <span className="text-rose-500">*</span>
            </label>
            <p className="text-xs text-slate-500">Select one or more event types to join.</p>

            {eventsLoading || eventTypesLoading ? (
              <p className="text-xs text-slate-500">Loading event types…</p>
            ) : eventTypes.length === 0 ? (
              <p className="text-xs text-rose-600">No event types available for this event.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {eventTypes.map((et) => {
                  const checked = selectedEventTypeSlugs.includes(et.slug)
                  return (
                    <button
                      key={et.slug}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => toggleEventType(et.slug)}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${checked
                        ? 'border-[#cfae3f] bg-[#fff6d6] text-slate-900'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-[#cfae3f]'
                        }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-4 w-4 items-center justify-center rounded border text-xs ${checked ? 'border-[#cfae3f] bg-[#cfae3f] text-black' : 'border-slate-300 bg-white'
                          }`}
                      >
                        {checked ? '✓' : ''}
                      </span>
                      {et.name}
                    </button>
                  )
                })}
              </div>
            )}
            {fieldErrors.eventTypes && (
              <p className="text-xs text-rose-500">{fieldErrors.eventTypes}</p>
            )}
          </div>

          {/* Dynamic fee preview */}
          {selectedEventTypeSlugs.length > 0 && selectedCategoryIdsInDiscipline.length > 0 && (
            <div className="rounded-lg border border-[#cfae3f]/40 bg-[#fff6d6] px-4 py-3">
              <p className="text-xs text-slate-600">
                {selectedEventTypeSlugs.length} type{selectedEventTypeSlugs.length > 1 ? 's' : ''} ×{' '}
                {selectedCategoryIdsInDiscipline.length} categor
                {selectedCategoryIdsInDiscipline.length > 1 ? 'ies' : 'y'} × ₱{registrationFee.toLocaleString()}
              </p>
              <p className="mt-0.5 text-base font-semibold text-slate-900">
                Total: ₱{totalFee.toLocaleString()}
              </p>
            </div>
          )}
        </div>

        {/* ── Personal Info Card ─────────────────────────────────────────── */}
        <div className={`${cardClass} grid grid-cols-1 gap-4 md:grid-cols-2`}>
          <Field
            label={<>Email <span className="text-rose-500">*</span></>}
            type="email"
            value={form.email}
            placeholder="you@gmail.com"
            error={fieldErrors.email}
            onChange={(v) => updateFormField('email', v)}
          />
          <Field
            label={<>First Name <span className="text-rose-500">*</span></>}
            value={form.firstName}
            placeholder="Juan"
            error={fieldErrors.firstName}
            onChange={(v) => updateFormField('firstName', v)}
          />
          <Field
            label={<>Last Name <span className="text-rose-500">*</span></>}
            value={form.lastName}
            placeholder="Dela Cruz"
            error={fieldErrors.lastName}
            onChange={(v) => updateFormField('lastName', v)}
          />
          <SelectField
            label={<>Gender <span className="text-rose-500">*</span></>}
            value={form.gender}
            options={['Male', 'Female']}
            placeholder="Select gender"
            error={fieldErrors.gender}
            onChange={(v) => updateFormField('gender', v)}
          />
          <Field
            label={<>Date Of Birth <span className="text-rose-500">*</span></>}
            type="date"
            value={form.birthDate}
            error={fieldErrors.birthDate}
            onChange={(v) => updateFormField('birthDate', v)}
          />
          <Field
            label={<>Address <span className="text-rose-500">*</span></>}
            value={form.address}
            placeholder="Baguio City"
            error={fieldErrors.address}
            onChange={(v) => updateFormField('address', v)}
          />
          <Field
            label={<>Contact Number <span className="text-rose-500">*</span></>}
            value={form.contactNumber}
            placeholder="+63 9XX XXX XXXX"
            error={fieldErrors.contactNumber}
            onChange={(v) => updateFormField('contactNumber', v)}
          />
          <Field
            label={<>Emergency Contact <span className="text-rose-500">*</span></>}
            value={form.emergencyContactName}
            placeholder="Full name"
            error={fieldErrors.emergencyContactName}
            onChange={(v) => updateFormField('emergencyContactName', v)}
          />
          <Field
            label={<>Emergency Contact Number <span className="text-rose-500">*</span></>}
            value={form.emergencyContactNumber}
            placeholder="+63 9XX XXX XXXX"
            error={fieldErrors.emergencyContactNumber}
            onChange={(v) => updateFormField('emergencyContactNumber', v)}
          />
          <Field
            label="Team Name"
            value={form.teamName}
            placeholder="Optional"
            onChange={(v) => updateFormField('teamName', v)}
          />
        </div>

        {/* ── Discipline & Category Card ─────────────────────────────────── */}
        <div className={`${cardClass} space-y-4`}>
          <div>
            <label className="text-sm font-semibold text-slate-900">
              Category <span className="text-rose-500">*</span>
            </label>
            <p className="mt-0.5 text-xs text-slate-500">
              *The organizers reserve the right to merge categories with less than 10 participants.
            </p>
            {!form.gender.trim() ? (
              <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Select your <strong>gender</strong> first — only disciplines and categories that match eligibility will
                appear.
              </p>
            ) : null}
          </div>

          {categoriesLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded-lg border border-slate-200 bg-white p-4">
                  <div className="mb-2 h-4 w-32 rounded bg-slate-200" />
                  <div className="mb-4 h-3 w-40 rounded bg-slate-100" />
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <div key={j} className="h-3 w-3/4 rounded bg-slate-100" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : disciplineGroups.length === 0 ? (
            <p className="text-xs text-rose-600">No categories configured for this event.</p>
          ) : !form.gender.trim() ? (
            <p className="mt-1 text-xs text-slate-500">
              Select your gender first so we can show the disciplines and categories available for your rider profile.
            </p>
          ) : disciplineGroupsForRider.length === 0 ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
              No disciplines or categories are available for <strong>{form.gender}</strong> for this event. Please contact
              the organizer.
            </p>
          ) : (
            <div className="space-y-4">
              {/* ── Discipline tab-pills (filtered by gender eligibility once gender is chosen) ─ */}
              {disciplineGroupsForRider.length > 1 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Discipline</p>
                  <div className="flex flex-wrap gap-2">
                    {disciplineGroupsForRider.map((g) => {
                      const active = form.discipline === g.discipline
                      return (
                        <button
                          key={g.discipline}
                          type="button"
                          onClick={() => {
                            setForm((p) => ({ ...p, discipline: g.discipline }))
                            const nextGroup = disciplineGroupsForRider.find((d) => d.discipline === g.discipline)
                            const allowed = new Set((nextGroup?.categories ?? []).map((c) => c.id))
                            setSelectedCategoryIds((prev) => prev.filter((id) => allowed.has(id)))
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold transition-all ${active
                              ? 'border-[#cfae3f] bg-[#cfae3f] text-black shadow-sm'
                              : 'border-slate-300 bg-white text-slate-600 hover:border-[#cfae3f] hover:text-slate-900'
                            }`}
                        >
                          {active && (
                            <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {g.discipline}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Single visible discipline: show name as static label */}
              {disciplineGroupsForRider.length === 1 && (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-[#cfae3f] bg-[#fff6d6] px-3 py-1 text-sm font-semibold text-slate-800">
                    {disciplineGroupsForRider[0].discipline}
                  </span>
                </div>
              )}

              {/* ── Category grid ────────────────────────────────────────── */}
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {hasAgeCategories ? (
                    <>
                      Age / Class Category{' '}
                      <span className="text-rose-500 normal-case font-normal tracking-normal">*</span>
                    </>
                  ) : (
                    <>
                      Race category{' '}
                      <span className="text-rose-500 normal-case font-normal tracking-normal">*</span>
                    </>
                  )}
                </p>
                {form.gender.trim().toLowerCase() === 'female' &&
                !hasAgeCategories &&
                categoriesEligibleForRider.length > 0 ? (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
                    There are <strong>no separate age brackets</strong> for your selection — choose your{' '}
                    <strong>women’s / open class</strong> below (same for every event type you pick).
                  </p>
                ) : null}
                {form.gender && categoriesEligibleForRider.length === 0 ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                    No categories are set up for <strong>{form.gender}</strong> in this discipline. Choose another
                    discipline or contact registration.
                  </p>
                ) : null}
                <div
                  className={`grid grid-cols-1 gap-2 sm:grid-cols-2 rounded-xl border p-3 ${fieldErrors.category ? 'border-rose-400 bg-rose-50/40' : 'border-slate-200 bg-slate-50/60'
                    }`}
                >
                  {categoriesEligibleForRider.map((cat) => {
                    const checked = selectedCategoryIds.includes(cat.id)
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => toggleCategory(cat.id)}
                        className={`group relative flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition-all ${checked
                            ? 'border-[#cfae3f] bg-[#fff6d6] text-slate-900 shadow-sm'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-[#cfae3f]/60 hover:bg-[#fffdf0] hover:text-slate-900'
                          }`}
                      >
                        {/* Custom checkbox */}
                        <span
                          aria-hidden="true"
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-all ${checked
                              ? 'border-[#cfae3f] bg-[#cfae3f]'
                              : 'border-slate-300 bg-white group-hover:border-[#cfae3f]/70'
                            }`}
                        >
                          {checked && (
                            <svg className="h-3 w-3 text-black" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span className="flex-1 leading-snug">{cat.category_name}</span>
                        {checked && (
                          <span className="shrink-0 rounded-full bg-[#cfae3f]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8a6d00]">
                            Selected
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
                {fieldErrors.category && (
                  <p className="text-xs text-rose-500">{fieldErrors.category}</p>
                )}
              </div>
            </div>
          )}

          {/* Age-based suggestion — only when eligible list includes age-graded category names */}
          {hasAgeCategories && form.birthDate && suggestedAgeCategory && (
            <div className="flex flex-col gap-2 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                  ℹ
                </span>
                <div className="text-xs text-slate-700 leading-relaxed">
                  Based on your date of birth, your race age on Dec 31, {new Date().getFullYear()} is{' '}
                  <span className="font-bold text-slate-900">{raceAge}</span>.{' '}
                  Suggested category:{' '}
                  <span className="font-bold text-blue-800">{suggestedAgeCategory}</span>
                </div>
              </div>
              <div className="pl-8">
                {!selectedCategoryLabels.includes(suggestedAgeCategory) ? (
                  <button
                    type="button"
                    onClick={() => {
                      const match = categoriesEligibleForRider.find((cat) => cat.category_name === suggestedAgeCategory)
                      if (match) setSelectedCategoryIds([match.id])
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-800 transition"
                  >
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    Apply suggested category
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Applied
                  </span>
                )}
              </div>
            </div>
          )}

          {!hasAgeCategories && selectedCategoryLabels.length > 0 && (
            <p className="text-xs text-slate-600">
              Selected:{' '}
              <span className="font-semibold text-slate-900">{selectedCategoryLabels.join(', ')}</span>
            </p>
          )}
        </div>

        {/* ── Shirt Size Card ────────────────────────────────────────────── */}
        <div className={`${cardClass} space-y-3`}>
          <label className="text-sm font-semibold text-slate-900">
            Event Shirt <span className="text-rose-500">*</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {shirtSizes.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => {
                  setShirtSize(size)
                  clearFieldError('shirtSize')
                }}
                className={`min-w-[3rem] rounded-md border px-3 py-2 text-sm sm:min-w-[3.25rem] ${shirtSize === size
                  ? 'border-[#cfae3f] bg-[#fff6d6] text-slate-900'
                  : 'border-slate-300 bg-white text-slate-700 hover:text-slate-900'
                  }`}
              >
                {size}
              </button>
            ))}
          </div>
          {fieldErrors.shirtSize && <p className="text-xs text-rose-500">{fieldErrors.shirtSize}</p>}
        </div>

        {/* ── Fee Summary ────────────────────────────────────────────────── */}
        {selectedEventTypeSlugs.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="font-semibold text-slate-800">Registration Summary</p>
            <div className="mt-2 space-y-1 text-slate-600">
              <p>Event: <span className="font-medium text-slate-900">{selectedEvent?.title ?? '—'}</span></p>
              <p>
                Types:{' '}
                <span className="font-medium text-slate-900">
                  {selectedEventTypeSlugs
                    .map((slug) => eventTypes.find((t) => t.slug === slug)?.name ?? formatSlug(slug))
                    .join(', ')}
                </span>
              </p>
              <p>
                Categories:{' '}
                <span className="font-medium text-slate-900">
                  {selectedCategoryLabels.length > 0 ? selectedCategoryLabels.join(', ') : '—'}
                </span>
              </p>
              <p>
                Total Fee:{' '}
                <span className="font-semibold text-slate-900">₱{totalFee.toLocaleString()}</span>
                {(selectedEventTypeSlugs.length > 1 || selectedCategoryIdsInDiscipline.length > 1) && (
                  <span className="ml-1 text-xs text-slate-400">
                    ({selectedEventTypeSlugs.length} types × {selectedCategoryIdsInDiscipline.length} categories × ₱
                    {registrationFee.toLocaleString()})
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="pt-2">
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={submitting}
            className="inline-flex w-full items-center justify-center rounded-md bg-[#cfae3f] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#dab852] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {submitting ? 'Saving…' : 'Proceed to Payment'}
          </button>
        </div>
      </div>
    </section>
  )
}

// ─── Field Components ─────────────────────────────────────────────────────────

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  error,
}: {
  label: React.ReactNode
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  error?: string
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold text-slate-900">{label}</label>
      <input
        value={value}
        type={type}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md border bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-[#cfae3f] sm:py-2 sm:text-sm ${type === 'date' ? 'min-h-[44px]' : ''} ${error ? 'border-rose-400' : 'border-slate-300'
          }`}
      />
      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
  error,
  placeholder,
}: {
  label: React.ReactNode
  value: string
  options: string[]
  onChange: (value: string) => void
  error?: string
  placeholder?: string
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold text-slate-900">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-md border bg-white px-3 py-2.5 text-base text-slate-900 outline-none focus:border-[#cfae3f] sm:py-2 sm:text-sm ${error ? 'border-rose-400' : 'border-slate-300'
          }`}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  )
}