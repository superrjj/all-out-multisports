import { User, ChevronRight} from 'lucide-react'
import { Link } from 'react-router-dom'

export function Hero() {
  return (
    <div className="bg-[#131313] text-[#e5e2e1]">
      <section className="relative flex min-h-[calc(100svh-5rem)] items-center overflow-hidden border-b border-[#464932] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        
        {/* Background Image */}
        <img
          src="/bg2.png"
          alt="Hero race"
          className="absolute inset-0 h-full w-full object-cover"
        />

        {/* Heavy dark on left for text legibility */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.60) 30%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0.0) 65%)',
          }}
        />

        {/* Vignette: darkens top, bottom, and right edges — leaves rider bright */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 80% at 62% 45%, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.80) 100%)',
          }}
        />

        {/* Bottom fade into page */}
        <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        {/* Top fade */}
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/40 to-transparent" />

        {/* Content */}
        <div className="relative z-10 mx-auto w-full max-w-7xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-[#cfae3f] px-3 py-1.5 sm:px-4 sm:py-2">
            <svg className="h-3.5 w-3.5 text-black" fill="currentColor" viewBox="0 0 24 24">
              <path d="M5 3h14a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm7 6c-3.31 0-6 2.24-6 5s2.69 5 6 5 6-2.24 6-5-2.69-5-6-5zm0 2c1.1 0 2 1.34 2 3s-.9 3-2 3-2-1.34-2-3 .9-3 2-3z" />
            </svg>
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-black sm:text-xs">
              Bike Challenge Series
            </span>
          </div>

          {/* Headline */}
          <h1 className="mt-5 max-w-3xl text-4xl font-black uppercase leading-[1.0] tracking-tight text-white sm:mt-6 sm:text-6xl md:text-7xl lg:text-8xl">
            Hari ng Ahon:
            <br />
            <span className="text-[#cfae3f]">Lions Head &</span>
            <br />
            <span className="text-[#cfae3f]">Burham Park</span>
          </h1>

          {/* Description */}
          <p className="mt-5 max-w-lg border-l-4 border-white pl-4 text-sm leading-relaxed text-white/80 sm:mt-6 sm:pl-5 sm:text-base italic">
            The ultimate test of endurance and power.
            <br />
            Conquer the legendary ascents of Baguio City and
            <br />
            cement your legacy in the most grueling high-altitude
            <br />
            cycling race in the Philippines.
          </p>

          {/* CTA Buttons */}
          <div className="mt-7 flex flex-wrap gap-3 sm:mt-8 sm:gap-4">
            <Link
              to="/register/info"
              className="inline-flex items-center gap-2.5 rounded-full bg-[#cfae3f] px-7 py-3.5 text-[11px] font-black uppercase tracking-[0.15em] text-black transition-all hover:bg-[#e2bf4e] hover:scale-105 sm:px-9 sm:py-4 sm:text-xs"
            >
              <User className="h-4 w-4" />
              Register Now
              <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}