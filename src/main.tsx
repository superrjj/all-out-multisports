import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        richColors
        position="top-center"
        offset="max(12px, env(safe-area-inset-top, 0px))"
        mobileOffset="max(12px, env(safe-area-inset-top, 0px))"
        toastOptions={{ classNames: { toast: 'max-w-[calc(100vw-1.5rem)]' } }}
      />
    </BrowserRouter>
  </StrictMode>,
)
