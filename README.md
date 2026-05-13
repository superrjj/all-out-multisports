# Hari ng Ahon — Web Application

**Cycling race registration and operations platform** for Hari ng Ahon and related events (Baguio City, Philippines). This document summarizes what is **already built in this repository**, how it is deployed and operated, and what is **planned or still to be completed**. **Section 2** is written so **client counsel and other non-technical stakeholders** can see, at a glance, what the **public website** and **administration console** each do today, without reading code.

---

## 1. Purpose and scope

In one sentence: the system lets the public **learn about the race**, **look up confirmed participants**, and **register and pay online**; it lets **trusted staff** configure events, run registration and payments, use **QR codes** at the venue, prepare **results**, send **communications**, and pull **reports**.

More specifically, the application supports:

- **Public website** — Brand presence, participant lookup, account sign-in, multi-step registration with waiver and rules acknowledgment, and PayMongo checkout (see **Section 2.1**).
- **Administration console** — Dashboard, events, registrations, payments, QR kit and check-in, results data, announcements, gallery, cyclists, reports, settings, email tooling, waiver settings, logs, and an internal rider-dashboard preview (see **Section 2.2**).

The stack is a **single-page React application** backed by **Supabase** (PostgreSQL, Auth, Storage, and Edge Functions). The frontend is built with **Vite**, **TypeScript**, and **Tailwind CSS**.

---

## 2. Current features (what exists in the website today)

The following describes **live** capabilities as reflected in this repository. Items marked **not built yet** appear in the menu or roadmap but do not deliver full content to end users.

---

### 2.1 Public website — for visitors and riders

**Audience:** Anyone browsing the site, plus cyclists who create an account to register and pay.

| What you see or do | What it does (plain language) |
|--------------------|--------------------------------|
| **Home page** | Introduces the race, highlights key actions, and provides site navigation and footer. Staff accounts marked as **admin** who open the main address are taken straight to the operations dashboard; they can still open the public home using **`/home`** when they need to review the site as a visitor would. |
| **Participant lookup (“Search rider”)** | From the home page, a visitor can search **confirmed** entrants by name. The system returns limited, appropriate fields (for example name, bib number, event type, discipline, and category) so the public can verify participation without exposing unnecessary personal data. Search runs through a secure server function, with safeguards in the app to reduce misuse and data-display risks. |
| **Register for a race (“Register now”)** | A guided path in four stages: **(1) Race information** — published events, dates, deadlines, categories, and practical notes; **(2) Registration form** — available only after the cyclist **signs in**; **(3) Payment** — includes review of the **waiver** and **race rules** and checkout through **PayMongo** (the payment provider handles card data; the app does not store card numbers); **(4) Confirmation** — a thank-you / success screen after payment. If the cyclist must log in during checkout, the system remembers where to return so the flow can continue. |
| **Sign in / account** | Cyclists (and admins) use **email and password** through the platform’s authentication service. The system distinguishes **administrators** from regular riders for access control. |
| **Events, Results, Gallery, About** | These links exist in the header, but each page currently shows a **“page is not created”** placeholder. Full public content for those sections is **not** implemented in this snapshot (see Section 3). |
| **Page not found** | If someone types a wrong address, they get a clear **404** page with a way back to the home page. |

**Counsel note (high level):** The public side is focused on **marketing**, **limited participant verification**, **registration**, **legal acknowledgments at payment**, and **online payment**. It is not a full “cyclist portal” with a permanent “my registrations” area after login; that remains a planned enhancement (Section 3).

---

### 2.2 Administration console — for authorized event staff

**Audience:** Only users whose account role is **administrator**. Anyone else who tries to open these pages is returned to the public site. All modules below are **implemented** as operational screens in this codebase.

| Module | What staff can use it for |
|--------|---------------------------|
| **Dashboard** | One place to see how registration and payments are going: counts, revenue-style summaries, charts (such as registrations over time, revenue, participation, and categories), recent sign-ups, upcoming events, and a preview of announcements—connected to live data where the backend has records. |
| **Events management** | Create and edit races, publish what should appear to the public on the registration side, set venues and map links, prizes and organizer contact details, race types, disciplines, categories, capacity limits, and visual assets such as posters or banners. |
| **Registrations** | Browse and work through the list of sign-ups with filtering, sorting, and search; open a **single registration** to review or adjust details and run supported operations (for example updates from the server, and bib-related steps where configured). Export-style workflows are available where the screen provides them. |
| **Online payments** | Monitor and work with **PayMongo** transactions: see payment status and use verification-oriented workflows suited to finance and operations review. |
| **QR code — race kit** | Use a device camera to **scan rider QR codes** so staff can validate identity and support **race kit claiming** at distribution. |
| **QR code — check-in** | Same scanning technology, oriented to **venue entry / check-in** on race day (separate menu entry for a distinct operational use). |
| **Results management** | Maintain a **results ledger**: upload or manage timing and ranking data, see publication status, and review rows such as bib, ranks, chip or gun times, and status fields—so results can be prepared before any future public results page goes live. |
| **Announcements** | Create and manage **pinned notices** and other race communications visible in the operational context (and surfaced on the dashboard where wired). |
| **Gallery** | Manage **photos and albums** for the event (content intended to support a future public gallery page). |
| **Cyclists management** | View and manage **cyclist profiles**, teams, and certain account-related actions from an organizer perspective. |
| **Reports** | Generate **exports** and **summary analytics** for reporting needs. |
| **Settings** | Configure **branding**, **payments**, **email**, **administrator accounts**, and related operational settings. |
| **Email notifications** | Work with **email templates** and concepts for **automated messages** to riders (implementation depth should be confirmed against your production email provider and policies). |
| **Rider dashboard (preview)** | An **internal preview** of what a future **logged-in rider dashboard** might show; it is **not** the live experience for cyclists on the public site today. |
| **Digital waiver** | Configure and review settings around **digital consent** and waiver content aligned with the registration flow. |
| **System logs** | Inspect **technical and webhook-related logs** (for example payment pipeline events) to support troubleshooting and audit-style review—subject to what your deployment retains and for how long. |

**Developers:** The canonical list of URLs is in `src/routes/AppRoutes.tsx`.

---

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
| Intended use | Client and **legal counsel** summary: plain-language **public vs admin features** (Section 2), plus **implemented** vs **planned** scope elsewhere |

For technical questions beyond this document, refer to `src/routes/AppRoutes.tsx` (source of truth for routes) and `supabase/functions/` (source of truth for server entry points).
