import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, LogOut, Menu, ChevronDown, Clock3 } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { AdminSidebar } from './admin-sidebar'

export function AdminLayout({ children }: { children: ReactNode; title?: string; subtitle?: string }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [fullName, setFullName] = useState('')
  const [now, setNow] = useState(() => new Date())
  const navigate = useNavigate()
  const { logout, session } = useAuth()
  const menuRef = useRef<HTMLDivElement | null>(null)

  const onLogout = async () => {
    await logout()
    navigate('/', { replace: true })
  }

  const displayName = session?.user?.email?.split('@')[0] ?? 'Admin'
  const headerName = fullName || session?.user?.user_metadata?.full_name || displayName

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const phDate = useMemo(
    () =>
      new Intl.DateTimeFormat('en-PH', {
        timeZone: 'Asia/Manila',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(now),
    [now],
  )

  const phTime = useMemo(
    () =>
      new Intl.DateTimeFormat('en-PH', {
        timeZone: 'Asia/Manila',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(now),
    [now],
  )

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    const onPointerDown = (e: PointerEvent) => {
      const el = menuRef.current
      if (!el) return
      if (e.target instanceof Node && !el.contains(e.target)) setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [menuOpen])

  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) {
      setFullName('')
      return
    }
    let active = true
    void (async () => {
      const { data } = await supabase.from('users').select('full_name').eq('id', userId).maybeSingle()
      if (!active) return
      setFullName(data?.full_name ?? '')
    })()
    return () => {
      active = false
    }
  }, [session?.user?.id])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <AdminSidebar mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

      <div className="flex min-w-0 min-h-0 flex-1 flex-col">
        <header className="z-30 flex shrink-0 items-center justify-between gap-4 border-b border-slate-200/80 bg-white px-4 py-3 shadow-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden md:block">
              <div className="flex items-center gap-1.5 text-[#0f5890]">
                <Clock3 className="h-4 w-4" />
                <p className="text-2xl font-semibold tracking-wide">{phTime}</p>
              </div>
              <p className="text-sm text-[#0f5890]">{phDate}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <button
              type="button"
              className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
              aria-label="Notifications"
            >
              <Bell className="h-5 w-5" />
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                3
              </span>
            </button>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-1 pr-2 transition hover:bg-slate-100 sm:pr-3"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-900 text-xs font-semibold text-white">
                  {displayName.slice(0, 2).toUpperCase()}
                </div>
                <div className="hidden min-w-0 text-left sm:block">
                  <p className="truncate text-sm font-medium text-slate-900">{headerName}</p>
                  <p className="truncate text-xs text-slate-500">{session?.user?.email ?? '—'}</p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-slate-500 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              <div
                role="menu"
                className={`absolute right-0 top-[calc(100%+8px)] z-40 w-48 origin-top-right rounded-xl border border-slate-200 bg-white p-1 shadow-lg transition ${
                  menuOpen ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0'
                }`}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                  onClick={() => {
                    setMenuOpen(false)
                    void onLogout()
                  }}
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
