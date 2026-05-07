import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { registrationService } from '../services/registrationService'

const CERT_BUCKET = String(import.meta.env.VITE_CERT_BUCKET ?? '').trim()

function certObjectPath(registrationId: string, bibNumber: string) {
  const safeBib = String(bibNumber ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
  const safeReg = String(registrationId ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
  return `race-claim-kit/${safeReg || 'reg'}-${safeBib || 'bib'}.png`
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Unable to load image asset: ${src}`))
    img.src = src
  })
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return await res.blob()
}

async function renderCertificateToDataUrl(data: {
  riderName: string
  category: string
  discipline: string
  eventType: string
  bibNumber: string
  eventTitle: string
  verificationId: string
  qrValue: string
}) {
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 720
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Unable to initialize certificate canvas.')

  const [allOutLogo, hnaLogo, qrDataUrl] = await Promise.all([
    loadImage('/all_out_multisports_1.png').catch(() => null),
    loadImage('/hna-logo.png').catch(() => null),
    QRCode.toDataURL(data.qrValue, { margin: 1, width: 512 }),
  ])
  const qrImage = await loadImage(qrDataUrl)

  ctx.fillStyle = '#EFF3FA'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#1A2B5F'
  ctx.fillRect(0, 0, canvas.width, 22)
  ctx.fillRect(0, canvas.height - 22, canvas.width, 22)
  ctx.fillStyle = '#D4A84B'
  ctx.beginPath()
  ctx.moveTo(canvas.width - 100, 0)
  ctx.lineTo(canvas.width, 0)
  ctx.lineTo(canvas.width, 72)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = 'rgba(148,163,184,0.08)'
  ctx.beginPath()
  ctx.arc(470, 380, 220, 0, Math.PI * 2)
  ctx.fill()

  let logoX = 56
  if (allOutLogo) {
    const h = 56
    const w = Math.round((allOutLogo.width / Math.max(allOutLogo.height, 1)) * h)
    ctx.drawImage(allOutLogo, logoX, 72, w, h)
    logoX += w + 12
  }
  if (hnaLogo) {
    const h = 56
    const w = Math.round((hnaLogo.width / Math.max(hnaLogo.height, 1)) * h)
    ctx.drawImage(hnaLogo, logoX, 72, w, h)
  }

  ctx.fillStyle = '#64748B'
  ctx.font = '700 11px Arial'
  ctx.fillText('QR CODE - RACE CLAIM KIT', 56, 168)
  ctx.fillStyle = '#1A2B5F'
  ctx.font = '700 22px Arial'
  ctx.fillText(String(data.eventTitle ?? '').toUpperCase(), 56, 198, 700)
  ctx.fillStyle = '#64748B'
  ctx.font = '700 11px Arial'
  ctx.fillText('RIDER NAME', 56, 242)
  ctx.fillStyle = '#1A2B5F'
  ctx.font = '800 44px Arial'
  ctx.fillText(String(data.riderName ?? '').toUpperCase(), 56, 298, 720)

  ctx.fillStyle = '#FFFFFF'
  ctx.strokeStyle = '#CBD5E1'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(56, 318, 360, 120, 18)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#475569'
  ctx.font = '700 14px Arial'
  ctx.fillText('BIB NUMBER', 78, 360)
  ctx.fillStyle = '#0F172A'
  ctx.font = '900 56px Arial'
  ctx.fillText(String(data.bibNumber ?? ''), 76, 412)

  ctx.fillStyle = '#475569'
  ctx.font = '700 12px Arial'
  ctx.fillText('CATEGORY', 56, 492)
  ctx.fillStyle = '#0F172A'
  ctx.font = '700 22px Arial'
  ctx.fillText(String(data.category ?? 'Open Category'), 56, 512, 460)
  ctx.fillStyle = '#475569'
  ctx.font = '700 12px Arial'
  ctx.fillText('DISCIPLINE', 540, 492)
  ctx.fillStyle = '#0F172A'
  ctx.font = '700 22px Arial'
  ctx.fillText(String(data.discipline ?? 'Cycling'), 540, 512, 240)
  ctx.fillStyle = '#475569'
  ctx.font = '700 12px Arial'
  ctx.fillText('EVENT TYPE', 56, 556)
  ctx.fillStyle = '#0F172A'
  ctx.font = '700 20px Arial'
  ctx.fillText(String(data.eventType ?? ''), 56, 576, 460)

  const qrSize = 224
  const qrCardWidth = 416
  const qrCardX = 808
  const qrPadTop = 28
  const qrPadBottom = 28
  const bibGap = 26
  const regGap = 34
  const qrCardHeight = qrPadTop + qrSize + bibGap + regGap + qrPadBottom
  const qrCardY = Math.round(22 + (canvas.height - 44 - qrCardHeight) / 2)
  const qrImgX = qrCardX + (qrCardWidth - qrSize) / 2
  const qrImgY = qrCardY + qrPadTop
  const bibY = qrImgY + qrSize + bibGap
  const regY = bibY + regGap

  ctx.fillStyle = '#FFFFFF'
  ctx.strokeStyle = '#CBD5E1'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(qrCardX, qrCardY, qrCardWidth, qrCardHeight, 24)
  ctx.fill()
  ctx.stroke()
  ctx.drawImage(qrImage, qrImgX, qrImgY, qrSize, qrSize)

  const bibDisplay = String(data.bibNumber ?? '')
  ctx.fillStyle = '#0F172A'
  ctx.font = '900 44px Arial'
  ctx.textAlign = 'center'
  ctx.fillText(bibDisplay, qrCardX + qrCardWidth / 2, bibY)
  ctx.fillStyle = '#64748B'
  ctx.font = '700 15px Arial'
  ctx.fillText(String(data.verificationId ?? ''), qrCardX + qrCardWidth / 2, regY)
  ctx.textAlign = 'start'

  return canvas.toDataURL('image/png', 0.95)
}

export async function generateAndUploadAdminCertificate(registrationId: string) {
  if (!CERT_BUCKET) throw new Error('Missing VITE_CERT_BUCKET (certificate storage bucket name).')
  const cert = await registrationService.getRegistrationCertificateData(registrationId)
  if (!cert) throw new Error('Registration certificate data not found.')
  if (!cert.isPaid) throw new Error('Registration is not paid.')
  if (!String(cert.bibNumber ?? '').trim()) throw new Error('Bib number is missing.')

  const dataUrl = await renderCertificateToDataUrl({
    riderName: cert.riderName,
    category: cert.category,
    discipline: cert.discipline,
    eventType: cert.eventType,
    bibNumber: cert.bibNumber,
    eventTitle: cert.eventTitle,
    verificationId: cert.verificationId,
    qrValue: cert.qrValue,
  })

  const blob = await dataUrlToBlob(dataUrl)
  const objectPath = certObjectPath(registrationId, cert.bibNumber)
  const { error } = await supabase.storage.from(CERT_BUCKET).upload(objectPath, blob, {
    upsert: true,
    contentType: 'image/png',
    cacheControl: '31536000',
  })
  if (error) throw error
}

