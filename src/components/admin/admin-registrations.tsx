import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import { adminApi, type AdminRegistrationRow } from '../../services/adminApi'
import { supabase } from '../../lib/supabase'
import { AlertTriangle, CalendarDays, Check, CheckCircle2, ClipboardList, Copy, Loader2, Mail, MoreVertical, NotebookPen, Pencil, Printer, Search, Trash2, Users, X } from 'lucide-react'
import { ImportParticipantsModal } from './admin-participant-modal'
import { AdminRegistrationEditModal } from './admin-registration-edit-modal'
import { generateAndUploadAdminCertificate } from '../../utils/adminCertificate'

function formatEventTypeSlugLabel(slug: string | null | undefined) {
  const raw = String(slug ?? '').trim()
  if (!raw) return '—'
  return raw
    .split(/[,_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function pill(status: string) {
  const s = status.toLowerCase()
  if (s === 'paid') return 'bg-emerald-50 text-emerald-700'
  if (s === 'pending') return 'bg-amber-50 text-amber-700'
  if (s === 'failed') return 'bg-rose-50 text-rose-700'
  if (s === 'refunded') return 'bg-slate-100 text-slate-700'
  return 'bg-slate-100 text-slate-700'
}


/** Matches server rules for manual delete / stale purge (unpaid checkout only). */
function isUnpaidDraftRegistrationRow(r: AdminRegistrationRow): boolean {
  const pay = String(r.payment_status ?? '').toLowerCase()
  const regSt = String(r.status ?? '').toLowerCase()
  if (pay === 'paid') return false
  if (pay === 'pending') return true
  if (pay === 'unknown' && ['pending_payment', 'payment_processing'].includes(regSt)) return true
  return false
}

const PENDING_CHECKOUT_MANUAL_DELETE_MAX_AGE_MS = 2 * 60 * 60 * 1000

function canManualDeletePendingEntry(r: AdminRegistrationRow): boolean {
  if (!isUnpaidDraftRegistrationRow(r)) return false
  const created = r.created_at ? new Date(r.created_at).getTime() : NaN
  if (!Number.isFinite(created)) return false
  return Date.now() - created <= PENDING_CHECKOUT_MANUAL_DELETE_MAX_AGE_MS
}

/** True payment gateway id for Reference column — PayMongo ids only; hides synthetic / internal values. */
function isPaymongoPaymentReferenceId(raw: string) {
  const v = normalizePaymentReferenceDisplay(raw)
  return v.startsWith('pay_')
}

/** Strip accidental event-type suffixes from stored refs (legacy import appended `-criterium` / `-individual-time-trial`). */
function normalizePaymentReferenceDisplay(raw: string): string {
  let v = String(raw ?? '').trim()
  if (!v) return ''
  v = v.replace(/-individual-time-trial$/i, '')
  v = v.replace(/-criterium$/i, '')
  v = v.replace(/-individual-?$/i, '')
  v = v.replace(/-individual$/i, '')
  return v.trim()
}

function extractTallySubmissionFromMerchantReference(raw: string): string {
  const mr = String(raw ?? '').trim()
  const m = mr.match(/^tally-import-(.+)-(criterium|individual-time-trial)$/i)
  return m ? String(m[1]) : ''
}

/** True if the event target is a control — do not start row drag-to-scroll from these. */
function isTableDragScrollInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el?.closest) return false
  return Boolean(
    el.closest(
      'button, a, input, select, textarea, label, [role="button"], [role="menuitem"], [contenteditable="true"]',
    ),
  )
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="py-3 pl-4 pr-3">
        <div className="h-3 w-32 rounded bg-slate-200 mb-1.5" />
        <div className="h-2.5 w-44 rounded bg-slate-100" />
      </td>
      <td className="py-3 pr-3"><div className="h-3 w-36 rounded bg-slate-200" /></td>
      <td className="py-3 pr-3"><div className="h-3 w-20 rounded bg-slate-200" /></td>
      <td className="py-3 pr-3"><div className="h-3 w-20 rounded bg-slate-200" /></td>
      <td className="py-3 pr-3"><div className="h-3 w-24 rounded bg-slate-200" /></td>
      <td className="py-3 pr-3"><div className="h-5 w-16 rounded-full bg-slate-200" /></td>
      <td className="py-3 pr-3"><div className="h-3 w-24 rounded bg-slate-200" /></td>
      <td className="py-3 pr-3"><div className="h-3 w-10 rounded bg-slate-200" /></td>
      <td className="py-3 pr-4 text-right"><div className="ml-auto h-6 w-12 rounded-md bg-slate-200" /></td>
    </tr>
  )
}

type BibLedgerRow = {
  id: string
  race_category_id: string | null
  entry_event_type_slug: string | null
  bib_class_code: number | string | null
  created_at: string | null
}

type LedgerCategoryRow = {
  id: string
  discipline: string | null
  category_name: string | null
}

type EventTypeRow = {
  slug: string
  name: string
}

export function AdminRegistrations() {
  const PAGE_SIZE = 50
  const [rows, setRows] = useState<AdminRegistrationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printLoading, setPrintLoading] = useState(false)
  const [q, setQ] = useState('')
  const [disciplineFilter, setDisciplineFilter] = useState('all')
  const [entryEventTypeFilter, setEntryEventTypeFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sortBy, setSortBy] = useState<'created_desc' | 'created_asc' | 'cyclist_asc' | 'cyclist_desc'>('created_desc')
  const [page, setPage] = useState(1)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [ledgerEventId, setLedgerEventId] = useState('')
  const [ledgerDiscipline, setLedgerDiscipline] = useState('all')
  const [ledgerCategoryId, setLedgerCategoryId] = useState('all')
  const [ledgerCategories, setLedgerCategories] = useState<LedgerCategoryRow[]>([])
  const [ledgerEventTypes, setLedgerEventTypes] = useState<EventTypeRow[]>([])
  const [ledgerRows, setLedgerRows] = useState<BibLedgerRow[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError, setLedgerError] = useState('')
  const [rowActionLoading, setRowActionLoading] = useState<Record<string, 'autobib' | 'email' | 'delete' | null>>({})
  /** Fixed-position row menu (portal) so it is not clipped by the table scroll container. */
  const [rowMenuPortal, setRowMenuPortal] = useState<{ id: string; top: number; right: number } | null>(null)
  const [pendingDeleteRow, setPendingDeleteRow] = useState<AdminRegistrationRow | null>(null)
  const tableScrollRef = useRef<HTMLDivElement>(null)
  /** Mouse drag on table body/headers to scroll horizontally (scrollbar hidden). Touch uses native pan. */
  const tableDragScroll = useRef({ active: false, startX: 0, startScrollLeft: 0, pointerId: -1 })
  const [editingRegistrationId, setEditingRegistrationId] = useState<string | null>(null)
  type AdminActionBanner = { text: string; tone: 'info' | 'success' | 'warning' | 'error' }
  const [actionBanner, setActionBanner] = useState<AdminActionBanner | null>(null)

  useEffect(() => {
    if (!actionBanner) return
    const t = window.setTimeout(() => setActionBanner(null), 3000)
    return () => window.clearTimeout(t)
  }, [actionBanner])

  const portalMenuRow = useMemo(
    () => (rowMenuPortal ? rows.find((x) => x.id === rowMenuPortal.id) ?? null : null),
    [rowMenuPortal, rows],
  )

  useEffect(() => {
    if (!rowMenuPortal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRowMenuPortal(null)
    }
    const onWinScroll = () => setRowMenuPortal(null)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onWinScroll, true)
    const tableEl = tableScrollRef.current
    const onTableScroll = () => setRowMenuPortal(null)
    tableEl?.addEventListener('scroll', onTableScroll, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onWinScroll, true)
      tableEl?.removeEventListener('scroll', onTableScroll, true)
    }
  }, [rowMenuPortal])

  useEffect(() => {
    if (!rowMenuPortal) return
    if (rows.some((x) => x.id === rowMenuPortal.id)) return
    const id = requestAnimationFrame(() => {
      setRowMenuPortal(null)
    })
    return () => cancelAnimationFrame(id)
  }, [rows, rowMenuPortal])

  useEffect(() => {
    if (!pendingDeleteRow) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingDeleteRow(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingDeleteRow])

  function fetchData() {
    return adminApi
      .adminPurgeStalePendingRegistrations()
      .catch(() => undefined)
      .then(() =>
        adminApi
          .registrationsList()
          .then((data) => {
            setRows(data)
            setError('')
          })
          .catch((e) => {
            setError((e as Error).message || 'Failed to load registrations.')
          }),
      )
      .finally(() => {
        setLoading(false)
      })
  }

  async function handlePrintRaceBibs() {
    if (printLoading) return
    setPrintLoading(true)
    setActionBanner(null)
    try {
      const printableRows = filtered
        .map((row) => {
          const riderName = String(row.rider_full_name ?? '').trim()
          const bibNumber = String(row.bib_number ?? '').trim()
          const jerseySize = String(row.jersey_size ?? '').trim()
          const eventType = String(row.entry_event_type_label ?? formatEventTypeSlugLabel(row.entry_event_type_slug)).trim()
          const discipline = String(row.discipline ?? '').trim()
          const category = String(row.age_category ?? '').trim()
          return { riderName, bibNumber, jerseySize, eventType, discipline, category }
        })
        .filter((row) => row.riderName && row.bibNumber)

      if (printableRows.length === 0) {
        setActionBanner({
          text: 'No printable rows. Make sure riders already have bib numbers assigned.',
          tone: 'warning',
        })
        return
      }

      const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
      doc.setFont('times', 'normal')

      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const margin = 40
      const tableWidth = pageWidth - margin * 2
      const colWidths = [
        tableWidth * 0.1,
        tableWidth * 0.48,
        tableWidth * 0.2,
        tableWidth * 0.22,
      ]
      const headers = ['No.', 'Rider Name', 'Jersey Size', 'Bib Number']
      const rowHeight = 24
      const headerHeight = 28
      const tableTopStart = 110
      const groupLabelGap = 6

      const toBibSortKey = (bib: string) => {
        const normalized = String(bib ?? '').trim()
        const match = normalized.match(/\d+/)
        const numeric = match ? Number.parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER
        return { numeric, normalized: normalized.toLowerCase() }
      }

      const sortedRows = [...printableRows].sort((a, b) => {
        if (a.eventType !== b.eventType) return a.eventType.localeCompare(b.eventType)
        if (a.discipline !== b.discipline) return a.discipline.localeCompare(b.discipline)
        if (a.category !== b.category) return a.category.localeCompare(b.category)
        const ak = toBibSortKey(a.bibNumber)
        const bk = toBibSortKey(b.bibNumber)
        if (ak.numeric !== bk.numeric) return ak.numeric - bk.numeric
        return ak.normalized.localeCompare(bk.normalized)
      })

    const groupMap = new Map<string, typeof sortedRows>()
    for (const row of sortedRows) {
      const groupKey = `${row.eventType}||${row.discipline}||${row.category}`
      const group = groupMap.get(groupKey) ?? []
      group.push(row)
      groupMap.set(groupKey, group)
    }
    const groupedRows = Array.from(groupMap.entries())
      .map(([groupKey, rows]) => {
        const [eventType, discipline, category] = groupKey.split('||')
        return { eventType, discipline, category, rows }
      })
      .sort((a, b) => {
        if (a.eventType !== b.eventType) return a.eventType.localeCompare(b.eventType)
        if (a.discipline !== b.discipline) return a.discipline.localeCompare(b.discipline)
        return a.category.localeCompare(b.category)
      })

    const loadLogoDataUrl = async (path: string): Promise<string | null> => {
      try {
        const response = await fetch(path)
        if (!response.ok) return null
        const blob = await response.blob()
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => {
            const result = reader.result
            if (typeof result === 'string') resolve(result)
            else reject(new Error('Failed to decode logo image.'))
          }
          reader.onerror = () => reject(new Error('Failed to read logo image.'))
          reader.readAsDataURL(blob)
        })
      } catch {
        return null
      }
    }

    const [hnaLogoDataUrl, allOutLogoDataUrl] = await Promise.all([
      loadLogoDataUrl('/hna-logo.png'),
      loadLogoDataUrl('/all_out_multisports_1.png'),
    ])

    const drawCell = (text: string, x: number, y: number, width: number, height: number, fontStyle: 'normal' | 'bold') => {
      doc.rect(x, y, width, height)
      doc.setFont('times', fontStyle)
      doc.setFontSize(11)
      doc.text(text || '—', x + width / 2, y + height / 2 + 4, { align: 'center' })
    }

    const rowsPerPage = Math.max(1, Math.floor((pageHeight - margin - tableTopStart) / rowHeight))
    let y = tableTopStart
    let overallPage = 1

    const drawPageHeader = (groupLabel: string, groupPage: number, groupTotalPages: number) => {
      const logoY = 20
      const allOutW = 92
      const allOutH = 26
      const hnaW = 26
      const hnaH = 26
      const logoGap = 10
      const logoBottomMargin = 10
      const logoBlockWidth =
        (allOutLogoDataUrl ? allOutW : 0) +
        (allOutLogoDataUrl && hnaLogoDataUrl ? logoGap : 0) +
        (hnaLogoDataUrl ? hnaW : 0)
      let logoX = (pageWidth - logoBlockWidth) / 2

      if (allOutLogoDataUrl) {
        doc.addImage(allOutLogoDataUrl, 'PNG', logoX, logoY, allOutW, allOutH)
        logoX += allOutW + (hnaLogoDataUrl ? logoGap : 0)
      }
      if (hnaLogoDataUrl) {
        doc.addImage(hnaLogoDataUrl, 'PNG', logoX, logoY, hnaW, hnaH)
      }
      const logoBottomY = logoY + Math.max(allOutH, hnaH) + logoBottomMargin
      doc.setFont('times', 'bold')
      doc.setFontSize(16)
      doc.text('Race Bib List', pageWidth / 2, logoBottomY + 16, { align: 'center' })
      doc.setFont('times', 'normal')
      doc.setFontSize(10)
      doc.text(`Page ${groupPage} of ${groupTotalPages} (Group)`, pageWidth - margin, logoBottomY + 30, { align: 'right' })
      doc.text(`Sheet ${overallPage}`, pageWidth - margin, logoBottomY + 42, { align: 'right' })
      doc.setFont('times', 'bold')
      doc.setFontSize(11)
      doc.text(groupLabel, margin, logoBottomY + 48, { align: 'left' })
    }

    const drawTableHeader = () => {
      y += groupLabelGap
      let x = margin
      for (let i = 0; i < headers.length; i++) {
        drawCell(headers[i], x, y, colWidths[i], headerHeight, 'bold')
        x += colWidths[i]
      }
      y += headerHeight
    }

    let isFirstPage = true
    for (const group of groupedRows) {
      const groupLabel = `Event Type: ${group.eventType || '—'}   |   Discipline: ${group.discipline || '—'}   |   Category: ${group.category || '—'}`
      const groupTotalPages = Math.max(1, Math.ceil(group.rows.length / rowsPerPage))

      let index = 0
      let groupPage = 1
      while (index < group.rows.length) {
        if (!isFirstPage) doc.addPage()
        isFirstPage = false
        y = tableTopStart
        drawPageHeader(groupLabel, groupPage, groupTotalPages)
        drawTableHeader()

        const chunk = group.rows.slice(index, index + rowsPerPage)
        for (let i = 0; i < chunk.length; i++) {
          const row = chunk[i]
          const rowNumber = `${index + i + 1}.`
          const values = [rowNumber, row.riderName, row.jerseySize, row.bibNumber]
          let x = margin
          for (let i = 0; i < values.length; i++) {
            drawCell(values[i], x, y, colWidths[i], rowHeight, 'normal')
            x += colWidths[i]
          }
          y += rowHeight
        }

        index += rowsPerPage
        groupPage += 1
        overallPage += 1
      }
    }

      doc.save(`HNA-Race-Bib-List-${new Date().toISOString().slice(0, 10)}.pdf`)
    } finally {
      setPrintLoading(false)
    }
  }

  useEffect(() => {
    void fetchData()

    const channel = supabase
      .channel('admin-registrations-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registration_forms' }, () => { void fetchData() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_orders' }, () => { void fetchData() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_transactions' }, () => { void fetchData() })
      .subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [])

  const disciplineOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) {
      const d = String(r.discipline ?? '').trim()
      if (d) set.add(d)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [rows])
  /** One option per distinct entry type (slug), not the combined `events.race_type` string. */
  const entryEventTypeOptions = useMemo(() => {
    const bySlug = new Map<string, string>()
    for (const r of rows) {
      const slug = String(r.entry_event_type_slug ?? '').trim().toLowerCase()
      if (!slug) continue
      if (bySlug.has(slug)) continue
      const label =
        String(r.entry_event_type_label ?? '').trim() || formatEventTypeSlugLabel(slug)
      bySlug.set(slug, label)
    }
    return Array.from(bySlug.entries())
      .map(([slug, label]) => ({ slug, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])
  const categoryOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => String(r.age_category ?? '').trim()).filter(Boolean))),
    [rows],
  )
  const sharedPayIdByTallySubmission = useMemo(() => {
    const out = new Map<string, string>()
    for (const r of rows) {
      const sid = extractTallySubmissionFromMerchantReference(String(r.merchant_reference ?? ''))
      if (!sid) continue
      const pref = normalizePaymentReferenceDisplay(String(r.provider_reference ?? ''))
      if (pref.startsWith('pay_')) out.set(sid, pref)
    }
    return out
  }, [rows])

  const getEffectiveProviderReference = (row: AdminRegistrationRow) => {
    const direct = normalizePaymentReferenceDisplay(String(row.provider_reference ?? ''))
    if (direct.startsWith('pay_')) return direct
    const sid = extractTallySubmissionFromMerchantReference(String(row.merchant_reference ?? ''))
    if (!sid) return direct
    return sharedPayIdByTallySubmission.get(sid) ?? direct
  }
  const ledgerEventOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const row of rows) {
      const id = String(row.event_id ?? '').trim()
      if (!id) continue
      if (!byId.has(id)) byId.set(id, String(row.event_title ?? row.race_type ?? id))
    }
    return Array.from(byId.entries()).map(([id, title]) => ({ id, title }))
  }, [rows])
  const ledgerDisciplineOptions = useMemo(
    () => Array.from(new Set(ledgerCategories.map((c) => String(c.discipline ?? '').trim()).filter(Boolean))),
    [ledgerCategories],
  )
  const ledgerCategoryOptions = useMemo(
    () => ledgerCategories.filter((c) => {
      if (ledgerDiscipline === 'all') return true
      return String(c.discipline ?? '') === ledgerDiscipline
    }),
    [ledgerCategories, ledgerDiscipline],
  )

  const filtered = (() => {
    const query = q.trim().toLowerCase()
    let result = rows.filter((r) => {
      const matchesSearch =
        r.id.toLowerCase().includes(query) ||
        String(r.rider_full_name ?? '').toLowerCase().includes(query) ||
        String(r.registrant_email ?? '').toLowerCase().includes(query) ||
          String(r.event_title ?? '').toLowerCase().includes(query) ||
        String(r.race_type ?? '').toLowerCase().includes(query) ||
        String(r.discipline ?? '').toLowerCase().includes(query) ||
        String(r.age_category ?? '').toLowerCase().includes(query) ||
        String(r.payment_status ?? '').toLowerCase().includes(query)
      const matchesDiscipline =
        disciplineFilter === 'all' || String(r.discipline ?? '').trim() === disciplineFilter
      const slugNorm = String(r.entry_event_type_slug ?? '').trim().toLowerCase()
      const matchesEntryEventType =
        entryEventTypeFilter === 'all' || slugNorm === entryEventTypeFilter
      const matchesPayment = paymentFilter === 'all' || String(r.payment_status ?? '') === paymentFilter
      const matchesCategory = categoryFilter === 'all' || String(r.age_category ?? '') === categoryFilter
      return (
        matchesSearch &&
        matchesDiscipline &&
        matchesEntryEventType &&
        matchesPayment &&
        matchesCategory
      )
    })

    result = [...result].sort((a, b) => {
      if (sortBy === 'created_asc' || sortBy === 'created_desc') {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0
        const db = b.created_at ? new Date(b.created_at).getTime() : 0
        return sortBy === 'created_asc' ? da - db : db - da
      }
      const na = String(a.rider_full_name ?? '').toLowerCase()
      const nb = String(b.rider_full_name ?? '').toLowerCase()
      return sortBy === 'cyclist_asc' ? na.localeCompare(nb) : nb.localeCompare(na)
    })

    return result
  })()

  const paidCount = filtered.filter((r) => String(r.payment_status ?? '').toLowerCase() === 'paid').length
  const pendingCount = filtered.filter((r) => String(r.payment_status ?? '').toLowerCase() !== 'paid').length

  const duplicateNonPaidKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of filtered) {
      if (String(r.payment_status ?? '').toLowerCase() === 'paid') continue
      const key = `${String(r.registrant_email ?? '').toLowerCase()}|${String(r.event_title ?? '')}|${String(r.race_category_id ?? r.age_category ?? '')}|${String(r.entry_event_type_label ?? '').toLowerCase()}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const dups = new Set<string>()
    for (const [key, n] of counts.entries()) {
      if (n > 1) dups.add(key)
    }
    return dups
  }, [filtered])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const startIndex = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE
  const paginated = filtered.slice(startIndex, startIndex + PAGE_SIZE)
  const showingFrom = filtered.length === 0 ? 0 : startIndex + 1
  const showingTo = filtered.length === 0 ? 0 : Math.min(startIndex + PAGE_SIZE, filtered.length)
  const pageNumbers = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
    if (currentPage <= 3) return [1, 2, 3, 4, 5]
    if (currentPage >= totalPages - 2) return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
    return [currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2]
  }, [currentPage, totalPages])

  /* eslint-disable react-hooks/set-state-in-effect -- keep page in sync when filters change or total pages shrink */
  useEffect(() => {
    setPage(1)
  }, [q, disciplineFilter, entryEventTypeFilter, paymentFilter, categoryFilter, sortBy])
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!ledgerOpen) return
    if (ledgerEventId) return
    const first = ledgerEventOptions[0]?.id ?? ''
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- default ledger event id when opening modal */
    if (first) setLedgerEventId(first)
  }, [ledgerOpen, ledgerEventId, ledgerEventOptions])

  useEffect(() => {
    if (!ledgerOpen || !ledgerEventId) return
    let active = true
    void (async () => {
      try {
        const { data, error: qErr } = await supabase
          .from('race_categories')
          .select('id, discipline, category_name')
          .eq('event_id', ledgerEventId)
          .order('discipline', { ascending: true })
          .order('category_name', { ascending: true })
        if (!active) return
        if (qErr) throw qErr
        setLedgerCategories((data ?? []) as LedgerCategoryRow[])
      } catch (e) {
        if (!active) return
        setLedgerError((e as Error).message || 'Failed to load event categories.')
        setLedgerCategories([])
      }
    })()
    return () => { active = false }
  }, [ledgerOpen, ledgerEventId])

  useEffect(() => {
    if (!ledgerEventId) return
    void supabase
      .from('event_types')
      .select('slug, name')
      .then(({ data }) => setLedgerEventTypes((data ?? []) as EventTypeRow[]))
  }, [ledgerEventId])

  /* eslint-disable react-hooks/set-state-in-effect -- legend panel loading/error flags before async fetch */
  useEffect(() => {
    if (!ledgerOpen || !ledgerEventId) return
    let active = true
    setLedgerLoading(true)
    setLedgerError('')
    void (async () => {
      try {
        let query = supabase
          .from('event_race_bib_classes')
          .select('id, race_category_id, entry_event_type_slug, bib_class_code, created_at')
          .eq('event_id', ledgerEventId)
          .order('entry_event_type_slug', { ascending: true })
          .order('bib_class_code', { ascending: true })

        if (ledgerCategoryId !== 'all') {
          query = query.eq('race_category_id', ledgerCategoryId)
        } else if (ledgerDiscipline !== 'all') {
          const ids = ledgerCategoryOptions.map((c) => c.id)
          if (ids.length === 0) {
            if (!active) return
            setLedgerRows([])
            setLedgerLoading(false)
            return
          }
          query = query.in('race_category_id', ids)
        }

        const { data, error: qErr } = await query
        if (!active) return
        if (qErr) throw qErr
        setLedgerRows((data ?? []) as BibLedgerRow[])
      } catch (e) {
        if (!active) return
        setLedgerError((e as Error).message || 'Failed to load category legend.')
        setLedgerRows([])
      } finally {
        if (active) setLedgerLoading(false)
      }
    })()
    return () => { active = false }
  }, [ledgerOpen, ledgerEventId, ledgerDiscipline, ledgerCategoryId, ledgerCategoryOptions])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSendQr(registrationId: string) {
    setRowActionLoading((prev) => ({ ...prev, [registrationId]: 'email' }))
    setActionBanner(null)
    try {
      const result = await adminApi.adminSendRaceKitEmail(registrationId)
      if (result?.error) throw new Error(result.error)
      setActionBanner({
        text: `QR code email sent for registration ${registrationId.slice(0, 8)}.`,
        tone: 'success',
      })
    } catch (e) {
      setActionBanner({ text: (e as Error).message || 'Failed to send QR code email.', tone: 'error' })
    } finally {
      setRowActionLoading((prev) => ({ ...prev, [registrationId]: null }))
    }
  }

  async function handleGenerateBibForRow(row: AdminRegistrationRow) {
    if (rowActionLoading[row.id]) return

    const hasBib = String(row.bib_number ?? '').trim().length > 0
    const payRefOk = isPaymongoPaymentReferenceId(getEffectiveProviderReference(row))
    if (hasBib) {
      setActionBanner({ text: 'This registration already has a bib number.', tone: 'info' })
      return
    }
    if (!payRefOk) {
      setActionBanner({
        text: 'Needs a PayMongo Reference No. (pay_...) on this row before a bib can be assigned.',
        tone: 'info',
      })
      return
    }

    const label = [row.rider_full_name, row.registrant_email].filter(Boolean).join(' · ') || row.id.slice(0, 8)
    setActionBanner(null)
    setRowActionLoading((prev) => ({ ...prev, [row.id]: 'autobib' }))
    try {
      const result = await adminApi.adminGenerateBib(row.id)
      if (result?.error) throw new Error(result.error)
      const nextBib = String(result?.bib_number ?? '').trim()
      if (!nextBib) throw new Error('Bib assignment returned empty bib number.')

      let certWarning = ''
      try {
        await generateAndUploadAdminCertificate(row.id)
      } catch (certErr) {
        certWarning = ` Certificate: ${(certErr as Error).message || 'file was not stored.'}`
      }

      let emailWarning = ''
      try {
        const sent = await adminApi.adminSendRaceKitEmail(row.id)
        if (sent?.error) throw new Error(sent.error)
      } catch (mailErr) {
        emailWarning = ` Email: ${(mailErr as Error).message || 'failed to send QR code email.'}`
      }

      setRows((prev) =>
        prev.map((item) =>
          item.id === row.id
            ? { ...item, bib_number: nextBib, provider_reference: result.provider_reference ?? item.provider_reference }
            : item,
        ),
      )
      setActionBanner({
        text: `Bib ${nextBib} assigned for ${label}.${certWarning}${emailWarning}`,
        tone: certWarning || emailWarning ? 'warning' : 'success',
      })
    } catch (e) {
      setActionBanner({
        text: `${label}: ${(e as Error).message || 'Failed to generate bib number.'}`,
        tone: 'error',
      })
    } finally {
      setRowActionLoading((prev) => ({ ...prev, [row.id]: null }))
    }
  }

  function openPendingDeleteModal(row: AdminRegistrationRow) {
    if (!canManualDeletePendingEntry(row)) return
    setRowMenuPortal(null)
    setPendingDeleteRow(row)
  }

  async function confirmPendingDelete(row: AdminRegistrationRow) {
    if (!row?.id) return
    const label = [row.rider_full_name, row.registrant_email].filter(Boolean).join(' · ') || row.id.slice(0, 8)
    setRowActionLoading((prev) => ({ ...prev, [row.id]: 'delete' }))
    setActionBanner(null)
    try {
      await adminApi.adminDeletePendingRegistration(row.id)
      setRows((prev) => prev.filter((item) => item.id !== row.id))
      setPendingDeleteRow(null)
      setActionBanner({ text: `Deleted pending registration for ${label}.`, tone: 'success' })
    } catch (e) {
      setActionBanner({ text: (e as Error).message || 'Delete failed.', tone: 'error' })
    } finally {
      setRowActionLoading((prev) => ({ ...prev, [row.id]: null }))
    }
  }

  const onTablePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return
    if (e.button !== 0) return
    const root = tableScrollRef.current
    if (!root || isTableDragScrollInteractiveTarget(e.target)) return
    if (root.scrollWidth <= root.clientWidth + 1) return
    const d = tableDragScroll.current
    d.active = true
    d.startX = e.clientX
    d.startScrollLeft = root.scrollLeft
    d.pointerId = e.pointerId
    root.setPointerCapture(e.pointerId)
    root.classList.add('cursor-grabbing', 'select-none')
  }, [])

  const onTablePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const root = tableScrollRef.current
    const d = tableDragScroll.current
    if (!root || !d.active || e.pointerId !== d.pointerId) return
    e.preventDefault()
    root.scrollLeft = d.startScrollLeft - (e.clientX - d.startX)
  }, [])

  const endTableDragScroll = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const root = tableScrollRef.current
    const d = tableDragScroll.current
    if (!d.active || e.pointerId !== d.pointerId) return
    d.active = false
    d.pointerId = -1
    if (root) {
      try {
        root.releasePointerCapture(e.pointerId)
      } catch {
        /* pointer not captured */
      }
      root.classList.remove('cursor-grabbing', 'select-none')
    }
  }, [])

  const onTableLostPointerCapture = useCallback(() => {
    const root = tableScrollRef.current
    const d = tableDragScroll.current
    d.active = false
    d.pointerId = -1
    root?.classList.remove('cursor-grabbing', 'select-none')
  }, [])

  return (
    <div className="space-y-4">
      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Registrations</h2>
            <p className="text-sm text-slate-500">Manage and monitor all event registrations</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Users className="h-3.5 w-3.5" />
              Import Participants
            </button>
            <button
              type="button"
              onClick={() => { void handlePrintRaceBibs() }}
              disabled={printLoading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {printLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
              {printLoading ? 'Preparing PDF…' : 'Print Race Bibs'}
            </button>
            <button
              type="button"
              onClick={() => setLedgerOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              View Legend
            </button>
          </div>
        </div>

        <div className="border-b border-slate-100 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Filters</p>
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 md:grid-cols-[1.3fr_repeat(5,minmax(0,1fr))_auto]">
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search registrations..."
                className="h-10 w-full rounded-md border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]"
              />
            </div>
            <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]">
              <option value="all">All Payment Status</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
              <option value="unknown">Unknown</option>
            </select>
            <select value={disciplineFilter} onChange={(e) => setDisciplineFilter(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]">
              <option value="all">All Disciplines</option>
              {disciplineOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]">
              <option value="all">All Categories</option>
              {categoryOptions.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <select value={entryEventTypeFilter} onChange={(e) => setEntryEventTypeFilter(e.target.value)} className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]">
              <option value="all">All Events</option>
              {entryEventTypeOptions.map(({ slug, label }) => (
                <option key={slug} value={slug}>{label}</option>
              ))}
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]">
              <option value="created_desc">Sort: Newest</option>
              <option value="created_asc">Sort: Oldest</option>
              <option value="cyclist_asc">Sort: A-Z</option>
              <option value="cyclist_desc">Sort: Z-A</option>
            </select>
            <input type="date" className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]" />
          </div>
        </div>

        <div className="grid gap-3 border-b border-slate-100 px-4 py-3 md:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Paid" value={paidCount} icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" loading={loading} />
          <StatCard label="Unpaid / pending" value={pendingCount} icon={<CalendarDays className="h-4 w-4" />} tone="amber" loading={loading} />
          <StatCard label="Total Registrations" value={filtered.length} icon={<Users className="h-4 w-4" />} tone="violet" loading={loading} />
        </div>

        {error ? <p className="px-4 py-3 text-sm text-rose-600">{error}</p> : null}
        {actionBanner ? (
          <div
            className={`mx-4 mb-2 flex items-start justify-between gap-3 rounded-md px-3 py-2 text-xs ${
              actionBanner.tone === 'success'
                ? 'bg-emerald-50 text-emerald-900'
                : actionBanner.tone === 'warning'
                  ? 'bg-amber-50 text-amber-950'
                  : actionBanner.tone === 'error'
                    ? 'bg-rose-50 text-rose-800'
                    : 'bg-slate-50 text-slate-700'
            }`}
            role="status"
          >
            <span className="min-w-0 flex-1">{actionBanner.text}</span>
            <button
              type="button"
              aria-label="Dismiss message"
              title="Dismiss"
              onClick={() => setActionBanner(null)}
              className="shrink-0 rounded p-1 text-current/70 hover:bg-black/5 hover:text-current"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : null}

        <div className="relative -mx-4 px-4 sm:mx-0 sm:px-0">
          <div
            ref={tableScrollRef}
            className="cursor-grab touch-pan-x overscroll-x-contain overflow-x-auto overflow-y-auto scroll-smooth rounded-lg border border-slate-100 sm:rounded-none sm:border-0 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden max-h-[min(600px,calc(100dvh-11rem))] sm:max-h-[min(600px,calc(100dvh-9rem))]"
            tabIndex={0}
            role="region"
            aria-label="Registrations table — drag left or right on a row or cell to scroll sideways; on touch, swipe horizontally."
            onPointerDown={onTablePointerDown}
            onPointerMove={onTablePointerMove}
            onPointerUp={endTableDragScroll}
            onPointerCancel={endTableDragScroll}
            onLostPointerCapture={onTableLostPointerCapture}
          >
          <table className="w-max min-w-[100%] max-w-none table-auto border-collapse text-left text-sm">
            <thead className="sticky top-0 z-20 bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500 shadow-[0_1px_0_0_rgb(226_232_240)]">
              <tr>
                <th className="min-w-[152px] max-w-[280px] whitespace-normal py-3 pl-4 pr-3 font-semibold">Rider Name</th>
                <th className="min-w-[168px] max-w-[280px] whitespace-normal py-3 pr-3 font-semibold">Event</th>
                <th className="min-w-[100px] py-3 pr-3 font-semibold">Category</th>
                <th className="min-w-[96px] py-3 pr-3 font-semibold">Discipline</th>
                <th className="min-w-[88px] max-w-[200px] whitespace-normal py-3 pr-3 font-semibold">Team</th>
                <th className="min-w-[112px] py-3 pr-3 font-semibold">Payment Status</th>
                <th className="min-w-[240px] py-3 pr-3 font-semibold">Reference No.</th>
                <th className="min-w-[90px] py-3 pr-3 font-semibold">Bib Number</th>
                <th className="min-w-[148px] whitespace-nowrap py-3 pr-4 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
              ) : paginated.length === 0 ? (
                <tr>
                  <td className="py-12 text-center" colSpan={9}>
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <Users className="h-8 w-8 opacity-40" />
                      <p className="text-sm font-medium">No registrations found.</p>
                      <p className="text-xs">Try adjusting your filters or search query.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map((r) => {
                  const payment = String(r.payment_status ?? 'unknown')
                  const isPaid = payment.toLowerCase() === 'paid'
                  const dupKey = `${String(r.registrant_email ?? '').toLowerCase()}|${String(r.event_title ?? '')}|${String(r.race_category_id ?? r.age_category ?? '')}|${String(r.entry_event_type_label ?? '').toLowerCase()}`
                  const showDupWarning = !isPaid && duplicateNonPaidKeys.has(dupKey)
                  const providerRef = getEffectiveProviderReference(r)
                  const referenceNo = isPaymongoPaymentReferenceId(providerRef)
                    ? providerRef
                    : ''
                  return (
                    <tr key={r.id} className="text-slate-800 transition-colors hover:bg-slate-50/70">
                      <td className="min-w-0 max-w-[280px] py-3 pl-4 pr-3 align-top">
                        <p className="break-words text-xs font-semibold leading-snug">{r.rider_full_name ?? '-'}</p>
                        <p className="break-all text-[11px] leading-snug text-slate-500">{r.registrant_email ?? '-'}</p>
                      </td>
                      <td className="min-w-0 max-w-[280px] py-3 pr-3 align-top text-xs">
                        <p className="break-words font-medium leading-snug text-slate-900">{r.event_title ?? r.race_type ?? '-'}</p>
                        <p className="break-words text-[11px] leading-snug text-slate-500">{r.entry_event_type_label ?? formatEventTypeSlugLabel(r.entry_event_type_slug)}</p>
                      </td>
                      <td className="max-w-[140px] break-words py-3 pr-3 align-top text-xs leading-snug">{r.age_category ?? '-'}</td>
                      <td className="max-w-[120px] break-words py-3 pr-3 align-top text-xs leading-snug">{r.discipline ?? '-'}</td>
                      <td className="min-w-0 max-w-[200px] break-words py-3 pr-3 align-top text-xs leading-snug">{r.team_name ?? 'N/A'}</td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${pill(payment)}`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                          {payment}
                        </span>
                      </td>
                      <td className="min-w-0 max-w-[200px] py-3 pr-3 align-top text-xs">
                        {referenceNo ? (
                          <span className="inline-flex max-w-full items-start gap-1.5">
                            <span className={`min-w-0 break-all font-semibold leading-snug ${isPaid ? 'text-emerald-700' : 'text-slate-700'}`}>{referenceNo}</span>
                            <button
                              type="button"
                              title={copiedId === r.id ? 'Copied!' : 'Copy reference number'}
                              onClick={() => {
                                void navigator.clipboard.writeText(referenceNo)
                                setCopiedId(r.id)
                                setTimeout(() => setCopiedId(null), 2000)
                              }}
                              className="-m-1 inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 sm:min-h-0 sm:min-w-0 sm:p-1"
                            >
                              {copiedId === r.id ? (
                                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500 transition-colors" aria-hidden />
                              ) : (
                                <Copy className="h-3.5 w-3.5 shrink-0 text-slate-400 transition-colors" aria-hidden />
                              )}
                              <span className="sr-only">Copy reference number</span>
                            </button>
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-xs font-semibold text-slate-700">
                        <span className="inline-flex items-center gap-1">
                          {showDupWarning ? (
                            <span title="Multiple unpaid registrations for the same rider, event, and category.">
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                            </span>
                          ) : null}
                          <span
                            title={
                              String(r.bib_number ?? '').trim()
                                ? undefined
                                : isPaid
                                  ? undefined
                                  : 'Usually shown after paid; generate manually when Reference No. (pay_...) is set.'
                            }
                          >
                            {String(r.bib_number ?? '').trim()
                              ? String(r.bib_number).trim()
                              : rowActionLoading[r.id] === 'autobib'
                                ? 'Generating...'
                                : '—'}
                          </span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-right align-middle">
                        <div className="inline-flex flex-nowrap items-center justify-end gap-1">
                          <button
                            type="button"
                            aria-label={rowActionLoading[r.id] === 'autobib' ? 'Generating bib number' : 'Generate bib number'}
                            title={
                              rowActionLoading[r.id] === 'autobib'
                                ? 'Generating bib…'
                                : referenceNo && !String(r.bib_number ?? '').trim()
                                  ? 'Generate bib'
                                  : 'Generate bib number'
                            }
                            onClick={() => void handleGenerateBibForRow(r)}
                            disabled={
                              rowActionLoading[r.id] != null
                              || Boolean(String(r.bib_number ?? '').trim())
                              || !referenceNo
                            }
                            className="inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md border border-[#1e4a8e]/30 text-[#1e4a8e] transition hover:bg-[#1e4a8e]/10 active:bg-[#1e4a8e]/15 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-9"
                          >
                            {rowActionLoading[r.id] === 'autobib' ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <NotebookPen className="h-4 w-4" aria-hidden />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={rowActionLoading[r.id] === 'email' ? 'Sending QR email' : 'Send QR code email'}
                            title={rowActionLoading[r.id] === 'email' ? 'Sending email…' : 'Send QR mail'}
                            onClick={() => void handleSendQr(r.id)}
                            disabled={rowActionLoading[r.id] != null || !isPaid || !String(r.bib_number ?? '').trim()}
                            className="inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md border border-emerald-200 text-emerald-700 transition hover:bg-emerald-50 active:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-9"
                          >
                            {rowActionLoading[r.id] === 'email' ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <Mail className="h-4 w-4" aria-hidden />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label="More registration actions"
                            aria-expanded={rowMenuPortal?.id === r.id}
                            aria-haspopup="menu"
                            title="More actions"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              const rect = ev.currentTarget.getBoundingClientRect()
                              setRowMenuPortal((cur) => {
                                if (cur?.id === r.id) return null
                                return {
                                  id: r.id,
                                  top: rect.bottom + 4,
                                  right: Math.max(8, window.innerWidth - rect.right),
                                }
                              })
                            }}
                            disabled={rowActionLoading[r.id] != null}
                            className="inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md border border-slate-200 text-slate-700 transition hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 sm:h-9 sm:w-9"
                          >
                            <MoreVertical className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-center sm:text-left">Showing {showingFrom} to {showingTo} of {filtered.length} registrations</p>
          <div className="flex flex-wrap items-center justify-center gap-1 sm:justify-end">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} className="inline-flex min-h-10 min-w-10 touch-manipulation items-center justify-center rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:text-slate-400 sm:min-h-0 sm:min-w-0" disabled={currentPage === 1}>‹</button>
            {pageNumbers.map((pageNumber) => (
              <button
                key={pageNumber}
                type="button"
                onClick={() => setPage(pageNumber)}
                className={`inline-flex min-h-10 min-w-10 touch-manipulation items-center justify-center rounded-md px-2.5 py-1 text-sm sm:min-h-0 sm:min-w-0 sm:text-xs ${pageNumber === currentPage ? 'bg-[#0f5ea8] font-semibold text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {pageNumber}
              </button>
            ))}
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="inline-flex min-h-10 min-w-10 touch-manipulation items-center justify-center rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:bg-slate-50 disabled:text-slate-400 sm:min-h-0 sm:min-w-0" disabled={currentPage === totalPages}>›</button>
          </div>
        </div>
      </section>

      {/* Import Participants Modal */}
      {importOpen && (
        <ImportParticipantsModal
          onClose={() => setImportOpen(false)}
          onDone={() => void fetchData()}
        />
      )}

      {editingRegistrationId && (
        <AdminRegistrationEditModal
          registrationId={editingRegistrationId}
          onClose={() => setEditingRegistrationId(null)}
          onSaved={() => void fetchData()}
        />
      )}

      {/* Category Legend Modal */}
      {ledgerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-900 text-white">
                  <ClipboardList className="h-3.5 w-3.5" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Category Legend</h3>
                  <p className="text-xs text-slate-500">View bib classes by event, discipline, and category.</p>
                </div>
              </div>
              <button type="button" onClick={() => setLedgerOpen(false)} className="rounded-md p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close legend">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-slate-100 px-4 py-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  value={ledgerEventId}
                  onChange={(e) => { setLedgerEventId(e.target.value); setLedgerDiscipline('all'); setLedgerCategoryId('all') }}
                  className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]"
                >
                  {ledgerEventOptions.length === 0 ? <option value="">No events available</option> : null}
                  {ledgerEventOptions.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
                </select>
                <select
                  value={ledgerDiscipline}
                  onChange={(e) => { setLedgerDiscipline(e.target.value); setLedgerCategoryId('all') }}
                  className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]"
                >
                  <option value="all">All Disciplines</option>
                  {ledgerDisciplineOptions.map((disc) => <option key={disc} value={disc}>{disc}</option>)}
                </select>
                <select
                  value={ledgerCategoryId}
                  onChange={(e) => setLedgerCategoryId(e.target.value)}
                  className="h-10 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 outline-none focus:border-[#1e4a8e]"
                >
                  <option value="all">All Categories</option>
                  {ledgerCategoryOptions.map((cat) => <option key={cat.id} value={cat.id}>{cat.category_name ?? cat.id}</option>)}
                </select>
              </div>
            </div>

            <div className="max-h-[55vh] overflow-auto p-4">
              {ledgerLoading ? <p className="text-sm text-slate-500">Loading legend…</p> : null}
              {!ledgerLoading && ledgerError ? <p className="text-sm text-rose-600">{ledgerError}</p> : null}
              {!ledgerLoading && !ledgerError && ledgerRows.length === 0 ? (
                <p className="text-sm text-slate-500">No legend entries found for this filter.</p>
              ) : null}
              {!ledgerLoading && !ledgerError && ledgerRows.length > 0 ? (
                <>
                  <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Discipline</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Category</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Event Type</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-600">Bib Code</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {ledgerRows.map((item) => {
                        const category = ledgerCategories.find((c) => c.id === item.race_category_id)
                        const eventTypeName = ledgerEventTypes.find((t) => t.slug === item.entry_event_type_slug)?.name ?? formatEventTypeSlugLabel(item.entry_event_type_slug)
                        return (
                          <tr key={item.id}>
                            <td className="px-3 py-2 text-slate-700">{category?.discipline ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-700">{category?.category_name ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-700">{eventTypeName}</td>
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center rounded-md bg-[#1e4a8e] px-2.5 py-1 text-xs font-bold text-white">
                                {item.bib_class_code ?? '—'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs text-slate-500">Total {ledgerRows.length} records</p>
                </>
              ) : null}
            </div>

            <div className="flex justify-end border-t border-slate-100 px-4 py-3">
              <button
                type="button"
                onClick={() => setLedgerOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rowMenuPortal && portalMenuRow && typeof document !== 'undefined'
        ? createPortal(
            <>
              <div className="fixed inset-0 z-[80] bg-slate-900/0" aria-hidden onClick={() => setRowMenuPortal(null)} />
              <div
                role="menu"
                className="fixed z-[90] max-h-[min(70vh,22rem)] w-[min(calc(100vw-16px),13rem)] overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-white py-1 text-left shadow-xl"
                style={{ top: rowMenuPortal.top, right: rowMenuPortal.right }}
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={rowActionLoading[portalMenuRow.id] != null}
                  className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:py-2 sm:text-xs"
                  onClick={() => {
                    setRowMenuPortal(null)
                    setEditingRegistrationId(portalMenuRow.id)
                  }}
                >
                  <Pencil className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Edit entry
                </button>
                <Link
                  role="menuitem"
                  to={`/admin/registrations/${encodeURIComponent(portalMenuRow.id)}`}
                  aria-disabled={rowActionLoading[portalMenuRow.id] != null}
                  className={`flex min-h-[44px] w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 sm:min-h-0 sm:py-2 sm:text-xs ${rowActionLoading[portalMenuRow.id] != null ? 'pointer-events-none opacity-40' : ''}`}
                  onClick={() => setRowMenuPortal(null)}
                >
                  View registration
                </Link>
                {isUnpaidDraftRegistrationRow(portalMenuRow) ? (
                  <button
                    type="button"
                    role="menuitem"
                    title={
                      canManualDeletePendingEntry(portalMenuRow)
                        ? 'Remove this unpaid checkout (allowed within 2 hours of creation; same window as automatic purge).'
                        : 'Older than 2 hours — it will be removed automatically when the list refreshes (or use purge).'
                    }
                    disabled={!canManualDeletePendingEntry(portalMenuRow)}
                    onClick={() => openPendingDeleteModal(portalMenuRow)}
                    className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0 sm:py-2 sm:text-xs"
                  >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Delete entry
                  </button>
                ) : null}
              </div>
            </>,
            document.body,
          )
        : null}

      {pendingDeleteRow ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4"
          onClick={() => {
            if (rowActionLoading[pendingDeleteRow.id] === 'delete') return
            setPendingDeleteRow(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-reg-title"
            className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <h3 id="delete-reg-title" className="text-sm font-semibold text-slate-900">
                Delete pending registration?
              </h3>
              <p className="mt-1 text-xs text-slate-500">This cannot be undone. Only unpaid checkout rows within 2 hours can be removed.</p>
            </div>
            <div className="space-y-2 px-4 py-3 text-sm text-slate-800">
              <p>
                <span className="font-semibold">{pendingDeleteRow.rider_full_name ?? '—'}</span>
              </p>
              <p className="text-xs text-slate-600">{pendingDeleteRow.registrant_email ?? '—'}</p>
              <p className="text-xs text-slate-600">
                {pendingDeleteRow.event_title ?? pendingDeleteRow.race_type ?? 'Event'} ·{' '}
                {pendingDeleteRow.entry_event_type_label ?? formatEventTypeSlugLabel(pendingDeleteRow.entry_event_type_slug)}
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendingDeleteRow(null)}
                disabled={rowActionLoading[pendingDeleteRow.id] === 'delete'}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const row = pendingDeleteRow
                  if (row) void confirmPendingDelete(row)
                }}
                disabled={rowActionLoading[pendingDeleteRow.id] === 'delete'}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {rowActionLoading[pendingDeleteRow.id] === 'delete' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  tone,
  loading,
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone: 'emerald' | 'amber' | 'blue' | 'rose' | 'violet'
  loading?: boolean
}) {
  const iconClass =
    tone === 'emerald' ? 'bg-emerald-50 text-emerald-600'
    : tone === 'amber' ? 'bg-amber-50 text-amber-600'
    : tone === 'blue' ? 'bg-blue-50 text-blue-600'
    : tone === 'rose' ? 'bg-rose-50 text-rose-600'
    : 'bg-violet-50 text-violet-600'
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] text-slate-500">{label}</p>
          {loading ? (
            <div className="mt-1 h-7 w-10 animate-pulse rounded bg-slate-200" />
          ) : (
            <p className="text-2xl font-semibold text-slate-900">{value}</p>
          )}
        </div>
        <span className={`rounded-md p-2 ${iconClass}`}>{icon}</span>
      </div>
    </div>
  )
}