import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library'
import { RefreshCw, Search, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '../../lib/supabase'
import { adminModulesApi } from '../../services/adminModulesApi'
import { ModuleShell, SectionCard, formatDateTime, useModuleLoader } from './admin-module-shared'

type ScannerControls = {
  stop: () => void
  switchTorch?: (on: boolean) => Promise<void> | void
}

type ScanResult = {
  status: 'valid' | 'invalid' | 'duplicate'
  message: string
  code: string
  riderName?: string
  category?: string
  discipline?: string
  eventType?: string
  bibNumber?: string
  eventTitle?: string
  eventId?: string
  registrationId?: string
  scannedAt: string
  /** How the lookup was started (stored on claim for audit-style labels). */
  claimSource?: 'qr' | 'manual'
}

function formatScanStatusLabel(value: unknown) {
  const status = String(value ?? '').toLowerCase()
  if (status === 'valid') return 'Claimed'
  if (status === 'duplicate') return 'Duplicate'
  if (status === 'invalid') return 'Invalid'
  return 'Unknown'
}

function statusBadgeClass(value: unknown) {
  const status = String(value ?? '').toLowerCase()
  if (status === 'valid') return 'bg-emerald-50 text-emerald-700 border-emerald-200'
  if (status === 'duplicate') return 'bg-amber-50 text-amber-700 border-amber-200'
  if (status === 'invalid') return 'bg-rose-50 text-rose-700 border-rose-200'
  return 'bg-slate-50 text-slate-700 border-slate-200'
}

/** Human-readable event type: prefers stored rider label; otherwise formats event `race_type` (not raw slug). */
function formatEventTypeForDisplay(entryLabel: string | null | undefined, eventRaceTypeFallback: string | null | undefined) {
  const label = String(entryLabel ?? '').trim()
  if (label) return label
  const first = String(eventRaceTypeFallback ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0]
  if (!first) return '—'
  return first
    .split(/[_-]/)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ''))
    .join(' ')
}

function extractBibFromCode(code: string) {
  const trimmed = code.trim()
  if (!trimmed) return ''
  // New certificates encode a JSON payload.
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        bib_number?: unknown
        bibNumber?: unknown
        bib?: unknown
        code?: unknown
      }
      const payloadBib = String(parsed.bib_number ?? parsed.bibNumber ?? parsed.bib ?? parsed.code ?? '').trim()
      if (payloadBib) return payloadBib
    } catch {
      // Fall back to legacy formats below.
    }
  }
  const match = trimmed.match(/BIB:([^|]+)/i)
  if (match?.[1]) return match[1].trim()
  const compactMatch = trimmed.match(/"b"\s*:\s*"([^"]+)"/i)
  if (compactMatch?.[1]) return compactMatch[1].trim()
  return trimmed
}

function RiderKitDetailRows({ result }: { result: ScanResult }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="text-slate-500">Rider name</p>
        <p className="text-right font-semibold text-slate-900">{result.riderName ?? '—'}</p>
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="text-slate-500">Category</p>
        <p className="text-right font-semibold text-slate-900">{result.category ?? '—'}</p>
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="text-slate-500">Bib number</p>
        <p className="text-right font-semibold text-slate-900">{result.bibNumber ?? result.code}</p>
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="text-slate-500">Discipline</p>
        <p className="text-right font-semibold text-slate-900">{result.discipline ?? '—'}</p>
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="text-slate-500">Event type</p>
        <p className="text-right font-semibold text-slate-900">{result.eventType ?? '—'}</p>
      </div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="text-slate-500">Event</p>
        <p className="text-right font-semibold text-slate-900">{result.eventTitle ?? '—'}</p>
      </div>
    </div>
  )
}

const DUPLICATE_SCAN_SUMMARY =
  'This participant has already completed race kit claim for this registration. A second kit should not be issued without authorization from race control.'

/** Shape matches rows returned by adminModulesApi.qrDashboard() scans list. */
async function enrichQrCheckinScanRow(scan: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const registrationId = String(scan.registration_id ?? '')
  const [{ data: rider }, { data: registration }] = await Promise.all([
    supabase
      .from('registration_rider_details')
      .select('first_name, last_name, discipline, age_category')
      .eq('registration_id', registrationId)
      .maybeSingle(),
    supabase.from('registration_forms').select('id, event_id, bib_number').eq('id', registrationId).maybeSingle(),
  ])
  if (!registration) return null
  if (!String(registration.bib_number ?? '').trim()) return null
  const riderName = [rider?.first_name, rider?.last_name].filter(Boolean).join(' ').trim() || 'Registered rider'
  let eventType = '—'
  let eventTitle = 'Current event'
  if (registration?.event_id) {
    const { data: event } = await supabase
      .from('events')
      .select('title, race_type')
      .eq('id', registration.event_id)
      .maybeSingle()
    eventType = String(event?.race_type ?? '—')
    eventTitle = String(event?.title ?? 'Current event')
  }
  return {
    ...scan,
    bib_number: registration.bib_number,
    rider_name: riderName,
    discipline: String(rider?.discipline ?? '—'),
    category: String(rider?.age_category ?? '—'),
    event_type: eventType,
    event_title: eventTitle,
  }
}

function escapeIlikeForAdmin(value: string) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

function quotePostgrestForAdmin(val: string) {
  return `"${String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

type KitLookupOk = {
  registration: {
    id: string
    bib_number: string | null
    status: string | null
    event_id: string | null
    entry_event_type_label?: string | null
  }
  rider: {
    first_name?: string | null
    last_name?: string | null
    age_category?: string | null
    discipline?: string | null
  }
  event: { title?: string | null; race_type?: string | null } | null
  duplicateClaim: { id: string } | null
  lookupCode: string
}

type KitLookupFail = { error: 'not_found' | 'no_bib' | 'ambiguous'; message: string }

/** One row when several riders match a manual name search (all have assigned bibs). */
type ManualMatchRow = {
  registrationId: string
  riderName: string
  bibNumber: string
  category: string
  discipline: string
  eventType: string
  eventTitle: string
}

async function finalizeKitLookupFromRegistrationId(registrationId: string): Promise<KitLookupOk | KitLookupFail> {
  const { data: registration, error: regError } = await supabase
    .from('registration_forms')
    .select('id, bib_number, status, event_id, entry_event_type_label')
    .eq('id', registrationId)
    .maybeSingle()
  if (regError) throw regError
  if (!registration?.id) return { error: 'not_found', message: 'Registration not found.' }

  const bibStr = String(registration.bib_number ?? '').trim()
  if (!bibStr) {
    return { error: 'no_bib', message: 'This registration has no assigned bib number yet.' }
  }

  const { data: duplicateClaim, error: duplicateError } = await supabase
    .from('qr_checkins')
    .select('id')
    .eq('registration_id', registration.id)
    .eq('scan_status', 'valid')
    .limit(1)
    .maybeSingle()
  if (duplicateError) throw duplicateError

  const [{ data: rider }, { data: event }] = await Promise.all([
    supabase
      .from('registration_rider_details')
      .select('first_name, last_name, age_category, discipline')
      .eq('registration_id', registration.id)
      .limit(1)
      .maybeSingle(),
    supabase.from('events').select('title, race_type').eq('id', String(registration.event_id ?? '')).limit(1).maybeSingle(),
  ])

  return {
    registration: registration as KitLookupOk['registration'],
    rider: rider ?? {},
    event: event ?? null,
    duplicateClaim: duplicateClaim?.id ? duplicateClaim : null,
    lookupCode: bibStr,
  }
}

/** Bib-only resolution (QR payloads and manual bib entry). */
async function resolveBibOnlyForKitClaim(trimmed: string): Promise<KitLookupOk | KitLookupFail> {
  let registration: KitLookupOk['registration'] | null = null

  const { data: byBibExact, error: bibExactErr } = await supabase
    .from('registration_forms')
    .select('id, bib_number, status, event_id, entry_event_type_label')
    .eq('bib_number', trimmed)
    .maybeSingle()
  if (bibExactErr) throw bibExactErr
  if (byBibExact?.id) registration = byBibExact as KitLookupOk['registration']

  if (!registration?.id) {
    const { data: byBibIlike, error: bibIlikeErr } = await supabase
      .from('registration_forms')
      .select('id, bib_number, status, event_id, entry_event_type_label')
      .ilike('bib_number', trimmed)
      .limit(2)
    if (bibIlikeErr) throw bibIlikeErr
    const bibMatches = (byBibIlike ?? []) as Array<KitLookupOk['registration']>
    if (bibMatches.length > 1) {
      return { error: 'ambiguous', message: 'Multiple registrations matched this bib. Contact registration support.' }
    }
    if (bibMatches.length === 1) registration = bibMatches[0]
  }

  if (!registration?.id) {
    return { error: 'not_found', message: 'No registration matched this bib number.' }
  }

  return finalizeKitLookupFromRegistrationId(registration.id)
}

/** Name search for manual lookup: riders with assigned bibs only. */
async function findManualNameMatchRows(trimmed: string): Promise<ManualMatchRow[]> {
  const tokens = trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length === 0) return []

  const primary = tokens.reduce((a, b) => (b.length > a.length ? b : a), tokens[0])
  const pattern = `%${escapeIlikeForAdmin(primary)}%`
  const quoted = quotePostgrestForAdmin(pattern)
  const { data: riderRows, error: riderErr } = await supabase
    .from('registration_rider_details')
    .select('registration_id, first_name, last_name, age_category, discipline')
    .or(`first_name.ilike.${quoted},last_name.ilike.${quoted}`)
    .limit(80)
  if (riderErr) throw riderErr

  const filtered = (riderRows ?? []).filter((row) => {
    const full = [row.first_name, row.last_name].filter(Boolean).join(' ').toLowerCase()
    if (!full) return false
    return tokens.every((tok) => full.includes(tok))
  })
  const regIds = Array.from(new Set(filtered.map((r) => String(r.registration_id ?? '')).filter(Boolean)))
  if (regIds.length === 0) return []

  const { data: forms, error: formsErr } = await supabase
    .from('registration_forms')
    .select('id, bib_number, status, event_id, entry_event_type_label')
    .in('id', regIds)
  if (formsErr) throw formsErr

  const withBib = (forms ?? []).filter((f) => String((f as { bib_number?: string | null }).bib_number ?? '').trim())
  if (withBib.length === 0) return []

  const riderByReg = new Map<string, (typeof filtered)[number]>()
  for (const r of filtered) {
    const id = String(r.registration_id ?? '')
    if (id && !riderByReg.has(id)) riderByReg.set(id, r)
  }
  const eventIds = Array.from(new Set(withBib.map((f) => String(f.event_id ?? '')).filter(Boolean)))
  let eventById = new Map<string, { title: string | null; race_type: string | null }>()
  if (eventIds.length > 0) {
    const { data: events, error: evErr } = await supabase.from('events').select('id, title, race_type').in('id', eventIds)
    if (evErr) throw evErr
    eventById = new Map(
      (events ?? []).map((e) => [
        String(e.id),
        { title: (e as { title?: string | null }).title ?? null, race_type: (e as { race_type?: string | null }).race_type ?? null },
      ]),
    )
  }

  const rows: ManualMatchRow[] = []
  for (const reg of withBib as KitLookupOk['registration'][]) {
    const rider = riderByReg.get(String(reg.id))
    const ev = reg.event_id ? eventById.get(String(reg.event_id)) : undefined
    const riderName = [rider?.first_name, rider?.last_name].filter(Boolean).join(' ').trim() || 'Registered rider'
    rows.push({
      registrationId: String(reg.id),
      riderName,
      bibNumber: String(reg.bib_number ?? '').trim(),
      category: String(rider?.age_category ?? '—'),
      discipline: String(rider?.discipline ?? '—'),
      eventType: formatEventTypeForDisplay(reg.entry_event_type_label, ev?.race_type),
      eventTitle: String(ev?.title ?? 'Current event'),
    })
  }
  rows.sort((a, b) => a.riderName.localeCompare(b.riderName, undefined, { sensitivity: 'base' }))
  return rows
}

/** QR scan: bib extracted from payload, then bib-only lookup (no free-text name search). */
async function resolveRegistrationForKitClaim(rawInput: string): Promise<KitLookupOk | KitLookupFail> {
  const trimmed = rawInput.trim()
  if (!trimmed) return { error: 'not_found', message: 'Enter a bib number or rider name.' }
  return resolveBibOnlyForKitClaim(trimmed)
}

export function AdminQrCheckIn() {
  const { data, loading, error } = useModuleLoader(() => adminModulesApi.qrDashboard(), [])

  /** Keeps history in sync without refetching the whole module (avoids loading shell unmounting the camera). */
  const [scanHistoryRows, setScanHistoryRows] = useState<Array<Record<string, unknown>>>([])

  useEffect(() => {
    if (data?.scans) {
      setScanHistoryRows(data.scans as Array<Record<string, unknown>>)
    }
  }, [data?.scans])

  const [entryLabelByRegistrationId, setEntryLabelByRegistrationId] = useState<Record<string, string>>({})

  useEffect(() => {
    const scans = scanHistoryRows
    const ids = Array.from(
      new Set(scans.map((s) => String((s as { registration_id?: string }).registration_id ?? '')).filter(Boolean)),
    )
    if (ids.length === 0) {
      setEntryLabelByRegistrationId({})
      return
    }
    let cancelled = false
    void supabase
      .from('registration_forms')
      .select('id, entry_event_type_label')
      .in('id', ids)
      .then(({ data: rows }) => {
        if (cancelled || !rows) return
        const next: Record<string, string> = {}
        for (const row of rows as Array<{ id: string; entry_event_type_label?: string | null }>) {
          const lab = String(row.entry_event_type_label ?? '').trim()
          if (lab) next[String(row.id)] = lab
        }
        setEntryLabelByRegistrationId(next)
      })
    return () => {
      cancelled = true
    }
  }, [scanHistoryRows])

  useEffect(() => {
    const channel = supabase
      .channel('admin-qr-checkins')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'qr_checkins' },
        async (payload) => {
          const raw = payload.new as Record<string, unknown> | null
          if (!raw?.id) return
          try {
            const enriched = await enrichQrCheckinScanRow(raw)
            if (!enriched) return
            setScanHistoryRows((prev) => {
              const id = String(enriched.id ?? '')
              const withoutDup = prev.filter((r) => String(r.id) !== id)
              const next = [enriched, ...withoutDup].sort(
                (a, b) =>
                  new Date(String(b.scanned_at ?? 0)).getTime() - new Date(String(a.scanned_at ?? 0)).getTime(),
              )
              return next.slice(0, 15)
            })
          } catch (e) {
            console.error('[admin-qr-checkins] realtime enrich failed', e)
          }
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const controlsRef = useRef<ScannerControls | null>(null)
  const scanLockRef = useRef(false)
  const lastScanRef = useRef<string>('')
  const [processing, setProcessing] = useState(false)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [claimDialogOpen, setClaimDialogOpen] = useState(false)
  const [claimingKit, setClaimingKit] = useState(false)
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false)
  const [historySearch, setHistorySearch] = useState('')
  const [manualLookup, setManualLookup] = useState('')
  const [manualLookupLoading, setManualLookupLoading] = useState(false)
  const [manualMatchRows, setManualMatchRows] = useState<ManualMatchRow[] | null>(null)
  const [claimSelectionLoadingId, setClaimSelectionLoadingId] = useState<string | null>(null)

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    readerRef.current = null
    setTorchOn(false)
  }, [])

  const applyResolvedKitLookup = useCallback((resolved: KitLookupOk, source: 'qr' | 'manual') => {
    const riderName = [resolved.rider.first_name, resolved.rider.last_name].filter(Boolean).join(' ').trim() || 'Registered rider'
    const bibNumber = resolved.lookupCode
    const eventType = formatEventTypeForDisplay(
      resolved.registration.entry_event_type_label,
      resolved.event?.race_type,
    )
    const shared = {
      riderName,
      category: resolved.rider.age_category ?? 'Uncategorized',
      discipline: resolved.rider.discipline ?? '—',
      eventType,
      bibNumber,
      eventTitle: resolved.event?.title ?? 'Current event',
      eventId: resolved.registration.event_id ? String(resolved.registration.event_id) : undefined,
      registrationId: resolved.registration.id,
      scannedAt: new Date().toISOString(),
      claimSource: source,
    }
    if (resolved.duplicateClaim?.id) {
      setScanResult({
        status: 'duplicate',
        message: DUPLICATE_SCAN_SUMMARY,
        code: resolved.lookupCode,
        ...shared,
      })
      setDuplicateDialogOpen(true)
      setClaimDialogOpen(false)
      return
    }
    setScanResult({
      status: 'valid',
      message: 'Ready to claim race kit.',
      code: resolved.lookupCode,
      ...shared,
    })
    setClaimDialogOpen(true)
  }, [])

  const processCode = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim()
      const lookupCode = extractBibFromCode(code)
      if (!code || scanLockRef.current || code === lastScanRef.current) return
      scanLockRef.current = true
      lastScanRef.current = code
      setProcessing(true)
      try {
        const resolved = await resolveRegistrationForKitClaim(lookupCode)
        if ('error' in resolved) {
          const invalidMessage =
            resolved.error === 'not_found' ? 'No rider matched this QR code.' : resolved.message
          setScanResult({
            status: 'invalid',
            message: invalidMessage,
            code,
            scannedAt: new Date().toISOString(),
          })
          setClaimDialogOpen(false)
          toast.error(invalidMessage)
          return
        }
        applyResolvedKitLookup(resolved, 'qr')
      } catch (scanError) {
        toast.error((scanError as Error).message || 'Failed to process QR scan.')
      } finally {
        window.setTimeout(() => {
          scanLockRef.current = false
          lastScanRef.current = ''
        }, 1200)
        setProcessing(false)
      }
    },
    [applyResolvedKitLookup],
  )

  const openClaimForManualRow = useCallback(
    async (registrationId: string) => {
      setClaimSelectionLoadingId(registrationId)
      try {
        const fin = await finalizeKitLookupFromRegistrationId(registrationId)
        if ('error' in fin) {
          toast.error(fin.message)
          return
        }
        setManualMatchRows(null)
        applyResolvedKitLookup(fin, 'manual')
      } catch (e) {
        toast.error((e as Error).message || 'Lookup failed.')
      } finally {
        setClaimSelectionLoadingId(null)
      }
    },
    [applyResolvedKitLookup],
  )

  const processManualLookup = useCallback(async () => {
    const q = manualLookup.trim()
    if (!q) {
      toast.error('Enter a bib number or rider name.')
      return
    }
    if (scanLockRef.current) return
    scanLockRef.current = true
    setManualLookupLoading(true)
    setManualMatchRows(null)
    try {
      const bibResolved = await resolveBibOnlyForKitClaim(q)
      if (!('error' in bibResolved)) {
        applyResolvedKitLookup(bibResolved, 'manual')
        return
      }
      if (bibResolved.error === 'ambiguous') {
        toast.error(bibResolved.message)
        setClaimDialogOpen(false)
        setDuplicateDialogOpen(false)
        return
      }

      const nameRows = await findManualNameMatchRows(q)
      if (nameRows.length === 0) {
        toast.error(
          bibResolved.error === 'not_found'
            ? 'No rider matched that name or bib number.'
            : bibResolved.message,
        )
        setClaimDialogOpen(false)
        setDuplicateDialogOpen(false)
        return
      }
      if (nameRows.length === 1) {
        const fin = await finalizeKitLookupFromRegistrationId(nameRows[0].registrationId)
        if ('error' in fin) {
          toast.error(fin.message)
          return
        }
        applyResolvedKitLookup(fin, 'manual')
        return
      }
      setManualMatchRows(nameRows)
    } catch (e) {
      toast.error((e as Error).message || 'Lookup failed.')
    } finally {
      window.setTimeout(() => {
        scanLockRef.current = false
      }, 600)
      setManualLookupLoading(false)
    }
  }, [manualLookup, applyResolvedKitLookup])

  const startCamera = useCallback(async () => {
    try {
      stopCamera()
      const videoElement = videoRef.current
      if (!videoElement) return

      // Always trigger camera permission prompt first.
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode } },
        audio: false,
      })
      permissionStream.getTracks().forEach((track) => track.stop())

      const hints = new Map()
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE])
      const reader = new BrowserMultiFormatReader(hints)
      readerRef.current = reader
      setCameraError(null)

      let controls: ScannerControls | null = null
      try {
        controls = (await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: facingMode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          },
          videoElement,
          (result, decodeError) => {
            if (result) void processCode(result.getText())
            if (decodeError && !(decodeError instanceof NotFoundException)) {
              console.error(decodeError)
            }
          },
        )) as ScannerControls
      } catch {
        // Fallback to any available camera when preferred facing mode fails.
        controls = (await reader.decodeFromConstraints(
          {
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          },
          videoElement,
          (result, decodeError) => {
            if (result) void processCode(result.getText())
            if (decodeError && !(decodeError instanceof NotFoundException)) {
              console.error(decodeError)
            }
          },
        )) as ScannerControls
      }

      const finalControls = controls ?? ((await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        videoElement,
        (result, decodeError) => {
          if (result) void processCode(result.getText())
          if (decodeError && !(decodeError instanceof NotFoundException)) {
            console.error(decodeError)
          }
        },
      )) as ScannerControls)

      controlsRef.current = finalControls
    } catch (scannerError) {
      const message = (scannerError as Error).message || 'Unable to open camera.'
      setCameraError(message)
      toast.error(message)
      stopCamera()
    }
  }, [facingMode, processCode, stopCamera])

  const toggleTorch = useCallback(async () => {
    try {
      if (!controlsRef.current?.switchTorch) {
        toast.error('Flash control is not available on this camera.')
        return
      }
      const next = !torchOn
      await controlsRef.current.switchTorch(next)
      setTorchOn(next)
    } catch (error) {
      toast.error((error as Error).message || 'Failed to toggle flash.')
    }
  }, [torchOn])

  useEffect(() => {
    void startCamera()
    return () => stopCamera()
  }, [startCamera, stopCamera])

  useEffect(() => {
    const ensureCameraRunning = () => {
      if (!controlsRef.current) {
        void startCamera()
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') ensureCameraRunning()
    }

    window.addEventListener('focus', ensureCameraRunning)
    window.addEventListener('pageshow', ensureCameraRunning)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('focus', ensureCameraRunning)
      window.removeEventListener('pageshow', ensureCameraRunning)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [startCamera])

  const tableEventTypeDisplay = useCallback(
    (row: Record<string, unknown>) => {
      const rid = String(row.registration_id ?? '')
      const rawEventType = String(row.event_type ?? '')
      return formatEventTypeForDisplay(entryLabelByRegistrationId[rid] ?? null, rawEventType || null)
    },
    [entryLabelByRegistrationId],
  )

  const bibHistoryRows = useMemo(
    () =>
      scanHistoryRows.filter((row) => String((row as { bib_number?: unknown }).bib_number ?? '').trim().length > 0),
    [scanHistoryRows],
  )

  const filteredHistoryRows = useMemo(() => {
    const query = historySearch.trim().toLowerCase()
    if (!query) return bibHistoryRows
    return bibHistoryRows.filter((row) => {
      const r = row as Record<string, unknown>
      const haystack = [
        String(r.scanned_code ?? ''),
        String(r.bib_number ?? ''),
        String(r.rider_name ?? ''),
        String(r.discipline ?? ''),
        String(r.category ?? ''),
        String(r.event_type ?? ''),
        tableEventTypeDisplay(r),
        String(r.scan_status ?? ''),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [bibHistoryRows, historySearch, tableEventTypeDisplay])

  const handleClaimKit = useCallback(async () => {
    if (!scanResult || scanResult.status !== 'valid' || !scanResult.registrationId || !scanResult.eventId) return
    setClaimingKit(true)
    try {
      const { data: authData } = await supabase.auth.getSession()
      const scannedBy = authData.session?.user?.id ?? null
      const now = new Date().toISOString()

      const { data: raceBib, error: raceBibLookupError } = await supabase
        .from('race_bibs')
        .select('id')
        .eq('registration_id', scanResult.registrationId)
        .limit(1)
        .maybeSingle()
      if (raceBibLookupError) throw raceBibLookupError

      const deviceLabel =
        scanResult.claimSource === 'manual'
          ? 'Manual lookup'
          : navigator.userAgent.includes('Mobile')
            ? 'Mobile Scanner'
            : 'Web Scanner'
      const claimNotes = scanResult.claimSource === 'manual' ? 'Claimed via manual lookup' : 'Claimed via QR scanner'

      const { error: insertError } = await supabase.from('qr_checkins').insert({
        event_id: scanResult.eventId,
        registration_id: scanResult.registrationId,
        race_bib_id: raceBib?.id ?? null,
        scanned_code: scanResult.code,
        scan_status: 'valid',
        scanned_at: now,
        scanned_by: scannedBy,
        device_label: deviceLabel,
      })
      if (insertError) throw insertError

      if (raceBib?.id) {
        const { error: raceBibUpdateError } = await supabase
          .from('race_bibs')
          .update({
            status: 'claimed',
            claimed_at: now,
            claimed_by: scannedBy,
            notes: claimNotes,
          })
          .eq('id', raceBib.id)
        if (raceBibUpdateError) throw raceBibUpdateError
      }

      const { error: registrationUpdateError } = await supabase
        .from('registration_forms')
        .update({
          checked_in_at: now,
          checked_in_by: scannedBy,
        })
        .eq('id', scanResult.registrationId)
      if (registrationUpdateError) throw registrationUpdateError

      toast.success('Race kit successfully claimed.')
      setClaimDialogOpen(false)
      setScanResult(null)
    } catch (claimError) {
      toast.error((claimError as Error).message || 'Failed to claim race kit.')
    } finally {
      setClaimingKit(false)
    }
  }, [scanResult])

  return (
    <ModuleShell loading={loading} error={error}>
      {claimDialogOpen && scanResult?.status === 'valid' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white shadow-2xl">
            <div className="rounded-t-2xl border-b border-emerald-200 bg-emerald-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Valid rider</p>
              <p className="text-sm text-emerald-900">Ready to claim race kit.</p>
            </div>
            <div className="px-5 py-4">
              <RiderKitDetailRows result={scanResult} />
            </div>
            <div className="flex gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => void handleClaimKit()}
                disabled={claimingKit}
                className="inline-flex flex-1 items-center justify-center rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {claimingKit ? 'Claiming...' : 'Claim Kit'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setClaimDialogOpen(false)
                  setScanResult(null)
                }}
                disabled={claimingKit}
                className="inline-flex flex-1 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {duplicateDialogOpen && scanResult?.status === 'duplicate' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white shadow-2xl">
            <div className="rounded-t-2xl border-b border-amber-200 bg-amber-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Kit already claimed</p>
              <p className="mt-1 text-sm font-medium text-amber-950">Duplicate scan — do not issue another kit</p>
              <p className="mt-2 text-sm leading-relaxed text-amber-900/95">{scanResult.message}</p>
            </div>
            <div className="px-5 py-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">Registration on file</p>
              <RiderKitDetailRows result={scanResult} />
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-5 py-3">
              <p className="text-xs leading-relaxed text-slate-600">
                If the rider insists they have not claimed a kit, confirm the bib matches their registration, then contact
                the head of registration or race director before overriding this status.
              </p>
            </div>
            <div className="flex justify-end border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => {
                  setDuplicateDialogOpen(false)
                  setScanResult(null)
                }}
                className="inline-flex items-center justify-center rounded-md bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-700"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SectionCard title="QR Scanner" subtitle="Point the camera at the rider QR code to validate check-in.">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-lg">
            <div className="flex items-center justify-between px-3 py-3 text-xs text-slate-200">
              <button
                type="button"
                onClick={() => void toggleTorch()}
                aria-label={torchOn ? 'Turn flash off' : 'Turn flash on'}
                title={torchOn ? 'Flash Off' : 'Flash On'}
                className="rounded-full bg-slate-800 p-2 text-slate-100 hover:bg-slate-700"
              >
                <Zap className={`h-4 w-4 ${torchOn ? 'text-amber-300' : 'text-slate-200'}`} />
              </button>
              <p className="text-center text-sm font-medium text-slate-100">Scan rider QR to claim race kit</p>
              <div className="h-8 w-8" />
              <button
                type="button"
                onClick={() => setFacingMode((mode) => (mode === 'environment' ? 'user' : 'environment'))}
                aria-label="Switch camera"
                title="Switch Camera"
                className="rounded-full bg-slate-800 p-2 text-slate-100 hover:bg-slate-700"
              >
                <RefreshCw className="h-4 w-4 text-slate-200" />
              </button>
            </div>

            <div className="relative h-[380px] w-full bg-slate-900 md:h-[460px]">
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-10 top-10 h-10 w-10 border-l-4 border-t-4 border-white/95" />
                <div className="absolute right-10 top-10 h-10 w-10 border-r-4 border-t-4 border-white/95" />
                <div className="absolute bottom-10 left-10 h-10 w-10 border-b-4 border-l-4 border-white/95" />
                <div className="absolute bottom-10 right-10 h-10 w-10 border-b-4 border-r-4 border-white/95" />
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/80 px-4 py-2 text-xs text-slate-200">
                  Align QR code within the frame to scan
                </div>
              </div>

              {cameraError ? (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 px-5 text-center text-sm text-rose-200">
                  {cameraError}
                </div>
              ) : null}
              {processing ? (
                <div className="absolute right-4 top-4 rounded-full bg-emerald-500/90 px-3 py-1 text-xs font-medium text-white">
                  Processing...
                </div>
              ) : null}
            </div>
          </div>

          <p className="text-center text-sm text-slate-500">Ensure proper lighting and hold QR code steady for best results.</p>
        </div>
      </SectionCard>

      <SectionCard
        title="Manual rider lookup"
        subtitle="No QR? Search by bib number or rider name, then select the correct rider to claim."
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-medium text-slate-600">Bib number or rider name</span>
            <input
              type="text"
              value={manualLookup}
              onChange={(e) => setManualLookup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void processManualLookup()
              }}
              placeholder="e.g. 1234 or Juan dela Cruz"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#cfae3f]"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            onClick={() => void processManualLookup()}
            disabled={manualLookupLoading}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            <Search className="h-4 w-4" aria-hidden />
            {manualLookupLoading ? 'Looking up…' : 'Look up'}
          </button>
        </div>

        {manualMatchRows && manualMatchRows.length > 0 ? (
          <div className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <p className="border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
              <span className="font-semibold text-slate-900">{manualMatchRows.length} riders</span> matched. Use{' '}
             <span className="font-semibold">Claim</span> on the correct rider to open the confirmation window.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Rider</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Bib</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Category</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Discipline</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Event type</th>
                    <th className="px-3 py-2 text-left font-semibold text-slate-600">Event</th>
                    <th className="px-3 py-2 text-right font-semibold text-slate-600">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {manualMatchRows.map((row) => (
                    <tr key={row.registrationId}>
                      <td className="px-3 py-2.5 font-medium text-slate-900">{row.riderName}</td>
                      <td className="px-3 py-2.5 font-mono text-slate-800">{row.bibNumber}</td>
                      <td className="px-3 py-2.5 text-slate-700">{row.category}</td>
                      <td className="px-3 py-2.5 text-slate-700">{row.discipline}</td>
                      <td className="px-3 py-2.5 text-slate-700">{row.eventType}</td>
                      <td className="max-w-[200px] px-3 py-2.5 text-slate-700">{row.eventTitle}</td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => void openClaimForManualRow(row.registrationId)}
                          disabled={claimSelectionLoadingId !== null}
                          className="inline-flex rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {claimSelectionLoadingId === row.registrationId ? 'Opening…' : 'Claim'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Race kit claims"
        subtitle="Shows recent rider check-ins with assigned bib numbers, including QR scans and manual searches."
      >
        <div className="mb-3">
          <input
            type="text"
            value={historySearch}
            onChange={(event) => setHistorySearch(event.target.value)}
            placeholder="Search bib, rider, discipline, category, event type, status…"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#cfae3f]"
          />
        </div>
        {filteredHistoryRows.length === 0 ? (
          <p className="text-sm text-slate-500">No kit claims with an assigned bib yet.</p>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2 sm:mx-0 sm:px-0">
            <table className="min-w-[960px] w-full divide-y divide-slate-200 text-xs sm:text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold text-slate-600 sm:px-3">Scanned code</th>
                  <th className="px-2 py-2 text-left font-semibold text-slate-600 sm:px-3">Bib</th>
                  <th className="px-2 py-2 text-left font-semibold text-slate-600 sm:px-3">Rider</th>
                  <th className="px-2 py-2 text-left font-semibold text-slate-600 sm:px-3">Discipline</th>
                  <th className="px-2 py-2 text-left font-semibold text-slate-600 sm:px-3">Category</th>
                  <th className="px-2 py-2 text-left font-semibold text-slate-600 sm:px-3">Event Type</th>
                  <th className="px-2 py-2 text-left font-semibold text-slate-600 sm:px-3">Status</th>
                  <th className="px-2 py-2 text-left font-semibold text-slate-600 sm:px-3">Scanned At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredHistoryRows.map((row, index) => (
                  <tr key={String(row.id ?? index)}>
                    <td className="px-2 py-2 text-slate-700 sm:px-3">{String(row.scanned_code ?? '—')}</td>
                    <td className="px-2 py-2 font-mono text-slate-800 sm:px-3">
                      {String((row as { bib_number?: unknown }).bib_number ?? '—')}
                    </td>
                    <td className="px-2 py-2 text-slate-700 sm:px-3">{String(row.rider_name ?? 'Registered rider')}</td>
                    <td className="px-2 py-2 text-slate-700 sm:px-3">{String(row.discipline ?? '—')}</td>
                    <td className="px-2 py-2 text-slate-700 sm:px-3">{String(row.category ?? '—')}</td>
                    <td className="px-2 py-2 text-slate-700 sm:px-3">
                      {tableEventTypeDisplay(row as Record<string, unknown>)}
                    </td>
                    <td className="px-2 py-2 sm:px-3">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(row.scan_status)}`}>
                        {formatScanStatusLabel(row.scan_status)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-700 sm:px-3">{formatDateTime(row.scanned_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </ModuleShell>
  )
}
