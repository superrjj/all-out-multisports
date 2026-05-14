import { supabase } from '../lib/supabase'

export type EmailRegisteredLookup = 'taken' | 'available' | 'unknown'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** True if `email` looks like a normal address (trimmed / lowercased). */
export function isPlausibleEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim().toLowerCase())
}

/**
 * Whether an account exists for this email.
 * Prefer DB function `auth_email_exists` (see supabase/migrations) so unconfirmed auth users still count as taken.
 * Falls back to `public.users` if the RPC is not deployed or errors.
 */
export async function fetchEmailRegisteredStatus(email: string): Promise<EmailRegisteredLookup> {
  const normalized = email.trim().toLowerCase()
  if (!EMAIL_RE.test(normalized)) return 'unknown'

  const rpc = await supabase.rpc('auth_email_exists', { p_email: normalized })
  if (!rpc.error && typeof rpc.data === 'boolean') {
    return rpc.data ? 'taken' : 'available'
  }

  const { data, error } = await supabase.from('users').select('id').eq('email', normalized).maybeSingle()
  if (error) return 'unknown'
  return data?.id ? 'taken' : 'available'
}
