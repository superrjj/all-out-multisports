import { useState } from 'react'
import { Menu, User, X } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../../hooks/useAuth'

const navItems = [
  { label: 'Home', to: '/' },
  { label: 'Events', to: '/events' },
  { label: 'Results', to: '/results' },
  { label: 'Gallery', to: '/gallery' },
  { label: 'About', to: '/about' },
]

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { session, logout, role } = useAuth()

  const onLogout = async () => {
    try {
      await logout()
      toast.success('Logged out successfully.')
      setMobileOpen(false)
    } catch (error) {
      toast.error((error as Error).message || 'Failed to logout.')
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-[0_1px_10px_0_rgba(0,0,0,0.05)]">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        {/* Logo */}
        <Link
          to={role === 'admin' ? '/admin' : '/'}
          className="inline-flex items-center gap-2.5 transition-opacity hover:opacity-85"
        >
          <img src="/all_out_multisports_1.png" alt="All Out Multisports" className="h-14 w-auto" />
          <div className="h-7 w-px bg-slate-200" aria-hidden="true" />
          <img src="/hna-logo.png" alt="Hari Ng Ahon" className="h-14 w-auto" />
        </Link>

        {/* Desktop nav */}
        <div className="ml-auto flex items-center gap-6">
          <nav className="hidden items-center gap-6 text-sm font-semibold md:flex" aria-label="Main navigation">
            {role === 'admin' ? (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `rounded-lg px-3.5 py-2 transition-colors duration-150 ${
                    isActive
                      ? 'rounded-full bg-[#f3d423] px-4 text-black'
                      : 'text-slate-700 hover:text-slate-950'
                  }`
                }
              >
                Admin
              </NavLink>
            ) : (
              navItems.map((item) =>
                item.to.startsWith('#') ? (
                  <a
                    key={item.label}
                    href={item.to}
                    className="rounded-full px-2.5 py-2 text-slate-700 transition-colors duration-150 hover:text-slate-950"
                  >
                    {item.label}
                  </a>
                ) : (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    className={({ isActive }) =>
                      `rounded-lg px-3.5 py-2 transition-colors duration-150 ${
                        isActive
                          ? 'rounded-full bg-[#f3d423] px-4 text-black'
                          : 'text-slate-700 hover:text-slate-950'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ),
              )
            )}
          </nav>

          {/* Divider between nav and auth */}
          <div className="hidden h-6 w-px bg-slate-300 md:block ml-2" aria-hidden="true" />

          {/* Auth button */}
          {session ? (
            <button
              type="button"
              onClick={() => void onLogout()}
              className="hidden rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-700 transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 md:inline-flex ml-2"
            >
              Logout
            </button>
          ) : (
            <Link
              to="/auth?mode=login"
              className="hidden items-center gap-2 rounded-full bg-[#0b1f4e] px-5 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#102a66] md:inline-flex"
            >
              <User className="h-4 w-4" />
              Login
            </Link>
          )}

          {/* Mobile menu toggle */}
          <button
            type="button"
            className="rounded-lg p-2 text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 md:hidden"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile nav — absolute overlay, does not push content */}
      {mobileOpen && (
        <nav
          className="absolute left-0 right-0 top-full z-50 border-t border-slate-100 bg-white px-4 pb-4 pt-3 shadow-lg md:hidden"
          aria-label="Mobile navigation"
        >
          <div className="flex flex-col gap-0.5">
            {role === 'admin' ? (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
                onClick={() => setMobileOpen(false)}
              >
                Admin
              </NavLink>
            ) : (
              navItems.map((item) =>
                item.to.startsWith('#') ? (
                  <a
                    key={item.label}
                    href={item.to}
                    className="rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
                    onClick={() => setMobileOpen(false)}
                  >
                    {item.label}
                  </a>
                ) : (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    className={({ isActive }) =>
                      `rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                        isActive
                          ? 'bg-[#f3d423] text-black'
                          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                      }`
                    }
                    onClick={() => setMobileOpen(false)}
                  >
                    {item.label}
                  </NavLink>
                ),
              )
            )}

            <div className="mt-3 border-t border-slate-100 pt-3">
              {session ? (
                <button
                  type="button"
                  onClick={() => void onLogout()}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-left text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900"
                >
                  Logout
                </button>
              ) : (
                <Link
                  to="/auth?mode=login"
                  className="block w-full rounded-lg bg-[#0b1f4e] px-3 py-2.5 text-center text-sm font-medium text-white transition-colors duration-150 hover:bg-slate-700"
                  onClick={() => setMobileOpen(false)}
                >
                  Login
                </Link>
              )}
            </div>
          </div>
        </nav>
      )}
    </header>
  )
}