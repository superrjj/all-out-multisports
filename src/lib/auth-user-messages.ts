/** Maps Supabase / network auth errors to short, non-technical copy for riders. */
export function mapAuthError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const t = raw.toLowerCase()

  if (!raw.trim()) {
    return 'Something went wrong. Please try again in a moment.'
  }
  if (t.includes('timed out') || t.includes('taking too long') || t.includes('timeout')) {
    return 'This is taking longer than usual. Check your connection and try again.'
  }
  if (t.includes('invalid login credentials') || t.includes('invalid credentials')) {
    return 'That email or password does not match our records. Double-check both fields and try again.'
  }
  if (t.includes('email not confirmed')) {
    return 'Please confirm your email first. Use the code we sent you, or request a new code below.'
  }
  if (t.includes('already registered') || t.includes('already been registered') || t.includes('user already exists')) {
    return 'This email is already in use. Try logging in instead.'
  }
  if (t.includes('password should be at least') || t.includes('password is too short')) {
    return 'Use at least 8 characters for your password.'
  }
  if (t.includes('invalid email')) {
    return 'That email address does not look valid. Please check for typos.'
  }
  if (t.includes('token has expired') || t.includes('expired') || t.includes('invalid otp')) {
    return 'That code is incorrect or has expired. Request a new code and try again.'
  }
  if (t.includes('same password') || t.includes('different from the old password')) {
    return 'Choose a password you have not used on this account before.'
  }
  if (t.includes('rate limit') || t.includes('too many') || t.includes('only request this after')) {
    return 'Too many attempts right now. Please wait a minute before trying again.'
  }
  if (t.includes('fetch') || t.includes('network') || t.includes('failed to fetch')) {
    return 'We could not reach the server. Check your internet connection and try again.'
  }
  if (t.includes('8-digit')) {
    return raw
  }

  if (raw.length < 120 && !raw.includes('{') && !raw.includes('http')) {
    return raw
  }

  return 'Something went wrong on our side. Please wait a moment and try again.'
}

export function isLikelyTimeoutMessage(message: string): boolean {
  return message.toLowerCase().includes('timed out') || message.toLowerCase().includes('taking too long')
}
