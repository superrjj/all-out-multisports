import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

const TOAST_ID = 'app-deploy-update'
const POLL_MS = 5 * 60 * 1000
const STORAGE_KEY = 'app-last-seen-build-id'

/**
 * In production, compares the embedded build id with `/build-meta.json` from the server.
 * When a new deploy is live, shows a Sonner toast with "Refresh now" (full reload).
 *
 * Fix for mobile loop bug:
 * - Mobile browsers fire `visibilitychange` aggressively (e.g. switching apps),
 *   causing repeated polls and repeated toasts even after the user clicks "Refresh now".
 * - Solution: after a reload, we persist the remote buildId in sessionStorage.
 *   On next poll, if the remote buildId matches what we already saw, we skip the toast —
 *   because the reload already loaded the latest version.
 * - The toast only re-appears when a *newer* buildId shows up (i.e. a new deploy happened
 *   after the user's last refresh).
 */
export function AppUpdateWatcher() {
  const shownRef = useRef(false)

  useEffect(() => {
    if (!import.meta.env.PROD) return

    const embedded = typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__.trim() : ''
    if (!embedded || embedded === 'local') return

    let cancelled = false
    const pollTimer = { id: undefined as number | undefined }

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
        if (!remote || cancelled) return

        // Get the last build ID the user already acknowledged (survived a reload)
        const lastSeenBuildId = sessionStorage.getItem(STORAGE_KEY)

        // If the remote matches what the user last refreshed to → nothing new, skip
        if (remote === lastSeenBuildId) return

        // If the remote matches the currently running build → no update yet, skip
        if (remote === embedded) return

        // A genuinely new build is available — show the toast once
        if (shownRef.current) return
        shownRef.current = true

        toast('Update available', {
          id: TOAST_ID,
          duration: Number.POSITIVE_INFINITY,
          description: 'Refresh this page to load the latest version with fixes and improvements.',
          action: {
            label: 'Refresh now',
            onClick: () => {
              // Persist the remote build ID BEFORE reloading.
              // After reload, the next poll will see remote === lastSeenBuildId → no toast.
              sessionStorage.setItem(STORAGE_KEY, remote)
              window.location.reload()
            },
          },
          onDismiss: () => {
            // User dismissed without refreshing — remember so we don't spam them.
            // They'll see it again only if an even newer build is deployed.
            sessionStorage.setItem(STORAGE_KEY, remote)
          },
        })

        // Stop polling once toast is shown — no need to keep checking
        if (pollTimer.id !== undefined) {
          window.clearInterval(pollTimer.id)
          pollTimer.id = undefined
        }
      } catch {
        /* ignore network / parse errors */
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll()
    }

    void poll()
    pollTimer.id = window.setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      if (pollTimer.id !== undefined) window.clearInterval(pollTimer.id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}