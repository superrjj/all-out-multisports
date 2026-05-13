// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  })
}

const MAX_BODY_BYTES = 8192
const MAX_QUERY_LEN = 100
const MAX_FIELD_OUT = 240
const MAX_BIB_OUT = 32

function stripControlCharacters(input: string) {
  return String(input ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
}

function sanitizeSearchQuery(raw: string) {
  return stripControlCharacters(raw).trim().slice(0, MAX_QUERY_LEN)
}

function sanitizeOutputField(value: unknown, maxLen: number) {
  const s = stripControlCharacters(String(value ?? '')).trim()
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}…`
}

function escapeIlike(value: string) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

function normalizeEventType(raw: string | null | undefined) {
  const first = String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0]
  if (!first) return 'Criterium'
  return first
    .split(/[_-]/)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
    .join(' ')
}

function quotePostgrestValue(val: string) {
  return `"${String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function pickPrimarySearchToken(raw: string) {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length === 0) return ''
  const longest = tokens.reduce((a, b) => (b.length > a.length ? b : a), tokens[0])
  return longest.length >= 2 ? longest : raw.trim().length >= 2 ? raw.trim() : ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const contentLength = req.headers.get('content-length')
  if (contentLength != null) {
    const n = Number(contentLength)
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Payload too large' }, 413)
    }
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse({ error: 'Invalid request body' }, 400)
  }

  const q = (body as { query?: unknown }).query
  if (q != null && typeof q !== 'string') {
    return jsonResponse({ error: 'Invalid query' }, 400)
  }

  const raw = sanitizeSearchQuery(typeof q === 'string' ? q : '')
  if (raw.length < 2) {
    return jsonResponse({ riders: [] as unknown[] }, 200)
  }

  const primary = pickPrimarySearchToken(raw)
  if (!primary) {
    return jsonResponse({ riders: [] as unknown[] }, 200)
  }

  const tokens = raw
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)

  const pattern = `%${escapeIlike(primary)}%`
  const quoted = quotePostgrestValue(pattern)
  const { data: riderRows, error: riderErr } = await supabaseAdmin
    .from('registration_rider_details')
    .select('registration_id, first_name, last_name, discipline, age_category')
    .or(`first_name.ilike.${quoted},last_name.ilike.${quoted}`)
    .limit(280)

  if (riderErr) return jsonResponse({ error: sanitizeOutputField(riderErr.message ?? 'Search error', 200) }, 500)

  const filteredRiders = (riderRows ?? []).filter((row) => {
    const full = [row.first_name, row.last_name].filter(Boolean).join(' ').toLowerCase()
    if (!full) return false
    return tokens.every((tok) => full.includes(tok))
  })

  const regIds = Array.from(new Set(filteredRiders.map((r) => String(r.registration_id ?? '')).filter(Boolean)))
  if (regIds.length === 0) {
    return jsonResponse({ riders: [] }, 200)
  }

  const { data: forms, error: formsErr } = await supabaseAdmin
    .from('registration_forms')
    .select('id, bib_number, event_id, race_category_id, entry_event_type_label, status')
    .in('id', regIds)
    .in('status', ['confirmed', 'paid'])

  if (formsErr) return jsonResponse({ error: sanitizeOutputField(formsErr.message ?? 'Search error', 200) }, 500)

  const formById = new Map((forms ?? []).map((f) => [String(f.id), f]))
  const visibleRegIds = regIds.filter((id) => formById.has(id))
  if (visibleRegIds.length === 0) {
    return jsonResponse({ riders: [] }, 200)
  }

  const eventIds = Array.from(
    new Set(visibleRegIds.map((id) => String(formById.get(id)?.event_id ?? '')).filter(Boolean)),
  )
  const categoryIds = Array.from(
    new Set(visibleRegIds.map((id) => String(formById.get(id)?.race_category_id ?? '')).filter(Boolean)),
  )

  const [{ data: events, error: evErr }, { data: categories, error: catErr }] = await Promise.all([
    eventIds.length
      ? supabaseAdmin.from('events').select('id, race_type').in('id', eventIds)
      : Promise.resolve({ data: [], error: null }),
    categoryIds.length
      ? supabaseAdmin.from('race_categories').select('id, category_name').in('id', categoryIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (evErr) return jsonResponse({ error: sanitizeOutputField(evErr.message ?? 'Search error', 200) }, 500)
  if (catErr) return jsonResponse({ error: sanitizeOutputField(catErr.message ?? 'Search error', 200) }, 500)

  const eventById = new Map((events ?? []).map((e) => [String(e.id), e]))
  const categoryById = new Map((categories ?? []).map((c) => [String(c.id), c]))

  const riders: Array<{
    registrationId: string
    riderName: string
    bibNumber: string
    eventType: string
    discipline: string
    category: string
  }> = []

  for (const row of filteredRiders) {
    const regId = String(row.registration_id ?? '')
    const form = formById.get(regId)
    if (!form) continue

    const riderName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || '—'
    const bibNumber = String(form.bib_number ?? '').trim() || '—'

    const ev = form.event_id ? eventById.get(String(form.event_id)) : undefined
    const rc = form.race_category_id ? categoryById.get(String(form.race_category_id)) : undefined

    const entryLabel = String(form.entry_event_type_label ?? '').trim()
    const eventType = entryLabel || normalizeEventType(ev?.race_type)

    const discipline = String(row.discipline ?? '').trim() || normalizeEventType(ev?.race_type)
    const category =
      String(rc?.category_name ?? '').trim() || String(row.age_category ?? '').trim() || '—'

    riders.push({
      registrationId: sanitizeOutputField(regId, 64),
      riderName: sanitizeOutputField(riderName, MAX_FIELD_OUT),
      bibNumber: sanitizeOutputField(bibNumber, MAX_BIB_OUT),
      eventType: sanitizeOutputField(eventType, MAX_FIELD_OUT),
      discipline: sanitizeOutputField(discipline, MAX_FIELD_OUT),
      category: sanitizeOutputField(category, MAX_FIELD_OUT),
    })
  }

  riders.sort((a, b) => a.riderName.localeCompare(b.riderName, undefined, { sensitivity: 'base' }))

  return jsonResponse({ riders: riders.slice(0, 60) }, 200)
})
