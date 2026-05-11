import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  registrationService,
  type CheckoutItem,
  clearRegistrationCheckoutPayload,
  loadRegistrationCheckoutPayload,
  resolveCheckoutLines,
  type RegistrationCheckoutPayload,
} from '../../services/registrationService'

// ─── Step config ──────────────────────────────────────────────────────────────

const STEPS = [
  {
    key: 'waiver' as const,
    title: 'Accident Waiver and Release of Liability',
    content: (
      <div className="space-y-3 text-sm leading-relaxed text-slate-700">
        <p>
          I understand and agree that I am voluntarily participating in the{' '}
          <strong>HARI NG AHON</strong> and all of its activities including but
          not limited to training for and participating in any of its events. I
          acknowledge that this athletic event is an extreme test of a person's
          physical and mental limits and carries with it a potential for property
          loss, serious injury and death.
        </p>
        <p>
          The risks include, but are not limited to those caused by terrain,
          facilities, temperature, weather, condition of athletes, equipment,
          actions of other people including but not limited to participants,
          volunteers, spectators, coaches, event officials, and event monitors,
          and/or producers of the event. These risks are not only inherent to
          athletes, but are also present on the part of the persons or entities
          being released, from dangerous or defective equipment or property
          owned, maintained or controlled by them or because of their possible
          liability without fault.
        </p>
        <p>
          I certify that I am physically fit, have sufficiently trained for
          participation in the event and have not been advised otherwise by a
          qualified medical person to not participate in such activities.
        </p>
        <p>
          I understand that at this event or related activities, I may be
          photographed. I agree to allow my photo, video or film to be used for
          any legitimate purpose by the event holders, producers, sponsors,
          organizers and/or assigns.
        </p>
        <p>
          I acknowledge that this Accident Waiver and Release of Liability form
          will be used by the event holders, sponsors and organizers for the
          event in which I participate and that it will cover my actions and
          responsibilities at said events.
        </p>
        <p>
          I, in consideration of and as a condition of acceptance of this entry
          for myself, my executors, administrators, heirs, next of kin,
          successors and assigns hereby waive, release and discharge the event
          organizers, sponsors, or volunteers from all claims, actions or
          damages that the former may have against the latter however caused,
          arising out of or in any way connected with my participation in this
          event.
        </p>
        <p>
          This AWRL shall be construed broadly to provide a waiver to the
          maximum extent permissible under applicable law.
        </p>
        <p>
          By submitting this registration form, I confirm that I am at least 18
          years old or have obtained permission from my parents or legal guardian
          to participate in this event.
        </p>
      </div>
    ),
  },
 {
    key: 'rules' as const,
    title: 'Race Rules',
    content: (
      <div className="space-y-6 text-sm leading-relaxed text-slate-700">
        <p>
          These rules are intended to promote sportsmanship, equality, and fair
          play, while prioritizing the safety of all participants. Any
          participant who gains an unfair advantage, violates these rules, or
          compromises safety may be penalized or disqualified.
        </p>

        <hr className="border-slate-200" />

        {/* A) General Conduct */}
        <div className="space-y-2">
          <p className="font-bold text-slate-900">A) General Conduct</p>
          <p>All participants:</p>
          <ol className="list-decimal space-y-2 pl-6">
            <li>Must practice good sportsmanship at all times and be responsible for their own safety and that of others.</li>
            <li>Should know, understand, and follow all published Race Rules.</li>
            <li>Must obey the instructions of race officials, marshals, and law enforcement.</li>
            <li>The race route may be closed to traffic, but riders must remain alert, especially in technical sections, sharp turns, and descents.</li>
            <li>Must treat fellow participants, officials, volunteers, and spectators with respect and courtesy.</li>
            <li>Must avoid using abusive or offensive language.</li>
            <li>Must inform a race official immediately if withdrawing from the race.</li>
            <li>Must complete the <strong>entire official race route</strong> without receiving outside assistance except from authorized race personnel.</li>
            <li>Must allow faster riders to pass without obstruction.</li>
            <li>Glass containers are not permitted on or near the course.</li>
          </ol>
        </div>

        <hr className="border-slate-200" />

        {/* B) Equipment */}
        <div className="space-y-2">
          <p className="font-bold text-slate-900">B) Equipment</p>
          <ol className="list-decimal space-y-2 pl-6">
            <li>Only <strong>human-powered bicycles</strong> in safe and working condition are allowed.</li>
            <li>All bicycles must have functional <strong>front and rear brakes</strong>.</li>
            <li>Minimum tire width for mountain bikes is <strong>1.90 inches</strong> (if applicable).</li>
            <li>Riders must wear an <strong>approved helmet</strong> at all times while on the course. Failure to do so will result in immediate disqualification.</li>
          </ol>
        </div>

        <hr className="border-slate-200" />

        {/* C) Health & Safety */}
        <div className="space-y-2">
          <p className="font-bold text-slate-900">C) Health &amp; Safety</p>
          <ol className="list-decimal space-y-2 pl-6">
            <li>Participants acknowledge that cycling events are physically demanding and must be in good health to participate.</li>
            <li>By registering, participants declare that they are physically capable of completing the event.</li>
            <li>A pre-event health check is strongly encouraged, especially for competitive races.</li>
          </ol>
        </div>

        <hr className="border-slate-200" />

        {/* D) Eligibility */}
        <div className="space-y-2">
          <p className="font-bold text-slate-900">D) Eligibility</p>
          <ol className="list-decimal space-y-2 pl-6">
            <li>
              Age category is determined by the participant's age on <strong>December 31</strong> of the race year.
              <ul className="mt-1 list-[circle] space-y-1 pl-6">
                <li>Example: Race Year – Birth Year = Age Category</li>
              </ul>
            </li>
            <li>Minors must submit <strong>parent/guardian consent</strong>.</li>
            <li>Entering a category outside your correct age group will result in disqualification.</li>
            <li>Race registrations are <strong>non-transferable</strong>. Anyone caught using another person's registration will be disqualified and may be banned from future events.</li>
            <li>Any misrepresentation of identity or details will result in <strong>immediate disqualification</strong> and forfeiture of awards/titles.</li>
          </ol>
        </div>

        <hr className="border-slate-200" />

        {/* E) Race Kit Claiming */}
        <div className="space-y-2">
          <p className="font-bold text-slate-900">E) Race Kit Claiming</p>
          <ol className="list-decimal space-y-2 pl-6">
            <li>A <strong>valid ID or Birth Certificate</strong> is required to claim a race kit.</li>
            <li>Participants must claim their own kits at the designated place and time.</li>
            <li>
              Authorized representatives must present:
              <ul className="mt-1 list-[circle] space-y-1 pl-6">
                <li>The participant's valid ID</li>
                <li>Signed authorization letter from the participant</li>
                <li>Representative's valid ID</li>
              </ul>
            </li>
          </ol>
        </div>

        <hr className="border-slate-200" />

        {/* F) Prohibited Equipment */}
        <div className="space-y-2">
          <p className="font-bold text-slate-900">F) Prohibited Equipment</p>
          <p>The following are <strong>not allowed</strong> during the race:</p>
          <ul className="list-[circle] space-y-1 pl-6">
            <li>Headphones, headsets, or any listening devices</li>
            <li>Aerobars / Tri-bars (unless explicitly allowed)</li>
          </ul>
        </div>

        <hr className="border-slate-200" />

        {/* G) Outside Assistance */}
        <div className="space-y-2">
          <p className="font-bold text-slate-900">G) Outside Assistance</p>
          <p>No outside assistance is allowed except from official race personnel or aid stations.</p>
        </div>

        <hr className="border-slate-200" />

        {/* H) Protests */}
        <div className="space-y-2">
          <p className="font-bold text-slate-900">H) Protests</p>
          <ol className="list-decimal space-y-2 pl-6">
            <li>Protests on eligibility must be made to the Race Organizer <strong>on the day of the event</strong>.</li>
            <li>Protests on results/timing must be submitted <strong>in writing within three (3) days</strong> after the race.</li>
            <li>A protest must be accompanied by a <strong>₱2,000 deposit</strong>, refundable if upheld. If denied, the deposit is forfeited.</li>
            <li>
              Protests must include:
              <ul className="mt-1 list-[circle] space-y-1 pl-6">
                <li>The alleged rule violation</li>
                <li>Location &amp; time of incident</li>
                <li>Names of persons involved</li>
                <li>Statement or diagram of the incident</li>
                <li>Names of witnesses (if any)</li>
                <li>Proof or supporting documents (photos/videos if available)</li>
              </ul>
            </li>
          </ol>
        </div>

        <hr className="border-slate-200" />

        {/* I) Event Changes, Cancellation, and Refunds */}
        <div className="space-y-2">
          <p className="font-bold text-slate-900">I) Event Changes, Cancellation, and Refunds</p>
          <ol className="list-decimal space-y-2 pl-6">
            <li>The Organizer may, at its sole discretion, modify, postpone, or cancel the event at any time.</li>
            <li>Changes may include, but are not limited to, adjustments to the race route, distance, schedule, categories, rules, or other event details.</li>
            <li>Such changes may be made without prior notice and may occur due to safety concerns, adverse weather, government regulations, force majeure, or other circumstances beyond the Organizer's control.</li>
            <li>In the event of modification, postponement, or cancellation, the Organizer shall not be liable for any loss, cost, or expense incurred by participants.</li>
            <li>All entry fees are <strong>non-refundable</strong>, and no credits or transfers will be issued, unless the Organizer decides otherwise at its sole discretion.</li>
          </ol>
        </div>
      </div>
    ),
  },
]

// ─── Modal ────────────────────────────────────────────────────────────────────

interface StepModalProps {
  step: (typeof STEPS)[number]
  stepNumber: number
  totalSteps: number
  onAgree: () => void
  onClose: () => void
}

function StepModal({ step, stepNumber, totalSteps, onAgree, onClose }: StepModalProps) {
  const [canAgree, setCanAgree] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const handleScroll = () => {
    if (canAgree) return
    const el = bodyRef.current
    if (!el) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      setCanAgree(true)
    }
  }

  const isLastStep = stepNumber === totalSteps

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p className="mb-0.5 text-xs text-slate-400">Step {stepNumber} of {totalSteps}</p>
            <h2 className="text-base font-semibold text-slate-900">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          ref={bodyRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-5 py-4"
        >
          {step.content}
          <div className="h-2" />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <p className="text-xs text-slate-400">
            {canAgree ? '✓ You have read this document.' : 'Scroll to the bottom to continue.'}
          </p>
          <button
            type="button"
            onClick={onAgree}
            disabled={!canAgree}
            className="rounded-md bg-[#cfae3f] px-4 py-2 text-sm font-semibold text-black transition hover:bg-[#dab852] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLastStep ? 'I agree to both' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function RegistrationPayment() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const registrationId = params.get('registrationId')
  const paymentState = params.get('payment')

  // null = closed, 0 = waiver modal, 1 = rules modal
  const [modalStep, setModalStep] = useState<number | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkoutPayload, setCheckoutPayload] = useState<RegistrationCheckoutPayload | null>(null)
  const [checkoutItem, setCheckoutItem] = useState<CheckoutItem | null>(null)

  const activeRegistrationId = registrationId

  const checkoutLineCount =
    checkoutItem?.lineItemCount ??
    Math.max(resolveCheckoutLines(checkoutPayload).length, checkoutPayload?.eventEntries?.length ?? 1, 1)

  const checkoutAmount = useMemo(() => {
    const itemAmt = checkoutItem?.amount
    if (typeof itemAmt === 'number' && Number.isFinite(itemAmt) && itemAmt > 0) return itemAmt

    const p = checkoutPayload
    if (!p) return 1
    const total = Number(p.registrationFeeTotal)
    if (Number.isFinite(total) && total > 0) return total
    const per = Number(p.registrationFeePerEntry)
    const n = Math.max(resolveCheckoutLines(p).length, p.eventEntries?.length ?? 1, 1)
    if (Number.isFinite(per) && per > 0) return per * n
    return 1
  }, [checkoutItem, checkoutPayload])

  const checkoutEventTitle =
    checkoutItem?.eventTitle ?? checkoutPayload?.eventTitle ?? 'Event Registration'

  const checkoutRaceType = useMemo(() => {
    if (checkoutItem?.raceType?.trim()) return checkoutItem.raceType
    const p = checkoutPayload
    const fromEntries = p?.eventEntries?.map((e) => String(e.label ?? '').trim()).filter(Boolean).join(', ')
    if (fromEntries) return fromEntries
    const rt = p?.raceType ? String(p.raceType).trim() : ''
    return rt || p?.raceTypeLabel || '-'
  }, [checkoutItem, checkoutPayload])

  const merchantReference = useMemo(
    () => `HNA-${activeRegistrationId ?? 'NA'}-${Date.now()}`,
    [activeRegistrationId],
  )

  useEffect(() => {
    if (registrationId) {
      clearRegistrationCheckoutPayload()
      setCheckoutPayload(null)
      return
    }
    setCheckoutPayload(loadRegistrationCheckoutPayload())
  }, [registrationId])

  useEffect(() => {
    if (!activeRegistrationId) {
      setCheckoutItem(null)
      return
    }
    let mounted = true
    void registrationService
      .getCheckoutItem(activeRegistrationId)
      .then((item) => {
        if (!mounted) return
        setCheckoutItem(item)
      })
      .catch(() => {
        if (!mounted) return
        setCheckoutItem(null)
      })
    return () => {
      mounted = false
    }
  }, [activeRegistrationId])

  useEffect(() => {
    if (!paymentState) return
    if (paymentState === 'success') {
      const next = registrationId
        ? `/register/payment-success?registrationId=${encodeURIComponent(registrationId)}`
        : '/register/payment-success'
      const timer = window.setTimeout(() => {
        void navigate(next, { replace: true })
      }, 1800)
      return () => window.clearTimeout(timer)
    }
  }, [navigate, paymentState, registrationId])

  // Guard: if this registrationId is already confirmed/paid, redirect to the success page
  useEffect(() => {
    if (!registrationId || paymentState) return
    let cancelled = false
    void (async () => {
      try {
        const { data } = await supabase
          .from('registration_forms')
          .select('status')
          .eq('id', registrationId)
          .maybeSingle()
        if (cancelled) return
        const status = String(data?.status ?? '').toLowerCase()
        if (status === 'confirmed' || status === 'paid') {
          void navigate(
            `/register/payment-success?registrationId=${encodeURIComponent(registrationId)}`,
            { replace: true },
          )
        }
      } catch {
        /* ignore — let the user see the payment page */
      }
    })()
    return () => { cancelled = true }
  }, [navigate, registrationId, paymentState])

  const handleCheckboxClick = () => {
    if (agreed) {
      setAgreed(false)
    } else {
      setModalStep(0)
    }
  }

  const handleStepAgree = () => {
    const nextStep = (modalStep ?? 0) + 1
    if (nextStep < STEPS.length) {
      setModalStep(nextStep)
    } else {
      setModalStep(null)
      setAgreed(true)
    }
  }

  const onSubmit = async () => {
    setError(null)
    if (!agreed) {
      setError('Please accept the Agreement and Liability Waiver and Race Rules.')
      return
    }
    const payloadHydrated = checkoutPayload ?? loadRegistrationCheckoutPayload()
    let regId = activeRegistrationId ?? ''
    if (!regId && !payloadHydrated) {
      setError('Your checkout session expired. Please go back to the registration form and submit again.')
      return
    }
    setSubmitting(true)
    try {
      let paymentAmount = checkoutAmount

      if (!regId) {
        const normalized = loadRegistrationCheckoutPayload() ?? checkoutPayload ?? payloadHydrated
        if (!normalized) throw new Error('Checkout session expired.')
        const lines = resolveCheckoutLines(normalized)
        if (lines.length === 0) {
          throw new Error('Checkout has no registration lines. Return to the form and select event type(s) and category(ies).')
        }
        const n = lines.length
        let perEntry = Number(normalized.registrationFeePerEntry)
        if (!(perEntry > 0)) perEntry = n > 0 ? Number(normalized.registrationFeeTotal) / n : 1
        if (!(perEntry > 0)) perEntry = 1
        const totalDeclared = Number(normalized.registrationFeeTotal)
        paymentAmount = Number.isFinite(totalDeclared) && totalDeclared > 0 ? totalDeclared : perEntry * n

        let primaryId = ''
        const bundleId = normalized.checkoutBundleId
        for (const line of lines) {
          const slugRaw = line.slug?.trim()
          const slug = slugRaw ? slugRaw : null
          const label =
            line.label?.trim() ||
            String(normalized.raceType ?? normalized.raceTypeLabel ?? '').trim() ||
            'Event'
          const ageCategoryForLine =
            String(line.categoryName ?? '').trim() || String(normalized.rider.ageCategory ?? '').trim() || ''
          const { registrationId: newId } = await registrationService.createRegistration({
            raceType: label,
            eventId: normalized.eventId,
            raceCategoryId: line.raceCategoryId,
            registrantEmail: normalized.registrantEmail,
            registrationFee: perEntry,
            checkoutBundleId: bundleId,
            entryEventTypeSlug: slug,
            entryEventTypeLabel: label,
            rider: { ...normalized.rider, ageCategory: ageCategoryForLine },
          })
          if (!primaryId) primaryId = newId
        }
        regId = primaryId
        clearRegistrationCheckoutPayload()
        setCheckoutPayload(null)
        void navigate(`/register/payment?registrationId=${encodeURIComponent(regId)}`, { replace: true })
      }

      const payment = await registrationService.createPaymentOrder({
        registrationId: regId,
        amount: paymentAmount,
        merchantReference,
        acceptLiability: true,
        acceptRules: true,
      })
      if (!payment.checkoutUrl) throw new Error('Missing checkout URL from payment provider.')
      const cs = String(payment.checkoutSessionId ?? '').trim()
      if (cs) {
        try {
          sessionStorage.setItem('paymongo_checkout_session', cs)
        } catch {
          /* ignore quota / private mode */
        }
      }
      window.location.assign(payment.checkoutUrl)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <section className="bg-white px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-[760px] space-y-6">
          {!activeRegistrationId && !checkoutPayload ? (
           <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Looks like you landed here directly.{' '}
          <Link to="/register/info" className="font-semibold underline">
            Start your registration here
          </Link>{' '}
          to fill in your details first.
        </div>
          ) : null}
          {paymentState === 'cancelled' ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Payment was cancelled. You can close this and try again when you're ready.
            </div>
          ) : null}
          {paymentState === 'failed' ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              Something went wrong with your payment. Please try again or use a different card or payment method.
            </div>
          ) : null}
          {paymentState === 'success' ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
             Payment received! Taking you to your confirmation page…
            </div>
          ) : null}
          {/* Heading */}
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Payment</h1>
            <p className="text-sm text-slate-600">Complete payment to confirm your registration.</p>
          </div>

          {/* Item checkout */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Item Checkout</h2>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                {checkoutLineCount} item{checkoutLineCount === 1 ? '' : 's'}
              </span>
            </div>
            <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Registration Fee</p>
                  <p className="text-sm text-slate-600">{checkoutEventTitle}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{checkoutRaceType}</p>
                </div>
                <p className="text-base font-semibold text-slate-900">₱{checkoutAmount.toFixed(2)}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
              <div className="flex items-center justify-between text-slate-600">
                <p>Subtotal</p>
                <p>₱{checkoutAmount.toFixed(2)}</p>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <p>Processing Fee</p>
                <p>₱0.00</p>
              </div>
              <div className="flex items-center justify-between pt-1 text-base font-semibold text-slate-900">
                <p>Total</p>
                <p>₱{checkoutAmount.toFixed(2)}</p>
              </div>
            </div>
          </div>

          {/* Checkout info */}
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Secure checkout</h2>
           <p className="text-sm text-slate-600">
            You'll be taken to our secure payment page to complete your registration.
            Once payment is confirmed, you'll receive a confirmation email shortly after.
          </p>
          </div>

          {/* Agree row — matches original design exactly */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-800">
              Please read{' '}
              <button
                type="button"
                onClick={() => setModalStep(0)}
                className="text-green-700 underline underline-offset-2 hover:text-green-900"
              >
                Agreement and Liability Waiver
              </button>
              , as well as the{' '}
              <button
                type="button"
                onClick={() => setModalStep(1)}
                className="text-green-700 underline underline-offset-2 hover:text-green-900"
              >
                Race Rules
              </button>
              . <span className="text-rose-500">*</span>
            </p>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-800 transition hover:border-slate-300">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-green-600"
                checked={agreed}
                onChange={handleCheckboxClick}
              />
              <span>I have read and agree to the Agreement and Liability Waiver and Race Rules.</span>
            </label>
          </div>

          {/* Error */}
          {error && <p className="text-sm text-rose-600">{error}</p>}

          {/* Submit */}
          <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#cfae3f] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#dab852] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <>
              <svg
                className="h-4 w-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12" cy="12" r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Redirecting to PayMongo…
            </>
          ) : (
            'Proceed to PayMongo'
          )}
        </button>
        </div>
      </section>

      {/* Sequential step modals */}
      {modalStep !== null && (
        <StepModal
          key={modalStep}
          step={STEPS[modalStep]}
          stepNumber={modalStep + 1}
          totalSteps={STEPS.length}
          onAgree={handleStepAgree}
          onClose={() => setModalStep(null)}
        />
      )}
    </>
  )
}