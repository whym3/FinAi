import type { GstSummary, ImsRow, OutwardDoc, Status } from '@/lib/types'

const st = (tone: Status['tone'], label: string): Status => ({ tone, label })
const MH = '27AAACM0000M1Z2', GJ = '24AAACM0000M1Z6'

const r = (id: string, supplier: string, supplierGstin: string, docType: ImsRow['docType'], docNo: string, date: string, taxable: number, itc: number, portal: ImsRow['portal'], mt: ImsRow['match']['tone'], ml: string, mn: string, recommended: ImsRow['recommended'], final?: ImsRow['final'], actedBy?: string, actedAt?: string, gstin = MH): ImsRow => ({
  id, entityId: 'meridian', gstin, supplier, supplierGstin, docType, docNo, date, taxable, itc, portal, match: { tone: mt, label: ml, note: mn }, recommended, final, actedBy, actedAt,
})

export const imsRows: ImsRow[] = [
  r('ims1', 'Sahyadri Packaging', '27AAACX0000X1Z5', 'Invoice', 'SPK/2026-27/0402', '2026-10-03', 42500, 7650, 'No action', 'ok', 'Matched', 'All fields agree', 'Accept'),
  r('ims2', 'Ratnagiri Rubber', '27AAAFX0007X1Z1', 'Invoice', 'RRP/554', '2026-10-08', 74000, 13320, 'No action', 'ok', 'Matched', 'All fields agree', 'Accept'),
  r('ims3', 'Bharat Forgings', '27AAACX0006X1Z3', 'Invoice', 'BF/2026/1311', '2026-10-04', 210000, 37800, 'Accepted', 'ok', 'Matched', 'All fields agree', 'Accept', 'Accept', 'RK', '2026-10-10T16:40'),
  r('ims4', 'Deccan Steel Traders', '27AAAFX0001X1Z3', 'Credit note', 'DST/CN/014', '2026-10-07', -24000, -4320, 'Accepted', 'ok', 'Matched', 'Reduces ITC; booked in SAP', 'Accept', 'Accept', 'PN', '2026-10-11T10:02'),
  r('ims5', 'Patel Electricals', '27AAAFX0003X1Z9', 'Invoice', 'PE/26-27/076', '2026-10-01', 31000, 5580, 'No action', 'ok', 'Matched', 'IRN found on portal; resolves EX-1035', 'Accept'),
  r('ims6', 'Om Sai Engineering', '27AAAFX0008X1Z9', 'Invoice', 'OSE/0931', '2026-10-10', 38500, 6930, 'No action', 'warn', 'Partial', 'Date 10-10 on portal, 11-10 in books', 'Accept'),
  r('ims7', 'Konkan Chemicals', '27AAACX0004X1Z7', 'Invoice', 'KC/2026/0733', '2026-10-05', 186400, 33552, 'No action', 'warn', 'Partial', 'Taxable differs by ₹1,180.00', 'Keep pending'),
  r('ims8', 'Konkan Chemicals', '27AAACX0004X1Z7', 'Debit note', 'KC/DN/007', '2026-10-06', 12000, 2160, 'Pending', 'warn', 'Partial', 'Debit note not agreed by purchase', 'Keep pending', 'Keep pending', 'PN', '2026-10-11T10:05'),
  r('ims9', 'Deccan Steel Traders', '27AAAFX0001X1Z3', 'Invoice', 'DST/1187', '2026-10-08', 400000, 72000, 'No action', 'warn', 'Partial', 'In books; GRN missing (EX-1019)', 'Keep pending'),
  r('ims10', 'Sahyadri Packaging', '27AAACX0000X1Z5', 'Invoice', 'SPK/2026-27/0395', '2026-09-30', 51000, 9180, 'No action', 'bad', 'Duplicate in books', 'Posted twice in SAP; reverse one', 'Accept'),
  r('ims11', 'Patel Electricals', '27AAAFX0003X1Z9', 'Invoice', 'PE/26-27/079', '2026-10-09', 64000, 11520, 'No action', 'bad', 'Not in books', 'Goods not yet received', 'Keep pending'),
  r('ims12', 'Shree Ganesh Enterprises', '27AAAFX0005X1Z5', 'Invoice', 'SGE/098', '2026-10-02', 48000, 8640, 'Rejected', 'bad', 'Not in books', 'No PO; supplier not in vendor master', 'Reject', 'Reject', 'FS', '2026-10-12T15:20'),
  r('ims13', 'Sabarmati Plastics', '24AAACX0016X1Z1', 'Invoice', 'SBP/0221', '2026-10-06', 96000, 17280, 'No action', 'ok', 'Matched', 'All fields agree', 'Accept', undefined, undefined, undefined, GJ),
  r('ims14', 'Kutch Logistics', '24AAAFX0017X1Z9', 'Invoice', 'KL/778', '2026-10-09', 22000, 1100, 'No action', 'warn', 'Partial', 'RCM service billed with tax', 'Reject', undefined, undefined, undefined, GJ),
]

export const gstSummaries: GstSummary[] = [
  {
    entityId: 'meridian', gstin: MH, period: 'Oct 2026', imsSyncedAt: '2026-10-13T13:05', twoBDate: '2026-11-14', threeBDue: '2026-11-20',
    tiles: [
      { key: 'matched', label: 'Matched', n: 214, itc: 3842610, sub: 'taxable ₹2,13,47,830.00', tone: 'ok', status: 'Matched', sources: ['GST portal', 'SAP'] },
      { key: 'partial', label: 'Partial match', n: 23, itc: 418300, sub: 'value, date or rate differs', tone: 'warn', status: 'Check', sources: ['GST portal', 'SAP'] },
      { key: 'notbooks', label: 'In GSTR-2B, not in books', n: 17, itc: 206450, sub: 'not booked or unknown supplier', tone: 'bad', status: 'Mismatch', sources: ['GST portal'] },
      { key: 'not2b', label: 'In books, not in GSTR-2B', n: 31, itc: 382940, sub: 'at risk · supplier yet to file', tone: 'bad', status: 'Mismatch', sources: ['SAP'] },
    ],
    itc180: [
      { supplier: 'Konkan Chemicals', ref: 'KC/2026/0221', date: '2026-04-12', days: 184, itc: 46800 },
      { supplier: 'Deccan Steel', ref: 'DST/0942', date: '2026-04-09', days: 187, itc: 38600 },
      { supplier: 'Pune Precision', ref: 'PPT/118', date: '2026-04-14', days: 182, itc: 27000 },
    ],
    s164: { fy: 'FY 2025-26', daysLeft: 48, invoices: 7, itc: 68210, lastDate: '2026-11-30' },
    blocked: [
      { label: 'Motor vehicle repairs', amount: 14230 },
      { label: 'Food & beverages (canteen)', amount: 9860 },
      { label: 'Club membership', amount: 4500 },
    ],
    blockedNote: 'Tagged from SAP GL accounts 5402, 5611 and 5730. 2 items need a person to confirm.',
    rcm: { vendorId: '100509', vendor: 'Vyas Roadlines', gstin: '27AAAFX0002X1Z1', service: 'GTA · 5%', lrs: 6, freight: 148500, rate: 5, selfInvoices: 4 },
    lastSaved: { at: '2026-10-13T11:42', by: 'PN' },
  },
  {
    entityId: 'meridian', gstin: GJ, period: 'Oct 2026', imsSyncedAt: '2026-10-13T13:05', twoBDate: '2026-11-14', threeBDue: '2026-11-20',
    tiles: [
      { key: 'matched', label: 'Matched', n: 38, itc: 612400, sub: 'taxable ₹34,02,220.00', tone: 'ok', status: 'Matched', sources: ['GST portal', 'SAP'] },
      { key: 'partial', label: 'Partial match', n: 4, itc: 38800, sub: 'value, date or rate differs', tone: 'warn', status: 'Check', sources: ['GST portal', 'SAP'] },
      { key: 'notbooks', label: 'In GSTR-2B, not in books', n: 2, itc: 9200, sub: 'not booked or unknown supplier', tone: 'bad', status: 'Mismatch', sources: ['GST portal'] },
      { key: 'not2b', label: 'In books, not in GSTR-2B', n: 3, itc: 21400, sub: 'at risk · supplier yet to file', tone: 'bad', status: 'Mismatch', sources: ['SAP'] },
    ],
    itc180: [],
    s164: { fy: 'FY 2025-26', daysLeft: 48, invoices: 1, itc: 4200, lastDate: '2026-11-30' },
    blocked: [{ label: 'Motor vehicle repairs', amount: 3120 }],
    blockedNote: 'Tagged from SAP GL account 5402.',
    rcm: { vendorId: '100509', vendor: 'Kutch Logistics', gstin: '24AAAFX0017X1Z9', service: 'GTA · 5%', lrs: 2, freight: 44000, rate: 5, selfInvoices: 0 },
  },
]

const o = (id: string, customer: string, customerGstin: string, docNo: string, date: string, taxable: number, irn: Status, ewb: Status, gstr1: Status, gstin = MH): OutwardDoc => ({ id, entityId: 'meridian', gstin, customer, customerGstin, docNo, date, taxable, tax: taxable * 0.18, irn, ewb, gstr1 })

export const outward: OutwardDoc[] = [
  o('o1', 'Shivneri Motors Ltd', '27AAACS0101S1Z1', 'MAC/26-27/2210', '2026-10-01', 842000, st('ok', 'IRN generated'), st('ok', 'EWB 3410 2200 1101'), st('ok', 'Ready')),
  o('o2', 'Vardhan Tractors Pvt Ltd', '27AAACV0102V1Z9', 'MAC/26-27/2214', '2026-10-03', 615400, st('ok', 'IRN generated'), st('ok', 'EWB 3410 2200 1128'), st('ok', 'Ready')),
  o('o3', 'Sahyog Two Wheelers Pvt Ltd', '24AAACS0104S1Z5', 'MAC/26-27/2219', '2026-10-05', 388200, st('ok', 'IRN generated'), st('warn', 'Part B pending'), st('ok', 'Ready'), GJ),
  o('o4', 'Narmada Coach Builders', '24AAACN0106N1Z1', 'MAC/26-27/2223', '2026-10-07', 274500, st('bad', 'IRP error 2150 · duplicate'), st('none', 'Not generated'), st('warn', 'Blocked'), GJ),
  o('o5', 'Godavari Agro Equipment', '27AAAFG0105G1Z3', 'MAC/26-27/2227', '2026-10-08', 196000, st('ok', 'IRN generated'), st('ok', 'EWB 3410 2200 1190'), st('ok', 'Ready')),
  o('o6', 'Indrayani Auto Assemblies', '27AAAFI0103I1Z7', 'MAC/26-27/2231', '2026-10-09', 452300, st('bad', 'IRP error 2172 · HSN invalid'), st('none', 'Not generated'), st('warn', 'Blocked')),
  o('o7', 'Malwa Gears Ltd', '23AAACM0107M1Z9', 'MAC/26-27/2236', '2026-10-10', 318800, st('ok', 'IRN generated'), st('ok', 'EWB 3410 2200 1243'), st('ok', 'Ready')),
  o('o8', 'Trident EV Systems', '29AAACT0108T1Z7', 'MAC/26-27/2240', '2026-10-12', 129000, st('ok', 'IRN generated'), st('ok', 'EWB 3410 2200 1277'), st('ok', 'Ready')),
]

export const rcmLrs = [
  { id: 'lr1', lr: 'VR/LR/22874', date: '2026-10-06', route: 'Bhosari → Chakan', freight: 18000, selfInvoice: 'SI/RCM/2026-27/041' },
  { id: 'lr2', lr: 'VR/LR/22891', date: '2026-10-07', route: 'Chakan → Sanand', freight: 32500, selfInvoice: 'SI/RCM/2026-27/042' },
  { id: 'lr3', lr: 'VR/LR/22903', date: '2026-10-08', route: 'Chakan → Hosur', freight: 41000, selfInvoice: 'SI/RCM/2026-27/043' },
  { id: 'lr4', lr: 'VR/LR/22917', date: '2026-10-10', route: 'Chakan → Pithampur', freight: 22500, selfInvoice: 'SI/RCM/2026-27/044' },
  { id: 'lr5', lr: 'VR/LR/22926', date: '2026-10-11', route: 'Chakan → Nashik', freight: 16000, selfInvoice: '' },
  { id: 'lr6', lr: 'VR/LR/22931', date: '2026-10-12', route: 'Chakan → Sanand', freight: 18500, selfInvoice: '' },
]
