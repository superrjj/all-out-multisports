import { useLayoutEffect, useState } from 'react'
import { Toaster } from 'sonner'

/** Phones only — tablets/small laptops stay top-right (matches common `sm` cutoff). */
const MOBILE_MQ = '(max-width: 480px)'

/** Desktop / tablet: top-right. Small phones: top-center + safe area. */
export function ResponsiveToaster() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MQ).matches : false,
  )

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(MOBILE_MQ)
    const sync = () => setIsMobile(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return (
    <Toaster
      richColors
      position={isMobile ? 'top-center' : 'top-right'}
      offset={isMobile ? 'max(12px, env(safe-area-inset-top, 0px))' : 16}
      mobileOffset="max(12px, env(safe-area-inset-top, 0px))"
      toastOptions={{ classNames: { toast: 'max-w-[calc(100vw-1.5rem)]' } }}
    />
  )
}
