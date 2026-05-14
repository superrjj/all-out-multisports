import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

const TOAST_ID = 'app-deploy-update'
const POLL_MS = 5 * 60 * 1000

/**
 * In production, compares the embedded build id with `/build-meta.json` from the server.
 * When a new deploy is live, shows a Sonner toast with "Update now" (full reload).
 */
export function AppUpdateWatcher() {
  const shownRef = useRef(false)

  useEffect(() => {
    if (!import.meta.env.PROD) return
    const embedded = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__.trim() : ''
    if (!embedded || embedded === 'local') return

    let cancelled = false
    let intervalId: number | undefined

    const poll = async () => {
      if (cancelled || shownRef.current) return
      try {
        const res = await fetch(`/build-meta.json?${Date.now()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { buildId?: string }
        const remote = String(data?.buildId ?? '').trim()
        if (!remote || remote === embedded || cancelled) return
        if (shownRef.current) return
        shownRef.current = true
        toast('New version available', {
          id: TOAST_ID,
          duration: Number.POSITIVE_INFINITY,
          description: 'Reload to get the latest fixes and features.',
          action: {
            label: 'Update now',
            onClick: () => {
              window.location.reload()
            },
          },
        })
        if (intervalId !== undefined) window.clearInterval(intervalId)
      } catch {
        /* ignore network / parse errors */
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll()
    }

    void poll()
    intervalId = window.setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      if (intervalId !== undefined) window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}
