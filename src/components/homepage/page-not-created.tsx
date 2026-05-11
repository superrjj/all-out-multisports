type Props = {
  pageName: string
}

export function PageNotCreated({ pageName }: Props) {
  return (
    <section className="flex min-h-[calc(100vh-10rem)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl text-center">
        <svg
          viewBox="0 0 420 250"
          className="mx-auto mb-4 h-auto w-full max-w-md"
          role="img"
          aria-label="Page not created illustration"
        >
          <defs>
            <linearGradient id="clip" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#9fb7df" />
              <stop offset="100%" stopColor="#6f8fbe" />
            </linearGradient>
          </defs>
          <rect x="145" y="35" width="130" height="175" rx="10" fill="url(#clip)" opacity="0.35" />
          <rect x="160" y="50" width="100" height="145" rx="8" fill="#f7fbff" stroke="#d7e4f7" />
          <rect x="188" y="28" width="44" height="16" rx="6" fill="#aac1e5" />
          <rect x="182" y="92" width="56" height="44" rx="6" fill="#eef4fc" stroke="#d7e4f7" />
          <rect x="193" y="104" width="34" height="6" rx="3" fill="#b7c9e6" />
          <rect x="193" y="114" width="34" height="6" rx="3" fill="#b7c9e6" />
          <circle cx="125" cy="205" r="18" fill="#8ce0a8" opacity="0.7" />
          <circle cx="294" cy="205" r="18" fill="#8ce0a8" opacity="0.7" />
          <path d="M70 210h280" stroke="#c9d8ee" strokeWidth="2" />
          <path d="M294 30l35-8-10 31z" fill="#5b8fe9" opacity="0.9" />
        </svg>
        <p className="text-3xl font-semibold text-slate-800">Page is not created</p>
        <p className="mt-2 text-sm text-slate-500">
          The <span className="font-semibold text-slate-700">{pageName}</span> page has not been created yet.
          Once it is set up, you will be able to view and manage it here.
        </p>
      </div>
    </section>
  )
}

