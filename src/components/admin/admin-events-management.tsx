import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  CalendarDays, CheckCircle2, Clock3, Filter, MapPinned,
  Pencil, Plus, Search, Trash2, UploadCloud, Users, X, ChevronLeft,
  ChevronRight, Copy, Trophy, UserCheck, Image, CheckCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { adminModulesApi } from '../../services/adminModulesApi'
import { ModuleShell, formatDate, formatMoney, useModuleLoader } from './admin-module-shared'

// ─── Types ───────────────────────────────────────────────────────────────────
type Step = 1 | 2 | 3 | 4

interface EventFormState {
  title: string
  description: string
  race_type: string
  race_types: string[]
  venue: string
  city: string
  event_date: string
  end_date: string
  start_time: string
  end_time: string
  google_maps_link: string
  registration_deadline: string
  registration_fee: string
}

interface ExtraFormState {
  prizePool: string
  totalPrize: string
  prizeDesc: string
  orgName: string
  orgEmail: string
  orgPhone: string
  orgWebsite: string
  bibInstructions: string
}

type AdminEventRow = Record<string, unknown>

type CategoryGenderEligibility = 'all' | 'male' | 'female'

interface DisciplineCategory {
  id: string
  name: string
  code: string
  riderLimit: string
  active: boolean
  /** Stored as race_categories.gender_eligibility */
  genderEligibility: CategoryGenderEligibility
}

interface Discipline {
  id: string
  name: string
  categories: DisciplineCategory[]
}

interface EventType {
  slug: string
  name: string
  active: boolean
  event_code?: string | null
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function combineDateAndTime(dateValue: string, timeValue?: string) {
  if (!dateValue) return null
  const finalTime = timeValue && timeValue.trim().length > 0 ? timeValue : '00:00'
  const [y, m, d] = dateValue.split('-').map((p) => Number.parseInt(p, 10))
  const [hh, mm] = finalTime.split(':').map((p) => Number.parseInt(p, 10))
  if (![y, m, d, hh, mm].every(Number.isFinite)) return null
  // Inputs are PH local date/time (Asia/Manila, UTC+8). Convert to UTC ISO for storage.
  const utcMillis = Date.UTC(y, (m || 1) - 1, d || 1, (hh || 0) - 8, mm || 0, 0)
  return new Date(utcMillis).toISOString()
}

async function uploadToBucket(bucket: string, file: File | null) {
  if (!file) return null
  const extension = file.name.split('.').pop()?.toLowerCase() || 'bin'
  const path = `events/${crypto.randomUUID()}.${extension}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false })
  if (error) throw error
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}

function formatTime(value: unknown) {
  if (!value) return '—'
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('en-PH', { 
    hour: 'numeric', 
    minute: '2-digit',
    timeZone: 'Asia/Manila'
  })
}

function toDateInputValue(value: unknown) {
  if (!value) return ''
  const raw = String(value).trim()
  const isoLike = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoLike && !raw.includes('T')) return isoLike[1]
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  // Render using PH timezone to avoid date shifting on edit.
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function toTimeInputValue(value: unknown) {
  if (!value) return ''
  const raw = String(value).trim()
  const isoLike = raw.match(/T(\d{2}:\d{2})/)
  if (isoLike && !/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) return isoLike[1]
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const hh = String(shifted.getUTCHours()).padStart(2, '0')
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function toDateTimeLocalValue(value: unknown) {
  if (!value) return ''
  const raw = String(value).trim()
  const isoLike = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  if (isoLike && !/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) return `${isoLike[1]}T${isoLike[2]}`
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  const hh = String(shifted.getUTCHours()).padStart(2, '0')
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${hh}:${mm}`
}

/** Venue is saved as "Place, City" when city is set — split for editing. */
function parseVenueCity(storedVenue: string): { venue: string; city: string } {
  const v = String(storedVenue ?? '').trim()
  const idx = v.lastIndexOf(', ')
  if (idx <= 0) return { venue: v, city: '' }
  return { venue: v.slice(0, idx).trim(), city: v.slice(idx + 2).trim() }
}

/** Multiple event types are stored as comma-separated slugs in `race_type`. */
function parseRaceTypeSlugs(row: Record<string, unknown> | null | undefined): string[] {
  if (!row) return []
  const multi = row.race_types
  if (Array.isArray(multi)) return multi.map(String).map((s) => s.trim()).filter(Boolean)
  const raw = String(row.race_type ?? '').trim()
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function parsePrizePoolFields(prizePool: unknown): { totalPrize: string; prizeDesc: string } {
  const ppStr = typeof prizePool === 'string' ? prizePool.trim() : ''
  if (!ppStr) return { totalPrize: '', prizeDesc: '' }
  if (ppStr.startsWith('Total:')) {
    const rest = ppStr.replace(/^Total:\s*/i, '')
    const pipe = rest.indexOf('|')
    if (pipe >= 0) {
      return {
        totalPrize: rest.slice(0, pipe).trim(),
        prizeDesc: rest.slice(pipe + 1).trim(),
      }
    }
    return { totalPrize: rest, prizeDesc: '' }
  }
  return { totalPrize: '', prizeDesc: ppStr }
}

function pickNextEventTypeCode(rows: Array<{ event_code?: string | null }>): string {
  const used = new Set<number>()
  for (const row of rows) {
    const n = Number.parseInt(String(row.event_code ?? '').trim(), 10)
    if (Number.isFinite(n) && n > 0) used.add(n)
  }
  for (let n = 1; n <= 999; n += 1) {
    if (!used.has(n)) return String(n)
  }
  throw new Error('No available event code left (1-999).')
}

// ─── Step indicator ──────────────────────────────────────────────────────────
const STEPS = ['Event Information', 'Disciplines & Categories', 'Additional Information', 'Review & Publish']

function StepTab({ step, current }: { step: number; current: Step }) {
  const done = step < current
  const active = step === current
  return (
    <div className={`flex items-center gap-2 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${active ? 'border-blue-600 text-blue-700' : done ? 'border-blue-300 text-blue-500' : 'border-transparent text-slate-400'}`}>
      {done ? (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white"><CheckCheck className="h-3 w-3" /></span>
      ) : (
        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${active ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>{step}</span>
      )}
      {STEPS[step - 1]}
    </div>
  )
}

function UploadField({
  title,
  subtitle,
  accept = 'image/*',
  compact = false,
  value,
  onChange,
  currentUrl,
}: {
  title: string
  subtitle: string
  accept?: string
  compact?: boolean
  value: File | null
  onChange: (file: File | null) => void
  currentUrl?: string | null
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [remoteUrlBust, setRemoteUrlBust] = useState(0)

  useEffect(() => {
    if (!value) {
      setTimeout(() => setPreviewUrl(null), 0)
      return
    }
    const url = URL.createObjectURL(value)
    const t = setTimeout(() => setPreviewUrl(url), 0)
    return () => {
      clearTimeout(t)
      URL.revokeObjectURL(url)
    }
  }, [value])

  useEffect(() => {
    if (!currentUrl) {
      setTimeout(() => setRemoteUrlBust(0), 0)
      return
    }
    setTimeout(() => setRemoteUrlBust(Date.now()), 0)
  }, [currentUrl])

  // New file preview takes priority; existing remote URL gets a cache-busting param
  const displayUrl = previewUrl ?? (currentUrl ? `${currentUrl}?t=${remoteUrlBust}` : null)

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    onChange(files[0])
  }

  if (compact) {
    return (
      <div className="space-y-1.5">
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
          className={`flex h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 text-center transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50'}`}
        >
          <UploadCloud className="h-4 w-4 text-slate-400" />
          <div>
            <p className="text-xs text-slate-600">{title}</p>
            <p className="text-[10px] text-slate-400">{value ? value.name : subtitle}</p>
          </div>
        </div>
        {displayUrl && (
          <div className="relative h-20 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
            <img
              src={displayUrl}
              alt="Preview"
              className="h-full w-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute right-1 top-1 rounded-full bg-white/80 p-0.5 text-slate-500 shadow hover:bg-white hover:text-red-500 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {displayUrl ? (
        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100" style={{ minHeight: '13rem' }}>
          <img
            src={displayUrl}
            alt="Preview"
            className="h-full w-full object-cover"
            style={{ minHeight: '13rem', maxHeight: '18rem' }}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
          <div className="absolute inset-0 flex items-end justify-between bg-gradient-to-t from-black/40 to-transparent p-3">
            <p className="max-w-[70%] truncate text-[10px] text-white/80">{value ? value.name : 'Current image'}</p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-md bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-white transition-colors"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="rounded-md bg-red-500/90 px-2 py-1 text-[10px] font-semibold text-white hover:bg-red-600 transition-colors"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
          className={`flex min-h-52 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 text-center transition-colors ${dragging ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-slate-50 hover:border-blue-300 hover:bg-blue-50'}`}
        >
          <UploadCloud className="h-9 w-9 text-slate-400" />
          <div>
            <p className="text-sm text-slate-600">{title}</p>
            <p className="text-[10px] text-slate-400">{subtitle}</p>
          </div>
        </div>
      )}
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => handleFiles(e.target.files)} />
    </div>
  )
}

// ─── Step 1 ──────────────────────────────────────────────────────────────────
function Step1({
  form,
  setForm,
  posterFile,
  setPosterFile,
  routeMapFile,
  setRouteMapFile,
  currentPosterUrl,
  currentRouteMapUrl,
  eventTypes,
  eventTypesLoading,
  onAddEventType,
  onDeleteEventType,
  newEventTypeName,
  setNewEventTypeName,
}: {
  form: EventFormState
  setForm: Dispatch<SetStateAction<EventFormState>>
  posterFile: File | null
  setPosterFile: (file: File | null) => void
  routeMapFile: File | null
  setRouteMapFile: (file: File | null) => void
  currentPosterUrl?: string | null
  currentRouteMapUrl?: string | null
  eventTypes: EventType[]
  eventTypesLoading: boolean
  onAddEventType: () => void
  onDeleteEventType: (slug: string) => void
  newEventTypeName: string
  setNewEventTypeName: Dispatch<SetStateAction<string>>
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-3 text-sm font-semibold text-slate-800">Basic Information</p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="block">
              <p className="mb-1 text-xs font-medium text-slate-600">Event Title <span className="text-red-500">*</span></p>
              <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="Enter event title" value={form.title} onChange={(e) => setForm((v) => ({ ...v, title: e.target.value }))} />
            </label>
            <label className="block">
              <p className="mb-1 text-xs font-medium text-slate-600">Event Description <span className="text-red-500">*</span></p>
              <textarea
                className="min-h-[7rem] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
                placeholder="Tell us about your event..."
                value={form.description}
                onChange={(e) => setForm((v) => ({ ...v, description: e.target.value }))}
              />
              <p className="mt-0.5 text-right text-[10px] text-slate-400">{form.description.length} / 1000</p>
            </label>
            <label className="block">
              <p className="mb-1 text-xs font-medium text-slate-600">Event Type <span className="text-red-500">*</span></p>
              <div className="space-y-2">
                {eventTypesLoading ? <p className="text-xs text-slate-500">Loading event types…</p> : null}
                <div className="flex flex-wrap items-center gap-3">
                  {eventTypes.map((t) => {
                    const uiSelected: string[] = Array.isArray(form.race_types) ? (form.race_types as string[]) : []
                    const checked = uiSelected.includes(t.slug)
                      ? true
                      : (!uiSelected.length && String(form.race_type ?? '') === t.slug)
                    return (
                      <label
                        key={t.slug}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                          checked ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          name="event_type"
                          checked={checked}
                          onChange={(e) => {
                            setForm((v) => {
                              const prev: string[] = Array.isArray(v.race_types) ? v.race_types : []
                              const set = new Set(prev)
                              if (e.target.checked) set.add(t.slug)
                              else set.delete(t.slug)
                              const next = Array.from(set)

                              // `race_type` stores comma-separated slugs; primary slug is first for legacy lookups.
                              const nextRaceType = next.length ? next[0] : ''
                              return { ...v, race_types: next, race_type: nextRaceType }
                            })
                          }}
                          disabled={eventTypesLoading}
                          className="sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className={`flex h-4 w-4 items-center justify-center rounded border ${
                            checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-transparent'
                          }`}
                        >
                          ✓
                        </span>
                        <span className="whitespace-nowrap">{t.name}</span>
                        <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                          Code: {String(t.event_code ?? '—')}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onDeleteEventType(t.slug)
                          }}
                          className="ml-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                          title={`Remove ${t.name}`}
                          aria-label={`Remove ${t.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </label>
                    )
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <input
                    value={newEventTypeName}
                    onChange={(e) => setNewEventTypeName(e.target.value)}
                    placeholder="New event type name"
                    className="h-9 min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => onAddEventType()}
                    disabled={eventTypesLoading}
                    className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    title="Add new event type"
                  >
                    <Plus className="h-4 w-4" />
                    <span className="ml-2 text-xs font-semibold">Add</span>
                  </button>
                </div>
              </div>
            </label>
            <label className="block">
              <p className="mb-1 text-xs font-medium text-slate-600">Registration Fee (PHP)</p>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                type="number"
                min="0"
                value={form.registration_fee}
                onChange={(e) => setForm((v) => ({ ...v, registration_fee: e.target.value }))}
              />
            </label>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-slate-600">Event Poster / Banner <span className="text-red-500">*</span></p>
            <UploadField
              title="Drag and drop image here"
              subtitle="Recommended size: 1200x628px (2:1), JPG/PNG up to 5MB"
              value={posterFile}
              onChange={setPosterFile}
              currentUrl={currentPosterUrl}
            />
          </div>
        </div>
      </div>

      <div>
        <p className="mb-3 text-sm font-semibold text-slate-800">Date, Time & Location</p>
        <div className="grid gap-3 md:grid-cols-4">
          <label>
            <p className="mb-1 text-xs font-medium text-slate-600">Start Date <span className="text-red-500">*</span></p>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" type="date" value={form.event_date} onChange={(e) => setForm((v) => ({ ...v, event_date: e.target.value }))} />
          </label>
          <label>
            <p className="mb-1 text-xs font-medium text-slate-600">End Date (Optional)</p>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              type="date"
              value={form.end_date}
              onChange={(e) => setForm((v) => ({ ...v, end_date: e.target.value }))}
            />
          </label>
          <label>
            <p className="mb-1 text-xs font-medium text-slate-600">Start Time <span className="text-red-500">*</span></p>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" type="time" value={form.start_time} onChange={(e) => setForm((v) => ({ ...v, start_time: e.target.value }))} />
          </label>
          <label>
            <p className="mb-1 text-xs font-medium text-slate-600">End Time <span className="text-red-500">*</span></p>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" type="time" value={form.end_time} onChange={(e) => setForm((v) => ({ ...v, end_time: e.target.value }))} />
          </label>
          <label className="md:col-span-3">
            <p className="mb-1 text-xs font-medium text-slate-600">Venue / Location <span className="text-red-500">*</span></p>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="Enter venue or location" value={form.venue} onChange={(e) => setForm((v) => ({ ...v, venue: e.target.value }))} />
          </label>
          <label>
            <p className="mb-1 text-xs font-medium text-slate-600">City / Province <span className="text-red-500">*</span></p>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="Enter city or province" value={form.city} onChange={(e) => setForm((v) => ({ ...v, city: e.target.value }))} />
          </label>
          <label>
            <p className="mb-1 text-xs font-medium text-slate-600">Route Map (Optional)</p>
            <UploadField
              title="Upload route map image"
              subtitle="PNG, JPG up to 5MB"
              compact
              value={routeMapFile}
              onChange={setRouteMapFile}
              currentUrl={currentRouteMapUrl}
            />
          </label>
          <label className="md:col-span-3">
            <p className="mb-1 text-xs font-medium text-slate-600">Google Maps Link (Optional)</p>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="https://maps.google.com/..." value={form.google_maps_link} onChange={(e) => setForm((v) => ({ ...v, google_maps_link: e.target.value }))} />
            <p className="mt-0.5 text-[10px] text-slate-400">Paste a Google Maps link for your event venue or route.</p>
          </label>
          <label className="md:col-span-3">
            <p className="mb-1 text-xs font-medium text-slate-600">Registration Deadline <span className="text-red-500">*</span></p>
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              type="datetime-local"
              value={form.registration_deadline}
              onChange={(e) => setForm((v) => ({ ...v, registration_deadline: e.target.value }))}
            />
          </label>
        </div>
      </div>
    </div>
  )
}

// ─── Step 2 ──────────────────────────────────────────────────────────────────
const CATEGORY_PREVIEW_LIMIT = 3

/** Roughly three category rows before the list scrolls (Step 2 categories block). */
const CATEGORY_SCROLL_MAX_HEIGHT_REM = 28

function Step2({
  disciplines,
  setDisciplines,
  disciplinesLoading,
}: {
  disciplines: Discipline[]
  setDisciplines: React.Dispatch<React.SetStateAction<Discipline[]>>
  disciplinesLoading?: boolean
}) {
  const addDiscipline = () => {
    setDisciplines((prev) => [{ id: crypto.randomUUID(), name: '', categories: [] }, ...prev])
  }

  const removeDiscipline = (id: string) => setDisciplines((prev) => prev.filter((d) => d.id !== id))

  const updateDiscipline = (id: string, value: Partial<Discipline>) => {
    setDisciplines((prev) => prev.map((d) => (d.id === id ? { ...d, ...value } : d)))
  }

  const addCategoryToDiscipline = (disciplineId: string) => {
    setDisciplines((prev) =>
      prev.map((d) =>
        d.id !== disciplineId
          ? d
          : {
            ...d,
            categories: [
              {
                id: crypto.randomUUID(),
                name: '',
                code: '',
                riderLimit: '',
                active: true,
                genderEligibility: 'all',
              },
              ...d.categories,
            ],
          },
      ),
    )
  }

  const removeCategoryFromDiscipline = (disciplineId: string, categoryId: string) => {
    setDisciplines((prev) =>
      prev.map((d) => (d.id !== disciplineId ? d : { ...d, categories: d.categories.filter((c) => c.id !== categoryId) })),
    )
  }

  const updateCategoryInDiscipline = (
    disciplineId: string,
    categoryId: string,
    value: Partial<DisciplineCategory>,
  ) => {
    setDisciplines((prev) =>
      prev.map((d) =>
        d.id !== disciplineId
          ? d
          : {
            ...d,
            categories: d.categories.map((c) => (c.id === categoryId ? { ...c, ...value } : c)),
          },
      ),
    )
  }

  const totalCategories = disciplines.reduce((sum, d) => sum + d.categories.length, 0)
  const totalRiderLimit = disciplines.reduce(
    (sum, d) => sum + d.categories.reduce((s, c) => s + Number(c.riderLimit || 0), 0),
    0,
  )

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">Event Disciplines & Categories</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Add disciplines first, then add categories under each discipline. Registration fee is set in Step 1.
          </p>
        </div>
        <button
          type="button"
          onClick={addDiscipline}
          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Add Discipline
        </button>
      </div>

      {disciplinesLoading ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Loading disciplines & categories…
        </div>
      ) : null}

      <div className="space-y-3">
        {disciplines.map((disc) => (
          <div key={disc.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div className="flex-1 space-y-2">
                <p className="text-sm font-semibold text-slate-800">{disc.name || 'New Discipline'}</p>
                <label>
                  <p className="mb-1 text-[10px] font-medium text-slate-500">
                    Discipline Name <span className="text-red-500">*</span>
                  </p>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder="e.g. Mountain Bike"
                    value={disc.name}
                    onChange={(e) => updateDiscipline(disc.id, { name: e.target.value })}
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => removeDiscipline(disc.id)}
                className="rounded-lg border border-red-100 p-1.5 text-red-400 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">Categories</p>
              <button
                type="button"
                onClick={() => addCategoryToDiscipline(disc.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Add Category
              </button>
            </div>

            {disc.categories.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                No categories yet. Add at least one category under this discipline.
              </div>
            ) : (
              <div
                className="space-y-3 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]"
                style={{ maxHeight: `${CATEGORY_SCROLL_MAX_HEIGHT_REM}rem` }}
              >
                {disc.categories.map((cat) => (
                  <div key={cat.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label>
                        <p className="mb-1 text-[10px] font-medium text-slate-500">
                          Category Name <span className="text-red-500">*</span>
                        </p>
                        <input
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          placeholder="e.g. Youth / Open / Heavyweight"
                          value={cat.name}
                          onChange={(e) => updateCategoryInDiscipline(disc.id, cat.id, { name: e.target.value })}
                        />
                      </label>
                      <label>
                        <p className="mb-1 text-[10px] font-medium text-slate-500">Category Code</p>
                        <input
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          placeholder="e.g. YOUTH_OPEN"
                          value={cat.code}
                          onChange={(e) => updateCategoryInDiscipline(disc.id, cat.id, { code: e.target.value })}
                        />
                      </label>
                      <label>
                        <p className="mb-1 text-[10px] font-medium text-slate-500">Rider Limit</p>
                        <input
                          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          type="number"
                          placeholder="150"
                          value={cat.riderLimit}
                          onChange={(e) => updateCategoryInDiscipline(disc.id, cat.id, { riderLimit: e.target.value })}
                        />
                      </label>
                      <label>
                        <p className="mb-1 text-[10px] font-medium text-slate-500">Eligibility</p>
                        <select
                          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                          value={cat.genderEligibility}
                          onChange={(e) =>
                            updateCategoryInDiscipline(disc.id, cat.id, {
                              genderEligibility: e.target.value as CategoryGenderEligibility,
                            })
                          }
                        >
                          <option value="all">All genders</option>
                          <option value="male">Male only</option>
                          <option value="female">Female only</option>
                        </select>
                      </label>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateCategoryInDiscipline(disc.id, cat.id, { active: !cat.active })}
                          className={`relative h-5 w-9 rounded-full transition-colors ${cat.active ? 'bg-blue-600' : 'bg-slate-300'}`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${cat.active ? 'translate-x-4' : ''}`}
                          />
                        </button>
                        <span className="text-xs text-slate-600">{cat.active ? 'Active' : 'Inactive'}</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeCategoryFromDiscipline(disc.id, cat.id)}
                        className="rounded-lg border border-red-100 p-1.5 text-red-400 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {disciplines.length > 0 && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 space-y-1.5">
          <p>ℹ️ Rider limit is the maximum number of participants allowed for each category.</p>
          <p>
            Paid riders get a <strong>4-digit numeric bib</strong> (class 01–99 + rider 01–99). Each{' '}
            <strong>event type × category</strong> pair gets its own class when you publish; keep (types × categories) ≤ 99.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">Summary</p>
          <p className="text-xs text-slate-500">Total Categories: {totalCategories}</p>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-slate-600">Total Riders (All Categories)</p>
          <p className="text-sm font-bold text-blue-600">{totalRiderLimit.toLocaleString()}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Step 3 ──────────────────────────────────────────────────────────────────
function Step3({
  extra,
  setExtra,
  organizerLogoFile,
  setOrganizerLogoFile,
  currentOrgLogoUrl,
}: {
  extra: ExtraFormState
  setExtra: Dispatch<SetStateAction<ExtraFormState>>
  organizerLogoFile: File | null
  setOrganizerLogoFile: (file: File | null) => void
  currentOrgLogoUrl?: string | null
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1 text-sm font-semibold text-slate-800">Prize Pool</p>
        <p className="mb-3 text-xs text-slate-500">Add prize pool details for your event (optional).</p>
        <div className="space-y-2 mb-3">
          {['none', 'has'].map((opt) => (
            <label key={opt} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" name="prizePool" value={opt} checked={extra.prizePool === opt} onChange={() => setExtra((v) => ({ ...v, prizePool: opt }))} className="accent-blue-600" />
              <span className="text-sm text-slate-700">{opt === 'none' ? 'No prize pool' : 'Has prize pool'}</span>
            </label>
          ))}
        </div>
        {extra.prizePool === 'has' && (
          <div className="space-y-3">
            <label>
              <p className="mb-1 text-xs font-medium text-slate-600">Total Prize Pool (PHP)</p>
              <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="50,000" value={extra.totalPrize} onChange={(e) => setExtra((v) => ({ ...v, totalPrize: e.target.value }))} />
            </label>
            <label>
              <p className="mb-1 text-xs font-medium text-slate-600">Prize Pool Description (Optional)</p>
              <textarea className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none min-h-16" placeholder="e.g., Cash prizes for top 3 finishers per category." value={extra.prizeDesc} onChange={(e) => setExtra((v) => ({ ...v, prizeDesc: e.target.value }))} />
            </label>
          </div>
        )}
      </div>

      <div>
        <p className="mb-3 text-sm font-semibold text-slate-800">Organizer Information</p>
        <div className="space-y-3">
          <label>
            <p className="mb-1 text-xs font-medium text-slate-600">Organizer Name <span className="text-red-500">*</span></p>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="All Out Multisports" value={extra.orgName} onChange={(e) => setExtra((v) => ({ ...v, orgName: e.target.value }))} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label>
              <p className="mb-1 text-xs font-medium text-slate-600">Contact Email <span className="text-red-500">*</span></p>
              <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="email@example.com" value={extra.orgEmail} onChange={(e) => setExtra((v) => ({ ...v, orgEmail: e.target.value }))} />
            </label>
            <label>
              <p className="mb-1 text-xs font-medium text-slate-600">Contact Number <span className="text-red-500">*</span></p>
              <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="0917 123 4567" value={extra.orgPhone} onChange={(e) => setExtra((v) => ({ ...v, orgPhone: e.target.value }))} />
            </label>
          </div>
          <label>
            <p className="mb-1 text-xs font-medium text-slate-600">Website / Social Media (Optional)</p>
            <input className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="https://www.example.com" value={extra.orgWebsite} onChange={(e) => setExtra((v) => ({ ...v, orgWebsite: e.target.value }))} />
          </label>
          <label>
            <p className="mb-1 text-xs font-medium text-slate-600">Organizer Logo (Optional)</p>
            <UploadField
              title="Upload logo"
              subtitle="JPG, PNG up to 2MB"
              compact
              value={organizerLogoFile}
              onChange={setOrganizerLogoFile}
              currentUrl={currentOrgLogoUrl}
            />
          </label>
        </div>
      </div>

      <div>
        <p className="mb-3 text-sm font-semibold text-slate-800">Jersey / Bib Claiming Instructions</p>
        <label>
          <p className="mb-1 text-xs font-medium text-slate-600">Instructions <span className="text-red-500">*</span></p>
          <textarea className="min-h-28 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none" placeholder="Riders may claim their jerseys and bib numbers on:&#10;&#10;June 14, 2025 (Saturday) | 9:00 AM - 5:00 PM&#10;Burham Park Pavilion, Baguio City&#10;&#10;Please bring a valid ID or confirmation email." value={extra.bibInstructions} onChange={(e) => setExtra((v) => ({ ...v, bibInstructions: e.target.value }))} />
          <p className="mt-0.5 text-right text-[10px] text-slate-400">{extra.bibInstructions.length} / 1000</p>
        </label>
      </div>
    </div>
  )
}

// ─── Step 4 ──────────────────────────────────────────────────────────────────
function Step4({
  form,
  disciplines,
  extra,
  posterFile,
  currentPosterUrl,
  routeMapFile,
  currentRouteMapUrl,
  organizerLogoFile,
  currentOrgLogoUrl,
  eventTypes,
}: {
  form: EventFormState
  disciplines: Discipline[]
  extra: ExtraFormState
  posterFile?: File | null
  currentPosterUrl?: string | null
  routeMapFile?: File | null
  currentRouteMapUrl?: string | null
  organizerLogoFile?: File | null
  currentOrgLogoUrl?: string | null
  eventTypes: EventType[]
}) {
  const riderLimitTotal = disciplines.reduce(
    (sum, d) => sum + d.categories.reduce((s, c) => s + Number(c.riderLimit || 0), 0),
    0,
  )

  const [posterPreviewUrl, setPosterPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!posterFile) {
      setTimeout(() => setPosterPreviewUrl(null), 0)
      return
    }
    const url = URL.createObjectURL(posterFile)
    const t = setTimeout(() => setPosterPreviewUrl(url), 0)
    return () => {
      clearTimeout(t)
      URL.revokeObjectURL(url)
    }
  }, [posterFile])

  const displayPosterUrl = posterPreviewUrl ?? currentPosterUrl ?? null

  const [routePreviewUrl, setRoutePreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!routeMapFile) {
      setTimeout(() => setRoutePreviewUrl(null), 0)
      return
    }
    const url = URL.createObjectURL(routeMapFile)
    const t = setTimeout(() => setRoutePreviewUrl(url), 0)
    return () => {
      clearTimeout(t)
      URL.revokeObjectURL(url)
    }
  }, [routeMapFile])

  const [orgLogoPreviewUrl, setOrgLogoPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!organizerLogoFile) {
      setTimeout(() => setOrgLogoPreviewUrl(null), 0)
      return
    }
    const url = URL.createObjectURL(organizerLogoFile)
    const t = setTimeout(() => setOrgLogoPreviewUrl(url), 0)
    return () => {
      clearTimeout(t)
      URL.revokeObjectURL(url)
    }
  }, [organizerLogoFile])

  const displayRouteUrl = routePreviewUrl ?? currentRouteMapUrl ?? null
  const displayOrgLogoUrl = orgLogoPreviewUrl ?? currentOrgLogoUrl ?? null

  const raceTypeLabels = (() => {
    const slugs: string[] = Array.isArray(form.race_types) && form.race_types.length > 0
      ? (form.race_types as string[])
      : form.race_type
        ? String(form.race_type).split(',').map((s) => s.trim()).filter(Boolean)
        : []
    const nameFor = (slug: string) => eventTypes.find((t) => t.slug === slug)?.name ?? slug
    return slugs.map(nameFor).join(', ') || '—'
  })()

  const [reviewCatExpandedByDiscipline, setReviewCatExpandedByDiscipline] = useState<Record<string, boolean>>({})
  const [posterLoadFailed, setPosterLoadFailed] = useState(false)
  useEffect(() => {
    setTimeout(() => setPosterLoadFailed(false), 0)
  }, [displayPosterUrl])

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">Review Your Event</p>
          <p className="text-xs text-slate-500">Please review all details before publishing your event.</p>
        </div>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">Event poster / banner</p>
        <div className="flex gap-4">
          <div className="h-28 w-24 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0 border border-slate-200">
            {displayPosterUrl && !posterLoadFailed ? (
              <img
                src={displayPosterUrl}
                alt="Event poster"
                className="h-full w-full object-cover"
                onError={() => setPosterLoadFailed(true)}
              />
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center gap-1 bg-slate-100 px-1 text-center">
                <Image className="h-6 w-6 text-slate-400" />
                <span className="text-[9px] leading-tight text-slate-500">{displayPosterUrl ? 'Preview unavailable' : 'No image yet'}</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs flex-1">
            <div className="col-span-2 sm:col-span-1"><p className="text-slate-500">Event Types</p><p className="font-medium text-slate-800">{raceTypeLabels}</p></div>
              <div><p className="text-slate-500">Start — End</p><p className="font-medium text-slate-800">{form.event_date ? `${form.event_date} ${form.start_time || '—'} → ${(form.end_date || form.event_date)} ${form.end_time || '—'}` : '—'}</p></div>
            <div><p className="text-slate-500">Venue</p><p className="font-medium text-slate-800">{form.venue ? (form.city ? `${form.venue}, ${form.city}` : form.venue) : '—'}</p></div>
              <div><p className="text-slate-500">Registration Deadline</p><p className="font-medium text-slate-800">{form.registration_deadline || '—'}</p></div>
            <div><p className="text-slate-500">Registration Fee</p><p className="font-medium text-slate-800">PHP {Number(form.registration_fee || 0).toLocaleString()}</p></div>
            <div><p className="text-slate-500">Rider Limit</p><p className="font-medium text-slate-800">{riderLimitTotal.toLocaleString()} Riders (All Categories)</p></div>
            <div className="col-span-2">
              <p className="text-slate-500">Google Maps</p>
              {form.google_maps_link ? (
                <p className="font-medium text-blue-700 truncate"><a href={form.google_maps_link} target="_blank" rel="noreferrer">{form.google_maps_link}</a></p>
              ) : (
                <p className="font-medium text-slate-400">—</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-800 mb-3">Route map & organizer logo</p>
        <div className="flex flex-wrap gap-4">
          {displayRouteUrl ? (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Route Map</p>
              <div className="h-24 w-36 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                <img src={displayRouteUrl} alt="Route map" className="h-full w-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Route Map</p>
              <div className="flex h-24 w-36 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-[10px] text-slate-500 px-2 text-center">
                None uploaded
              </div>
            </div>
          )}
          {displayOrgLogoUrl ? (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Organizer Logo</p>
              <div className="h-24 w-36 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 flex items-center justify-center">
                <img src={displayOrgLogoUrl} alt="Organizer logo" className="max-h-full max-w-full object-contain p-1" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Organizer Logo</p>
              <div className="flex h-24 w-36 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-[10px] text-slate-500 px-2 text-center">
                None uploaded
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-800 mb-3">Disciplines & Categories</p>
        {disciplines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            No disciplines/categorizes were added yet.
          </div>
        ) : (
          <div className="space-y-3">
            {disciplines.map((d) => (
              <div key={d.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-800">{d.name || '—'}</p>
                  <p className="text-[10px] text-slate-500">{d.categories.length} categories</p>
                </div>
                <div className="mt-2 space-y-2">
                  {d.categories.length === 0 ? (
                    <p className="text-xs text-slate-500">No categories.</p>
                  ) : (
                    <>
                      {(reviewCatExpandedByDiscipline[d.id] ? d.categories : d.categories.slice(0, CATEGORY_PREVIEW_LIMIT)).map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-3 text-xs text-slate-700">
                          <span>{c.name || '—'}</span>
                          <span className="text-slate-500">Limit: {Number(c.riderLimit || 0).toLocaleString()}</span>
                        </div>
                      ))}
                      {d.categories.length > CATEGORY_PREVIEW_LIMIT ? (
                        <button
                          type="button"
                          onClick={() =>
                            setReviewCatExpandedByDiscipline((prev) => ({
                              ...prev,
                              [d.id]: !prev[d.id],
                            }))
                          }
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {reviewCatExpandedByDiscipline[d.id]
                            ? 'See less'
                            : `See more (${d.categories.length - CATEGORY_PREVIEW_LIMIT})`}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {extra.prizePool === 'has' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 mb-3"><Trophy className="h-4 w-4 text-amber-500" /><p className="text-sm font-semibold text-slate-800">Prize Pool</p></div>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
            <div><p className="text-slate-500">Total Prize Pool</p><p className="font-medium">PHP {Number(extra.totalPrize || 0).toLocaleString()}</p></div>
            <div><p className="text-slate-500">Description</p><p className="font-medium">{extra.prizeDesc || '—'}</p></div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2 mb-3"><UserCheck className="h-4 w-4 text-blue-500" /><p className="text-sm font-semibold text-slate-800">Organizer Information</p></div>
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
          <div><p className="text-slate-500">Organizer</p><p className="font-medium">{extra.orgName || '—'}</p></div>
          <div><p className="text-slate-500">Contact</p><p className="font-medium">{extra.orgPhone || '—'}</p></div>
          <div><p className="text-slate-500">Email</p><p className="font-medium">{extra.orgEmail || '—'}</p></div>
          <div><p className="text-slate-500">Website / Social</p><p className="font-medium">{extra.orgWebsite || '—'}</p></div>
        </div>
      </div>

      {extra.bibInstructions && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800 mb-2">Jersey / Bib Claiming Instructions</p>
          <p className="text-xs text-slate-600 whitespace-pre-line">{extra.bibInstructions}</p>
        </div>
      )}
    </div>
  )
}

// ─── Modal ───────────────────────────────────────────────────────────────────
function CreateEventModal({
  onClose,
  onSave,
  mode = 'create',
  initialEvent,
}: {
  onClose: () => void
  onSave: () => void | Promise<void>
  mode?: 'create' | 'edit'
  initialEvent?: AdminEventRow
}) {
  const [step, setStep] = useState<Step>(1)
  const [saving, setSaving] = useState(false)
  const initialVenueParts = parseVenueCity(String(initialEvent?.venue ?? ''))
  const initialSlugs = parseRaceTypeSlugs(initialEvent as Record<string, unknown> | undefined)
  const initialPrizeFields = parsePrizePoolFields(initialEvent?.prize_pool)
  const [form, setForm] = useState<EventFormState>({
    title: String(initialEvent?.title ?? ''),
    description: String(initialEvent?.description ?? ''),
    race_type: initialSlugs[0] ?? 'itt',
    // Multiple types are stored as comma-separated slugs in `events.race_type`.
    race_types: initialSlugs.length ? initialSlugs : ([] as string[]),
    venue: initialVenueParts.venue,
    city: initialVenueParts.city,
    event_date: toDateInputValue(initialEvent?.event_date),
    // FIX: was incorrectly using end_time instead of end_date
    end_date: toDateInputValue(initialEvent?.end_date),
    start_time: toTimeInputValue(initialEvent?.start_time),
    end_time: toTimeInputValue(initialEvent?.end_time),
    google_maps_link: String(initialEvent?.google_maps_link ?? ''),
    registration_deadline: toDateTimeLocalValue(
      initialEvent?.registration_deadline ?? initialEvent?.registration_closes_at,
    ),
    registration_fee: String(initialEvent?.registration_fee ?? '0'),
  })
  const [newEventTypeName, setNewEventTypeName] = useState('')
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [eventTypesLoading, setEventTypesLoading] = useState(true)

  const loadEventTypes = async () => {
    setEventTypesLoading(true)
    try {
      const { data, error } = await supabase
        .from('event_types')
        .select('slug, name, active, event_code')
        .eq('active', true)
        .order('name', { ascending: true })

      if (error) throw error

      setEventTypes((data ?? []) as EventType[])
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load event types.')
      setEventTypes([])
    } finally {
      setEventTypesLoading(false)
    }
  }

  useEffect(() => {
    setTimeout(() => {
      void loadEventTypes()
    }, 0)
  }, [])

  const handleAddEventType = async () => {
    const name = String(newEventTypeName ?? '').trim()
    if (!name) return

    const slug = slugify(name)
    if (!slug) {
      toast.error('Event type name is required.')
      return
    }

    setEventTypesLoading(true)
    try {
      const { data: existingCodes, error: listErr } = await supabase
        .from('event_types')
        .select('event_code')
      if (listErr) throw listErr
      const eventCode = pickNextEventTypeCode((existingCodes ?? []) as Array<{ event_code?: string | null }>)

      const { error } = await supabase.from('event_types').upsert(
        { name, slug, active: true, event_code: eventCode },
        { onConflict: 'slug' },
      )
      if (error) throw error

      await loadEventTypes()
      setForm((v) => {
        const prev = Array.isArray(v.race_types) ? v.race_types : []
        const next = [...new Set([...prev, slug])]
        return { ...v, race_types: next, race_type: next[0] ?? slug }
      })
      setNewEventTypeName('')
      toast.success('Event type added.')
    } catch (e) {
      toast.error((e as Error).message || 'Failed to add event type.')
    } finally {
      setEventTypesLoading(false)
    }
  }

  const handleDeleteEventType = async (slug: string) => {
    const s = String(slug ?? '').trim()
    if (!s) return
    setEventTypesLoading(true)
    try {
      const { error } = await supabase
        .from('event_types')
        .update({ active: false })
        .eq('slug', s)
      if (error) throw error
      setForm((v) => {
        const next = (Array.isArray(v.race_types) ? v.race_types : []).filter((x) => x !== s)
        return { ...v, race_types: next, race_type: next[0] ?? '' }
      })
      await loadEventTypes()
      toast.success('Event type removed from active list.')
    } catch (e) {
      toast.error((e as Error).message || 'Failed to remove event type.')
    } finally {
      setEventTypesLoading(false)
    }
  }
  const [disciplines, setDisciplines] = useState<Discipline[]>([])
  const [disciplinesLoading, setDisciplinesLoading] = useState(false)
  const [posterFile, setPosterFile] = useState<File | null>(null)
  const [routeMapFile, setRouteMapFile] = useState<File | null>(null)
  const [organizerLogoFile, setOrganizerLogoFile] = useState<File | null>(null)
  const [persistedMedia, setPersistedMedia] = useState(() => ({
    poster_url: (initialEvent?.poster_url as string | undefined) ?? null,
    route_map_url: (initialEvent?.route_map_url as string | undefined) ?? null,
    banner_url: (initialEvent?.banner_url as string | undefined) ?? null,
    slug: (initialEvent?.slug as string | undefined) ?? null,
  }))
  const [extra, setExtra] = useState<ExtraFormState>({
    prizePool: initialEvent?.prize_pool ? 'has' : 'none',
    totalPrize: initialPrizeFields.totalPrize,
    prizeDesc: initialPrizeFields.prizeDesc,
    orgName: String(initialEvent?.organizer_name ?? ''),
    orgEmail: String(initialEvent?.organizer_email ?? ''),
    orgPhone: String(initialEvent?.organizer_contact ?? ''),
    orgWebsite: String(initialEvent?.organizer_website ?? ''),
    bibInstructions: String(initialEvent?.bib_claim_instructions ?? ''),
  })

  const isLastStep = step === 4

  const loadDisciplinesForEvent = async (eventId: string) => {
    setDisciplinesLoading(true)
    try {
      const { data, error } = await supabase
        .from('race_categories')
        .select('id, discipline, category_name, code, rider_limit, active, gender_eligibility')
        .eq('event_id', eventId)

      if (error) throw error

      const rows = (data ?? []) as Array<Record<string, unknown>>

      const grouped = new Map<string, Discipline>()
      for (const row of rows) {
        const disciplineName = String(row.discipline ?? '').trim() || 'General'
        const categoryName = String(row.category_name ?? '').trim()
        if (!categoryName) continue

        const riderLimitValue = row.rider_limit ?? 0
        const active = row.active === undefined ? true : Boolean(row.active)
        const categoryId = String(row.id ?? crypto.randomUUID())
        const geRaw = String(row.gender_eligibility ?? 'all').toLowerCase()
        const genderEligibility: CategoryGenderEligibility =
          geRaw === 'male' || geRaw === 'female' ? geRaw : 'all'

        if (!grouped.has(disciplineName)) {
          grouped.set(disciplineName, { id: crypto.randomUUID(), name: disciplineName, categories: [] })
        }

        const disc = grouped.get(disciplineName)!
        disc.categories.push({
          id: categoryId,
          name: categoryName,
          code: String(row.code ?? ''),
          riderLimit: String(riderLimitValue ?? ''),
          active,
          genderEligibility,
        })
      }

      setDisciplines(Array.from(grouped.values()))
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load disciplines/categories.')
      setDisciplines([])
    } finally {
      setDisciplinesLoading(false)
    }
  }

  useEffect(() => {
    if (mode !== 'edit') return
    const eventId = initialEvent?.id ? String(initialEvent.id) : ''
    if (!eventId) return
    setTimeout(() => {
      void loadDisciplinesForEvent(eventId)
    }, 0)
  }, [mode, initialEvent?.id])

  useEffect(() => {
    setTimeout(() => {
      setPersistedMedia({
        poster_url: (initialEvent?.poster_url as string | undefined) ?? null,
        route_map_url: (initialEvent?.route_map_url as string | undefined) ?? null,
        banner_url: (initialEvent?.banner_url as string | undefined) ?? null,
        slug: (initialEvent?.slug as string | undefined) ?? null,
      })
    }, 0)
  }, [initialEvent?.id])

  useEffect(() => {
    if (mode !== 'edit' || !initialEvent?.id) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from('events').select('*').eq('id', String(initialEvent.id)).maybeSingle()
      if (cancelled || error || !data) return
      const row = data as Record<string, unknown>
      const slugs = parseRaceTypeSlugs(row)
      const venueParts = parseVenueCity(String(row.venue ?? ''))
      const pp = parsePrizePoolFields(row.prize_pool)
      setPersistedMedia({
        poster_url: row.poster_url ? String(row.poster_url) : null,
        route_map_url: row.route_map_url ? String(row.route_map_url) : null,
        banner_url: row.banner_url ? String(row.banner_url) : null,
        slug: row.slug ? String(row.slug) : null,
      })
      setForm({
        title: String(row.title ?? ''),
        description: String(row.description ?? ''),
        race_type: slugs[0] ?? 'itt',
        race_types: slugs.length ? slugs : [],
        venue: venueParts.venue,
        city: venueParts.city,
        event_date: toDateInputValue(row.event_date),
        // FIX: was incorrectly using row.end_time instead of row.end_date
        end_date: toDateInputValue(row.end_date),
        start_time: toTimeInputValue(row.start_time),
        end_time: toTimeInputValue(row.end_time),
        google_maps_link: String(row.google_maps_link ?? ''),
        registration_deadline: toDateTimeLocalValue(row.registration_deadline ?? row.registration_closes_at),
        registration_fee: String(row.registration_fee ?? '0'),
      })
      setExtra({
        prizePool: row.prize_pool ? 'has' : 'none',
        totalPrize: pp.totalPrize,
        prizeDesc: pp.prizeDesc,
        orgName: String(row.organizer_name ?? ''),
        orgEmail: String(row.organizer_email ?? ''),
        orgPhone: String(row.organizer_contact ?? ''),
        orgWebsite: String(row.organizer_website ?? ''),
        bibInstructions: String(row.bib_claim_instructions ?? ''),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [mode, initialEvent?.id])

  const handleNext = async () => {
    if (isLastStep) {
      setSaving(true)
      try {
        const selectedTypeSlugs =
          Array.isArray(form.race_types) && form.race_types.length > 0
            ? form.race_types
            : form.race_type
              ? [String(form.race_type)]
              : []
        if (!form.title.trim() || !form.description.trim() || selectedTypeSlugs.length === 0 || !form.venue.trim() || !form.event_date) {
          toast.error('Please complete required event fields before publishing.')
          return
        }

        const eventTimestamp = combineDateAndTime(form.event_date, form.start_time)
        const defaultDeadline = combineDateAndTime(form.event_date, '23:59')
        const deadlineTimestamp = form.registration_deadline
          ? combineDateAndTime(
              form.registration_deadline.slice(0, 10),
              form.registration_deadline.slice(11, 16),
            )
          : defaultDeadline

        if (!eventTimestamp || !deadlineTimestamp) {
          toast.error('Invalid event date or registration deadline.')
          return
        }

        const uploadedPoster = await uploadToBucket('event-posters', posterFile)
        const uploadedRoute = await uploadToBucket('event-route-maps', routeMapFile)
        const uploadedOrgLogo = await uploadToBucket('organizer-logos', organizerLogoFile)
        const posterUrl = uploadedPoster ?? (mode === 'edit' ? persistedMedia.poster_url : null)
        const routeMapUrl = uploadedRoute ?? (mode === 'edit' ? persistedMedia.route_map_url : null)
        const organizerLogoStoredUrl = uploadedOrgLogo ?? (mode === 'edit' ? persistedMedia.banner_url : null)

        const baseSlug = slugify(form.title) || 'event'
        const eventIdForSave = mode === 'edit' ? String(initialEvent?.id) : crypto.randomUUID()
        const slugValue =
          mode === 'edit' && persistedMedia.slug ? persistedMedia.slug : `${baseSlug}-${Date.now()}`
        const riderLimit = disciplines.reduce(
          (sum, d) => sum + d.categories.reduce((s, c) => s + Number(c.riderLimit || 0), 0),
          0,
        )

        const endTimestamp =
          form.end_time?.trim() ? combineDateAndTime(form.end_date || form.event_date, form.end_time) : null
        const mapsLink = form.google_maps_link.trim()
        const orgWebsite = extra.orgWebsite.trim()

        const payload = {
          title: form.title.trim(),
          description: form.description.trim(),
          race_type: selectedTypeSlugs.join(','),
          venue: form.city ? `${form.venue.trim()}, ${form.city.trim()}` : form.venue.trim(),
          route_map_url: routeMapUrl,
          event_date: eventTimestamp,
          start_date: form.event_date || null, 
          end_date: form.end_date || null,
          registration_deadline: deadlineTimestamp,
          registration_fee: Number(form.registration_fee || 0),
          prize_pool:
            extra.prizePool === 'has'
              ? `Total: ${extra.totalPrize || '0'} | ${extra.prizeDesc || ''}`.trim()
              : null,
          poster_url: posterUrl,
          slug: slugValue,
          short_description: form.description.trim().slice(0, 160),
          banner_url: organizerLogoStoredUrl,
          registration_closes_at: deadlineTimestamp,
          rider_limit: riderLimit > 0 ? riderLimit : null,
          organizer_name: extra.orgName || null,
          organizer_contact: extra.orgPhone || null,
          organizer_email: extra.orgEmail || null,
          organizer_website: orgWebsite || null,
          bib_claim_instructions: extra.bibInstructions || null,
          start_time: eventTimestamp,
          end_time: endTimestamp,
          google_maps_link: mapsLink || null,
          status: mode === 'edit' ? String(initialEvent?.status ?? 'draft') : 'draft',
          updated_at: new Date().toISOString(),
        }

        const response =
          mode === 'edit'
            ? await supabase.from('events').update(payload).eq('id', eventIdForSave)
            : await supabase.from('events').insert({
                ...payload,
                id: eventIdForSave,
              })

        if (response.error) throw response.error

        // Persist Step 2 categories into race_categories (includes category code).
        const categoryRows = disciplines.flatMap((d) =>
          d.categories.map((c) => ({
            event_id: eventIdForSave,
            discipline: d.name,
            category_name: c.name,
            code: c.code.trim() ? c.code.trim() : null,
            rider_limit: c.riderLimit.trim() ? Number(c.riderLimit) : null,
            active: c.active,
            gender_eligibility: c.genderEligibility ?? 'all',
          })),
        )

        if (categoryRows.length > 0 && selectedTypeSlugs.length > 0) {
          const comboCount = categoryRows.length * selectedTypeSlugs.length
          if (comboCount > 99) {
            toast.error(
              'Too many event type × category combinations for 4-digit bibs (max 99 classes). Reduce categories or event types.',
            )
            return
          }
        }

        const { error: deleteBibClassErr } = await supabase.from('event_race_bib_classes').delete().eq('event_id', eventIdForSave)
        if (deleteBibClassErr) throw deleteBibClassErr

        const { error: deleteErr } = await supabase.from('race_categories').delete().eq('event_id', eventIdForSave)
        if (deleteErr) throw deleteErr

        if (categoryRows.length > 0) {
          const { data: insertedCats, error: insertErr } = await supabase
            .from('race_categories')
            .insert(categoryRows)
            .select('id, discipline, category_name')
          if (insertErr) throw insertErr

          const slugsSorted = [...selectedTypeSlugs]
            .map((s) => String(s).trim().toLowerCase())
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b))
          const catsSorted = [...(insertedCats ?? [])].sort((a, b) => {
            const da = String(a.discipline ?? '')
            const db = String(b.discipline ?? '')
            if (da !== db) return da.localeCompare(db)
            return String(a.category_name ?? '').localeCompare(String(b.category_name ?? ''))
          })

          if (slugsSorted.length > 0) {
            const bibClassRows: Array<{
              event_id: string
              race_category_id: string
              entry_event_type_slug: string
              bib_class_code: number
            }> = []
            let bibClassCode = 1
            for (const slug of slugsSorted) {
              for (const cat of catsSorted) {
                bibClassRows.push({
                  event_id: eventIdForSave,
                  race_category_id: String(cat.id),
                  entry_event_type_slug: slug,
                  bib_class_code: bibClassCode,
                })
                bibClassCode += 1
              }
            }
            const { error: bibClassInsertErr } = await supabase.from('event_race_bib_classes').insert(bibClassRows)
            if (bibClassInsertErr) throw bibClassInsertErr
          }
        }

        toast.success(mode === 'edit' ? 'Event updated successfully.' : 'Event created successfully.')
        await onSave()
      } catch (error) {
        toast.error((error as Error).message || `Failed to ${mode} event.`)
      } finally {
        setSaving(false)
      }
      return
    }
    setStep((s) => (s + 1) as Step)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <section className="flex h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100 flex-shrink-0">
          <h3 className="text-xl font-semibold text-slate-900">Create New Event</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step tabs */}
        <div className="flex border-b border-slate-100 px-6 gap-1 flex-shrink-0 overflow-x-auto">
          {[1, 2, 3, 4].map((s) => <StepTab key={s} step={s} current={step} />)}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && (
            <Step1
              form={form}
              setForm={setForm}
              posterFile={posterFile}
              setPosterFile={setPosterFile}
              routeMapFile={routeMapFile}
              setRouteMapFile={setRouteMapFile}
              currentPosterUrl={
                persistedMedia.poster_url ??
                (initialEvent?.poster_url != null ? String(initialEvent.poster_url) : null)
              }
              currentRouteMapUrl={
                persistedMedia.route_map_url ??
                (initialEvent?.route_map_url != null ? String(initialEvent.route_map_url) : null)
              }
              eventTypes={eventTypes}
              eventTypesLoading={eventTypesLoading}
              onAddEventType={handleAddEventType}
              onDeleteEventType={(slug) => { void handleDeleteEventType(slug) }}
              newEventTypeName={newEventTypeName}
              setNewEventTypeName={setNewEventTypeName}
            />
          )}
          {step === 2 && (
            <Step2
              disciplines={disciplines}
              setDisciplines={setDisciplines}
              disciplinesLoading={disciplinesLoading}
            />
          )}
          {step === 3 && (
            <Step3
              extra={extra}
              setExtra={setExtra}
              organizerLogoFile={organizerLogoFile}
              setOrganizerLogoFile={setOrganizerLogoFile}
              currentOrgLogoUrl={
                persistedMedia.banner_url ??
                (initialEvent?.banner_url != null ? String(initialEvent.banner_url) : null)
              }
            />
          )}
          {step === 4 && (
            <Step4
              form={form}
              disciplines={disciplines}
              extra={extra}
              posterFile={posterFile}
              currentPosterUrl={
                persistedMedia.poster_url ??
                (initialEvent?.poster_url != null ? String(initialEvent.poster_url) : null)
              }
              routeMapFile={routeMapFile}
              currentRouteMapUrl={
                persistedMedia.route_map_url ??
                (initialEvent?.route_map_url != null ? String(initialEvent.route_map_url) : null)
              }
              organizerLogoFile={organizerLogoFile}
              currentOrgLogoUrl={
                persistedMedia.banner_url ??
                (initialEvent?.banner_url != null ? String(initialEvent.banner_url) : null)
              }
              eventTypes={eventTypes}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 flex-shrink-0">
          <button
            type="button"
            onClick={step === 1 ? onClose : () => setStep((s) => (s - 1) as Step)}
            className="rounded-lg border border-slate-200 px-6 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          <button
            type="button"
            onClick={() => void handleNext()}
            disabled={saving}
            className={`min-w-32 rounded-lg px-8 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60 ${isLastStep ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {saving ? 'Saving...' : isLastStep ? '✓ Publish Event' : 'Next'}
          </button>
        </div>
      </section>
    </div>
  )
}

/** Rider cap from events.rider_limit — handles commas, invalid values (avoids NaN in progress math). */
function parseEventRiderLimit(raw: unknown): number {
  if (raw == null || raw === '') return 300
  const n = Number(String(raw).replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n <= 0) return 300
  return Math.min(Math.floor(n), 10_000_000)
}

function safeNonNegativeInt(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

/** Per-category cap from race_categories.rider_limit (same field as admin Step 2). */
function parseCategoryRiderLimit(raw: unknown): number {
  if (raw == null || raw === '') return 0
  const n = Number(String(raw).replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function normalizeCategoryKeyPart(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function latestPaidRegistrationIdsFromOrders(
  orders: Array<{ registration_id?: string | null; status?: string | null }>,
): Set<string> {
  const latestStatusByReg = new Map<string, string>()
  for (const row of orders) {
    const regId = String(row.registration_id ?? '').trim()
    if (!regId || latestStatusByReg.has(regId)) continue
    latestStatusByReg.set(regId, String(row.status ?? '').toLowerCase())
  }
  const paidRegIds = new Set<string>()
  for (const [regId, status] of latestStatusByReg.entries()) {
    if (status === 'paid') paidRegIds.add(regId)
  }
  return paidRegIds
}

function addBundleFallbackPaidRegistrationIds(args: {
  regRows: Array<{ id?: string | null; checkout_bundle_id?: string | null }>
  directPaidRegIds: Set<string>
  bundleOrders: Array<{ checkout_bundle_id?: string | null; status?: string | null }>
}): Set<string> {
  const out = new Set<string>(args.directPaidRegIds)
  const latestStatusByBundle = new Map<string, string>()
  for (const row of args.bundleOrders) {
    const bid = String(row.checkout_bundle_id ?? '').trim()
    if (!bid || latestStatusByBundle.has(bid)) continue
    latestStatusByBundle.set(bid, String(row.status ?? '').toLowerCase())
  }
  for (const row of args.regRows) {
    const regId = String(row.id ?? '').trim()
    const bid = String(row.checkout_bundle_id ?? '').trim()
    if (!regId || !bid || out.has(regId)) continue
    if (latestStatusByBundle.get(bid) === 'paid') out.add(regId)
  }
  return out
}

function EventCategoriesRegistrationModal({
  open,
  onClose,
  eventId,
  eventTitle,
  eventRiderLimit,
  paidTotalAllCategories,
}: {
  open: boolean
  onClose: () => void
  eventId: string
  eventTitle: string
  eventRiderLimit: number
  paidTotalAllCategories: number
}) {
  const [loading, setLoading] = useState(false)
  const [categoryRows, setCategoryRows] = useState<
    Array<{ id: string; label: string; registered: number; limit: number }>
  >([])

  useEffect(() => {
    if (!open || !eventId) return
    let cancelled = false
    setTimeout(() => setLoading(true), 0)
    void (async () => {
      try {
        const [{ data: cats, error: catErr }, { data: regs, error: regErr }] = await Promise.all([
          supabase
            .from('race_categories')
            .select('id, discipline, category_name, rider_limit')
            .eq('event_id', eventId)
            .order('discipline', { ascending: true })
            .order('category_name', { ascending: true }),
          supabase
            .from('registration_forms')
            .select('id, race_category_id, checkout_bundle_id')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false }),
        ])
        if (catErr) throw catErr
        if (regErr) throw regErr

        const regIds = (regs ?? [])
          .map((row) => String((row as { id?: string | null }).id ?? '').trim())
          .filter(Boolean)
        const { data: orderRows, error: orderErr } =
          regIds.length > 0
            ? await supabase
                .from('payment_orders')
                .select('registration_id, status, created_at')
                .in('registration_id', regIds)
                .order('created_at', { ascending: false })
            : { data: [], error: null }
        if (orderErr) throw orderErr
        const paidRegIdsDirect = latestPaidRegistrationIdsFromOrders(
          (orderRows ?? []) as Array<{ registration_id?: string | null; status?: string | null }>,
        )
        const bundleIds = Array.from(
          new Set(
            (regs ?? [])
              .map((row) => String((row as { checkout_bundle_id?: string | null }).checkout_bundle_id ?? '').trim())
              .filter(Boolean),
          ),
        )
        const { data: bundleOrders, error: bundleErr } =
          bundleIds.length > 0
            ? await supabase
                .from('payment_orders')
                .select('checkout_bundle_id, status, created_at')
                .in('checkout_bundle_id', bundleIds)
                .order('created_at', { ascending: false })
            : { data: [], error: null }
        if (bundleErr) throw bundleErr
        const paidRegIds = addBundleFallbackPaidRegistrationIds({
          regRows: (regs ?? []) as Array<{ id?: string | null; checkout_bundle_id?: string | null }>,
          directPaidRegIds: paidRegIdsDirect,
          bundleOrders: (bundleOrders ?? []) as Array<{ checkout_bundle_id?: string | null; status?: string | null }>,
        })

        const { data: riderRows, error: riderErr } =
          regIds.length > 0
            ? await supabase
                .from('registration_rider_details')
                .select('registration_id, discipline, age_category')
                .in('registration_id', regIds)
            : { data: [], error: null }
        if (riderErr) throw riderErr

        const riderByRegId = new Map<string, { discipline: string; age_category: string }>()
        for (const row of riderRows ?? []) {
          const rid = String((row as { registration_id?: string | null }).registration_id ?? '').trim()
          if (!rid) continue
          riderByRegId.set(rid, {
            discipline: String((row as { discipline?: string | null }).discipline ?? ''),
            age_category: String((row as { age_category?: string | null }).age_category ?? ''),
          })
        }

        const categoryIdByNormalizedPair = new Map<string, string>()
        for (const c of cats ?? []) {
          const cid = String((c as { id?: string }).id ?? '').trim()
          if (!cid) continue
          const discipline = normalizeCategoryKeyPart((c as { discipline?: string }).discipline)
          const categoryName = normalizeCategoryKeyPart((c as { category_name?: string }).category_name)
          if (!discipline || !categoryName) continue
          categoryIdByNormalizedPair.set(`${discipline}||${categoryName}`, cid)
        }

        const countByCategory = new Map<string, number>()
        for (const row of regs ?? []) {
          const rid = String((row as { id?: string | null }).id ?? '').trim()
          if (!rid || !paidRegIds.has(rid)) continue
          const directCid = String((row as { race_category_id?: string | null }).race_category_id ?? '').trim()
          let resolvedCategoryId = directCid
          if (!resolvedCategoryId) {
            const rider = riderByRegId.get(rid)
            const riderDiscipline = normalizeCategoryKeyPart(rider?.discipline ?? '')
            const riderAgeCategory = normalizeCategoryKeyPart(rider?.age_category ?? '')
            if (riderDiscipline && riderAgeCategory) {
              resolvedCategoryId = categoryIdByNormalizedPair.get(`${riderDiscipline}||${riderAgeCategory}`) ?? ''
            }
          }
          if (!resolvedCategoryId) continue
          countByCategory.set(resolvedCategoryId, (countByCategory.get(resolvedCategoryId) ?? 0) + 1)
        }

        if (cancelled) return
        const built = (cats ?? []).map((c) => {
          const id = String((c as { id: string }).id)
          const discipline = String((c as { discipline?: string }).discipline ?? '').trim() || '—'
          const catName = String((c as { category_name?: string }).category_name ?? '').trim() || '—'
          const lim = parseCategoryRiderLimit((c as { rider_limit?: unknown }).rider_limit)
          return {
            id,
            label: `${discipline} · ${catName}`,
            registered: countByCategory.get(id) ?? 0,
            limit: lim,
          }
        })
        setCategoryRows(built)
      } catch (e) {
        if (!cancelled) {
          toast.error((e as Error).message || 'Failed to load category stats.')
          setCategoryRows([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, eventId])

  const totalFillPct =
    eventRiderLimit > 0
      ? Math.min(100, Math.max(0, (paidTotalAllCategories / eventRiderLimit) * 100))
      : 0

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-cat-reg-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Registration by category</p>
            <h2 id="event-cat-reg-modal-title" className="mt-1 text-lg font-semibold text-slate-900 sm:text-xl">
              {eventTitle}
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              Paid registrations are counted from the latest payment order status (
              <span className="font-medium">payment_orders.status = paid</span>). Fill % uses each category&apos;s rider limit from event setup.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-white hover:text-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {!loading && categoryRows.length > 0 && paidTotalAllCategories === 0 ? (
            <div className="mb-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center">
              <UserCheck className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-800">No registrations yet</p>
              <p className="mt-1 text-xs text-slate-600">
                There are no paid registrations for this event yet. Category limits below are shown for planning;
                counts update automatically after riders complete payment.
              </p>
            </div>
          ) : null}
          {loading ? (
            <div className="space-y-2 py-4">
              <p className="text-sm text-slate-600">Loading categories…</p>
              {[1, 2, 3].map((k) => (
                <div key={k} className="h-10 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : categoryRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
              <Users className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">No categories configured</p>
              <p className="mt-1 text-xs text-slate-500">Add disciplines and categories when editing this event to see breakdown here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-[560px] w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Category
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Registered (paid)
                    </th>
                    <th className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Limit
                    </th>
                    <th className="min-w-[140px] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Fill %
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {categoryRows.map((row) => {
                    const fillPct =
                      row.limit > 0 ? Math.min(100, Math.max(0, (row.registered / row.limit) * 100)) : null
                    const fillLabel =
                      row.limit > 0
                        ? fillPct !== null && fillPct > 0 && fillPct < 1
                          ? `${fillPct.toFixed(1)}%`
                          : `${Math.round(fillPct ?? 0)}%`
                        : row.registered > 0
                          ? '—'
                          : '0%'
                    const barW = row.limit > 0 && fillPct !== null ? Math.min(100, fillPct) : 0
                    return (
                      <tr key={row.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-medium text-slate-900">{row.label}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-800">
                          {row.registered.toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                          {row.limit > 0 ? row.limit.toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                            <span className="w-12 shrink-0 text-xs font-medium tabular-nums text-slate-600">{fillLabel}</span>
                            <div className="h-2 min-w-0 flex-1 rounded-full bg-slate-200">
                              <div
                                className="h-full rounded-full bg-blue-500 transition-all"
                                style={{ width: `${barW}%` }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                  <tr>
                    <td className="px-4 py-3 font-semibold text-slate-900">Event total</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-base font-bold tabular-nums text-blue-700">
                      {paidTotalAllCategories.toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-800">
                      {eventRiderLimit.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                        <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-slate-700">
                          {eventRiderLimit > 0
                            ? totalFillPct > 0 && totalFillPct < 1
                              ? `${totalFillPct.toFixed(1)}%`
                              : `${Math.round(totalFillPct)}%`
                            : '—'}
                        </span>
                        <div className="h-2 min-w-0 flex-1 rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${totalFillPct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-200 bg-slate-50 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 sm:w-auto sm:min-w-[120px]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/** Event card only: turn comma-separated `events.race_type` slugs into readable labels. */
function formatEventCardRaceTypeSegment(slug: string): string {
  const s = slug.trim().toLowerCase()
  if (!s) return ''
  if (s === 'itt' || s === 'individual-time-trial' || s === 'individual_time_trial') return 'Individual Time Trial'
  if (s === 'criterium') return 'Criterium'
  if (s === 'road-race' || s === 'road_race') return 'Road Race'
  if (s === 'mtb' || s === 'mountain-bike' || s === 'mountain_bike') return 'Mountain Bike'
  return s
    .split(/[-_]/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
    .filter(Boolean)
    .join(' ')
}

function eventCardRaceTypeLabels(raw: unknown): string[] {
  const str = String(raw ?? '').trim()
  if (!str) return ['Race']
  const labels = str
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map(formatEventCardRaceTypeSegment)
    .filter(Boolean)
  return labels.length ? labels : ['Race']
}

// ─── Event card ──────────────────────────────────────────────────────────────
function EventCard({
  event,
  busy,
  paidRegistrationCount,
  onEdit,
  onDuplicate,
  onTogglePublish,
  onDelete,
  onViewRegistrations,
}: {
  event: AdminEventRow
  busy: boolean
  paidRegistrationCount: number
  onEdit: (event: AdminEventRow) => void
  onDuplicate: (event: AdminEventRow) => void
  onTogglePublish: (event: AdminEventRow) => void
  onDelete: (event: AdminEventRow) => void
  onViewRegistrations: () => void
}) {
  const isPublished = String(event.status ?? '').toLowerCase() === 'published'
  const registrations = safeNonNegativeInt(paidRegistrationCount)
  const riderLimit = parseEventRiderLimit(event.rider_limit)
  const pctNum = riderLimit > 0 ? (registrations / riderLimit) * 100 : 0
  const barPct = Number.isFinite(pctNum) ? Math.min(100, Math.max(0, pctNum)) : 0
  const pctLabel =
    !Number.isFinite(pctNum) || pctNum <= 0
      ? '0%'
      : pctNum >= 100
        ? '100%'
        : pctNum < 10
          ? `${pctNum.toFixed(1)}%`
          : `${Math.round(pctNum)}%`
  const venue = String(event.venue ?? 'TBD')
  const raceTypeLabels = eventCardRaceTypeLabels(event.race_type)
  const feeDisplay = formatMoney(event.registration_fee)

  return (
    <article className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="grid items-center gap-4 xl:grid-cols-[minmax(0,2.5fr)_minmax(0,1.25fr)_minmax(0,1.1fr)_minmax(0,0.7fr)_minmax(0,0.8fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <img
              src={String(event.poster_url ?? '/bg2.png')}
              alt={String(event.title ?? 'Event')}
              className="h-16 w-16 rounded object-cover"
            />
            <div className="min-w-0">
              <h3 className="truncate text-2xl font-semibold leading-tight text-slate-900">{String(event.title ?? 'Untitled')}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-1" title={String(event.race_type ?? '')}>
                {raceTypeLabels.map((label, i) => (
                  <span
                    key={`${label}-${i}`}
                    className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
                  >
                    {label}
                  </span>
                ))}
              </div>
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                <MapPinned className="h-3.5 w-3.5" />
                {venue}
              </p>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-700">
          <p className="font-medium text-slate-800">
            {formatDate(event.event_date)}
            {event.end_date ? ` – ${formatDate(event.end_date)}` : ''}
          </p>
          <p className="mt-1 flex items-center gap-1 text-slate-500">
            <Clock3 className="h-3.5 w-3.5" />
            {formatTime(event.start_time)} – {formatTime(event.end_time)}
          </p>
        </div>

        <div className="text-xs">
          <p className="font-medium text-red-500">
            {formatDate(event.registration_deadline ?? event.event_date)}
            {event.registration_deadline ? (
              <span className="text-red-600 font-normal"> · {formatTime(event.registration_deadline as string)}</span>
            ) : null}
          </p>
          <p className="mt-1 text-slate-500" title={`Fee: ${feeDisplay}`}>Paid registrations</p>
          <p className="font-semibold text-blue-600">
            {registrations.toLocaleString()} / {riderLimit.toLocaleString()}
          </p>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-1 text-xs text-slate-500">
            <Users className="h-3.5 w-3.5" />
            {pctLabel}
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${barPct}%` }} />
          </div>
          <span
            className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${
              isPublished ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            {isPublished ? 'Published' : 'Draft'}
          </span>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onViewRegistrations}
            className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <UserCheck className="h-3.5 w-3.5" />
            View
          </button>
          <div className="hidden">
            <button type="button" onClick={() => onDuplicate(event)}><Copy className="h-3 w-3" /></button>
            <button type="button" onClick={() => onTogglePublish(event)}>{isPublished ? 'Unpublish' : 'Publish'}</button>
            <button type="button" onClick={() => onDelete(event)}>Delete</button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => onEdit(event)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            title="More actions"
            aria-label="More actions"
          >
            ⋮
          </button>
        </div>
      </div>
    </article>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export function AdminEventsManagement() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { data, loading, error } = useModuleLoader(() => adminModulesApi.eventsDashboard(), [refreshKey])
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [busyEventId, setBusyEventId] = useState<string | null>(null)
  const [editingEvent, setEditingEvent] = useState<AdminEventRow | null>(null)
  const [paidCountByEventId, setPaidCountByEventId] = useState<Record<string, number>>({})
  const [eventCategoriesModal, setEventCategoriesModal] = useState<{
    eventId: string
    title: string
    riderLimit: number
    paidTotal: number
  } | null>(null)

  const events = data?.events ?? []
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      const title = String(event.title ?? '').toLowerCase()
      const venue = String(event.venue ?? '').toLowerCase()
      const raceType = String(event.race_type ?? '').toLowerCase()
      const status = String(event.status ?? '').toLowerCase()
      const q = search.trim().toLowerCase()
      return (
        (!q || title.includes(q) || venue.includes(q)) &&
        (statusFilter === 'all' || status === statusFilter) &&
        (categoryFilter === 'all' || raceType === categoryFilter)
      )
    })
  }, [events, search, statusFilter, categoryFilter])

  const eventIdsKey = useMemo(
    () =>
      events
        .map((e) => String((e as { id?: string }).id ?? ''))
        .filter(Boolean)
        .sort()
        .join(','),
    [events],
  )

  useEffect(() => {
    const ids = eventIdsKey ? eventIdsKey.split(',').filter(Boolean) : []
    if (ids.length === 0) {
      setTimeout(() => setPaidCountByEventId({}), 0)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { data: regs, error: regErr } = await supabase
          .from('registration_forms')
          .select('id, event_id, checkout_bundle_id')
          .in('event_id', ids)
        if (regErr) throw regErr

        const regRows = (regs ?? []) as Array<{ id?: string | null; event_id?: string | null; checkout_bundle_id?: string | null }>
        const regIds = regRows.map((r) => String(r.id ?? '').trim()).filter(Boolean)

        const { data: orders, error: orderErr } =
          regIds.length > 0
            ? await supabase
                .from('payment_orders')
                .select('registration_id, status, created_at')
                .in('registration_id', regIds)
                .order('created_at', { ascending: false })
            : { data: [], error: null }
        if (orderErr) throw orderErr

        const paidRegIdsDirect = latestPaidRegistrationIdsFromOrders(
          (orders ?? []) as Array<{ registration_id?: string | null; status?: string | null }>,
        )
        const bundleIds = Array.from(
          new Set(regRows.map((r) => String(r.checkout_bundle_id ?? '').trim()).filter(Boolean)),
        )
        const { data: bundleOrders, error: bundleErr } =
          bundleIds.length > 0
            ? await supabase
                .from('payment_orders')
                .select('checkout_bundle_id, status, created_at')
                .in('checkout_bundle_id', bundleIds)
                .order('created_at', { ascending: false })
            : { data: [], error: null }
        if (bundleErr) throw bundleErr
        const paidRegIds = addBundleFallbackPaidRegistrationIds({
          regRows,
          directPaidRegIds: paidRegIdsDirect,
          bundleOrders: (bundleOrders ?? []) as Array<{ checkout_bundle_id?: string | null; status?: string | null }>,
        })

        const counts: Record<string, number> = {}
        for (const eid of ids) counts[eid] = 0
        for (const row of regRows) {
          const regId = String(row.id ?? '').trim()
          const eid = String(row.event_id ?? '').trim()
          if (!regId || !eid || !paidRegIds.has(regId)) continue
          counts[eid] = (counts[eid] ?? 0) + 1
        }
        if (!cancelled) setPaidCountByEventId(counts)
      } catch {
        const fallback: Record<string, number> = {}
        for (const eid of ids) fallback[eid] = 0
        if (!cancelled) setPaidCountByEventId(fallback)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [eventIdsKey, refreshKey])

  const totalRegistrations = events.reduce((t, e) => t + Number(e.total_registrations ?? 0), 0)
  const publishedCount = events.filter((e) => String(e.status ?? '').toLowerCase() === 'published').length
  const draftCount = events.filter((e) => String(e.status ?? '').toLowerCase() !== 'published').length

  const handleEditEvent = async (event: AdminEventRow) => {
    setEditingEvent(event)
  }

  const handleDuplicateEvent = async (event: AdminEventRow) => {
    setBusyEventId(String(event.id))
    try {
      const title = String(event.title ?? 'Untitled')
      const newSlug = `${slugify(title)}-copy-${Date.now()}`
      const { error } = await supabase.from('events').insert({
        title: `${title} (Copy)`,
        description: String(event.description ?? ''),
        race_type: String(event.race_type ?? 'criterium'),
        venue: String(event.venue ?? ''),
        route_map_url: event.route_map_url ?? null,
        event_date: event.event_date ?? new Date().toISOString(),
        registration_deadline: event.registration_deadline ?? event.event_date ?? new Date().toISOString(),
        registration_fee: Number(event.registration_fee ?? 0),
        prize_pool: event.prize_pool ?? null,
        poster_url: event.poster_url ?? null,
        slug: newSlug,
        short_description: event.short_description ?? null,
        banner_url: event.banner_url ?? null,
        registration_closes_at: event.registration_closes_at ?? null,
        rider_limit: event.rider_limit ?? null,
        organizer_name: event.organizer_name ?? null,
        organizer_contact: event.organizer_contact ?? null,
        organizer_email: event.organizer_email ?? null,
        organizer_website: event.organizer_website ?? null,
        bib_claim_instructions: event.bib_claim_instructions ?? null,
        start_time: event.start_time ?? null,
        end_time: event.end_time ?? null,
        google_maps_link: event.google_maps_link ?? null,
        status: 'draft',
        published_at: null,
      })
      if (error) throw error
      toast.success('Event duplicated.')
      setRefreshKey((v) => v + 1)
    } catch (error) {
      toast.error((error as Error).message || 'Failed to duplicate event.')
    } finally {
      setBusyEventId(null)
    }
  }

  const handleTogglePublishEvent = async (event: AdminEventRow) => {
    const currentlyPublished = String(event.status ?? '').toLowerCase() === 'published'
    setBusyEventId(String(event.id))
    try {
      const { error } = await supabase
        .from('events')
        .update({
          status: currentlyPublished ? 'draft' : 'published',
          published_at: currentlyPublished ? null : new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', String(event.id))
      if (error) throw error
      toast.success(currentlyPublished ? 'Event set to draft.' : 'Event published.')
      setRefreshKey((v) => v + 1)
    } catch (error) {
      toast.error((error as Error).message || 'Failed to update event status.')
    } finally {
      setBusyEventId(null)
    }
  }

  const handleDeleteEvent = async (event: AdminEventRow) => {
    if (!window.confirm(`Delete "${String(event.title ?? 'this event')}"?`)) return
    setBusyEventId(String(event.id))
    try {
      const { error } = await supabase.from('events').delete().eq('id', String(event.id))
      if (error) throw error
      toast.success('Event deleted.')
      setRefreshKey((v) => v + 1)
    } catch (error) {
      toast.error((error as Error).message || 'Failed to delete event.')
    } finally {
      setBusyEventId(null)
    }
  }

  const handleSave = async () => {
    setRefreshKey((v) => v + 1)
    setIsCreateOpen(false)
  }

  return (
    <ModuleShell loading={loading} error={error}>
      {/* Header */}
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Events Management</h2>
          <p className="mt-0.5 text-sm text-slate-500">Create, manage, and publish cycling events.</p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 shadow-sm"
        >
          <Plus className="h-4 w-4" /> Create Event
        </button>
      </section>

      {/* Stats */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Total Events', value: data?.stats.events ?? events.length, sub: 'All time', icon: <CalendarDays className="h-5 w-5" />, color: 'blue' },
          { label: 'Published Events', value: publishedCount || data?.stats.published || 0, sub: 'Currently live', icon: <CheckCircle2 className="h-5 w-5" />, color: 'emerald' },
          { label: 'Draft Events', value: draftCount, sub: 'Not published', icon: <Pencil className="h-5 w-5" />, color: 'amber' },
          { label: 'Total Registrations', value: totalRegistrations.toLocaleString(), sub: 'Across all events', icon: <Users className="h-5 w-5" />, color: 'violet' },
        ].map(({ label, value, sub, icon, color }) => {
          const iconClass = color === 'blue'
            ? 'bg-blue-50 text-blue-600'
            : color === 'emerald'
              ? 'bg-emerald-50 text-emerald-600'
              : color === 'amber'
                ? 'bg-amber-50 text-amber-600'
                : 'bg-violet-50 text-violet-600'
          return (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500">{label}</p>
                <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
                <p className="mt-0.5 text-xs text-slate-400">{sub}</p>
              </div>
              <span className={`rounded-lg p-2 ${iconClass}`}>{icon}</span>
            </div>
          </div>
        )})}
      </div>

      {/* Events container */}
      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 md:grid-cols-[1fr_auto_auto_auto_auto]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input className="h-10 w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" placeholder="Search events..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="unpublished">Unpublished</option>
          </select>
          <select className="h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">All Event Types</option>
            <option value="criterium">Criterium</option>
            <option value="itt">ITT</option>
            <option value="road_race">Road Race</option>
          </select>
          <input type="date" className="h-10 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-slate-500" placeholder="Select date range" />
          <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            <Filter className="h-4 w-4" /> Filter
          </button>
        </div>
        <div className="mt-3 space-y-2">
          {filteredEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
              {events.length === 0 ? (
                <>
                  <p className="text-sm font-semibold text-slate-700">No events yet.</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Create your first event to display it here.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-slate-700">No matching events found.</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Try clearing filters or updating your search keywords.
                  </p>
                </>
              )}
            </div>
          ) : (
            filteredEvents.map((event, index) => (
              <EventCard
                key={String(event.id ?? index)}
                event={event}
                busy={busyEventId === String(event.id)}
                paidRegistrationCount={safeNonNegativeInt(paidCountByEventId[String(event.id ?? '')])}
                onEdit={handleEditEvent}
                onDuplicate={handleDuplicateEvent}
                onTogglePublish={handleTogglePublishEvent}
                onDelete={handleDeleteEvent}
                onViewRegistrations={() =>
                  setEventCategoriesModal({
                    eventId: String(event.id),
                    title: String(event.title ?? 'Event'),
                    riderLimit: parseEventRiderLimit(event.rider_limit),
                    paidTotal: safeNonNegativeInt(paidCountByEventId[String(event.id ?? '')]),
                  })
                }
              />
            ))
          )}
        </div>
        {filteredEvents.length > 0 && (
          <div className="mt-3 flex items-center justify-between text-sm text-slate-500">
            <p>Showing 1 to {Math.min(filteredEvents.length, 3)} of {filteredEvents.length} events</p>
            <div className="flex items-center gap-1">
              <button type="button" className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50 transition-colors"><ChevronLeft className="h-4 w-4" /></button>
              {[1, 2, 3, 4].map((p) => (
                <button key={p} type="button" className={`h-8 w-8 rounded-lg text-sm font-medium transition-colors ${p === 1 ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{p}</button>
              ))}
              <button type="button" className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50 transition-colors"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </section>

      <EventCategoriesRegistrationModal
        open={Boolean(eventCategoriesModal)}
        onClose={() => setEventCategoriesModal(null)}
        eventId={eventCategoriesModal?.eventId ?? ''}
        eventTitle={eventCategoriesModal?.title ?? ''}
        eventRiderLimit={eventCategoriesModal?.riderLimit ?? 300}
        paidTotalAllCategories={eventCategoriesModal?.paidTotal ?? 0}
      />

      {/* Modal */}
      {isCreateOpen && <CreateEventModal onClose={() => setIsCreateOpen(false)} onSave={handleSave} />}
      {editingEvent && (
        <CreateEventModal
          key={String(editingEvent.id)}
          mode="edit"
          initialEvent={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSave={async () => {
            setRefreshKey((v) => v + 1)
            setEditingEvent(null)
          }}
        />
      )}
    </ModuleShell>
  )
}