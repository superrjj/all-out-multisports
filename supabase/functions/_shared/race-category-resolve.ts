// @ts-nocheck
// Resolve CSV / rider `age_category` text → `race_categories.id` for bib assignment.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

function normalizeGenderForRaceCategory(raw: string): 'male' | 'female' | '' {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return ''
  if (s === 'male' || s.startsWith('m')) return 'male'
  if (s === 'female' || s.startsWith('f')) return 'female'
  return ''
}

/** Collapse spacing and parens so "Under 23 (19-22)" matches DB variants. */
export function normalizeCategoryLabelForMatch(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normDiscipline(s: string): string {
  return String(s ?? '').trim().toLowerCase()
}

/**
 * Match display category (+ optional discipline / gender) to an active `race_categories` row.
 * Used on import (client) and when backfilling NULL `race_category_id` before bib assign (edge).
 */
export async function resolveRaceCategoryIdForEvent(
  supabase: SupabaseClient,
  eventId: string,
  categoryLabel: string,
  riderDiscipline: string,
  riderGender: string,
): Promise<string | null> {
  const labelNorm = normalizeCategoryLabelForMatch(categoryLabel)
  if (!labelNorm) return null

  const { data: cats, error } = await supabase
    .from('race_categories')
    .select('id, discipline, category_name, gender_eligibility')
    .eq('event_id', eventId)
    .eq('active', true)

  if (error || !cats?.length) return null

  const riderG = normalizeGenderForRaceCategory(riderGender)

  const genderOk = (geRaw: string | null | undefined) => {
    const ge = String(geRaw ?? 'all').toLowerCase()
    if (ge === 'all') return true
    if (!riderG) return true
    return ge === riderG
  }

  const catNorm = (c: { category_name?: string | null }) => normalizeCategoryLabelForMatch(String(c.category_name ?? ''))

  let pool = (cats ?? []).filter((c) => catNorm(c) === labelNorm).filter((c) => genderOk(c.gender_eligibility))
  if (!pool.length) {
    pool = (cats ?? [])
      .filter((c) => {
        const cn = catNorm(c)
        return cn.includes(labelNorm) || labelNorm.includes(cn)
      })
      .filter((c) => genderOk(c.gender_eligibility))
  }

  const disc = normDiscipline(riderDiscipline)
  if (disc) {
    const matchDisc = pool.filter((c) => normDiscipline(String(c.discipline ?? '')) === disc)
    if (matchDisc.length) pool = matchDisc
    else {
      const generalOnly = pool.filter((c) => normDiscipline(String(c.discipline ?? '')) === 'general')
      if (generalOnly.length) pool = generalOnly
    }
  }

  const id = pool[0]?.id
  return id ? String(id) : null
}
