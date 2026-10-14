// Real endpoints (FastAPI). Re-exported from '@/mock/api' so screens keep one import.
import type { AiProvider, AiSettings, AuditEntry, Entity, IntakeDoc, MailProvider, Mailbox } from '@/lib/types'
import { apiUser, http } from './http'

export interface GstInput { gstin: string; place_of_business?: string; filing_frequency?: 'monthly' | 'qrmp'; einvoice_applicable?: boolean }
export interface EntityInput {
  legal_name: string; short_name: string; city?: string; pan: string; tan?: string | null; cin?: string | null
  fy_start_month?: number; einvoice_band?: Entity['einvoiceBand']; msme_status?: Entity['msmeStatus']; sap_company_code?: string; whatsapp?: string
  gstins?: GstInput[]
}

export const serverHealth = () => http<{ ok: boolean; gmail: boolean; outlook: boolean }>('/health')

/* clients */
export const listServerEntities = () => http<Entity[]>('/entities')
export const getServerEntity = (id: string) => http<Entity>(`/entities/${id}`)
export const createEntity = (body: EntityInput) => http<Entity>('/entities', { method: 'POST', json: body })
export const updateEntity = (id: string, body: Partial<EntityInput>) => http<Entity>(`/entities/${id}`, { method: 'PATCH', json: body })
export const activateEntity = (id: string) => http<Entity>(`/entities/${id}/activate`, { method: 'POST' })

/* mailboxes */
export const listMailboxes = (entityId: string) => http<Mailbox[]>(`/entities/${entityId}/mailboxes`)
export const mailboxRecent = (id: number) => http<IntakeDoc[]>(`/mailboxes/${id}/recent`)
export const updateMailbox = (id: number, body: { status?: 'active' | 'paused'; backfill_days?: number; sender_allow?: string[]; sender_block?: string[] }) =>
  http<Mailbox>(`/mailboxes/${id}`, { method: 'PATCH', json: body })
export const syncMailbox = (id: number) => http<{ new: number; mailbox: Mailbox }>(`/mailboxes/${id}/sync`, { method: 'POST' })
export const disconnectMailbox = (id: number) => http<{ ok: boolean }>(`/mailboxes/${id}/disconnect`, { method: 'POST' })
/** Full-page navigation to the provider's consent screen; it returns to `ret` with ?mailbox=connected or ?mailbox_error=… */
export function connectMailbox(provider: MailProvider, entityId: string, ret: string, backfill: number) {
  const p = new URLSearchParams({ entity: entityId, user: apiUser(), ret, backfill: String(backfill) })
  window.location.assign(`/api/oauth/${provider === 'gmail' ? 'google' : 'microsoft'}/start?${p}`)
}

/* intake (server documents have ids starting with 'em-') */
export const isServerDoc = (id: string) => id.startsWith('em-')
export const listServerIntake = (entityId: string) => http<IntakeDoc[]>(`/intake?entity=${encodeURIComponent(entityId)}`)
export const serverEditField = (id: string, key: string, value: string) => http<IntakeDoc>(`/intake/${id}/fields`, { method: 'PATCH', json: { key, value } })
export const serverConfirm = (id: string) => http<IntakeDoc>(`/intake/${id}/confirm`, { method: 'POST' })
export const serverSetStatus = (id: string, status: string, note?: string) => http<IntakeDoc>(`/intake/${id}/status`, { method: 'POST', json: { status, note } })
export const reExtract = (id: string) => http<IntakeDoc>(`/intake/${id}/extract`, { method: 'POST' })
export const fileUrl = (d: IntakeDoc) => `${d.fileUrl}?u=${encodeURIComponent(apiUser())}`
export const listServerAudit = (entityId: string) => http<AuditEntry[]>(`/audit?entity=${encodeURIComponent(entityId)}`)

/* AI extraction */
export const getAiSettings = () => http<AiSettings>('/ai-settings')
export const saveAiSettings = (body: { active_provider?: AiProvider; auto_extract?: boolean; models?: Partial<Record<AiProvider, string>>; keys?: Partial<Record<AiProvider, string>> }) =>
  http<AiSettings>('/ai-settings', { method: 'PUT', json: body })
export const testAiKey = (provider: AiProvider, key?: string) => http<{ models: string[] }>('/ai-settings/test', { method: 'POST', json: { provider, key } })
