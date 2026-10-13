import { now } from './clock'

const MINUS = '−' // true minus sign, as in the design
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

/** ₹1,23,45,678.00 · −₹12,390.00 */
export function inr(n: number): string {
  return (n < 0 ? MINUS : '') + '₹' + nf2.format(Math.abs(n))
}

/** 38,42,600.00 (no symbol, for dense tables) */
export function num2(n: number): string {
  return (n < 0 ? MINUS : '') + nf2.format(Math.abs(n))
}

/** 1,000 */
export function int(n: number): string {
  return (n < 0 ? MINUS : '') + nf0.format(Math.abs(n))
}

/** +₹4,720.00 for differences */
export function inrDelta(n: number): string {
  return (n > 0 ? '+' : '') + inr(n)
}

/** KPI scale: { v: '₹1.87', u: 'Cr' } or { v: '₹48.6', u: 'L' } */
export function lakhCr(n: number): { v: string; u: string } {
  const sign = n < 0 ? MINUS : ''
  const a = Math.abs(n)
  if (a >= 1e7) return { v: sign + '₹' + (a / 1e7).toFixed(2), u: 'Cr' }
  if (a >= 1e5) return { v: sign + '₹' + (a / 1e5).toFixed(1), u: 'L' }
  return { v: sign + '₹' + nf0.format(a), u: '' }
}

/** One-string form of lakhCr: ₹9.84 L */
export function lakhCrStr(n: number): string {
  const { v, u } = lakhCr(n)
  return u ? `${v} ${u}` : v
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

// Dates are stored as ISO strings in IST wall-clock ('2026-10-13' or '2026-10-13T10:40').
// Parsing the parts directly avoids timezone shifts in the browser.
function parts(iso: string) {
  const [d, t] = iso.split('T')
  const [y, m, day] = d.split('-').map(Number)
  const [hh, mm] = (t ?? '').split(':')
  return { y, m, day, time: t ? `${hh}:${mm}` : '' }
}

/** 13-10-2026, used in tables */
export function date(iso?: string | null): string {
  if (!iso) return '—'
  const p = parts(iso)
  return `${pad(p.day)}-${pad(p.m)}-${p.y}`
}

/** 13-10-2026 10:40 */
export function dateTime(iso?: string | null): string {
  if (!iso) return '—'
  const p = parts(iso)
  return p.time ? `${date(iso)} ${p.time}` : date(iso)
}

/** 13 Oct 2026, used in headers */
export function dateLong(iso: string): string {
  const p = parts(iso)
  return `${p.day} ${MONTHS[p.m - 1]} ${p.y}`
}

/** 13-10 11:05, for compact history rows */
export function dayMonthTime(iso: string): string {
  const p = parts(iso)
  return `${pad(p.day)}-${pad(p.m)}${p.time ? ' ' + p.time : ''}`
}

function toDate(iso: string): Date {
  const p = parts(iso)
  const [hh, mm] = p.time ? p.time.split(':').map(Number) : [0, 0]
  return new Date(Date.UTC(p.y, p.m - 1, p.day, hh, mm) - 330 * 60_000) // IST → UTC
}

/** Whole days from a to b (b − a), by calendar date. */
export function daysBetween(a: string, b: string): number {
  const da = toDate(a.slice(0, 10)).getTime()
  const db = toDate(b.slice(0, 10)).getTime()
  return Math.round((db - da) / 86_400_000)
}

/** Calendar days from today to iso (negative when past). */
export function daysFromNow(iso: string): number {
  return daysBetween(todayIso(), iso)
}

export function todayIso(): string {
  const d = new Date(now().getTime() + 330 * 60_000)
  return d.toISOString().slice(0, 10)
}

export function nowIso(): string {
  const d = new Date(now().getTime() + 330 * 60_000)
  return d.toISOString().slice(0, 16)
}

export function addDays(iso: string, n: number): string {
  const d = new Date(toDate(iso.slice(0, 10)).getTime() + 330 * 60_000 + n * 86_400_000)
  return d.toISOString().slice(0, 10)
}

/** '10 min ago', '2 h ago', '26 h ago', '3 days ago' */
export function ago(iso: string): string {
  const mins = Math.max(0, Math.round((now().getTime() - toDate(iso).getTime()) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h <= 36) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/** Short form for chips: '10 min', '2 h', '26 h' */
export function agoShort(iso: string): string {
  return ago(iso).replace(' ago', '')
}

export function hoursSince(iso: string): number {
  return (now().getTime() - toDate(iso).getTime()) / 3_600_000
}

export function plural(n: number, one: string, many = one + 's'): string {
  return `${int(n)} ${n === 1 ? one : many}`
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function words99(n: number) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '') }
function words999(n: number) { return (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? words99(n % 100) : '') }

/** Indian system: 105020 → "Rupees One Lakh Five Thousand Twenty Only" */
export function rupeesInWords(amount: number): string {
  let n = Math.floor(Math.abs(amount))
  const paise = Math.round((Math.abs(amount) - n) * 100)
  if (n === 0 && !paise) return 'Rupees Zero Only'
  const parts: string[] = []
  const crore = Math.floor(n / 1e7); n %= 1e7
  const lakh = Math.floor(n / 1e5); n %= 1e5
  const thousand = Math.floor(n / 1e3); n %= 1e3
  if (crore) parts.push(words999(crore) + ' Crore')
  if (lakh) parts.push(words99(lakh) + ' Lakh')
  if (thousand) parts.push(words99(thousand) + ' Thousand')
  if (n) parts.push(words999(n))
  return 'Rupees ' + parts.join(' ') + (paise ? ' and ' + words99(paise) + ' Paise' : '') + ' Only'
}
