import { createClient } from '@supabase/supabase-js'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const siteUrl = String(process.env.SITE_URL || 'https://alloutmultisports.com').replace(/\/+$/, '')
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

function isoDate(input) {
  const d = input ? new Date(input) : null
  if (!d || Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function urlEntry(loc, priority, changefreq, lastmod) {
  const lines = ['  <url>', `    <loc>${loc}</loc>`, `    <changefreq>${changefreq}</changefreq>`, `    <priority>${priority}</priority>`]
  if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`)
  lines.push('  </url>')
  return lines.join('\n')
}

async function fetchPublishedEvents() {
  if (!supabaseUrl || !supabaseAnonKey) return []
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } })
  const { data, error } = await supabase
    .from('events')
    .select('id, updated_at, event_date, status')
    .eq('status', 'published')
    .order('event_date', { ascending: true })

  if (error) {
    console.warn('[sitemap] Failed to fetch published events:', error.message)
    return []
  }

  return Array.isArray(data) ? data : []
}

async function generateSitemap() {
  const now = new Date().toISOString()
  const staticUrls = [
    urlEntry(`${siteUrl}/`, '1.0', 'daily', now),
    urlEntry(`${siteUrl}/home`, '0.9', 'weekly', now),
    urlEntry(`${siteUrl}/register/info`, '0.9', 'daily', now),
    urlEntry(`${siteUrl}/auth`, '0.5', 'monthly', now),
  ]

  const events = await fetchPublishedEvents()
  const eventUrls = events.map((event) => {
    const eventId = encodeURIComponent(String(event.id))
    const lastmod = isoDate(event.updated_at) || isoDate(event.event_date) || now
    return urlEntry(`${siteUrl}/register/info?eventId=${eventId}`, '0.8', 'daily', lastmod)
  })

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...staticUrls,
    ...eventUrls,
    '</urlset>',
    '',
  ].join('\n')

  const targetPath = path.resolve(process.cwd(), 'public', 'sitemap.xml')
  await writeFile(targetPath, xml, 'utf8')
  console.log(`[sitemap] Wrote ${targetPath} with ${staticUrls.length + eventUrls.length} URLs.`)
}

generateSitemap().catch((err) => {
  console.error('[sitemap] Generation failed:', err)
  process.exitCode = 1
})
