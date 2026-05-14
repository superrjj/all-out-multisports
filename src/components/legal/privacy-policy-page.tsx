import { Link } from 'react-router-dom'

const LAST_UPDATED = 'May 14, 2026'

export function PrivacyPolicyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 text-slate-800 sm:px-6 lg:px-8">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Legal</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-600">All Out Multisports — Hari Ng Ahon online registration</p>
      <p className="mt-6 text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>

      <div className="mt-10 space-y-10 text-sm leading-relaxed text-slate-700">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">1. Summary</h2>
          <p>
            We collect only what we need to run safe events and process your registration. We do not sell your personal
            information. This policy explains what we collect, why we use it, and the choices you have.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">2. Information we collect</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-slate-800">Account details:</strong> name, email address, and password (stored in
              secure form by our authentication provider).
            </li>
            <li>
              <strong className="text-slate-800">Registration details:</strong> information you enter on registration
              forms (for example category, emergency contact, or waiver acknowledgements as shown in the form).
            </li>
            <li>
              <strong className="text-slate-800">Payment information:</strong> payments are handled by our payment
              partner. We typically receive confirmation of payment status, not your full card number.
            </li>
            <li>
              <strong className="text-slate-800">Technical data:</strong> basic logs and device information needed to
              keep the service secure and reliable (for example IP address and browser type in server logs).
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">3. How we use information</h2>
          <p>We use your information to:</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Create and secure your account (including sign-in and email verification).</li>
            <li>Process registrations, payments, refunds, and customer support.</li>
            <li>Run the event safely (for example check-in, results, and required communications).</li>
            <li>Meet legal obligations and prevent fraud or abuse.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">4. Who we share with</h2>
          <p>
            We share data with service providers who help us operate the site and events—for example cloud hosting and
            database services (such as Supabase), payment processing (such as PayMongo), and email delivery. These
            providers may only use your data to perform services for us and are expected to protect it appropriately.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">5. Retention</h2>
          <p>
            We keep registration and payment records for as long as needed to operate the event, meet accounting and
            legal requirements, and resolve disputes. Some logs may be kept for a shorter period for security.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">6. Your choices and rights</h2>
          <p>
            Depending on where you live, you may have rights to access, correct, or delete certain personal data, or to
            object to some processing. To make a request, contact us using the details on our main website. We will
            respond within a reasonable time.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">7. Children</h2>
          <p>
            This service is not directed at children under 13. If you believe we have collected information from a
            child under 13, please contact us so we can delete it.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">8. International transfers</h2>
          <p>
            Our providers may process data in countries other than your own. Where required, we rely on appropriate
            safeguards permitted by law.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">9. Updates</h2>
          <p>
            We may update this policy from time to time. The “Last updated” date at the top shows when it was last
            revised. Please review this page occasionally.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">10. Contact</h2>
          <p>For privacy questions, contact All Out Multisports through the channels listed on our main website.</p>
        </section>
      </div>

      <p className="mt-12 text-sm text-slate-600">
        See also our{' '}
        <Link to="/terms" className="font-semibold text-[#1e4a8e] hover:underline">
          Terms of Service
        </Link>
        .
      </p>
    </article>
  )
}
