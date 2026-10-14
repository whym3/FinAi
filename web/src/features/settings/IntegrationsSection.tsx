import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Mail, Plug, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Banner, Card, CardBody, CardHeader, EmptyState, StatusPill } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useIntegrations, useSap } from '@/api/hooks'
import * as api from '@/api'
import { dateTime } from '@/lib/format'
import type { SapConnection } from '@/lib/types'
import { ConnectMailbox, Field, MailboxRow, NativeSelect } from './clients/parts'

const OBJECTS: [string, string][] = [['purchase_orders', 'Purchase orders'], ['goods_receipts', 'Goods receipts'], ['supplier_invoices', 'Supplier invoices'], ['business_partners', 'Business partners (vendors)'], ['ar_open_items', 'Customer open items'], ['ap_open_items', 'Vendor open items']]

export function IntegrationsSection() {
  const { entities, isAdmin, role } = useSession()
  const q = useIntegrations()
  const d = q.data
  const canManage = isAdmin || ['partner', 'cfo', 'controller'].includes(role ?? '')
  const [sapEntity, setSapEntity] = useState(entities[0]?.id ?? '')
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Invoice mailboxes" as="h3"><span className="text-[11px] text-text-3">Email intake · checked every minute</span></CardHeader>
        {d && d.mailboxes.length === 0 && <EmptyState title="No mailbox connected yet" icon={<Mail className="size-5" />}>Connect each client's AP inbox so supplier invoices flow in by themselves.</EmptyState>}
        {d?.mailboxes.map(mb => <MailboxRow key={mb.id} mb={mb} canManage={canManage} entityName={entities.find(e => e.id === mb.entityId)?.shortName} />)}
        {canManage && entities.length > 0 && (
          <div className="border-t border-border px-4 py-3">
            <ConnectPicker />
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="SAP S/4HANA" as="h3">
          {entities.length > 1 && <NativeSelect label="Client" value={sapEntity} onChange={setSapEntity} options={entities.map(e => [e.id, e.shortName])} />}
        </CardHeader>
        {sapEntity ? <SapCard entityId={sapEntity} canManage={canManage} /> : <EmptyState title="Onboard a client first" />}
      </Card>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4">
        <Card>
          <CardHeader title="Claude (document reading)" as="h3" />
          <CardBody className="flex flex-col gap-2 text-xs">
            {d?.claude.configured ? <StatusPill tone="ok">Configured on the server · {d.claude.model}</StatusPill> : <StatusPill tone="bad">Not configured</StatusPill>}
            <p className="text-text-2">Every uploaded or emailed document is read by Claude. The API key is set once in the server configuration (<code>ANTHROPIC_API_KEY</code>); nobody enters keys in the app. Extracted values stay unconfirmed until a person checks them.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Outgoing email" as="h3" />
          <CardBody className="flex flex-col gap-2 text-xs">
            {d?.smtp.configured ? <StatusPill tone="ok">Sending as {d.smtp.from}</StatusPill> : <StatusPill tone="warn">Not configured</StatusPill>}
            <p className="text-text-2">Used for invites, password resets and vendor queries. Set <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASSWORD</code> and <code>SMTP_FROM</code> on the server. Until then, invite links are shown to the admin to send by hand.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="GST portal · Bank · TRACES" as="h3" />
          <CardBody className="flex flex-col gap-2 text-xs">
            <StatusPill tone="none" plain>Not connected</StatusPill>
            <p className="text-text-2">IMS and GSTR-2B (through a GST Suvidha Provider), bank statements and payment files, and Form 26AS come in the next release. Their screens show what the registers already hold.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="SAP exports" as="h3"><Button size="sm" asChild><Link to="/imports"><Sparkles />Open Imports</Link></Button></CardHeader>
          <CardBody className="text-xs text-text-2">
            {d && d.imports.length === 0 && 'No exports imported yet. The Imports page takes purchase and sales registers, stock movements and open-item lists from SAP as Excel or CSV.'}
            {d?.imports.map(i => <div key={`${i.entityId}-${i.kind}`} className="flex justify-between gap-2 border-b border-border py-1 last:border-b-0"><span>{entities.find(e => e.id === i.entityId)?.shortName} · {i.kind.replace(/_/g, ' ')}</span><span className="text-text-3">{i.periodFrom ? `${i.periodFrom} → ${i.periodTo}` : ''} · {dateTime(i.finishedAt)}</span></div>)}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function ConnectPicker() {
  const { entities } = useSession()
  const [ent, setEnt] = useState(entities[0]?.id ?? '')
  return (
    <div className="flex flex-col gap-2">
      {entities.length > 1 && <Field label="Connect a mailbox for"><NativeSelect label="Client" value={ent} onChange={setEnt} options={entities.map(e => [e.id, e.shortName])} /></Field>}
      <ConnectMailbox entityId={ent} ret="/settings/integrations" />
    </div>
  )
}

function SapCard({ entityId, canManage }: { entityId: string; canManage: boolean }) {
  const q = useSap(entityId)
  const { act, pending } = useAct()
  const [f, setF] = useState<SapConnection | null>(null)
  const [password, setPassword] = useState('')
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  useEffect(() => { if (q.data) { setF(q.data); setPassword(''); setTest(null) } }, [q.data])
  if (!f) return <CardBody className="text-xs text-text-3">Loading…</CardBody>
  const set = <K extends keyof SapConnection>(k: K, v: SapConnection[K]) => setF({ ...f, [k]: v })
  const save = (status?: 'draft' | 'active' | 'paused') => act(() => api.saveSap(entityId, { edition: f.edition, host: f.host, client: f.client, company_code: f.companyCode, username: f.username, password: password || null, objects: f.objects, schedule_minutes: f.scheduleMinutes, ...(status ? { status } : {}) }), status === 'active' ? 'SAP sync activated' : 'SAP connection saved')
  return (
    <CardBody className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <StatusPill tone={f.status === 'active' ? 'ok' : f.status === 'error' ? 'bad' : f.status === 'paused' ? 'warn' : 'none'}>{{ none: 'Not set up', draft: 'Draft', active: 'Live', paused: 'Paused', error: 'Error' }[f.status]}</StatusPill>
        {f.lastSyncAt && <span className="text-text-3">Last sync {dateTime(f.lastSyncAt)}</span>}
        {f.lastTestResult && <span className="text-text-3">· {f.lastTestResult}</span>}
      </div>
      {f.lastError && <Banner tone="bad">{f.lastError}</Banner>}
      <p className="text-[11.5px] text-text-2">Read-only pulls over the standard OData APIs (purchase orders, goods receipts, supplier invoices, business partners, open items). Until a client gives access, use the <Link to="/imports">Imports</Link> page with SAP exports; both land in the same records.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Edition"><NativeSelect label="Edition" value={f.edition} onChange={v => set('edition', v)} options={[['public-cloud', 'S/4HANA Cloud, public edition'], ['private-cloud', 'S/4HANA Cloud, private edition'], ['on-premise', 'S/4HANA on-premise']]} disabled={!canManage} /></Field>
        <Field label="Host" hint="https://my123456-api.s4hana.cloud.sap"><Input value={f.host} onChange={e => set('host', e.target.value)} disabled={!canManage} className="font-mono" /></Field>
        <Field label="Client" hint="3 digits, e.g. 100"><Input value={f.client} onChange={e => set('client', e.target.value)} disabled={!canManage} className="font-mono" maxLength={3} /></Field>
        <Field label="Company code"><Input value={f.companyCode} onChange={e => set('companyCode', e.target.value)} disabled={!canManage} className="font-mono" /></Field>
        <Field label="Communication user"><Input value={f.username} onChange={e => set('username', e.target.value)} disabled={!canManage} /></Field>
        <Field label={f.passwordSet ? 'Password (saved · enter to replace)' : 'Password'}><Input type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={!canManage} autoComplete="new-password" /></Field>
        <Field label="Sync every"><NativeSelect label="Schedule" value={String(f.scheduleMinutes)} onChange={v => set('scheduleMinutes', Number(v))} options={[['15', '15 minutes'], ['60', 'Hour'], ['240', '4 hours'], ['1440', 'Day']]} disabled={!canManage} /></Field>
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {OBJECTS.map(([k, l]) => <label key={k} className="flex items-center gap-1.5"><input type="checkbox" className="accent-[var(--primary)]" disabled={!canManage} checked={f.objects.includes(k)} onChange={e => set('objects', e.target.checked ? [...f.objects, k] : f.objects.filter(x => x !== k))} />{l}</label>)}
      </div>
      {test && <Banner tone={test.ok ? 'ok' : 'bad'}>{test.message}</Banner>}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => save()}>Save</Button>
          <Button disabled={pending || !f.host} onClick={async () => { await save(); const r = await act(() => api.testSap(entityId)); if (r) setTest(r) }}><Plug />Test connection</Button>
          {f.status !== 'active' ? <Button variant="default" disabled={pending || !f.host || (!f.passwordSet && !password)} onClick={() => save('active')}>Activate sync</Button>
            : <><Button disabled={pending} onClick={() => act(() => api.syncSap(entityId), 'Sync queued')}><RefreshCw />Sync now</Button><Button variant="ghost" disabled={pending} onClick={() => save('paused')}>Pause</Button></>}
        </div>
      )}
    </CardBody>
  )
}
