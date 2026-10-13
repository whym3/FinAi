import type { ExceptionItem, ExceptionRule } from '@/lib/types'

const x = (o: Partial<ExceptionItem> & Pick<ExceptionItem, 'id' | 'type' | 'title' | 'docRef' | 'ownerId' | 'status' | 'priority' | 'due' | 'createdAt' | 'amount'>): ExceptionItem => ({
  entityId: 'meridian', comments: [], history: [{ at: o.createdAt + 'T09:00', text: `Created by rule on SAP sync` }], ...o,
})

export const exceptions: ExceptionItem[] = [
  x({
    id: 'EX-1031', type: 'Vendor bank details changed', title: 'Konkan Chemicals — new bank account requested by email', docRef: 'Vendor 100448', docRoute: '/vendors/100448',
    ownerId: 'FS', status: 'in-progress', priority: 'Critical', due: '2026-10-14', createdAt: '2026-10-11', amount: 642800,
    blocks: { vendorId: '100448', amount: 642800, runId: 'PR-2026-10-16' },
    evidence: {
      head: ['Vendor master', 'Requested'],
      rows: [
        { label: 'Bank · IFSC', current: 'HDFC0000456', requested: 'ICIC0000789', bad: true, mono: true },
        { label: 'Account', current: '••••7120', requested: '••••3391', bad: true, mono: true },
        { label: 'Name at bank', current: 'KONKAN CHEMICALS PVT LTD', requested: 'KONKAN CHEM TRADING CO', bad: true, sub: 'Penny-drop · 11-10-2026' },
        { label: 'Sender', current: 'billing@konkanchem.example', requested: 'accounts@konkanchem-in.example', bad: true, sub: 'Domain first seen 11-10-2026' },
        { label: 'Cancelled cheque', current: 'On file 2024', requested: '58% · blurred photo', bad: true },
        { label: 'Call-back', current: '+91 22 0000 0418', requested: 'Not done', bad: false },
      ],
    },
    sources: [{ source: 'SAP', text: 'vendor master · 10 min ago' }, { source: 'Bank', text: 'penny-drop' }, { source: 'Extracted', text: 'email + cheque' }],
    checklist: [
      { id: 'c1', label: 'Call back on the number in the vendor master, not the email', done: false },
      { id: 'c2', label: 'Confirmation on letterhead, signed by a director', done: false },
      { id: 'c3', label: 'Second approver (CFO) approves the master change', done: false },
    ],
    comments: [
      { id: 'cm3', byId: 'PV', at: '2026-10-11T16:02', text: 'Bank change request detected in email; vendor payments blocked automatically.' },
      { id: 'cm1', byId: 'FS', at: '2026-10-13T11:05', text: 'Sender domain is konkanchem-in, not konkanchem. Holding all payments until call-back.' },
      { id: 'cm2', byId: 'RK', at: '2026-10-13T11:20', text: 'The number in the email signature goes to voicemail. I have not used it.' },
    ],
    history: [
      { at: '2026-10-11T16:02', text: 'Created from email intake by rule BANK-CHG-01' },
      { at: '2026-10-11T16:02', text: 'Payments to vendor 100448 blocked automatically' },
      { at: '2026-10-12T09:15', text: 'Assigned to Farah Siddiqui by Arvind Nair' },
      { at: '2026-10-13T11:05', text: 'Priority raised to Critical by Farah Siddiqui' },
    ],
  }),
  x({ id: 'EX-1019', type: 'GRN missing', title: 'Invoice received, no goods receipt in SAP', docRef: 'DST/1187', docRoute: '/review/inv-dst1187', ownerId: 'SU', status: 'open', priority: 'Critical', due: '2026-10-09', createdAt: '2026-10-07', amount: 472000, evidenceNote: 'Gate entry GE-1100-08790 recorded 07-10-2026 for 6,400 kg; no MIGO 101 posting against PO 4500012301.', sources: [{ source: 'SAP', text: 'EKBE · 10 min ago' }] }),
  x({ id: 'EX-1038', type: 'MSME deadline risk', title: 'Sahyadri — 45-day limit on 15-10-2026', docRef: 'SPK/2026-27/0377', docRoute: '/msme', ownerId: 'RK', status: 'open', priority: 'Critical', due: '2026-10-15', createdAt: '2026-10-08', amount: 284320, evidenceNote: 'Accepted 31-08-2026. Included in payment run PR-2026-10-16 (value date 16-10-2026) — one day after the limit. Move to a manual payment on 15-10 or split the run.', sources: [{ source: 'SAP', text: '10 min ago' }, { source: 'Udyam', text: 'Micro · verified' }] }),
  x({ id: 'EX-1040', type: 'MSME deadline risk', title: 'Shakti Castings — 45-day limit on 19-10-2026', docRef: 'SC/226', docRoute: '/msme', ownerId: 'RK', status: 'open', priority: 'Critical', due: '2026-10-17', createdAt: '2026-10-10', amount: 192400 }),
  x({ id: 'EX-1017', type: 'MSME deadline risk', title: 'Om Sai Engineering — 45-day limit on 21-10-2026', docRef: 'OSE/0912', docRoute: '/msme', ownerId: 'FS', status: 'awaiting-approval', statusNote: 'Manual payment proposed', priority: 'Critical', due: '2026-10-18', createdAt: '2026-10-05', amount: 146200 }),
  x({ id: 'EX-1029', type: 'Not in GSTR-2B', title: 'Deccan Steel Aug invoice missing from 2B', docRef: 'DST/1102', docRoute: '/gst', ownerId: 'PN', status: 'waiting-vendor', priority: 'Critical', due: '2026-10-10', createdAt: '2026-09-22', amount: 84960, comments: [{ id: 'c1', byId: 'PN', at: '2026-10-09T12:30', text: 'Vendor says they will amend GSTR-1 in October. Reminder sent.' }] }),
  x({ id: 'EX-1027', type: 'Missing IRN', title: 'Patel Electricals invoice without IRN; e-invoicing applies', docRef: 'PE/26-27/071', ownerId: 'RK', status: 'waiting-vendor', priority: 'Critical', due: '2026-10-11', createdAt: '2026-10-04', amount: 41300 }),
  x({ id: 'EX-1035', type: 'Missing IRN', title: 'Patel Electricals invoice by post without IRN', docRef: 'PE/26-27/076', docRoute: '/review/inv-pe076', ownerId: 'RK', status: 'open', priority: 'Critical', due: '2026-10-16', createdAt: '2026-10-12', amount: 36580 }),
  x({ id: 'EX-1033', type: 'Not in GSTR-2B', title: 'Konkan Chemicals Sep invoice missing from 2B', docRef: 'KC/2026/0711', docRoute: '/gst', ownerId: 'PN', status: 'open', priority: 'Critical', due: '2026-10-12', createdAt: '2026-09-29', amount: 18000 }),
  x({ id: 'EX-1042', type: 'Rate difference', title: 'Rate ₹87.00 on invoice vs ₹85.00 on PO', docRef: 'SPK/2026-27/0418', docRoute: '/review/inv-0418', ownerId: 'RK', status: 'in-progress', priority: 'High', due: '2026-10-15', createdAt: '2026-10-13', amount: 2360 }),
  x({ id: 'EX-1043', type: 'Freight not agreed', title: 'Freight ₹2,000.00 charged on FOR destination terms', docRef: 'SPK/2026-27/0418', docRoute: '/review/inv-0418', ownerId: 'RK', status: 'in-progress', priority: 'High', due: '2026-10-15', createdAt: '2026-10-13', amount: 2360 }),
  x({ id: 'EX-1008', type: 'Rate difference', title: 'Steel rate ₹62.40/kg vs ₹62.00 on PO', docRef: 'DST/1150', ownerId: 'VJ', status: 'waiting-vendor', priority: 'Medium', due: '2026-10-11', createdAt: '2026-10-01', amount: 3540 }),
  x({ id: 'EX-1044', type: 'HSN mismatch', title: 'HSN 3923 on invoice vs 3926 on PO', docRef: 'SPK/2026-27/0418', docRoute: '/review/inv-0418', ownerId: 'RK', status: 'open', priority: 'Low', due: '2026-10-20', createdAt: '2026-10-13', amount: 0 }),
  x({ id: 'EX-1045', type: 'Duplicate', title: 'WhatsApp copy of an emailed invoice', docRef: 'SPK/2026-27/0418', docRoute: '/intake?doc=in-0418w', ownerId: 'PV', status: 'awaiting-approval', statusNote: 'Proposed: close', priority: 'Low', due: '2026-10-14', createdAt: '2026-10-13', amount: 105020 }),
  x({ id: 'EX-1002', type: 'Duplicate', title: 'Same invoice by post and email', docRef: 'DST/1139', ownerId: 'PV', status: 'resolved', priority: 'Low', due: '2026-10-08', createdAt: '2026-10-06', resolvedAt: '2026-10-08T10:00', resolution: 'Post copy marked duplicate', amount: 212400 }),
  x({ id: 'EX-1006', type: 'Not in GSTR-2B', title: 'Appeared in 2B after supplier amendment', docRef: 'PE/26-27/058', ownerId: 'PN', status: 'resolved', priority: 'Medium', due: '2026-10-09', createdAt: '2026-09-28', resolvedAt: '2026-10-09T15:30', resolution: 'Found in IMS after amendment', amount: 12960 }),
  x({ id: 'EX-1011', type: 'Freight not agreed', title: 'Vendor issued credit note KC/CN/0039', docRef: 'KC/2026/0698', ownerId: 'RK', status: 'resolved', priority: 'High', due: '2026-10-10', createdAt: '2026-10-03', resolvedAt: '2026-10-10T11:15', resolution: 'Credit note received', amount: 4720 }),
  x({ id: 'EX-2004', entityId: 'northstar', type: 'MSME deadline risk', title: 'Golconda Glass Vials — 45-day limit breached', docRef: 'GGV/0388', ownerId: 'KM', status: 'open', priority: 'Critical', due: '2026-10-08', createdAt: '2026-09-30', amount: 620000 }),
  x({ id: 'EX-2009', entityId: 'northstar', type: 'Not in GSTR-2B', title: 'Deccan Bulk Actives Aug invoices missing from 2B', docRef: 'DBA/2101', ownerId: 'KM', status: 'waiting-vendor', priority: 'High', due: '2026-10-12', createdAt: '2026-09-25', amount: 412000 }),
  x({ id: 'EX-3002', entityId: 'kaveri', type: 'MSME deadline risk', title: 'Mysore Agro Mills — 45-day limit breached', docRef: 'MAM/702', ownerId: 'KM', status: 'open', priority: 'Critical', due: '2026-10-10', createdAt: '2026-10-02', amount: 480000 }),
]

export const rules: ExceptionRule[] = [
  { id: 'BANK-CHG-01', name: 'Vendor bank change', type: 'Vendor bank details changed', description: 'Any request to change vendor bank details blocks payments to that vendor until verified.', enabled: true, priority: 'Critical', slaDays: 2 },
  { id: 'GRN-MISS-01', name: 'Invoice without GRN', type: 'GRN missing', description: 'Invoice against a PO with no goods receipt after 2 days.', enabled: true, priority: 'Critical', slaDays: 2 },
  { id: 'MSME-45-01', name: 'MSME 45-day limit', type: 'MSME deadline risk', description: 'Unpaid MSME invoice within 7 days of the 45-day limit, or scheduled after it.', enabled: true, priority: 'Critical', slaDays: 2 },
  { id: 'GST-2B-01', name: 'Not in GSTR-2B', type: 'Not in GSTR-2B', description: 'Invoice in books, not in GSTR-2B for the period.', enabled: true, priority: 'Critical', slaDays: 5 },
  { id: 'IRN-01', name: 'Missing IRN', type: 'Missing IRN', description: 'B2B invoice from an e-invoicing supplier without a valid IRN.', enabled: true, priority: 'Critical', slaDays: 3 },
  { id: 'RATE-01', name: 'Rate above PO', type: 'Rate difference', description: 'Invoice rate above PO rate beyond 1% tolerance.', enabled: true, priority: 'High', slaDays: 2 },
  { id: 'FRT-01', name: 'Freight not agreed', type: 'Freight not agreed', description: 'Freight charged on FOR destination terms.', enabled: true, priority: 'High', slaDays: 2 },
  { id: 'HSN-01', name: 'HSN differs from PO', type: 'HSN mismatch', description: 'HSN on invoice differs from PO material master.', enabled: true, priority: 'Low', slaDays: 7 },
  { id: 'DUP-01', name: 'Duplicate document', type: 'Duplicate', description: 'Same supplier GSTIN, invoice number and total arrive more than once.', enabled: true, priority: 'Low', slaDays: 1 },
]
