import { useState } from 'react'
import { useParams } from 'react-router'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Banner, Card, CardBody, CardHeader, Gstin, KV, PageHeader, Q, StatusPill } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useEntity } from '@/api/hooks'
import * as api from '@/api'
import type { EntityInput, GstInput } from '@/api'
import type { Entity } from '@/lib/types'
import { CompanyFields, Field, GstinEditor, MailboxesCard, PasswordInput, companyErrors, gstinRowError, useCanManage } from './parts'

const BAND = { 'above-5cr': 'Above ₹5 Cr · e-invoice required', 'below-5cr': 'Below ₹5 Cr', exempt: 'Exempt' }

export default function ClientPage() {
  const { id = '' } = useParams()
  const q = useEntity(id)
  return <Q q={q}>{e => <Client e={e} />}</Q>
}

function Client({ e }: { e: Entity }) {
  const { refresh } = useSession()
  const { act, pending } = useAct()
  const canEdit = useCanManage()
  const [editing, setEditing] = useState(false)
  const [c, setC] = useState<EntityInput>(() => toInput(e))
  const [gst, setGst] = useState<GstInput[]>(() => toGst(e))
  const [ewbFor, setEwbFor] = useState<string | null>(null)
  const err = companyErrors(c), gstErr = gstinRowError(gst, e.pan)
  const reset = () => { setC(toInput(e)); setGst(toGst(e)); setEditing(false) }

  return (
    <>
      <PageHeader title={e.name} crumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Clients', to: '/settings' }]}
        badges={<StatusPill tone={e.status === 'active' ? 'ok' : 'warn'}>{e.status === 'active' ? 'Active' : 'Onboarding'}</StatusPill>}
        actions={canEdit && !editing && <Button onClick={() => setEditing(true)}><Pencil />Edit details</Button>} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(420px,1fr))] items-start gap-4">
        <Card>
          <CardHeader title="Company" as="h3" />
          <CardBody className="flex flex-col gap-4">
            {editing ? <>
              <CompanyFields c={c} set={setC} lockPan show />
              <h3>GST registrations</h3>
              <GstinEditor rows={gst} set={setGst} pan={e.pan} canRemove={g => e.status !== 'active' || !e.gstins.some(x => x.gstin === g)} />
              {gstErr && <Banner tone="bad" role="alert">{gstErr}</Banner>}
              <div className="flex justify-end gap-2"><Button onClick={reset}>Cancel</Button>
                <Button variant="default" disabled={pending || !!gstErr || Object.keys(err).length > 0}
                  onClick={async () => { if (await act(() => api.updateEntity(e.id, { ...c, pan: undefined, gstins: gst }), 'Client details saved')) { refresh(); setEditing(false) } }}>Save</Button></div>
            </> : (
              <KV items={[['Legal name', e.name], ['Short name', e.shortName], ['City', e.city || '—'], ['PAN', <span className="font-mono">{e.pan}</span>],
                ['TAN', <span className="font-mono">{e.tan || '—'}</span>], ['CIN / LLPIN', <span className="font-mono">{e.cin || '—'}</span>],
                ['SAP company code', e.sapCompanyCode || 'Not set'], ['E-invoicing', BAND[e.einvoiceBand ?? 'above-5cr']],
                ['Own MSME status', e.msmeStatus === 'none' || !e.msmeStatus ? 'Not MSME' : e.msmeStatus[0].toUpperCase() + e.msmeStatus.slice(1)],
                ['Financial year', e.fyStartMonth === 1 ? 'January–December' : 'April–March']]} />
            )}
          </CardBody>
        </Card>
        {!editing && (
          <Card>
            <CardHeader title="GST registrations" as="h3"><span className="text-[11px] text-text-3">{e.gstins.length}</span></CardHeader>
            {e.gstins.map(g => (
              <div key={g.gstin} className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 last:border-b-0">
                <Gstin g={g.gstin} state={`${g.code} · ${g.state}`} />
                <span className="mr-auto text-[11.5px] text-text-2">{g.placeOfBusiness}</span>
                <span className="text-[11px] text-text-3">{g.filingFrequency === 'qrmp' ? 'Quarterly (QRMP)' : 'Monthly'} · {g.einvoiceApplicable ? 'e-invoice' : 'no e-invoice'}</span>
                <div className="flex basis-full flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-text-2">E-way bill API user:</span>
                  {g.ewbUserSet ? <StatusPill tone="ok" plain>{g.ewbUsername}</StatusPill> : <StatusPill tone="none" plain>Not set</StatusPill>}
                  {canEdit && <Button size="xs" onClick={() => setEwbFor(g.gstin)}>{g.ewbUserSet ? 'Change' : 'Set'}</Button>}
                  {canEdit && g.ewbUserSet && <Button size="xs" variant="ghost" disabled={pending} onClick={() => act(() => api.clearEwbUser(e.id, g.gstin), 'E-way bill API user removed')}>Remove</Button>}
                </div>
              </div>
            ))}
          </Card>
        )}
        <EwbUserDialog entityId={e.id} gstin={ewbFor} onClose={() => setEwbFor(null)} />
        <MailboxesCard entityId={e.id} ret={`/settings/clients/${e.id}`} />
      </div>
    </>
  )
}

/** The e-way bill portal API user this GSTIN created for the GSP, so e-way bills addressed to it can be verified. */
function EwbUserDialog({ entityId, gstin, onClose }: { entityId: string; gstin: string | null; onClose: () => void }) {
  const { act, pending } = useAct()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  return (
    <Dialog open={gstin != null} onOpenChange={o => { if (!o) { onClose(); setUsername(''); setPassword('') } }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>E-way bill API user · {gstin}</DialogTitle>
          <DialogDescription>On ewaybillgst.gov.in, sign in as this GSTIN, go to Registration → For GSP, choose Vayana and create an API user. Enter it here; the password is stored encrypted and never shown again.</DialogDescription>
        </DialogHeader>
        <Field label="API username"><Input value={username} onChange={ev => setUsername(ev.target.value)} autoComplete="off" /></Field>
        <Field label="API password"><PasswordInput aria-label="API password" value={password} onChange={ev => setPassword(ev.target.value)} autoComplete="off" /></Field>
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="default" disabled={pending || !username.trim() || !password}
            onClick={async () => { if (gstin && await act(() => api.setEwbUser(entityId, gstin, username.trim(), password), 'E-way bill API user saved')) { setUsername(''); setPassword(''); onClose() } }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const toInput = (e: Entity): EntityInput => ({ legal_name: e.name, short_name: e.shortName, city: e.city, pan: e.pan, tan: e.tan, cin: e.cin, sap_company_code: e.sapCompanyCode, einvoice_band: e.einvoiceBand, msme_status: e.msmeStatus, fy_start_month: e.fyStartMonth })
const toGst = (e: Entity): GstInput[] => e.gstins.map(g => ({ gstin: g.gstin, place_of_business: g.placeOfBusiness, filing_frequency: g.filingFrequency, einvoice_applicable: g.einvoiceApplicable }))
