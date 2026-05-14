import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Bike,
  Calendar,
  Check,
  Copy,
  Flag,
  Mail,
  MapPin,
  Phone,
  Shirt,
  Trophy,
  User2,
  Users,
  BadgeCheck,
} from 'lucide-react'
import { adminApi, type AdminRiderDetailRow, type AdminRegistrationRow } from '../../services/adminApi'

/** Prefer saved entry label; otherwise turn `events.race_type` slugs into readable text (not raw DB strings). */
function formatRaceAndEventTypeLabel(
  entryLabel: string | null | undefined,
  eventRaceTypeRaw: string | null | undefined,
): string {
  const label = String(entryLabel ?? '').trim()
  if (label) return label
  const raw = String(eventRaceTypeRaw ?? '').trim()
  if (!raw) return '—'
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((segment) =>
      segment
        .split(/[._\s]+/)
        .filter(Boolean)
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
        .join(' '),
    )
    .filter(Boolean)
    .join(' · ')
}

function paymentPillClass(status: string) {
  const s = status.toLowerCase()
  if (s === 'paid') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (s === 'pending') return 'bg-amber-50 text-amber-700 ring-amber-200'
  if (s === 'failed') return 'bg-rose-50 text-rose-700 ring-rose-200'
  if (s === 'refunded') return 'bg-slate-100 text-slate-700 ring-slate-200'
  return 'bg-slate-100 text-slate-700 ring-slate-200'
}

function registrationPillClass(status: string) {
  const s = status.toLowerCase()
  if (s === 'confirmed') return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (s === 'pending_payment' || s === 'payment_processing') return 'bg-amber-50 text-amber-700 ring-amber-200'
  if (s === 'cancelled') return 'bg-rose-50 text-rose-700 ring-rose-200'
  return 'bg-slate-100 text-slate-700 ring-slate-200'
}

function formatBirthDate(iso: string | null | undefined): string {
  const s = String(iso ?? '').trim()
  if (!s) return '—'
  const d = /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s.slice(0, 10)) : new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  if (!value || value === '—') {
    return <span className="break-all font-mono text-sm text-slate-500">—</span>
  }
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="break-all font-mono text-sm text-slate-900">{value}</span>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          })
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </span>
  )
}

type DetailRowProps = {
  icon: ReactNode
  label: string
  children: ReactNode
}

function DetailRow({ icon, label, children }: DetailRowProps) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-slate-400">{icon}</span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <div className="text-sm text-slate-900">{children}</div>
      </div>
    </div>
  )
}

export function AdminRegistrationDetail() {
  const { id } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [registration, setRegistration] = useState<AdminRegistrationRow | null>(null)
  const [rider, setRider] = useState<AdminRiderDetailRow | null>(null)

  useEffect(() => {
    if (!id) return
    let active = true
    setLoading(true)
    void adminApi
      .registrationDetails(id)
      .then((data) => {
        if (!active) return
        setRegistration(data.registration)
        setRider(data.rider)
      })
      .catch((e) => {
        if (!active) return
        setError((e as Error).message || 'Failed to load registration.')
      })
      .finally(() => {
        if (!active) return
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id])

  const raceEventTypeDisplay = registration
    ? formatRaceAndEventTypeLabel(registration.entry_event_type_label, registration.race_type)
    : '—'

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <Link
        to="/admin/registrations"
        className="inline-flex items-center gap-2 text-sm font-semibold text-[#1e4a8e] transition hover:text-[#163b72] hover:underline"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
        Back to registrations
      </Link>

      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Registration Detail</h1>
        {id ? (
          <div className="mt-2">
            <CopyField value={id} label="registration id" />
          </div>
        ) : null}
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      {!loading && !error && !registration ? (
        <p className="text-sm text-slate-500">Registration not found.</p>
      ) : null}

      {registration ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="border-b border-slate-100 pb-3 text-sm font-semibold text-slate-900">Registration information</h2>
            <div className="mt-4 space-y-4">
              <DetailRow icon={<Trophy className="h-4 w-4" aria-hidden />} label="Event">
                {registration.event_title?.trim() ? (
                  <span className="font-medium">{registration.event_title}</span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
              </DetailRow>
              <DetailRow icon={<Flag className="h-4 w-4" aria-hidden />} label="Race / event type">
                <span className="font-medium">{raceEventTypeDisplay}</span>
              </DetailRow>
              <DetailRow icon={<Mail className="h-4 w-4" aria-hidden />} label="Email">
                {String(registration.registrant_email ?? '—')}
              </DetailRow>
              <DetailRow icon={<BadgeCheck className="h-4 w-4" aria-hidden />} label="Payment status">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold uppercase ring-1 ring-inset ${paymentPillClass(
                    String(registration.payment_status ?? ''),
                  )}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                  {String(registration.payment_status ?? 'unknown')}
                </span>
              </DetailRow>
              <DetailRow icon={<Check className="h-4 w-4" aria-hidden />} label="Registration status">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${registrationPillClass(
                    String(registration.status ?? ''),
                  )}`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                  {String(registration.status ?? '—').replace(/_/g, ' ')}
                </span>
              </DetailRow>
              <DetailRow icon={<Calendar className="h-4 w-4" aria-hidden />} label="Created">
                {registration.created_at
                  ? new Date(registration.created_at).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : '—'}
              </DetailRow>
              <DetailRow icon={<User2 className="h-4 w-4" aria-hidden />} label="User ID">
                <CopyField value={String(registration.user_id ?? '')} label="user id" />
              </DetailRow>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="border-b border-slate-100 pb-3 text-sm font-semibold text-slate-900">Rider details</h2>
            <div className="mt-4 space-y-4">
              <DetailRow icon={<User2 className="h-4 w-4" aria-hidden />} label="Name">
                {`${rider?.first_name ?? ''} ${rider?.last_name ?? ''}`.trim() || '—'}
              </DetailRow>
              <DetailRow icon={<Users className="h-4 w-4" aria-hidden />} label="Gender">
                {String(rider?.gender ?? '—')}
              </DetailRow>
              <DetailRow icon={<Calendar className="h-4 w-4" aria-hidden />} label="Birth date">
                {formatBirthDate(rider?.birth_date ?? null)}
              </DetailRow>
              <DetailRow icon={<MapPin className="h-4 w-4" aria-hidden />} label="Address">
                {String(rider?.address ?? '—')}
              </DetailRow>
              <DetailRow icon={<Phone className="h-4 w-4" aria-hidden />} label="Contact">
                {String(rider?.contact_number ?? '—')}
              </DetailRow>
              <DetailRow icon={<User2 className="h-4 w-4" aria-hidden />} label="Emergency contact name">
                {String(rider?.emergency_contact_name ?? '—')}
              </DetailRow>
              <DetailRow icon={<Phone className="h-4 w-4" aria-hidden />} label="Emergency number">
                {String(rider?.emergency_contact_number ?? '—')}
              </DetailRow>
              <DetailRow icon={<Flag className="h-4 w-4" aria-hidden />} label="Team">
                {String(rider?.team_name ?? '—')}
              </DetailRow>
              <DetailRow icon={<Bike className="h-4 w-4" aria-hidden />} label="Discipline">
                {String(rider?.discipline ?? '—')}
              </DetailRow>
              <DetailRow icon={<Trophy className="h-4 w-4" aria-hidden />} label="Category">
                {String(rider?.age_category ?? '—')}
              </DetailRow>
              <DetailRow icon={<Shirt className="h-4 w-4" aria-hidden />} label="Jersey size">
                {String(rider?.jersey_size ?? '—')}
              </DetailRow>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
