import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Banner, Card, CardBody, CardHeader, Gstin, KV, PageHeader, Restricted } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useEntity, useMailboxes } from '@/api/hooks'
import * as api from '@/api'
import type { EntityInput, GstInput } from '@/api'
import { cn } from '@/lib/utils'
import { CompanyFields, ConnectMailbox, GstinEditor, MailboxesCard, companyErrors, gstinRowError } from './parts'

const STEPS = ['Company', 'GST registrations', 'Invoice mailbox', 'Review & activate']
const BLANK: EntityInput = { legal_name: '', short_name: '', city: '', pan: '', tan: null, cin: null, sap_company_code: '', einvoice_band: 'above-5cr', msme_status: 'none', fy_start_month: 4 }

/** Four steps. The client is created when leaving step 2, so the mailbox OAuth round-trip has an entity to attach to;
 * the page reads ?id=&step= so it resumes where it left off after the provider redirects back. */
export default function OnboardClientPage() {
  const { isAdmin, firmWide, setEntityId, refresh } = useSession()
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  const id = sp.get('id')
  const step = Math.min(Number(sp.get('step') ?? (id ? 3 : 1)), 4)
  const existing = useEntity(id ?? '')
  const { act, pending } = useAct()
  const [c, setC] = useState<EntityInput>(BLANK)
  const [gst, setGst] = useState<GstInput[]>([{ gstin: '', place_of_business: '', filing_frequency: 'monthly', einvoice_applicable: true }])
  const [touched, setTouched] = useState(false)
  const mailboxes = useMailboxes(id ?? '').data ?? []

  useEffect(() => { // resume after the OAuth redirect or a reload
    const e = existing.data
    if (!e) return
    setC({ legal_name: e.name, short_name: e.shortName, city: e.city, pan: e.pan, tan: e.tan, cin: e.cin, sap_company_code: e.sapCompanyCode, einvoice_band: e.einvoiceBand, msme_status: e.msmeStatus, fy_start_month: e.fyStartMonth })
    setGst(e.gstins.map(g => ({ gstin: g.gstin, place_of_business: g.placeOfBusiness, filing_frequency: g.filingFrequency, einvoice_applicable: g.einvoiceApplicable })))
  }, [existing.data])

  useEffect(() => { // result of the mailbox OAuth round-trip
    const ok = sp.get('mailbox'), err = sp.get('mailbox_error')
    if (!ok && !err) return
    if (ok) toast.success(`Connected ${sp.get('address')}. First check is running.`)
    else toast.error(err)
    const next = new URLSearchParams(sp)
    ;['mailbox', 'mailbox_error', 'address'].forEach(k => next.delete(k))
    setSp(next, { replace: true })
  }, [sp, setSp])

  const go = (s: number, newId = id) => setSp(newId ? { id: newId, step: String(s) } : { step: String(s) })

  if (!(isAdmin || firmWide)) return <><PageHeader title="Onboard a client" crumbs={[{ label: 'Settings', to: '/settings' }]} /><Card><Restricted>Only a firm admin or partner can onboard new clients.</Restricted></Card></>

  const companyOk = !Object.keys(companyErrors(c)).length
  const gstErr = gst.length ? gstinRowError(gst, c.pan) : 'Add at least one GSTIN'

  async function saveGst() {
    setTouched(true)
    if (gstErr) return
    const body = { ...c, gstins: gst }
    const e = id ? await act(() => api.updateEntity(id, { ...body, pan: undefined })) : await act(() => api.createEntity(body), 'Client created · now connect their invoice mailbox')
    if (e) { refresh(); go(3, e.id) }
  }

  return (
    <>
      <PageHeader title="Onboard a client" sub={id ? c.legal_name : 'Company details, GST registrations and the invoice mailbox'} crumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Clients', to: '/settings' }]} />
      <ol className="mb-4 flex flex-wrap gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={step === i + 1 ? 'step' : undefined}
            className={cn('flex items-center gap-2 rounded-full border px-3 py-1 text-xs', step === i + 1 ? 'border-acc bg-acc-weak font-medium text-acc' : step > i + 1 ? 'border-border text-text-2' : 'border-border text-text-3')}>
            <span className={cn('grid size-5 place-items-center rounded-full text-[11px]', step > i + 1 ? 'bg-ok text-white' : step === i + 1 ? 'bg-acc text-on-acc' : 'bg-surface-3')}>{step > i + 1 ? <Check className="size-3" /> : i + 1}</span>{s}
          </li>
        ))}
      </ol>

      <div className="max-w-[860px]">
        {step === 1 && (
          <Card>
            <CardHeader title="Company" as="h3" />
            <CardBody className="flex flex-col gap-4">
              <CompanyFields c={c} set={setC} show={touched} lockPan={!!id} />
              <div className="flex justify-end gap-2"><Button onClick={() => nav('/settings')}>Cancel</Button>
                <Button variant="default" onClick={() => { setTouched(true); if (companyOk) go(2) }}>Next<ArrowRight /></Button></div>
            </CardBody>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardHeader title="GST registrations" as="h3"><span className="text-[11px] text-text-3">One GSTIN per state the client is registered in</span></CardHeader>
            <CardBody className="flex flex-col gap-4">
              <GstinEditor rows={gst} set={setGst} pan={c.pan} />
              {touched && gstErr && <Banner tone="bad" role="alert">{gstErr}</Banner>}
              <div className="flex justify-between gap-2"><Button onClick={() => go(1)}><ArrowLeft />Back</Button>
                <Button variant="default" disabled={pending} onClick={saveGst}>{id ? 'Save and continue' : 'Create client and continue'}<ArrowRight /></Button></div>
            </CardBody>
          </Card>
        )}

        {step === 3 && id && (
          <div className="flex flex-col gap-4">
            {mailboxes.length ? <MailboxesCard entityId={id} ret={`/settings/clients/new?id=${id}&step=3`} /> : (
              <Card>
                <CardHeader title="Invoice mailbox" as="h3" />
                <CardBody className="flex flex-col gap-3">
                  <p className="text-xs text-text-2">Sign in to the mailbox suppliers send invoices to (for example ap@{c.short_name.toLowerCase().replace(/[^a-z]+/g, '') || 'client'}.in). You will be sent to Google or Microsoft and brought back here.</p>
                  <ConnectMailbox entityId={id} ret={`/settings/clients/new?id=${id}&step=3`} />
                </CardBody>
              </Card>
            )}
            <div className="flex justify-between gap-2"><Button onClick={() => go(2)}><ArrowLeft />Back</Button>
              <Button variant="default" onClick={() => go(4)}>{mailboxes.length ? 'Next' : 'Skip for now'}<ArrowRight /></Button></div>
          </div>
        )}

        {step === 4 && id && (
          <Card>
            <CardHeader title="Review & activate" as="h3" />
            <CardBody className="flex flex-col gap-4">
              <KV items={[['Legal name', c.legal_name], ['PAN', <span className="font-mono">{c.pan}</span>], ['TAN', c.tan || '—'], ['CIN / LLPIN', c.cin || '—'],
                ['GSTINs', <span className="flex flex-wrap gap-1.5">{gst.map(g => <Gstin key={g.gstin} g={g.gstin} />)}</span>],
                ['Invoice mailbox', mailboxes.length ? mailboxes.map(m => m.address).join(', ') : 'Not connected yet'], ['SAP company code', c.sap_company_code || 'Not set']]} />
              <Banner tone="info">Activating makes the client available to its team. SAP, GST portal and bank feeds are connected later from the client page.</Banner>
              <div className="flex justify-between gap-2"><Button onClick={() => go(3)}><ArrowLeft />Back</Button>
                <Button variant="default" disabled={pending} onClick={async () => {
                  if (await act(() => api.activateEntity(id), `${c.short_name} is active`)) { refresh(); setEntityId(id); nav(`/settings/clients/${id}`) }
                }}><Check />Activate client</Button></div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  )
}
