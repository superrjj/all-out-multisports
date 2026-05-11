import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Bike, LoaderCircle } from 'lucide-react'
import { AuthPage } from '../components/auth/auth-page'
import { AdminDashboard } from '../components/admin/admin-dashboard'
import { AdminLayout } from '../components/admin/admin-layout'
import { AdminShell } from '../components/admin/admin-shell'
import { AdminRegistrations } from '../components/admin/admin-registrations'
import { AdminRegistrationDetail } from '../components/admin/admin-registration-detail'
import {
  AdminAnnouncementsModule,
  AdminCyclistsManagement,
  AdminDigitalWaiver,
  AdminEmailNotifications,
  AdminEventsManagement,
  AdminGalleryModule,
  AdminOnlinePayments,
  AdminQrCheckIn,
  AdminReportsModule,
  AdminResultsManagement,
  AdminRiderDashboardInfo,
  AdminSettingsModule,
  AdminSystemLogs,
} from '../components/admin/admin-pages'
import { Hero } from '../components/homepage/hero'
import { RegistrationForm } from '../components/homepage/registration-form'
import { RegistrationInfo } from '../components/homepage/registration-info'
import { RegistrationPayment } from '../components/homepage/registration-payment'
import { RegistrationPaymentSuccess } from '../components/homepage/registration-payment-success'
import { Shell } from '../components/Shell'
import { useAuth } from '../hooks/useAuth'

function RouteLoadingState() {
  return (
    <section className="flex min-h-[calc(100vh-9rem)] items-center justify-center px-4 py-10">
      <div className="flex flex-col items-center gap-2">
        <Bike className="h-8 w-8 text-slate-800" aria-hidden />
        <LoaderCircle className="h-5 w-5 animate-spin text-[#cfae3f]" aria-hidden />
      </div>
    </section>
  )
}

/** Public home; admins are sent straight to the admin dashboard (same layout as after login). */
function HomeRoute() {
  const { session, loading, role, roleLoading } = useAuth()
  if (loading || (session && roleLoading)) {
    return (
      <Shell>
        <RouteLoadingState />
      </Shell>
    )
  }
  if (session && role === 'admin') {
    return <Navigate to="/admin" replace />
  }
  return (
    <Shell>
      <Hero />
    </Shell>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <Shell>
        <RouteLoadingState />
      </Shell>
    )
  }

  if (!session) {
    // Preserve the full URL (path + query params) so PayMongo redirects survive login
    const fullPath = location.pathname + location.search
    return <Navigate to={`/auth?redirect=${encodeURIComponent(fullPath)}`} replace />
  }

  return children
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { session, loading, role, roleLoading } = useAuth()
  if (loading || (session && roleLoading)) {
    return (
      <Shell>
        <RouteLoadingState />
      </Shell>
    )
  }
  if (session && role === 'admin') return <Navigate to="/admin" replace />
  return children
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { session, loading, role, roleLoading } = useAuth()
  if (loading || (session && roleLoading)) {
    return (
      <Shell>
        <RouteLoadingState />
      </Shell>
    )
  }
  if (!session) return <Navigate to="/auth" replace />
  if (role !== 'admin') return <Navigate to="/" replace />
  return children
}

export function NotFound() {
  const navigate = useNavigate()

  return (
    <section
      className="relative flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center overflow-hidden px-6 py-20 text-center"
      style={{ fontFamily: "'Sora', sans-serif" }}
    >
      {/* Background watermark */}
      <span
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-[clamp(120px,20vw,180px)] font-bold leading-none tracking-tighter text-slate-900/[0.05]"
        style={{ fontFamily: "'Space Mono', monospace" }}
        aria-hidden
      >
        404
      </span>

      {/* Decorative circles */}
      <div className="pointer-events-none absolute -right-24 -top-20 h-[420px] w-[420px] rounded-full bg-slate-900 opacity-[0.04]" />
      <div className="pointer-events-none absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-slate-900 opacity-[0.04]" />

      {/* Content */}
      <div className="relative z-10 flex max-w-md flex-col items-center">
        {/* Badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <span
            className="text-[11px] tracking-widest text-slate-500"
            style={{ fontFamily: "'Space Mono', monospace" }}
          >
            Error 404
          </span>
        </div>

        <p
          className="mb-3 text-[11px] uppercase tracking-[3px] text-slate-400"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          Page not found
        </p>

        <h1 className="mb-4 text-4xl font-semibold leading-tight tracking-tight text-slate-900">
          This route doesn't exist
        </h1>

        <div className="mb-6 h-px w-10 bg-slate-200" />

        <p className="mb-8 text-[15px] font-light leading-relaxed text-slate-500">
          The page you're looking for may have been moved, renamed, or doesn't exist.
          Check the URL or head back to safety.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <a
            href="/"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-px hover:opacity-85"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 1L1 8h2.5v6h4v-4h1v4h4V8H15L8 1z" />
            </svg>
            Go to homepage
          </a>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-5 py-3 text-sm text-slate-700 transition hover:-translate-y-px hover:bg-slate-50"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M10 12L6 8l4-4" />
            </svg>
            Go back
          </button>
        </div>
      </div>
    </section>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      {/* Public landing (admins redirected from `/` can open this via View site) */}
      <Route
        path="/home"
        element={
          <PublicOnly>
            <Shell>
              <Hero />
            </Shell>
          </PublicOnly>
        }
      />
      <Route path="/auth" element={<Shell><AuthPage /></Shell>} />
      <Route
        path="/register/info"
        element={
          <PublicOnly>
            <Shell><RegistrationInfo /></Shell>
          </PublicOnly>
        }
      />
      <Route
        path="/register/form"
        element={
          <PublicOnly>
           <RequireAuth><Shell><RegistrationForm /></Shell></RequireAuth>
          </PublicOnly>
        }
      />
      <Route
        path="/register/payment"
        element={
          <PublicOnly>
            <RequireAuth><Shell><RegistrationPayment /></Shell></RequireAuth>
          </PublicOnly>
        }
      />
      <Route
        path="/register/payment-success"
        element={
          <PublicOnly>
            <RequireAuth><Shell><RegistrationPaymentSuccess /></Shell></RequireAuth>
          </PublicOnly>
        }
      />

      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout>
                <AdminDashboard />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/events"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Events Management" subtitle="Create, publish, and configure race events.">
                <AdminEventsManagement />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/registrations"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Registration Management" subtitle="Review, approve, and export participant data.">
                <AdminRegistrations />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/registrations/:id"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Registration detail" subtitle="Rider profile and payment context.">
                <AdminRegistrationDetail />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/payments"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Online Payments" subtitle="PayMongo transactions and verification.">
                <AdminOnlinePayments />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/qr-code-race-kit"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="QR Code Race Kit" subtitle="Scan and validate rider QR codes for race kit claiming.">
                <AdminQrCheckIn />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/results"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Results Management" subtitle="Upload times, rankings, and publish standings.">
                <AdminResultsManagement />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/announcements"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Announcements" subtitle="Pinned notices and race communications.">
                <AdminAnnouncementsModule />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/gallery"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Gallery" subtitle="Event photos and albums.">
                <AdminGalleryModule />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/cyclists"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Cyclists Management" subtitle="Profiles, teams, and account actions.">
                <AdminCyclistsManagement />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/reports"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Reports" subtitle="Exports and analytics summaries.">
                <AdminReportsModule />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Settings" subtitle="Branding, payments, email, and admin accounts.">
                <AdminSettingsModule />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/check-in"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="QR Code Check-in" subtitle="Venue entry verification.">
                <AdminQrCheckIn />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/email-notifications"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Email Notifications" subtitle="Templates and automated rider emails.">
                <AdminEmailNotifications />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/rider-dashboard"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Rider Dashboard" subtitle="What cyclists see after login.">
                <AdminRiderDashboardInfo />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/digital-waiver"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="Digital Waiver" subtitle="Consent capture and storage.">
                <AdminDigitalWaiver />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />
      <Route
        path="/admin/system-logs"
        element={
          <RequireAdmin>
            <AdminShell>
              <AdminLayout title="System Logs" subtitle="Webhooks and audit trails.">
                <AdminSystemLogs />
              </AdminLayout>
            </AdminShell>
          </RequireAdmin>
        }
      />

      <Route path="*" element={<Shell><NotFound /></Shell>} />
    </Routes>
  )
}