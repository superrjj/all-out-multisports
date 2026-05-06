// @ts-nocheck
// Shared PayMongo-paid finalization helpers (bundles + bib assignment).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export function extractBibSequenceByPrefix(bibNumber: string, prefix: string) {
  const value = String(bibNumber ?? '').trim()
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = value.match(new RegExp(`^${escapedPrefix}(\\d+)$`))
  if (!match) return 0
  const n = Number.parseInt(match[1], 10)
  return Number.isFinite(n) ? n : 0
}

/** 4-digit bibs: CCSS — class (01–99) + sequence (01–99). */
function extractSequenceFromFourDigitClassBib(bibNumber: string, classTwoDigit: string) {
  const value = String(bibNumber ?? '').trim()
  if (!/^\d{4}$/.test(value)) return 0
  if (!value.startsWith(classTwoDigit)) return 0
  const n = Number.parseInt(value.slice(2), 10)
  return Number.isFinite(n) ? n : 0
}

function fallbackEventTypeCodeFromSlug(slug: string): string {
  const s = String(slug ?? '').trim().toLowerCase()
  if (s === 'criterium') return '1'
  if (s === 'itt') return '2'
  if (s === 'road_race' || s === 'road-race' || s === 'road race') return '3'
  return '9'
}

function parseEventTypeSlugs(raw: unknown): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Avoid race: two PayMongo paths (webhook + checkout redirect) can call assign concurrently.
 * Only one UPDATE should win; the other must not overwrite (e.g. 2101 → 2102) when both computed max=0.
 */
async function updateRegistrationBibIfStillNull(
  supabase: SupabaseClient,
  registrationId: string,
  nextBib: string,
  now: string,
) {
  const { data: updated, error } = await supabase
    .from('registration_forms')
    .update({ bib_number: nextBib, updated_at: now })
    .eq('id', registrationId)
    .is('bib_number', null)
    .select('id')
  if (error) throw error
  if (!updated?.length) return false
  return true
}

/** Assign bib for one registration if missing; registration should already be status confirmed when paid. */
export async function assignBibIfMissing(supabase: SupabaseClient, registrationId: string) {
  const now = new Date().toISOString()
  const { data: registration, error: registrationError } = await supabase
    .from('registration_forms')
    .select('id, event_id, race_category_id, bib_number, entry_event_type_slug')
    .eq('id', registrationId)
    .maybeSingle()
  if (registrationError) throw registrationError
  if (!registration?.id) throw new Error('Registration not found while assigning bib.')
  if (String(registration.bib_number ?? '').trim()) return
  if (!registration.race_category_id) throw new Error('Missing race category for registration.')
  let eventTypeSlug = String(registration.entry_event_type_slug ?? '').trim().toLowerCase()
  if (!eventTypeSlug && registration.event_id) {
    const { data: eventRow, error: eventErr } = await supabase
      .from('events')
      .select('race_type')
      .eq('id', registration.event_id)
      .maybeSingle()
    if (eventErr) throw eventErr
    const slugs = parseEventTypeSlugs(eventRow?.race_type)
    if (slugs.length === 1) eventTypeSlug = slugs[0]
  }
  if (!eventTypeSlug) {
    throw new Error('Missing entry_event_type_slug for registration (and could not infer from event.race_type).')
  }

  const { data: raceCategory, error: raceCategoryError } = await supabase
    .from('race_categories')
    .select('code, category_name, rider_limit')
    .eq('id', registration.race_category_id)
    .maybeSingle()
  if (raceCategoryError) throw raceCategoryError

  const { data: bibClassRow, error: bibClassError } = await supabase
    .from('event_race_bib_classes')
    .select('bib_class_code')
    .eq('event_id', registration.event_id)
    .eq('race_category_id', registration.race_category_id)
    .eq('entry_event_type_slug', eventTypeSlug)
    .maybeSingle()
  if (bibClassError) throw bibClassError

  if (bibClassRow?.bib_class_code != null) {
    const classNum = Number(bibClassRow.bib_class_code)
    if (!Number.isFinite(classNum) || classNum < 1 || classNum > 99) {
      throw new Error('Invalid bib class code in event_race_bib_classes.')
    }
    const classTwoDigit = String(classNum).padStart(2, '0')

    const { data: existingBibs, error: bibError } = await supabase
      .from('registration_forms')
      .select('bib_number')
      .eq('event_id', registration.event_id)
      .eq('race_category_id', registration.race_category_id)
      .eq('entry_event_type_slug', eventTypeSlug)
      .eq('status', 'confirmed')
      .not('bib_number', 'is', null)
      .order('created_at', { ascending: true })
      .limit(5000)
    if (bibError) throw bibError

    const maxSequence = (existingBibs ?? []).reduce((max: number, row: { bib_number: string }) => {
      const seq = extractSequenceFromFourDigitClassBib(row.bib_number, classTwoDigit)
      return seq > max ? seq : max
    }, 0)
    const nextSequence = maxSequence + 1
    const riderLimit = Number(raceCategory?.rider_limit ?? 0)
    if (Number.isFinite(riderLimit) && riderLimit > 0 && nextSequence > riderLimit) {
      const categoryCode = String(raceCategory?.category_name ?? '').trim() || 'category'
      throw new Error(`Category limit reached for ${categoryCode}. Max riders: ${riderLimit}.`)
    }
    if (nextSequence > 99) {
      throw new Error(`Bib sequence exceeded 99 for class ${classTwoDigit}.`)
    }
    const nextBib = `${classTwoDigit}${String(nextSequence).padStart(2, '0')}`

    await updateRegistrationBibIfStillNull(supabase, registrationId, nextBib, now)
    return
  }

  // Legacy bibs (events saved before event_race_bib_classes): prefix = event_code + category.code + NN
  const categoryCode = String(raceCategory?.code ?? '').trim()
  if (!categoryCode) throw new Error('Missing category code for registration category.')

  const { data: eventTypeRow, error: eventTypeError } = await supabase
    .from('event_types')
    .select('event_code')
    .eq('slug', eventTypeSlug)
    .maybeSingle()
  if (eventTypeError) throw eventTypeError
  const eventTypeCodeRaw = String(eventTypeRow?.event_code ?? '').trim()
  const eventTypeCode = eventTypeCodeRaw || fallbackEventTypeCodeFromSlug(eventTypeSlug)
  const bibPrefix = `${eventTypeCode}${categoryCode}`

  const { data: existingBibsLegacy, error: bibErrorLegacy } = await supabase
    .from('registration_forms')
    .select('bib_number')
    .eq('event_id', registration.event_id)
    .eq('race_category_id', registration.race_category_id)
    .eq('entry_event_type_slug', eventTypeSlug)
    .eq('status', 'confirmed')
    .not('bib_number', 'is', null)
    .order('created_at', { ascending: true })
    .limit(5000)
  if (bibErrorLegacy) throw bibErrorLegacy

  const maxSequenceLegacy = (existingBibsLegacy ?? []).reduce((max: number, row: { bib_number: string }) => {
    const seq = extractBibSequenceByPrefix(row.bib_number, bibPrefix)
    return seq > max ? seq : max
  }, 0)
  const nextSequenceLegacy = maxSequenceLegacy + 1
  const riderLimitLegacy = Number(raceCategory?.rider_limit ?? 0)
  if (Number.isFinite(riderLimitLegacy) && riderLimitLegacy > 0 && nextSequenceLegacy > riderLimitLegacy) {
    throw new Error(
      `Category limit reached for ${String(raceCategory?.category_name ?? categoryCode)}. Max riders: ${riderLimitLegacy}.`,
    )
  }
  if (nextSequenceLegacy > 99) {
    throw new Error(`Category bib sequence exceeded 2 digits for prefix ${bibPrefix}.`)
  }
  const nextBibLegacy = `${bibPrefix}${String(nextSequenceLegacy).padStart(2, '0')}`

  await updateRegistrationBibIfStillNull(supabase, registrationId, nextBibLegacy, now)
}

export async function markRegistrationConfirmed(
  supabase: SupabaseClient,
  registrationId: string,
  paidNow: string,
) {
  const { error } = await supabase
    .from('registration_forms')
    .update({
      status: 'confirmed',
      confirmed_at: paidNow,
      updated_at: paidNow,
    })
    .eq('id', registrationId)
  if (error) throw error
}

/**
 * Confirm + bib for every registration row in the same PayMongo checkout (same `checkout_bundle_id`).
 * Do not filter by `user_id`: sibling lines must still finalize if `user_id` is null or differs (common DB drift).
 */
export async function finalizeBundleSiblingsPaid(supabase: SupabaseClient, primaryRegistrationId: string) {
  const { data: primary, error: pErr } = await supabase
    .from('registration_forms')
    .select('id, checkout_bundle_id')
    .eq('id', primaryRegistrationId)
    .maybeSingle()
  if (pErr) throw pErr
  const bundleId = primary?.checkout_bundle_id ? String(primary.checkout_bundle_id) : ''
  if (!bundleId || !primary?.id) return

  const paidNow = new Date().toISOString()
  const { error: bundleConfirmErr } = await supabase
    .from('registration_forms')
    .update({
      status: 'confirmed',
      confirmed_at: paidNow,
      updated_at: paidNow,
    })
    .eq('checkout_bundle_id', bundleId)
  if (bundleConfirmErr) throw bundleConfirmErr

  const { data: bundleRows, error: listErr } = await supabase
    .from('registration_forms')
    .select('id')
    .eq('checkout_bundle_id', bundleId)
  if (listErr) throw listErr

  const bibErrors: string[] = []
  for (const row of bundleRows ?? []) {
    if (!row?.id) continue
    try {
      await assignBibIfMissing(supabase, row.id)
    } catch (e) {
      bibErrors.push(`[${row.id}] ${(e as Error).message}`)
      console.error('[finalizeBundleSiblingsPaid] assignBibIfMissing failed for', row.id, e)
    }
  }
  if (bibErrors.length > 0) {
    throw new Error(`Bib assignment failed for some registrations: ${bibErrors.join('; ')}`)
  }
}
