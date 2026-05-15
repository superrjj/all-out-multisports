import { ArrowUpRight, CheckCircle2 } from 'lucide-react'

const TALLY_REGISTRATION_URL = 'https://tally.so/r/0QbbrA'

export function UnderMaintenancePage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:max-w-md sm:p-5">
        <img
          src="/undraw_maintenance_4unj.png"
          alt="Site maintenance — our team is fixing the payment system"
          className="mx-auto h-28 w-auto sm:h-32"
        />

        <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-wider text-[#1e4a8e]">
          Hari ng Ahon 2026 · Criterium &amp; ITT
        </p>

        <h1 className="mt-1.5 text-center text-lg font-semibold text-slate-900">
          We&apos;re fixing online checkout
        </h1>

        <p className="mt-2 text-center text-xs leading-relaxed text-slate-600">
          PayMongo is temporarily unavailable on this site. Registration is still open via our official
          Tally form below.
        </p>

        <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
          <p className="font-medium text-slate-900">What to do now</p>
          <ul className="space-y-1.5">
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1e4a8e]" aria-hidden />
              <span>
                Tap <strong>Register on Tally</strong> for Criterium or ITT.
              </span>
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1e4a8e]" aria-hidden />
              <span>Fill in email, event, category, and rider details.</span>
            </li>
            <li className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#1e4a8e]" aria-hidden />
              <span>Follow Tally payment steps if shown.</span>
            </li>
          </ul>
        </div>

        <a
          href={TALLY_REGISTRATION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#1e4a8e] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#163b71] sm:text-sm"
        >
          Register on Tally
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </a>
        <p className="mt-1.5 text-center text-[10px] text-slate-500">Opens in a new tab</p>

        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">
          <p>
            <span className="font-medium text-slate-700">Already paid here?</span> Keep your PayMongo
            receipt and contact organizers if needed.
          </p>
          <p>
            <span className="font-medium text-slate-700">Site checkout?</span> Back online once the fix
            is verified.
          </p>
        </div>
      </div>

      <p className="mt-4 text-center text-[10px] text-slate-400">
        All Out Multisports · Hari ng Ahon
      </p>
    </div>
  )
}
