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

const shirtSizes = ['Extra Small', 'Small', 'Medium', 'Large', 'Extra Large']
const cardClass =
  'rounded-xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.28),0_6px_14px_-8px_rgba(15,23,42,0.2)] sm:p-5'

/** Map event type slugs to their image filenames in /public */
const EVENT_TYPE_IMAGES: Record<string, string> = {
  'criterium': '/criterium.png',
  'individual-time-trial': '/timetrial.png',
}

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

function disciplineHasAgeCategories(categoryNames: string[]): boolean {
  return categoryNames.some((name) => AGE_PATTERNS.some((re) => re.test(name)))
}

function computeRaceAge(birthDateStr: string): number | null {
  if (!birthDateStr) return null
  const dob = new Date(birthDateStr)
  if (Number.isNaN(dob.getTime())) return null
  const competitionYear = new Date().getFullYear()
  const dec31 = new Date(competitionYear, 11, 31)
  let age = dec31.getFullYear() - dob.getFullYear()
  const m = dec31.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && dec31.getDate() < dob.getDate())) age--
  return age
}

function resolveAgeCategoryByKeyword(age: number, categoryNames: string[]): string {
  const ageCats = categoryNames.filter((name) => AGE_PATTERNS.some((re) => re.test(name)))

  for (const name of ageCats) {
    if (age <= 15 && (/15\s*(and\s*)?below/i.test(name) || /youth/i.test(name))) return name
    if (age >= 16 && age <= 18 && (/16[-–]18/i.test(name) || /junior/i.test(name))) return name
    if (age >= 19 && age <= 22 && (/19[-–]22/i.test(name) || /under\s*23/i.test(name) || /u23/i.test(name))) return name
    if (age >= 23 && age <= 34 && (/23[-–]34/i.test(name) || /masters?\s*a/i.test(name))) return name
    if (age >= 35 && age <= 44 && (/35[-–]44/i.test(name) || /masters?\s*b/i.test(name))) return name
    if (age >= 45 && age <= 54 && (/45[-–]54/i.test(name) || /masters?\s*c/i.test(name))) return name
    if (age >= 55 && (/55\s*(and\s*)?above/i.test(name) || /masters?\s*d/i.test(name))) return name
  }

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

/**
 * Returns the earliest created_at timestamp (in ms) among all categories in the group.
 * Used to sort discipline groups dynamically — whichever discipline had its first category
 * created earliest appears first. No hardcoded order.
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

  // ── Event Types ────────────────────────────────────────────────────────────
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
          setEventTypes(rawSlugs.map((slug) => ({ slug, name: formatSlug(slug) })))
        } else {
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

  /** One race category per discipline (radio behavior). */
  const selectCategoryRadio = (raceCategoryId: string) => {
    setSelectedCategoryIds([raceCategoryId])
    clearFieldError('category')
  }

  // ── Race Categories ────────────────────────────────────────────────────────
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

        // Sort individual rows by created_at ascending
        const rowsSorted = [...(data as RaceCategory[])].sort((a, b) => {
          const ta = a.created_at ? new Date(a.created_at).getTime() : 0
          const tb = b.created_at ? new Date(b.created_at).getTime() : 0
          return ta - tb
        })

        // Build a map of discipline → its earliest created_at (i.e. when the
        // first category in that discipline was ever added). This is the true
        // insertion order of each discipline, regardless of how many categories
        // were added to it later.
        const disciplineFirstSeen = new Map<string, number>()
        for (const row of rowsSorted) {
          const disc = (row.discipline ?? '').trim() || 'General'
          if (!disciplineFirstSeen.has(disc)) {
            const t = row.created_at ? new Date(row.created_at).getTime() : 0
            disciplineFirstSeen.set(disc, t)
          }
        }

        // Group rows by discipline (categories within each group are already
        // in created_at order because rowsSorted is sorted ascending).
        const groupMap = new Map<string, RaceCategory[]>()
        for (const row of rowsSorted) {
          const disc = (row.discipline ?? '').trim() || 'General'
          if (!groupMap.has(disc)) groupMap.set(disc, [])
          groupMap.get(disc)!.push(row)
        }

        // Sort discipline groups by the timestamp of their very first category —
        // whichever discipline had a category created first appears first (leftmost).
        const groups: DisciplineGroup[] = Array.from(groupMap.entries())
          .map(([discipline, categories]) => ({ discipline, categories }))
          .sort((a, b) => (disciplineFirstSeen.get(a.discipline) ?? 0) - (disciplineFirstSeen.get(b.discipline) ?? 0))

        setDisciplineGroups(groups)

        // Default to whichever discipline sorts first (earliest created_at).
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

  const disciplineGroupsForRider = useMemo(() => {
    if (!form.gender.trim()) return []
    return disciplineGroups
      .map((g) => ({
        discipline: g.discipline,
        categories: g.categories.filter((c) => categoryMatchesRiderGenderInDiscipline(c, form.gender, g.categories)),
      }))
      .filter((g) => g.categories.length > 0)
      // Preserve the same created_at-based order from disciplineGroups
      .sort((a, b) => {
        const ai = disciplineGroups.findIndex((g) => g.discipline === a.discipline)
        const bi = disciplineGroups.findIndex((g) => g.discipline === b.discipline)
        return ai - bi
      })
  }, [disciplineGroups, form.gender])

  const currentDisciplineGroup = useMemo(
    () => disciplineGroupsForRider.find((g) => g.discipline === form.discipline) ?? null,
    [disciplineGroupsForRider, form.discipline],
  )

  const categoriesEligibleForRider = useMemo(
    () => currentDisciplineGroup?.categories ?? [],
    [currentDisciplineGroup],
  )

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

  const hasAgeCategories = useMemo(
    () => disciplineHasAgeCategories(currentCategoryNames),
    [currentCategoryNames],
  )

  const raceAge = useMemo(() => computeRaceAge(form.birthDate), [form.birthDate])

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
      errors.category = 'No disciplines or categories are available for your gender. Please contact the organizer.'
    } else if (form.gender.trim() && categoriesEligibleForRider.length === 0) {
      errors.category = 'No categories are available for your gender in this discipline. Please contact the organizer.'
    } else if (selectedCategoryIdsInDiscipline.length === 0) {
      errors.category = 'Please select a category.'
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

  function formatPhilippinePhone(raw: string): string {
  // Strip everything except digits and leading +
  let digits = raw.replace(/[^\d]/g, '')
  // Normalize: if starts with 63, strip it; if starts with 0, strip it
  if (digits.startsWith('63')) digits = digits.slice(2)
  if (digits.startsWith('0')) digits = digits.slice(1)
  // Keep only up to 10 digits (9XXXXXXXXX)
  digits = digits.slice(0, 10)
  // Format as 9XX XXX XXXX
  const p1 = digits.slice(0, 3)   // 9XX
  const p2 = digits.slice(3, 6)   // XXX
  const p3 = digits.slice(6, 10)  // XXXX
  let formatted = p1
  if (p2) formatted += ' ' + p2
  if (p3) formatted += ' ' + p3
  return formatted ? '+63 ' + formatted : ''
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
          <div className={`${cardClass} space-y-4`}>
            <ShimmerBar className="h-4 w-24" />
            <ShimmerBar className="h-3 w-48" />
            <div className="flex gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="w-40 overflow-hidden rounded-xl border border-slate-200">
                  <div className="aspect-square w-full animate-pulse bg-slate-200" />
                  <div className="flex items-center gap-2 bg-white px-3 py-2">
                    <div className="h-4 w-4 animate-pulse rounded bg-slate-200" />
                    <div className="h-3 w-20 animate-pulse rounded bg-slate-200" />
                  </div>
                </div>
              ))}
            </div>
          </div>
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

          {/* ── Event Types with images ──────────────────────────────────── */}
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
              <div className="flex flex-wrap gap-3">
                {eventTypes.map((et) => {
                  const checked = selectedEventTypeSlugs.includes(et.slug)
                  const imgSrc = EVENT_TYPE_IMAGES[et.slug]
                  return (
                    <button
                      key={et.slug}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => toggleEventType(et.slug)}
                      className={`relative w-40 overflow-hidden rounded-xl border-2 text-left transition-all focus:outline-none ${
                        checked
                          ? 'border-[#cfae3f] shadow-md'
                          : 'border-slate-200 hover:border-[#cfae3f]/60'
                      }`}
                    >
                      {/* Event type image */}
                      {imgSrc && (
                        <div className="aspect-square w-full overflow-hidden bg-slate-100">
                          <img
                            src={imgSrc}
                            alt={et.name}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )}

                      {/* Label row */}
                      <div
                        className={`flex items-center gap-2 px-3 py-2 ${
                          checked ? 'bg-[#fff6d6]' : 'bg-white'
                        }`}
                      >
                        {/* Custom checkbox */}
                        <span
                          aria-hidden="true"
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 text-xs transition-all ${
                            checked
                              ? 'border-[#cfae3f] bg-[#cfae3f] text-black'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {checked ? '✓' : ''}
                        </span>
                        <span className="truncate text-xs font-semibold text-slate-800">{et.name}</span>
                      </div>

                      {/* Selected overlay border glow */}
                      {checked && (
                        <span className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-[#cfae3f]/40" />
                      )}
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
          <div className="md:col-span-2">
            <Field
              label={<>Date Of Birth <span className="text-rose-500">*</span></>}
              type="date"
              value={form.birthDate}
              error={fieldErrors.birthDate}
              onChange={(v) => updateFormField('birthDate', v)}
            />
          </div>
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
            onChange={(v) => updateFormField('contactNumber', formatPhilippinePhone(v))}
          />
          <Field
            label={<>Emergency Contact Name <span className="text-rose-500">*</span></>}
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
          onChange={(v) => updateFormField('emergencyContactNumber', formatPhilippinePhone(v))}
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
                Select your gender first to see the categories available to you.
              </p>
            ) : null}
          </div>

          {categoriesLoading ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="h-8 w-28 animate-pulse rounded-full bg-slate-200" />
                <div className="h-8 w-32 animate-pulse rounded-full bg-slate-200" />
              </div>
              <div className="grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-200" />
                ))}
              </div>
            </div>
          ) : disciplineGroups.length === 0 ? (
            <p className="text-xs text-rose-600">No categories configured for this event.</p>
          ) : (
            (() => {
              // Use gender-filtered groups when gender is set, otherwise show all groups unfiltered
              const noGender = !form.gender.trim()
              const visibleGroups = noGender ? disciplineGroups : disciplineGroupsForRider
              const currentGroup = noGender
                ? disciplineGroups.find((g) => g.discipline === form.discipline) ?? disciplineGroups[0] ?? null
                : currentDisciplineGroup
              const visibleCategories = currentGroup?.categories ?? []

              if (!noGender && disciplineGroupsForRider.length === 0) {
                return (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                    No categories are available for {form.gender} riders in this event. Please get in touch with the organizer for assistance.
                  </p>
                )
              }

              return (
                <div className="space-y-4">
                  {/* Discipline tabs */}
                  {visibleGroups.length > 1 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Discipline</p>
                      <div className="flex flex-wrap gap-2">
                        {visibleGroups.map((g) => {
                          const active = form.discipline === g.discipline
                          return (
                            <button
                              key={g.discipline}
                              type="button"
                              onClick={() => {
                                setForm((p) => ({ ...p, discipline: g.discipline }))
                                const allowed = new Set(g.categories.map((c) => c.id))
                                setSelectedCategoryIds((prev) => prev.filter((id) => allowed.has(id)).slice(0, 1))
                              }}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold transition-all ${
                                active
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

                  {visibleGroups.length === 1 && (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-[#cfae3f] bg-[#fff6d6] px-3 py-1 text-sm font-semibold text-slate-800">
                        {visibleGroups[0].discipline}
                      </span>
                    </div>
                  )}

                  {/* Category grid */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {hasAgeCategories ? (
                        <>Age / Class Category <span className="text-rose-500 normal-case font-normal tracking-normal">*</span></>
                      ) : (
                        <>Race category <span className="text-rose-500 normal-case font-normal tracking-normal">*</span></>
                      )}
                    </p>

                    {/* Friendly message for female riders when there are no age brackets — no jargon */}
                    {!noGender && form.gender.trim().toLowerCase() === 'female' && !hasAgeCategories && visibleCategories.length > 0 && (
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
                        There's one category for women in this discipline — select it below and it'll apply to all event types you choose.
                      </p>
                    )}

                    {!noGender && form.gender && visibleCategories.length === 0 && (
                     <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                      No categories available for {form.gender} riders in this discipline. Try another discipline or reach out to the organizer for help.
                    </p>
                    )}

                    <div
                      role="radiogroup"
                      aria-label={hasAgeCategories ? 'Age or class category' : 'Race category'}
                      className={`grid grid-cols-1 gap-2 sm:grid-cols-2 rounded-xl border p-3 ${fieldErrors.category ? 'border-rose-400 bg-rose-50/40' : 'border-slate-200 bg-slate-50/60'}`}
                    >
                      {visibleCategories.map((cat) => {
                        const checked = !noGender && selectedCategoryIds.includes(cat.id)
                        const disabled = noGender
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            disabled={disabled}
                            onClick={() => !disabled && selectCategoryRadio(cat.id)}
                            className={`group relative flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition-all ${
                              disabled
                                ? 'cursor-default border-slate-200 bg-white text-slate-400'
                                : checked
                                  ? 'border-[#cfae3f] bg-[#fff6d6] text-slate-900 shadow-sm'
                                  : 'border-slate-200 bg-white text-slate-600 hover:border-[#cfae3f]/60 hover:bg-[#fffdf0] hover:text-slate-900'
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                                disabled
                                  ? 'border-slate-200 bg-slate-100'
                                  : checked
                                    ? 'border-[#cfae3f] bg-white'
                                    : 'border-slate-300 bg-white group-hover:border-[#cfae3f]/70'
                              }`}
                            >
                              {checked && !disabled && (
                                <span className="h-2.5 w-2.5 rounded-full bg-[#cfae3f]" />
                              )}
                            </span>
                            <span className="flex-1 leading-snug">{cat.category_name}</span>
                          </button>
                        )
                      })}
                    </div>

                    {/* Prompt to select gender when no gender yet */}
                    {noGender && (
                      <p className="text-xs text-slate-500">
                      Select your gender above to see available categories.
                    </p>
                    )}

                    {fieldErrors.category && (
                      <p className="text-xs text-rose-500">{fieldErrors.category}</p>
                    )}
                  </div>
                </div>
              )
            })()
          )}

          {hasAgeCategories && form.birthDate && suggestedAgeCategory && (
            <div className="flex flex-col gap-2 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3.5">
              <div className="flex items-start gap-2.5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                ℹ
              </span>
              <div className="text-xs text-slate-700 leading-relaxed">
                You'll be racing as age <span className="font-bold text-slate-900">{raceAge}</span> this year.
                Based on that, we suggest:{' '}
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
            className="inline-flex w-full items-center justify-center rounded-md bg-[#cfae3f] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#dab852] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Proceed to Checkout'}
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
    <div className="min-w-0 w-full space-y-2 overflow-hidden">
      <label className="text-sm font-semibold text-slate-900">{label}</label>
      <input
        value={value}
        type={type}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`box-border block w-full min-w-0 max-w-full appearance-none rounded-md border bg-white px-3 text-base leading-normal text-slate-900 outline-none focus:border-[#cfae3f] sm:text-sm ${
          type === 'date' ? 'h-11 min-h-[44px]' : 'h-11 sm:h-10'
        } ${error ? 'border-rose-400' : 'border-slate-300'}`}
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
    <div className="min-w-0 w-full space-y-2 overflow-hidden">
      <label className="text-sm font-semibold text-slate-900">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`block h-11 w-full max-w-full rounded-md border bg-white px-3 text-base leading-normal text-slate-900 outline-none focus:border-[#cfae3f] sm:h-10 sm:text-sm ${
          error ? 'border-rose-400' : 'border-slate-300'
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