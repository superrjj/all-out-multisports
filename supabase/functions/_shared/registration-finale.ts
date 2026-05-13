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

/** Smallest n in [1, maxSeq] not taken (reuses freed numbers when a rider changes category and returns). */
function lowestUnusedSequence(used: Set<number>, maxSeq: number): number | null {
  for (let s = 1; s <= maxSeq; s++) {
    if (!used.has(s)) return s
  }
  return null
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

/** Postgres unique violation on `registration_forms.bib_number`, or concurrent assign race. */
function isUniqueBibNumberConflict(err: unknown): boolean {
  const e = err as { code?: string; message?: string; details?: string } | null
  const code = String(e?.code ?? '')
  const msg = `${String(e?.message ?? '')} ${String(e?.details ?? '')}`.toLowerCase()
  if (code === '23505') return true
  if (msg.includes('registration_forms_bib_number_key')) return true
  if (msg.includes('duplicate key') && msg.includes('bib_number')) return true
  return false
}

const BIB_ASSIGN_RACE_RETRY = 'BIB_ASSIGN_RACE_RETRY'

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

/**
 * One attempt to compute next bib and claim it. Retried by `assignBibIfMissing` on unique conflicts / races.
 */
async function assignBibIfMissingOnce(supabase: SupabaseClient, registrationId: string) {
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

    // `bib_number` is unique across ALL rows; overlaps can exist across categories/types.
    // Scan every bib for this event whose first two digits match this class (4-digit bibs only).
    const { data: existingBibs, error: bibError } = await supabase
      .from('registration_forms')
      .select('bib_number')
      .eq('event_id', registration.event_id)
      .not('bib_number', 'is', null)
      .like('bib_number', `${classTwoDigit}__`)
      .limit(5000)
    if (bibError) throw bibError

    const usedSequences = new Set<number>()
    for (const row of existingBibs ?? []) {
      const seq = extractSequenceFromFourDigitClassBib(row.bib_number, classTwoDigit)
      if (seq > 0) usedSequences.add(seq)
    }
    const nextSequence = lowestUnusedSequence(usedSequences, 99)
    const riderLimit = Number(raceCategory?.rider_limit ?? 0)
    if (Number.isFinite(riderLimit) && riderLimit > 0) {
      const { count: assignedInCategory, error: cntErr } = await supabase
        .from('registration_forms')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', registration.event_id)
        .eq('race_category_id', registration.race_category_id)
        .eq('entry_event_type_slug', eventTypeSlug)
        .eq('status', 'confirmed')
        .not('bib_number', 'is', null)
      if (cntErr) throw cntErr
      if ((assignedInCategory ?? 0) >= riderLimit) {
        const categoryCode = String(raceCategory?.category_name ?? '').trim() || 'category'
        throw new Error(`Category limit reached for ${categoryCode}. Max riders: ${riderLimit}.`)
      }
    }
    if (nextSequence == null) {
      throw new Error(`Bib sequence exceeded 99 for class ${classTwoDigit}.`)
    }
    const nextBib = `${classTwoDigit}${String(nextSequence).padStart(2, '0')}`

    const assigned = await updateRegistrationBibIfStillNull(supabase, registrationId, nextBib, now)
    if (assigned) return
    const { data: recheck, error: recheckErr } = await supabase
      .from('registration_forms')
      .select('bib_number')
      .eq('id', registrationId)
      .maybeSingle()
    if (recheckErr) throw recheckErr
    if (String(recheck?.bib_number ?? '').trim()) return
    throw new Error(BIB_ASSIGN_RACE_RETRY)
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

  // Same global uniqueness issue as 4-digit path: any row in this event with this prefix blocks the value.
  const { data: existingBibsLegacy, error: bibErrorLegacy } = await supabase
    .from('registration_forms')
    .select('bib_number')
    .eq('event_id', registration.event_id)
    .not('bib_number', 'is', null)
    .like('bib_number', `${bibPrefix}%`)
    .limit(5000)
  if (bibErrorLegacy) throw bibErrorLegacy

  const usedLegacy = new Set<number>()
  for (const row of existingBibsLegacy ?? []) {
    const seq = extractBibSequenceByPrefix(row.bib_number, bibPrefix)
    if (seq > 0) usedLegacy.add(seq)
  }
  const nextSequenceLegacy = lowestUnusedSequence(usedLegacy, 99)
  const riderLimitLegacy = Number(raceCategory?.rider_limit ?? 0)
  if (Number.isFinite(riderLimitLegacy) && riderLimitLegacy > 0) {
    const { count: assignedInCategoryL, error: cntLErr } = await supabase
      .from('registration_forms')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', registration.event_id)
      .eq('race_category_id', registration.race_category_id)
      .eq('entry_event_type_slug', eventTypeSlug)
      .eq('status', 'confirmed')
      .not('bib_number', 'is', null)
    if (cntLErr) throw cntLErr
    if ((assignedInCategoryL ?? 0) >= riderLimitLegacy) {
      throw new Error(
        `Category limit reached for ${String(raceCategory?.category_name ?? categoryCode)}. Max riders: ${riderLimitLegacy}.`,
      )
    }
  }
  if (nextSequenceLegacy == null) {
    throw new Error(`Category bib sequence exceeded 2 digits for prefix ${bibPrefix}.`)
  }
  const nextBibLegacy = `${bibPrefix}${String(nextSequenceLegacy).padStart(2, '0')}`

  const assignedLegacy = await updateRegistrationBibIfStillNull(supabase, registrationId, nextBibLegacy, now)
  if (assignedLegacy) return
  const { data: recheckL, error: recheckLErr } = await supabase
    .from('registration_forms')
    .select('bib_number')
    .eq('id', registrationId)
    .maybeSingle()
  if (recheckLErr) throw recheckLErr
  if (String(recheckL?.bib_number ?? '').trim()) return
  throw new Error(BIB_ASSIGN_RACE_RETRY)
}

/** Assign bib for one registration if missing; registration should already be status confirmed when paid. */
export async function assignBibIfMissing(supabase: SupabaseClient, registrationId: string) {
  /** Fewer rounds now that next-bib scan is event-wide (avoids long 500s from repeated unique violations). */
  const maxAttempts = 6
  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await assignBibIfMissingOnce(supabase, registrationId)
      return
    } catch (e) {
      lastErr = e
      const msg = String((e as Error)?.message ?? '')
      const retryable = isUniqueBibNumberConflict(e) || msg === BIB_ASSIGN_RACE_RETRY
      if (retryable && attempt < maxAttempts - 1) continue
      if (isUniqueBibNumberConflict(e)) {
        throw new Error(
          'That bib number is already assigned to another registration (unique constraint). Click Generate again. If this repeats, open Supabase → registration_forms and search for the duplicate bib_number.',
        )
      }
      if (msg === BIB_ASSIGN_RACE_RETRY) {
        throw new Error(
          'Could not assign a bib after several attempts (likely concurrent updates). Click Generate again.',
        )
      }
      throw e
    }
  }
  throw new Error(
    lastErr instanceof Error ? lastErr.message : 'Could not assign a unique bib after several attempts. Please try again.',
  )
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
