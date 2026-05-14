import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'

const MOBILE_MQ = '(max-width: 640px)'

/** Desktop: top-right. Mobile: top-center + safe area (Sonner v2 has no `mobilePosition` prop). */
export function ResponsiveToaster() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
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
