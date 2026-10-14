// Mock API. Every function is async and returns copies, like a network call would.
// The backend phase replaces these bodies with fetch() calls; signatures stay.
import { addDays, daysBetween, int, inr, nowIso, todayIso } from '@/lib/format'
import type {
  Channel, DecisionKind, Entity, OverviewSnapshot, ExceptionItem, ExceptionStatus, ImsAction, IntakeDoc, Invoice, Notification, Priority, SearchHit, Status, Tone, User,
} from '@/lib/types'
import { db, resetDb } from './db'
import { ApiError } from '@/api/http'
import * as srv from '@/api/server'

export { ApiError }
export * from '@/api/server'

const wait = () => new Promise(r => setTimeout(r, 150 + Math.random() * 250))
const out = async <T,>(v: T): Promise<T> => { await wait(); return structuredClone(v) }
const st = (tone: Tone, label: string): Status => ({ tone, label })

const fail = (msg: string): never => { throw new ApiError(msg) }

function user(id: string): User { return db.users.find(u => u.id === id) ?? fail('Unknown user') }
function canAct(u: User) { if (u.role === 'auditor') fail('Your role is read-only.') }
function name(id: string) { return db.users.find(u => u.id === id)?.name ?? id }

function log(userId: string, entityId: string, action: string, target: string, detail = '') {
  db.audit.unshift({ id: 'a' + db.seq.audit++, at: nowIso(), userId, entityId, action, target, detail })
}
function notify(n: Omit<Notification, 'id' | 'at' | 'read'>) {
  db.notifications.unshift({ ...n, id: 'n' + db.seq.audit++, at: nowIso(), read: false })
}

/* ================= bootstrap & session ================= */

/** Seeded demo entities merged with clients from the server (server wins on shared ids). Works mock-only when the server is down. */
export async function getBootstrap() {
  const remote = await srv.listServerEntities().then(r => ({ online: true, list: r }), () => ({ online: false, list: [] as Entity[] }))
  const merged = db.entities.map(e => ({ ...e, ...remote.list.find(r => r.id === e.id) }))
  const extra = remote.list.filter(r => !db.entities.some(e => e.id === r.id))
  const base = await out({ firm: db.firm, users: db.users, sync: db.sync, rules: db.rules })
  return { ...base, entities: [...merged, ...extra], serverOnline: remote.online }
}
export async function resetDemo() { resetDb(); await wait() }

export async function retrySync(key: 'sap' | 'gst' | 'bank', userId: string) {
  const s = db.sync.find(x => x.key === key)!
  s.at = nowIso()
  s.error = undefined
  if (key === 'bank') db.bankAccounts.forEach(a => (a.asOf = nowIso()))
  if (key === 'gst') db.gstSummaries.forEach(g => (g.imsSyncedAt = nowIso()))
  log(userId, 'meridian', 'Synced ' + s.system, s.label)
  return out(s)
}

/* ================= overview ================= */

export const getOverview = (entityId: string) => out({
  snapshot: db.overview.find(o => o.entityId === entityId) ?? emptySnapshot(entityId),
  deadlines: db.deadlines.filter(d => d.entityId === entityId),
  vendors: db.vendors.filter(v => v.entityId === entityId).sort((a, b) => b.outstanding - a.outstanding).slice(0, 10),
  customers: db.customers.filter(c => c.entityId === entityId && c.overdue > 0).sort((a, b) => b.overdue - a.overdue).slice(0, 10),
  pendingRun: db.paymentRuns.find(r => r.entityId === entityId && r.status === 'awaiting-approval') ?? null,
})

// A newly onboarded client has no SAP data yet: zeros, so screens show empty states instead of errors.
function emptySnapshot(entityId: string): OverviewSnapshot {
  return { entityId, asOf: nowIso(), kpiPay: [], kpiRec: [], critical: { open: 0, pastSla: 0, blocked: 0, breakdown: [] }, cash: { opening: 0, minimum: 0, weeks: [] }, apAgeing: [], apNote: '', arAgeing: [], arNote: '' }
}

export const getFirmOverview = () => out({
  rows: db.firmRows.map(r => ({ ...r, entity: db.entities.find(e => e.id === r.entityId)! })),
  filing: db.filing, filingHeads: db.filingHeads,
})

/* ================= counts & search ================= */

export async function getCounts(entityId: string) {
  const e = <T extends { entityId: string }>(xs: T[]) => xs.filter(x => x.entityId === entityId)
  const openEx = e(db.exceptions).filter(x => x.status !== 'resolved')
  return out({
    intake: e(db.intake).filter(d => d.status === 'new').length,
    intakeReview: e(db.intake).filter(d => d.status === 'review').length,
    p2p: e(db.purchaseOrders).filter(p => p.stages.some(s => s.state === 'blk' || (s.state === 'cur' && s.sla.tone !== 'ok'))).length,
    review: e(db.invoices).filter(i => i.status === 'needs-decision').length,
    exceptions: openEx.length,
    critical: openEx.filter(x => x.priority === 'Critical').length,
    payables: e(db.paymentRuns).filter(r => r.status === 'awaiting-approval').length,
    receivables: e(db.arItems).filter(a => a.received < a.amount && daysBetween(a.due, todayIso()) > 0).length,
    bank: e(db.bankLines).filter(l => l.status.tone !== 'ok').length,
    gst: e(db.imsRows).filter(r => r.portal === 'No action').length,
    tds: e(db.tdsLines).filter(t => t.challan.tone !== 'ok').length,
    msme: e(db.msmeInvoices).filter(m => m.status.tone === 'warn' || m.status.tone === 'bad').length,
    close: e(db.closeTasks).filter(t => !t.done).length,
    vendors: e(db.vendors).filter(v => v.blocked).length,
    notifications: e(db.notifications).filter(n => !n.read).length,
  })
}

export async function search(entityId: string, q: string): Promise<SearchHit[]> {
  await wait()
  const s = q.trim().toLowerCase()
  if (s.length < 2) return []
  const has = (...xs: (string | undefined)[]) => xs.some(x => x?.toLowerCase().includes(s))
  const hits: SearchHit[] = []
  db.invoices.filter(i => i.entityId === entityId && has(i.invoiceNo, i.poId, i.grnId)).forEach(i => hits.push({ kind: 'Invoice', label: i.invoiceNo, sub: `${db.vendors.find(v => v.id === i.vendorId)?.name} · ${inr(i.total)}`, route: '/review/' + i.id }))
  db.intake.filter(d => d.entityId === entityId && has(d.docNo, d.from, d.vendorName)).forEach(d => hits.push({ kind: 'Intake · ' + d.type, label: d.docNo, sub: `${d.vendorName} · ${d.channel}`, route: '/intake?doc=' + d.id }))
  db.purchaseOrders.filter(p => p.entityId === entityId && has(p.id, p.sap.grn, p.sap.gateEntry)).forEach(p => hits.push({ kind: 'Purchase order', label: 'PO ' + p.id, sub: db.vendors.find(v => v.id === p.vendorId)?.name ?? '', route: '/p2p/' + p.id }))
  db.vendors.filter(v => v.entityId === entityId && has(v.name, v.gstin, v.id, v.pan)).forEach(v => hits.push({ kind: 'Vendor', label: v.name, sub: `${v.gstin} · vendor ${v.id}`, route: '/vendors/' + v.id }))
  db.customers.filter(c => c.entityId === entityId && has(c.name, c.gstin)).forEach(c => hits.push({ kind: 'Customer', label: c.name, sub: c.gstin, route: '/customers?c=' + c.id }))
  db.exceptions.filter(x => x.entityId === entityId && has(x.id, x.title, x.docRef)).forEach(x => hits.push({ kind: 'Exception', label: `${x.id} · ${x.type}`, sub: x.title, route: '/exceptions?ex=' + x.id }))
  db.paymentRuns.filter(r => r.entityId === entityId && has(r.id, r.h2hFile)).forEach(r => hits.push({ kind: 'Payment run', label: r.id, sub: inr(r.net), route: '/payables/runs/' + r.id }))
  return structuredClone(hits.slice(0, 20))
}

/* ================= notifications & audit ================= */

export const listNotifications = (entityId: string) => out(db.notifications.filter(n => n.entityId === entityId))
export async function markNotificationsRead(entityId: string, id?: string) {
  db.notifications.filter(n => n.entityId === entityId && (!id || n.id === id)).forEach(n => (n.read = true))
  await wait()
}
export async function listAudit(entityId: string) {
  const [local, remote] = await Promise.all([out(db.audit.filter(a => a.entityId === entityId)), srv.listServerAudit(entityId).catch(() => [])])
  return [...remote, ...local].sort((a, b) => b.at.localeCompare(a.at))
}

/* ================= intake ================= */

export async function listIntake(entityId: string) {
  // shortcut: a server outage hides email documents silently here; the Settings page shows the server status.
  const [local, remote] = await Promise.all([out(db.intake.filter(d => d.entityId === entityId)), srv.listServerIntake(entityId).catch(() => [])])
  return [...remote, ...local].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
}

function doc(id: string): IntakeDoc { return db.intake.find(d => d.id === id) ?? fail('Document not found') }

export async function editField(docId: string, key: string, value: string, userId: string) {
  canAct(user(userId))
  if (srv.isServerDoc(docId)) return srv.serverEditField(docId, key, value)
  const d = doc(docId)
  const f = d.fields.find(f => f.key === key) ?? fail('Unknown field')
  const before = f.value
  f.value = value; f.confidence = 100; f.edited = true; f.confirmedBy = userId
  log(userId, d.entityId, 'Edited extracted field', d.docNo, `${f.label}: ${before} → ${value}`)
  return out(d)
}

export async function confirmFields(docId: string, userId: string) {
  canAct(user(userId))
  if (srv.isServerDoc(docId)) return srv.serverConfirm(docId)
  const d = doc(docId)
  const low = d.fields.filter(f => f.confidence < 90 && !f.confirmedBy)
  d.fields.forEach(f => { if (!f.confirmedBy) f.confirmedBy = userId })
  d.confirmedBy = userId
  if (d.status === 'new' || d.status === 'review') d.status = d.suggestedLink || d.linkedPoId ? 'review' : 'review'
  d.statusNote = 'Fields confirmed · link to PO'
  log(userId, d.entityId, 'Confirmed extracted fields', d.docNo, low.length ? `${low.length} low-confidence field(s) accepted unchanged: ${low.map(f => f.label).join(', ')}` : 'All fields high confidence')
  return out(d)
}

export async function linkToPo(docId: string, poId: string, userId: string) {
  canAct(user(userId))
  const d = doc(docId)
  const po = db.purchaseOrders.find(p => p.id === poId && p.entityId === d.entityId) ?? fail('PO not found for this entity')
  if (!d.confirmedBy) d.fields.forEach(f => { if (!f.confirmedBy) f.confirmedBy = userId })
  d.confirmedBy = userId
  d.status = 'linked'
  d.statusNote = undefined
  d.linkedPoId = poId
  // An invoice either already exists in the review queue or is created now.
  if (d.type === 'Tax invoice' && !d.invoiceId) {
    const id = 'inv-' + d.id
    const taxable = d.paper?.taxable ?? (d.amount ?? 0) / 1.18
    const tax = (d.amount ?? 0) - taxable
    const vendor = db.vendors.find(v => v.id === d.vendorId)
    const line = po.lines[0]
    const invRate = d.lines[0]?.rate ?? line.rate
    const diff = (invRate - line.rate) * (d.lines[0]?.qty ?? line.ordered)
    const matchState = diff === 0 ? 'ok' : Math.abs(diff) / (line.rate * line.ordered) <= 0.01 ? 'warn' : 'bad'
    const inv: Invoice = {
      id, entityId: d.entityId, vendorId: d.vendorId ?? '', invoiceNo: d.docNo, date: d.paper?.date ?? todayIso(), receivedAt: d.receivedAt, channel: d.channel as Channel,
      taxable, cgst: tax / 2, sgst: tax / 2, igst: 0, total: d.amount ?? 0, poId, grnId: d.suggestedLink?.grnId, intakeId: d.id, status: 'needs-decision',
      flags: diff === 0 ? [] : [{ id: 'f1', title: `Rate ${inr(invRate)} on invoice vs ${inr(line.rate)} on PO`, detail: `${diff > 0 ? '+' : ''}${inr(diff)} taxable.`, usual: matchState === 'warn' ? 'Usual resolution: approve with note' : 'Usual resolution: debit note', amount: diff, reason: 'RT-01' }],
      heads: [
        { title: 'Negotiated', ref: 'Quote · confirmed', source: 'Extracted', when: 'confirmed' },
        { title: 'PO', ref: poId, source: 'SAP', when: '10 min ago' },
        { title: 'GRN', ref: d.suggestedLink?.grnId ?? '—', source: 'SAP', when: '10 min ago' },
        { title: 'Invoice', ref: d.docNo, source: 'Extracted', when: (d.confidence ?? 90) + '%' },
        { title: 'SAP posted', ref: 'Not parked', source: 'SAP', when: '10 min ago' },
      ],
      rows: [
        { field: 'Supplier & GSTIN', cells: [{ s: 'ok', v: vendor?.shortName }, { s: 'ok', v: 'Vendor ' + d.vendorId }, d.suggestedLink?.grnId ? { s: 'ok', v: 'Vendor ' + d.vendorId } : { s: 'none' }, { s: 'ok', v: vendor?.gstin, d: 'Active on portal' }, { s: 'none', v: 'Not parked' }] },
        { field: 'Quantity', cells: [{ s: 'ok', v: int(line.ordered), num: true }, { s: 'ok', v: int(line.ordered), num: true }, d.suggestedLink?.grnId ? { s: 'ok', v: int(line.accepted || line.ordered) + ' accepted', num: true } : { s: 'none' }, { s: 'ok', v: int(d.lines[0]?.qty ?? line.ordered), num: true }, { s: 'na' }] },
        { field: 'Rate', cells: [{ s: 'ok', v: inr(line.rate), num: true }, { s: 'ok', v: inr(line.rate), num: true }, { s: 'na' }, { s: matchState, v: inr(invRate), d: diff ? inr(diff) : '', num: true }, { s: 'na' }] },
        { field: 'Total', cells: [{ s: 'ok', v: inr(line.rate * line.ordered * 1.18), num: true }, { s: 'ok', v: inr(line.rate * line.ordered * 1.18), num: true }, { s: 'na' }, { s: matchState, v: inr(d.amount ?? 0), num: true }, { s: 'na' }] },
      ],
      dnLines: diff > 0 ? [{ text: 'Rate difference', taxable: diff, gst: diff * 0.18 }] : [],
      tds: { nature: 'Purchase of goods', section: 'Section 393(1) · purchase of goods', legacy: 'Legacy: 194Q, Income-tax Act 1961', threshold: '₹50,00,000.00 a year', crossed: '—', rate: '0.1%', base: taxable, amount: Math.round(taxable * 0.1) / 100, note: 'Deposit by 07-11-2026.' },
      itc: { status: st('warn', 'Pending — not yet in GSTR-2B'), onInvoice: tax, afterDn: tax, ims: 'Not visible yet', imsNote: "Supplier's GSTR-1 for Oct due 11-11-2026", expected: '14-11-2026 · Oct 2026', pay180: 'Pay within 180 days or reverse ITC', s164: 'Claim by 30-11-2027', filing: vendor ? `${vendor.filing.onTime} of ${vendor.filing.of} returns on time` : '—' },
      docTitle: 'Tax invoice',
    }
    db.invoices.push(inv)
    d.invoiceId = id
    po.invoiceId = po.invoiceId ?? id
  }
  // Move the PO timeline to invoice review.
  const idx = po.stages.findIndex(s => s.key === 'review')
  po.stages.forEach((s, i) => { if (i < idx && s.state !== 'done') s.state = 'done' })
  if (po.stages[idx].state === 'ns') { po.stages[idx].state = 'cur'; po.stages[idx].date = 'Received ' + d.receivedAt.slice(0, 10).split('-').reverse().join('-'); po.stages[idx].ref = d.docNo; po.stages[idx].sla = st('warn', 'Day 1 of 2') }
  log(userId, d.entityId, 'Linked document to PO', d.docNo, 'PO ' + poId)
  return out(d)
}

export async function markDuplicate(docId: string, userId: string, ofId?: string) {
  canAct(user(userId))
  const d = doc(docId)
  d.status = 'duplicate'
  if (ofId) d.duplicateOf = ofId
  const ex = db.exceptions.find(x => x.type === 'Duplicate' && x.docRef === d.docNo && x.status !== 'resolved')
  if (ex) resolveEx(ex, userId, 'Copy marked duplicate')
  log(userId, d.entityId, 'Marked duplicate', d.docNo, `${d.channel} copy${ofId ? ' of ' + doc(ofId).channel + ' original' : ''}`)
  return out(d)
}

/** "Keep this, mark the other copy duplicate" */
export async function keepOriginal(docId: string, userId: string) {
  const dup = db.intake.find(x => x.duplicateOf === docId) ?? db.intake.find(x => x.id !== docId && x.docNo === doc(docId).docNo)
  if (dup) await markDuplicate(dup.id, userId, docId)
  return out(doc(docId))
}

export async function setIntakeStatus(docId: string, status: 'notfinance' | 'rejected' | 'new', userId: string, note?: string) {
  canAct(user(userId))
  if (srv.isServerDoc(docId)) return srv.serverSetStatus(docId, status, note)
  const d = doc(docId)
  d.status = status
  d.statusNote = note
  log(userId, d.entityId, status === 'notfinance' ? 'Marked not finance' : status === 'rejected' ? 'Rejected document' : 'Restored document', d.docNo === '—' ? d.from : d.docNo, note ?? '')
  return out(d)
}

export async function uploadDocs(entityId: string, files: { name: string; size: number }[], userId: string) {
  canAct(user(userId))
  const docs = files.map(f => {
    const d: IntakeDoc = {
      id: 'up-' + db.seq.intake++, entityId, channel: 'Upload', receivedAt: nowIso(), from: name(userId) + ' (upload)', type: 'Extracting…', vendorName: '—',
      docNo: f.name, status: 'new', pages: 1, sizeKb: Math.max(1, Math.round(f.size / 1024)), fields: [], lines: [], statusNote: 'Extraction queued',
    }
    db.intake.unshift(d)
    return d
  })
  log(userId, entityId, 'Uploaded documents', `${docs.length} file(s)`, files.map(f => f.name).join(', '))
  return out(docs)
}

export async function askVendor(entityId: string, userId: string, to: string, subject: string, body: string) {
  canAct(user(userId))
  if (!body.trim()) fail('Write a message first.')
  log(userId, entityId, 'Asked vendor', to, subject)
  return out({ ok: true })
}

/* ================= purchase-to-pay ================= */

export const listPOs = (entityId: string) => out(db.purchaseOrders.filter(p => p.entityId === entityId))
export const getPO = (id: string) => out(db.purchaseOrders.find(p => p.id === id) ?? fail('PO not found'))

export async function addPoDocument(poId: string, title: string, fileName: string, userId: string) {
  canAct(user(userId))
  const po = db.purchaseOrders.find(p => p.id === poId) ?? fail('PO not found')
  po.docs.push({ id: 'ev' + db.seq.intake++, title, number: fileName, date: todayIso().split('-').reverse().join('-'), source: 'Upload', linkedBy: name(userId), check: st('none', 'Not checked yet') })
  log(userId, po.entityId, 'Added document to PO', 'PO ' + poId, `${title} · ${fileName}`)
  return out(po)
}

/* ================= invoice review ================= */

export const listInvoices = (entityId: string) => out(db.invoices.filter(i => i.entityId === entityId))
export const getInvoice = (id: string) => out(db.invoices.find(i => i.id === id) ?? fail('Invoice not found'))

export async function saveDraft(invoiceId: string, draft: { kind: DecisionKind; reasons: string[]; note: string }, userId: string) {
  canAct(user(userId))
  const inv = db.invoices.find(i => i.id === invoiceId) ?? fail('Invoice not found')
  inv.draft = draft
  log(userId, inv.entityId, 'Saved decision draft', inv.invoiceNo, draft.kind)
  return out(inv)
}

function resolveEx(x: ExceptionItem, userId: string, how: string) {
  x.status = 'resolved'; x.resolvedAt = nowIso(); x.resolution = how
  x.history.push({ at: nowIso(), text: `Resolved by ${name(userId)}: ${how}` })
}

function advancePo(inv: Invoice, outcome: 'decided' | 'held' | 'rejected', userId: string) {
  const po = db.purchaseOrders.find(p => p.id === inv.poId)
  if (!po) return
  const i = po.stages.findIndex(s => s.key === 'review')
  const s = po.stages[i]
  if (outcome === 'decided') {
    s.state = 'done'; s.sla = st('ok', `Decided by ${user(userId).initials} · ${nowIso().slice(11)}`)
    const next = po.stages[i + 1]; next.state = 'cur'; next.sla = st('warn', 'Due in 2 days')
    po.lines.forEach(l => (l.posted = l.invoiced))
    po.sap.invoiceDoc = '51056' + String(Math.floor(Math.random() * 90000) + 10000)
  } else {
    s.state = 'blk'; s.sla = st('bad', outcome === 'held' ? 'On hold' : 'Rejected')
  }
}

export async function submitDecision(invoiceId: string, kind: DecisionKind, reasons: string[], note: string, userId: string) {
  const u = user(userId); canAct(u)
  const inv = db.invoices.find(i => i.id === invoiceId) ?? fail('Invoice not found')
  if (inv.status !== 'needs-decision') fail('This invoice already has a decision.')
  if (!reasons.length) fail('Choose a reason code.')
  if ((kind === 'note' || kind === 'hold' || kind === 'reject') && !note.trim()) fail('A note is required for this decision.')
  if (u.approvalLimit <= 0) fail('Your role cannot decide on invoices.')
  const approving = kind === 'approve' || kind === 'note' || kind === 'dn'
  const second = approving && inv.total > u.approvalLimit
  const dnTax = inv.dnLines.reduce((s, l) => s + l.taxable, 0), dnGst = inv.dnLines.reduce((s, l) => s + l.gst, 0)
  if (kind === 'dn' && !inv.dnLines.length) fail('Nothing to recover: no rate or freight difference on this invoice.')
  inv.decision = {
    kind, reasons, note, byId: userId, at: nowIso(), secondApproverNeeded: second,
    debitNote: kind === 'dn' ? { no: `DN/2026-27/${String(db.seq.dn++).padStart(4, '0')}`, taxable: dnTax, gst: dnGst, total: dnTax + dnGst } : undefined,
  }
  inv.status = kind === 'hold' ? 'held' : kind === 'reject' ? 'rejected' : kind === 'dn' ? 'dn-raised' : 'approved'
  inv.draft = undefined
  // Follow-through on the exceptions behind each flag.
  for (const f of inv.flags) {
    const x = f.exceptionId && db.exceptions.find(e => e.id === f.exceptionId && e.status !== 'resolved')
    if (!x) continue
    if (kind === 'dn' && f.amount > 0) resolveEx(x, userId, `Recovered by debit note ${inv.decision.debitNote!.no}`)
    else if (kind === 'dn') { x.status = 'waiting-vendor'; x.history.push({ at: nowIso(), text: 'Sent to vendor with the debit note' }) }
    else if (kind === 'approve' || kind === 'note') resolveEx(x, userId, 'Accepted on invoice' + (note ? ': ' + note : ''))
    else if (kind === 'reject') resolveEx(x, userId, 'Invoice rejected and returned to vendor')
    else { x.status = 'in-progress'; x.history.push({ at: nowIso(), text: `Invoice put on hold by ${u.name}` }) }
  }
  if (!second) advancePo(inv, kind === 'hold' ? 'held' : kind === 'reject' ? 'rejected' : 'decided', userId)
  const intake = db.intake.find(d => d.id === inv.intakeId)
  if (intake && intake.status !== 'linked') intake.status = 'linked'
  log(userId, inv.entityId, 'Invoice decision: ' + kind, inv.invoiceNo, `${reasons.join(' + ')}${note ? ' · ' + note : ''}${inv.decision.debitNote ? ' · ' + inv.decision.debitNote.no + ' ' + inr(inv.decision.debitNote.total) : ''}${second ? ' · needs second approver' : ''}`)
  if (second) notify({ entityId: inv.entityId, title: 'Second approval needed', body: `${inv.invoiceNo} · ${inr(inv.total)} decided by ${u.name}`, route: '/approvals', tone: 'acc' })
  return out(inv)
}

export async function confirmSecondApproval(invoiceId: string, userId: string) {
  const u = user(userId); canAct(u)
  const inv = db.invoices.find(i => i.id === invoiceId) ?? fail('Invoice not found')
  const dec = inv.decision
  if (!dec?.secondApproverNeeded) return fail('No second approval pending.')
  if (dec.byId === userId) fail('The second approver must be a different person.')
  if (u.approvalLimit < inv.total) fail(`Your approval limit is ${inr(u.approvalLimit)}.`)
  dec.secondApproverNeeded = false
  advancePo(inv, 'decided', userId)
  log(userId, inv.entityId, 'Second approval', inv.invoiceNo, inr(inv.total))
  return out(inv)
}

/* ================= exceptions ================= */

export const listExceptions = (entityId: string) => out(db.exceptions.filter(x => x.entityId === entityId))
export const listRules = () => out(db.rules)
export async function toggleRule(id: string, userId: string) {
  canAct(user(userId))
  const r = db.rules.find(r => r.id === id) ?? fail('Rule not found')
  r.enabled = !r.enabled
  log(userId, 'meridian', r.enabled ? 'Enabled rule' : 'Disabled rule', r.id, r.name)
  return out(r)
}

const statusText: Record<ExceptionStatus, string> = { open: 'Open', 'in-progress': 'In progress', 'waiting-vendor': 'Waiting on vendor', 'awaiting-approval': 'Awaiting approval', resolved: 'Resolved' }

export async function updateExceptions(ids: string[], patch: { ownerId?: string; priority?: Priority; due?: string; status?: ExceptionStatus; snoozeDays?: number; resolution?: string }, userId: string) {
  const u = user(userId); canAct(u)
  for (const id of ids) {
    const x = db.exceptions.find(e => e.id === id) ?? fail('Exception not found')
    const h = (t: string) => x.history.push({ at: nowIso(), text: t })
    if (patch.ownerId && patch.ownerId !== x.ownerId) { h(`Assigned to ${name(patch.ownerId)} by ${u.name}`); x.ownerId = patch.ownerId }
    if (patch.priority && patch.priority !== x.priority) { h(`Priority ${x.priority} → ${patch.priority} by ${u.name}`); x.priority = patch.priority }
    if (patch.due && patch.due !== x.due) { h(`Due date set to ${patch.due.split('-').reverse().join('-')} by ${u.name}`); x.due = patch.due }
    if (patch.snoozeDays) { x.snoozedUntil = addDays(todayIso(), patch.snoozeDays); h(`Snoozed until ${x.snoozedUntil.split('-').reverse().join('-')} by ${u.name}`) }
    if (patch.status === 'resolved') resolveEx(x, userId, patch.resolution || 'Resolved')
    else if (patch.status && patch.status !== x.status) { h(`Status ${statusText[x.status]} → ${statusText[patch.status]} by ${u.name}`); x.status = patch.status; x.statusNote = undefined }
    log(userId, x.entityId, 'Updated exception', x.id, Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(', '))
  }
  return out(db.exceptions.filter(e => ids.includes(e.id)))
}

export async function addComment(exId: string, text: string, userId: string) {
  canAct(user(userId))
  if (!text.trim()) fail('Comment is empty.')
  const x = db.exceptions.find(e => e.id === exId) ?? fail('Exception not found')
  x.comments.push({ id: 'cm' + db.seq.comment++, byId: userId, at: nowIso(), text: text.trim() })
  const mentioned = db.users.filter(u => text.includes('@' + u.name.split(' ')[0]))
  mentioned.forEach(m => notify({ entityId: x.entityId, title: `${name(userId)} mentioned ${m.name}`, body: `${x.id}: ${text.slice(0, 80)}`, route: '/exceptions?ex=' + x.id, tone: 'none' }))
  log(userId, x.entityId, 'Commented', x.id, text.slice(0, 120))
  return out(x)
}

export async function toggleChecklist(exId: string, itemId: string, userId: string) {
  const u = user(userId); canAct(u)
  const x = db.exceptions.find(e => e.id === exId) ?? fail('Exception not found')
  const c = x.checklist?.find(c => c.id === itemId) ?? fail('Checklist item not found')
  if (itemId === 'c3' && u.role !== 'cfo' && !c.done) fail('Only the CFO can approve a vendor master change.')
  c.done = !c.done
  x.history.push({ at: nowIso(), text: `${c.done ? 'Completed' : 'Reopened'}: ${c.label} (${u.name})` })
  if (x.checklist!.every(c => c.done) && x.blocks) {
    resolveEx(x, userId, 'Bank change verified; master updated and payments released')
    const v = db.vendors.find(v => v.id === x.blocks!.vendorId)
    if (v) { v.blocked = false; v.status = st('ok', 'On schedule'); v.bank = { ...v.bank, ifsc: 'ICIC0000789', account: '50200000003391', bank: 'ICICI Bank' } }
    const ap = db.apItems.find(a => a.vendorId === x.blocks!.vendorId); if (ap) ap.status = st('ok', 'Released · next run')
  }
  log(userId, x.entityId, 'Checklist', x.id, `${c.done ? '✓' : '✗'} ${c.label}`)
  return out(x)
}

export async function recordCallback(exId: string, outcome: 'confirmed' | 'denied' | 'no-answer', note: string, userId: string) {
  const u = user(userId); canAct(u)
  const x = db.exceptions.find(e => e.id === exId) ?? fail('Exception not found')
  const text = { confirmed: 'Vendor confirmed the change on call-back', denied: 'Vendor denied making the request — likely fraud', 'no-answer': 'No answer on call-back' }[outcome]
  x.history.push({ at: nowIso(), text: `${text} (${u.name})${note ? ': ' + note : ''}` })
  x.comments.push({ id: 'cm' + db.seq.comment++, byId: userId, at: nowIso(), text: `Call-back: ${text}.${note ? ' ' + note : ''}` })
  const row = x.evidence?.rows.find(r => r.label === 'Call-back'); if (row) { row.requested = text; row.bad = outcome !== 'confirmed' }
  const c1 = x.checklist?.find(c => c.id === 'c1'); if (c1 && outcome === 'confirmed') c1.done = true
  if (outcome === 'denied') { x.priority = 'Critical'; x.history.push({ at: nowIso(), text: 'Flagged as suspected fraud' }) }
  log(userId, x.entityId, 'Recorded call-back', x.id, text)
  return out(x)
}

export async function rejectBankChange(exId: string, userId: string) {
  const u = user(userId); canAct(u)
  const x = db.exceptions.find(e => e.id === exId) ?? fail('Exception not found')
  resolveEx(x, userId, 'Bank change rejected; vendor master unchanged')
  const v = db.vendors.find(v => v.id === x.blocks?.vendorId)
  if (v) { v.blocked = false; v.status = st('ok', 'On schedule · old bank kept') }
  log(userId, x.entityId, 'Rejected bank change', x.id, 'Vendor master unchanged; payments released to existing account')
  return out(x)
}

export async function escalate(exId: string, userId: string) {
  const u = user(userId); canAct(u)
  const x = db.exceptions.find(e => e.id === exId) ?? fail('Exception not found')
  const cfo = db.users.find(u => u.role === 'cfo')!
  x.history.push({ at: nowIso(), text: `Escalated to ${cfo.name} by ${u.name}` })
  x.ownerId = cfo.id
  notify({ entityId: x.entityId, title: `${x.id} escalated to you`, body: x.title, route: '/exceptions?ex=' + x.id, tone: 'bad' })
  log(userId, x.entityId, 'Escalated', x.id, 'to ' + cfo.name)
  return out(x)
}

/* ================= GST ================= */

export const getGst = (entityId: string, gstin: string) => out({
  summary: db.gstSummaries.find(g => g.entityId === entityId && g.gstin === gstin) ?? null,
  rows: db.imsRows.filter(r => r.entityId === entityId && r.gstin === gstin),
  outward: db.outward.filter(o => o.entityId === entityId && o.gstin === gstin),
  rcmLrs: db.rcmLrs,
  suppliers: db.vendors.filter(v => v.entityId === entityId),
})

export async function setImsFinal(rowIds: string[], action: ImsAction, userId: string) {
  canAct(user(userId))
  db.imsRows.filter(r => rowIds.includes(r.id)).forEach(r => { r.final = action; r.dirty = true })
  return out({ ok: true })
}

export async function applyRecommendations(entityId: string, gstin: string, userId: string) {
  canAct(user(userId))
  const rows = db.imsRows.filter(r => r.entityId === entityId && r.gstin === gstin && r.portal === 'No action' && !r.final)
  rows.forEach(r => { r.final = r.recommended; r.dirty = true })
  return out({ applied: rows.length })
}

export async function saveImsToPortal(entityId: string, gstin: string, userId: string) {
  canAct(user(userId))
  const rows = db.imsRows.filter(r => r.entityId === entityId && r.gstin === gstin && r.dirty)
  if (!rows.length) fail('No unsaved actions.')
  const map = { Accept: 'Accepted', Reject: 'Rejected', 'Keep pending': 'Pending' } as const
  rows.forEach(r => { r.portal = map[r.final!]; r.dirty = false; r.actedBy = userId; r.actedAt = nowIso() })
  const s = db.gstSummaries.find(g => g.entityId === entityId && g.gstin === gstin)
  if (s) s.lastSaved = { at: nowIso(), by: userId }
  // IMS acceptance of the missing-IRN invoice resolves its exception (the IRN is on the portal).
  rows.filter(r => r.final === 'Accept' && r.match.note.includes('EX-')).forEach(r => {
    const id = r.match.note.match(/EX-\d+/)![0]
    const x = db.exceptions.find(e => e.id === id && e.status !== 'resolved'); if (x) resolveEx(x, userId, 'IRN found on GST portal IMS')
  })
  log(userId, entityId, 'Saved IMS actions to portal', 'GSTIN ' + gstin, `${rows.length} action(s)`)
  return out({ saved: rows.length })
}

export async function generateSelfInvoices(entityId: string, userId: string) {
  canAct(user(userId))
  const missing = db.rcmLrs.filter(l => !l.selfInvoice)
  missing.forEach(l => (l.selfInvoice = `SI/RCM/2026-27/${String(db.seq.selfInvoice++).padStart(3, '0')}`))
  const s = db.gstSummaries.find(g => g.entityId === entityId)
  if (s) s.rcm.selfInvoices = db.rcmLrs.length
  log(userId, entityId, 'Generated RCM self-invoices', `${missing.length} invoice(s)`, missing.map(l => l.selfInvoice).join(', '))
  return out({ generated: missing.length })
}

/* ================= payables & payment runs ================= */

export const listRuns = (entityId: string) => out(db.paymentRuns.filter(r => r.entityId === entityId))
export const getRun = (id: string) => out(db.paymentRuns.find(r => r.id === id) ?? fail('Payment run not found'))
export const listAp = (entityId: string) => out(db.apItems.filter(a => a.entityId === entityId))

export async function approveRun(runId: string, note: string, userId: string) {
  const u = user(userId); canAct(u)
  const run = db.paymentRuns.find(r => r.id === runId) ?? fail('Payment run not found')
  if (run.status !== 'awaiting-approval') fail('This run is not waiting for approval.')
  const mine = run.approvers.find(a => a.userId === userId) ?? fail('You are not an approver on this run.')
  if (mine.status === 'approved') fail('You have already approved this run.')
  const before = run.approvers.slice(0, run.approvers.indexOf(mine))
  if (before.some(a => a.status !== 'approved')) fail('Earlier approvers must approve first.')
  mine.status = 'approved'; mine.at = nowIso(); mine.note = note || undefined; mine.via = 'passkey'
  if (run.approvers.every(a => a.status === 'approved')) {
    run.status = 'released'
    run.h2hFile = `H2H-${run.valueDate}-0042`
    notify({ entityId: run.entityId, title: 'Payment run released', body: `${run.id} sent to ${run.bank.split(' ')[0]} · ${inr(run.net)}`, route: '/payables/runs/' + run.id, tone: 'ok' })
  }
  log(userId, run.entityId, 'Approved payment run', run.id, `${inr(run.net)}${note ? ' · ' + note : ''}`)
  return out(run)
}

export async function sendBackRun(runId: string, note: string, userId: string) {
  const u = user(userId); canAct(u)
  const run = db.paymentRuns.find(r => r.id === runId) ?? fail('Payment run not found')
  if (!note.trim()) fail('Say why you are sending it back.')
  const mine = run.approvers.find(a => a.userId === userId) ?? fail('You are not an approver on this run.')
  mine.status = 'sent-back'; mine.at = nowIso(); mine.note = note
  run.status = 'sent-back'
  notify({ entityId: run.entityId, title: 'Payment run sent back', body: `${run.id} by ${u.name}: ${note}`, route: '/payables/runs/' + run.id, tone: 'warn' })
  log(userId, run.entityId, 'Sent back payment run', run.id, note)
  return out(run)
}

export async function undoRunApproval(runId: string, userId: string) {
  // Demo convenience matching the design's "Back to review" on the released state.
  const run = db.paymentRuns.find(r => r.id === runId) ?? fail('Payment run not found')
  const mine = run.approvers.find(a => a.userId === userId)
  if (mine) { mine.status = 'pending'; mine.at = undefined; mine.via = undefined }
  run.status = 'awaiting-approval'; run.h2hFile = undefined
  log(userId, run.entityId, 'Withdrew approval', run.id, 'before bank confirmation')
  return out(run)
}

/* ================= approvals inbox ================= */

export async function listApprovals(entityId: string, userId: string) {
  const u = user(userId)
  const runs = db.paymentRuns.filter(r => r.entityId === entityId && r.status === 'awaiting-approval' && (() => {
    const i = r.approvers.findIndex(a => a.userId === userId)
    return i >= 0 && r.approvers[i].status === 'pending' && r.approvers.slice(0, i).every(a => a.status === 'approved')
  })())
  const invoices = db.invoices.filter(i => i.entityId === entityId && i.decision?.secondApproverNeeded && i.decision.byId !== userId && u.approvalLimit >= i.total)
  const exceptions = db.exceptions.filter(x => x.entityId === entityId && x.status === 'awaiting-approval' && (x.ownerId === userId || u.role === 'cfo' || u.role === 'controller'))
  return out({ runs, invoices, exceptions })
}

/* ================= masters & other modules ================= */

export const listVendors = (entityId: string) => out(db.vendors.filter(v => v.entityId === entityId))
export async function getVendor(id: string) {
  const v = db.vendors.find(v => v.id === id) ?? fail('Vendor not found')
  return out({
    vendor: v,
    pos: db.purchaseOrders.filter(p => p.vendorId === id),
    invoices: db.invoices.filter(i => i.vendorId === id),
    ap: db.apItems.filter(a => a.vendorId === id),
    exceptions: db.exceptions.filter(x => x.docRoute === '/vendors/' + id || x.blocks?.vendorId === id || db.invoices.some(i => i.vendorId === id && i.invoiceNo === x.docRef)),
    msme: db.msmeInvoices.filter(m => m.vendorId === id),
  })
}
export const listCustomers = (entityId: string) => out(db.customers.filter(c => c.entityId === entityId))
export const listAr = (entityId: string) => out(db.arItems.filter(a => a.entityId === entityId))

export async function logFollowUp(arId: string, kind: 'reminder' | 'promise' | 'dispute' | 'escalate', detail: string, userId: string) {
  const u = user(userId); canAct(u)
  const a = db.arItems.find(a => a.id === arId) ?? fail('Receivable not found')
  const label = { reminder: 'Reminder sent', promise: 'Promise ' + detail, dispute: 'Disputed · ' + detail, escalate: 'Escalated to CFO' }[kind]
  a.status = st(kind === 'dispute' || kind === 'escalate' ? 'bad' : 'warn', label)
  a.lastAction = `${label} · ${u.initials} ${todayIso().split('-').reverse().join('-')}`
  const c = db.customers.find(c => c.id === a.customerId); if (c) c.followUp = a.status
  log(userId, a.entityId, 'Receivable follow-up', a.invoiceNo, label)
  return out(a)
}

export const getBank = (entityId: string) => out({ accounts: db.bankAccounts.filter(a => a.entityId === entityId), lines: db.bankLines.filter(l => l.entityId === entityId) })
export async function matchBankLine(lineId: string, accept: boolean, userId: string) {
  canAct(user(userId))
  const l = db.bankLines.find(l => l.id === lineId) ?? fail('Statement line not found')
  l.status = accept ? st('ok', 'Matched · ' + (l.suggestion ?? 'manual')) : st('none', 'Unmatched')
  if (!accept) l.suggestion = undefined
  const a = db.bankAccounts.find(a => a.id === l.accountId); if (a && accept) a.unreconciled = Math.max(0, a.unreconciled - 1)
  log(userId, l.entityId, accept ? 'Matched bank line' : 'Rejected match suggestion', l.ref, l.narration)
  return out(l)
}

export const listTds = (entityId: string) => out(db.tdsLines.filter(t => t.entityId === entityId))
export async function generateChallan(entityId: string, userId: string) {
  canAct(user(userId))
  const lines = db.tdsLines.filter(t => t.entityId === entityId && t.challan.tone !== 'ok')
  const total = lines.reduce((s, t) => s + t.tds, 0)
  lines.forEach(t => (t.challan = st('acc', 'Challan 281 drafted')))
  log(userId, entityId, 'Drafted TDS challan 281', `${lines.length} deduction(s)`, inr(total))
  return out({ lines: lines.length, total })
}

export const listMsme = (entityId: string) => out(db.msmeInvoices.filter(m => m.entityId === entityId))
export async function scheduleMsmePayment(id: string, date: string, userId: string) {
  canAct(user(userId))
  const m = db.msmeInvoices.find(m => m.id === id) ?? fail('Invoice not found')
  const late = daysBetween(m.limitOn, date) > 0
  m.status = st(late ? 'warn' : 'ok', `Manual payment ${date.split('-').reverse().join('-')}${late ? ' · after limit' : ''}`)
  log(userId, m.entityId, 'Scheduled MSME payment', m.invoiceNo, date)
  return out(m)
}

export const listClose = (entityId: string) => out(db.closeTasks.filter(t => t.entityId === entityId))
export async function toggleCloseTask(id: string, userId: string) {
  canAct(user(userId))
  const t = db.closeTasks.find(t => t.id === id) ?? fail('Task not found')
  t.done = !t.done; t.doneAt = t.done ? nowIso() : undefined
  log(userId, t.entityId, t.done ? 'Completed close task' : 'Reopened close task', t.task)
  return out(t)
}

export const listReports = () => out(db.reports)
export async function runReport(id: string, entityId: string, userId: string) {
  const r = db.reports.find(r => r.id === id) ?? fail('Report not found')
  r.lastRun = nowIso()
  log(userId, entityId, 'Generated report', r.name, r.format)
  return out(r)
}

export async function retryIrn(outwardId: string, userId: string) {
  canAct(user(userId))
  const o = db.outward.find(o => o.id === outwardId) ?? fail('Document not found')
  o.irn = st('ok', 'IRN generated')
  o.ewb = st('ok', 'EWB ' + (3410220013 + Math.floor(Math.random() * 900)).toString().replace(/(\d{4})(\d{4})(\d+)/, '$1 $2 $3'))
  o.gstr1 = st('ok', 'Ready')
  log(userId, o.entityId, 'Regenerated IRN', o.docNo, 'IRP accepted after correction')
  return out(o)
}
