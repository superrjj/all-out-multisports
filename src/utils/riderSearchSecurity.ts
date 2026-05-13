/** Rider search: input hardening and safe display strings (defense in depth; React already escapes text nodes). */

const MAX_SEARCH_QUERY_LEN = 100
const MAX_DISPLAY_FIELD_LEN = 240

/** Removes C0 control chars and DEL that should never appear in names or public labels. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export function stripControlCharacters(input: string): string {
  return String(input ?? '').replace(CONTROL_CHARS, '')
}

/** Client-side search box value: bounded length, no control characters. */
export function normalizeRiderSearchQuery(raw: string): string {
  return stripControlCharacters(raw).trim().slice(0, MAX_SEARCH_QUERY_LEN)
}

/** API / table display: strip controls and cap length so huge payloads cannot stress the DOM. */
export function sanitizeRiderSearchDisplay(value: unknown, maxLen = MAX_DISPLAY_FIELD_LEN): string {
  const s = stripControlCharacters(String(value ?? '')).trim()
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}…`
}
