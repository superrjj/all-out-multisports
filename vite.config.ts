import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

/** Vercel sets this on each production build; override locally with VITE_BUILD_ID if needed. */
const appBuildId =
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  process.env.VITE_BUILD_ID?.trim() ||
  'local'

function emitBuildMetaJson(): Plugin {
  let outDir = 'dist'
  return {
    name: 'emit-build-meta-json',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      writeFileSync(
        join(process.cwd(), outDir, 'build-meta.json'),
        `${JSON.stringify({ buildId: appBuildId })}\n`,
        'utf8',
      )
    },
  }
}

export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(appBuildId),
  },
  plugins: [
    babel({ presets: [reactCompilerPreset()] }), // babel() muna bago react()
    react(),
    tailwindcss(),
    emitBuildMetaJson(),
  ],
})