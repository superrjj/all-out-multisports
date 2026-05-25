/** Strip accidental event-type suffixes from stored refs (legacy import appended `-criterium` / `-individual-time-trial`). */
export function normalizePaymentReferenceDisplay(raw: string): string {
  let v = String(raw ?? '').trim()
  if (!v) return ''
  v = v.replace(/-individual-time-trial$/i, '')
  v = v.replace(/-criterium$/i, '')
  v = v.replace(/-individual-?$/i, '')
  v = v.replace(/-individual$/i, '')
  return v.trim()
}

/** True PayMongo gateway id (pay_…); excludes complimentary pay_SPONSORED / pay_BPI_ATTY placeholders. */
export function isPaymongoPaymentReferenceId(raw: string) {
  const v = normalizePaymentReferenceDisplay(raw)
  if (!v.startsWith('pay_')) return false
  return !isComplimentaryPayPrefixReference(v)
}

/** Onsite cash payment ids (e.g. ONSITE_CASH10) stored on payment_orders. */
export function isOnsiteCashPaymentReference(raw: string) {
  const v = normalizePaymentReferenceDisplay(raw)
  return /^ONSITE_CASH\d*$/i.test(v)
}

/** Free champion / complimentary entry (e.g. CHAMPION, CHAMPION3). */
export function isChampionPaymentReference(raw: string) {
  const v = normalizePaymentReferenceDisplay(raw)
  return /^CHAMPION\d*$/i.test(v)
}

/** Sponsored / free entry (e.g. pay_SPONSORED1). */
export function isSponsoredPaymentReference(raw: string) {
  const v = normalizePaymentReferenceDisplay(raw)
  return /^pay_SPONSORED\d*$/i.test(v)
}

/** BPI attorney complimentary entry (e.g. pay_BPI_ATTY2). */
export function isBpiAttyPaymentReference(raw: string) {
  const v = normalizePaymentReferenceDisplay(raw)
  return /^pay_BPI_ATTY\d*$/i.test(v)
}

/** pay_… placeholders for libre entry — not real PayMongo charge ids. */
export function isComplimentaryPayPrefixReference(raw: string) {
  return isSponsoredPaymentReference(raw) || isBpiAttyPaymentReference(raw)
}

/** Internal / non-PayMongo refs shown in Reference No. and used for bib assignment. */
export function isInternalPaymentReference(raw: string) {
  return (
    isOnsiteCashPaymentReference(raw) ||
    isChampionPaymentReference(raw) ||
    isSponsoredPaymentReference(raw) ||
    isBpiAttyPaymentReference(raw)
  )
}

/** Reference is sufficient to assign a bib or import (PayMongo, onsite cash, champion, sponsored, BPI atty). */
export function isBibAssignablePaymentReference(raw: string) {
  const v = normalizePaymentReferenceDisplay(raw)
  if (!v) return false
  return isPaymongoPaymentReferenceId(v) || isInternalPaymentReference(v)
}

/** Shown in Reference No. column and used to enable Generate bib. */
export function getDisplayPaymentReference(raw: string) {
  const v = normalizePaymentReferenceDisplay(raw)
  return isBibAssignablePaymentReference(v) ? v : ''
}

export const IMPORTABLE_PAYMENT_ID_HINT =
  'pay_…, ONSITE_CASH…, CHAMPION…, pay_SPONSORED…, or pay_BPI_ATTY…'
