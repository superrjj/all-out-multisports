import { useEffect, useMemo, useState } from 'react'
import { Loader2, Save, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { adminApi } from '../../services/adminApi'

type Props = {
  registrationId: string
  onClose: () => void
  onSaved: () => void
}

type EventTypeOption = { slug: string; name: string }
type CategoryOption = { id: string; category_name: string | null; discipline: string | null }

type EditForm = {
  registrantEmail: string
  entryEventTypeSlug: string
  entryEventTypeLabel: string
  raceCategoryId: string
  firstName: string
  lastName: string
  gender: string
  birthDate: string
  address: string
  contactNumber: string
  emergencyContactName: string
  emergencyContactNumber: string
  teamName: string
  ageCategory: string
  jerseySize: string
  providerReference: string
  paymentOrderStatus: string
}

const emptyForm: EditForm = {
  registrantEmail: '',
  entryEventTypeSlug: '',
  entryEventTypeLabel: '',
  raceCategoryId: '',
  firstName: '',
  lastName: '',
  gender: '',
  birthDate: '',
  address: '',
  contactNumber: '',
  emergencyContactName: '',
  emergencyContactNumber: '',
  teamName: '',
  ageCategory: '',
  jerseySize: '',
  providerReference: '',
  paymentOrderStatus: '',
}

function titleFromSlug(slug: string) {
  return String(slug ?? '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function AdminRegistrationEditModal({ registrationId, onClose, onSaved }: Props) {
  const [form, setForm] = useState<EditForm>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [eventId, setEventId] = useState('')
  const [paymentOrderId, setPaymentOrderId] = useState('')
  const [eventTypeOptions, setEventTypeOptions] = useState<EventTypeOption[]>([])
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([])

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      setError('')
      try {
        const details = await adminApi.registrationDetails(registrationId)
        if (!active) return
        if (!details.registration) throw new Error('Registration not found.')

        const reg = details.registration
        const rider = details.rider
        const order = details.paymentOrder
        setEventId(String((reg as { event_id?: string | null }).event_id ?? ''))
        setPaymentOrderId(String(order?.id ?? ''))

        setForm({
          registrantEmail: String(reg.registrant_email ?? ''),
          entryEventTypeSlug: String((reg.entry_event_type_slug ?? '') || ''),
          entryEventTypeLabel: String(reg.entry_event_type_label ?? ''),
          raceCategoryId: String((reg as { race_category_id?: string | null }).race_category_id ?? ''),
          firstName: String(rider?.first_name ?? ''),
          lastName: String(rider?.last_name ?? ''),
          gender: String(rider?.gender ?? ''),
          birthDate: String(rider?.birth_date ?? ''),
          address: String(rider?.address ?? ''),
          contactNumber: String(rider?.contact_number ?? ''),
          emergencyContactName: String(rider?.emergency_contact_name ?? ''),
          emergencyContactNumber: String(rider?.emergency_contact_number ?? ''),
          teamName: String(rider?.team_name ?? ''),
          ageCategory: String(rider?.age_category ?? ''),
          jerseySize: String(rider?.jersey_size ?? ''),
          providerReference: String(order?.provider_reference ?? ''),
          paymentOrderStatus: String(order?.status ?? ''),
        })
      } catch (e) {
        if (!active) return
        setError((e as Error).message || 'Failed to load registration details.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [registrationId])

  useEffect(() => {
    if (!eventId) return
    let active = true
    void (async () => {
      try {
        const [{ data: eventRow }, { data: types }, { data: categories }] = await Promise.all([
          supabase.from('events').select('race_type').eq('id', eventId).maybeSingle(),
          supabase.from('event_types').select('slug, name').order('name', { ascending: true }),
          supabase
            .from('race_categories')
            .select('id, category_name, discipline')
            .eq('event_id', eventId)
            .eq('active', true)
            .order('discipline', { ascending: true })
            .order('category_name', { ascending: true }),
        ])
        if (!active) return
        const allowedSlugs = String(eventRow?.race_type ?? '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
        const all = (types ?? []) as EventTypeOption[]
        const filtered = allowedSlugs.length > 0 ? all.filter((t) => allowedSlugs.includes(t.slug)) : all
        setEventTypeOptions(filtered)
        setCategoryOptions((categories ?? []) as CategoryOption[])
      } catch {
        if (!active) return
        setEventTypeOptions([])
        setCategoryOptions([])
      }
    })()
    return () => {
      active = false
    }
  }, [eventId])

  const categoryById = useMemo(() => new Map(categoryOptions.map((c) => [c.id, c])), [categoryOptions])

  const update = (key: keyof EditForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const category = categoryById.get(form.raceCategoryId)
      const disciplineNext = String(category?.discipline ?? '').trim()
      const categoryNext = String(category?.category_name ?? form.ageCategory ?? '').trim()
      const eventTypeLabelNext = form.entryEventTypeLabel.trim() || titleFromSlug(form.entryEventTypeSlug)

      const { error: regErr } = await supabase
        .from('registration_forms')
        .update({
          registrant_email: form.registrantEmail.trim() || null,
          entry_event_type_slug: form.entryEventTypeSlug.trim() || null,
          entry_event_type_label: eventTypeLabelNext || null,
          race_category_id: form.raceCategoryId.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', registrationId)
      if (regErr) throw regErr

      const { error: riderErr } = await supabase
        .from('registration_rider_details')
        .update({
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          gender: form.gender.trim() || null,
          birth_date: form.birthDate.trim() || null,
          address: form.address.trim() || null,
          contact_number: form.contactNumber.trim() || null,
          emergency_contact_name: form.emergencyContactName.trim() || null,
          emergency_contact_number: form.emergencyContactNumber.trim() || null,
          team_name: form.teamName.trim() || null,
          discipline: disciplineNext || null,
          age_category: categoryNext || null,
          jersey_size: form.jerseySize.trim() || null,
        })
        .eq('registration_id', registrationId)
      if (riderErr) throw riderErr

      if (paymentOrderId.trim()) {
        const { error: payErr } = await supabase
          .from('payment_orders')
          .update({
            provider_reference: form.providerReference.trim() || null,
            status: form.paymentOrderStatus.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', paymentOrderId.trim())
        if (payErr) throw payErr
      }

      onSaved()
      onClose()
    } catch (e) {
      setError((e as Error).message || 'Failed to save changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Edit Registration</p>
            <p className="text-xs text-slate-500">Update rider, category, payment and event details before generating bib.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading details...
          </div>
        ) : (
          <>
            <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
              <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 shadow-[0_14px_30px_-20px_rgba(15,23,42,0.45),0_6px_14px_-10px_rgba(15,23,42,0.3)]">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Registration</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Registrant Email" value={form.registrantEmail} onChange={(v) => update('registrantEmail', v)} />
                  <SelectField
                    label="Event Type"
                    value={form.entryEventTypeSlug}
                    onChange={(v) => {
                      update('entryEventTypeSlug', v)
                      const opt = eventTypeOptions.find((t) => t.slug === v)
                      update('entryEventTypeLabel', opt?.name ?? titleFromSlug(v))
                    }}
                    options={eventTypeOptions.map((t) => ({ value: t.slug, label: t.name }))}
                  />
                  <SelectField
                    label="Category"
                    value={form.raceCategoryId}
                    onChange={(v) => {
                      update('raceCategoryId', v)
                      const cat = categoryById.get(v)
                      if (cat) {
                        update('ageCategory', String(cat.category_name ?? ''))
                      }
                    }}
                    options={categoryOptions.map((c) => ({
                      value: c.id,
                      label: `${String(c.category_name ?? '—')} · ${String(c.discipline ?? '—')}`,
                    }))}
                  />
                  <Field label="Category Label" value={form.ageCategory} onChange={(v) => update('ageCategory', v)} />
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_14px_30px_-20px_rgba(15,23,42,0.45),0_6px_14px_-10px_rgba(15,23,42,0.3)]">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Rider Information</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="First Name" value={form.firstName} onChange={(v) => update('firstName', v)} />
                  <Field label="Last Name" value={form.lastName} onChange={(v) => update('lastName', v)} />
                  <Field label="Gender" value={form.gender} onChange={(v) => update('gender', v)} />
                  <Field label="Date of Birth" type="date" value={form.birthDate} onChange={(v) => update('birthDate', v)} />
                  <Field label="Contact Number" value={form.contactNumber} onChange={(v) => update('contactNumber', v)} />
                  <Field label="Emergency Contact Name" value={form.emergencyContactName} onChange={(v) => update('emergencyContactName', v)} />
                  <Field label="Emergency Contact Number" value={form.emergencyContactNumber} onChange={(v) => update('emergencyContactNumber', v)} />
                  <Field label="Team Name" value={form.teamName} onChange={(v) => update('teamName', v)} />
                  <Field label="Jersey Size" value={form.jerseySize} onChange={(v) => update('jerseySize', v)} />
                  <div className="md:col-span-2">
                    <Field label="Address" value={form.address} onChange={(v) => update('address', v)} />
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 shadow-[0_14px_30px_-20px_rgba(15,23,42,0.45),0_6px_14px_-10px_rgba(15,23,42,0.3)]">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Payment ID (provider_reference)" value={form.providerReference} onChange={(v) => update('providerReference', v)} />
                  <Field label="Payment Order Status" value={form.paymentOrderStatus} onChange={(v) => update('paymentOrderStatus', v)} />
                </div>
              </section>

              {error ? <p className="text-sm text-rose-600">{error}</p> : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e4a8e] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163b72] disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[#1e4a8e]"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[#1e4a8e]"
      >
        <option value="">Select...</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}
