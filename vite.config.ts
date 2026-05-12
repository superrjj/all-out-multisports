import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    babel({ presets: [reactCompilerPreset()] }),  // babel() muna bago react()
    react(),
    tailwindcss()
  ],
})