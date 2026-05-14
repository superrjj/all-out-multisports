import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Lock, Mail, User, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../hooks/useAuth'
import { isLikelyTimeoutMessage, mapAuthError } from '../../lib/auth-user-messages'

type AuthMode = 'login' | 'signup'
type VerificationPhase = 'none' | 'otp' | 'new_password'
type OtpContext = 'signup' | 'recovery' | null

const AUTH_TIMEOUT_MS = 15000
const RESEND_COOLDOWN_SEC = 60
const OTP_CODE_LENGTH = 8
const REMEMBER_EMAIL_KEY = 'hna_auth_remember_email'

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    }),
  ])
}

function resetFlowState() {
  return {
    pendingVerificationEmail: '',
    verificationPhase: 'none' as VerificationPhase,
    verificationCode: '',
    otpError: '',
    resendCooldown: 0,
    otpContext: null as OtpContext,
    awaitingNewPassword: false,
    newPassword: '',
    confirmNewPassword: '',
    resetPwError: '',
  }
}

export function AuthPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    login,
    register,
    verifySignupOtp,
    verifyRecoveryOtp,
    resendConfirmation,
    requestPasswordRecovery,
    updatePassword,
    logout,
    session,
    loading,
    role,
    roleLoading,
  } = useAuth()
  const [mode, setMode] = useState<AuthMode>('login')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState('')
  const [verificationPhase, setVerificationPhase] = useState<VerificationPhase>('none')
  const [verificationCode, setVerificationCode] = useState('')
  const [otpSubmitting, setOtpSubmitting] = useState(false)
  const [otpError, setOtpError] = useState('')
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [forgotSending, setForgotSending] = useState(false)
  const [fullNameError, setFullNameError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [formError, setFormError] = useState('')
  const [otpContext, setOtpContext] = useState<OtpContext>(null)
  const [awaitingNewPassword, setAwaitingNewPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [resetPwSubmitting, setResetPwSubmitting] = useState(false)
  const [resetPwError, setResetPwError] = useState('')

  const redirectParam = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('redirect')
  }, [location.search])

  const modeParam = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return params.get('mode')
  }, [location.search])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_EMAIL_KEY)
      if (saved?.trim()) setEmail(saved.trim())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (modeParam === 'login' || modeParam === 'signup') {
      setMode(modeParam)
      const r = resetFlowState()
      setPendingVerificationEmail(r.pendingVerificationEmail)
      setVerificationPhase(r.verificationPhase)
      setVerificationCode(r.verificationCode)
      setOtpError(r.otpError)
      setFormError('')
      setEmailError('')
      setPasswordError('')
      setFullNameError('')
      setResendCooldown(r.resendCooldown)
      setAcceptedTerms(false)
      setOtpContext(r.otpContext)
      setAwaitingNewPassword(r.awaitingNewPassword)
      setNewPassword(r.newPassword)
      setConfirmNewPassword(r.confirmNewPassword)
      setResetPwError(r.resetPwError)
    }
  }, [modeParam])

  useEffect(() => {
    if (awaitingNewPassword) return
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
  }, [awaitingNewPassword, loading, navigate, redirectParam, role, roleLoading, session])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setTimeout(() => setResendCooldown((prev) => prev - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  const showBrandingHeader = verificationPhase !== 'otp'

  const applyTabReset = (next: AuthMode) => {
    setMode(next)
    const r = resetFlowState()
    setPendingVerificationEmail(r.pendingVerificationEmail)
    setVerificationPhase(r.verificationPhase)
    setVerificationCode(r.verificationCode)
    setOtpError(r.otpError)
    setFormError('')
    setEmailError('')
    setPasswordError('')
    setFullNameError('')
    setResendCooldown(r.resendCooldown)
    setAcceptedTerms(false)
    setOtpContext(r.otpContext)
    setAwaitingNewPassword(r.awaitingNewPassword)
    setNewPassword(r.newPassword)
    setConfirmNewPassword(r.confirmNewPassword)
    setResetPwError(r.resetPwError)
  }

  const onForgotPassword = async () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) {
      toast.error('Please enter the email you used when you signed up.')
      return
    }
    setForgotSending(true)
    try {
      await withTimeout(
        requestPasswordRecovery(trimmed),
        AUTH_TIMEOUT_MS,
        'This is taking longer than usual. Please try again.',
      )
      setPendingVerificationEmail(trimmed)
      setOtpContext('recovery')
      setVerificationPhase('otp')
      setVerificationCode('')
      setOtpError('')
      setResendCooldown(RESEND_COOLDOWN_SEC)
      toast.success(
        'If we find an account for that email, we have sent an 8-digit code. Enter it below to choose a new password.',
      )
    } catch (e) {
      toast.error(mapAuthError(e))
    } finally {
      setForgotSending(false)
    }
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    const r = resetFlowState()
    setPendingVerificationEmail(r.pendingVerificationEmail)
    setVerificationPhase(r.verificationPhase)
    setVerificationCode(r.verificationCode)
    setOtpError(r.otpError)
    setOtpContext(r.otpContext)
    setAwaitingNewPassword(r.awaitingNewPassword)
    setResendCooldown(r.resendCooldown)
    setFullNameError('')
    setEmailError('')
    setPasswordError('')
    setFormError('')

    const trimmedEmail = email.trim().toLowerCase()
    const trimmedFullName = fullName.trim()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (mode === 'signup') {
      if (!trimmedFullName || trimmedFullName.length < 2) {
        setFullNameError('Please enter your name as it should appear on your registration.')
        setSubmitting(false)
        return
      }
      if (!emailRegex.test(trimmedEmail)) {
        setEmailError('Please enter a valid email address.')
        setSubmitting(false)
        return
      }
      if (password.length < 8) {
        setPasswordError('Use at least 8 characters so your account stays secure.')
        setSubmitting(false)
        return
      }
      if (!acceptedTerms) {
        setFormError('Please agree to the Terms of Service and Privacy Policy to continue.')
        setSubmitting(false)
        return
      }
    }

    try {
      if (mode === 'login') {
        await withTimeout(
          login(trimmedEmail, password),
          AUTH_TIMEOUT_MS,
          'This is taking longer than usual. Please try again.',
        )
        try {
          if (rememberMe) localStorage.setItem(REMEMBER_EMAIL_KEY, trimmedEmail)
          else localStorage.removeItem(REMEMBER_EMAIL_KEY)
        } catch {
          /* ignore */
        }
        toast.success('You are signed in. Welcome back!')
      } else {
        const { session: newSession } = await withTimeout(
          register(trimmedEmail, password, trimmedFullName),
          AUTH_TIMEOUT_MS,
          'This is taking longer than usual. Please try again.',
        )
        if (newSession) {
          toast.success('Your account is ready. You are all set!')
          return
        }
        setPendingVerificationEmail(trimmedEmail)
        setOtpContext('signup')
        setVerificationPhase('otp')
        setVerificationCode('')
        setOtpError('')
        setResendCooldown(RESEND_COOLDOWN_SEC)
        toast.success('We emailed you an 8-digit code. Enter it below to finish creating your account.')
      }
    } catch (error) {
      const message = (error as Error).message || ''
      if (message.toLowerCase().includes('email not confirmed')) {
        setPendingVerificationEmail(trimmedEmail)
        setOtpContext('signup')
        setVerificationPhase('otp')
        setVerificationCode('')
        setOtpError('')
        setResendCooldown(RESEND_COOLDOWN_SEC)
        toast.info('Confirm your email', {
          description: 'Enter the 8-digit code we sent you to finish signing in.',
        })
      } else if (mode === 'signup' && (message.toLowerCase().includes('already registered') || message.toLowerCase().includes('already been registered'))) {
        setEmailError('That email already has an account. Try logging in instead.')
      } else if (mode === 'login' && message.toLowerCase().includes('invalid login credentials')) {
        setFormError('That email or password does not match our records. Please try again.')
      } else if (mode === 'signup' && message.toLowerCase().includes('password should be at least')) {
        setPasswordError('Use at least 8 characters so your account stays secure.')
      } else if (isLikelyTimeoutMessage(message)) {
        setFormError('This is taking longer than usual. Check your connection and try again.')
      } else {
        setFormError(mapAuthError(error))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const onResendCode = async () => {
    const target = pendingVerificationEmail || email.trim().toLowerCase()
    if (!target) return
    setResending(true)
    try {
      if (otpContext === 'recovery') {
        await withTimeout(
          requestPasswordRecovery(target),
          AUTH_TIMEOUT_MS,
          'This is taking longer than usual. Please try again.',
        )
      } else {
        await withTimeout(
          resendConfirmation(target),
          AUTH_TIMEOUT_MS,
          'This is taking longer than usual. Please try again.',
        )
      }
      toast.success('A fresh code is on its way. Please check your inbox (and spam folder).')
      setResendCooldown(RESEND_COOLDOWN_SEC)
    } catch (error) {
      const message = (error as Error).message || ''
      if (isLikelyTimeoutMessage(message)) {
        toast.error('This is taking longer than usual. Check your connection and try again.')
      } else {
        toast.error(mapAuthError(error))
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
      if (otpContext === 'recovery') {
        await withTimeout(
          verifyRecoveryOtp(target, verificationCode),
          AUTH_TIMEOUT_MS,
          'This is taking longer than usual. Please try again.',
        )
        setAwaitingNewPassword(true)
        setVerificationPhase('new_password')
        setVerificationCode('')
        setResendCooldown(0)
        toast.success('Code accepted. Choose a new password below.')
      } else {
        await withTimeout(
          verifySignupOtp(target, verificationCode),
          AUTH_TIMEOUT_MS,
          'This is taking longer than usual. Please try again.',
        )
        toast.success('Your email is confirmed. You are signed in!')
        setVerificationPhase('none')
        setVerificationCode('')
        setPendingVerificationEmail('')
        setResendCooldown(0)
        setOtpContext(null)
      }
    } catch (error) {
      setOtpError(mapAuthError(error))
    } finally {
      setOtpSubmitting(false)
    }
  }

  const onSubmitNewPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setResetPwError('')
    if (newPassword.length < 8) {
      setResetPwError('Use at least 8 characters so your account stays secure.')
      return
    }
    if (newPassword !== confirmNewPassword) {
      setResetPwError('Those passwords do not match. Please type the same password twice.')
      return
    }
    setResetPwSubmitting(true)
    try {
      await withTimeout(
        updatePassword(newPassword),
        AUTH_TIMEOUT_MS,
        'This is taking longer than usual. Please try again.',
      )
      setAwaitingNewPassword(false)
      setVerificationPhase('none')
      setNewPassword('')
      setConfirmNewPassword('')
      setOtpContext(null)
      setPendingVerificationEmail('')
      toast.success('Your password was updated. Continuing…')
    } catch (error) {
      setResetPwError(mapAuthError(error))
    } finally {
      setResetPwSubmitting(false)
    }
  }

  const onCancelVerification = () => {
    setVerificationPhase('none')
    setVerificationCode('')
    setOtpError('')
    setPendingVerificationEmail('')
    setResendCooldown(0)
    setOtpContext(null)
  }

  const onAbandonPasswordReset = async () => {
    try {
      await logout()
    } catch {
      /* ignore */
    }
    setAwaitingNewPassword(false)
    setVerificationPhase('none')
    setNewPassword('')
    setConfirmNewPassword('')
    setResetPwError('')
    setOtpContext(null)
    setPendingVerificationEmail('')
  }

  const otpDigitCount = verificationCode.replace(/\D/g, '').length
  const otpVerifyDisabled = otpSubmitting || otpDigitCount < OTP_CODE_LENGTH

  const resendLabel = resending ? 'Sending…' : resendCooldown > 0 ? `Resend (${resendCooldown}s)` : 'Resend code'

  let heading: string
  let subheading: string
  if (verificationPhase === 'new_password') {
    heading = 'Choose a new password'
    subheading = 'Pick something you have not used here before, at least 8 characters.'
  } else if (verificationPhase === 'otp') {
    if (otpContext === 'recovery') {
      heading = 'Reset your password'
      subheading = 'Enter the 8-digit code from the password-reset email we sent you.'
    } else {
      heading = 'Verify your email'
      subheading = 'Enter the 8-digit code from the email we sent you.'
    }
  } else if (mode === 'login') {
    heading = 'Welcome back'
    subheading = 'Log in to continue your registration.'
  } else {
    heading = 'Create your account'
    subheading = 'Create your account to register for the event.'
  }

  return (
    <section className="relative flex min-h-svh items-center justify-center overflow-hidden bg-slate-50 px-4 py-10 text-slate-900 sm:px-6">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-sky-200/45 blur-3xl" />
        <div className="absolute -bottom-20 -right-16 h-96 w-96 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 rounded-full bg-violet-100/30 blur-3xl" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-md">
        <div className="rounded-2xl border border-slate-200/90 bg-white/95 p-6 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.25)] backdrop-blur-sm sm:p-8">
          {showBrandingHeader ? (
            <div className="mb-6 space-y-2 text-center">
              <div className="flex justify-center">
                <img
                  src="/all_out_multisports.png"
                  alt="All Out Multisports"
                  className="h-14 w-auto sm:h-16"
                  loading="eager"
                  decoding="async"
                />
              </div>
              <p className="text-sm font-medium text-slate-600">All Out Multisports</p>
            </div>
          ) : null}

          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">{heading}</h1>
            <p className="text-sm text-slate-600">{subheading}</p>
          </div>

          <div className="mt-6">
            {verificationPhase === 'otp' ? (
              <div className="space-y-5">
                <p className="text-center text-sm text-slate-700">
                  Code sent to{' '}
                  <span className="font-semibold break-all text-slate-900">
                    {pendingVerificationEmail || email.trim() || 'your email'}
                  </span>
                </p>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-900" htmlFor="otp-code">
                    {otpContext === 'recovery' ? 'Reset code' : 'Verification code'}
                  </label>
                  <input
                    id="otp-code"
                    value={verificationCode}
                    onChange={(event) => {
                      setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, OTP_CODE_LENGTH))
                      setOtpError('')
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="00000000"
                    maxLength={OTP_CODE_LENGTH}
                    title="Enter the 8-digit code from your email."
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center font-mono text-lg tracking-[0.35em] text-slate-900 shadow-inner outline-none ring-[#cfae3f]/0 transition focus:border-[#cfae3f] focus:ring-2 focus:ring-[#cfae3f]/30"
                  />
                </div>
                {otpError ? <p className="text-sm text-rose-600">{otpError}</p> : null}
                <button
                  type="button"
                  onClick={() => void onVerifyOtp()}
                  disabled={otpVerifyDisabled}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-[#cfae3f] px-5 py-3 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-[#dab852] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {otpSubmitting
                    ? 'Please wait…'
                    : otpContext === 'recovery'
                      ? 'Continue'
                      : 'Verify and continue'}
                </button>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                  <button
                    type="button"
                    onClick={() => void onResendCode()}
                    disabled={resending || resendCooldown > 0}
                    className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resendLabel}
                  </button>
                  <button
                    type="button"
                    onClick={onCancelVerification}
                    className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : verificationPhase === 'new_password' ? (
              <form className="space-y-5" onSubmit={(event) => void onSubmitNewPassword(event)}>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-900" htmlFor="new-password">
                    New password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                    <input
                      id="new-password"
                      value={newPassword}
                      onChange={(event) => {
                        setNewPassword(event.target.value)
                        setResetPwError('')
                      }}
                      type={showNewPassword ? 'text' : 'password'}
                      minLength={8}
                      autoComplete="new-password"
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-12 text-sm text-slate-900 shadow-inner outline-none transition focus:border-[#cfae3f] focus:ring-2 focus:ring-[#cfae3f]/25"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((prev) => !prev)}
                      className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                    >
                      {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-900" htmlFor="confirm-new-password">
                    Confirm new password
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                    <input
                      id="confirm-new-password"
                      value={confirmNewPassword}
                      onChange={(event) => {
                        setConfirmNewPassword(event.target.value)
                        setResetPwError('')
                      }}
                      type={showNewPassword ? 'text' : 'password'}
                      minLength={8}
                      autoComplete="new-password"
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm text-slate-900 shadow-inner outline-none transition focus:border-[#cfae3f] focus:ring-2 focus:ring-[#cfae3f]/25"
                    />
                  </div>
                </div>
                {resetPwError ? <p className="text-sm text-rose-600">{resetPwError}</p> : null}
                <button
                  type="submit"
                  disabled={resetPwSubmitting}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-[#cfae3f] px-5 py-3 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-[#dab852] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resetPwSubmitting ? 'Please wait…' : 'Save new password'}
                </button>
                <button
                  type="button"
                  onClick={() => void onAbandonPasswordReset()}
                  className="inline-flex w-full items-center justify-center rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Cancel and return to login
                </button>
              </form>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => applyTabReset('login')}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                      mode === 'login'
                        ? 'bg-white text-[#1e4a8e] shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <User className="h-4 w-4 shrink-0" aria-hidden />
                    Login
                  </button>
                  <button
                    type="button"
                    onClick={() => applyTabReset('signup')}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                      mode === 'signup'
                        ? 'bg-white text-[#1e4a8e] shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <UserPlus className="h-4 w-4 shrink-0" aria-hidden />
                    Create account
                  </button>
                </div>

                <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
                  {mode === 'signup' && (
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-900" htmlFor="full-name">
                        Full name
                      </label>
                      <div className="relative">
                        <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                        <input
                          id="full-name"
                          value={fullName}
                          onChange={(event) => setFullName(event.target.value)}
                          placeholder="Juan Dela Cruz"
                          required
                          className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm text-slate-900 shadow-inner outline-none transition focus:border-[#cfae3f] focus:ring-2 focus:ring-[#cfae3f]/25"
                        />
                      </div>
                      {fullNameError ? <p className="text-xs text-rose-600">{fullNameError}</p> : null}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-900" htmlFor="email">
                      Email
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
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
                        className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm text-slate-900 shadow-inner outline-none transition focus:border-[#cfae3f] focus:ring-2 focus:ring-[#cfae3f]/25"
                      />
                    </div>
                    {emailError ? <p className="text-xs text-rose-600">{emailError}</p> : null}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-900" htmlFor="password">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
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
                        className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-12 text-sm text-slate-900 shadow-inner outline-none transition focus:border-[#cfae3f] focus:ring-2 focus:ring-[#cfae3f]/25"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {passwordError ? <p className="text-xs text-rose-600">{passwordError}</p> : null}
                  </div>

                  {mode === 'login' ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <label className="inline-flex cursor-pointer items-center gap-2 text-slate-700">
                        <input
                          type="checkbox"
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-[#1e4a8e] focus:ring-[#1e4a8e]"
                        />
                        Remember me
                      </label>
                      <button
                        type="button"
                        onClick={() => void onForgotPassword()}
                        disabled={forgotSending}
                        className="font-semibold text-[#1e4a8e] hover:underline disabled:opacity-50"
                      >
                        {forgotSending ? 'Sending…' : 'Forgot password?'}
                      </button>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(e) => {
                          setAcceptedTerms(e.target.checked)
                          setFormError('')
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[#1e4a8e] focus:ring-[#1e4a8e]"
                      />
                      <span>
                        I agree to the{' '}
                        <Link to="/terms" className="font-semibold text-[#1e4a8e] hover:underline">
                          Terms of Service
                        </Link>{' '}
                        and{' '}
                        <Link to="/privacy" className="font-semibold text-[#1e4a8e] hover:underline">
                          Privacy Policy
                        </Link>
                        .
                      </span>
                    </label>
                  )}

                  {formError ? <p className="text-sm text-rose-600">{formError}</p> : null}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex w-full items-center justify-center rounded-xl bg-[#cfae3f] px-5 py-3 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-[#dab852] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? 'Please wait…' : mode === 'login' ? 'Login' : 'Create account'}
                  </button>
                </form>
              </>
            )}
          </div>

          <div className="mt-8 text-center text-sm">
            <Link to="/" className="font-semibold text-[#1e4a8e] hover:underline">
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
