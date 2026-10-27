import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { KeyRound, Mail, Plug, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Banner, Card, CardBody, CardHeader, EmptyState, StatusPill } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useAi, useGsp, useIntegrations, useSap } from '@/api/hooks'
import * as api from '@/api'
import { dateTime } from '@/lib/format'
import type { GspSettings, SapConnection } from '@/lib/types'
import { ConnectMailbox, Field, MailboxRow, NativeSelect, PasswordInput } from './clients/parts'

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
          <CardHeader title="Document reading" as="h3" />
          <AiCard canManage={canManage} />
        </Card>
        <Card>
          <CardHeader title="GST verification" as="h3"><span className="text-[11px] text-text-3">Vayana · GSP</span></CardHeader>
          {isAdmin ? <GspCard /> : (
            <CardBody className="flex flex-col gap-2 text-xs">
              {d?.gsp.configured ? <StatusPill tone="ok">Connected · {d.gsp.environment}</StatusPill> : <StatusPill tone="none" plain>Not connected</StatusPill>}
              <p className="text-text-2">A firm admin connects the GSP that checks GSTIN status, signed e-invoices and e-way bills.</p>
            </CardBody>
          )}
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

const PROVIDER_LABEL: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI' }
const CUSTOM = '__custom__'

/** Which model reads every document: provider, key and model, with a test call so you know it works. */
function AiCard({ canManage }: { canManage: boolean }) {
  const q = useAi()
  const { act, pending } = useAct()
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [custom, setCustom] = useState(false)
  const [key, setKey] = useState('')
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [live, setLive] = useState<string[] | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const d = q.data
  // Re-sync only when the saved settings actually change: every mutation refetches, and that
  // must not wipe what the admin is typing or the test result they just asked for.
  const sig = d ? `${d.provider}|${d.model}|${d.keySet}` : ''
  useEffect(() => {
    if (!d) return
    setProvider(d.provider)
    setModel(d.model)
    setCustom(!d.knownModels[d.provider]?.includes(d.model))
  }, [sig])  // eslint-disable-line react-hooks/exhaustive-deps
  // Ask the provider which models this key can use; the built-in list is only the fallback.
  const hasKey = !!d && d.keySet
  useEffect(() => {
    setLive(null)
    if (!provider || !hasKey) return
    let stale = false
    api.listAiModels({ provider }).then(r => {
      if (stale || !r.ok || !r.models.length) return
      setLive(r.models)
      // The saved model counts as "Other" only against the built-in list; once the real one
      // arrives it usually contains the model, so show it selected instead of as a custom name.
      setCustom(c => c && !r.models.includes(model))
    }).catch(() => {})
    return () => { stale = true }
  }, [provider, hasKey])
  if (q.isError) return <CardBody className="text-xs text-text-3">Only a firm admin or partner can see these settings.</CardBody>
  if (!d || !provider) return <CardBody className="text-xs text-text-3">Loading…</CardBody>

  const known = live ?? d.knownModels[provider] ?? []
  const onProvider = (p: string) => { setProvider(p); setModel(d.defaultModels[p] ?? ''); setCustom(false); setTest(null) }
  const body = { provider, model: model.trim(), api_key: key ? key : undefined }
  // The saved model may not be in the fetched list; keep it selectable rather than silently switching.
  const options = known.includes(model) || !model ? known : [model, ...known]

  return (
    <CardBody className="flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {d.configured ? <StatusPill tone="ok">{PROVIDER_LABEL[d.provider] ?? d.provider} · {d.model}</StatusPill> : <StatusPill tone="bad">Not configured</StatusPill>}
        {d.lastTestAt && <span className="text-text-3">Tested {dateTime(d.lastTestAt)}</span>}
      </div>
      {d.lastTestResult && !test && <Banner tone={d.lastTestResult.startsWith('OK') ? 'ok' : 'bad'}>{d.lastTestResult}</Banner>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Provider">
          <NativeSelect label="Provider" value={provider} onChange={onProvider} disabled={!canManage}
            options={d.providers.map(p => [p, PROVIDER_LABEL[p] ?? p] as [string, string])} />
        </Field>
        <Field label="Model" hint={live ? `${live.length} models on this key` : 'Suggestions · test the key to load the full list'}>
          <NativeSelect label="Model" value={custom ? CUSTOM : model} disabled={!canManage}
            onChange={v => { if (v === CUSTOM) { setCustom(true) } else { setCustom(false); setModel(v) } }}
            options={[...options.map(m => [m, m] as [string, string]), [CUSTOM, 'Other…']]} />
        </Field>
      </div>
      {custom && <Field label="Model name" hint="Exactly as the provider spells it"><Input value={model} onChange={e => setModel(e.target.value)} disabled={!canManage} className="font-mono" placeholder={d.defaultModels[provider]} /></Field>}
      <Field label={d.keySet ? 'API key (saved · enter to replace)' : 'API key'} hint={provider === 'openai' ? 'From platform.openai.com → API keys' : 'From console.anthropic.com → API keys'}>
        <PasswordInput aria-label="API key" value={key} onChange={e => setKey(e.target.value)} disabled={!canManage} autoComplete="off" placeholder={d.keySet ? '••••••••' : provider === 'openai' ? 'sk-…' : 'sk-ant-…'} />
      </Field>
      {test && <Banner tone={test.ok ? 'ok' : 'bad'}>{test.message}</Banner>}
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button variant="default" disabled={pending || !model.trim()} onClick={async () => { if (await act(() => api.saveAi({ ...body, api_key: key ? key : null }), 'Document reading saved')) { setKey(''); setTest(null) } }}>Save</Button>
          <Button disabled={pending || (!key && !hasKey) || !model.trim()} onClick={async () => {
            const r = await act(() => api.testAi(body))
            if (r) setTest(r)
            if (r?.ok) api.listAiModels({ provider, api_key: key || undefined }).then(m => { if (m.ok && m.models.length) setLive(m.models) }).catch(() => {})
          }}><Plug />Test API key</Button>
          {d.keySet && <Button variant="ghost" disabled={pending} onClick={() => setConfirmRevoke(true)}><KeyRound />Revoke key</Button>}
        </div>
      )}
      <p className="text-text-2">Every uploaded or emailed document is read by this model. The key is stored encrypted and never shown again. Extracted values stay unconfirmed until a person checks them.</p>
      <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Revoke the {PROVIDER_LABEL[d.provider] ?? d.provider} key?</DialogTitle>
            <DialogDescription>Pravah forgets the key and stops reading documents until a new one is saved. Documents already read keep their fields, and the audit log keeps the record. Revoking here does not cancel the key at {d.provider === 'openai' ? 'OpenAI' : 'Anthropic'} — delete it there too if it should stop working everywhere.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmRevoke(false)}>Keep the key</Button>
            <Button variant="destructive" disabled={pending} onClick={async () => { await act(() => api.revokeAiKey(), 'Key revoked'); setKey(''); setTest(null); setLive(null); setConfirmRevoke(false) }}><KeyRound />Revoke key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardBody>
  )
}

/** The GSP login that verifies GSTINs, the IRP signature on e-invoice QR codes and e-way bills. */
function GspCard() {
  const q = useGsp()
  const d = q.data
  if (q.isError) return <CardBody className="text-xs text-text-3">Only a firm admin can see these settings.</CardBody>
  if (!d) return <CardBody className="text-xs text-text-3">Loading…</CardBody>
  // A new form whenever the saved settings change: every mutation refetches, and that must not wipe what is being typed.
  return <GspForm key={`${d.environment}|${d.email}|${d.orgId}|${d.passwordSet}`} d={d} />
}

function GspForm({ d }: { d: GspSettings }) {
  const { act, pending } = useAct()
  const [environment, setEnvironment] = useState<GspSettings['environment']>(d.environment)
  const [email, setEmail] = useState(d.email)
  const [password, setPassword] = useState('')
  const [orgId, setOrgId] = useState(d.orgId)
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([])
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const body = { environment, email: email.trim(), org_id: orgId.trim(), password: password ? password : undefined }
  const orgOptions: [string, string][] = orgs.length ? orgs.map(o => [o.id, o.name ? `${o.name} · ${o.id}` : o.id]) : orgId ? [[orgId, orgId]] : []
  return (
    <CardBody className="flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {d.configured ? <StatusPill tone="ok">Connected · {d.environment}</StatusPill> : <StatusPill tone="bad">Not configured</StatusPill>}
        {d.lastTestAt && <span className="text-text-3">Tested {dateTime(d.lastTestAt)}</span>}
      </div>
      {d.lastTestResult && !test && <Banner tone={d.lastTestResult.startsWith('OK') ? 'ok' : 'bad'}>{d.lastTestResult}</Banner>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Environment">
          <NativeSelect label="Environment" value={environment} onChange={v => { setEnvironment(v as GspSettings['environment']); setTest(null) }} options={[['sandbox', 'Sandbox (testing)'], ['live', 'Live']]} />
        </Field>
        <Field label="Vayana login email"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" /></Field>
      </div>
      <Field label={d.passwordSet ? 'Password (saved · enter to replace)' : 'Password'}>
        <PasswordInput aria-label="Vayana password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" placeholder={d.passwordSet ? '••••••••' : ''} />
      </Field>
      <Field label="Organisation" hint={orgs.length ? `${orgs.length} on this login` : 'Test the login to list the organisations it can use'}>
        {orgOptions.length ? <NativeSelect label="Organisation" value={orgId} onChange={setOrgId} options={[['', 'Choose…'], ...orgOptions]} />
          : <Input value={orgId} onChange={e => setOrgId(e.target.value)} placeholder="Organisation id" className="font-mono" />}
      </Field>
      {test && <Banner tone={test.ok ? 'ok' : 'bad'}>{test.message}</Banner>}
      <div className="flex flex-wrap gap-2">
        <Button variant="default" disabled={pending || !email.trim()} onClick={async () => { if (await act(() => api.saveGsp({ ...body, password: password ? password : null }), 'GST verification saved')) { setPassword(''); setTest(null) } }}>Save</Button>
        <Button disabled={pending || !email.trim() || (!password && !d.passwordSet)} onClick={async () => {
          const r = await act(() => api.testGsp(body))
          if (!r) return
          setTest(r)
          setOrgs(r.orgs)
          if (!orgId && r.orgs.length === 1) setOrgId(r.orgs[0].id)
        }}><Plug />Test login</Button>
        {d.passwordSet && <Button variant="ghost" disabled={pending} onClick={() => setConfirmRevoke(true)}><KeyRound />Revoke</Button>}
      </div>
      <p className="text-text-2">Checks each supplier's GSTIN status, verifies the IRP signature on the e-invoice QR code read from the paper, and matches e-way bills. Ask Vayana to set your billing GSTIN (comm GSTIN). E-way bills also need each client's e-way bill API user, set under the client's GST registrations. The password is stored encrypted and never shown again.</p>
      <Dialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Revoke the Vayana login?</DialogTitle>
            <DialogDescription>Pravah forgets the password and stops verifying with GST systems until a new one is saved. Results already recorded stay, and the audit log keeps the record.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmRevoke(false)}>Keep it</Button>
            <Button variant="destructive" disabled={pending} onClick={async () => { await act(() => api.revokeGsp(), 'Login revoked'); setPassword(''); setTest(null); setConfirmRevoke(false) }}><KeyRound />Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardBody>
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
