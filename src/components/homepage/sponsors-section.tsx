import { useEffect, useMemo, useRef } from 'react'

type Sponsor = {
  id: string
  name: string
  logoSrc?: string
}

function publicImage(path: string) {
  return encodeURI(path)
}

const SPONSORS: Sponsor[] = [
  { id: 'allout', name: 'All Out Multisports', logoSrc: publicImage('/All out multisports logo.png') },
  { id: 'arteo', name: 'Arteo', logoSrc: publicImage('/Arteo.png') },
  { id: 'baguio', name: 'City of Baguio', logoSrc: publicImage('/CITY OF BAGUIO LOGO.png') },
  { id: 'manok', name: 'Manok ni Kuya Xy', logoSrc: publicImage('/Manok ni Kuya Xy.png') },
  { id: 'mblist', name: 'MBLIST', logoSrc: publicImage('/MBLIST.png') },
  { id: 'reinforcement', name: 'Reinforcement', logoSrc: publicImage('/Reinforcement.png') },
  { id: 'solis', name: 'Solis Bakery', logoSrc: publicImage('/SOLIS.png') },
]

export function SponsorsSection() {
  const sectionRef = useRef<HTMLElement>(null)
  const loopItems = useMemo(() => [...SPONSORS, ...SPONSORS], [])

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'))
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          ;(entry.target as HTMLElement).dataset.revealed = 'true'
          io.unobserve(entry.target)
        }
      },
      { threshold: 0.12 },
    )
    items.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [])

  return (
    <section ref={sectionRef} className="bg-white px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
      <style>{`
        [data-reveal] { opacity: 0; transform: translateY(10px); transition: opacity 600ms ease, transform 600ms ease; }
        [data-reveal][data-revealed="true"] { opacity: 1; transform: translateY(0); }
        @media (prefers-reduced-motion: reduce) {
          [data-reveal] { transition: none; transform: none; opacity: 1; }
        }
        .sp-track { display: flex; gap: 40px; width: max-content; animation: sp-scroll 20s linear infinite; align-items: center; }
        @keyframes sp-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @media (prefers-reduced-motion: reduce) { .sp-track { animation: none; } }
      `}</style>

      <div className="mx-auto w-full max-w-6xl">
        <div data-reveal className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Sponsors &amp; Partners
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            2026 Sponsors &amp; Partners
          </h2>
        </div>

        <div className="my-8 h-px bg-slate-200" />

        <div data-reveal className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-white to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-white to-transparent" />

          <div className="sp-track">
            {loopItems.map((s, idx) => (
              <div
                key={`${s.id}-${idx}`}
                className="flex h-[72px] w-[140px] shrink-0 items-center justify-center"
              >
                {s.logoSrc && (
                  <img
                    src={s.logoSrc}
                    alt={idx < SPONSORS.length ? s.name : ''}
                    className="h-full w-full object-contain grayscale-[30%] transition-all hover:grayscale-0"
                    loading="lazy"
                    draggable={false}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}