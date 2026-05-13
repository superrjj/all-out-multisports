# Hari ng Ahon — Web Application

**Cycling race registration and operations platform** for Hari ng Ahon and related events (Baguio City, Philippines). This document summarizes what is **already built in this repository**, how it is deployed and operated, and what is **planned or still to be completed**—intended for stakeholder review (including legal counsel).

---

## 1. Purpose and scope

The application supports:

- **Public discovery** of the race brand and calls to action (register, search confirmed riders).
- **Authenticated registration** for cyclists: event and category selection, profile capture, waiver and rules acknowledgment, and **online payment** (PayMongo).
- **Administrator operations**: events, registrations, payments, QR-based race kit workflows, results-related tooling, communications modules, reporting, and configuration screens.

The stack is a **single-page React application** backed by **Supabase** (PostgreSQL, Auth, Storage, and Edge Functions). The frontend is built with **Vite**, **TypeScript**, and **Tailwind CSS**.

---

## 2. What is implemented today (as of this codebase)

### 2.1 Public website

| Area | Status | Notes |
|------|--------|--------|
| **Home / landing** (`/`, `/home`) | Implemented | Marketing hero, navigation shell, footer. Logged-in **admins** hitting `/` are redirected to the admin dashboard; `/home` forces the public landing for non-admin review. |
| **Search rider** | Implemented | On the homepage, **Search rider** scrolls to the **Participant lookup** section, focuses the search field, and queries **confirmed registrations** via a secure Edge Function (`public-search-riders`). Results show sanitized fields (e.g. name, bib, event type, discipline, category). Client-side normalization and display sanitization reduce injection and abuse risk. |
| **Register Now** flow | Implemented | Linear journey: **info** → **form** (requires login) → **payment** → **success**. |
| **Registration info** (`/register/info`) | Implemented | Shows **published** events from the database, race dates, registration deadlines, discipline/category structure, and tire hints. Links into the authenticated registration form. |
| **Registration form** (`/register/form`) | Implemented | Protected route: cyclist must be signed in. Submits registration through backend (`public-register` Edge Function pattern via app services). |
| **Registration payment** (`/register/payment`) | Implemented | Multi-step checkout UI including **waiver**, **race rules**, and **PayMongo**-driven payment creation (`public-create-payment`). Handles return URLs and coordination with webhook/finalize flows (see backend). |
| **Payment success** (`/register/payment-success`) | Implemented | Post-payment confirmation experience for the cyclist. |
| **Authentication** (`/auth`) | Implemented | Email/password (and related Supabase Auth flows) via `AuthProvider`. **Role** is resolved from the `users` table (`admin` vs default cyclist) with JWT fallback for admin detection where applicable. **Redirect query** preservation supports payment return paths through login. |
| **Events, Results, Gallery, About** (`/events`, `/results`, `/gallery`, `/about`) | **Placeholder** | Routes render a **“Page is not created”** state; navigation exists in the header but content pages are not built yet. |

### 2.2 Administration console

All admin routes require a signed-in user whose role is **admin**; others are redirected to the public home.

| Module | Route | Purpose (high level) |
|--------|--------|----------------------|
| **Dashboard** | `/admin` | Operational overview: registration counts, payment/revenue aggregates, charts (registrations, revenue, participation, categories), recent registrations, upcoming events, announcements preview—wired to live admin APIs where data exists. |
| **Events management** | `/admin/events` | Create/edit/publish events, venues, maps links, prizes, organizer contact blocks, race types, disciplines, categories, limits, posters/banners, and related metadata. |
| **Registrations** | `/admin/registrations`, `/admin/registrations/:id` | List, filter, sort, search, export-oriented workflows; drill-down to a single registration with editing and operational actions supported by Edge Functions (e.g. updates, bib generation hooks where configured). |
| **Online payments** | `/admin/payments` | PayMongo-oriented payment monitoring and verification workflows. |
| **QR code race kit / check-in** | `/admin/qr-code-race-kit`, `/admin/check-in` | Scanner-based flows using **ZXing**; bib and rider lookup patterns for kit claim and venue check-in (shared component surface). |
| **Results management** | `/admin/results` | API-backed **results ledger**: stats (row counts, published), table of bib, ranks, chip/gun times, and status. |
| **Announcements** | `/admin/announcements` | Pinned notices and race communications management. |
| **Gallery** | `/admin/gallery` | Media/album management for event photography. |
| **Cyclists management** | `/admin/cyclists` | Cyclist profiles, teams, and account-related admin actions. |
| **Reports** | `/admin/reports` | Exports and summary analytics. |
| **Settings** | `/admin/settings` | Branding, payments, email, admin accounts, and related configuration. |
| **Email notifications** | `/admin/email-notifications` | Templates and automated rider email concepts. |
| **Rider dashboard (admin preview)** | `/admin/rider-dashboard` | Explains / surfaces **what cyclists could see** on the public side when a full cyclist portal is built; not a substitute for a public cyclist dashboard route. |
| **Digital waiver** | `/admin/digital-waiver` | Consent capture configuration aligned with registration legal content. |
| **System logs** | `/admin/system-logs` | Webhook and audit-oriented visibility (e.g. PayMongo pipeline diagnostics). |

### 2.3 Backend (Supabase Edge Functions)

Server-side logic in `supabase/functions/` includes (non-exhaustive):

- **`public-register`** — Public registration submission pipeline.
- **`public-create-payment`** — Creates PayMongo checkout/session style payloads for the client.
- **`paymongo-webhook`** — Receives PayMongo webhooks (see function README where present).
- **`finalize-paymongo-success`** — Completes or reconciles successful payment outcomes with registration state.
- **`public-search-riders`** — Name search over **confirmed** registrations for the public lookup feature.
- **`admin-update-registration`** — Admin-driven registration updates.
- **`admin-delete-pending-registration`** — Cleanup of pending registrations.
- **`admin-generate-bib`** — Bib number generation for approved workflows.
- **`send-race-claim-certificate-email`** — Email dispatch for race kit / certificate style notifications.

Shared helpers live under `supabase/functions/_shared/` (e.g. registration finale, race category resolution).

### 2.4 Build, SEO, and quality

- **Production build**: `npm run build` runs TypeScript project build and Vite bundling.
- **Sitemap**: `scripts/generate-sitemap.mjs` runs in **`prebuild`**; it can pull **published** events from Supabase when `SITE_URL` and Supabase env vars are available at build time.
- **Linting**: `npm run lint` (ESLint).

---

## 3. Features planned or not yet delivered (roadmap)

These items are **not fully realized** in the public app or are only partially represented (e.g. admin-only or placeholder). They are typical next phases for client sign-off:

1. **Public Events page** — Browse/filter all published events with detail pages and deep links (currently `/events` is a placeholder).
2. **Public Results page** — Read-only leaderboards, downloadable PDFs, or per-category results aligned with admin uploads (currently `/results` is a placeholder).
3. **Public Gallery** — Visitor-facing albums synced from admin-managed media (currently `/gallery` is a placeholder).
4. **About / legal / static content** — Organizer story, terms, privacy policy, contact, and counsel-reviewed waiver hosting (currently `/about` is a placeholder).
5. **Dedicated cyclist portal after login** — A persistent **“My registrations”** area (bib, payment status, QR, certificates), separate from the registration wizard alone. Today, post-login cyclists are primarily guided through **registration**; admin has a **preview** module for future parity.
6. **Email and SMS reliability** — Production-grade templates, bounce handling, and optional SMS for race day (depends on provider choices and budget).
7. **Mobile app or PWA enhancements** — Offline queueing for staff scanners, optional installable PWA.
8. **Deeper analytics** — Cohort reporting, funnel from landing → paid, and finance-grade exports for accounting.
9. **Multi-organization or multi-event tenancy** — If future races beyond Hari ng Ahon share the same deployment with isolation per organizer.
10. **Database schema as versioned migrations in-repo** — The README historically referenced `supabase/schema.sql`; **this snapshot may not include that file**. Production projects should keep **SQL migrations** or documented baseline schema under version control for audit and disaster recovery.

---

## 4. Technology stack

| Layer | Technology |
|-------|------------|
| UI | React 19, React Router 7, Tailwind CSS 4 |
| Forms / validation | React Hook Form, Zod, Hookform resolvers |
| Charts | Chart.js, react-chartjs-2 |
| Auth / database / realtime | Supabase JS v2 |
| Payments | PayMongo (via Edge Functions and webhooks) |
| QR | `@zxing/browser`, `qrcode` |
| PDF / exports | jsPDF, xlsx (as used in admin modules) |
| Tooling | Vite 8, TypeScript 6, ESLint |

---

## 5. Repository layout (concise)

```text
src/
  components/     # UI: homepage, admin, auth, shell
  hooks/            # e.g. useAuth
  lib/              # Supabase client
  routes/           # AppRoutes — all URL definitions
  services/         # API wrappers (public + admin)
  types/            # Shared TypeScript types
  utils/            # Helpers (e.g. rider search security)
supabase/functions/ # Edge Functions (Deno)
scripts/            # e.g. generate-sitemap.mjs
```

---

## 6. Environment variables

Create a `.env` (or configure your host’s environment) for the **Vite** frontend:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

For **sitemap generation at build time** (optional but recommended in CI):

```env
SITE_URL=https://your-production-domain.example
# Build may also read SUPABASE_URL / SUPABASE_ANON_KEY as fallbacks per scripts/generate-sitemap.mjs
```

**Secrets** (PayMongo keys, service role keys, webhook signing secrets) must **never** be committed; configure them in the Supabase dashboard for Edge Functions.

---

## 7. Local development

```bash
npm install
npm run dev
```

- **Lint**: `npm run lint`
- **Production build**: `npm run build`
- **Preview build**: `npm run preview`

Edge Functions are deployed with the **Supabase CLI** from your machine or CI (not covered here; follow Supabase project docs).

---

## 8. Storage

The application historically expected a storage bucket (e.g. for payment proofs) such as **`payment-proofs`**. Confirm bucket names and **Row Level Security** policies in the Supabase dashboard match your deployment checklist.

---

## 9. Security and compliance (summary for counsel)

- **Authentication** is delegated to **Supabase Auth** (industry-standard session and token handling).
- **Authorization** distinguishes **admin** vs **cyclist** using database-backed roles and route guards.
- **Public rider search** is scoped to appropriate data, invoked through **Edge Functions** rather than exposing broad table access to anonymous clients; input normalization and output sanitization are applied in code.
- **Payments** should be reviewed end-to-end: PayMongo **webhook signature verification**, idempotent finalize steps, and PCI scope (PayMongo handles card data; the app should not store raw card numbers).
- **Waivers** appear in the registration payment flow; final legal text and **e-signature** admissibility should be confirmed with counsel for the Philippines context.

---

## 10. Deployment

The SPA can be hosted on **Cloudflare Pages**, **Vercel**, **Netlify**, or similar static hosts, with environment variables injected at build time. Supabase remains the **authoritative backend**. Configure production URLs for Auth redirect URLs and PayMongo return links.

---

## 11. License and ownership

This project is developed for the **Hari ng Ahon / All Out Multisports** web initiative. Intellectual property, production credentials, and third-party agreements (Supabase, PayMongo, email) remain with the rights holders and operators named in your engagement.

---

## 12. Document control

| Field | Value |
|-------|--------|
| Repository | `hari-ng-ahon` |
| Intended use | Client and legal stakeholder summary of **implemented** vs **planned** functionality |

For technical questions beyond this document, refer to `src/routes/AppRoutes.tsx` (source of truth for routes) and `supabase/functions/` (source of truth for server entry points).
