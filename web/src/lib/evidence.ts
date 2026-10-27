import type { Annotation, Box, Status, Verdict, VerificationRow } from './types'

/** A stamp or note worth a person's check: it carries a reference the other documents can be compared with. */
export const checkable = (a: Annotation) => (['grnNo', 'gateEntryNo', 'poNo', 'invoiceNo', 'parkPostNo'] as const).some(k => !!a[k])

/** Where a 0-1000 box sits over a page image, as percentages for absolute positioning. */
export function boxStyle(b: Box): { left: string; top: string; width: string; height: string } {
  const c = (v: number) => Math.min(1000, Math.max(0, v)) / 10
  const x0 = c(Math.min(b.x0, b.x1)), x1 = c(Math.max(b.x0, b.x1)), y0 = c(Math.min(b.y0, b.y1)), y1 = c(Math.max(b.y0, b.y1))
  return { left: `${x0}%`, top: `${y0}%`, width: `${x1 - x0}%`, height: `${y1 - y0}%` }
}

export function verdictStatus(v: Verdict | null | undefined): Status {
  if (!v) return { tone: 'none', label: 'Not checked yet' }
  if (v.state === 'pending') return { tone: 'acc', label: 'Checking…' }
  if (v.state === 'clean') return { tone: 'ok', label: 'Clean · ready to approve' }
  return { tone: v.items.some(i => i.blocks && i.tone === 'bad') ? 'bad' : 'warn', label: `${v.issues} issue${v.issues === 1 ? '' : 's'}` }
}

export const VERIFICATION_LABEL: Record<VerificationRow['kind'], string> = { gstin: 'GSTIN status', einvoice_qr: 'E-invoice (signed QR)', ewb: 'E-way bill' }

export function verificationStatus(r: VerificationRow): Status {
  switch (r.status) {
    case 'ok': return r.kind === 'gstin' && r.detail.sts && r.detail.sts !== 'Active' ? { tone: 'bad', label: String(r.detail.sts) } : { tone: 'ok', label: r.kind === 'gstin' ? String(r.detail.sts ?? 'Verified') : 'Verified' }
    case 'pending': return { tone: 'acc', label: 'Checking…' }
    case 'mismatch': return { tone: 'bad', label: r.kind === 'gstin' ? 'Not found' : 'Differs' }
    case 'failed': return { tone: 'bad', label: 'Failed' }
    case 'skipped': return { tone: 'none', label: 'Not verified' }
    case 'error': return { tone: 'warn', label: 'Could not check' }
  }
}
