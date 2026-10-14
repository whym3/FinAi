import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Mail, Pause, Play, Plus, RefreshCw, Trash2, Unplug, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Banner, Card, CardHeader, EmptyState, Gstin, StatusPill } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useIntegrations, useMailboxes, useMailboxRecent } from '@/api/hooks'
import * as api from '@/api'
import type { EntityInput, GstInput } from '@/api'
import { CIN_RE, PAN_RE, TAN_RE, checkGstin } from '@/lib/gstin'
import { ago, dateTime } from '@/lib/format'
import type { Mailbox, MailProvider, Tone } from '@/lib/types'
import { cn } from '@/lib/utils'

export const ADMIN = ['partner', 'cfo', 'controller']
/** Firm admins and partners manage everything; CFOs and controllers manage their own client. */
export function useCanManage() { const { isAdmin, firmWide, role } = useSession(); return isAdmin || firmWide || ADMIN.includes(role ?? '') }

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1 text-xs font-medium text-text-2', className)}>
      {label}
      {children}
      {error ? <span className="text-[11px] font-normal text-bad">{error}</span> : hint ? <span className="text-[11px] font-normal text-text-3">{hint}</span> : null}
    </label>
  )
}

export function NativeSelect({ value, onChange, options, label, disabled }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string; disabled?: boolean }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
      className="h-8 rounded-md border border-border-2 bg-surface px-2 pr-6 text-xs text-text disabled:opacity-60">
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

const up = (s: string) => s.toUpperCase().replace(/\s/g, '')

export function companyErrors(c: EntityInput): Record<string, string> {
  const e: Record<string, string> = {}
  if (c.legal_name.trim().length < 2) e.legal_name = 'Required'
  if (c.short_name.trim().length < 2) e.short_name = 'Required'
  if (!PAN_RE.test(c.pan)) e.pan = 'Format AAACM1234M'
  if (c.tan && !TAN_RE.test(c.tan)) e.tan = 'Format PNEM12345A'
  if (c.cin && !CIN_RE.test(c.cin)) e.cin = '21-character CIN, or LLPIN like AAA-1234'
  return e
}

export function CompanyFields({ c, set, lockPan, show }: { c: EntityInput; set: (c: EntityInput) => void; lockPan?: boolean; show?: boolean }) {
  const err = show ? companyErrors(c) : {}
  const f = <K extends keyof EntityInput>(k: K, v: EntityInput[K]) => set({ ...c, [k]: v })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Legal name" error={err.legal_name} className="sm:col-span-2"><Input value={c.legal_name} onChange={e => f('legal_name', e.target.value)} placeholder="As on the PAN card" /></Field>
      <Field label="Short name" hint="Shown in the client switcher" error={err.short_name}><Input value={c.short_name} onChange={e => f('short_name', e.target.value)} /></Field>
      <Field label="City"><Input value={c.city ?? ''} onChange={e => f('city', e.target.value)} /></Field>
      <Field label="PAN" error={err.pan} hint={lockPan ? 'PAN cannot change after onboarding starts' : undefined}><Input value={c.pan} disabled={lockPan} onChange={e => f('pan', up(e.target.value))} className="font-mono" maxLength={10} /></Field>
      <Field label="TAN" error={err.tan} hint="Optional · needed for TDS"><Input value={c.tan ?? ''} onChange={e => f('tan', up(e.target.value) || null)} className="font-mono" maxLength={10} /></Field>
      <Field label="CIN / LLPIN" error={err.cin} hint="Optional"><Input value={c.cin ?? ''} onChange={e => f('cin', up(e.target.value) || null)} className="font-mono" maxLength={21} /></Field>
      <Field label="SAP company code" hint="Optional until SAP is connected"><Input value={c.sap_company_code ?? ''} onChange={e => f('sap_company_code', e.target.value)} className="font-mono" /></Field>
      <Field label="E-invoicing"><NativeSelect label="E-invoicing" value={c.einvoice_band ?? 'above-5cr'} onChange={v => f('einvoice_band', v as EntityInput['einvoice_band'])}
        options={[['above-5cr', 'Turnover above ₹5 Cr · e-invoice required'], ['below-5cr', 'Turnover below ₹5 Cr'], ['exempt', 'Exempt (bank, SEZ unit, …)']]} /></Field>
      <Field label="Client's own MSME status"><NativeSelect label="MSME status" value={c.msme_status ?? 'none'} onChange={v => f('msme_status', v as EntityInput['msme_status'])}
        options={[['none', 'Not MSME'], ['micro', 'Micro'], ['small', 'Small'], ['medium', 'Medium']]} /></Field>
      <Field label="Financial year starts"><NativeSelect label="Financial year start" value={String(c.fy_start_month ?? 4)} onChange={v => f('fy_start_month', Number(v))}
        options={[['4', 'April (Indian FY)'], ['1', 'January']]} /></Field>
    </div>
  )
}

export function gstinRowError(rows: GstInput[], pan: string): string | null {
  for (const [i, r] of rows.entries()) {
    const chk = checkGstin(r.gstin, pan)
    if (!chk.ok) return `${r.gstin || `Row ${i + 1}`}: ${chk.errors[0]}`
    if (rows.findIndex(x => up(x.gstin) === up(r.gstin)) !== i) return `${r.gstin} is listed twice`
  }
  return null
}

export function GstinEditor({ rows, set, pan, canRemove = () => true }: { rows: GstInput[]; set: (r: GstInput[]) => void; pan: string; canRemove?: (g: string) => boolean }) {
  const upd = (i: number, p: Partial<GstInput>) => set(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => {
        const chk = r.gstin ? checkGstin(r.gstin, pan) : null
        const tone: Tone = !chk ? 'none' : !chk.ok ? 'bad' : chk.warnings.length ? 'warn' : 'ok'
        return (
          <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="GSTIN" className="w-[200px]"><Input value={r.gstin} onChange={e => upd(i, { gstin: up(e.target.value) })} className="font-mono" maxLength={15} placeholder={pan ? `27${pan}1Z?` : '27AAACM1234M1Z5'} /></Field>
              <Field label="Place of business" className="min-w-[180px] flex-1"><Input value={r.place_of_business ?? ''} onChange={e => upd(i, { place_of_business: e.target.value })} placeholder="City / plant" /></Field>
              <Field label="Returns"><NativeSelect label="Filing frequency" value={r.filing_frequency ?? 'monthly'} onChange={v => upd(i, { filing_frequency: v as GstInput['filing_frequency'] })} options={[['monthly', 'Monthly'], ['qrmp', 'Quarterly (QRMP)']]} /></Field>
              <label className="flex h-8 items-center gap-1.5 text-xs text-text-2"><input type="checkbox" className="accent-[var(--primary)]" checked={r.einvoice_applicable ?? true} onChange={e => upd(i, { einvoice_applicable: e.target.checked })} />E-invoice</label>
              <Button size="icon-sm" variant="ghost" aria-label="Remove GSTIN" disabled={!canRemove(r.gstin)} onClick={() => set(rows.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
            {chk && (
              <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                <StatusPill tone={tone} plain>{!chk.ok ? chk.errors[0] : chk.warnings[0] ?? 'Format, state and PAN check out'}</StatusPill>
                {chk.state && <Gstin state={`${r.gstin.slice(0, 2)} · ${chk.state}`} />}
              </div>
            )}
          </div>
        )
      })}
      <Button size="sm" className="self-start" onClick={() => set([...rows, { gstin: '', place_of_business: '', filing_frequency: 'monthly', einvoice_applicable: true }])}><Plus />Add GSTIN</Button>
    </div>
  )
}

const PROVIDER: Record<MailProvider, string> = { gmail: 'Gmail / Google Workspace', outlook: 'Outlook / Microsoft 365' }
const MB_TONE: Record<Mailbox['status'], [Tone, string]> = { active: ['ok', 'Live'], paused: ['none', 'Paused'], error: ['bad', 'Needs attention'], disconnected: ['none', 'Disconnected'] }

/** Connect buttons with the backfill choice. Navigates away to the provider and comes back to `ret`. */
export function ConnectMailbox({ entityId, ret, disabled }: { entityId: string; ret: string; disabled?: boolean }) {
  const [backfill, setBackfill] = useState('7')
  const health = useIntegrations().data?.oauth
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <Button disabled={disabled} onClick={() => api.connectMailbox('gmail', entityId, ret, Number(backfill))}><Mail />Connect Gmail</Button>
        <Button disabled={disabled} onClick={() => api.connectMailbox('outlook', entityId, ret, Number(backfill))}><Mail />Connect Outlook</Button>
        <Field label="Read past mail" className="ml-1"><NativeSelect label="Backfill" value={backfill} onChange={setBackfill} options={[['0', 'New mail only'], ['7', 'Last 7 days'], ['30', 'Last 30 days']]} /></Field>
      </div>
      <div className="text-[11px] text-text-3">
        Read-only access. Pravah checks the inbox every minute and takes PDF, image, XML/JSON and ZIP attachments into the Intake inbox. Nothing is sent, moved or deleted.
        {health && (!health.gmail || !health.outlook) && <> Not set up on this server yet: {[!health.gmail && 'Google', !health.outlook && 'Microsoft'].filter(Boolean).join(' and ')} sign-in (see server/README.md).</>}
      </div>
    </div>
  )
}

function SenderRulesDialog({ mb, open, onOpenChange }: { mb: Mailbox; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { act, pending } = useAct()
  const [allow, setAllow] = useState(mb.senderAllow.join(', '))
  const [block, setBlock] = useState(mb.senderBlock.join(', '))
  const list = (s: string) => s.split(/[,\s]+/).map(x => x.trim()).filter(Boolean)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader><DialogTitle>Sender rules · {mb.address}</DialogTitle><DialogDescription>Addresses or domains, separated by commas. Block wins over allow.</DialogDescription></DialogHeader>
        <Field label="Only take mail from" hint="Empty = everyone (recommended to start)"><Input value={allow} onChange={e => setAllow(e.target.value)} placeholder="sahyadripack.in, billing@deccansteel.in" /></Field>
        <Field label="Ignore mail from"><Input value={block} onChange={e => setBlock(e.target.value)} placeholder="newsletter.example.com" /></Field>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="default" disabled={pending} onClick={async () => { if (await act(() => api.updateMailbox(mb.id, { sender_allow: list(allow), sender_block: list(block) }), 'Sender rules saved')) onOpenChange(false) }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MailboxRow({ mb, canManage, entityName }: { mb: Mailbox; canManage: boolean; entityName?: string }) {
  const { act, pending } = useAct()
  const [rules, setRules] = useState(false)
  const [confirmOff, setConfirmOff] = useState(false)
  const [tone, label] = MB_TONE[mb.status]
  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Mail className="size-4 text-text-2" />
        <div className="mr-auto min-w-0">
          <div className="font-mono text-[12.5px] break-all">{mb.address}{entityName && <span className="ml-2 font-sans text-[11px] text-text-3">{entityName}</span>}</div>
          <div className="text-[11px] text-text-3">{PROVIDER[mb.provider]} · {mb.documents} document{mb.documents === 1 ? '' : 's'} taken in · {mb.lastSyncAt ? `checked ${ago(mb.lastSyncAt)} (${dateTime(mb.lastSyncAt)})` : 'first check running'}</div>
        </div>
        <StatusPill tone={tone}>{label}</StatusPill>
        {canManage && <div className="flex flex-wrap gap-1.5">
          <Button size="sm" disabled={pending || mb.status === 'paused'} onClick={() => act(() => api.syncMailbox(mb.id), r => r.new ? `${r.new} new document${r.new > 1 ? 's' : ''} in Intake` : 'No new invoices')}><RefreshCw />Check now</Button>
          {mb.status === 'paused'
            ? <Button size="sm" disabled={pending} onClick={() => act(() => api.updateMailbox(mb.id, { status: 'active' }), 'Mailbox resumed')}><Play />Resume</Button>
            : <Button size="sm" disabled={pending} onClick={() => act(() => api.updateMailbox(mb.id, { status: 'paused' }), 'Mailbox paused')}><Pause />Pause</Button>}
          <Button size="sm" onClick={() => setRules(true)}>Sender rules</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmOff(true)}><Unplug />Disconnect</Button>
        </div>}
      </div>
      {mb.lastError && <Banner tone={mb.status === 'error' ? 'bad' : 'warn'}>{mb.lastError}</Banner>}
      <RecentIngest id={mb.id} />
      <SenderRulesDialog mb={mb} open={rules} onOpenChange={setRules} />
      <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader><DialogTitle>Disconnect {mb.address}?</DialogTitle><DialogDescription>Pravah stops reading this inbox and forgets its access token. Documents already taken in stay in Intake and the audit log.</DialogDescription></DialogHeader>
          <DialogFooter><Button onClick={() => setConfirmOff(false)}>Keep connected</Button><Button variant="destructive" disabled={pending} onClick={async () => { await act(() => api.disconnectMailbox(mb.id), 'Mailbox disconnected'); setConfirmOff(false) }}><X />Disconnect</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RecentIngest({ id }: { id: number }) {
  const docs = useMailboxRecent(id).data ?? []
  if (!docs.length) return null
  return (
    <details className="text-[11.5px]">
      <summary className="cursor-pointer text-text-2">Latest {Math.min(docs.length, 20)} documents</summary>
      <ul className="mt-1.5 flex flex-col">
        {docs.slice(0, 20).map(d => (
          <li key={d.id} className="flex flex-wrap gap-x-2 border-t border-border py-1">
            <span className="w-[120px] text-text-3 tabular-nums">{dateTime(d.receivedAt)}</span>
            <span className="min-w-0 flex-1 truncate">{d.filename} · <span className="text-text-3">{d.from}</span></span>
            <span className="text-text-2">{d.statusNote ?? d.status}</span>
          </li>
        ))}
      </ul>
      <Link to="/intake" className="text-acc">Open Intake inbox</Link>
    </details>
  )
}

export function MailboxesCard({ entityId, ret }: { entityId: string; ret: string }) {
  const q = useMailboxes(entityId)
  const canManage = useCanManage()
  return (
    <Card>
      <CardHeader title="Invoice mailboxes" as="h3"><span className="text-[11px] text-text-3">Email intake for this client</span></CardHeader>
      {(q.data ?? []).map(mb => <MailboxRow key={mb.id} mb={mb} canManage={canManage} />)}
      {!q.isLoading && !q.data?.length && <EmptyState title="No mailbox connected" icon={<Mail className="size-5" />}>Connect the AP inbox where suppliers send invoices.</EmptyState>}
      <div className="border-t border-border px-4 py-3">
        {canManage ? <ConnectMailbox entityId={entityId} ret={ret} /> : <span className="text-[11px] text-text-3">Only a partner, CFO or controller can connect mailboxes.</span>}
      </div>
    </Card>
  )
}
