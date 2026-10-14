// Every call the screens make. One module, one server.
import type {
  AuditEntry, DecisionKind, Entity, ExceptionItem, ExceptionRule, ExceptionStatus, ImportKind, ImportRun, IntakeDoc, Integrations, Invoice, MailProvider, Mailbox, Me,
  Notification, Priority, PurchaseOrder, SapConnection, SearchHit, SyncState, User, Vendor,
} from '@/lib/types'
import { ApiError, http, q } from './http'

export { ApiError }

/* ---------------- auth ---------------- */
export const authStatus = () => http<{ needsSetup: boolean; smtp: boolean; claude: boolean }>('/auth/status')
export const setup = (body: { firm_name: string; firm_short: string; frn?: string; name: string; email: string; password: string }) => http<{ next: string }>('/auth/setup', { method: 'POST', json: body })
export const login = (email: string, password: string) => http<{ next: 'mfa_verify' | 'mfa_enrol' }>('/auth/login', { method: 'POST', json: { email, password } })
export const logout = () => http<{ ok: boolean }>('/auth/logout', { method: 'POST' })
export const me = () => http<Me>('/auth/me')
export const mfaEnrol = () => http<{ secret: string; otpauth: string }>('/auth/mfa/enrol', { method: 'POST' })
export const mfaConfirm = (code: string) => http<Me>('/auth/mfa/confirm', { method: 'POST', json: { code } })
export const mfaVerify = (code: string) => http<Me>('/auth/mfa/verify', { method: 'POST', json: { code } })
export const forgotPassword = (email: string) => http<{ ok: boolean }>('/auth/password/forgot', { method: 'POST', json: { email } })
export const resetPassword = (token: string, password: string) => http<{ ok: boolean }>('/auth/password/reset', { method: 'POST', json: { token, password } })
export const changePassword = (current: string, password: string) => http<{ ok: boolean }>('/auth/password', { method: 'POST', json: { current, password } })
export const inviteInfo = (token: string) => http<{ email: string; name: string; firm: string }>(`/auth/invite/${token}`)
export const acceptInvite = (token: string, name: string, password: string) => http<{ next: string }>('/auth/invite/accept', { method: 'POST', json: { token, name, password } })

/* ---------------- users ---------------- */
export interface Assignment { entity_id: string; role: string; approval_limit: number }
export const listUsers = (entity?: string) => http<User[]>('/users' + (entity ? q({ entity }) : ''))
export const inviteUser = (body: { email: string; name: string; title?: string; is_admin?: boolean; assignments: Assignment[] }) => http<{ user: User; link: string | null }>('/users/invite', { method: 'POST', json: body })
export const updateUser = (id: string, body: { name?: string; title?: string; is_admin?: boolean; status?: 'active' | 'disabled'; assignments?: Assignment[] }) => http<User>(`/users/${id}`, { method: 'PATCH', json: body })
export const reinviteUser = (id: string) => http<{ link: string | null }>(`/users/${id}/reinvite`, { method: 'POST' })
export const resetUserMfa = (id: string) => http<{ ok: boolean }>(`/users/${id}/reset-mfa`, { method: 'POST' })

/* ---------------- clients ---------------- */
export interface GstInput { gstin: string; place_of_business?: string; filing_frequency?: 'monthly' | 'qrmp'; einvoice_applicable?: boolean }
export interface EntityInput {
  legal_name: string; short_name: string; city?: string; pan: string; tan?: string | null; cin?: string | null
  fy_start_month?: number; einvoice_band?: Entity['einvoiceBand']; msme_status?: Entity['msmeStatus']; sap_company_code?: string; whatsapp?: string
  gstins?: GstInput[]
}
export const listEntities = () => http<Entity[]>('/entities')
export const getEntity = (id: string) => http<Entity>(`/entities/${id}`)
export const createEntity = (body: EntityInput) => http<Entity>('/entities', { method: 'POST', json: body })
export const updateEntity = (id: string, body: Partial<EntityInput>) => http<Entity>(`/entities/${id}`, { method: 'PATCH', json: body })
export const activateEntity = (id: string) => http<Entity>(`/entities/${id}/activate`, { method: 'POST' })
export const validateGstin = (gstin: string, pan?: string) => http<{ ok: boolean; errors: string[]; warnings: string[]; state?: string }>('/validate/gstin', { method: 'POST', json: { gstin, pan } })

/* ---------------- mailboxes ---------------- */
export const listAllMailboxes = () => http<Mailbox[]>('/mailboxes')
export const listMailboxes = (entityId: string) => http<Mailbox[]>(`/entities/${entityId}/mailboxes`)
export const mailboxRecent = (id: number) => http<IntakeDoc[]>(`/mailboxes/${id}/recent`)
export const updateMailbox = (id: number, body: { status?: 'active' | 'paused'; backfill_days?: number; sender_allow?: string[]; sender_block?: string[] }) => http<Mailbox>(`/mailboxes/${id}`, { method: 'PATCH', json: body })
export const syncMailbox = (id: number) => http<{ new: number; mailbox: Mailbox }>(`/mailboxes/${id}/sync`, { method: 'POST' })
export const disconnectMailbox = (id: number) => http<{ ok: boolean }>(`/mailboxes/${id}/disconnect`, { method: 'POST' })
/** Full-page navigation to the provider's consent screen; it returns to `ret` with ?mailbox=connected or ?mailbox_error=… */
export function connectMailbox(provider: MailProvider, entityId: string, ret: string, backfill: number) {
  window.location.assign(`/api/oauth/${provider === 'gmail' ? 'google' : 'microsoft'}/start${q({ entity: entityId, ret, backfill })}`)
}

/* ---------------- intake ---------------- */
export const listIntake = (entity: string) => http<IntakeDoc[]>('/intake' + q({ entity }))
export function uploadDocs(entity: string, files: File[]) {
  const form = new FormData()
  files.forEach(f => form.append('files', f, f.name))
  return http<{ documents: IntakeDoc[]; skipped: string[] }>('/intake/upload' + q({ entity }), { method: 'POST', form })
}
export const fileUrl = (d: { fileUrl?: string; id: string }, download = false) => (d.fileUrl ?? `/api/files/${d.id}`) + (download ? '?download=true' : '')
export const editField = (docId: string, key: string, value: string) => http<IntakeDoc>(`/intake/${docId}/fields`, { method: 'PATCH', json: { key, value } })
export const confirmFields = (docId: string) => http<IntakeDoc>(`/intake/${docId}/confirm`, { method: 'POST' })
export const setIntakeStatus = (docId: string, status: 'notfinance' | 'rejected' | 'new', note?: string) => http<IntakeDoc>(`/intake/${docId}/status`, { method: 'POST', json: { status, note } })
export const reExtract = (docId: string) => http<IntakeDoc>(`/intake/${docId}/extract`, { method: 'POST' })
export const linkToPo = (docId: string, poId: string) => http<IntakeDoc>(`/intake/${docId}/link`, { method: 'POST', json: { po_id: poId } })
export const markDuplicate = (docId: string, ofId?: string) => http<IntakeDoc>(`/intake/${docId}/duplicate`, { method: 'POST', json: { of_id: ofId } })
export const askVendor = (entity: string, to: string, subject: string, body: string) => http<{ ok: boolean; sent: boolean }>('/intake/ask-vendor' + q({ entity }), { method: 'POST', json: { to, subject, body } })

/* ---------------- purchase-to-pay ---------------- */
export const listPOs = (entity: string, p: { q?: string; plant?: string; vendor?: string; with_docs?: boolean; limit?: number } = {}) => http<{ items: PurchaseOrder[]; total: number; plants: string[] }>('/pos' + q({ entity, ...p }))
export const getPO = (id: string) => http<PurchaseOrder>(`/pos/${id}`)
export function addPoDocuments(poId: string, files: File[]) {
  const form = new FormData()
  files.forEach(f => form.append('files', f, f.name))
  return http<{ documents: string[] }>(`/pos/${poId}/documents`, { method: 'POST', form })
}

/* ---------------- invoice review ---------------- */
export const listInvoices = (entity: string) => http<Invoice[]>('/invoices' + q({ entity }))
export const getInvoice = (id: string) => http<Invoice>(`/invoices/${id}`)
export const saveDraft = (id: string, draft: { kind: DecisionKind; reasons: string[]; note: string }) => http<Invoice>(`/invoices/${id}/draft`, { method: 'PUT', json: draft })
export const submitDecision = (id: string, kind: DecisionKind, reasons: string[], note: string) => http<Invoice>(`/invoices/${id}/decision`, { method: 'POST', json: { kind, reasons, note } })
export const confirmSecondApproval = (id: string) => http<Invoice>(`/invoices/${id}/second-approval`, { method: 'POST' })

/* ---------------- exceptions ---------------- */
export const listExceptions = (entity: string) => http<ExceptionItem[]>('/exceptions' + q({ entity }))
export const listRules = () => http<ExceptionRule[]>('/exception-rules')
export const updateRule = (id: string, patch: { enabled?: boolean; priority?: Priority; sla_days?: number; default_role?: string }) => http<ExceptionRule>(`/exception-rules/${id}`, { method: 'PATCH', json: patch })
export const toggleRule = (r: ExceptionRule) => updateRule(r.id, { enabled: !r.enabled })
export const updateExceptions = (ids: string[], patch: { ownerId?: string; priority?: Priority; due?: string; status?: ExceptionStatus; snoozeDays?: number; resolution?: string }) =>
  http<ExceptionItem[]>('/exceptions/update', { method: 'POST', json: { ids, ...patch } })
export const addComment = (exId: string, text: string) => http<ExceptionItem>(`/exceptions/${exId}/comments`, { method: 'POST', json: { text } })
export const toggleChecklist = (exId: string, itemId: string) => http<ExceptionItem>(`/exceptions/${exId}/checklist/${itemId}`, { method: 'POST' })
export const recordCallback = (exId: string, outcome: 'confirmed' | 'denied' | 'no-answer', note: string) => http<ExceptionItem>(`/exceptions/${exId}/callback`, { method: 'POST', json: { outcome, note } })
export const rejectBankChange = (exId: string) => http<ExceptionItem>(`/exceptions/${exId}/reject-change`, { method: 'POST' })
export const escalate = (exId: string) => http<ExceptionItem>(`/exceptions/${exId}/escalate`, { method: 'POST' })

/* ---------------- approvals, masters ---------------- */
export const listApprovals = (entity: string) => http<{ runs: never[]; invoices: Invoice[]; exceptions: ExceptionItem[] }>('/approvals' + q({ entity }))
export const listVendors = (entity: string) => http<Vendor[]>('/vendors' + q({ entity }))
export const getVendor = (id: string) => http<{ vendor: Vendor; pos: PurchaseOrder[]; invoices: Invoice[]; ap: ApItem[]; exceptions: ExceptionItem[]; msme: MsmeInvoice[] }>(`/vendors/${id}`)
export const updateVendor = (id: string, patch: { msme_class?: string | null; udyam?: string; payment_terms_days?: number; email?: string; phone?: string; tds_section?: string; blocked?: boolean }) => http<Vendor>(`/vendors/${id}`, { method: 'PATCH', json: patch })
export const listCustomers = (entity: string) => http<Customer[]>('/customers' + q({ entity }))
export const listAr = (entity: string) => http<{ items: ArItem[]; total: number }>('/ar' + q({ entity }))
export const logFollowUp = (arId: string, kind: 'reminder' | 'promise' | 'dispute' | 'escalate', detail: string) => http<ArItem>(`/ar/${arId}/follow-up`, { method: 'POST', json: { kind, detail } })

/* ---------------- notifications, audit ---------------- */
export const listNotifications = (entity: string) => http<Notification[]>('/notifications' + q({ entity }))
export const markNotificationsRead = (entity: string, id?: string) => http<{ ok: boolean }>('/notifications/read' + q({ entity, id }), { method: 'POST' })
export const listAudit = (entity: string) => http<AuditEntry[]>('/audit' + q({ entity }))

/* ---------------- overview ---------------- */
export const getOverview = (entity: string) => http<Overview>('/overview' + q({ entity }))
export const getFirmOverview = () => http<FirmOverview>('/overview/firm')
export const getCounts = (entity: string) => http<Record<string, number>>('/counts' + q({ entity }))
export const search = (entity: string, text: string) => http<SearchHit[]>('/search' + q({ entity, q: text }))
export const getSources = (entity: string) => http<SyncState[]>('/sources' + q({ entity }))

/* ---------------- modules ---------------- */
export const getGst = (entity: string, gstin: string) => http<GstView>('/gst' + q({ entity, gstin }))
// Actions that need an integration not built yet (GSP, bank, TDS). They fail with a clear message; the screens show empty states.
const notConnected = <T = never,>(what: string) => async (..._args: unknown[]): Promise<T> => { throw new ApiError(`${what} is not connected yet. Set it up in Settings → Integrations.`, 409) }
export const setImsFinal = notConnected('The GST portal')
export const applyRecommendations = notConnected<{ applied: number }>('The GST portal')
export const saveImsToPortal = notConnected<{ saved: number }>('The GST portal')
export const generateSelfInvoices = notConnected<{ generated: number }>('The GST portal')
export const retryIrn = notConnected('The e-invoice portal')
export const listAp = (entity: string) => http<ApItem[]>('/ap' + q({ entity }))
export const listRuns = (entity: string) => http<PaymentRun[]>('/runs' + q({ entity }))
export const getRun = (id: string) => http<PaymentRun>(`/runs/${id}`)
export const approveRun = notConnected<PaymentRun>('The bank')
export const sendBackRun = notConnected<PaymentRun>('The bank')
export const undoRunApproval = notConnected<PaymentRun>('The bank')
export const getBank = (entity: string) => http<{ accounts: BankAccount[]; lines: BankLine[]; notConnected?: string }>('/bank' + q({ entity }))
export const matchBankLine = notConnected('The bank')
export const listTds = (entity: string) => http<TdsLine[]>('/tds' + q({ entity }))
export const generateChallan = notConnected('TDS')
export const listMsme = (entity: string) => http<MsmeInvoice[]>('/msme' + q({ entity }))
export const scheduleMsmePayment = notConnected('The bank')
export const listClose = (entity: string, period?: string) => http<CloseTask[]>('/close' + q({ entity, period }))
export const toggleCloseTask = (id: string) => http<{ id: string; done: boolean }>(`/close/${id}/toggle`, { method: 'POST' })
export const listReports = () => http<ReportDef[]>('/reports')
export const reportUrl = (id: string, entity: string) => `/api/reports/${id}${q({ entity })}`

/* ---------------- imports ---------------- */
export const listImportKinds = () => http<ImportKind[]>('/import-kinds')
export const listImports = (entity: string) => http<ImportRun[]>('/imports' + q({ entity }))
export const getImport = (id: number) => http<ImportRun>(`/imports/${id}`)
export function uploadImport(entity: string, file: File) {
  const form = new FormData()
  form.append('file', file, file.name)
  return http<ImportRun>('/imports/upload' + q({ entity }), { method: 'POST', form })
}
export interface MappingBody { kind: string; sheet?: string | null; mapping: Record<string, number>; remember?: boolean }
export const previewImport = (id: number, body: MappingBody) => http<{ rows: Record<string, unknown>[]; errors: { row: number; message: string }[]; missing: string[]; import?: ImportRun }>(`/imports/${id}/preview`, { method: 'POST', json: body })
export const runImport = (id: number, body: MappingBody) => http<ImportRun>(`/imports/${id}/run`, { method: 'POST', json: body })
export const rerunImport = (id: number) => http<ImportRun>(`/imports/${id}/rerun`, { method: 'POST' })

/* ---------------- SAP, integrations ---------------- */
export const getSap = (entity: string) => http<SapConnection>(`/entities/${entity}/sap`)
export const saveSap = (entity: string, body: Partial<{ edition: string; host: string; client: string; company_code: string; plant_mapping: Record<string, string>; username: string; password: string | null; objects: string[]; schedule_minutes: number; status: 'draft' | 'active' | 'paused' }>) =>
  http<SapConnection>(`/entities/${entity}/sap`, { method: 'PUT', json: body })
export const testSap = (entity: string) => http<{ ok: boolean; message: string }>(`/entities/${entity}/sap/test`, { method: 'POST' })
export const syncSap = (entity: string) => http<{ queued: boolean }>(`/entities/${entity}/sap/sync`, { method: 'POST' })
export const getIntegrations = () => http<Integrations>('/integrations')

// shapes only this module names
import type { ApItem, ArItem, BankAccount, BankLine, CloseTask, Customer, FirmOverview, GstView, MsmeInvoice, Overview, PaymentRun, ReportDef, TdsLine } from '@/lib/types'
