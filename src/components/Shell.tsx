import type { ReactNode } from 'react'
import { Header } from './homepage/header'
import { Container } from './homepage/container'

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <Header />
      <main className="flex-1">
        <Container>{children}</Container>
      </main>
      <footer className="border-t border-slate-200 bg-slate-50/80 py-3 text-xs text-slate-500 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-center px-4">
          <span className="rounded-full bg-white/80 px-4 py-1 shadow-sm shadow-slate-200">
            Developed by <span className="font-medium text-slate-800">John Harvee Quirido (Team D&R Marging Racing)</span>
          </span>
        </div>
      </footer>
    </div>
  )
}
