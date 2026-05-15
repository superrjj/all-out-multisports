export function UnderMaintenancePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-12 text-slate-800">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <img
          src="/all_out_multisports_1.png"
          alt="All Out Multisports"
          className="mx-auto mb-6 h-12 w-auto"
        />

        <h1 className="text-xl font-semibold text-slate-900">We&apos;ll be back soon</h1>

        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Online registration is temporarily paused while we fix a payment issue.
          Please check back later.
        </p>

        <p className="mt-4 text-xs text-slate-500">
          Already paid? Keep your PayMongo receipt and contact the event organizers.
        </p>
      </div>
    </div>
  )
}
