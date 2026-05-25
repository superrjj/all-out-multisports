/** Event fields used to decide if public registration is still allowed. */
export type RegistrationWindowEvent = {
  registration_deadline?: string | null
  registration_closes_at?: string | null
}

export function getRegistrationClosesAtIso(event: RegistrationWindowEvent | null | undefined): string | null {
  const raw = String(event?.registration_deadline ?? event?.registration_closes_at ?? '').trim()
  return raw || null
}

/** True while now is on or before the configured deadline (PH-local values stored as UTC ISO). */
export function isRegistrationOpen(
  event: RegistrationWindowEvent | null | undefined,
  now: Date = new Date(),
): boolean {
  const closesAt = getRegistrationClosesAtIso(event)
  if (!closesAt) return true
  const endMs = new Date(closesAt).getTime()
  if (Number.isNaN(endMs)) return true
  return now.getTime() <= endMs
}

export function formatRegistrationClosesLabel(
  event: RegistrationWindowEvent | null | undefined,
  locale = 'en-PH',
): string {
  const raw = getRegistrationClosesAtIso(event)
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
