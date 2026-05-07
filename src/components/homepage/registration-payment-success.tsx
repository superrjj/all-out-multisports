import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { registrationService, reloadPageIfSessionExpiredInvokeError, type RegistrationCertificateData } from '../../services/registrationService'
import { renderCertificateToDataUrl as renderSharedCertificateToDataUrl } from '../../utils/adminCertificate'

const CERT_BUCKET = String(import.meta.env.VITE_CERT_BUCKET ?? '').trim()

function certObjectPath(registrationId: string, bibNumber: string) {
  const safeBib = String(bibNumber ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
  const safeReg = String(registrationId ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
  return `race-claim-kit/${safeReg || 'reg'}-${safeBib || 'bib'}.png`
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return await res.blob()
}

export function RegistrationPaymentSuccess() {
  const [params] = useSearchParams()
  const registrationId = params.get('registrationId')
  const { session, loading: authLoading } = useAuth()
  const [loading, setLoading] = useState(Boolean(registrationId))
  const [error, setError] = useState<string | null>(null)
  const [certificateData, setCertificateData] = useState<RegistrationCertificateData | null>(null)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [bundleCertificatePreviewUrls, setBundleCertificatePreviewUrls] = useState<
    Record<string, string | null>
  >({})
  const [autoEmailMessage, setAutoEmailMessage] = useState<string | null>(null)
  const [storageUploadMessage, setStorageUploadMessage] = useState<string | null>(null)
  const [needsLoginToFinalize, setNeedsLoginToFinalize] = useState(false)
  /** Every registration line in this checkout (same order as DB); previews keyed by registrationId */
  const [bundleCertificateRows, setBundleCertificateRows] = useState<
    Array<{ registrationId: string; data: RegistrationCertificateData }>
  >([])

  /** Prevents duplicate Resend calls when React Strict Mode runs the effect twice or deps settle twice before localStorage updates. */
  const certEmailInvokeLockRef = useRef(false)

  const uploadCertificatePngToStorage = useCallback(
    async (rid: string, dataUrl: string, bibNumber: string) => {
      if (!CERT_BUCKET) throw new Error('Missing VITE_CERT_BUCKET (certificate storage bucket name).')
      const blob = await dataUrlToBlob(dataUrl)
      const path = certObjectPath(rid, bibNumber)
      const { error } = await supabase.storage.from(CERT_BUCKET).upload(path, blob, {
        upsert: true,
        contentType: 'image/png',
        cacheControl: '31536000',
      })
      if (error) throw error
    },
    [],
  )

  const renderCertificateToDataUrl = useCallback(
    async (data: RegistrationCertificateData, mimeType: 'image/png' | 'image/jpeg') => {
      return await renderSharedCertificateToDataUrl(
        {
          riderName: data.riderName,
          category: data.category,
          discipline: data.discipline,
          eventType: data.eventType,
          bibNumber: data.bibNumber,
          eventTitle: data.eventTitle,
          verificationId: data.verificationId,
          qrValue: data.qrValue,
        },
        mimeType,
      )
    },
    [],
  )

  const fetchCertificateData = useCallback(async () => {
    if (!registrationId) {
      setLoading(false)
      return
    }
    setError(null)
    setLoading(true)
    try {
      const data = await registrationService.getRegistrationCertificateData(registrationId)
      if (!data) throw new Error('Registration record not found.')
      setCertificateData(data)
    } catch (e) {
      setError((e as Error).message || 'Unable to load payment status.')
    } finally {
      setLoading(false)
    }
  }, [registrationId])

  useEffect(() => {
    if (!registrationId) {
      setBundleCertificateRows([])
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const ids = await registrationService.listCheckoutBundleRegistrationIds(registrationId)
        const rows = (
          await Promise.all(
            ids.map(async (id) => {
              const certData = await registrationService.getRegistrationCertificateData(id)
              return certData ? { registrationId: id, data: certData } : null
            }),
          )
        ).filter(Boolean) as Array<{ registrationId: string; data: RegistrationCertificateData }>
        if (!cancelled) setBundleCertificateRows(rows)
      } catch {
        if (!cancelled) setBundleCertificateRows([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [registrationId, certificateData])

  useEffect(() => {
    let mounted = true
    async function init() {
      if (!registrationId) {
        await fetchCertificateData()
        return
      }
      if (authLoading) return

      if (!session?.access_token) {
        setNeedsLoginToFinalize(true)
        await fetchCertificateData()
        return
      }

      setNeedsLoginToFinalize(false)
      try {
        let checkoutSessionId: string | undefined
        try {
          checkoutSessionId = sessionStorage.getItem('paymongo_checkout_session')?.trim() || undefined
        } catch {
          checkoutSessionId = undefined
        }
        const bundleIds = await registrationService.listCheckoutBundleRegistrationIds(registrationId)
        for (const regId of bundleIds) {
          await registrationService.markRegistrationAsPaidAfterPaymongoRedirect(regId, { checkoutSessionId })
        }
        if (checkoutSessionId) {
          try {
            sessionStorage.removeItem('paymongo_checkout_session')
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        if (mounted) {
          setError((e as Error).message || 'Failed to sync payment status.')
        }
      } finally {
        if (mounted) await fetchCertificateData()
      }
    }
    void init()
    return () => {
      mounted = false
    }
  }, [authLoading, fetchCertificateData, registrationId, session?.access_token])

  const handleDownload = useCallback(
    async (mimeType: 'image/png' | 'image/jpeg') => {
      if (!certificateData) return
      const url = await renderCertificateToDataUrl(certificateData, mimeType)
      const a = document.createElement('a')
      const extension = mimeType === 'image/png' ? 'png' : 'jpg'
      a.href = url
      const bibSlug = certificateData.bibNumber?.trim() || certificateData.verificationId.replace(/[^a-zA-Z0-9-]/g, '')
      a.download = `hari-ng-ahon-certificate-${bibSlug}.${extension}`
      document.body.appendChild(a)
      a.click()
      a.remove()
    },
    [certificateData, renderCertificateToDataUrl],
  )

  const refreshPaymentStatus = useCallback(async () => {
    setCheckingStatus(true)
    setError(null)
    try {
      if (registrationId && session?.access_token) {
        try {
          let checkoutSessionId: string | undefined
          try {
            checkoutSessionId = sessionStorage.getItem('paymongo_checkout_session')?.trim() || undefined
          } catch {
            checkoutSessionId = undefined
          }
          const bundleIds = await registrationService.listCheckoutBundleRegistrationIds(registrationId)
          for (const regId of bundleIds) {
            await registrationService.markRegistrationAsPaidAfterPaymongoRedirect(regId, { checkoutSessionId })
          }
          if (checkoutSessionId) {
            try {
              sessionStorage.removeItem('paymongo_checkout_session')
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          setError((e as Error).message || 'Failed to finalize payment.')
        }
      }
      await fetchCertificateData()
    } finally {
      setCheckingStatus(false)
    }
  }, [fetchCertificateData, registrationId, session?.access_token])

  const previewRows = useMemo(() => {
    if (bundleCertificateRows.length > 0) return bundleCertificateRows
    if (certificateData && registrationId) {
      return [{ registrationId: certificateData.registrationId, data: certificateData }]
    }
    return []
  }, [bundleCertificateRows, certificateData, registrationId])

  /** Every checkout line has a bib and a PNG rendered from that same row (avoids stale canvas + new bib races). */
  const registrationsReadyForCertEmail = useMemo(() => {
    if (!certificateData?.isPaid || !certificateData.registrantEmail?.trim()) return false
    if (previewRows.length === 0) return false
    return previewRows.every((row) => {
      const bib = String(row.data.bibNumber ?? '').trim()
      const url = bundleCertificatePreviewUrls[row.registrationId]
      return Boolean(bib && url)
    })
  }, [certificateData, previewRows, bundleCertificatePreviewUrls])

  useEffect(() => {
    if (previewRows.length === 0) {
      setBundleCertificatePreviewUrls({})
      return
    }
    let mounted = true
    const snapshot = previewRows
    void (async () => {
      const next: Record<string, string | null> = {}
      await Promise.all(
        snapshot.map(async ({ registrationId: rid, data }) => {
          try {
            next[rid] = await renderCertificateToDataUrl(data, 'image/png')
          } catch {
            next[rid] = null
          }
        }),
      )
      if (!mounted) return
      setBundleCertificatePreviewUrls(next)

      // Upload immediately using the same snapshot + PNGs so storage always matches on-screen pixels (dynamic bibs).
      if (!certificateData?.isPaid || !session?.access_token) return
      if (!CERT_BUCKET) {
        if (mounted) setStorageUploadMessage('Certificate storage is not configured (VITE_CERT_BUCKET).')
        return
      }
      try {
        setStorageUploadMessage('Saving your certificate to storage…')
        for (const row of snapshot) {
          const bib = String(row.data.bibNumber ?? '').trim()
          if (!bib) continue
          const storageUrl = await renderCertificateToDataUrl(row.data, 'image/png')
          await uploadCertificatePngToStorage(row.registrationId, storageUrl, bib)
        }
        if (mounted) setStorageUploadMessage(null)
      } catch (e) {
        if (mounted) setStorageUploadMessage((e as Error).message || 'Failed to save certificate to storage.')
      }
    })()
    return () => {
      mounted = false
    }
  }, [
    previewRows,
    renderCertificateToDataUrl,
    certificateData?.isPaid,
    session?.access_token,
    uploadCertificatePngToStorage,
  ])

  useEffect(() => {
    let active = true
    async function sendRaceClaimCertificateEmail() {
      if (!registrationsReadyForCertEmail || !certificateData) return

      if (certEmailInvokeLockRef.current) return
      certEmailInvokeLockRef.current = true

      try {
        const { data: sess } = await supabase.auth.getSession()
        const token = sess.session?.access_token
        if (!token) return

        let bundleIds: string[] = [certificateData.registrationId]
        try {
          bundleIds = await registrationService.listCheckoutBundleRegistrationIds(certificateData.registrationId)
        } catch {
          bundleIds = [certificateData.registrationId]
        }

        const allDeduped = bundleIds.every((id) => window.localStorage.getItem(`cert-email-sent:${id}`) === '1')
        if (allDeduped) {
          if (active) {
            setAutoEmailMessage(
              bundleIds.length > 1
                ? 'Your QR Code Race Claim Kit certificates were already sent to your email.'
                : 'Your QR Code Race Claim Kit was already sent to your email.',
            )
          }
          return
        }

        try {
        let sentCount = 0
        let skippedAlready = 0
        let mailUnavailable = false

        // Fresh render per row so storage matches DB bib immediately before Resend (avoids stale preview URLs).
        for (const regId of bundleIds) {
          const row = previewRows.find((r) => r.registrationId === regId)
          const bib = String(row?.data?.bibNumber ?? '').trim()
          if (!row || !bib) continue
          try {
            const storageUrl = await renderCertificateToDataUrl(row.data, 'image/png')
            await uploadCertificatePngToStorage(regId, storageUrl, bib)
          } catch {
            /* edge returns CERT_NOT_UPLOADED if missing */
          }
        }

        const primaryId = bundleIds[0] ?? certificateData.registrationId
        const { data, error } = await supabase.functions.invoke('send-race-claim-certificate-email', {
          headers: { Authorization: `Bearer ${token}` },
          body: { registrationId: primaryId, registrationIds: bundleIds },
        })

        if (error) {
          if (await reloadPageIfSessionExpiredInvokeError(error, '')) {
            await new Promise(() => {})
          }
          const raw = (error as { message?: string }).message ?? ''
          if (raw.toLowerCase().includes('resend') || raw.includes('503')) {
            mailUnavailable = true
          }
          if (active) {
            if (!mailUnavailable) {
              setAutoEmailMessage('Could not send every certificate email yet (files may still be uploading). Use Refresh.')
            } else {
              setAutoEmailMessage(
                'Certificate email is not available yet (mail not configured). You can download your certificate below.',
              )
            }
          }
          return
        }

        const payload = data as {
          ok?: boolean
          skipped?: boolean
          reason?: string
          error?: string
          detail?: string
          sent_registration_ids?: string[]
          sent_count?: number
        } | null
        if (payload?.error) {
          const detail = typeof payload.detail === 'string' ? payload.detail : ''
          if (String(payload.error).includes('RESEND_API_KEY') || detail.includes('resend')) {
            mailUnavailable = true
          }
          if (active && mailUnavailable) {
            setAutoEmailMessage(
              'Certificate email is not available yet (mail not configured). You can download your certificate below.',
            )
          }
          return
        }

        const sentIds = Array.isArray(payload?.sent_registration_ids) ? payload!.sent_registration_ids : []
        sentCount = Number(payload?.sent_count ?? sentIds.length ?? 0)
        for (const rid of sentIds) {
          window.localStorage.setItem(`cert-email-sent:${rid}`, '1')
        }
        skippedAlready = bundleIds.filter((id) => window.localStorage.getItem(`cert-email-sent:${id}`) === '1').length

        if (sentCount > 0) {
          if (active) {
            if (sentCount < bundleIds.length) {
              setAutoEmailMessage(
                `${sentCount} of ${bundleIds.length} certificates were attached and sent in one email. Tap Refresh / assign bib after each line has a bib.`,
              )
            } else if (bundleIds.length > 1) {
              setAutoEmailMessage(
                `${sentCount} QR Code Race Claim Kit certificates were sent to your email in one email.`,
              )
            } else {
              setAutoEmailMessage('Your QR Code Race Claim Kit certificate was sent to your email.')
            }
          }
          return
        }

        if (skippedAlready >= bundleIds.length) {
          if (active) {
            setAutoEmailMessage(
              bundleIds.length > 1
                ? 'Your QR Code Race Claim Kit certificates were already sent to your email.'
                : 'Your QR Code Race Claim Kit was already sent to your email.',
            )
          }
          return
        }

        if (active) {
          setAutoEmailMessage(
            'Could not send every certificate email yet (bibs may still be assigning). You can download below or use Refresh.',
          )
        }
        } catch {
          if (active) {
            setAutoEmailMessage('Certificate email failed to send. Please download your certificate below or contact support.')
          }
        }
      } finally {
        certEmailInvokeLockRef.current = false
      }
    }
    void sendRaceClaimCertificateEmail()
    return () => {
      active = false
    }
  }, [
    registrationsReadyForCertEmail,
    certificateData,
    session?.access_token,
    previewRows,
    bundleCertificatePreviewUrls,
    uploadCertificatePngToStorage,
    renderCertificateToDataUrl,
  ])

  return (
    <section className="bg-white px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-[760px] space-y-6">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Payment successful</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-emerald-900 sm:text-3xl">
            Registration payment received
          </h1>
          <p className="mt-2 text-sm text-emerald-800">
            Thank you! Your payment was submitted to PayMongo successfully. Your registration is finalized immediately
            and your race certificate is now available.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">What happens next?</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
            <li>Payment is marked as paid in your registration record.</li>
            <li>Your QR race certificate is generated from your rider information.</li>
            <li>You can preview and download your QR certificate.</li>
          </ol>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900">Digital Race Certificate</h2>
            <button
              type="button"
              onClick={() => void refreshPaymentStatus()}
              disabled={checkingStatus}
              className="inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {checkingStatus ? 'Refreshing...' : 'Refresh / assign bib'}
            </button>
          </div>

          {needsLoginToFinalize && registrationId ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-semibold">Log in to assign your race bib</p>
              <p className="mt-1 text-amber-900">
                Payment can be confirmed in PayMongo before your bib is written. Finalizing requires the same account you
                used to register.
              </p>
              <Link
                to={`/auth?redirect=${encodeURIComponent(`/register/payment-success?registrationId=${encodeURIComponent(registrationId)}`)}`}
                className="mt-3 inline-flex rounded-md bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Log in to complete bib assignment
              </Link>
            </div>
          ) : null}

          {certificateData?.isPaid && !certificateData?.bibNumber?.trim() && session?.access_token ? (
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
              <p>
                Bib not showing yet? Payment may still be syncing.{' '}
                <button
                  type="button"
                  className="font-semibold text-sky-800 underline hover:text-sky-950"
                  onClick={() => void refreshPaymentStatus()}
                  disabled={checkingStatus}
                >
                  Tap to retry finalize
                </button>
              </p>
            </div>
          ) : null}

          {error ? <p className="mt-3 text-sm text-rose-600">{error}</p> : null}

          {/* Shimmer skeleton — initial fetch only; keep cert visible during refresh while bib syncs */}
          {((loading && !certificateData) || (!certificateData && !error)) ? (
            <div className="mt-4 space-y-3 animate-pulse">
              <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                <div className="h-4 w-32 rounded bg-slate-200" />
                <div className="h-4 w-24 rounded bg-slate-200" />
                <div className="h-4 w-40 rounded bg-slate-200" />
                <div className="h-4 w-28 rounded bg-slate-200" />
                <div className="h-4 w-36 rounded bg-slate-200" />
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-2">
                <div
                  className="aspect-video w-full rounded-md bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 bg-[length:200%_100%] animate-[cert-preview-shimmer_1.4s_ease-in-out_infinite]"
                  aria-hidden
                />
              </div>
            </div>
          ) : null}

          {certificateData ? (
            <div className="mt-4 space-y-4">
              <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 sm:grid-cols-2">
                <p>
                  Rider: <span className="font-semibold text-slate-900">{certificateData.riderName}</span>
                </p>
                <p>
                  Bib:{' '}
                  <span className="font-semibold text-slate-900">
                    {certificateData.bibNumber?.trim() ? certificateData.bibNumber : '— (assign after login / refresh)'}
                  </span>
                </p>
                <p>
                  Category: <span className="font-semibold text-slate-900">{certificateData.category}</span>
                </p>
                <p>
                  Discipline: <span className="font-semibold text-slate-900">{certificateData.discipline}</span>
                </p>
                <p>
                  Event Type: <span className="font-semibold text-slate-900">{certificateData.eventType}</span>
                </p>
              </div>

              <div className="space-y-6">
                {previewRows.map((row) => {
                  const previewUrl = bundleCertificatePreviewUrls[row.registrationId]
                  const isCurrentEntry = row.registrationId === registrationId
                  return (
                    <div key={row.registrationId} className="space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="text-xs text-slate-600">
                          <p className="font-semibold text-slate-900">{row.data.eventType}</p>
                          <p className="mt-0.5">
                            {row.data.category}
                            <span className="mx-1.5 text-slate-400">·</span>
                            Bib{' '}
                            <span className="font-semibold text-slate-800">
                              {row.data.bibNumber?.trim() ? row.data.bibNumber : '—'}
                            </span>
                            {isCurrentEntry ? (
                              <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-800">
                                This page
                              </span>
                            ) : null}
                          </p>
                        </div>
                        {!isCurrentEntry && registrationId ? (
                          <Link
                            to={`/register/payment-success?registrationId=${encodeURIComponent(row.registrationId)}`}
                            className="shrink-0 text-xs font-medium text-green-700 underline hover:text-green-900"
                          >
                            Open this entry only
                          </Link>
                        ) : null}
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white p-2">
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={`QR certificate · ${row.data.eventType}`}
                            className="w-full rounded-md"
                          />
                        ) : (
                          <div
                            className="aspect-video w-full rounded-md bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 bg-[length:200%_100%] animate-[cert-preview-shimmer_1.4s_ease-in-out_infinite]"
                            aria-hidden
                          />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {previewRows.length > 1 ? (
                <p className="text-xs text-slate-500">
                  One certificate preview per event type and category you registered for in this payment.
                </p>
              ) : null}

              {storageUploadMessage ? <p className="text-sm text-slate-600">{storageUploadMessage}</p> : null}
              {autoEmailMessage ? <p className="text-sm text-slate-600">{autoEmailMessage}</p> : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => void handleDownload('image/png')}
            className="inline-flex items-center rounded-md bg-[#cfae3f] px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-[#dab852]"
          >
            Download PNG
          </button>
          <Link
            to="/"
            className="inline-flex items-center rounded-md bg-[#cfae3f] px-6 py-2.5 text-sm font-semibold text-black transition hover:bg-[#dab852]"
          >
            Back to home
          </Link>
        </div>
      </div>
    </section>
  )
}