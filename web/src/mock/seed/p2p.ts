import type { DocLine, EvidenceDoc, ExtractedField, IntakeDoc, Invoice, MatchCell, MatchRow, PaperDoc, PurchaseOrder, Stage, Status } from '@/lib/types'

const st = (tone: Status['tone'], label: string): Status => ({ tone, label })
const MERIDIAN = { name: 'Meridian Auto Components Pvt Ltd', addr: 'Gat 412, Chakan Industrial Area, Pune 410501', gstin: '27AAACM0000M1Z2' }

/* ---------- helpers that build realistic documents from a few numbers ---------- */

function paper(o: {
  kind?: PaperDoc['kind']; supplier: string; address: string; gstin?: string; number: string; date: string; lines: DocLine[]
  refs?: string; irn?: string; udyam?: string; bank?: string; terms?: string; boxes?: Record<string, number>; interstate?: boolean
}): PaperDoc {
  const taxable = o.lines.reduce((s, l) => s + l.amount, 0)
  const tax = Math.round(taxable * 0.18 * 100) / 100
  return {
    kind: o.kind ?? 'TAX INVOICE', supplier: o.supplier, address: o.address, supplierGstin: o.gstin, udyam: o.udyam,
    number: o.number, date: o.date, refs: o.refs, irn: o.irn,
    billTo: MERIDIAN.name, billToAddress: MERIDIAN.addr, billToGstin: MERIDIAN.gstin, pos: o.interstate ? '24-Gujarat' : '27-Maharashtra',
    lines: o.lines, taxable,
    cgst: o.interstate ? 0 : tax / 2, sgst: o.interstate ? 0 : tax / 2, igst: o.interstate ? tax : 0,
    total: taxable + tax, bank: o.bank, terms: o.terms,
    boxes: o.boxes ?? { supplier: 97, gstin: 98, number: 96, date: 95, total: 97 },
  }
}

const line = (desc: string, hsn: string, qty: number, unit: string, rate: number, confidence = 95): DocLine => ({ desc, hsn, qty, unit, rate, amount: qty * rate, confidence })

function fieldsFor(p: PaperDoc, conf: Partial<Record<string, number>> = {}): ExtractedField[] {
  const c = (k: string, d: number) => conf[k] ?? d
  const f: ExtractedField[] = []
  if (p.supplierGstin) f.push({ key: 'gstin', label: 'Supplier GSTIN', value: p.supplierGstin, confidence: c('gstin', 98), mono: true })
  f.push({ key: 'billTo', label: 'Bill-to GSTIN', value: p.billToGstin ?? '', confidence: c('billTo', 97), mono: true })
  f.push({ key: 'number', label: p.kind === 'TAX INVOICE' ? 'Invoice no.' : 'Document no.', value: p.number, confidence: c('number', 96), mono: true })
  f.push({ key: 'date', label: 'Document date', value: p.date, confidence: c('date', 95) })
  f.push({ key: 'taxable', label: 'Taxable value', value: String(p.taxable), confidence: c('taxable', 95), num: true })
  if (p.igst) f.push({ key: 'igst', label: 'IGST 18%', value: String(p.igst), confidence: c('tax', 94), num: true })
  else {
    f.push({ key: 'cgst', label: 'CGST 9%', value: String(p.cgst), confidence: c('tax', 94), num: true })
    f.push({ key: 'sgst', label: 'SGST 9%', value: String(p.sgst), confidence: c('tax', 94), num: true })
  }
  f.push({ key: 'total', label: 'Total', value: String(p.total), confidence: c('total', 97), num: true })
  return f
}

/* ---------- the Sahyadri invoice, exactly as in the design ---------- */

const spkLines: DocLine[] = [
  { desc: 'HDPE Separator Tray 600x400', hsn: '3923', qty: 1000, unit: 'Nos', rate: 87, amount: 87000, confidence: 76 },
  { desc: 'Freight charges', hsn: '9965', qty: 1, unit: '', rate: 2000, amount: 2000, confidence: 89 },
]
const spkPaper: PaperDoc = {
  kind: 'TAX INVOICE', supplier: 'Sahyadri Packaging Pvt Ltd', address: 'Plot 14, MIDC Bhosari, Pune 411026, Maharashtra',
  supplierGstin: '27AAACX0000X1Z5', udyam: 'UDYAM-MH-26-0000000 (Micro)', number: 'SPK/2026-27/0418', date: '2026-10-10',
  refs: 'PO Ref: 4500012345 · E-way bill: 3410 0000 7788',
  irn: 'a3f9c2d7 51be0c44 9e1f7a62 d0c8b3e5 7f24a910 6c5e8d13 b2a4f0e9 61d7e71c',
  billTo: MERIDIAN.name, billToAddress: MERIDIAN.addr, billToGstin: MERIDIAN.gstin, pos: '27-Maharashtra',
  lines: spkLines, taxable: 89000, cgst: 8010, sgst: 8010, igst: 0, total: 105020,
  bank: 'HDFC Bank, Bhosari · A/c 5020 0000 4417 · IFSC HDFC0001234', terms: 'Payment within 15 days',
  boxes: { supplier: 99, gstin: 99, number: 98, date: 97, irn: 71, billTo: 98, pos: 96, hsn: 76, bank: 68, terms: 88, total: 99, taxable: 96 },
}
const spkFields: ExtractedField[] = [
  { key: 'gstin', label: 'Supplier GSTIN', value: '27AAACX0000X1Z5', confidence: 99, mono: true, check: st('ok', 'Active · vendor 100231') },
  { key: 'billTo', label: 'Bill-to GSTIN', value: '27AAACM0000M1Z2', confidence: 98, mono: true },
  { key: 'number', label: 'Invoice no.', value: 'SPK/2026-27/0418', confidence: 98, mono: true },
  { key: 'date', label: 'Invoice date', value: '2026-10-10', confidence: 97 },
  { key: 'irn', label: 'IRN', value: 'a3f9c2d7…61d7e71c', confidence: 71, mono: true },
  { key: 'pos', label: 'Place of supply', value: '27 · Maharashtra', confidence: 96, check: st('none', 'intra-state → CGST + SGST') },
  { key: 'taxable', label: 'Taxable value', value: '89000', confidence: 96, num: true },
  { key: 'cgst', label: 'CGST 9%', value: '8010', confidence: 95, num: true },
  { key: 'sgst', label: 'SGST 9%', value: '8010', confidence: 95, num: true },
  { key: 'igst', label: 'IGST', value: '0', confidence: 99, num: true },
  { key: 'total', label: 'Total', value: '105020', confidence: 99, num: true, check: st('ok', 'Taxable + tax = total') },
  { key: 'bank', label: 'Bank details', value: 'HDFC0001234 · A/c ••••4417', confidence: 68, mono: true, check: st('ok', 'Same as vendor master') },
  { key: 'terms', label: 'Payment terms', value: '15 days', confidence: 88, check: st('warn', 'PO says 30 days') },
]

/* ---------- intake ---------- */

const doc = (o: Partial<IntakeDoc> & Pick<IntakeDoc, 'id' | 'channel' | 'receivedAt' | 'from' | 'type' | 'vendorName' | 'docNo' | 'status'>): IntakeDoc => ({
  entityId: 'meridian', pages: 1, sizeKb: 180, fields: [], lines: [], ...o,
})

const rrpPaper = paper({ supplier: 'Ratnagiri Rubber Products', address: 'MIDC Lote Parshuram, Ratnagiri 415722', gstin: '27AAAFX0007X1Z1', number: 'RRP/561', date: '2026-10-11', lines: [line('Rubber bush 32 mm', '4016', 1480, 'Nos', 50)], refs: 'PO Ref: 4500012398' })
const bfPaper = paper({ supplier: 'Bharat Forgings Pvt Ltd', address: 'Plot 7, Kurkumbh MIDC, Daund 413802', gstin: '27AAACX0006X1Z3', number: 'BF/2026/1340', date: '2026-10-09', lines: [line('Forged flange F-40', '7326', 600, 'Nos', 350)], refs: 'PO Ref: 4500012377' })
const pptPaper = paper({ supplier: 'Pune Precision Tools', address: 'Bhosari Industrial Estate, Pune 411026', gstin: '27AAACX0010X1Z2', number: 'PPT/131', date: '2026-10-08', lines: [line('Carbide insert CNMG 120408', '8209', 300, 'Nos', 165, 84)], refs: 'PO Ref: 4500012360', boxes: { supplier: 94, gstin: 96, number: 90, date: 88, total: 91 } })
const pePaper = paper({ supplier: 'Patel Electricals', address: 'Shop 12, Nana Peth, Pune 411002', gstin: '27AAAFX0003X1Z9', number: 'PE/26-27/076', date: '2026-10-01', lines: [line('MCB 32A 4-pole', '8536', 20, 'Nos', 1550, 66)], refs: 'Inward register IN-2210', boxes: { supplier: 82, gstin: 70, number: 74, date: 69, total: 77 } })
const kcPaper = { ...paper({ kind: 'CREDIT NOTE', supplier: 'Konkan Chemicals Pvt Ltd', address: 'MIDC Tarapur, Palghar 401506', gstin: '27AAACX0004X1Z7', number: 'KC/CN/0042', date: '2026-10-12', lines: [line('Rate revision, inv KC/2026/0698', '3824', 1, '', 10500)] }) }
const vrPaper = paper({ kind: 'LORRY RECEIPT', supplier: 'Vyas Roadlines', address: 'Transport Nagar, Nigdi, Pune 411044', gstin: '27AAAFX0002X1Z1', number: 'VR/LR/22931', date: '2026-10-12', lines: [line('Freight Chakan → Sanand, 9 MT', '9965', 1, '', 18500, 81)], boxes: { supplier: 90, gstin: 93, number: 88, date: 81, total: 84 } })
vrPaper.cgst = vrPaper.sgst = vrPaper.igst = 0; vrPaper.total = vrPaper.taxable
const sgePaper = paper({ supplier: 'Shree Ganesh Enterprises', address: 'Market Yard, Pune 411037', gstin: '27AAAFX0005X1Z5', number: 'SGE/112', date: '2026-10-10', lines: [line('Cotton waste', '5202', 150, 'Kg', 50)], boxes: { supplier: 80, gstin: 71, number: 76, date: 70, total: 78 } })

export const intake: IntakeDoc[] = [
  doc({
    id: 'in-0418e', channel: 'Email', receivedAt: '2026-10-13T10:40', from: 'accounts@sahyadripack.example', type: 'Tax invoice', vendorId: '100231', vendorName: 'Sahyadri Packaging Pvt Ltd',
    docNo: 'SPK/2026-27/0418', amount: 105020, confidence: 92, status: 'review', statusNote: 'Needs review', pages: 1, sizeKb: 214,
    fields: spkFields, lines: spkLines, paper: spkPaper,
    suggestedLink: { poId: '4500012345', grnId: '5000098812', match: 96, diffs: 4, note: 'Same vendor, item and quantity' }, invoiceId: 'inv-0418',
  }),
  doc({
    id: 'in-0418w', channel: 'WhatsApp', receivedAt: '2026-10-13T10:52', from: '+91 98220 00210', type: 'Tax invoice', vendorId: '100231', vendorName: 'Sahyadri Packaging Pvt Ltd',
    docNo: 'SPK/2026-27/0418', amount: 105020, confidence: 88, status: 'duplicate', duplicateOf: 'in-0418e', pages: 1, sizeKb: 1420,
    fields: spkFields.map(f => ({ ...f, confidence: Math.max(60, f.confidence - 8) })), lines: spkLines, paper: { ...spkPaper, boxes: { supplier: 90, gstin: 91, number: 88, date: 86, total: 90 } },
  }),
  doc({ id: 'in-dst1187', channel: 'SAP', receivedAt: '2026-10-13T10:15', from: 'MIRO parked doc 5105600219', type: 'Tax invoice', vendorId: '100102', vendorName: 'Deccan Steel Traders', docNo: 'DST/1187', amount: 472000, status: 'linked', linkedPoId: '4500012301', invoiceId: 'inv-dst1187' }),
  doc({ id: 'in-vr22931', channel: 'Upload', receivedAt: '2026-10-13T09:58', from: 'Rohan Kulkarni (AP)', type: 'Lorry receipt', vendorId: '100509', vendorName: 'Vyas Roadlines', docNo: 'VR/LR/22931', amount: 18500, confidence: 81, status: 'new', paper: vrPaper, fields: fieldsFor(vrPaper, { date: 81 }), lines: vrPaper.lines }),
  doc({ id: 'in-pe076', channel: 'Post', receivedAt: '2026-10-13T09:30', from: 'Inward register IN-2210', type: 'Tax invoice', vendorId: '100377', vendorName: 'Patel Electricals', docNo: 'PE/26-27/076', amount: 36580, confidence: 64, status: 'review', statusNote: 'Needs review', paper: pePaper, fields: [...fieldsFor(pePaper, { gstin: 70, date: 69, number: 74 }), { key: 'irn', label: 'IRN', value: 'Not printed', confidence: 0, check: st('bad', 'E-invoicing applies to this supplier') }], lines: pePaper.lines, suggestedLink: { poId: '4500012388', match: 81, diffs: 1, note: 'Same vendor and item; IRN missing' }, invoiceId: 'inv-pe076' }),
  doc({ id: 'in-kccn42', channel: 'Email', receivedAt: '2026-10-13T09:12', from: 'billing@konkanchem.example', type: 'Credit note', vendorId: '100448', vendorName: 'Konkan Chemicals Pvt Ltd', docNo: 'KC/CN/0042', amount: -12390, confidence: 95, status: 'new', paper: kcPaper, fields: fieldsFor(kcPaper), lines: kcPaper.lines }),
  doc({ id: 'in-promo', channel: 'Email', receivedAt: '2026-10-13T08:47', from: 'offers@toolmart.example', type: 'Promotion', vendorName: '—', docNo: '—', confidence: 98, status: 'notfinance', pages: 2, sizeKb: 860 }),
  doc({ id: 'in-dc0931', channel: 'WhatsApp', receivedAt: '2026-10-12T18:20', from: '+91 99300 00418', type: 'Delivery challan', vendorId: '100231', vendorName: 'Sahyadri Packaging Pvt Ltd', docNo: 'DC/0931', confidence: 90, status: 'linked', linkedPoId: '4500012345' }),
  doc({ id: 'in-sge112', channel: 'Email', receivedAt: '2026-10-12T17:05', from: 'sales@shreeganesh.example', type: 'Tax invoice', vendorName: 'Shree Ganesh Enterprises', docNo: 'SGE/112', amount: 8850, confidence: 71, status: 'rejected', statusNote: 'GSTIN cancelled', paper: sgePaper, fields: [...fieldsFor(sgePaper, { gstin: 71 }).map(f => f.key === 'gstin' ? { ...f, check: st('bad', 'Cancelled on portal 30-09-2026') } : f)], lines: sgePaper.lines }),
  doc({ id: 'in-rrp561', channel: 'Email', receivedAt: '2026-10-12T16:20', from: 'billing@ratnagiri-rubber.example', type: 'Tax invoice', vendorId: '100421', vendorName: 'Ratnagiri Rubber Products', docNo: 'RRP/561', amount: rrpPaper.total, confidence: 94, status: 'new', paper: rrpPaper, fields: fieldsFor(rrpPaper), lines: rrpPaper.lines, suggestedLink: { poId: '4500012398', grnId: '5000098840', match: 99, diffs: 0, note: 'Same vendor, item, quantity and rate' } }),
  doc({ id: 'in-bf1340', channel: 'Upload', receivedAt: '2026-10-12T12:05', from: 'Suresh Patil (Stores)', type: 'Tax invoice', vendorId: '100315', vendorName: 'Bharat Forgings Pvt Ltd', docNo: 'BF/2026/1340', amount: bfPaper.total, confidence: 91, status: 'new', paper: bfPaper, fields: fieldsFor(bfPaper), lines: bfPaper.lines, suggestedLink: { poId: '4500012377', grnId: '5000098829', match: 97, diffs: 0, note: 'Same vendor, item and quantity' } }),
  doc({ id: 'in-ppt131', channel: 'Email', receivedAt: '2026-10-12T11:40', from: 'accounts@puneprecision.example', type: 'Tax invoice', vendorId: '100166', vendorName: 'Pune Precision Tools', docNo: 'PPT/131', amount: pptPaper.total, confidence: 83, status: 'review', statusNote: 'Needs review', paper: pptPaper, fields: fieldsFor(pptPaper, { date: 88, number: 90 }), lines: pptPaper.lines, suggestedLink: { poId: '4500012360', grnId: '5000098817', match: 93, diffs: 1, note: 'Rate ₹165.00 vs ₹163.50 on PO, within 1% tolerance' }, invoiceId: 'inv-ppt131' }),
  doc({ id: 'ns-in1', entityId: 'northstar', channel: 'Email', receivedAt: '2026-10-13T09:40', from: 'ar@deccanbulk.example', type: 'Tax invoice', vendorId: '200110', vendorName: 'Deccan Bulk Actives Pvt Ltd', docNo: 'DBA/2210', amount: 1416000, confidence: 93, status: 'new' }),
  doc({ id: 'kv-in1', entityId: 'kaveri', channel: 'WhatsApp', receivedAt: '2026-10-13T11:02', from: '+91 98450 00210', type: 'Tax invoice', vendorId: '300210', vendorName: 'Mysore Agro Mills', docNo: 'MAM/774', amount: 264500, confidence: 79, status: 'review', statusNote: 'Needs review' }),
]

/* ---------- purchase orders ---------- */

const S = (key: string, name: string, state: Stage['state'], date: string, owner: string, ref: string, docs: string[], sla: Status, ownerId?: string): Stage => ({ key, name, state, date, owner, ref, docs, sla, ownerId })

const evidence = (id: string, title: string, number: string, date: string, source: EvidenceDoc['source'], linkedBy: string, check: Status, p?: PaperDoc): EvidenceDoc => ({ id, title, number, date, source, linkedBy, check, paper: p })

const ewbPaper: PaperDoc = {
  kind: 'E-WAY BILL', supplier: 'Sahyadri Packaging Pvt Ltd', address: 'Plot 14, MIDC Bhosari, Pune 411026', supplierGstin: '27AAACX0000X1Z5', number: '3410 0000 7788', date: '2026-10-06',
  refs: 'Challan DC/0931 · vehicle MH 12 XX 0000 · Vyas Roadlines LR VR/LR/22874 · valid till 09-10-2026',
  billTo: MERIDIAN.name, billToAddress: MERIDIAN.addr, billToGstin: MERIDIAN.gstin, lines: [{ desc: 'HDPE separator tray 600×400 mm', hsn: '3926', qty: 1000, unit: 'Nos', rate: 85, amount: 85000, confidence: 79 }],
  taxable: 85000, cgst: 7650, sgst: 7650, igst: 0, total: 100300, boxes: { number: 99, gstin: 98, billTo: 97, hsn: 79, total: 96 },
}

export const purchaseOrders: PurchaseOrder[] = [
  {
    id: '4500012345', entityId: 'meridian', vendorId: '100231', value: 100300, taxable: 85000, buyerId: 'VJ', plant: '1100 · Chakan', createdOn: '2026-09-22',
    elapsedDays: 24, health: 'on track overall',
    stages: [
      S('neg', 'Negotiated terms', 'done', '19-09-2026', 'Vikram Joshi · Procurement', 'RFQ 6000004471', ['Quote rev 2', 'Approval'], st('ok', '1 d · SLA 5 d'), 'VJ'),
      S('po', 'SAP PO', 'done', '22-09-2026', 'Vikram Joshi · released by M. Deshpande', 'PO 4500012345', ['PO PDF'], st('ok', '1 d · SLA 2 d'), 'VJ'),
      S('dispatch', 'Dispatch', 'done', '06-10-2026', 'Sahyadri Packaging', 'EWB 3410 0000 7788', ['Challan DC/0931', 'E-way bill', 'LR VR/LR/22874'], st('ok', 'On time')),
      S('gate', 'Gate entry', 'done', '08-10-2026 09:42', 'Suresh Patil · Stores', 'GE-1100-08812', ['Gate pass', 'Vehicle photo'], st('ok', '0 d · SLA 1 d'), 'SU'),
      S('grn', 'GRN', 'done', '08-10-2026 16:10', 'Suresh Patil · Stores', 'GRN 5000098812', ['GRN', 'QC report'], st('ok', '6 h · SLA 1 d'), 'SU'),
      S('review', 'Invoice review', 'cur', 'Received 13-10-2026', 'Rohan Kulkarni · AP', 'SPK/2026-27/0418', ['Invoice PDF', 'WhatsApp copy'], st('warn', 'Day 1 of 2 · 4 flags'), 'RK'),
      S('posting', 'AP posting', 'ns', 'Target 15-10-2026', 'Rohan Kulkarni · AP', 'MIRO — not posted', [], st('none', 'SLA 2 d after review'), 'RK'),
      S('payment', 'Payment', 'ns', 'Due 09-11-2026', 'Farah Siddiqui · Controller', 'UTR —', [], st('none', 'MSME limit 22-11-2026'), 'FS'),
      S('recon', 'Reconciled', 'ns', 'After bank statement', 'Automatic · bank match', 'Clearing doc —', [], st('none', 'SLA 3 d after payment')),
    ],
    lines: [{ line: '10', material: 'HDPE separator tray 600×400 mm', materialNo: '100004512', hsn: '3926', uom: 'Nos', rate: 85, ordered: 1000, received: 1000, accepted: 1000, invoiced: 1000, posted: 0, paid: 0 }],
    invoicedTaxable: 89000, invoiceNote: '₹4,000.00 above PO', freightInvoiced: 2000, agreedDue: '2026-11-09',
    docs: [
      evidence('ev1', 'Quotation, revised', 'Q-SPK-2209 rev 2', '18-09-2026', 'Email', 'Vikram Joshi', st('ok', 'Approved')),
      evidence('ev2', 'Approval note', 'Email · RE: Revised quote', '19-09-2026', 'Email', 'Meera Deshpande', st('ok', 'Approved')),
      evidence('ev3', 'Purchase order', '4500012345', '22-09-2026', 'SAP', 'System', st('ok', 'Released')),
      evidence('ev4', 'Delivery challan', 'DC/0931', '06-10-2026', 'WhatsApp', 'Auto-linked', st('ok', 'Matches PO')),
      evidence('ev5', 'E-way bill', '3410 0000 7788', '06-10-2026', 'GST portal', 'Auto-linked', st('ok', 'Valid · used 08-10'), ewbPaper),
      evidence('ev6', 'Lorry receipt', 'VR/LR/22874', '06-10-2026', 'Upload', 'Suresh Patil', st('ok', 'Matches vehicle')),
      evidence('ev7', 'Gate pass', 'GE-1100-08812', '08-10-2026', 'Upload', 'Suresh Patil', st('ok', 'Recorded')),
      evidence('ev8', 'Goods receipt', '5000098812', '08-10-2026', 'SAP', 'System', st('ok', '1,000 accepted')),
      evidence('ev9', 'QC report', 'QC-26-1188', '08-10-2026', 'Upload', 'QC lab', st('ok', 'Passed')),
      evidence('ev10', 'Tax invoice', 'SPK/2026-27/0418', '10-10-2026', 'Extracted', 'Auto-linked', st('warn', '4 flags'), spkPaper),
      evidence('ev11', 'Tax invoice, copy', 'SPK/2026-27/0418', '10-10-2026', 'WhatsApp', 'Auto-linked', st('none', 'Duplicate'), spkPaper),
    ],
    negotiation: {
      locked: true,
      current: { version: 2, date: '2026-09-19', rate: 85, freight: 'FOR destination — included in rate', terms: '30 days from invoice date' },
      history: [{ version: 1, date: '2026-09-12', rate: 88, freight: 'Freight extra', terms: '15 days', note: 'The invoice follows parts of v1.' }],
      delivery: 'By 10-10-2026, Chakan plant', validTill: '31-03-2027', gst: 'Extra at 18% · HSN 3926',
      approvedBy: 'MD', approvedAt: '2026-09-19T16:12', approvedVia: 'email', quoteRef: 'Q-SPK-2209 rev 2',
    },
    sap: { gateEntry: 'GE-1100-08812', grn: '5000098812' },
    msme: { acceptedOn: '2026-10-08', limitOn: '2026-11-22', invoiceAsks: '2026-10-25' },
    invoiceId: 'inv-0418',
  },
]

/** Lighter POs for the list and the other review invoices; stages are generated. */
function simplePo(id: string, vendorId: string, material: string, hsn: string, qty: number, rate: number, stageIdx: number, blocked: boolean, created: string, invoiceId?: string, health = 'on track'): PurchaseOrder {
  const names = ['Negotiated terms', 'SAP PO', 'Dispatch', 'Gate entry', 'GRN', 'Invoice review', 'AP posting', 'Payment', 'Reconciled']
  const keys = ['neg', 'po', 'dispatch', 'gate', 'grn', 'review', 'posting', 'payment', 'recon']
  const taxable = qty * rate
  return {
    id, entityId: 'meridian', vendorId, value: taxable * 1.18, taxable, buyerId: 'VJ', plant: '1100 · Chakan', createdOn: created, elapsedDays: 10 + stageIdx * 3, health,
    stages: names.map((n, i) => S(keys[i], n, i < stageIdx ? 'done' : i === stageIdx ? (blocked ? 'blk' : 'cur') : 'ns', i <= stageIdx ? '—' : 'Not started', i === 4 || i === 3 ? 'Suresh Patil · Stores' : i >= 5 ? 'Rohan Kulkarni · AP' : 'Vikram Joshi · Procurement', i === 1 ? 'PO ' + id : '—', [], i < stageIdx ? st('ok', 'Done') : i === stageIdx ? (blocked ? st('bad', 'Blocked') : st('warn', 'In progress')) : st('none', 'Not started'))),
    lines: [{ line: '10', material, materialNo: '1000' + id.slice(-5), hsn, uom: 'Nos', rate, ordered: qty, received: stageIdx >= 4 ? qty : 0, accepted: stageIdx >= 4 ? qty : 0, invoiced: stageIdx >= 5 ? qty : 0, posted: stageIdx >= 6 ? qty : 0, paid: 0 }],
    invoicedTaxable: stageIdx >= 5 ? taxable : 0, docs: [evidence(id + '-po', 'Purchase order', id, created.split('-').reverse().join('-'), 'SAP', 'System', st('ok', 'Released'))],
    negotiation: { locked: true, current: { version: 1, date: created, rate, freight: 'FOR destination', terms: '30 days from invoice date' }, history: [], delivery: 'Chakan plant', validTill: '31-03-2027', gst: 'Extra at 18% · HSN ' + hsn, approvedBy: 'MD', approvedAt: created + 'T12:00', approvedVia: 'SAP release', quoteRef: '—' },
    sap: {}, invoiceId,
  }
}

purchaseOrders.push(
  simplePo('4500012301', '100102', 'MS sheet 2 mm, cold rolled', '7209', 6400, 62.5, 5, true, '2026-09-10', 'inv-dst1187', 'GRN missing'),
  simplePo('4500012360', '100166', 'Carbide insert CNMG 120408', '8209', 300, 163.5, 5, false, '2026-09-18', 'inv-ppt131'),
  simplePo('4500012377', '100315', 'Forged flange F-40', '7326', 600, 350, 4, false, '2026-09-20', 'inv-bf1352'),
  simplePo('4500012388', '100377', 'MCB 32A 4-pole', '8536', 20, 1550, 5, true, '2026-09-24', 'inv-pe076', 'IRN missing'),
  simplePo('4500012398', '100421', 'Rubber bush 32 mm', '4016', 1480, 50, 4, false, '2026-09-26', 'inv-rrp554'),
  simplePo('4500012412', '100288', 'Grey iron casting GC-7', '7325', 900, 182, 2, false, '2026-10-02'),
)

/* ---------- invoices in review ---------- */

const C = (s: MatchCell['s'], v?: string, d?: string, num?: boolean): MatchCell => ({ s, v, d, num })
const NA = C('na')

const spkRows: MatchRow[] = [
  { field: 'Supplier & GSTIN', cells: [C('ok', 'Sahyadri · 27AAACX0000X1Z5'), C('ok', 'Vendor 100231'), C('ok', 'Vendor 100231'), C('ok', '27AAACX0000X1Z5', 'Active on portal'), C('ok', 'Vendor 100231')] },
  { field: 'Bill-to GSTIN', cells: [NA, C('ok', '27AAACM0000M1Z2'), C('ok', 'Plant 1100', '27 · Maharashtra'), C('ok', '27AAACM0000M1Z2'), C('ok', '27AAACM0000M1Z2')] },
  { field: 'Place of supply', cells: [NA, C('ok', '27 · Maharashtra'), NA, C('ok', '27 · Maharashtra'), C('ok', '27 · intra-state')] },
  { field: 'Invoice no. / date', cells: [NA, NA, NA, C('ok', 'SPK/2026-27/0418', '10-10-2026'), C('ok', 'Same reference', '10-10-2026')] },
  { field: 'IRN', cells: [NA, NA, NA, C('ok', 'a3f9c2d7…61d7e71c', 'Signed QR verified on IRP'), C('none', 'Not captured', 'Add before posting')] },
  { field: 'E-way bill', cells: [NA, NA, C('ok', '3410 0000 7788', 'From gate entry'), C('ok', '3410 0000 7788'), NA] },
  { field: 'Item text', cells: [C('ok', 'HDPE separator tray 600×400'), C('ok', 'HDPE separator tray 600×400 mm'), C('ok', 'Same as PO'), C('warn', 'HDPE Separator Tray 600x400', 'Text match 94%'), C('ok', 'Same as PO')] },
  { field: 'HSN', cells: [C('ok', '3926'), C('ok', '3926'), NA, C('bad', '3923', 'Differs from PO'), C('ok', '3926')] },
  { field: 'Quantity', cells: [C('ok', '1,000 Nos', '', true), C('ok', '1,000', '', true), C('ok', '1,000 accepted', '', true), C('ok', '1,000', '', true), C('ok', '1,000', '', true)] },
  { field: 'Rate', cells: [C('ok', '₹85.00', '', true), C('ok', '₹85.00', '', true), NA, C('bad', '₹87.00', '+₹2.00/pc · +₹2,000.00', true), C('ok', '₹85.00', '', true)] },
  { field: 'Taxable value', cells: [C('ok', '₹85,000.00', '', true), C('ok', '₹85,000.00', '', true), C('ok', '₹85,000.00', 'Valued at PO rate', true), C('bad', '₹89,000.00', '+₹4,000.00', true), C('ok', '₹85,000.00', '', true)] },
  { field: 'CGST 9%', cells: [C('ok', '₹7,650.00', '', true), C('ok', '₹7,650.00', '', true), NA, C('warn', '₹8,010.00', '+₹360.00 · follows rate and freight', true), C('ok', '₹7,650.00', '', true)] },
  { field: 'SGST 9%', cells: [C('ok', '₹7,650.00', '', true), C('ok', '₹7,650.00', '', true), NA, C('warn', '₹8,010.00', '+₹360.00 · follows rate and freight', true), C('ok', '₹7,650.00', '', true)] },
  { field: 'Freight', cells: [C('ok', 'FOR destination', 'Included in rate'), C('ok', '₹0.00', 'Incoterm FOR', true), NA, C('bad', '₹2,000.00', 'Not agreed', true), C('ok', '₹0.00', '', true)] },
  { field: 'Total', cells: [C('ok', '₹1,00,300.00', '', true), C('ok', '₹1,00,300.00', '', true), NA, C('bad', '₹1,05,020.00', '+₹4,720.00', true), C('ok', '₹1,00,300.00', 'Parked at PO values', true)] },
  { field: 'Payment terms', cells: [C('ok', '30 days'), C('ok', 'Z030 · 30 days'), NA, C('bad', '15 days', 'Shorter than agreed'), C('ok', 'Z030 · 30 days')] },
]

const heads = (poId: string, grnId: string, invNo: string, conf: string, parked: string) => [
  { title: 'Negotiated', ref: 'Quote · confirmed', source: 'Extracted' as const, when: 'confirmed' },
  { title: 'PO', ref: poId, source: 'SAP' as const, when: '10 min ago' },
  { title: 'GRN', ref: grnId || '—', source: 'SAP' as const, when: '10 min ago' },
  { title: 'Invoice', ref: invNo, source: 'Extracted' as const, when: conf },
  { title: 'SAP posted', ref: parked, source: 'SAP' as const, when: '10 min ago' },
]

const inr = (n: number) => '₹' + new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(n)

/** Clean or near-clean three-way match rows for generated invoices. */
function rows(o: { vendor: string; gstin: string; item: string; hsn: string; qty: number; poRate: number; invRate: number; grn: boolean; irn: boolean; interstate?: boolean }): MatchRow[] {
  const poTax = o.qty * o.poRate, invTax = o.qty * o.invRate
  const diff = invTax - poTax
  const rateCell = diff === 0 ? C('ok', inr(o.invRate), '', true) : C(Math.abs(diff) / poTax <= 0.01 ? 'warn' : 'bad', inr(o.invRate), `${diff > 0 ? '+' : '−'}${inr(Math.abs(o.invRate - o.poRate))}/pc · within 1% tolerance`, true)
  const g = o.grn
  return [
    { field: 'Supplier & GSTIN', cells: [C('ok', o.vendor), C('ok', o.gstin), g ? C('ok', o.gstin) : C('none', 'No GRN'), C('ok', o.gstin, 'Active on portal'), C('ok', o.gstin)] },
    { field: 'IRN', cells: [NA, NA, NA, o.irn ? C('ok', 'Verified on IRP') : C('bad', 'Not on invoice', 'E-invoicing applies'), C('none', 'Not captured')] },
    { field: 'Item text', cells: [C('ok', o.item), C('ok', o.item), g ? C('ok', 'Same as PO') : C('none'), C('ok', o.item), C('ok', 'Same as PO')] },
    { field: 'HSN', cells: [C('ok', o.hsn), C('ok', o.hsn), NA, C('ok', o.hsn), C('ok', o.hsn)] },
    { field: 'Quantity', cells: [C('ok', o.qty.toLocaleString('en-IN'), '', true), C('ok', o.qty.toLocaleString('en-IN'), '', true), g ? C('ok', o.qty.toLocaleString('en-IN') + ' accepted', '', true) : C('none', 'Missing', 'No goods receipt in SAP'), C('ok', o.qty.toLocaleString('en-IN'), '', true), C('ok', o.qty.toLocaleString('en-IN'), '', true)] },
    { field: 'Rate', cells: [C('ok', inr(o.poRate), '', true), C('ok', inr(o.poRate), '', true), NA, rateCell, C('ok', inr(o.poRate), '', true)] },
    { field: 'Taxable value', cells: [C('ok', inr(poTax), '', true), C('ok', inr(poTax), '', true), g ? C('ok', inr(poTax), '', true) : C('none'), diff === 0 ? C('ok', inr(invTax), '', true) : C(rateCell.s, inr(invTax), (diff > 0 ? '+' : '−') + inr(Math.abs(diff)), true), C('ok', inr(poTax), '', true)] },
    { field: 'Total', cells: [C('ok', inr(poTax * 1.18), '', true), C('ok', inr(poTax * 1.18), '', true), NA, C(diff === 0 ? 'ok' : rateCell.s, inr(invTax * 1.18), diff === 0 ? '' : (diff > 0 ? '+' : '−') + inr(Math.abs(diff * 1.18)), true), C('ok', inr(poTax * 1.18), '', true)] },
  ]
}

const baseTds = (base: number) => ({ nature: 'Purchase of goods', section: 'Section 393(1) · purchase of goods', legacy: 'Legacy: 194Q, Income-tax Act 1961', threshold: '₹50,00,000.00 a year', crossed: 'Crossed 04-08-2026', rate: '0.1%', base, amount: Math.round(base * 0.001 * 100) / 100, note: 'Deposit by 07-11-2026.' })
const baseItc = (itc: number) => ({ status: st('warn', 'Pending — not yet in GSTR-2B'), onInvoice: itc, afterDn: itc, ims: 'Not visible yet', imsNote: "Supplier's GSTR-1 for Oct due 11-11-2026", expected: '14-11-2026 · Oct 2026', pay180: 'Pay within 180 days or reverse ITC', s164: 'Claim by 30-11-2027', filing: '12 of 12 returns on time' })

function simpleInvoice(o: { id: string; vendorId: string; vendor: string; gstin: string; no: string; date: string; received: string; channel: Invoice['channel']; poId: string; grnId?: string; item: string; hsn: string; qty: number; poRate: number; invRate: number; irn: boolean; flags?: Invoice['flags']; msme?: Invoice['msme']; intakeId?: string }): Invoice {
  const taxable = o.qty * o.invRate
  const tax = Math.round(taxable * 0.18 * 100) / 100
  return {
    id: o.id, entityId: 'meridian', vendorId: o.vendorId, invoiceNo: o.no, date: o.date, receivedAt: o.received, channel: o.channel,
    taxable, cgst: tax / 2, sgst: tax / 2, igst: 0, total: taxable + tax, poId: o.poId, grnId: o.grnId, intakeId: o.intakeId, status: 'needs-decision', flags: o.flags ?? [],
    heads: heads(o.poId, o.grnId ?? '', o.no, '94%', 'Parked'), rows: rows({ vendor: o.vendor, gstin: o.gstin, item: o.item, hsn: o.hsn, qty: o.qty, poRate: o.poRate, invRate: o.invRate, grn: !!o.grnId, irn: o.irn }),
    dnLines: o.invRate > o.poRate ? [{ text: `Rate difference · ${o.qty.toLocaleString('en-IN')} × ${inr(o.invRate - o.poRate)}`, taxable: o.qty * (o.invRate - o.poRate), gst: o.qty * (o.invRate - o.poRate) * 0.18 }] : [],
    tds: baseTds(taxable), itc: baseItc(tax), msme: o.msme, docTitle: 'Tax invoice',
  }
}

export const invoices: Invoice[] = [
  {
    id: 'inv-0418', entityId: 'meridian', vendorId: '100231', invoiceNo: 'SPK/2026-27/0418', date: '2026-10-10', receivedAt: '2026-10-13T10:40', channel: 'Email',
    taxable: 89000, cgst: 8010, sgst: 8010, igst: 0, total: 105020, poId: '4500012345', grnId: '5000098812', intakeId: 'in-0418e', status: 'needs-decision',
    flags: [
      { id: 'f1', title: 'Rate ₹87.00 on invoice vs ₹85.00 on PO', detail: '+₹2.00 per piece × 1,000 = +₹2,000.00 taxable. Matches superseded quote v1.', usual: 'Usual resolution: debit note or vendor credit note', amount: 2000, reason: 'RT-01', exceptionId: 'EX-1042' },
      { id: 'f2', title: 'Freight ₹2,000.00 charged', detail: 'Agreed terms are FOR destination — freight included in rate. Transporter Vyas Roadlines was paid by the vendor.', usual: 'Usual resolution: debit note', amount: 2000, reason: 'FR-02', exceptionId: 'EX-1043' },
      { id: 'f3', title: 'HSN 3923 on invoice vs 3926 on PO', detail: "Both at 18%, so tax is unaffected. The vendor's GSTR-1 will report 3923.", usual: 'Usual resolution: ask vendor to confirm classification', amount: 0, reason: 'HS-03', exceptionId: 'EX-1044' },
      { id: 'f4', title: 'Payment terms 15 days vs 30 days agreed', detail: 'Schedule on agreed terms (09-11-2026), well inside the MSME 45-day limit.', usual: 'Usual resolution: keep agreed terms, note to vendor', amount: 0, reason: 'PT-04' },
    ],
    heads: [
      { title: 'Negotiated', ref: 'Quote v2 · 19-09-2026', source: 'Extracted', when: 'confirmed' },
      { title: 'PO', ref: '4500012345', source: 'SAP', when: '10 min ago' },
      { title: 'GRN', ref: '5000098812', source: 'SAP', when: '10 min ago' },
      { title: 'Invoice', ref: 'SPK/2026-27/0418', source: 'Extracted', when: '92%' },
      { title: 'SAP posted', ref: 'Parked 5105600231', source: 'SAP', when: '10 min ago' },
    ],
    rows: spkRows,
    dnLines: [
      { text: 'Rate difference · 1,000 × ₹2.00', taxable: 2000, gst: 360 },
      { text: 'Freight not agreed (FOR destination)', taxable: 2000, gst: 360 },
    ],
    tds: { nature: 'Purchase of goods', section: 'Section 393(1) · purchase of goods', legacy: 'Legacy: 194Q, Income-tax Act 1961', threshold: '₹50,00,000.00 a year', crossed: 'Crossed 04-08-2026 · year to date ₹61,72,904.00', rate: '0.1%', base: 89000, amount: 89, note: 'With the debit note the base becomes ₹85,000.00 and TDS ₹85.00. Deposit by 07-11-2026.' },
    itc: { status: st('warn', 'Pending — not yet in GSTR-2B'), onInvoice: 16020, afterDn: 15300, ims: 'Not visible yet', imsNote: "Supplier's GSTR-1 for Oct due 11-11-2026", expected: '14-11-2026 · Oct 2026', pay180: 'Pay by 08-04-2027 or reverse ITC', s164: 'Claim by 30-11-2027', filing: '12 of 12 returns on time' },
    msme: { daysLeft: 40, acceptedOn: '2026-10-08', payBy: '2026-11-22', recommended: '2026-11-09', note: 'agreed 30 days. Late payment carries compound interest at 3× the RBI bank rate and a 43B(h) disallowance.' },
    draft: { kind: 'dn', reasons: ['RT-01', 'FR-02'], note: 'Rate and freight follow superseded quote v1. Agreed v2 (19-09-2026) is ₹85.00 FOR destination, 30 days. Asked vendor to confirm HSN 3926.' },
    docTitle: 'Tax invoice',
  },
  simpleInvoice({ id: 'inv-dst1187', vendorId: '100102', vendor: 'Deccan Steel Traders', gstin: '27AAAFX0001X1Z3', no: 'DST/1187', date: '2026-10-08', received: '2026-10-13T10:15', channel: 'SAP', poId: '4500012301', item: 'MS sheet 2 mm, cold rolled', hsn: '7209', qty: 6400, poRate: 62.5, invRate: 62.5, irn: true, flags: [{ id: 'f1', title: 'No goods receipt in SAP', detail: 'Invoice for 6,400 kg received; stores has not posted a GRN against PO 4500012301. Gate entry GE-1100-08790 exists.', usual: 'Usual resolution: hold until GRN is posted', amount: 472000, reason: 'GR-05', exceptionId: 'EX-1019' }] }),
  simpleInvoice({ id: 'inv-pe076', vendorId: '100377', vendor: 'Patel Electricals', gstin: '27AAAFX0003X1Z9', no: 'PE/26-27/076', date: '2026-10-01', received: '2026-10-13T09:30', channel: 'Post', poId: '4500012388', grnId: '5000098833', item: 'MCB 32A 4-pole', hsn: '8536', qty: 20, poRate: 1550, invRate: 1550, irn: false, intakeId: 'in-pe076', msme: { daysLeft: 33, acceptedOn: '2026-10-01', payBy: '2026-11-15', recommended: '2026-10-31', note: 'Small enterprise; payment within 45 days of acceptance.' }, flags: [{ id: 'f1', title: 'No IRN on a B2B invoice', detail: 'Patel Electricals crossed the e-invoicing turnover limit. Without an IRN the invoice is not valid for ITC.', usual: 'Usual resolution: hold and ask the vendor for an e-invoice', amount: 0, reason: 'IR-06', exceptionId: 'EX-1035' }] }),
  simpleInvoice({ id: 'inv-ppt131', vendorId: '100166', vendor: 'Pune Precision Tools', gstin: '27AAACX0010X1Z2', no: 'PPT/131', date: '2026-10-08', received: '2026-10-12T11:40', channel: 'Email', poId: '4500012360', grnId: '5000098817', item: 'Carbide insert CNMG 120408', hsn: '8209', qty: 300, poRate: 163.5, invRate: 165, irn: true, intakeId: 'in-ppt131', flags: [{ id: 'f1', title: 'Rate ₹165.00 vs ₹163.50 on PO', detail: '+₹1.50 per piece × 300 = +₹450.00 taxable. Within the 1% price tolerance.', usual: 'Usual resolution: approve with note', amount: 450, reason: 'RT-01' }] }),
  simpleInvoice({ id: 'inv-rrp554', vendorId: '100421', vendor: 'Ratnagiri Rubber Products', gstin: '27AAAFX0007X1Z1', no: 'RRP/554', date: '2026-10-08', received: '2026-10-09T14:10', channel: 'Email', poId: '4500012398', grnId: '5000098840', item: 'Rubber bush 32 mm', hsn: '4016', qty: 1480, poRate: 50, invRate: 50, irn: true }),
  simpleInvoice({ id: 'inv-bf1352', vendorId: '100315', vendor: 'Bharat Forgings Pvt Ltd', gstin: '27AAACX0006X1Z3', no: 'BF/2026/1352', date: '2026-10-11', received: '2026-10-12T09:20', channel: 'Email', poId: '4500012377', grnId: '5000098829', item: 'Forged flange F-40', hsn: '7326', qty: 1640, poRate: 350, invRate: 350, irn: true }),
]
