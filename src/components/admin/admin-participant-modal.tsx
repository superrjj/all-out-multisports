import { useRef, useState } from 'react'
import { X, Upload, FileText, AlertTriangle, CheckCircle2, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase as supabaseAdmin } from '../../lib/supabase'
import { adminApi } from '../../services/adminApi'
import { generateAndUploadAdminCertificate } from '../../utils/adminCertificate'

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

  cFirstName: string; cLastName: string; cGender: string; cDateOfBirth: string
  cAddress: string; cContactNumber: string; cEmergencyContact: string; cEmergencyContactNumber: string
  cTeamName: string; cCategory: string; cDiscipline: string; cEventShirt: string
  cBirthYear: string

  ittFirstName: string; ittLastName: string; ittGender: string; ittDateOfBirth: string
  ittAddress: string; ittContactNumber: string; ittEmergencyContact: string; ittEmergencyContactNumber: string
  ittTeamName: string; ittCategory: string; ittDiscipline: string; ittEventShirt: string
  ittBirthYear: string
}

type ImportResult = {
  email: string
  name: string
  type: string
  status: 'success' | 'error' | 'skipped'
  message: string
  registrationId?: string
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

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

/**
 * Column map (0-indexed):
 *  0   PAYMENT ID        ← PayMongo ID
 *  1   PAYMENT STATUS
 *  2   Submission ID
 *  3   Respondent ID
 *  4   Submitted at
 *  5   EMAIL
 *  6   EVENT
 *  7   EVENT (CRITERIUM)
 *  8   EVENT (INDIVIDUAL TIME TRIAL)
 *
 * Criterium-only (9–22):
 *  9  First Name1  10  Last Name1  11  Gender1  12  Date Of Birth1
 *  13 Address1     14  Contact Number  15  Emergency Contact
 *  16 Emergency Contact Number   17  Team Name1
 *  18 Category1   19  Discipline1   20  Birth Year1   21  Race Age1   22  Event Shirt1
 *
 * ITT / shared both-event (23–36):
 *  23 First Name  24  Last Name  25  Gender  26  Date Of Birth
 *  27 Address     28  Contact Number  29  Emergency Contact
 *  30 Emergency Contact Number   31  Team Name
 *  32 ITT Category  33  Discipline  34  Birth Year  35  Race Age 2  36  ITT Event Shirt
 *
 * Both-events criterium-specific (37–39):
 *  37 Criterium Category   38  Discipline   39  Criterium Event Shirt
 *
 *  40 Proof of Payment
 *  41 Price  ← amount
 */
function parseTallyCSV(text: string): ParsedRow[] {
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []

  const rows: ParsedRow[] = []

  for (const line of lines.slice(1)) {
    const c = splitCSVLine(line)

    const paymongoId = (c[0] ?? '').trim() || undefined
    const paymentStatus = (c[1] ?? '').trim()
    const submissionId = (c[2] ?? '').trim()
    const email = (c[5] ?? '').trim()
    const isCriterium = (c[7] ?? '').toUpperCase() === 'TRUE'
    const isITT = (c[8] ?? '').toUpperCase() === 'TRUE'
    const amount = parseFloat((c[41] ?? '0').replace(/[^0-9.]/g, '')) || 0

    if (!email) continue
    if (paymentStatus.toUpperCase() !== 'SUCCESS') continue

    let cFirstName = '', cLastName = '', cGender = '', cDateOfBirth = ''
    let cAddress = '', cContactNumber = '', cEmergencyContact = '', cEmergencyContactNumber = ''
    let cTeamName = '', cCategory = '', cDiscipline = '', cEventShirt = '', cBirthYear = ''

    let ittFirstName = '', ittLastName = '', ittGender = '', ittDateOfBirth = ''
    let ittAddress = '', ittContactNumber = '', ittEmergencyContact = '', ittEmergencyContactNumber = ''
    let ittTeamName = '', ittCategory = '', ittDiscipline = '', ittEventShirt = '', ittBirthYear = ''

    if (isCriterium && !isITT) {
      // Criterium only — cols 9–22
      cFirstName = c[9] ?? ''; cLastName = c[10] ?? ''; cGender = c[11] ?? ''
      cDateOfBirth = c[12] ?? ''; cAddress = c[13] ?? ''; cContactNumber = c[14] ?? ''
      cEmergencyContact = c[15] ?? ''; cEmergencyContactNumber = c[16] ?? ''
      cTeamName = c[17] ?? ''; cCategory = c[18] ?? ''; cDiscipline = c[19] ?? ''
      cBirthYear = c[20] ?? ''
      cEventShirt = c[22] ?? ''
    } else if (!isCriterium && isITT) {
      // ITT only — cols 23–36
      ittFirstName = c[23] ?? ''; ittLastName = c[24] ?? ''; ittGender = c[25] ?? ''
      ittDateOfBirth = c[26] ?? ''; ittAddress = c[27] ?? ''; ittContactNumber = c[28] ?? ''
      ittEmergencyContact = c[29] ?? ''; ittEmergencyContactNumber = c[30] ?? ''
      ittTeamName = c[31] ?? ''; ittCategory = c[32] ?? ''; ittDiscipline = c[33] ?? ''
      ittBirthYear = c[34] ?? ''
      ittEventShirt = c[36] ?? ''
    } else if (isCriterium && isITT) {
      // Both — shared rider info in ITT cols (23–31), ITT-specific (32–36), CRI-specific (37–39)
      const sharedFirst = c[23] ?? ''; const sharedLast = c[24] ?? ''
      const sharedGender = c[25] ?? ''; const sharedDOB = c[26] ?? ''
      const sharedAddr = c[27] ?? ''; const sharedContact = c[28] ?? ''
      const sharedEmergency = c[29] ?? ''; const sharedEmergencyNum = c[30] ?? ''
      const sharedTeam = c[31] ?? ''

      ittFirstName = sharedFirst; ittLastName = sharedLast; ittGender = sharedGender
      ittDateOfBirth = sharedDOB; ittAddress = sharedAddr; ittContactNumber = sharedContact
      ittEmergencyContact = sharedEmergency; ittEmergencyContactNumber = sharedEmergencyNum
      ittTeamName = sharedTeam; ittCategory = c[32] ?? ''; ittDiscipline = c[33] ?? ''
      ittBirthYear = c[34] ?? ''
      ittEventShirt = c[36] ?? ''

      cFirstName = sharedFirst; cLastName = sharedLast; cGender = sharedGender
      cDateOfBirth = sharedDOB; cAddress = sharedAddr; cContactNumber = sharedContact
      cEmergencyContact = sharedEmergency; cEmergencyContactNumber = sharedEmergencyNum
      cTeamName = sharedTeam; cCategory = c[37] ?? ''; cDiscipline = c[38] ?? ''
      cBirthYear = c[34] ?? ''
      cEventShirt = c[39] ?? ''
    }

    rows.push({
      paymentStatus, submissionId, email, isCriterium, isITT, paymongoId, amount,
      cFirstName, cLastName, cGender, cDateOfBirth,
      cAddress, cContactNumber, cEmergencyContact, cEmergencyContactNumber,
      cTeamName, cCategory, cDiscipline, cEventShirt, cBirthYear,
      ittFirstName, ittLastName, ittGender, ittDateOfBirth,
      ittAddress, ittContactNumber, ittEmergencyContact, ittEmergencyContactNumber,
      ittTeamName, ittCategory, ittDiscipline, ittEventShirt, ittBirthYear,
    })
  }

  return rows
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
  // Always prioritize birth-year based category to keep imports consistent.
  const category = ageCategoryFromBirthYearOrDob(birthYearInput, dateOfBirth) || categoryInput
  const discipline = isCriterium ? row.cDiscipline : row.ittDiscipline
  const jerseySize = isCriterium ? row.cEventShirt : row.ittEventShirt

  const eventTypeSlug = isCriterium ? 'criterium' : 'individual-time-trial'
  const eventTypeLabel = isCriterium ? 'Criterium' : 'Individual Time Trial'
  const name = `${firstName} ${lastName}`.trim() || row.email

  try {
    const raceCategoryId = await resolveRaceCategoryIdForImport(
      EVENT_ID,
      category || categoryInput || '',
      discipline || '',
      gender || '',
    )
    if (!raceCategoryId) {
      throw new Error(
        `No race_categories row matched "${category || categoryInput || '(blank)'}" for this event (check spelling vs Admin → Events, and discipline "${discipline || '—'}").`,
      )
    }

    const fee = Number(row.amount) > 0 ? Number(row.amount) : null

    const { data: regData, error: regError } = await supabaseAdmin
      .from('registration_forms')
      .insert({
        event_id: EVENT_ID,
        race_category_id: raceCategoryId,
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

    return { email: row.email, name, type: eventTypeLabel, status: 'success', message: 'Imported successfully', registrationId }
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

  const totalRegistrations = parsed.reduce((acc, row) => {
    return acc + (row.isCriterium ? 1 : 0) + (row.isITT ? 1 : 0)
  }, 0)

  const withPaymongoId = parsed.filter((r) => r.paymongoId).length

  function readFile(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsText(f)
    })
  }

  async function handleFile(f: File) {
    setFile(f)
    setParseError('')
    try {
      const text = await readFile(f)
      const rows = parseTallyCSV(text)
      if (rows.length === 0) {
        setParseError('No SUCCESS rows found. Make sure this is the correct file.')
        return
      }
      setParsed(rows)
    } catch {
      setParseError('Failed to read CSV.')
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f?.name.endsWith('.csv')) void handleFile(f)
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

    async function importAndFinalize(row: ParsedRow, eventType: 'criterium' | 'itt') {
      const inserted = await insertRegistration(row, eventType)
      if (inserted.status === 'success' && inserted.registrationId) {
        const directProviderRef = providerReferenceForImportedLine(row, eventType)
        const sharedBundleProviderRef = String(row.paymongoId ?? '').trim()
        const hasPaymongoReference =
          String(directProviderRef ?? '').trim().startsWith('pay_') || sharedBundleProviderRef.startsWith('pay_')
        if (!hasPaymongoReference) {
          inserted.message = 'Imported. Auto bib/certificate skipped (missing Payment ID / pay_ reference).'
          allResults.push(inserted)
          return
        }
        try {
          const bib = await adminApi.adminGenerateBib(inserted.registrationId)
          const bibNo = String(bib?.bib_number ?? '').trim()
          if (!bibNo) throw new Error('Bib assignment returned empty bib number.')
          await generateAndUploadAdminCertificate(inserted.registrationId)
          inserted.message = `Imported, bib assigned (${bibNo}), certificate saved to storage.`
        } catch (e) {
          inserted.message = `Imported, but auto-finalize failed: ${(e as Error).message || 'Unknown error'}`
        }
      }
      allResults.push(inserted)
    }

    for (const row of parsed) {
      if (row.isCriterium) {
        await importAndFinalize(row, 'criterium')
        done++
        setProgress(Math.round((done / totalRegistrations) * 100))
      }
      if (row.isITT) {
        await importAndFinalize(row, 'itt')
        done++
        setProgress(Math.round((done / totalRegistrations) * 100))
      }
    }

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
                Upload your Tally CSV — must include <code className="rounded bg-slate-100 px-1 text-[11px]">PAYMENT ID</code> and <code className="rounded bg-slate-100 px-1 text-[11px]">Price</code> columns
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
              Only <span className="text-emerald-600">SUCCESS</span> rows will be imported. Make sure your sheet has <span className="font-mono text-slate-600">PAYMENT ID</span> and <span className="font-mono text-slate-600">Price</span> columns.
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
                      {parsed.length} SUCCESS rows · {withPaymongoId} with Payment ID
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-medium text-slate-700">Drop CSV here or click to browse</p>
                    <p className="text-[11px] text-slate-400">Exported from Google Sheets / Tally</p>
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
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }} />

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
                <p className="text-2xl font-semibold text-slate-900">{parsed.length}</p>
                <p className="text-[11px] text-slate-500">Paid submissions</p>
              </div>
              <div className="px-5 py-3 text-center">
                <p className="text-2xl font-semibold text-slate-900">{totalRegistrations}</p>
                <p className="text-[11px] text-slate-500">Registrations to create</p>
              </div>
              <div className="px-5 py-3 text-center">
                <p className="text-2xl font-semibold text-emerald-600">{withPaymongoId}</p>
                <p className="text-[11px] text-slate-500">With Payment ID</p>
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
                    {parsed.map((row, i) => {
                      const name = (row.isCriterium
                        ? `${row.cFirstName} ${row.cLastName}`
                        : `${row.ittFirstName} ${row.ittLastName}`).trim()
                      const events = [row.isCriterium ? 'CRI' : null, row.isITT ? 'ITT' : null].filter(Boolean).join(' + ')
                      const cat = row.isCriterium ? row.cCategory : row.ittCategory
                      return (
                        <tr key={i} className="text-slate-700 hover:bg-slate-50/60">
                          <td className="py-2 pl-5 pr-3 font-semibold text-slate-800">{name || '—'}</td>
                          <td className="py-2 pr-3 text-slate-500">{row.email}</td>
                          <td className="py-2 pr-3">
                            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">{events}</span>
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
                {parsed.map((row, i) => {
                  const name = (row.isCriterium
                    ? `${row.cFirstName} ${row.cLastName}`
                    : `${row.ittFirstName} ${row.ittLastName}`).trim()
                  const events = [row.isCriterium ? 'CRI' : null, row.isITT ? 'ITT' : null].filter(Boolean).join(' + ')
                  const cat = row.isCriterium ? row.cCategory : row.ittCategory
                  return (
                    <div key={i} className="px-4 py-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-800">{name || '—'}</p>
                          <p className="truncate text-slate-500">{row.email}</p>
                        </div>
                        <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">{events}</span>
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