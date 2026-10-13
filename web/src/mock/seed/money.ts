import type { ApItem, ArItem, AuditEntry, BankAccount, BankLine, CloseTask, MsmeInvoice, Notification, PaymentRun, ReportDef, Status, TdsLine } from '@/lib/types'

const st = (tone: Status['tone'], label: string): Status => ({ tone, label })

export const paymentRuns: PaymentRun[] = [
  {
    id: 'PR-2026-10-16', entityId: 'meridian', status: 'awaiting-approval', valueDate: '2026-10-16', account: '••••2290', bank: 'HDFC Bank current a/c',
    gross: 5937880, tds: 65430, net: 5872450, held: 642800, heldNote: 'Konkan Chemicals held out · bank change not verified',
    invoices: 41, vendors: 17, sapProposal: 'F110 proposal',
    approvers: [
      { userId: 'FS', status: 'approved', at: '2026-10-13T11:20', note: 'Konkan held until call-back.', via: 'web' },
      { userId: 'AN', status: 'pending' },
    ],
    checks: [
      { label: 'Bank details verified', sub: '17 of 17 vendors · unchanged since last payment', tone: 'ok' },
      { label: 'MSME invoices within 45 days', sub: '6 invoices · nearest limit 15-10-2026 (Sahyadri)', tone: 'ok' },
      { label: 'No duplicates', sub: 'Same vendor, invoice no. and amount checked', tone: 'ok' },
      { label: 'Supplier GSTINs active', sub: 'GST portal · 2 h ago', tone: 'ok' },
      { label: 'TDS computed', sub: 'Sections 393(1) · 4 vendors · ₹65,430.00', tone: 'ok' },
      { label: 'Konkan Chemicals held out', sub: 'Bank change not verified · ₹6,42,800.00 not in this run', tone: 'bad' },
      { label: 'Bank balance covers the run', sub: '₹1.12 Cr as of last statement', tone: 'warn', source: { name: 'Bank', syncKey: 'bank' } },
    ],
    payees: [
      { vendorId: '100102', name: 'Deccan Steel Traders', sub: '9 invoices · TDS ₹18,400.00', amount: 1840000 },
      { vendorId: '100315', name: 'Bharat Forgings Pvt Ltd', sub: '4 invoices · 21 days overdue', amount: 912400 },
      { vendorId: '100377', name: 'Patel Electricals', tag: 'Small', sub: '6 invoices · 1 awaiting IRN excluded', amount: 764180 },
      { vendorId: '100231', name: 'Sahyadri Packaging Pvt Ltd', tag: 'Micro', sub: 'SPK/2026-27/0377 · MSME limit 15-10-2026', amount: 284320 },
      { vendorId: '100509', name: 'Vyas Roadlines', tag: 'GTA', sub: '6 lorry receipts · TDS 1% ₹1,485.00', amount: 147015 },
    ],
    rest: { count: 12, amount: 1924535 },
  },
  {
    id: 'PR-2026-10-09', entityId: 'meridian', status: 'released', valueDate: '2026-10-09', account: '••••2290', bank: 'HDFC Bank current a/c',
    gross: 4412600, tds: 41800, net: 4370800, held: 0, heldNote: '', invoices: 33, vendors: 14, sapProposal: 'F110 proposal',
    approvers: [{ userId: 'FS', status: 'approved', at: '2026-10-08T17:10' }, { userId: 'AN', status: 'approved', at: '2026-10-08T19:42', via: 'passkey' }],
    checks: [], payees: [], rest: { count: 0, amount: 0 }, h2hFile: 'H2H-2026-10-09-0038',
  },
  {
    id: 'PR-2026-10-23', entityId: 'meridian', status: 'draft', valueDate: '2026-10-23', account: '••••2290', bank: 'HDFC Bank current a/c',
    gross: 3180400, tds: 28100, net: 3152300, held: 0, heldNote: '', invoices: 22, vendors: 11, sapProposal: 'F110 proposal (not run)',
    approvers: [{ userId: 'FS', status: 'pending' }, { userId: 'AN', status: 'pending' }], checks: [], payees: [], rest: { count: 0, amount: 0 },
  },
]

const ap = (id: string, vendorId: string, invoiceNo: string, date: string, due: string, amount: number, tds: number, s: Status, runId?: string, msme?: ApItem['msme']): ApItem => ({ id, entityId: 'meridian', vendorId, invoiceNo, date, due, amount, tds, status: s, runId, msme })

export const apItems: ApItem[] = [
  ap('ap1', '100102', 'DST/1150', '2026-09-10', '2026-10-10', 412000, 412, st('bad', 'Overdue 3 days'), 'PR-2026-10-16'),
  ap('ap2', '100102', 'DST/1162', '2026-09-16', '2026-10-16', 640000, 640, st('ok', 'In run'), 'PR-2026-10-16'),
  ap('ap3', '100315', 'BF/2026/1288', '2026-09-08', '2026-09-22', 210000, 210, st('bad', 'Overdue 21 days'), 'PR-2026-10-16'),
  ap('ap4', '100231', 'SPK/2026-27/0377', '2026-08-31', '2026-10-15', 284320, 284, st('warn', 'MSME limit 15-10-2026'), 'PR-2026-10-16', 'Micro'),
  ap('ap5', '100377', 'PE/26-27/064', '2026-09-04', '2026-10-04', 118000, 0, st('bad', 'Overdue 9 days'), 'PR-2026-10-16', 'Small'),
  ap('ap6', '100448', 'KC/2026/0698', '2026-09-12', '2026-10-12', 642800, 643, st('bad', 'Held · bank change')),
  ap('ap7', '100509', 'VR/LR/22874', '2026-10-06', '2026-10-22', 18000, 180, st('ok', 'Scheduled'), 'PR-2026-10-23'),
  ap('ap8', '100288', 'SC/226', '2026-09-04', '2026-10-19', 192400, 0, st('warn', 'MSME limit 19-10-2026'), 'PR-2026-10-23', 'Micro'),
  ap('ap9', '100166', 'PPT/122', '2026-09-09', '2026-10-09', 64000, 64, st('bad', 'Overdue 4 days')),
  ap('ap10', '100421', 'RRP/540', '2026-09-28', '2026-10-28', 410320, 410, st('ok', 'Scheduled'), 'PR-2026-10-23'),
  ap('ap11', '100533', 'OSE/0912', '2026-09-06', '2026-10-21', 146200, 0, st('warn', 'MSME limit 21-10-2026'), undefined, 'Micro'),
]

const ar = (id: string, customerId: string, invoiceNo: string, date: string, due: string, amount: number, received: number, s: Status, lastAction?: string): ArItem => ({ id, entityId: 'meridian', customerId, invoiceNo, date, due, amount, received, status: s, lastAction })

export const arItems: ArItem[] = [
  ar('ar1', 'C1001', 'MAC/26-27/2011', '2026-07-12', '2026-08-26', 1190500, 0, st('warn', 'Promise 20-10-2026'), 'Call 10-10-2026'),
  ar('ar2', 'C1002', 'MAC/26-27/2048', '2026-07-23', '2026-09-06', 862400, 0, st('warn', 'Reminder 2 sent'), 'Email 09-10-2026'),
  ar('ar3', 'C1003', 'MAC/26-27/1960', '2026-06-25', '2026-08-10', 510000, 0, st('bad', 'Disputed · short supply'), 'Credit note requested'),
  ar('ar4', 'C1004', 'MAC/26-27/2102', '2026-08-07', '2026-09-21', 425780, 0, st('warn', 'Reminder 1 sent')),
  ar('ar5', 'C1005', 'MAC/26-27/1902', '2026-05-29', '2026-07-14', 318200, 0, st('bad', 'Escalated to CFO')),
  ar('ar6', 'C1006', 'MAC/26-27/2089', '2026-07-28', '2026-09-12', 240000, 0, st('warn', 'Promise 25-10-2026')),
  ar('ar7', 'C1007', 'MAC/26-27/2141', '2026-08-11', '2026-09-25', 196320, 0, st('none', 'No contact yet')),
  ar('ar8', 'C1008', 'MAC/26-27/1811', '2026-05-05', '2026-06-20', 162000, 0, st('bad', 'Legal notice drafted')),
  ar('ar9', 'C1009', 'MAC/26-27/2160', '2026-08-17', '2026-10-01', 105000, 0, st('none', 'No contact yet')),
  ar('ar10', 'C1010', 'MAC/26-27/2177', '2026-08-20', '2026-10-04', 80000, 80000, st('ok', 'Paid · UTR awaited')),
]

export const bankAccounts: BankAccount[] = [
  { id: 'ba1', entityId: 'meridian', bank: 'HDFC Bank', account: '••••2290', type: 'Current · payments', balance: 7846720, asOf: '2026-10-12T13:20', unreconciled: 9 },
  { id: 'ba2', entityId: 'meridian', bank: 'ICICI Bank', account: '••••5512', type: 'Current · collections', balance: 2900000, asOf: '2026-10-12T13:20', unreconciled: 4 },
  { id: 'ba3', entityId: 'meridian', bank: 'State Bank of India', account: '••••0871', type: 'Cash credit', balance: 500000, asOf: '2026-10-12T13:20', unreconciled: 1 },
]

const bl = (id: string, accountId: string, date: string, narration: string, ref: string, amount: number, suggestion?: string, confidence?: number): BankLine => ({ id, entityId: 'meridian', accountId, date, narration, ref, amount, suggestion, confidence, status: suggestion ? st('warn', 'Suggested match') : st('none', 'Unmatched') })

export const bankLines: BankLine[] = [
  bl('bl1', 'ba2', '2026-10-12', 'NEFT CR SHIVNERI MOTORS LTD', 'N285261410221', 600000, 'MAC/26-27/2011 · part payment', 88),
  bl('bl2', 'ba2', '2026-10-12', 'RTGS CR BHIMA MOTOR WORKS', 'HDFCR52026101200871', 80000, 'MAC/26-27/2177 · full', 99),
  bl('bl3', 'ba1', '2026-10-12', 'NEFT DR DECCAN STEEL TRADERS', 'N285261410552', -1184000, 'PR-2026-10-09 · Deccan Steel', 97),
  bl('bl4', 'ba1', '2026-10-11', 'BANK CHARGES OCT', 'CHG2610', -1180),
  bl('bl5', 'ba1', '2026-10-11', 'GST PMT CPIN 26102700012345', 'CPIN26102700012345', -642210, 'GSTR-3B Sep 2026 · cash ledger', 95),
  bl('bl6', 'ba2', '2026-10-10', 'UPI CR 9822000210', 'UPI428812002', 12500),
  bl('bl7', 'ba1', '2026-10-10', 'TDS CHALLAN 281 BSR 0510308', 'BSR051030810', -428810, 'TDS deposit Sep 2026', 92),
  bl('bl8', 'ba3', '2026-10-09', 'INT ON CC A/C SEP', 'INT0926', -38420),
]

const tds = (id: string, section: string, legacy: string, nature: string, deductee: string, pan: string, base: number, rate: number, date: string, s: Status): TdsLine => ({ id, entityId: 'meridian', section, legacy, nature, deductee, pan, base, rate, tds: Math.round(base * rate) / 100, date, challan: s })

export const tdsLines: TdsLine[] = [
  tds('t1', '393(1)', '194Q', 'Purchase of goods', 'Deccan Steel Traders', 'AAAFX0001X', 18400000, 0.1, '2026-10-08', st('warn', 'Accruing')),
  tds('t2', '393(1)', '194Q', 'Purchase of goods', 'Sahyadri Packaging Pvt Ltd', 'AAACX0000X', 85000, 0.1, '2026-10-13', st('warn', 'Accruing')),
  tds('t3', '393(1)', '194C', 'Contractor · transport', 'Vyas Roadlines', 'AAAFX0002X', 148500, 1, '2026-10-12', st('warn', 'Accruing')),
  tds('t4', '393(1)', '194J', 'Professional fees', 'Mehta & Rao Chartered Accountants', 'AAAFM0000M', 350000, 10, '2026-10-05', st('warn', 'Accruing')),
  tds('t5', '393(1)', '194I', 'Rent · plant and machinery', 'Bhosari Equipment Rentals', 'AAAFB0000B', 240000, 2, '2026-10-01', st('warn', 'Accruing')),
  tds('t6', '393(1)', '194H', 'Commission', 'Sahyog Agencies', 'AAAFS0000S', 180000, 2, '2026-10-03', st('warn', 'Accruing')),
  tds('t7', '392', '192', 'Salaries', '214 employees', '—', 9820000, 3.84, '2026-10-01', st('warn', 'Accruing')),
  tds('t8', '393(1)', '194Q', 'Purchase of goods', 'Konkan Chemicals Pvt Ltd', 'AAACX0004X', 9640000, 0.1, '2026-09-28', st('ok', 'Deposited · Sep challan')),
]

const mi = (id: string, vendorId: string, invoiceNo: string, amount: number, acceptedOn: string, limitOn: string, s: Status, paidOn?: string): MsmeInvoice => ({ id, entityId: 'meridian', vendorId, invoiceNo, amount, acceptedOn, limitOn, status: s, paidOn })

export const msmeInvoices: MsmeInvoice[] = [
  mi('m1', '100231', 'SPK/2026-27/0377', 284320, '2026-08-31', '2026-10-15', st('warn', 'In run 16-10 · after limit')),
  mi('m2', '100288', 'SC/226', 192400, '2026-09-04', '2026-10-19', st('warn', 'Scheduled 23-10 · after limit')),
  mi('m3', '100533', 'OSE/0912', 146200, '2026-09-06', '2026-10-21', st('warn', 'Manual payment proposed')),
  mi('m4', '100377', 'PE/26-27/064', 118000, '2026-09-04', '2026-10-19', st('ok', 'In run 16-10')),
  mi('m5', '100231', 'SPK/2026-27/0418', 100300, '2026-10-08', '2026-11-22', st('none', 'Invoice in review')),
  mi('m6', '100231', 'SPK/2026-27/0402', 50150, '2026-10-03', '2026-11-17', st('ok', 'Scheduled 06-11')),
  mi('m7', '100533', 'OSE/0931', 45430, '2026-10-11', '2026-11-25', st('ok', 'Scheduled 10-11')),
  mi('m8', '100288', 'SC/219', 96600, '2026-08-01', '2026-09-15', st('ok', 'Paid 12-09-2026'), '2026-09-12'),
]

const ct = (id: string, area: string, task: string, ownerId: string, due: string, done: boolean, doneAt?: string): CloseTask => ({ id, entityId: 'meridian', area, task, ownerId, due, done, doneAt })

export const closeTasks: CloseTask[] = [
  ct('k1', 'Payables', 'Post all invoices received up to 31-10', 'RK', '2026-11-03', false),
  ct('k2', 'Payables', 'GRN-not-invoiced accrual (GR/IR)', 'RK', '2026-11-03', false),
  ct('k3', 'Payables', 'MSME 45-day review and 43B(h) list', 'FS', '2026-11-04', false),
  ct('k4', 'Receivables', 'Raise all October sales invoices', 'FS', '2026-11-01', false),
  ct('k5', 'Receivables', 'Expected credit loss review', 'FS', '2026-11-05', false),
  ct('k6', 'Bank', 'Reconcile HDFC ••••2290', 'FS', '2026-11-02', false),
  ct('k7', 'Bank', 'Reconcile ICICI ••••5512', 'FS', '2026-11-02', false),
  ct('k8', 'Bank', 'Reconcile SBI CC ••••0871', 'FS', '2026-11-02', false),
  ct('k9', 'GST', 'IMS actions saved before 2B generation', 'PN', '2026-11-13', false),
  ct('k10', 'GST', 'GSTR-1 filed', 'PN', '2026-11-11', false),
  ct('k11', 'GST', 'GSTR-3B ITC reconciled to books', 'PN', '2026-11-18', false),
  ct('k12', 'TDS', 'TDS deposit for October', 'FS', '2026-11-07', false),
  ct('k13', 'Fixed assets', 'Depreciation run', 'FS', '2026-11-04', false),
  ct('k14', 'Inventory', 'Stock count variance posted', 'SU', '2026-11-03', false),
  ct('k15', 'Reporting', 'Trial balance review', 'AN', '2026-11-06', false),
  ct('k16', 'Reporting', 'Management pack to CFO', 'FS', '2026-11-07', false),
  ct('k0', 'Payables', 'September close signed off', 'FS', '2026-10-08', true, '2026-10-08T18:00'),
]

export const reports: ReportDef[] = [
  { id: 'r1', name: 'Schedule III ageing — trade payables', group: 'Statutory', description: 'MSME and others by age from due date, disputed shown separately.', lastRun: '2026-10-08T18:10', format: 'XLSX · PDF' },
  { id: 'r2', name: 'Schedule III ageing — trade receivables', group: 'Statutory', description: 'Undisputed and disputed, considered good and credit impaired.', lastRun: '2026-10-08T18:10', format: 'XLSX · PDF' },
  { id: 'r3', name: 'MSME Form 1 draft', group: 'Statutory', description: 'Amounts due to micro and small enterprises over 45 days, with reasons.', format: 'XLSX' },
  { id: 'r4', name: '43B(h) disallowance working', group: 'Tax', description: 'MSME dues unpaid past the limit at year end.', format: 'XLSX' },
  { id: 'r5', name: 'GSTR-2B vs books reconciliation', group: 'GST', description: 'Matched, partial and missing documents with ITC.', lastRun: '2026-10-13T13:10', format: 'XLSX' },
  { id: 'r6', name: 'ITC at risk (180-day and 16(4))', group: 'GST', description: 'Invoices whose ITC must be reversed or claimed soon.', format: 'XLSX · PDF' },
  { id: 'r7', name: 'TDS deduction register', group: 'Tax', description: 'Deductions by section, deductee and challan.', format: 'XLSX' },
  { id: 'r8', name: '13-week cash forecast', group: 'Management', description: 'Collections, payments and closing balance by week.', lastRun: '2026-10-13T15:10', format: 'XLSX · PDF' },
  { id: 'r9', name: 'Exception ageing and SLA', group: 'Management', description: 'Open exceptions by type, owner and SLA breach.', format: 'XLSX' },
  { id: 'r10', name: 'Approval audit trail', group: 'Audit', description: 'Every decision with evidence, reason code and approver.', format: 'PDF' },
]

export const notifications: Notification[] = [
  { id: 'n1', entityId: 'meridian', at: '2026-10-13T15:02', title: 'Payment run waiting for CFO', body: 'PR-2026-10-16 · ₹58,72,450.00 approved by Farah Siddiqui', route: '/payables/runs/PR-2026-10-16', read: false, tone: 'acc' },
  { id: 'n2', entityId: 'meridian', at: '2026-10-13T11:05', title: 'EX-1031 raised to Critical', body: 'Konkan Chemicals bank change; payments blocked', route: '/exceptions?ex=EX-1031', read: false, tone: 'bad' },
  { id: 'n3', entityId: 'meridian', at: '2026-10-13T10:53', title: 'Possible duplicate', body: 'SPK/2026-27/0418 arrived by email and WhatsApp', route: '/intake?doc=in-0418e', read: false, tone: 'warn' },
  { id: 'n4', entityId: 'meridian', at: '2026-10-13T09:00', title: 'MSME limit in 2 days', body: 'Sahyadri SPK/2026-27/0377 · limit 15-10-2026', route: '/msme', read: false, tone: 'warn' },
  { id: 'n5', entityId: 'meridian', at: '2026-10-12T17:00', title: 'Bank feed not updated', body: 'No statement from HDFC since 12-10 13:20', route: '/bank', read: false, tone: 'warn' },
  { id: 'n6', entityId: 'meridian', at: '2026-10-12T09:00', title: 'MSME Form 1 due 31-10-2026', body: 'Draft lists 6 vendors', route: '/msme', read: false, tone: 'none' },
  { id: 'n7', entityId: 'meridian', at: '2026-10-11T16:20', title: 'IMS synced', body: '254 inward documents for Oct 2026', route: '/gst', read: true, tone: 'ok' },
]

export const audit: AuditEntry[] = [
  { id: 'a1', at: '2026-10-13T11:42', userId: 'PN', entityId: 'meridian', action: 'Saved IMS actions to portal', target: 'GSTIN 27AAACM0000M1Z2', detail: '3 actions' },
  { id: 'a2', at: '2026-10-13T11:20', userId: 'FS', entityId: 'meridian', action: 'Approved payment run', target: 'PR-2026-10-16', detail: '₹58,72,450.00 · approver 1 of 2 · "Konkan held until call-back."' },
  { id: 'a3', at: '2026-10-13T11:05', userId: 'FS', entityId: 'meridian', action: 'Changed priority', target: 'EX-1031', detail: 'High → Critical' },
  { id: 'a4', at: '2026-10-12T15:20', userId: 'FS', entityId: 'meridian', action: 'Rejected in IMS', target: 'SGE/098', detail: 'No PO; supplier not in vendor master' },
  { id: 'a5', at: '2026-10-12T09:15', userId: 'AN', entityId: 'meridian', action: 'Assigned exception', target: 'EX-1031', detail: 'to Farah Siddiqui' },
  { id: 'a6', at: '2026-10-11T16:02', userId: 'PV', entityId: 'meridian', action: 'Blocked vendor payments', target: 'Vendor 100448', detail: 'Rule BANK-CHG-01' },
]
