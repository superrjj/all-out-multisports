import { supabase } from '../lib/supabase'
import { normalizeRiderSearchQuery, sanitizeRiderSearchDisplay } from '../utils/riderSearchSecurity'

export type PublicRiderSearchRow = {
  registrationId?: string
  riderName: string
  bibNumber: string
  eventType: string
  discipline: string
  category: string
}

async function invokeErrorMessage(error: unknown, responseData: unknown, fallback: string): Promise<string> {
  const wrap = (raw: string) => {
    const t = String(raw ?? '').trim()
    if (!t) return fallback
    if (!t.startsWith('{')) return t
    try {
      const o = JSON.parse(t) as { message?: string; error?: string }
      return String(o.message ?? o.error ?? t)
    } catch {
      return t
    }
  }

  const ctx = (error as { context?: { text?: () => Promise<string> } })?.context
  if (ctx && typeof ctx.text === 'function') {
    try {
      const text = await ctx.text()
      if (text?.trim()) return wrap(text)
    } catch {
      /* ignore */
    }
  }

  if (responseData && typeof responseData === 'object') {
    const o = responseData as { message?: string; error?: string }
    const inline = String(o.message ?? o.error ?? '').trim()
    if (inline) return inline
  }

  const msg = (error as { message?: string } | null)?.message
  return msg?.trim() ? msg.trim() : fallback
}

function sanitizeClientErrorMessage(message: string): string {
  return sanitizeRiderSearchDisplay(message, 400)
}

function sanitizeRiderRow(row: PublicRiderSearchRow): PublicRiderSearchRow {
  return {
    registrationId: row.registrationId ? sanitizeRiderSearchDisplay(row.registrationId, 64) : undefined,
    riderName: sanitizeRiderSearchDisplay(row.riderName),
    bibNumber: sanitizeRiderSearchDisplay(row.bibNumber, 32),
    eventType: sanitizeRiderSearchDisplay(row.eventType),
    discipline: sanitizeRiderSearchDisplay(row.discipline),
    category: sanitizeRiderSearchDisplay(row.category),
  }
}

export const publicRiderSearchApi = {
  async searchByName(query: string): Promise<PublicRiderSearchRow[]> {
    const normalized = normalizeRiderSearchQuery(query)
    const { data, error } = await supabase.functions.invoke('public-search-riders', {
      body: { query: normalized },
    })
    if (error) throw new Error(sanitizeClientErrorMessage(await invokeErrorMessage(error, data, 'Rider search failed.')))
    if (!data || typeof data !== 'object') return []
    const o = data as { riders?: PublicRiderSearchRow[]; error?: string }
    if (o.error) throw new Error(sanitizeRiderSearchDisplay(String(o.error), 500))
    if (!Array.isArray(o.riders)) return []
    return o.riders.map((r) =>
      sanitizeRiderRow({
        registrationId: typeof r.registrationId === 'string' ? r.registrationId : undefined,
        riderName: String(r.riderName ?? ''),
        bibNumber: String(r.bibNumber ?? ''),
        eventType: String(r.eventType ?? ''),
        discipline: String(r.discipline ?? ''),
        category: String(r.category ?? ''),
      }),
    )
  },
}
