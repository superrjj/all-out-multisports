import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { X, Upload, FileText, AlertTriangle, CheckCircle2, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase as supabaseAdmin } from '../../lib/supabase'

/** Must match `events.id` in Supabase (imports attach to this event only). */
const EVENT_ID = 'b8d4183a-2cbe-43cb-b0bd-c798d47f327e'

// ─── Types ───────────────────────────────────────────────────────────────────

type ParsedRow = {
  paymentStatus: string
  submissionId: string
  email: string
  isCriterium: boolean
  isITT: boolean
  paymongoId?: string
  amount: number
  /** Google Sheets "FINAL AGE CATEGORY" (optional) — used first for race category matching. */
  finalAgeCategory: string

  cFirstName: string; cLastName: string; cGender: string; cDateOfBirth: string
  cAddress: string; cContactNumber: string; cEmergencyContact: string; cEmergencyContactNumber: string
  cTeamName: string; cCategory: string; cDiscipline: string; cEventShirt: string
  cBirthYear: string

  ittFirstName: string; ittLastName: string; ittGender: string; ittDateOfBirth: string
  ittAddress: string; ittContactNumber: string; ittEmergencyContact: string; ittEmergencyContactNumber: string
  ittTeamName: string; ittCategory: string; ittDiscipline: string; ittEventShirt: string
  ittBirthYear: string

  /** Existing imports (checked via payment_orders.merchant_reference). */
  existsCriterium?: boolean
  existsITT?: boolean
}

type ImportResult = {
  email: string
  name: string
  type: string
  status: 'success' | 'error' | 'skipped'
  message: string
  registrationId?: string
}

// ─── Delimited + Excel parser ─────────────────────────────────────────────────

function splitCSVLine(line: string): string[] {
  const cols: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuotes = !inQuotes }
    else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = '' }
    else { current += ch }
  }
  cols.push(current.trim())
  return cols
}

function splitTSVLine(line: string): string[] {
  return line.split('\t').map((cell) => String(cell ?? '').trim())
}

function normalizeHeaderLabel(raw: string): string {
  return String(raw ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function detectPrimaryDelimiter(sampleLine: string): ',' | '\t' {
  const tabs = (sampleLine.match(/\t/g) ?? []).length
  const commas = (sampleLine.match(/,/g) ?? []).length
  return tabs > commas ? '\t' : ','
}

function splitMatrixFromText(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const delim = detectPrimaryDelimiter(lines[0])
  return lines.map((line) => (delim === '\t' ? splitTSVLine(line) : splitCSVLine(line)))
}

async function matrixFromXlsxFile(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: false })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return []
  const sheet = wb.Sheets[sheetName]
  const raw = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  }) as unknown[]
  return raw.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => stringifySheetCell(cell)),
  )
}

function stringifySheetCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(v).trim()
}

function cellBoolTruthy(v: string): boolean {
  const s = String(v ?? '').trim().toUpperCase()
  return s === 'TRUE' || s === '1' || s === 'YES'
}

/** Importable SUCCESS + onsite cash settlements (matches common Tally/Google Sheets statuses). */
function isImportablePaymentStatus(raw: string): boolean {
  const s = normalizeHeaderLabel(raw).replace(/\s+/g, ' ')
  if (s === 'success') return true
  if (s === 'paid') return true
  return false
}

/** Find PAYMENT ID column — all legacy rider columns shift with this anchor. */
function resolvePaymentIdColumnIndex(headers: string[]): number {
  const n = headers.map(normalizeHeaderLabel)
  const candidates = ['payment id']
  let best = -1
  for (let i = 0; i < n.length; i++) {
    for (const c of candidates) {
      if (n[i] === c) return i
    }
  }
  for (let i = 0; i < n.length; i++) {
    for (const c of candidates) {
      if (n[i].includes(c) && best < 0) best = i
    }
  }
  return best
}

function resolveFinalAgeCategoryColumnIndex(headers: string[]): number {
  const n = headers.map(normalizeHeaderLabel)
  const key = 'final age category'
  for (let i = 0; i < n.length; i++) {
    if (n[i] === key || n[i].includes(key)) return i
  }
  return -1
}

/** @param anchor — column index where PAYMENT ID starts (legacy col 0) */
function cellAt(cols: string[], anchor: number, legacyIndex: number): string {
  return String(cols[anchor + legacyIndex] ?? '').trim()
}

/**
 * Column map relative to PAYMENT ID anchor (= legacy index 0):
 *  0…8 meta + event flags,
 *  9–22 criterium-only,
 *  23–36 ITT,
 *  37–39 criterium cols when BOTH,
 *  40 Proof of Payment,
 *  41 Price
 */
function parseTallyRows(matrix: string[][]): ParsedRow[] {
  if (matrix.length < 2) return []

  const headers = matrix[0] ?? []
  const payAnchor = resolvePaymentIdColumnIndex(headers)
  if (payAnchor < 0) return []

  const finalAgeIdx = resolveFinalAgeCategoryColumnIndex(headers)
  const rows: ParsedRow[] = []

  for (const cols of matrix.slice(1)) {
    if (!cols.some((x) => String(x ?? '').trim())) continue

    const paymongoRaw = cellAt(cols, payAnchor, 0)
    const paymentStatus = cellAt(cols, payAnchor, 1)
    const submissionId = cellAt(cols, payAnchor, 2)
    const email = cellAt(cols, payAnchor, 5)

    const isCriterium = cellBoolTruthy(cellAt(cols, payAnchor, 7))
    const isITT = cellBoolTruthy(cellAt(cols, payAnchor, 8))
    const amount = parseFloat(cellAt(cols, payAnchor, 41).replace(/[^0-9.]/g, '')) || 0
    const paymongoId = paymongoRaw || undefined

    const finalAgeCategory = finalAgeIdx >= 0 ? String(cols[finalAgeIdx] ?? '').trim() : ''

    if (!email) continue
    if (!isImportablePaymentStatus(paymentStatus)) continue

    let cFirstName = '', cLastName = '', cGender = '', cDateOfBirth = ''
    let cAddress = '', cContactNumber = '', cEmergencyContact = '', cEmergencyContactNumber = ''
    let cTeamName = '', cCategory = '', cDiscipline = '', cEventShirt = '', cBirthYear = ''

    let ittFirstName = '', ittLastName = '', ittGender = '', ittDateOfBirth = ''
    let ittAddress = '', ittContactNumber = '', ittEmergencyContact = '', ittEmergencyContactNumber = ''
    let ittTeamName = '', ittCategory = '', ittDiscipline = '', ittEventShirt = '', ittBirthYear = ''

    if (isCriterium && !isITT) {
      cFirstName = cellAt(cols, payAnchor, 9)
      cLastName = cellAt(cols, payAnchor, 10)
      cGender = cellAt(cols, payAnchor, 11)
      cDateOfBirth = cellAt(cols, payAnchor, 12)
      cAddress = cellAt(cols, payAnchor, 13)
      cContactNumber = cellAt(cols, payAnchor, 14)
      cEmergencyContact = cellAt(cols, payAnchor, 15)
      cEmergencyContactNumber = cellAt(cols, payAnchor, 16)
      cTeamName = cellAt(cols, payAnchor, 17)
      cCategory = cellAt(cols, payAnchor, 18)
      cDiscipline = cellAt(cols, payAnchor, 19)
      cBirthYear = cellAt(cols, payAnchor, 20)
      cEventShirt = cellAt(cols, payAnchor, 22)
    } else if (!isCriterium && isITT) {
      ittFirstName = cellAt(cols, payAnchor, 23)
      ittLastName = cellAt(cols, payAnchor, 24)
      ittGender = cellAt(cols, payAnchor, 25)
      ittDateOfBirth = cellAt(cols, payAnchor, 26)
      ittAddress = cellAt(cols, payAnchor, 27)
      ittContactNumber = cellAt(cols, payAnchor, 28)
      ittEmergencyContact = cellAt(cols, payAnchor, 29)
      ittEmergencyContactNumber = cellAt(cols, payAnchor, 30)
      ittTeamName = cellAt(cols, payAnchor, 31)
      ittCategory = cellAt(cols, payAnchor, 32)
      ittDiscipline = cellAt(cols, payAnchor, 33)
      ittBirthYear = cellAt(cols, payAnchor, 34)
      ittEventShirt = cellAt(cols, payAnchor, 36)
    } else if (isCriterium && isITT) {
      const sharedFirst = cellAt(cols, payAnchor, 23)
      const sharedLast = cellAt(cols, payAnchor, 24)
      const sharedGender = cellAt(cols, payAnchor, 25)
      const sharedDOB = cellAt(cols, payAnchor, 26)
      const sharedAddr = cellAt(cols, payAnchor, 27)
      const sharedContact = cellAt(cols, payAnchor, 28)
      const sharedEmergency = cellAt(cols, payAnchor, 29)
      const sharedEmergencyNum = cellAt(cols, payAnchor, 30)
      const sharedTeam = cellAt(cols, payAnchor, 31)

      ittFirstName = sharedFirst
      ittLastName = sharedLast
      ittGender = sharedGender
      ittDateOfBirth = sharedDOB
      ittAddress = sharedAddr
      ittContactNumber = sharedContact
      ittEmergencyContact = sharedEmergency
      ittEmergencyContactNumber = sharedEmergencyNum
      ittTeamName = sharedTeam
      ittCategory = cellAt(cols, payAnchor, 32)
      ittDiscipline = cellAt(cols, payAnchor, 33)
      ittBirthYear = cellAt(cols, payAnchor, 34)
      ittEventShirt = cellAt(cols, payAnchor, 36)

      cFirstName = sharedFirst
      cLastName = sharedLast
      cGender = sharedGender
      cDateOfBirth = sharedDOB
      cAddress = sharedAddr
      cContactNumber = sharedContact
      cEmergencyContact = sharedEmergency
      cEmergencyContactNumber = sharedEmergencyNum
      cTeamName = sharedTeam
      cCategory = cellAt(cols, payAnchor, 37)
      cDiscipline = cellAt(cols, payAnchor, 38)
      cBirthYear = cellAt(cols, payAnchor, 34)
      cEventShirt = cellAt(cols, payAnchor, 39)
    }

    rows.push({
      paymentStatus,
      submissionId,
      email,
      isCriterium,
      isITT,
      paymongoId,
      amount,
      finalAgeCategory,
      cFirstName,
      cLastName,
      cGender,
      cDateOfBirth,
      cAddress,
      cContactNumber,
      cEmergencyContact,
      cEmergencyContactNumber,
      cTeamName,
      cCategory,
      cDiscipline,
      cEventShirt,
      cBirthYear,
      ittFirstName,
      ittLastName,
      ittGender,
      ittDateOfBirth,
      ittAddress,
      ittContactNumber,
      ittEmergencyContact,
      ittEmergencyContactNumber,
      ittTeamName,
      ittCategory,
      ittDiscipline,
      ittEventShirt,
      ittBirthYear,
    })
  }

  return rows
}

function validateImportMatrix(matrix: string[][]): string | null {
  if (matrix.length < 2) return 'The file has no data rows after the header.'
  const payIdx = resolvePaymentIdColumnIndex(matrix[0] ?? [])
  if (payIdx < 0) return 'Missing a PAYMENT ID column in row 1. Export from Google Sheets with headers, or use the same column layout as before.'
  return null
}

function isSupportedImportFileName(name: string): boolean {
  const n = name.toLowerCase()
  return n.endsWith('.csv') || n.endsWith('.tsv') || n.endsWith('.txt') || n.endsWith('.xlsx') || n.endsWith('.xls')
}

function merchantReferenceForRow(row: ParsedRow, eventType: 'criterium' | 'itt') {
  const slug = eventType === 'criterium' ? 'criterium' : 'individual-time-trial'
  return `tally-import-${row.submissionId}-${slug}`
}

function disciplineHintFromCombinedCategory(finalLabel: string): string {
  const u = String(finalLabel ?? '').toUpperCase()
  if (!u.trim()) return ''
  if (u.includes('MOUNTAIN') || u.includes(' MTB')) return 'Mountain Bike'
  if (u.includes('ROAD')) return 'Road Bike'
  return ''
}

function splitFinalAgeCategory(raw: string): { categoryLabel: string; disciplineHint: string } {
  const v = String(raw ?? '').trim()
  if (!v) return { categoryLabel: '', disciplineHint: '' }

  const upper = v.toUpperCase()
  const hasRoad = upper.includes('ROAD BIKE') || /\bROAD\b/i.test(v)
  const hasMtb = upper.includes('MOUNTAIN BIKE') || /\bMTB\b/i.test(v) || upper.includes('MOUNTAIN')
  const disciplineHint = hasMtb ? 'Mountain Bike' : hasRoad ? 'Road Bike' : ''

  // Strip common discipline suffixes so matching compares only to `race_categories.category_name`.
  let label = v
  label = label.replace(/\b(MOUNTAIN\s*BIKE|ROAD\s*BIKE)\b/gi, '')
  label = label.replace(/\bMTB\b/gi, '')
  label = label.replace(/\s+/g, ' ').trim()
  return { categoryLabel: label, disciplineHint }
}

function isOpenFemaleLabel(raw: string): boolean {
  const s = normalizeCategoryLabelForMatch(String(raw ?? ''))
  return s.includes('open female')
}

async function resolveRaceCategoryIdWithOpenFemaleFallback(args: {
  eventId: string
  categoryLabel: string
  riderDiscipline: string
  riderGender: string
}): Promise<{ id: string | null; note?: string }> {
  const { eventId, categoryLabel, riderDiscipline, riderGender } = args

  const direct = await resolveRaceCategoryIdForImport(eventId, categoryLabel, riderDiscipline, riderGender)
  if (direct) return { id: direct }

  // If "Open Female" is present and discipline is missing, it can be ambiguous (Road vs MTB).
  // Import anyway using a deterministic fallback (can be corrected later via Edit).
  if (!riderDiscipline && isOpenFemaleLabel(categoryLabel)) {
    const road = await resolveRaceCategoryIdForImport(eventId, categoryLabel, 'Road Bike', riderGender)
    const mtb = await resolveRaceCategoryIdForImport(eventId, categoryLabel, 'Mountain Bike', riderGender)

    if (road && !mtb) return { id: road, note: 'Auto-picked Road Bike for Open Female (no MTB match).' }
    if (!road && mtb) return { id: mtb, note: 'Auto-picked Mountain Bike for Open Female (no Road match).' }
    if (road && mtb) return { id: road, note: 'Auto-picked Road Bike for Open Female (ambiguous vs MTB). Edit if needed.' }
  }

  return { id: null }
}

function ageCategoryFromAge(age: number): string {
  if (age <= 15) return 'YOUTH (15 and Below)'
  if (age <= 18) return 'Junior (16-18)'
  if (age <= 22) return 'Under 23 (19-22)'
  if (age <= 34) return 'Masters A (23-34)'
  if (age <= 44) return 'Masters B (35-44)'
  if (age <= 54) return 'Masters C (45-54)'
  return 'Masters D (55 and above)'
}

/** One PayMongo charge for CRI+ITT bundle: only one row may store pay_… (unique constraint on provider_reference). */
function providerReferenceForImportedLine(row: ParsedRow, eventType: 'criterium' | 'itt'): string | null {
  const id = row.paymongoId?.trim()
  if (!id) return null
  if (row.isCriterium && row.isITT) {
    return eventType === 'criterium' ? id : null
  }
  return id
}

function ageCategoryFromBirthYearOrDob(birthYearRaw: string, dobRaw: string): string {
  const nowYear = new Date().getFullYear()
  const by = Number.parseInt(String(birthYearRaw ?? '').trim(), 10)
  if (Number.isFinite(by) && by > 1900 && by <= nowYear) {
    return ageCategoryFromAge(nowYear - by)
  }
  const dob = new Date(String(dobRaw ?? '').trim())
  if (!Number.isNaN(dob.getTime())) {
    return ageCategoryFromAge(nowYear - dob.getFullYear())
  }
  return ''
}

function sanitizeText(value: string): string {
  const v = String(value ?? '').trim()
  if (!v) return ''
  const lower = v.toLowerCase()
  if (lower === 'n/a' || lower === 'na' || lower === '-') return ''
  return v
}

/** Keeps phone values readable even when CSV has scientific notation like 6.39E+11. */
function normalizePhoneLike(value: string): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  if (/e\+?/i.test(raw)) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) {
      const asInt = Math.trunc(n).toString()
      if (asInt) return normalizePhoneLike(asInt)
    }
  }

  const digits = raw.replace(/\D+/g, '')
  if (!digits) return ''
  if (digits.startsWith('63') && digits.length >= 12) return `0${digits.slice(2, 12)}`
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}`
  return digits
}

function normalizeGenderForRaceCategory(raw: string): 'male' | 'female' | '' {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return ''
  if (s === 'male' || s.startsWith('m')) return 'male'
  if (s === 'female' || s.startsWith('f')) return 'female'
  return ''
}

/** Same rules as `supabase/functions/_shared/race-category-resolve.ts` — keep in sync. */
function normalizeCategoryLabelForMatch(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Match imported category label (+ discipline/gender) to `race_categories` so bib assignment can run. */
async function resolveRaceCategoryIdForImport(
  eventId: string,
  categoryLabel: string,
  riderDiscipline: string,
  riderGender: string,
): Promise<string | null> {
  const labelNorm = normalizeCategoryLabelForMatch(categoryLabel)
  if (!labelNorm) return null

  const { data: cats, error } = await supabaseAdmin
    .from('race_categories')
    .select('id, discipline, category_name, gender_eligibility')
    .eq('event_id', eventId)
    .eq('active', true)

  if (error || !cats?.length) return null

  const normDisc = (s: string) => String(s ?? '').trim().toLowerCase()
  const riderG = normalizeGenderForRaceCategory(riderGender)
  const catNorm = (c: { category_name?: string | null }) => normalizeCategoryLabelForMatch(String(c.category_name ?? ''))

  const genderOk = (geRaw: string | null | undefined) => {
    const ge = String(geRaw ?? 'all').toLowerCase()
    if (ge === 'all') return true
    if (!riderG) return true
    return ge === riderG
  }

  let pool = (cats ?? []).filter((c) => catNorm(c) === labelNorm).filter((c) => genderOk(c.gender_eligibility))
  if (!pool.length) {
    pool = (cats ?? [])
      .filter((c) => {
        const cn = catNorm(c)
        return cn.includes(labelNorm) || labelNorm.includes(cn)
      })
      .filter((c) => genderOk(c.gender_eligibility))
  }

  const disc = normDisc(riderDiscipline)
  // If discipline is missing and multiple disciplines share the same category label,
  // refuse to guess (prevents wrong bib class mapping for categories like "Open Female").
  if (!disc && pool.length > 1) {
    const uniqueDisciplines = Array.from(
      new Set(pool.map((c) => normDisc(String(c.discipline ?? ''))).filter(Boolean)),
    )
    if (uniqueDisciplines.length > 1) return null
  }
  if (disc) {
    const matchDisc = pool.filter((c) => normDisc(String(c.discipline ?? '')) === disc)
    if (matchDisc.length) pool = matchDisc
    else {
      const generalOnly = pool.filter((c) => normDisc(String(c.discipline ?? '')) === 'general')
      if (generalOnly.length) pool = generalOnly
    }
  }

  const id = pool[0]?.id
  return id ? String(id) : null
}

// ─── DB insert ────────────────────────────────────────────────────────────────

async function insertRegistration(row: ParsedRow, eventType: 'criterium' | 'itt'): Promise<ImportResult> {
  const isCriterium = eventType === 'criterium'

  const firstName = isCriterium ? row.cFirstName : row.ittFirstName
  const lastName = isCriterium ? row.cLastName : row.ittLastName
  const gender = isCriterium ? row.cGender : row.ittGender
  const dateOfBirth = isCriterium ? row.cDateOfBirth : row.ittDateOfBirth
  const address = isCriterium ? row.cAddress : row.ittAddress
  const contactNumber = isCriterium ? row.cContactNumber : row.ittContactNumber
  const emergencyContact = isCriterium ? row.cEmergencyContact : row.ittEmergencyContact
  const emergencyContactNumber = isCriterium ? row.cEmergencyContactNumber : row.ittEmergencyContactNumber
  const teamName = isCriterium ? row.cTeamName : row.ittTeamName
  const categoryInput = isCriterium ? row.cCategory : row.ittCategory
  const birthYearInput = isCriterium ? row.cBirthYear : row.ittBirthYear
  const finalCatRaw = sanitizeText(row.finalAgeCategory)
  const finalCatParts = splitFinalAgeCategory(finalCatRaw)
  const finalCat = finalCatParts.categoryLabel
  const derivedAgeCat = ageCategoryFromBirthYearOrDob(birthYearInput, dateOfBirth)
  const category = finalCat || derivedAgeCat || categoryInput
  const sheetDiscipline = sanitizeText(isCriterium ? row.cDiscipline : row.ittDiscipline)
  const discipline =
    sheetDiscipline
    || finalCatParts.disciplineHint
    || disciplineHintFromCombinedCategory(finalCatRaw)
  const jerseySize = isCriterium ? row.cEventShirt : row.ittEventShirt

  const eventTypeSlug = isCriterium ? 'criterium' : 'individual-time-trial'
  const eventTypeLabel = isCriterium ? 'Criterium' : 'Individual Time Trial'
  const name = `${firstName} ${lastName}`.trim() || row.email

  try {
    const { id: raceCategoryId, note: raceCategoryNote } = await resolveRaceCategoryIdWithOpenFemaleFallback({
      eventId: EVENT_ID,
      categoryLabel: finalCat || category || categoryInput || '',
      riderDiscipline: discipline || '',
      riderGender: gender || '',
    })
    const missingCategory = !raceCategoryId

    const fee = Number(row.amount) > 0 ? Number(row.amount) : null

    const { data: regData, error: regError } = await supabaseAdmin
      .from('registration_forms')
      .insert({
        event_id: EVENT_ID,
        race_category_id: missingCategory ? null : raceCategoryId,
        registrant_email: row.email,
        entry_event_type_slug: eventTypeSlug,
        entry_event_type_label: eventTypeLabel,
        status: 'confirmed',
        registration_fee: fee,
      })
      .select('id')
      .single()

    if (regError) throw regError
    const registrationId = regData.id

    const { error: riderError } = await supabaseAdmin
      .from('registration_rider_details')
      .insert({
        registration_id: registrationId,
        first_name: firstName || '',
        last_name: lastName || '',
        gender: gender || '',
        birth_date: dateOfBirth || '1900-01-01',
        address: address || '',
        contact_number: normalizePhoneLike(contactNumber),
        emergency_contact_name: sanitizeText(emergencyContact),
        emergency_contact_number: normalizePhoneLike(emergencyContactNumber),
        team_name: (teamName === 'N/A' || !teamName) ? null : teamName,
        discipline: sanitizeText(discipline) || null,
        age_category: category || null,
        jersey_size: sanitizeText(jerseySize) || null,
      })

    if (riderError) throw riderError

    const { error: orderError } = await supabaseAdmin
      .from('payment_orders')
      .insert({
        registration_id: registrationId,
        status: 'paid',
        amount: row.amount,
        merchant_reference: `tally-import-${row.submissionId}-${eventTypeSlug}`,
        provider_reference: providerReferenceForImportedLine(row, eventType),
      })

    if (orderError) throw orderError

    const categoryNote = missingCategory
      ? 'Imported, but category was not matched. Use Edit in Registrations to set Category before generating bib.'
      : ''

    return {
      email: row.email,
      name,
      type: eventTypeLabel,
      status: 'success',
      message: [raceCategoryNote ? `Imported successfully. ${raceCategoryNote}` : 'Imported successfully', categoryNote]
        .filter(Boolean)
        .join(' '),
      registrationId,
    }
  } catch (e) {
    return { email: row.email, name, type: eventTypeLabel, status: 'error', message: (e as Error).message || 'Unknown error' }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = { onClose: () => void; onDone: () => void }
type Step = 'upload' | 'preview' | 'importing' | 'done'

export function ImportParticipantsModal({ onClose, onDone }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedRow[]>([])
  const [parseError, setParseError] = useState('')
  const [step, setStep] = useState<Step>('upload')
  const [results, setResults] = useState<ImportResult[]>([])
  const [progress, setProgress] = useState(0)
  const [showErrors, setShowErrors] = useState(false)
  const [checkingExisting, setCheckingExisting] = useState(false)

  const totalRegistrations = parsed.reduce((acc, row) => {
    const addC = row.isCriterium && !row.existsCriterium ? 1 : 0
    const addI = row.isITT && !row.existsITT ? 1 : 0
    return acc + addC + addI
  }, 0)

  const withPaymongoId = parsed.filter((r) => r.paymongoId).length
  const previewRows = parsed.filter((row) => (row.isCriterium && !row.existsCriterium) || (row.isITT && !row.existsITT))
  const previewWithPaymongoId = previewRows.filter((r) => r.paymongoId).length
  const alreadyImportedCount = parsed.reduce((acc, row) => {
    const addC = row.isCriterium && row.existsCriterium ? 1 : 0
    const addI = row.isITT && row.existsITT ? 1 : 0
    return acc + addC + addI
  }, 0)

  function readFileAsText(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(f)
    })
  }

  async function loadMatrixFromFile(f: File): Promise<string[][]> {
    const lower = f.name.toLowerCase()
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      return matrixFromXlsxFile(f)
    }
    const text = await readFileAsText(f)
    return splitMatrixFromText(text)
  }

  async function handleFile(f: File) {
    setFile(f)
    setParseError('')
    try {
      const matrix = await loadMatrixFromFile(f)
      const layoutErr = validateImportMatrix(matrix)
      if (layoutErr) {
        setParseError(layoutErr)
        setParsed([])
        return
      }
      const rows = parseTallyRows(matrix)
      if (rows.length === 0) {
        setParseError(
          'No importable rows. Need SUCCESS or PAID payment status; a valid email; and Criterium/ITT flags.',
        )
        setParsed([])
        return
      }
      // Start with a clean state; then mark existing imports to avoid duplicates.
      setParsed(rows.map((r) => ({ ...r, existsCriterium: false, existsITT: false })))
      setCheckingExisting(true)
      void (async () => {
        try {
          const refs: string[] = []
          for (const r of rows) {
            if (r.isCriterium) refs.push(merchantReferenceForRow(r, 'criterium'))
            if (r.isITT) refs.push(merchantReferenceForRow(r, 'itt'))
          }
          const unique = Array.from(new Set(refs)).filter(Boolean)
          if (unique.length === 0) return

          const existing = new Set<string>()
          const CHUNK = 250
          for (let i = 0; i < unique.length; i += CHUNK) {
            const chunk = unique.slice(i, i + CHUNK)
            const { data, error } = await supabaseAdmin
              .from('payment_orders')
              .select('merchant_reference')
              .in('merchant_reference', chunk)
            if (error) throw error
            for (const item of (data ?? []) as Array<{ merchant_reference: string | null }>) {
              const mr = String(item.merchant_reference ?? '').trim()
              if (mr) existing.add(mr)
            }
          }

          setParsed((prev) =>
            prev.map((r) => {
              const existsC = r.isCriterium ? existing.has(merchantReferenceForRow(r, 'criterium')) : false
              const existsI = r.isITT ? existing.has(merchantReferenceForRow(r, 'itt')) : false
              return { ...r, existsCriterium: existsC, existsITT: existsI }
            }),
          )
        } catch {
          // Non-blocking: if policies prevent reading payment_orders, we still allow import.
        } finally {
          setCheckingExisting(false)
        }
      })()
    } catch {
      setParseError('Failed to read this file. For .xlsx use the first sheet; for text use UTF-8 CSV or TSV.')
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f && isSupportedImportFileName(f.name)) void handleFile(f)
  }

  function resetUpload() {
    setFile(null)
    setParsed([])
    setParseError('')
    setStep('upload')
  }

  async function handleImport() {
    setStep('importing')
    setProgress(0)
    const allResults: ImportResult[] = []
    let done = 0
    const total = Math.max(1, totalRegistrations)
    const bumpProgress = () => {
      done += 1
      setProgress(Math.min(100, Math.round((done / total) * 100)))
    }

    async function importOnly(row: ParsedRow, eventType: 'criterium' | 'itt') {
      const already = eventType === 'criterium' ? Boolean(row.existsCriterium) : Boolean(row.existsITT)
      if (already) {
        const label = eventType === 'criterium' ? 'Criterium' : 'Individual Time Trial'
        allResults.push({
          email: row.email,
          name: `${(eventType === 'criterium' ? row.cFirstName : row.ittFirstName)} ${(eventType === 'criterium' ? row.cLastName : row.ittLastName)}`.trim() || row.email,
          type: label,
          status: 'skipped',
          message: 'Skipped (already imported).',
        })
        return
      }
      const inserted = await insertRegistration(row, eventType)
      if (inserted.status === 'success') {
        inserted.message = 'Imported successfully. Fill in rider details if needed, then use Generate bib on each row in Registrations.'
      }
      allResults.push(inserted)
    }

    if (totalRegistrations <= 0) {
      setProgress(100)
      setResults(allResults)
      setStep('done')
      return
    }

    for (const row of parsed) {
      // Only count ops that match `totalRegistrations` (already-imported branches were inflating % past 100).
      if (row.isCriterium && !row.existsCriterium) {
        await importOnly(row, 'criterium')
        bumpProgress()
      }
      if (row.isITT && !row.existsITT) {
        await importOnly(row, 'itt')
        bumpProgress()
      }
    }

    setProgress(100)
    setResults(allResults)
    setStep('done')
  }

  const successCount = results.filter((r) => r.status === 'success').length
  const errorCount = results.filter((r) => r.status === 'error').length
  const errorResults = results.filter((r) => r.status === 'error')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1e4a8e] text-white">
              <Upload className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Import Participants</h3>
              <p className="text-xs text-slate-500">
                CSV, TSV, or Excel — header row with <code className="rounded bg-slate-100 px-1 text-[11px]">PAYMENT ID</code> and{' '}
                <code className="rounded bg-slate-100 px-1 text-[11px]">Price</code>; optional <code className="rounded bg-slate-100 px-1 text-[11px]">FINAL AGE CATEGORY</code>
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Step: Upload ── */}
        {step === 'upload' && (
          <div className="space-y-4 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Rows with <span className="text-emerald-600">SUCCESS</span> or <span className="text-emerald-600">PAID</span> status import. We'll skip rows already imported to prevent duplicates.
            </p>

            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-8 transition
                ${file ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50 hover:border-[#1e4a8e] hover:bg-blue-50/30'}`}
            >
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${file ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                <FileText className={`h-5 w-5 ${file ? 'text-emerald-600' : 'text-slate-400'}`} />
              </div>
              <div className="min-w-0">
                {file ? (
                  <>
                    <p className="truncate text-xs font-semibold text-emerald-700">{file.name}</p>
                    <p className="text-[11px] text-emerald-600">
                      {parsed.length} row{parsed.length !== 1 ? 's' : ''} found
                      {alreadyImportedCount > 0 ? ` · ${alreadyImportedCount} already imported` : ''}
                      {checkingExisting ? ' · checking…' : ''}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-medium text-slate-700">Drop file or click to browse</p>
                    <p className="text-[11px] text-slate-400">.csv, .tsv, .xlsx — Google Sheets / Tally export</p>
                  </>
                )}
              </div>
              {file && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFile(null); setParsed([]) }}
                  className="ml-auto shrink-0 rounded p-1 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                if (isSupportedImportFileName(f.name)) void handleFile(f)
                else setParseError('Use a .csv, .tsv, or .xlsx file.')
              }}
            />

            {/* Warning: rows missing Payment ID */}
            {parsed.length > 0 && withPaymongoId < parsed.length && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <p className="text-[11px] text-amber-700">
                  {parsed.length - withPaymongoId} row{parsed.length - withPaymongoId !== 1 ? 's' : ''} have no <span className="font-mono">PAYMENT ID</span> — reference no. will stay blank.
                </p>
              </div>
            )}

            {parseError && (
              <p className="flex items-center gap-1.5 text-xs text-rose-600">
                <AlertTriangle className="h-3.5 w-3.5" /> {parseError}
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep('preview')}
                disabled={parsed.length === 0}
                className="rounded-lg bg-[#1e4a8e] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163b72] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Preview Import →
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Preview ── */}
        {step === 'preview' && (
          <>
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">{file?.name}</span>
              <button type="button" onClick={resetUpload} className="text-xs text-slate-400 hover:text-slate-600">Change file</button>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100">
              <div className="px-5 py-3 text-center">
                <p className="text-2xl font-semibold text-slate-900">{previewRows.length}</p>
                <p className="text-[11px] text-slate-500">Rows to import</p>
              </div>
              <div className="px-5 py-3 text-center">
                <p className="text-2xl font-semibold text-slate-900">{totalRegistrations}</p>
                <p className="text-[11px] text-slate-500">New registrations</p>
              </div>
              <div className="px-5 py-3 text-center">
                <p className="text-2xl font-semibold text-emerald-600">{previewWithPaymongoId}</p>
                <p className="text-[11px] text-slate-500">With payment ID</p>
              </div>
            </div>

            {/* Preview table */}
            <div className="max-h-72 overflow-auto">
              {/* Desktop */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="min-w-[600px] w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 pl-5 pr-3 font-semibold">Name</th>
                      <th className="py-2 pr-3 font-semibold">Email</th>
                      <th className="py-2 pr-3 font-semibold">Event(s)</th>
                      <th className="py-2 pr-3 font-semibold">Category</th>
                      <th className="py-2 pr-3 font-semibold">Amount</th>
                      <th className="py-2 pr-5 font-semibold">Payment ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {previewRows.map((row, i) => {
                      const name = (row.isCriterium
                        ? `${row.cFirstName} ${row.cLastName}`
                        : `${row.ittFirstName} ${row.ittLastName}`).trim()
                      const events = [
                        row.isCriterium && !row.existsCriterium ? 'CRI' : null,
                        row.isITT && !row.existsITT ? 'ITT' : null,
                      ]
                        .filter(Boolean)
                        .join(' + ')
                      const sheetCat = row.isCriterium ? row.cCategory : row.ittCategory
                      const cat = row.finalAgeCategory?.trim() || sheetCat?.trim() || ''
                      return (
                        <tr key={i} className="text-slate-700 hover:bg-slate-50/60">
                          <td className="py-2 pl-5 pr-3 font-semibold text-slate-800">{name || '—'}</td>
                          <td className="py-2 pr-3 text-slate-500">{row.email}</td>
                          <td className="py-2 pr-3">
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                              {events || '—'}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-slate-500">{cat || '—'}</td>
                          <td className="py-2 pr-3 font-medium text-slate-700">
                            ₱{row.amount.toLocaleString()}
                          </td>
                          <td className="py-2 pr-5">
                            {row.paymongoId
                              ? <span className="font-mono text-[10px] text-emerald-700">{row.paymongoId.slice(0, 20)}…</span>
                              : <span className="italic text-slate-400">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="divide-y divide-slate-100 sm:hidden">
                {previewRows.map((row, i) => {
                  const name = (row.isCriterium
                    ? `${row.cFirstName} ${row.cLastName}`
                    : `${row.ittFirstName} ${row.ittLastName}`).trim()
                  const events = [
                    row.isCriterium && !row.existsCriterium ? 'CRI' : null,
                    row.isITT && !row.existsITT ? 'ITT' : null,
                  ]
                    .filter(Boolean)
                    .join(' + ')
                  const sheetCat = row.isCriterium ? row.cCategory : row.ittCategory
                  const cat = row.finalAgeCategory?.trim() || sheetCat?.trim() || ''
                  return (
                    <div key={i} className="px-4 py-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-800">{name || '—'}</p>
                          <p className="truncate text-slate-500">{row.email}</p>
                        </div>
                        <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">{events || '—'}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500">
                        <span><span className="font-medium text-slate-600">Category:</span> {cat || '—'}</span>
                        <span><span className="font-medium text-slate-600">Amount:</span> ₱{row.amount.toLocaleString()}</span>
                        <span>
                          <span className="font-medium text-slate-600">Payment ID:</span>{' '}
                          {row.paymongoId
                            ? <span className="font-mono text-emerald-700">{row.paymongoId.slice(0, 16)}…</span>
                            : <span className="italic text-slate-400">—</span>}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
              <p className="text-xs text-slate-500">
                Creates <span className="font-semibold text-slate-700">{totalRegistrations} registration{totalRegistrations !== 1 ? 's' : ''}</span> — all marked as <span className="font-semibold text-emerald-600">paid</span>.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={resetUpload} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  Back
                </button>
                <button type="button" onClick={handleImport} className="rounded-lg bg-[#1e4a8e] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163b72]">
                  Import {totalRegistrations} Registrations
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Step: Importing ── */}
        {step === 'importing' && (
          <div className="flex flex-col items-center justify-center gap-4 px-5 py-14">
            <Loader2 className="h-8 w-8 animate-spin text-[#1e4a8e]" />
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-800">Importing participants…</p>
              <p className="mt-0.5 text-xs text-slate-500">{progress}% complete</p>
            </div>
            <div className="h-1.5 w-64 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#1e4a8e] transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* ── Step: Done ── */}
        {step === 'done' && (
          <>
            <div className="px-5 py-6">
              <div className="mb-4 flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">Import complete</p>
                  <p className="text-xs text-slate-500">
                    {successCount} imported successfully{errorCount > 0 ? `, ${errorCount} failed` : ''}
                  </p>
                </div>
              </div>

              {errorCount > 0 && (
                <div className="rounded-lg border border-rose-100 bg-rose-50">
                  <button
                    type="button"
                    onClick={() => setShowErrors(!showErrors)}
                    className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold text-rose-700"
                  >
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {errorCount} failed import{errorCount !== 1 ? 's' : ''}
                    </span>
                    {showErrors ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {showErrors && (
                    <div className="border-t border-rose-100 px-4 pb-3">
                      {errorResults.map((r, i) => (
                        <div key={i} className="mt-2">
                          <p className="text-xs font-medium text-rose-800">{r.name} ({r.email}) — {r.type}</p>
                          <p className="text-[11px] text-rose-600">{r.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={() => { onDone(); onClose() }}
                className="rounded-lg bg-[#1e4a8e] px-4 py-2 text-xs font-semibold text-white hover:bg-[#163b72]"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}