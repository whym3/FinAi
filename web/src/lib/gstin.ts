// Mirror of server/app/validate.py for instant feedback while typing. The server re-checks on save.
export const STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
}
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/
export const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/
export const CIN_RE = /^([LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}|[A-Z]{3}-[0-9]{4})$/
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function gstinCheckChar(first14: string): string {
  let total = 0
  for (let i = 0; i < 14; i++) {
    const p = B36.indexOf(first14[i]) * (i % 2 ? 2 : 1)
    total += Math.floor(p / 36) + (p % 36)
  }
  return B36[(36 - (total % 36)) % 36]
}

export interface GstinCheck { ok: boolean; errors: string[]; warnings: string[]; state?: string }

/** A wrong check digit is a warning (test data, typos the portal will catch); a wrong shape or PAN is an error. */
export function checkGstin(raw: string, pan?: string): GstinCheck {
  const g = raw.trim().toUpperCase()
  if (!GSTIN_RE.test(g)) return { ok: false, errors: ['15 characters: state code, PAN, entity no., Z, check digit'], warnings: [] }
  const errors: string[] = [], warnings: string[] = []
  const state = STATES[g.slice(0, 2)]
  if (!state) errors.push(`Unknown state code ${g.slice(0, 2)}`)
  if (pan && PAN_RE.test(pan.toUpperCase()) && g.slice(2, 12) !== pan.toUpperCase()) errors.push(`PAN inside GSTIN (${g.slice(2, 12)}) differs from the client PAN`)
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) warnings.push('Check digit does not match: confirm on the GST portal')
  return { ok: !errors.length, errors, warnings, state }
}
