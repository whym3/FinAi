import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowRight, Download, ExternalLink, File, Lock, Mail, Plus, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Avatar, Bar, Card, CardBody, CardHeader, Chip, DocumentDrawer, KV, MsmeBadge, Gstin, PageHeader, Pill, Q, Source, StatusPill, TimelineStage, OkIcon, BadIcon, NoneIcon,
} from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useInvoices, usePO, useVendors } from '@/mock/hooks'
import * as api from '@/mock/api'
import { date, dateTime, daysBetween, daysFromNow, inr, todayIso } from '@/lib/format'
import { AskVendorDialog } from '@/features/intake/IntakePage'
import { cn } from '@/lib/utils'

export default function P2PPage() {
  const { poId = '' } = useParams()
  const q = usePO(poId)
  const vendors = useVendors().data ?? []
  const invoices = useInvoices().data ?? []
  const { users, user, readOnly } = useSession()
  const { act } = useAct()
  const nav = useNavigate()
  const [doc, setDoc] = useState<number | null>(null)
  const [ask, setAsk] = useState(false)
  const [add, setAdd] = useState(false)
  const [title, setTitle] = useState('Delivery challan')
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <Q q={q}>{po => {
      const v = vendors.find(x => x.id === po.vendorId)
      const inv = invoices.find(i => i.id === po.invoiceId)
      const cur = po.stages.findIndex(s => s.state === 'cur' || s.state === 'blk')
      const line = po.lines[0]
      const invTax = po.invoicedTaxable
      const msme = po.msme
      const left = msme ? daysFromNow(msme.limitOn) : 0
      const used = msme ? Math.round((daysBetween(msme.acceptedOn, todayIso()) / 45) * 100) : 0
      const buyer = users.find(u => u.id === po.buyerId)
      const approver = users.find(u => u.id === po.negotiation.approvedBy)
      return (
        <>
          <PageHeader crumbs={[{ label: 'Purchase-to-pay', to: '/p2p' }, { label: v?.name ?? '' , to: v ? '/vendors/' + v.id : undefined }, { label: 'PO ' + po.id }]}
            title={'PO ' + po.id}
            badges={<>{cur >= 0 && <StatusPill tone={po.stages[cur].state === 'blk' ? 'bad' : 'acc'}>Stage {cur + 1} of 9 · {po.stages[cur].name}</StatusPill>}{v?.msme && <MsmeBadge cls={v.msme} udyam />}</>}
            meta={<>
              <span className="font-medium text-text">{v?.name}</span>
              {v && <Gstin g={v.gstin} state={`${v.gstin.slice(0, 2)} · Maharashtra`} />}
              <span>PO value <span className="font-medium text-text">{inr(po.value)}</span> incl. GST</span>
              <span>Buyer {buyer?.name}</span><span>Plant {po.plant}</span>
              <Source name="SAP" syncKey="sap" />
            </>}
            actions={<>
              <Button onClick={() => window.open(`https://sap.example/ME23N?po=${po.id}`, '_blank', 'noopener')}><ExternalLink />Open in SAP (ME23N)</Button>
              <Button disabled={readOnly} onClick={() => setAdd(true)}><Plus />Add document</Button>
              <Button disabled={readOnly} onClick={() => setAsk(true)}><Send />Ask vendor</Button>
              {inv && <Button variant="default" onClick={() => nav('/review/' + inv.id)}>Review invoice<ArrowRight /></Button>}
            </>} />

          <Card aria-label="Order timeline">
            <CardHeader title="Order timeline">
              <span className="flex flex-wrap gap-3 text-[11px] text-text-2">
                <span className="flex items-center gap-1"><OkIcon className="text-ok" />Done</span>
                <span className="flex items-center gap-1"><span className="size-2.5 rounded-full border-2 border-acc" />Current</span>
                <span className="flex items-center gap-1"><BadIcon className="text-bad" />Blocked</span>
                <span className="flex items-center gap-1"><NoneIcon className="text-none" />Not started</span>
              </span>
              <span className="text-xs text-text-2">Elapsed {po.elapsedDays} days · {po.health}</span>
            </CardHeader>
            <div className="overflow-auto p-4"><div className="grid min-w-[1180px] grid-cols-9">{po.stages.map((s, i) => <TimelineStage key={s.key} s={s} last={i === po.stages.length - 1} />)}</div></div>
          </Card>

          <div className="flex flex-wrap items-start gap-4">
            <div className="flex min-w-0 flex-[2_1_640px] flex-col gap-4">
              <Card aria-label="Line ledger">
                <CardHeader title="Line ledger"><Source name="SAP" text="EKBE history · 10 min ago" /></CardHeader>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] border-b border-border">
                  {[
                    ['Ordered', line.ordered, `${inr(po.taxable)} taxable`, 100, 'ok' as const, ''],
                    ['Received & accepted', line.accepted, po.sap.grn ? `GRN ${po.sap.grn} · QC passed` : 'No GRN yet', (line.accepted / line.ordered) * 100, line.accepted ? 'ok' as const : 'bad' as const, ''],
                    ['Invoiced', line.invoiced, invTax ? `${inr(invTax)} taxable${invTax > po.taxable ? ' · ' + inr(invTax - po.taxable) + ' above PO' : ''}` : 'Not invoiced', (line.invoiced / line.ordered) * 100, invTax > po.taxable ? 'warn' as const : 'ok' as const, invTax > po.taxable ? 'text-warn font-medium' : ''],
                    ['Paid', line.paid, `₹0.00${po.agreedDue ? ' · agreed due ' + date(po.agreedDue) : ''}`, (line.paid / line.ordered) * 100, 'ok' as const, ''],
                  ].map(([l, n, sub, pct, tone, cls]) => (
                    <div key={l as string} className="border-r border-border px-4 py-3 last:border-r-0">
                      <div className="text-[11px] font-medium text-text-2">{l}</div>
                      <div className="text-[22px] leading-7 font-semibold">{(n as number).toLocaleString('en-IN')} <span className="text-xs font-normal text-text-2">{line.uom}</span></div>
                      <div className={cn('text-[11px] text-text-3', cls as string)}>{sub}</div>
                      <Bar pct={pct as number} tone={tone as 'ok' | 'warn' | 'bad'} className="mt-1.5" />
                    </div>
                  ))}
                </div>
                <div className="overflow-auto">
                  <table className="w-full border-separate border-spacing-0 text-[12.5px] [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:whitespace-nowrap [&_th]:text-text-2">
                    <thead><tr><th>Line</th><th>Material</th>{['PO rate', 'Ordered', 'Received', 'Accepted', 'Invoiced', 'Posted', 'Paid', 'Open value'].map(h => <th key={h} className="text-right!">{h}</th>)}</tr></thead>
                    <tbody>{po.lines.map(l => (
                      <tr key={l.line}>
                        <td className="font-mono">{l.line}</td>
                        <td><div className="font-medium">{l.material}</div><div className="text-[11px] text-text-3">Material {l.materialNo} · HSN {l.hsn} · UoM {l.uom}</div></td>
                        <td className="text-right tabular-nums">{inr(l.rate)}</td>
                        {[l.ordered, l.received, l.accepted, l.invoiced, l.posted, l.paid].map((n, i) => <td key={i} className={cn('text-right tabular-nums', !n && 'text-text-3')}>{n.toLocaleString('en-IN')}</td>)}
                        <td className="text-right font-medium tabular-nums">{inr(po.value - (l.paid / l.ordered) * po.value)}</td>
                      </tr>
                    ))}</tbody>
                    {po.freightInvoiced ? <tfoot className="[&_td]:bg-surface-2 [&_td]:font-semibold"><tr><td /><td>Freight</td><td className="text-right">FOR · incl.</td><td className="text-right">—</td><td className="text-right">—</td><td className="text-right">—</td><td className="text-right text-warn">{inr(po.freightInvoiced)}</td><td className="text-right">—</td><td className="text-right">—</td><td className="text-right">—</td></tr></tfoot> : null}
                  </table>
                </div>
              </Card>

              <Card aria-label="Documents and evidence">
                <CardHeader title="Documents & evidence"><span className="text-[11px] text-text-3">{po.docs.length} documents · click a row to open it in the side viewer</span><Button size="sm" onClick={() => window.print()}><Download />Print all</Button></CardHeader>
                <div className="overflow-auto">
                  <table className="w-full border-separate border-spacing-0 text-[12.5px] [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:text-text-2">
                    <thead><tr><th>Document</th><th>Number</th><th>Date</th><th>Source</th><th>Linked by</th><th>Check</th></tr></thead>
                    <tbody>{po.docs.map((d, i) => (
                      <tr key={d.id} className="cursor-pointer hover:[&>td]:bg-surface-2" onClick={() => setDoc(i)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setDoc(i)}>
                        <td><span className="flex items-center gap-1.5"><File className="size-4 text-text-2" /><span className="font-medium">{d.title}</span></span></td>
                        <td className="font-mono whitespace-nowrap">{d.number}</td><td className="whitespace-nowrap">{d.date}</td>
                        <td><Source name={d.source} text="" /></td><td className="text-text-2">{d.linkedBy}</td><td><Pill s={d.check} /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </Card>
            </div>

            <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
              <Card aria-label="Negotiation record">
                <CardHeader title="Negotiation record"><Chip><Lock className="size-3" />{po.negotiation.locked ? 'Locked' : 'Open'} · version {po.negotiation.current.version}</Chip></CardHeader>
                <CardBody className="flex flex-col gap-3">
                  <KV items={[
                    ['Rate', <><b>{inr(po.negotiation.current.rate)}</b> per piece ({line.uom})</>],
                    ['Freight', po.negotiation.current.freight],
                    ['Payment terms', po.negotiation.current.terms],
                    ['Delivery', po.negotiation.delivery],
                    ['Price valid till', po.negotiation.validTill],
                    ['GST', po.negotiation.gst],
                    ['Approved by', <><span className="flex items-center gap-1.5"><Avatar id={po.negotiation.approvedBy} size="sm" />{approver?.name}, {approver?.title}</span><span className="text-[11px] text-text-3">{dateTime(po.negotiation.approvedAt)} · via {po.negotiation.approvedVia}</span></>],
                  ]} />
                  <div className="flex flex-wrap gap-1.5">
                    <Chip><File className="size-3" />Quote {po.negotiation.quoteRef}</Chip>
                    <Chip><Mail className="size-3" />Approval email</Chip>
                    <Source name="Extracted" text={`confirmed by ${buyer?.name.split(' ').map((p, i) => i ? p : p[0] + '.').join(' ')}`} />
                  </div>
                  {po.negotiation.history.map(h => <div key={h.version} className="border-t border-border pt-2 text-[11px] text-text-3">Superseded v{h.version} ({date(h.date)}): {inr(h.rate)} per piece, {h.freight.toLowerCase()}, {h.terms}. {h.note}</div>)}
                </CardBody>
              </Card>

              {msme && (
                <Card aria-label="Payment and MSME clock">
                  <CardHeader title="Payment clock">{v?.msme && <MsmeBadge cls={v.msme} />}</CardHeader>
                  <CardBody className="flex flex-col gap-2.5">
                    <div className="flex items-baseline justify-between"><span className="text-xs text-text-2">MSMED Act 45-day limit</span><span><span className="text-lg font-semibold">{left}</span> <span className="text-xs text-text-2">days left</span></span></div>
                    <Bar pct={used} tone={left <= 7 ? 'bad' : left <= 15 ? 'warn' : 'ok'} />
                    <div className="flex justify-between text-[11px] text-text-3"><span>Accepted {date(msme.acceptedOn)}</span><span>Limit {date(msme.limitOn)}</span></div>
                    <KV items={[
                      ['Agreed due date', <>{date(po.agreedDue)} <span className="text-[11px] text-text-3">30 days from invoice</span></>],
                      ...(msme.invoiceAsks ? [['Invoice asks', <><span className="font-medium text-warn">{date(msme.invoiceAsks)}</span> <span className="text-[11px] text-text-3">15 days — not agreed</span></>] as [React.ReactNode, React.ReactNode]] : []),
                      ['Udyam', <><span className="font-mono text-[11px]">{v?.udyam}</span><div className="flex items-center gap-1 text-[11px] text-ok"><OkIcon size={12} />Verified {date(v?.udyamVerifiedOn)}</div></>],
                    ]} />
                    <div className="rounded-md bg-surface-2 px-2.5 py-2 text-[11px] text-text-2">Section 43B(h): if unpaid after {date(msme.limitOn)}, the expense is disallowed for FY 2026-27 until the year it is paid.</div>
                  </CardBody>
                </Card>
              )}

              <Card aria-label="SAP references">
                <CardHeader title="SAP references"><Source name="SAP" syncKey="sap" /></CardHeader>
                <CardBody>
                  <KV items={[
                    ['Company code', <span className="font-mono">1000 · Meridian Auto</span>],
                    ['Vendor', <Link to={'/vendors/' + po.vendorId} className="font-mono">{po.vendorId}</Link>],
                    ['Purchase order', <span className="font-mono">{po.id} <span className="text-text-3">ME23N</span></span>],
                    ['Gate entry', po.sap.gateEntry ? <span className="font-mono">{po.sap.gateEntry}</span> : <StatusPill tone="none">Not recorded</StatusPill>],
                    ['Goods receipt', po.sap.grn ? <span className="font-mono">{po.sap.grn} <span className="text-text-3">MIGO 101</span></span> : <StatusPill tone="bad">Missing</StatusPill>],
                    ['Invoice document', po.sap.invoiceDoc ? <span className="font-mono">{po.sap.invoiceDoc} <span className="text-text-3">MIRO</span></span> : <StatusPill tone="none">Not posted</StatusPill>],
                    ['Payment / UTR', po.sap.utr ? <span className="font-mono">{po.sap.utr}</span> : <StatusPill tone="none">Not paid</StatusPill>],
                  ]} />
                </CardBody>
              </Card>
            </div>
          </div>

          <DocumentDrawer docs={po.docs} index={doc} onIndex={setDoc} kicker={'linked to PO ' + po.id} />
          <AskVendorDialog open={ask} onOpenChange={setAsk} to={v?.email ?? ''} subject={`PO ${po.id}: query`} body={`Dear ${v?.name},\n\nRegarding PO ${po.id}:\n\n- \n\nRegards,\n${user.name}`} />
          <Dialog open={add} onOpenChange={setAdd}>
            <DialogContent>
              <DialogHeader><DialogTitle>Add document to PO {po.id}</DialogTitle><DialogDescription>The file is stored with the PO evidence and appears in the audit log.</DialogDescription></DialogHeader>
              <label className="text-xs font-medium text-text-2">Document type<Input className="mt-1" value={title} onChange={e => setTitle(e.target.value)} list="doc-types" /></label>
              <datalist id="doc-types">{['Delivery challan', 'Lorry receipt', 'QC report', 'Gate pass', 'Credit note', 'Vendor letter'].map(t => <option key={t} value={t} />)}</datalist>
              <input ref={fileRef} type="file" className="text-xs" />
              <DialogFooter><Button variant="ghost" onClick={() => setAdd(false)}>Cancel</Button><Button variant="default" onClick={async () => { const f = fileRef.current?.files?.[0]; if (!f) return; if (await act(() => api.addPoDocument(po.id, title, f.name, user.id), `${title} added`)) setAdd(false) }}><Plus />Add</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )
    }}</Q>
  )
}
