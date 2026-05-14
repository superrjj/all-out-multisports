import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../hooks/useAuth'

type AuthMode = 'login' | 'signup'
const AUTH_TIMEOUT_MS = 15000
/** Seconds before "Resend code" is allowed again (initial send + each resend). */
const RESEND_COOLDOWN_SEC = 60

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    }),
  ])
}

function formatResendCooldown(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function AuthPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, register, verifySignupOtp, resendConfirmation, session, loading, role, roleLoading } = useAuth()
  const [mode, setMode] = useState<AuthMode>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState('')
  const [verificationPhase, setVerificationPhase] = useState<'none' | 'otp'>('none')
  const [verificationCode, setVerificationCode] = useState('')
  const [otpSubmitting, setOtpSubmitting] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const [fullNameError, setFullNameError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [formError, setFormError] = useState('')

  const redirectParam = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('redirect')
  }, [location.search])

  const modeParam = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('mode')
  }, [location.search])

  useEffect(() => {
    if (modeParam === 'login' || modeParam === 'signup') {
      setMode(modeParam)
      setPendingVerificationEmail('')
      setVerificationPhase('none')
      setVerificationCode('')
      setOtpError('')
      setFormError('')
      setEmailError('')
      setPasswordError('')
      setFullNameError('')
      setResendCooldown(0)
    }
  }, [modeParam])

  useEffect(() => {
    if (!loading && session && !roleLoading) {
      const redirect = redirectParam || ''
      const next =
        role === 'admin'
          ? redirect.startsWith('/admin')
            ? redirect
            : '/admin'
          : redirect || '/register/info'
      void navigate(next, { replace: true })
    }
  }, [loading, navigate, redirectParam, role, roleLoading, session])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setTimeout(() => setResendCooldown((prev) => prev - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setPendingVerificationEmail('')
    setVerificationPhase('none')
    setVerificationCode('')
    setOtpError('')
    setFullNameError('')
    setEmailError('')
    setPasswordError('')
    setFormError('')

    const trimmedEmail = email.trim().toLowerCase()
    const trimmedFullName = fullName.trim()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (mode === 'signup') {
      if (!trimmedFullName || trimmedFullName.length < 2) {
        setFullNameError('Please enter your full name.')
        setSubmitting(false)
        return
      }
      if (!emailRegex.test(trimmedEmail)) {
        setEmailError('Please enter a valid email address.')
        setSubmitting(false)
        return
      }
      if (password.length < 8) {
        setPasswordError('Password must be at least 8 characters.')
        setSubmitting(false)
        return
      }
    }

    try {
      if (mode === 'login') {
        await withTimeout(login(trimmedEmail, password), AUTH_TIMEOUT_MS, 'Login timed out. Please try again.')
        toast.success('Welcome back!')
      } else {
        const { session: newSession } = await withTimeout(
          register(trimmedEmail, password, trimmedFullName),
          AUTH_TIMEOUT_MS,
          'Create account request timed out. Please try again.',
        )
        if (newSession) {
          toast.success('Welcome! Your account is ready.')
          return
        }
        setPendingVerificationEmail(trimmedEmail)
        setVerificationPhase('otp')
        setVerificationCode('')
        setOtpError('')
        setResendCooldown(RESEND_COOLDOWN_SEC)
        toast.success('We sent a verification code to your email. Enter it below to finish signup.')
      }
    } catch (error) {
      const message = (error as Error).message || 'Authentication failed.'
      if (message.toLowerCase().includes('email not confirmed')) {
        setPendingVerificationEmail(trimmedEmail)
        setVerificationPhase('otp')
        setVerificationCode('')
        setOtpError('')
        setResendCooldown(RESEND_COOLDOWN_SEC)
        toast.error('Enter the verification code from your email on this screen.')
      } else if (mode === 'signup' && (message.toLowerCase().includes('already registered') || message.toLowerCase().includes('already been registered'))) {
        setEmailError('This email is already registered. Please login instead.')
      } else if (mode === 'login' && message.toLowerCase().includes('invalid login credentials')) {
        setFormError('Incorrect email or password. Please try again.')
      } else if (mode === 'signup' && message.toLowerCase().includes('password should be at least')) {
        setPasswordError('Password must be at least 8 characters.')
      } else if (message.toLowerCase().includes('timed out')) {
        setFormError('The request is taking too long. Please try again in a moment.')
      } else {
        setFormError(mode === 'login' ? 'Unable to login right now. Please try again.' : 'Unable to create account right now. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const onResendConfirmation = async () => {
    const target = pendingVerificationEmail || email.trim().toLowerCase()
    if (!target) return
    setResending(true)
    try {
      await withTimeout(
        resendConfirmation(target),
        AUTH_TIMEOUT_MS,
        'Resend verification request timed out. Please try again.',
      )
      toast.success('Verification code resent. Check your inbox.')
      setResendCooldown(RESEND_COOLDOWN_SEC)
    } catch (error) {
      const message = (error as Error).message || ''
      if (message.toLowerCase().includes('timed out')) {
        toast.error('Request timed out. Please try resending again.')
      } else {
        toast.error('Failed to resend verification code.')
      }
    } finally {
      setResending(false)
    }
  }

  const onVerifyOtp = async () => {
    const target = pendingVerificationEmail || email.trim().toLowerCase()
    if (!target) return
    setOtpError('')
    setOtpSubmitting(true)
    try {
      await withTimeout(
        verifySignupOtp(target, verificationCode),
        AUTH_TIMEOUT_MS,
        'Verification timed out. Please try again.',
      )
      toast.success('Email verified. You are signed in.')
      setVerificationPhase('none')
      setVerificationCode('')
      setPendingVerificationEmail('')
    } catch (error) {
      const message = (error as Error).message || 'Invalid or expired code. Try again or request a new code.'
      setOtpError(message)
    } finally {
      setOtpSubmitting(false)
    }
  }

  const onCancelVerification = () => {
    setVerificationPhase('none')
    setVerificationCode('')
    setOtpError('')
    setPendingVerificationEmail('')
    setResendCooldown(0)
  }

  const otpDigitCount = verificationCode.replace(/\D/g, '').length
  const otpVerifyDisabled = otpSubmitting || otpDigitCount < 6

  return (
    <section className="flex h-[calc(100svh-4.5rem)] items-center overflow-hidden bg-slate-50 px-3 py-4 text-slate-900 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto w-full max-w-md space-y-5 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.28),0_6px_14px_-8px_rgba(15,23,42,0.2)] sm:space-y-6 sm:p-6">
        <div className="space-y-1 text-center">
          <div className="flex justify-center pb-2">
            <img
              src="/all_out_multisports.png"
              alt="All Out Multisports"
              className="h-14 w-auto sm:h-16"
              loading="eager"
              decoding="async"
            />
          </div>
          <p className="text-sm text-slate-700">All Out Multisports</p>
          <h1 className="text-xl font-semibold tracking-tight sm:text-3xl">
            {verificationPhase === 'otp' ? 'Verify your email' : mode === 'login' ? 'Login' : 'Create account'}
          </h1>
          <p className="text-xs text-slate-600 sm:text-sm">
            {verificationPhase === 'otp'
              ? 'Enter the verification code from your email (often 6–8 digits).'
              : mode === 'login'
                ? 'Login to continue your registration.'
                : 'Create your account to register for the event.'}
          </p>
        </div>

        {verificationPhase === 'otp' ? (
          <div className="space-y-4">
            <p className="text-center text-sm text-slate-700">
              Code sent to{' '}
              <span className="font-semibold break-all">{pendingVerificationEmail || email.trim() || 'your email'}</span>
            </p>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-900" htmlFor="otp-code">
                Verification code
              </label>
              <input
                id="otp-code"
                value={verificationCode}
                onChange={(event) => {
                  setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 12))
                  setOtpError('')
                }}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="00000000"
                maxLength={14}
                title="Paste the full code from your email (numbers only)."
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-center font-mono text-lg tracking-[0.35em] text-slate-900 outline-none focus:border-[#cfae3f] sm:py-2"
              />
            </div>
            {otpError ? <p className="text-sm text-rose-600">{otpError}</p> : null}
            <button
              type="button"
              onClick={() => void onVerifyOtp()}
              disabled={otpVerifyDisabled}
              className="inline-flex w-full items-center justify-center rounded-md bg-[#cfae3f] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#dab852] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {otpSubmitting ? 'Verifying...' : 'Verify & continue'}
            </button>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => void onResendConfirmation()}
                disabled={resending || resendCooldown > 0}
                className="inline-flex flex-1 items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resending ? 'Sending...' : resendCooldown > 0 ? `Resend in ${formatResendCooldown(resendCooldown)}` : 'Resend code'}
              </button>
              <button
                type="button"
                onClick={onCancelVerification}
                className="inline-flex flex-1 items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-1.5 rounded-md bg-slate-100 p-1 sm:gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('login')
                  setPendingVerificationEmail('')
                  setVerificationPhase('none')
                  setVerificationCode('')
                  setOtpError('')
                  setFormError('')
                  setEmailError('')
                  setPasswordError('')
                  setFullNameError('')
                  setResendCooldown(0)
                }}
                className={`rounded-md px-2.5 py-2 text-sm font-medium transition sm:px-3 ${
                  mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup')
                  setPendingVerificationEmail('')
                  setVerificationPhase('none')
                  setVerificationCode('')
                  setOtpError('')
                  setFormError('')
                  setEmailError('')
                  setPasswordError('')
                  setFullNameError('')
                  setResendCooldown(0)
                }}
                className={`rounded-md px-2.5 py-2 text-sm font-medium transition sm:px-3 ${
                  mode === 'signup' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Create account
              </button>
            </div>

            <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
              {mode === 'signup' && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-900" htmlFor="full-name">
                    Full name
                  </label>
                  <input
                    id="full-name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Juan Dela Cruz"
                    required
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#cfae3f] sm:py-2"
                  />
                  {fullNameError && <p className="text-xs text-rose-600">{fullNameError}</p>}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-900" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setPendingVerificationEmail('')
                    setEmailError('')
                    setFormError('')
                  }}
                  type="email"
                  placeholder="you@gmail.com"
                  autoComplete="email"
                  required
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#cfae3f] sm:py-2"
                />
                {emailError && <p className="text-xs text-rose-600">{emailError}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-900" htmlFor="password">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setPasswordError('')
                      setFormError('')
                    }}
                    type={showPassword ? 'text' : 'password'}
                    minLength={8}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 pr-20 text-sm text-slate-900 outline-none focus:border-[#cfae3f] sm:py-2"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {passwordError && <p className="text-xs text-rose-600">{passwordError}</p>}
              </div>

              {formError && <p className="text-sm text-rose-600">{formError}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center rounded-md bg-[#cfae3f] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#dab852] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create account'}
              </button>
            </form>
          </>
        )}

        <div className="text-center text-sm text-slate-600">
          <Link to="/" className="font-medium text-slate-700 hover:text-slate-900">
            Back to home
          </Link>
        </div>
      </div>
    </section>
  )
}