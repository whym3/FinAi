import type { Deadline, FilingCell, Kpi, OverviewSnapshot, Status } from '@/lib/types'

const k = (id: string, label: string, value: number, sub: string, o: Partial<Kpi> = {}): Kpi => ({
  id, label, value, sub, unit: 'inr', source: 'SAP', syncKey: 'sap', ...o,
})

const L = 1e5
const weeks = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04']
const cashOf = (cin: number[], cout: number[]) => weeks.map((week, i) => ({ week, inflow: cin[i] * L, outflow: cout[i] * L }))

export const overview: OverviewSnapshot[] = [
  {
    entityId: 'meridian', asOf: '2026-10-13T15:20',
    kpiPay: [
      k('po', 'Open PO commitments', 34218450, '86 open POs · 31 vendors', { link: '/p2p' }),
      k('grni', 'Goods received, not invoiced', 4862900, '27 GRNs · oldest 38 days', { tone: 'warn', status: '6 GRNs > 30 days', link: '/p2p' }),
      k('ap', 'Posted AP outstanding', 18704310, '412 invoices · 58 vendors', { link: '/payables' }),
      k('due7', 'Due next 7 days', 6240118, '58 invoices · run on 16-10-2026', { link: '/payables' }),
      k('apod', 'Overdue payables', 1890000, '23 invoices · 9 over 30 days', { tone: 'bad', status: 'Overdue', link: '/payables' }),
      k('msme', 'MSME dues near 45-day limit', 730480, '4 invoices · first limit 15-10-2026', { tone: 'warn', status: '2 days to first limit', link: '/msme' }),
    ],
    kpiRec: [
      k('ar', 'Receivables outstanding', 29600000, '164 invoices · 42 customers', { link: '/receivables' }),
      k('arod', 'Overdue receivables', 4120000, '31 invoices · 11 customers', { tone: 'bad', status: '3 over 90 days', link: '/receivables' }),
      k('dso', 'Days sales outstanding (DSO)', 61, 'Target 45 · up 4 days vs Sep', { unit: 'days', tone: 'warn', status: 'Above target', exact: '61 days, rolling 90 days', link: '/receivables' }),
      k('dpo', 'Days payables outstanding (DPO)', 52, 'Down 3 days vs Sep', { unit: 'days', exact: '52 days, rolling 90 days', link: '/payables' }),
      k('bank', 'Bank balance', 11246720, '3 accounts', { source: 'Bank', syncKey: 'bank', link: '/bank' }),
      k('itc', 'ITC at risk', 382940, '31 invoices in books, not in GSTR-2B', { source: 'GST portal', syncKey: 'gst', tone: 'warn', status: 'Follow up suppliers', link: '/gst' }),
    ],
    critical: {
      open: 9, pastSla: 4, blocked: 984000,
      breakdown: [
        { label: 'MSME deadline risk', n: 3, type: 'MSME deadline risk' },
        { label: 'Not in GSTR-2B', n: 2, type: 'Not in GSTR-2B' },
        { label: 'Missing IRN', n: 2, type: 'Missing IRN' },
        { label: 'Vendor bank details changed', n: 1, type: 'Vendor bank details changed' },
        { label: 'GRN missing', n: 1, type: 'GRN missing' },
      ],
    },
    cash: {
      opening: 11246720, minimum: 75 * L,
      weeks: cashOf([38, 46, 52, 41, 44, 58, 36, 49, 47, 55, 40, 62, 45], [62, 31, 44, 58, 48, 39, 52, 46, 61, 37, 49, 43, 50]),
    },
    apAgeing: [
      { bucket: '< 1 year', msme: 21.4 * L, others: 151.2 * L },
      { bucket: '1–2 years', msme: 0.6 * L, others: 9.8 * L },
      { bucket: '2–3 years', msme: 0, others: 2.1 * L },
      { bucket: '> 3 years', msme: 0, others: 1.9 * L },
    ],
    apNote: 'disputed dues ₹3.4 L (others) reported separately',
    arAgeing: [
      { bucket: '< 6 months', amount: 248.3 * L },
      { bucket: '6 m – 1 yr', amount: 31.6 * L },
      { bucket: '1–2 years', amount: 11.2 * L },
      { bucket: '2–3 years', amount: 3.1 * L },
      { bucket: '> 3 years', amount: 1.8 * L },
    ],
    arNote: 'credit impaired ₹1.8 L (> 3 yrs) under review',
  },
  {
    entityId: 'northstar', asOf: '2026-10-13T15:20',
    kpiPay: [
      k('po', 'Open PO commitments', 51200000, '124 open POs · 46 vendors', { link: '/p2p' }),
      k('grni', 'Goods received, not invoiced', 9120000, '41 GRNs · oldest 66 days', { tone: 'bad', status: '14 GRNs > 30 days', link: '/p2p' }),
      k('ap', 'Posted AP outstanding', 31400000, '688 invoices · 92 vendors', { link: '/payables' }),
      k('due7', 'Due next 7 days', 8820000, '74 invoices · run on 17-10-2026', { link: '/payables' }),
      k('apod', 'Overdue payables', 6240800, '61 invoices · 28 over 30 days', { tone: 'bad', status: 'Overdue', link: '/payables' }),
      k('msme', 'MSME dues past 45-day limit', 1180000, '5 invoices · 43B(h) exposure', { tone: 'bad', status: '5 breached', link: '/msme' }),
    ],
    kpiRec: [
      k('ar', 'Receivables outstanding', 48800000, '212 invoices · 38 customers', { link: '/receivables' }),
      k('arod', 'Overdue receivables', 11200000, '58 invoices · 14 customers', { tone: 'bad', status: '6 over 90 days', link: '/receivables' }),
      k('dso', 'Days sales outstanding (DSO)', 74, 'Target 60 · up 6 days vs Sep', { unit: 'days', tone: 'warn', status: 'Above target', link: '/receivables' }),
      k('dpo', 'Days payables outstanding (DPO)', 68, 'Up 5 days vs Sep', { unit: 'days', link: '/payables' }),
      k('bank', 'Bank balance', 21400000, '4 accounts', { source: 'Bank', syncKey: 'bank', link: '/bank' }),
      k('itc', 'ITC at risk', 984300, '62 invoices in books, not in GSTR-2B', { source: 'GST portal', syncKey: 'gst', tone: 'bad', status: 'High', link: '/gst' }),
    ],
    critical: { open: 17, pastSla: 9, blocked: 2860000, breakdown: [
      { label: 'MSME deadline risk', n: 5, type: 'MSME deadline risk' },
      { label: 'Not in GSTR-2B', n: 6, type: 'Not in GSTR-2B' },
      { label: 'Missing IRN', n: 4, type: 'Missing IRN' },
      { label: 'GRN missing', n: 2, type: 'GRN missing' },
    ] },
    cash: { opening: 21400000, minimum: 150 * L, weeks: cashOf([72, 80, 64, 90, 70, 85, 66, 78, 82, 74, 60, 88, 76], [96, 70, 82, 88, 79, 72, 90, 76, 99, 68, 84, 70, 81]) },
    apAgeing: [
      { bucket: '< 1 year', msme: 32.6 * L, others: 262.4 * L },
      { bucket: '1–2 years', msme: 3.2 * L, others: 12.6 * L },
      { bucket: '2–3 years', msme: 0, others: 2.4 * L },
      { bucket: '> 3 years', msme: 0, others: 0.8 * L },
    ],
    apNote: 'disputed dues ₹6.1 L (others) reported separately',
    arAgeing: [
      { bucket: '< 6 months', amount: 402.1 * L },
      { bucket: '6 m – 1 yr', amount: 61.4 * L },
      { bucket: '1–2 years', amount: 18.2 * L },
      { bucket: '2–3 years', amount: 4.1 * L },
      { bucket: '> 3 years', amount: 2.2 * L },
    ],
    arNote: 'credit impaired ₹2.2 L (> 3 yrs) under review',
  },
  {
    entityId: 'kaveri', asOf: '2026-10-13T15:20',
    kpiPay: [
      k('po', 'Open PO commitments', 18600000, '58 open POs · 24 vendors', { link: '/p2p' }),
      k('grni', 'Goods received, not invoiced', 2140000, '12 GRNs · oldest 21 days', { link: '/p2p' }),
      k('ap', 'Posted AP outstanding', 9820000, '214 invoices · 33 vendors', { link: '/payables' }),
      k('due7', 'Due next 7 days', 3110000, '29 invoices · run on 18-10-2026', { link: '/payables' }),
      k('apod', 'Overdue payables', 2460500, '19 invoices · 6 over 30 days', { tone: 'bad', status: 'Overdue', link: '/payables' }),
      k('msme', 'MSME dues past 45-day limit', 480000, '2 invoices · 43B(h) exposure', { tone: 'bad', status: '2 breached', link: '/msme' }),
    ],
    kpiRec: [
      k('ar', 'Receivables outstanding', 14200000, '96 invoices · 21 customers', { link: '/receivables' }),
      k('arod', 'Overdue receivables', 1860000, '14 invoices · 5 customers', { tone: 'warn', status: '1 over 90 days', link: '/receivables' }),
      k('dso', 'Days sales outstanding (DSO)', 38, 'Target 40 · down 2 days vs Sep', { unit: 'days', link: '/receivables' }),
      k('dpo', 'Days payables outstanding (DPO)', 44, 'Flat vs Sep', { unit: 'days', link: '/payables' }),
      k('bank', 'Bank balance', 6420000, '2 accounts', { source: 'Bank', syncKey: 'bank', link: '/bank' }),
      k('itc', 'ITC at risk', 112800, '9 invoices in books, not in GSTR-2B', { source: 'GST portal', syncKey: 'gst', tone: 'warn', status: 'Follow up suppliers', link: '/gst' }),
    ],
    critical: { open: 4, pastSla: 1, blocked: 480000, breakdown: [
      { label: 'MSME deadline risk', n: 2, type: 'MSME deadline risk' },
      { label: 'Not in GSTR-2B', n: 2, type: 'Not in GSTR-2B' },
    ] },
    cash: { opening: 6420000, minimum: 40 * L, weeks: cashOf([22, 26, 30, 24, 28, 32, 21, 27, 25, 30, 24, 33, 26], [28, 20, 26, 31, 24, 22, 29, 25, 33, 21, 27, 24, 28]) },
    apAgeing: [
      { bucket: '< 1 year', msme: 12.1 * L, others: 81.4 * L },
      { bucket: '1–2 years', msme: 1.1 * L, others: 2.6 * L },
      { bucket: '2–3 years', msme: 0, others: 0.7 * L },
      { bucket: '> 3 years', msme: 0, others: 0.3 * L },
    ],
    apNote: 'no disputed dues',
    arAgeing: [
      { bucket: '< 6 months', amount: 128.6 * L },
      { bucket: '6 m – 1 yr', amount: 9.8 * L },
      { bucket: '1–2 years', amount: 2.9 * L },
      { bucket: '2–3 years', amount: 0.5 * L },
      { bucket: '> 3 years', amount: 0.2 * L },
    ],
    arNote: 'no credit-impaired balances',
  },
]

const st = (tone: Status['tone'], label: string): Status => ({ tone, label })
const dl = (entityId: string, id: string, name: string, what: string, due: string, windowDays: number, s: Status, link?: string): Deadline => ({ entityId, id: entityId + '-' + id, name, what, due, windowDays, status: s, link })

export const deadlines: Deadline[] = [
  dl('meridian', 'msme1', 'MSME Form 1', 'Half-year Apr–Sep 2026 · MCA', '2026-10-31', 31, st('warn', 'Draft · 6 vendors'), '/msme'),
  dl('meridian', 'tds', 'TDS deposit', 'Oct 2026 deductions · ₹4,82,310.00', '2026-11-07', 38, st('warn', 'Accruing'), '/tds'),
  dl('meridian', 'gstr1', 'GSTR-1', 'Oct 2026 · 27 · MH and 24 · GJ', '2026-11-11', 42, st('ok', '212 invoices ready'), '/gst?tab=gstr1'),
  dl('meridian', '2b', 'GSTR-2B available', 'Oct 2026 · act on IMS before', '2026-11-14', 45, st('warn', '64 IMS pending'), '/gst'),
  dl('meridian', 'gstr3b', 'GSTR-3B', 'Oct 2026 · both GSTINs', '2026-11-20', 51, st('none', 'Not started'), '/gst?tab=gstr3b'),
  dl('northstar', 'msme1', 'MSME Form 1', 'Half-year Apr–Sep 2026 · MCA', '2026-10-31', 31, st('none', 'Not started'), '/msme'),
  dl('northstar', 'tds', 'TDS deposit', 'Oct 2026 deductions · ₹11,62,400.00', '2026-11-07', 38, st('warn', 'Challan pending'), '/tds'),
  dl('northstar', 'gstr1', 'GSTR-1', 'Oct 2026 · 36 · TS', '2026-11-11', 42, st('warn', '38 e-invoices failed'), '/gst?tab=gstr1'),
  dl('northstar', '2b', 'GSTR-2B available', 'Oct 2026 · act on IMS before', '2026-11-14', 45, st('warn', '188 IMS pending'), '/gst'),
  dl('northstar', 'gstr3b', 'GSTR-3B', 'Oct 2026', '2026-11-20', 51, st('none', 'Not started'), '/gst?tab=gstr3b'),
  dl('kaveri', 'msme1', 'MSME Form 1', 'Half-year Apr–Sep 2026 · MCA', '2026-10-31', 31, st('bad', '2 breaches to report'), '/msme'),
  dl('kaveri', 'tds', 'TDS deposit', 'Oct 2026 deductions · ₹2,18,900.00', '2026-11-07', 38, st('warn', 'Accruing'), '/tds'),
  dl('kaveri', 'gstr1', 'GSTR-1', 'Oct 2026 · 29 · KA', '2026-11-11', 42, st('ok', 'Ready'), '/gst?tab=gstr1'),
  dl('kaveri', '2b', 'GSTR-2B available', 'Oct 2026 · act on IMS before', '2026-11-14', 45, st('warn', '60 IMS pending'), '/gst'),
  dl('kaveri', 'gstr3b', 'GSTR-3B', 'Oct 2026', '2026-11-20', 51, st('none', 'Not started'), '/gst?tab=gstr3b'),
]

/** Firm-view row per client entity (risk table). */
export const firmRows = [
  { entityId: 'northstar', overduePayables: 6240800, msme: 5, msmeLabel: '5 breached', msmeTone: 'bad' as const, imsPending: 188, mismatch: 984300, tdsDue: 1162400, close: st('bad', 'Day 9 · 14 of 24 tasks'), closeSub: 'SLA 5 working days' },
  { entityId: 'kaveri', overduePayables: 2460500, msme: 2, msmeLabel: '2 breached', msmeTone: 'bad' as const, imsPending: 60, mismatch: 112800, tdsDue: 218900, close: st('warn', 'Day 6 · 20 of 22 tasks'), closeSub: 'Bank reco pending' },
  { entityId: 'meridian', overduePayables: 1890000, msme: 0, msmeLabel: '0 · 4 near limit', msmeTone: 'warn' as const, imsPending: 64, mismatch: 382940, tdsDue: 482310, close: st('ok', 'Closed 08-10-2026'), closeSub: 'Signed off by F. Siddiqui' },
]

export const filingHeads = ['MSME Form 1 · 31-10-2026', 'TDS deposit · 07-11-2026', 'GSTR-1 · 11-11-2026', 'GSTR-2B · 14-11-2026', 'GSTR-3B · 20-11-2026']
export const filing: FilingCell[] = [
  { entityId: 'northstar', cells: [st('none', 'Not started'), st('warn', 'Challan pending'), st('warn', '38 e-invoices failed'), st('warn', '188 IMS pending'), st('none', 'Not started')] },
  { entityId: 'kaveri', cells: [st('bad', '2 breaches to report'), st('warn', 'Accruing'), st('ok', 'Ready'), st('warn', '60 IMS pending'), st('none', 'Not started')] },
  { entityId: 'meridian', cells: [st('warn', 'Draft · 6 vendors'), st('warn', 'Accruing'), st('ok', '212 ready'), st('warn', '64 IMS pending'), st('none', 'Not started')] },
]
