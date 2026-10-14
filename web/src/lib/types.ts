// Domain types shared by the mock API and (later) the real backend client.
// Dates are ISO strings in IST wall-clock: '2026-10-13' or '2026-10-13T10:40'.

export type Tone = 'ok' | 'warn' | 'bad' | 'none' | 'acc'
export type Status = { tone: Tone; label: string }
export type AvatarColor = 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | ''
export type SourceName =
  | 'SAP' | 'GST portal' | 'Bank' | 'Extracted' | 'Email' | 'WhatsApp' | 'Upload'
  | 'Udyam' | 'MCA' | 'TRACES' | 'Post' | 'IRP'

export type RoleKey = 'ap' | 'controller' | 'cfo' | 'gst' | 'stores' | 'procurement' | 'purchase-head' | 'partner' | 'auditor'

export interface User {
  id: string
  initials: string
  name: string
  role: RoleKey
  title: string
  /** Max invoice or run value this person can approve alone; 0 = cannot approve. */
  approvalLimit: number
  color: AvatarColor
  entityIds: string[] | 'all'
}

export interface Gstin { gstin: string; code: string; state: string; placeOfBusiness?: string; filingFrequency?: 'monthly' | 'qrmp'; einvoiceApplicable?: boolean }

export type MailProvider = 'gmail' | 'outlook'
/** A connected invoice mailbox (server). */
export interface Mailbox {
  id: number
  entityId: string
  provider: MailProvider
  address: string
  status: 'active' | 'paused' | 'error' | 'disconnected'
  lastSyncAt: string | null
  lastError: string | null
  backfillDays: number
  senderAllow: string[]
  senderBlock: string[]
  connectedBy: string | null
  documents: number
}

export type AiProvider = 'anthropic' | 'openai' | 'gemini'
export interface AiSettings {
  activeProvider: AiProvider
  autoExtract: boolean
  models: Partial<Record<AiProvider, string>>
  keys: Record<AiProvider, { set: boolean; setOn: string | null; fromEnv: boolean }>
}

export interface Entity {
  id: string
  name: string
  shortName: string
  city: string
  pan: string
  gstins: Gstin[]
  sapCompanyCode: string
  risk: 'High' | 'Medium' | 'Low'
  riskScore: number
  intakeEmail: string
  whatsapp: string
  /** Fields below come from the server; seeded demo entities may lack them when the server is offline. */
  status?: 'onboarding' | 'active'
  tan?: string | null
  cin?: string | null
  fyStartMonth?: number
  einvoiceBand?: 'above-5cr' | 'below-5cr' | 'exempt'
  msmeStatus?: 'none' | 'micro' | 'small' | 'medium'
  mailboxes?: Mailbox[]
}

export interface Firm { name: string; short: string; entityIds: string[] }

export type MsmeClass = 'Micro' | 'Small' | 'Medium'

export interface BankDetails { bank: string; branch?: string; ifsc: string; account: string; nameAtBank: string }

export interface Vendor {
  id: string // SAP vendor number
  entityId: string
  name: string
  shortName: string
  gstin: string
  pan: string
  gstinStatus: 'Active' | 'Cancelled' | 'Suspended'
  msme?: MsmeClass
  udyam?: string
  udyamVerifiedOn?: string
  tags: string[]
  bank: BankDetails
  email: string
  phone: string
  paymentTermsDays: number
  tdsSection?: string
  filing: { onTime: number; of: number }
  outstanding: number
  overdue: number
  nextDue?: string
  status: Status
  ytdPurchases: number
  blocked?: boolean
}

export interface Customer {
  id: string
  entityId: string
  name: string
  outstanding: number
  overdue: number
  daysOverdue: number
  followUp: Status
  gstin: string
  creditDays: number
  contact: string
}

export type SyncKey = 'sap' | 'gst' | 'bank'
export interface SyncState {
  key: SyncKey
  label: string
  system: string
  at: string
  /** Hours after which the source is shown as stale. */
  staleAfterH: number
  error?: string
}

/* ---------------- overview ---------------- */

export interface Kpi {
  id: string
  label: string
  value: number
  unit?: 'inr' | 'days' | 'count'
  sub: string
  source: SourceName
  syncKey: SyncKey
  tone?: Tone
  status?: string
  exact?: string
  link?: string
}

export interface Deadline {
  id: string
  entityId: string
  name: string
  what: string
  due: string
  windowDays: number
  status: Status
  link?: string
}

export interface CashWeek { week: string; inflow: number; outflow: number }

export interface OverviewSnapshot {
  entityId: string
  asOf: string
  kpiPay: Kpi[]
  kpiRec: Kpi[]
  critical: { open: number; pastSla: number; blocked: number; breakdown: { label: string; n: number; type: string }[] }
  cash: { opening: number; minimum: number; weeks: CashWeek[] }
  apAgeing: { bucket: string; msme: number; others: number }[]
  apNote: string
  arAgeing: { bucket: string; amount: number }[]
  arNote: string
}

export interface FilingCell { entityId: string; cells: Status[] }

/* ---------------- intake ---------------- */

export type Channel = 'Email' | 'WhatsApp' | 'Post' | 'Upload' | 'SAP'
export type IntakeStatus = 'new' | 'review' | 'linked' | 'duplicate' | 'notfinance' | 'rejected'

export interface ExtractedField {
  key: string
  label: string
  value: string
  confidence: number
  mono?: boolean
  num?: boolean
  check?: Status
  confirmedBy?: string
  edited?: boolean
}

export interface DocLine { desc: string; hsn: string; qty: number; unit: string; rate: number; amount: number; confidence: number }

/** Data for the paper rendering of a document in the viewer. */
export interface PaperDoc {
  kind: 'TAX INVOICE' | 'CREDIT NOTE' | 'DEBIT NOTE' | 'DELIVERY CHALLAN' | 'LORRY RECEIPT' | 'E-WAY BILL' | 'LETTER' | 'QUOTATION' | 'PURCHASE ORDER' | 'GOODS RECEIPT'
  supplier: string
  address: string
  supplierGstin?: string
  udyam?: string
  number: string
  date: string
  refs?: string
  irn?: string
  billTo: string
  billToAddress: string
  billToGstin?: string
  pos?: string
  lines: DocLine[]
  taxable: number
  cgst: number
  sgst: number
  igst: number
  total: number
  bank?: string
  terms?: string
  body?: string
  /** field key → confidence, drawn as highlight boxes */
  boxes: Record<string, number>
}

export interface IntakeDoc {
  id: string
  entityId: string
  channel: Channel
  receivedAt: string
  from: string
  type: string
  vendorId?: string
  vendorName: string
  docNo: string
  amount?: number
  confidence?: number
  status: IntakeStatus
  statusNote?: string
  duplicateOf?: string
  pages: number
  sizeKb: number
  fields: ExtractedField[]
  lines: DocLine[]
  paper?: PaperDoc
  suggestedLink?: { poId: string; grnId?: string; match: number; diffs: number; note: string }
  linkedPoId?: string
  invoiceId?: string
  confirmedBy?: string
  /** Set on documents ingested by the server (real email); ids start with 'em-'. */
  server?: boolean
  fileUrl?: string
  mime?: string
  filename?: string
  subject?: string
}

/* ---------------- purchase-to-pay ---------------- */

export type StageState = 'done' | 'cur' | 'blk' | 'ns'
export interface Stage {
  key: string
  name: string
  state: StageState
  date: string
  ownerId?: string
  owner: string
  ref: string
  docs: string[]
  sla: Status
}

export interface EvidenceDoc {
  id: string
  title: string
  number: string
  date: string
  source: SourceName
  linkedBy: string
  check: Status
  paper?: PaperDoc
}

export interface PoLine {
  line: string
  material: string
  materialNo: string
  hsn: string
  uom: string
  rate: number
  ordered: number
  received: number
  accepted: number
  invoiced: number
  posted: number
  paid: number
}

export interface NegotiationVersion {
  version: number
  date: string
  rate: number
  freight: string
  terms: string
  note?: string
}

export interface PurchaseOrder {
  id: string
  entityId: string
  vendorId: string
  value: number
  taxable: number
  buyerId: string
  plant: string
  createdOn: string
  stages: Stage[]
  lines: PoLine[]
  invoicedTaxable: number
  invoiceNote?: string
  freightInvoiced?: number
  agreedDue?: string
  docs: EvidenceDoc[]
  negotiation: {
    locked: boolean
    current: NegotiationVersion
    history: NegotiationVersion[]
    delivery: string
    validTill: string
    gst: string
    approvedBy: string
    approvedAt: string
    approvedVia: string
    quoteRef: string
  }
  sap: { gateEntry?: string; grn?: string; invoiceDoc?: string; utr?: string }
  msme?: { acceptedOn: string; limitOn: string; invoiceAsks?: string }
  invoiceId?: string
  elapsedDays: number
  health: string
}

/* ---------------- invoice review ---------------- */

export type CellState = 'ok' | 'warn' | 'bad' | 'none' | 'na'
export interface MatchCell { s: CellState; v?: string; d?: string; num?: boolean }
export interface MatchRow { field: string; cells: MatchCell[] }
export interface MatchHead { title: string; ref: string; source: SourceName; when: string }

export interface Flag {
  id: string
  title: string
  detail: string
  usual: string
  amount: number
  reason: string
  exceptionId?: string
}

export type DecisionKind = 'approve' | 'note' | 'hold' | 'reject' | 'dn'
export type InvoiceStatus = 'needs-decision' | 'approved' | 'held' | 'rejected' | 'dn-raised' | 'posted'

export interface Decision {
  kind: DecisionKind
  reasons: string[]
  note: string
  byId: string
  at: string
  secondApproverNeeded: boolean
  debitNote?: { no: string; taxable: number; gst: number; total: number }
}

export interface Invoice {
  id: string
  entityId: string
  vendorId: string
  invoiceNo: string
  date: string
  receivedAt: string
  channel: Channel
  taxable: number
  cgst: number
  sgst: number
  igst: number
  total: number
  poId?: string
  grnId?: string
  intakeId?: string
  status: InvoiceStatus
  flags: Flag[]
  heads: MatchHead[]
  rows: MatchRow[]
  dnLines: { text: string; taxable: number; gst: number }[]
  tds: { nature: string; section: string; legacy: string; threshold: string; crossed: string; rate: string; base: number; amount: number; note: string }
  itc: { status: Status; onInvoice: number; afterDn: number; ims: string; imsNote: string; expected: string; pay180: string; s164: string; filing: string }
  msme?: { daysLeft: number; acceptedOn: string; payBy: string; recommended: string; note: string }
  draft?: { kind: DecisionKind; reasons: string[]; note: string }
  decision?: Decision
  docTitle: string
}

/* ---------------- exceptions ---------------- */

export type ExceptionStatus = 'open' | 'in-progress' | 'waiting-vendor' | 'awaiting-approval' | 'resolved'
export type Priority = 'Critical' | 'High' | 'Medium' | 'Low'

export interface Comment { id: string; byId: string; at: string; text: string }
export interface HistoryItem { at: string; text: string }

export interface ExceptionItem {
  id: string
  entityId: string
  type: string
  title: string
  docRef: string
  docRoute?: string
  ownerId: string
  status: ExceptionStatus
  statusNote?: string
  priority: Priority
  due: string
  createdAt: string
  amount: number
  snoozedUntil?: string
  resolvedAt?: string
  resolution?: string
  blocks?: { vendorId: string; amount: number; runId: string }
  evidence?: { head: [string, string]; rows: { label: string; current: string; requested: string; bad: boolean; sub?: string; mono?: boolean }[] }
  evidenceNote?: string
  sources?: { source: SourceName; text: string }[]
  checklist?: { id: string; label: string; done: boolean }[]
  comments: Comment[]
  history: HistoryItem[]
}

export interface ExceptionRule { id: string; name: string; type: string; description: string; enabled: boolean; priority: Priority; slaDays: number }

/* ---------------- GST ---------------- */

export type ImsAction = 'Accept' | 'Reject' | 'Keep pending'
export interface ImsRow {
  id: string
  entityId: string
  gstin: string
  supplier: string
  supplierGstin: string
  docType: 'Invoice' | 'Credit note' | 'Debit note'
  docNo: string
  date: string
  taxable: number
  itc: number
  portal: 'No action' | 'Accepted' | 'Rejected' | 'Pending'
  match: { tone: Tone; label: string; note: string }
  recommended: ImsAction
  final?: ImsAction
  dirty?: boolean
  actedBy?: string
  actedAt?: string
}

export interface GstSummary {
  entityId: string
  gstin: string
  period: string
  imsSyncedAt: string
  twoBDate: string
  threeBDue: string
  tiles: { key: string; label: string; n: number; itc: number; sub: string; tone: Tone; status: string; sources: SourceName[] }[]
  itc180: { supplier: string; ref: string; date: string; days: number; itc: number }[]
  s164: { fy: string; daysLeft: number; invoices: number; itc: number; lastDate: string }
  blocked: { label: string; amount: number }[]
  blockedNote: string
  rcm: { vendorId: string; vendor: string; gstin: string; service: string; lrs: number; freight: number; rate: number; selfInvoices: number }
  lastSaved?: { at: string; by: string }
}

export interface OutwardDoc { id: string; entityId: string; gstin: string; customer: string; customerGstin: string; docNo: string; date: string; taxable: number; tax: number; irn: Status; ewb: Status; gstr1: Status }

/* ---------------- payables & payments ---------------- */

export type RunStatus = 'draft' | 'awaiting-approval' | 'released' | 'sent-back'
export interface Approval { userId: string; status: 'approved' | 'pending' | 'sent-back'; at?: string; note?: string; via?: string }

export interface PaymentRun {
  id: string
  entityId: string
  status: RunStatus
  valueDate: string
  account: string
  bank: string
  gross: number
  tds: number
  net: number
  held: number
  heldNote: string
  invoices: number
  vendors: number
  sapProposal: string
  approvers: Approval[]
  checks: { label: string; sub: string; tone: Tone; source?: { name: SourceName; syncKey: SyncKey } }[]
  payees: { vendorId: string; name: string; tag?: string; sub: string; amount: number }[]
  rest: { count: number; amount: number }
  h2hFile?: string
}

export interface ApItem {
  id: string
  entityId: string
  vendorId: string
  invoiceNo: string
  date: string
  due: string
  amount: number
  tds: number
  status: Status
  runId?: string
  msme?: MsmeClass
}

/* ---------------- other modules ---------------- */

export interface ArItem { id: string; entityId: string; customerId: string; invoiceNo: string; date: string; due: string; amount: number; received: number; status: Status; lastAction?: string }
export interface BankAccount { id: string; entityId: string; bank: string; account: string; type: string; balance: number; asOf: string; unreconciled: number }
export interface BankLine { id: string; entityId: string; accountId: string; date: string; narration: string; ref: string; amount: number; suggestion?: string; confidence?: number; status: Status }
export interface TdsLine { id: string; entityId: string; section: string; legacy: string; nature: string; deductee: string; pan: string; base: number; rate: number; tds: number; date: string; challan: Status }
export interface MsmeInvoice { id: string; entityId: string; vendorId: string; invoiceNo: string; amount: number; acceptedOn: string; limitOn: string; status: Status; paidOn?: string }
export interface CloseTask { id: string; entityId: string; area: string; task: string; ownerId: string; due: string; done: boolean; doneAt?: string; note?: string }
export interface ReportDef { id: string; name: string; group: string; description: string; lastRun?: string; format: string }

export interface AuditEntry { id: string; at: string; userId: string; entityId: string; action: string; target: string; detail: string }

export interface Notification { id: string; entityId: string; at: string; title: string; body: string; route: string; read: boolean; tone: Tone }

export interface SearchHit { kind: string; label: string; sub: string; route: string }
