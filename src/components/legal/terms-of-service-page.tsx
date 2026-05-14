import { Link } from 'react-router-dom'

const LAST_UPDATED = 'May 14, 2026'

export function TermsOfServicePage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 text-slate-800 sm:px-6 lg:px-8">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Legal</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Terms of Service</h1>
      <p className="mt-2 text-sm text-slate-600">All Out Multisports — Hari Ng Ahon online registration</p>
      <p className="mt-6 text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-slate-700">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">1. Who we are</h2>
          <p>
            These Terms of Service (“Terms”) govern your use of the Hari Ng Ahon website and related online services
            operated by All Out Multisports (“we”, “us”, “our”). By creating an account, registering for an event, or
            using this site, you agree to these Terms. If you do not agree, please do not use the service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">2. Eligibility and your account</h2>
          <p>
            You must provide accurate information when you sign up and keep your login details private. You are
            responsible for activity that happens under your account. Tell us promptly if you believe someone else has
            accessed your account.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">3. Event registration and payments</h2>
          <p>
            Race slots, fees, deadlines, categories, and kit details are shown at checkout and on event pages. When you
            complete payment through our payment partner, you are making an offer to register subject to event rules and
            capacity. We may refuse or cancel a registration where required by law, safety, fraud prevention, or event
            policies.
          </p>
          <p>
            Refunds, transfers, and deferrals follow the rules published for each event. If something is unclear, reach
            out to our team before you pay.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">4. Waivers and safety</h2>
          <p>
            Cycling events involve risk. You may be asked to accept a waiver or release as part of registration. You
            agree to follow race instructions, marshals, and traffic laws. We may remove a participant who puts others
            at risk or violates event rules.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">5. Acceptable use</h2>
          <p>
            Do not misuse the site: no unlawful activity, harassment, scraping that harms performance, attempts to
            bypass security, or false payment information. We may suspend access when we reasonably need to protect users
            or the platform.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">6. Service changes and availability</h2>
          <p>
            We aim for reliable service but do not guarantee uninterrupted access. We may update features, schedules, or
            these Terms. When we post changes here, continued use after the “Last updated” date means you accept the
            revised Terms for new activity.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">7. Limitation of liability</h2>
          <p>
            To the fullest extent allowed by law, we are not liable for indirect or consequential losses (for example
            lost profits or missed travel) arising from your use of the site or participation in events, except where
            liability cannot be excluded under applicable law. Nothing in these Terms limits liability for death or
            personal injury caused by negligence where the law does not allow that limit.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">8. Contact</h2>
          <p>
            Questions about these Terms? Contact All Out Multisports through the channels listed on our main website.
          </p>
        </section>
      </div>

      <p className="mt-12 text-sm text-slate-600">
        Also read our{' '}
        <Link to="/privacy" className="font-semibold text-[#1e4a8e] hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </article>
  )
}
