// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
import QRCode from 'npm:qrcode@1.5.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? ''

const DEFAULT_PUBLIC_SITE_URL = 'https://www.alloutmultisports.com'
const CERT_BUCKET = (Deno.env.get('CERT_BUCKET') ?? '').trim()

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  })
}

function normalizeEventType(raw: string | null | undefined) {
  const first = String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)[0]
  if (!first) return 'Criterium'
  return first
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function escXml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[])
  }
  return btoa(binary)
}

function certObjectPath(registrationId: string, bibNumber: string) {
  const safeBib = String(bibNumber ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
  const safeReg = String(registrationId ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
  return `race-claim-kit/${safeReg || 'reg'}-${safeBib || 'bib'}.png`
}

async function optimisePng(png: Uint8Array): Promise<Uint8Array> {
  // Lossless PNG compression before saving to Storage.
  // Falls back to original PNG if optimisation isn't available in this runtime.
  // IMPORTANT: Edge CPU budgets are tight; keep this best-effort and fast.
  try {
    const { optimise } = await import('npm:@jsquash/oxipng@2.3.0')
    // Level 2 is a good tradeoff (levels >3 can be slow).
    const optimiseWork = optimise(png.buffer, { level: 2 }) as unknown as Promise<ArrayBuffer>
    const timeoutMs = 1200
    const out = (await Promise.race([
      optimiseWork,
      new Promise<ArrayBuffer>((_resolve, reject) =>
        setTimeout(() => reject(new Error(`oxipng timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ])) as ArrayBuffer
    const bytes = new Uint8Array(out)
    console.log(`[png] oxipng: ${png.length} -> ${bytes.length} bytes`)
    return bytes.length > 0 ? bytes : png
  } catch (e) {
    console.warn('[png] oxipng optimise failed; using original PNG', (e as Error)?.message ?? e)
    return png
  }
}

async function fetchDataUrl(assetPath: string): Promise<string | null> {
  const base = String(
    Deno.env.get('PUBLIC_SITE_URL') ?? Deno.env.get('FRONTEND_URL') ?? DEFAULT_PUBLIC_SITE_URL,
  ).replace(/\/$/, '')
  try {
    const url = `${base}${assetPath.startsWith('/') ? assetPath : `/${assetPath}`}`
    const r = await fetch(url, { redirect: 'follow' })
    if (!r.ok) return null
    const buf = new Uint8Array(await r.arrayBuffer())
    const ct = r.headers.get('content-type') ?? 'image/png'
    return `data:${ct};base64,${bytesToBase64(buf)}`
  } catch {
    return null
  }
}

let wasmInitialised = false

async function svgToPng(svg: string): Promise<Uint8Array> {
  const { initWasm, Resvg } = await import('npm:@resvg/resvg-wasm@2.4.0')
  if (!wasmInitialised) {
    const wasmResp = await fetch('https://unpkg.com/@resvg/resvg-wasm@2.4.0/index_bg.wasm')
    await initWasm(wasmResp)
    wasmInitialised = true
  }

  const fontFiles = [
    'Inter_18pt-Regular.ttf',
    'Inter_18pt-Black.ttf',
    'Inter_18pt-Bold.ttf',
    'Inter_18pt-ExtraBold.ttf',
  ]
  const fontBuffers = (
    await Promise.all(
      fontFiles.map(async (path) => {
        const { data, error } = await supabaseAdmin.storage
          .from('fonts')
          .download(path)
        if (error || !data) {
          console.warn(`[svgToPng] failed to load font: ${path}`, error?.message)
          return null
        }
        return new Uint8Array(await data.arrayBuffer())
      })
    )
  ).filter((b): b is Uint8Array => b !== null)

  console.log(`[svgToPng] font buffers loaded: ${fontBuffers.length}/4`)

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1280 },
    font: {
      fontBuffers,
      // Always allow system fonts as a hard fallback so text never renders blank.
      loadSystemFonts: true,
      // Fonts can have different internal family names across builds (e.g. "Inter" vs "Inter 18pt").
      // If the family name doesn't match what's used in the SVG, resvg renders <text> as blank.
      defaultFontFamily: 'Inter',
      sansSerifFamily: 'Inter',
      serifFamily: 'Inter',
      cursiveFamily: 'Inter',
      fantasyFamily: 'Inter',
      monospaceFamily: 'Inter',
    },
  })
  return resvg.render().asPng()
}

function buildCertificateSvg(args: {
  riderName: string
  eventTitle: string
  bibNumber: string
  category: string
  discipline: string
  eventType: string
  verificationId: string
  qrDataUrl: string
  allOutLogoDataUrl: string | null
  hnaLogoDataUrl: string | null
}) {
  const W = 1280
  const H = 720
  const navy = '#1A2B5F'
  const bg = '#EFF3FA'
  const gold = '#D4A84B'
  const leftX = 56
  const riderUpper = escXml(args.riderName.toUpperCase())
  const eventUpper = escXml(args.eventTitle.toUpperCase())
  const bibEsc = escXml(args.bibNumber)
  const catEsc = escXml(args.category)
  const discEsc = escXml(args.discipline)
  const evtEsc = escXml(args.eventType)
  const regEsc = escXml(args.verificationId)

  const logoBlock = (() => {
    const y = 72
    const h = 56
    const parts: string[] = []
    if (args.allOutLogoDataUrl) {
      parts.push(
        `<image href="${args.allOutLogoDataUrl}" x="${leftX}" y="${y}" width="170" height="${h}" preserveAspectRatio="xMidYMid meet" />`,
      )
    }
    if (args.hnaLogoDataUrl) {
      parts.push(
        `<image href="${args.hnaLogoDataUrl}" x="${leftX + 182}" y="${y}" width="120" height="${h}" preserveAspectRatio="xMidYMid meet" />`,
      )
    }
    return parts.join('\n')
  })()

  const ff = 'sans-serif'
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <rect x="0" y="0" width="${W}" height="22" fill="${navy}"/>
  <rect x="0" y="${H - 22}" width="${W}" height="22" fill="${navy}"/>
  <path d="M ${W - 100} 0 L ${W} 0 L ${W} 72 Z" fill="${gold}"/>  
  <circle cx="470" cy="380" r="220" fill="#94A3B8" opacity="0.08"/>
  ${logoBlock}
  <text x="${leftX}" y="168" font-family="${ff}" font-size="11" font-weight="700" fill="#64748B" letter-spacing="0.15em">QR CODE - RACE CLAIM KIT</text>
  <text x="${leftX}" y="198" font-family="${ff}" font-size="22" font-weight="700" fill="${navy}">${eventUpper}</text>
  <text x="${leftX}" y="242" font-family="${ff}" font-size="11" font-weight="700" fill="#64748B">RIDER NAME</text>
  <text x="${leftX}" y="298" font-family="${ff}" font-size="44" font-weight="800" fill="${navy}">${riderUpper}</text>
  <rect x="${leftX}" y="318" width="360" height="120" rx="18" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.5"/>
  <text x="${leftX + 22}" y="360" font-family="${ff}" font-size="14" font-weight="700" fill="#475569">BIB NUMBER</text>
  <text x="${leftX + 20}" y="412" font-family="${ff}" font-size="56" font-weight="900" fill="#0F172A">${bibEsc}</text>
  <text x="${leftX}" y="492" font-family="${ff}" font-size="12" font-weight="700" fill="#475569">CATEGORY</text>
  <text x="${leftX}" y="512" font-family="${ff}" font-size="22" font-weight="700" fill="#0F172A">${catEsc}</text>
  <text x="540" y="492" font-family="${ff}" font-size="12" font-weight="700" fill="#475569">DISCIPLINE</text>
  <text x="540" y="512" font-family="${ff}" font-size="22" font-weight="700" fill="#0F172A">${discEsc}</text>
  <text x="${leftX}" y="556" font-family="${ff}" font-size="12" font-weight="700" fill="#475569">EVENT TYPE</text>
  <text x="${leftX}" y="576" font-family="${ff}" font-size="20" font-weight="700" fill="#0F172A">${evtEsc}</text>
  <rect x="808" y="140" width="416" height="440" rx="24" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.5"/>
  <image href="${args.qrDataUrl}" x="920" y="176" width="192" height="192" preserveAspectRatio="xMidYMid meet"/>
  <text x="1016" y="400" font-family="${ff}" font-size="36" font-weight="900" fill="#0F172A" text-anchor="middle">${bibEsc}</text>
  <text x="1016" y="432" font-family="${ff}" font-size="14" font-weight="700" fill="#64748B" text-anchor="middle">${regEsc}</text>
</svg>`
}

async function buildCertificatePngBytes(registrationId: string, bibNumber: string): Promise<Uint8Array> {
  const [{ data: reg, error: regErr }, logos] = await Promise.all([
    supabaseAdmin
      .from('registration_forms')
      .select('id, event_id, race_category_id, entry_event_type_slug, entry_event_type_label')
      .eq('id', registrationId)
      .maybeSingle(),
    Promise.all([fetchDataUrl('/allout-logo.png'), fetchDataUrl('/hna-logo.png')]),
  ])
  if (regErr) throw regErr
  if (!reg?.id) throw new Error('Registration not found while building certificate.')

  const [{ data: rider, error: riderErr }, { data: event, error: eventErr }, { data: raceCategory, error: rcErr }] =
    await Promise.all([
      supabaseAdmin
        .from('registration_rider_details')
        .select('first_name, last_name, age_category, discipline')
        .eq('registration_id', registrationId)
        .maybeSingle(),
      supabaseAdmin.from('events').select('id, title, race_type').eq('id', reg.event_id).maybeSingle(),
      reg.race_category_id
        ? supabaseAdmin.from('race_categories').select('category_name, code').eq('id', reg.race_category_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
  if (riderErr) throw riderErr
  if (eventErr) throw eventErr
  if (rcErr) throw rcErr

  const riderName = [rider?.first_name, rider?.last_name].filter(Boolean).join(' ').trim() || 'Registered Rider'
  const category = String(rider?.age_category ?? raceCategory?.category_name ?? 'Open Category')
  const discipline = String(rider?.discipline ?? event?.race_type ?? 'Cycling')
  const eventType = String(reg.entry_event_type_label ?? '').trim() || normalizeEventType(event?.race_type)
  const verificationId = `REG-${new Date().getFullYear()}-${String(registrationId).replace(/-/g, '').slice(0, 10)}`
  const qrPayload = JSON.stringify({
    version: 2,
    type: 'registration_qr',
    bib_number: String(bibNumber),
    verification_id: verificationId,
    event_id: String(event?.id ?? reg.event_id ?? ''),
    registration_id: registrationId,
    event_type_slug: String(reg.entry_event_type_slug ?? '').trim() || null,
    event_type_label: String(reg.entry_event_type_label ?? '').trim() || null,
    category_code: String(raceCategory?.code ?? '').trim() || null,
  })
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 1, width: 512 })

  const svg = buildCertificateSvg({
    riderName,
    eventTitle: String(event?.title ?? 'Hari ng Ahon'),
    bibNumber: String(bibNumber),
    category,
    discipline,
    eventType,
    verificationId,
    qrDataUrl,
    allOutLogoDataUrl: logos[0],
    hnaLogoDataUrl: logos[1],
  })
  const pngBytes = await svgToPng(svg)
  return await optimisePng(pngBytes)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  console.log('[send-race-claim-certificate-email] POST received')

  if (!CERT_BUCKET) {
    console.warn('[send-race-claim-certificate-email] missing CERT_BUCKET')
    return jsonResponse({ error: 'CERT_BUCKET is not configured for this project.' }, 503)
  }

  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ code: 'UNAUTHORIZED_NO_AUTH_HEADER', message: 'Missing authorization header' }, 401)

  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(jwt)
  if (authError || !authData?.user?.id) {
    return jsonResponse({ code: 'UNAUTHORIZED_INVALID_TOKEN', message: 'Invalid or expired token' }, 401)
  }
  const userId = authData.user.id

  let body: {
    registrationId?: string
    registrationIds?: string[]
    adminSend?: boolean
    forceResend?: boolean
    generateOnly?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  const registrationId = String(body.registrationId ?? '').trim()
  if (!registrationId) return jsonResponse({ error: 'Missing registrationId' }, 400)

  console.log('[send-race-claim-certificate-email] processing registration', registrationId)

  const { data: registration, error: regLookupError } = await supabaseAdmin
    .from('registration_forms')
    .select(
      'id, user_id, event_id, race_category_id, bib_number, registrant_email, status, entry_event_type_label, checkout_bundle_id',
    )
    .eq('id', registrationId)
    .maybeSingle()

  if (regLookupError) return jsonResponse({ error: regLookupError.message }, 500)
  if (!registration?.id) return jsonResponse({ error: 'Registration not found' }, 404)
  const { data: actorRoleRow } = await supabaseAdmin.from('users').select('role').eq('id', userId).maybeSingle()
  const isAdmin = String(actorRoleRow?.role ?? '').toLowerCase() === 'admin'

  if (!isAdmin && String(registration.user_id ?? '') !== userId) {
    const bid = String(registration.checkout_bundle_id ?? '').trim()
    if (!bid) return jsonResponse({ code: 'FORBIDDEN', message: 'Not your registration' }, 403)
    const { data: bundlePay } = await supabaseAdmin
      .from('payment_orders')
      .select('registration_id')
      .eq('checkout_bundle_id', bid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!bundlePay?.registration_id) {
      return jsonResponse({ code: 'FORBIDDEN', message: 'Not your registration' }, 403)
    }
    const { data: primaryRow } = await supabaseAdmin
      .from('registration_forms')
      .select('user_id')
      .eq('id', bundlePay.registration_id)
      .maybeSingle()
    if (String(primaryRow?.user_id ?? '') !== userId) {
      return jsonResponse({ code: 'FORBIDDEN', message: 'Not your registration' }, 403)
    }
  }

  const recipient = String(registration.registrant_email ?? '').trim().toLowerCase()
  if (!recipient) return jsonResponse({ error: 'Registration has no email address.' }, 400)
  const forceResend = Boolean(body.forceResend)
  const generateOnly = Boolean(body.generateOnly)

  if (!generateOnly) {
    if (!RESEND_API_KEY.trim()) {
      console.warn('[send-race-claim-certificate-email] missing RESEND_API_KEY')
      return jsonResponse({ error: 'RESEND_API_KEY is not configured for this project.' }, 503)
    }
    if (!RESEND_FROM.trim()) {
      console.warn('[send-race-claim-certificate-email] missing RESEND_FROM')
      return jsonResponse({ error: 'RESEND_FROM is not configured. Set it in .env / Supabase Edge secrets.' }, 503)
    }
  }

  const requestedIds = Array.isArray(body.registrationIds)
    ? body.registrationIds.map((id) => String(id ?? '').trim()).filter(Boolean)
    : []
  const bundleRef = registration.checkout_bundle_id ? String(registration.checkout_bundle_id) : ''
  const defaultIds = bundleRef
    ? (
        await supabaseAdmin
          .from('registration_forms')
          .select('id')
          .eq('checkout_bundle_id', bundleRef)
          .order('created_at', { ascending: true })
      ).data?.map((r) => String(r.id)) ?? [registrationId]
    : [registrationId]
  const targetIds = (requestedIds.length > 0 ? requestedIds : defaultIds).filter(Boolean)

  const { data: targetRegs, error: targetRegsErr } = await supabaseAdmin
    .from('registration_forms')
    .select('id, bib_number, registrant_email, status, checkout_bundle_id')
    .in('id', targetIds)
    .order('created_at', { ascending: true })
  if (targetRegsErr) return jsonResponse({ error: targetRegsErr.message }, 500)
  if (!targetRegs?.length) return jsonResponse({ error: 'No registration rows found for this send request.' }, 404)

  const { data: alreadySentRows, error: priorErr } = await supabaseAdmin
    .from('notification_deliveries')
    .select('registration_id')
    .in('registration_id', targetRegs.map((r) => String(r.id)))
    .eq('channel', 'email')
    .eq('recipient', recipient)
    .eq('payload->>type', 'registration_certificate')
    .eq('status', 'sent')
  if (priorErr) return jsonResponse({ error: priorErr.message }, 500)
  const alreadySent = new Set((alreadySentRows ?? []).map((r) => String(r.registration_id)))

  const attachments: Array<{ filename: string; content: string }> = []
  const sentIds: string[] = []
  const missingStorage: Array<{ registration_id: string; storage_path: string }> = []
  const missingBib: string[] = []
  const notPaid: string[] = []

  for (const regRow of targetRegs) {
    const rid = String(regRow.id)
    if (!forceResend && alreadySent.has(rid)) continue
    const regStatus = String(regRow.status ?? '').toLowerCase()
    if (!['confirmed', 'paid'].includes(regStatus)) {
      notPaid.push(rid)
      continue
    }
    const bibNumber = String(regRow.bib_number ?? '').trim()
    if (!bibNumber) {
      missingBib.push(rid)
      continue
    }
    const objectPath = certObjectPath(rid, bibNumber)
    const existing = await supabaseAdmin.storage.from(CERT_BUCKET).download(objectPath)
    let pngBytes: Uint8Array | null = null
    if (existing.error || !existing.data) {
      try {
        const generated = await buildCertificatePngBytes(rid, bibNumber)
        const { error: uploadErr } = await supabaseAdmin.storage.from(CERT_BUCKET).upload(objectPath, generated, {
          contentType: 'image/png',
          upsert: true,
        })
        if (uploadErr) throw uploadErr
        pngBytes = generated
      } catch {
        missingStorage.push({ registration_id: rid, storage_path: objectPath })
        continue
      }
    } else {
      pngBytes = new Uint8Array(await existing.data.arrayBuffer())
    }
    if (!pngBytes) {
      missingStorage.push({ registration_id: rid, storage_path: objectPath })
      continue
    }
    attachments.push({
      filename: `race-claim-kit-${bibNumber.replace(/[^a-zA-Z0-9_-]/g, '')}.png`,
      content: bytesToBase64(pngBytes),
    })
    sentIds.push(rid)
  }

  if (attachments.length === 0) {
    return jsonResponse(
      {
        error: 'No certificate attachments ready yet.',
        code: missingStorage.length > 0 ? 'CERT_NOT_UPLOADED' : 'CERT_NOT_READY',
        missing_storage: missingStorage,
        missing_bib: missingBib,
        not_paid: notPaid,
      },
      409,
    )
  }

  if (generateOnly) {
    return jsonResponse(
      {
        ok: true,
        generated: true,
        generated_registration_ids: sentIds,
        generated_count: sentIds.length,
      },
      200,
    )
  }

  const eventTitle = 'Hari ng Ahon'
  const emailSubject =
    attachments.length > 1
      ? `Your QR Code Race Claim Kits - ${eventTitle}`
      : `Your QR Code Race Claim Kit - ${eventTitle}`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [recipient],
      subject: emailSubject,
      html: `<p>Thank you for registering. Your payment is confirmed.</p>
<p>Attached ${attachments.length > 1 ? 'are your' : 'is your'} <strong>QR Code – Race Claim Kit</strong> certificate${attachments.length > 1 ? 's' : ''}. Present ${attachments.length > 1 ? 'them' : 'this'} at kit claiming.</p>`,
      attachments,
    }),
  })

  if (!resendRes.ok) {
    const errText = await resendRes.text()
    console.error('[send-race-claim-certificate-email] Resend error', resendRes.status, errText)
    return jsonResponse({ error: 'Failed to send email.', detail: errText.slice(0, 500) }, 502)
  }

  console.log('[send-race-claim-certificate-email] Resend accepted for', registrationId, recipient)

  const now = new Date().toISOString()
  const rows = sentIds.map((rid) => ({
    user_id: null,
    registration_id: rid,
    channel: 'email',
    recipient,
    subject: emailSubject,
    payload: {
      type: 'registration_certificate',
      registration_id: rid,
      storage_bucket: CERT_BUCKET,
      storage_path: certObjectPath(rid, String((targetRegs.find((t) => String(t.id) === rid)?.bib_number ?? ''))),
      bundle_email: sentIds.length > 1,
      bundle_count: sentIds.length,
    },
    status: 'sent',
    created_at: now,
  }))
  const { error: insertErr } = await supabaseAdmin.from('notification_deliveries').insert(rows)

  if (insertErr) {
    console.error('notification_deliveries insert', insertErr)
  }

  return jsonResponse({ ok: true, sent: true, sent_registration_ids: sentIds, sent_count: sentIds.length }, 200)
})