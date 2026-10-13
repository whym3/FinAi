import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Check, ChevronLeft, ChevronRight, Columns3, Copy, Database, Filter, Link2, Mail, Mailbox, MessageCircle, Pencil, Send, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Banner, BulkBar, Card, Chip, Confidence, DataTable, DocumentViewer, EmptyState, FieldRow, FilterChip, LineTabs, MsmeBadge, PageHeader, Paper, Pill, Q, Source, Spacer, StatusPill, Restricted,
} from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useIntake, usePOs, useVendors } from '@/mock/hooks'
import * as api from '@/mock/api'
import { dateTime, daysBetween, inr, num2, todayIso } from '@/lib/format'
import type { Channel, ExtractedField, IntakeDoc, IntakeStatus, Status } from '@/lib/types'
import { cn } from '@/lib/utils'

const TABS: { value: 'all' | IntakeStatus; label: string; tone?: 'acc' | 'warn' }[] = [
  { value: 'all', label: 'All' }, { value: 'new', label: 'New', tone: 'acc' }, { value: 'review', label: 'Needs review', tone: 'warn' },
  { value: 'linked', label: 'Linked' }, { value: 'duplicate', label: 'Duplicate' }, { value: 'notfinance', label: 'Not finance' }, { value: 'rejected', label: 'Rejected' },
]
const CH_ICON: Record<Channel, typeof Mail> = { Email: Mail, WhatsApp: MessageCircle, Post: Mailbox, Upload, SAP: Database }

export function docStatus(d: IntakeDoc): Status {
  switch (d.status) {
    case 'new': return { tone: 'acc', label: d.statusNote ?? 'New' }
    case 'review': return { tone: 'warn', label: d.statusNote ?? 'Needs review' }
    case 'linked': return { tone: 'ok', label: 'Linked' + (d.linkedPoId ? ' · PO ' + d.linkedPoId : '') }
    case 'duplicate': return { tone: 'none', label: 'Duplicate' }
    case 'notfinance': return { tone: 'none', label: 'Not finance' }
    case 'rejected': return { tone: 'bad', label: 'Rejected' + (d.statusNote ? ' · ' + d.statusNote : '') }
  }
}

export default function IntakePage() {
  const q = useIntake()
  const { entity, user, readOnly } = useSession()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') ?? (sp.get('doc') ? 'all' : 'new')) as 'all' | IntakeStatus
  const docId = sp.get('doc')
  const set = (k: string, v: string | null) => setSp(p => { const n = new URLSearchParams(p); if (v == null) n.delete(k); else n.set(k, v); return n }, { replace: true })
  const [recent, setRecent] = useState(false)
  const [lowConf, setLowConf] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [vendors, setVendors] = useState<string[]>([])
  const [whatsapp, setWhatsapp] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { act } = useAct()

  const all = q.data ?? []
  const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.value, t.value === 'all' ? all.length : all.filter(d => d.status === t.value).length])), [all])
  const filtered = all.filter(d =>
    (tab === 'all' || d.status === tab) &&
    (!recent || daysBetween(d.receivedAt, todayIso()) <= 1) &&
    (!lowConf || (d.confidence != null && d.confidence < 80)) &&
    (!channels.length || channels.includes(d.channel)) &&
    (!types.length || types.includes(d.type)) &&
    (!vendors.length || vendors.includes(d.vendorName)))
  const selected = all.find(d => d.id === docId) ?? null
  const idx = selected ? filtered.findIndex(d => d.id === selected.id) : -1

  const columns = useMemo<ColumnDef<IntakeDoc, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { accessorKey: 'channel', header: 'Channel', cell: ({ row: { original: d } }) => { const I = CH_ICON[d.channel]; return <span className="flex items-center gap-1.5 whitespace-nowrap"><I className="size-4 text-text-2" />{d.channel}</span> } },
    { accessorKey: 'receivedAt', header: 'Received', cell: ({ getValue }) => <span className="whitespace-nowrap">{dateTime(getValue())}</span> },
    { accessorKey: 'from', header: 'Sender', cell: ({ getValue }) => <span className="block max-w-[210px] truncate text-xs">{getValue()}</span> },
    { accessorKey: 'type', header: 'Detected type', cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue()}</span> },
    { accessorKey: 'vendorName', header: 'Vendor', cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { accessorKey: 'docNo', header: 'Invoice no.', cell: ({ getValue }) => <span className="font-mono whitespace-nowrap">{getValue()}</span> },
    { accessorKey: 'amount', header: 'Amount', meta: { num: true }, cell: ({ getValue }) => getValue() == null ? '—' : <span className={cn(getValue() < 0 && 'text-bad')}>{inr(getValue())}</span> },
    { accessorKey: 'confidence', header: 'Confidence', cell: ({ getValue }) => <Confidence value={getValue()} /> },
    { id: 'status', header: 'Status', accessorFn: d => d.status, cell: ({ row: { original: d } }) => <Pill s={docStatus(d)} /> },
    { id: 'size', header: 'Pages · size', meta: { hidden: true, label: 'Pages · size' }, accessorFn: d => d.sizeKb, cell: ({ row: { original: d } }) => <span className="text-xs text-text-2">{d.pages} p · {d.sizeKb} KB</span> },
  ], [])

  const multi = <T extends string>(label: string, opts: T[], val: T[], setVal: (v: T[]) => void) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><FilterChip on={val.length > 0}>{label}{val.length > 0 && ` · ${val.length}`}</FilterChip></DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {opts.map(o => <DropdownMenuCheckboxItem key={o} checked={val.includes(o)} onSelect={e => e.preventDefault()} onCheckedChange={c => setVal(c ? [...val, o] : val.filter(x => x !== o))}>{o}</DropdownMenuCheckboxItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    await act(() => api.uploadDocs(entity.id, [...files].map(f => ({ name: f.name, size: f.size })), user.id), r => `${r.length} document${r.length > 1 ? 's' : ''} queued for extraction`)
    set('tab', 'new')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <>
      <PageHeader title="Intake inbox" sub={`Every document that reaches ${entity.shortName} — email, post, WhatsApp, uploads and SAP. Last mailbox fetch 2 min ago.`}
        actions={<>
          <Chip><Mail className="size-3.5" /><span className="font-mono">{entity.intakeEmail}</span>
            <button type="button" aria-label="Copy forwarding address" className="grid size-5 cursor-pointer place-items-center rounded-sm hover:bg-surface-3" onClick={() => { navigator.clipboard?.writeText(entity.intakeEmail); toast.success('Forwarding address copied') }}><Copy className="size-3" /></button>
          </Chip>
          <Button onClick={() => setWhatsapp(true)}><MessageCircle />WhatsApp number</Button>
          <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.xml,.json" className="hidden" onChange={e => onUpload(e.target.files)} />
          <Button variant="default" disabled={readOnly} onClick={() => fileRef.current?.click()}><Upload />Upload documents</Button>
        </>} />

      <LineTabs label="Status" value={tab} onChange={v => setSp({ tab: v }, { replace: true })} items={TABS.map(t => ({ value: t.value, label: t.label, count: counts[t.value], tone: t.tone }))} />

      <Q q={q}>{() => (
        <>
          <DataTable id="intake" data={filtered} columns={columns} getRowId={d => d.id} selectable maxHeight={432}
            activeId={selected?.id} onRowClick={d => set('doc', d.id)} initialSort={[{ id: 'receivedAt', desc: true }]}
            toolbar={<>
              <FilterChip on={recent} onClick={() => setRecent(r => !r)} icon={<Filter className="size-3.5" />}>Received: today and yesterday</FilterChip>
              {multi('Channel', ['Email', 'WhatsApp', 'Post', 'Upload', 'SAP'] as Channel[], channels, setChannels)}
              {multi('Detected type', [...new Set(all.map(d => d.type))], types, setTypes)}
              {multi('Vendor', [...new Set(all.map(d => d.vendorName).filter(v => v !== '—'))], vendors, setVendors)}
              <FilterChip on={lowConf} onClick={() => setLowConf(l => !l)}>Confidence below 80%</FilterChip>
              <span className="text-[11px] text-text-3">Showing {filtered.length} of {all.length} · newest first</span>
            </>}
            bulk={(rows, clear) => (
              <BulkBar>
                <span className="font-medium">{rows.length} selected</span>
                <Spacer />
                <Button size="sm" disabled={readOnly} onClick={async () => { for (const r of rows) await api.setIntakeStatus(r.id, 'notfinance', user.id); clear(); act(async () => null, `${rows.length} marked not finance`) }}>Not finance</Button>
                <Button size="sm" disabled={readOnly} onClick={async () => { for (const r of rows) await api.setIntakeStatus(r.id, 'new', user.id); clear(); act(async () => null, `${rows.length} moved back to New`) }}>Move to New</Button>
                <Button size="icon-sm" aria-label="Clear selection" onClick={clear}><X /></Button>
              </BulkBar>
            )}
            empty={<EmptyState title={tab === 'new' ? 'Nothing waiting for review' : 'No documents here'} action={<Button size="sm" onClick={() => fileRef.current?.click()}><Upload />Upload documents</Button>}>New documents from email, WhatsApp, post, uploads and SAP appear here as they arrive.</EmptyState>} />

          {selected && <ReviewPanel key={selected.id} d={selected} all={all} pos={idx >= 0 ? `${idx + 1} of ${filtered.length}` : ''}
            prev={idx > 0 ? () => set('doc', filtered[idx - 1].id) : undefined} next={idx >= 0 && idx < filtered.length - 1 ? () => set('doc', filtered[idx + 1].id) : undefined}
            onClose={() => set('doc', null)} />}
        </>
      )}</Q>

      <Dialog open={whatsapp} onOpenChange={setWhatsapp}>
        <DialogContent>
          <DialogHeader><DialogTitle>WhatsApp intake number</DialogTitle><DialogDescription>Vendors and staff can send invoices, challans and lorry receipts as photos or PDFs to this number.</DialogDescription></DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-3"><MessageCircle className="size-5 text-ok" /><span className="font-mono text-base">{entity.whatsapp}</span><Spacer /><Button size="sm" onClick={() => { navigator.clipboard?.writeText(entity.whatsapp); toast.success('Number copied') }}><Copy />Copy</Button></div>
          <ul className="list-disc pl-5 text-xs text-text-2"><li>One document per message works best; multi-page PDFs are fine.</li><li>Photos are de-skewed; low-confidence fields are flagged for review.</li><li>Copies of documents already received by email are detected as duplicates.</li></ul>
        </DialogContent>
      </Dialog>
    </>
  )
}

const TOTAL_KEYS = ['taxable', 'cgst', 'sgst', 'igst', 'total', 'bank', 'terms']

function ReviewPanel({ d, all, pos, prev, next, onClose }: { d: IntakeDoc; all: IntakeDoc[]; pos: string; prev?: () => void; next?: () => void; onClose: () => void }) {
  const { user, readOnly } = useSession()
  const vendor = useVendors().data?.find(v => v.id === d.vendorId)
  const { act, pending } = useAct()
  const [focus, setFocus] = useState<string | undefined>()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [compare, setCompare] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const twin = all.find(x => x.id !== d.id && x.docNo === d.docNo && x.vendorId === d.vendorId && d.docNo !== '—')
  const isDupOfTwin = d.status === 'duplicate' && twin
  const fields = d.fields
  const head = fields.filter(f => !TOTAL_KEYS.includes(f.key))
  const tail = fields.filter(f => TOTAL_KEYS.includes(f.key))
  const low = fields.filter(f => f.confidence < 90 && !f.confirmedBy).length
  const done = d.status === 'linked' || d.status === 'duplicate' || d.status === 'notfinance' || d.status === 'rejected'
  const disabled = readOnly || pending

  const show = (f: ExtractedField) => f.num ? inr(Number(f.value)) : f.key === 'date' ? f.value.split('-').reverse().join('-') : f.value
  const fieldRow = (f: ExtractedField) => (
    <FieldRow key={f.key} f={f} on={focus === f.key} onClick={() => setFocus(f.key)}
      value={editing === f.key ? (
        <form className="flex w-full items-center gap-1" onSubmit={e => { e.preventDefault(); act(() => api.editField(d.id, f.key, f.num ? String(Number(draft.replace(/[₹,\s]/g, ''))) : draft, user.id), `${f.label} updated`); setEditing(null) }} onClick={e => e.stopPropagation()}>
          <Input autoFocus value={draft} onChange={e => setDraft(e.target.value)} className="h-6 flex-1 px-1.5 text-xs" aria-label={f.label} />
          <Button size="icon-xs" type="submit" aria-label="Save"><Check /></Button>
          <Button size="icon-xs" type="button" aria-label="Cancel" onClick={() => setEditing(null)}><X /></Button>
        </form>
      ) : <>
        <span className={cn('min-w-0 break-words', f.mono && 'font-mono text-[12px]')}>{show(f)}</span>
        {f.check && <span className={cn('flex items-center gap-1 text-[11px] font-medium', { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', none: 'text-text-3', acc: 'text-acc' }[f.check.tone])}>{f.check.label}</span>}
        {f.key === 'irn' && f.confidence < 90 && !f.confirmedBy && <Button size="xs" disabled={disabled} onClick={e => { e.stopPropagation(); act(() => api.editField(d.id, 'irn', f.value, user.id), 'IRN verified on IRP: signed QR matches') }}>Verify on IRP</Button>}
        {!done && !readOnly && <button type="button" aria-label={`Edit ${f.label}`} className="ml-auto grid size-5 flex-none cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-surface-3 hover:text-text" onClick={e => { e.stopPropagation(); setDraft(show(f)); setEditing(f.key) }}><Pencil className="size-3" /></button>}
      </>} />
  )

  return (
    <Card aria-label="Review selected document">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <div className="mr-auto flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2"><h2>{d.docNo === '—' ? d.type : d.docNo}</h2><Pill s={docStatus(d)} />{vendor?.msme && <MsmeBadge cls={vendor.msme} udyam />}</div>
          <div className="text-[11px] text-text-3">{d.vendorName} · {d.channel === 'Email' ? 'emailed' : d.channel === 'WhatsApp' ? 'sent on WhatsApp' : d.channel === 'Post' ? 'received by post' : d.channel === 'SAP' ? 'from SAP' : 'uploaded'} by {d.from} on {dateTime(d.receivedAt)} · {d.pages} page{d.pages > 1 ? 's' : ''}, {d.sizeKb} KB</div>
        </div>
        <Button size="icon" className="border-border-2 bg-surface" aria-label="Previous document" disabled={!prev} onClick={prev}><ChevronLeft /></Button>
        <span className="text-[11px] text-text-3">{pos}</span>
        <Button size="icon" className="border-border-2 bg-surface" aria-label="Next document" disabled={!next} onClick={next}><ChevronRight /></Button>
        <Button size="icon" aria-label="Close review panel" onClick={onClose}><X /></Button>
      </div>

      {twin && !done && (
        <div className="px-4 pt-3">
          <Banner tone="warn" role="alert" icon={<Copy className="size-4" />} actions={<>
            <Button size="sm" onClick={() => setCompare(true)}><Columns3 />Compare side by side</Button>
            <Button size="sm" disabled={disabled} onClick={() => act(() => api.keepOriginal(d.id, user.id), `${twin.channel} copy marked duplicate`)}>Keep this, mark {twin.channel} copy duplicate</Button>
          </>}>
            <b>Possible duplicate.</b> The same invoice — supplier GSTIN {vendor?.gstin}, invoice no. {d.docNo}, total {d.amount != null ? inr(d.amount) : '—'} — also arrived by {twin.channel} from {twin.from} at {dateTime(twin.receivedAt).slice(11)}. {twin.confidence != null && `The ${twin.channel} copy has ${twin.confidence}% confidence.`}
          </Banner>
        </div>
      )}
      {isDupOfTwin && (
        <div className="px-4 pt-3">
          <Banner tone="info" actions={<><Button size="sm" onClick={() => setCompare(true)}><Columns3 />Compare</Button><Button size="sm" disabled={disabled} onClick={() => act(() => api.setIntakeStatus(d.id, 'new', user.id), 'Moved back to New')}>Not a duplicate</Button></>}>
            Duplicate of the {twin.channel.toLowerCase()} copy received {dateTime(twin.receivedAt)}. It is kept for the audit trail and will not be posted.
          </Banner>
        </div>
      )}

      {!d.paper ? (
        <div className="p-4"><EmptyState title={d.channel === 'SAP' ? 'Document came from SAP' : d.statusNote ?? 'No preview'} icon={d.channel === 'SAP' ? <Database className="size-5" /> : undefined}>
          {d.channel === 'SAP' ? `Parked in SAP as ${d.from}. Linked to PO ${d.linkedPoId ?? '—'}; it follows the review queue.` : d.status === 'notfinance' ? 'Marked as not a finance document. It stays here for 90 days.' : 'Extraction runs as soon as the file is processed; fields and a preview will appear here.'}
        </EmptyState></div>
      ) : (
        <div className="flex flex-wrap items-stretch gap-4 px-4 pt-3 pb-4">
          <div className="min-w-0 flex-[1_1_540px]">
            <DocumentViewer doc={d.paper} label={`Original · ${d.channel === 'WhatsApp' ? 'photo' : 'PDF'}`} source={<Source name={d.channel} text={dateTime(d.receivedAt)} />} focus={focus} onPick={setFocus} />
          </div>
          <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3>Extracted fields</h3>
              <span className="flex items-center gap-2"><Source name="Extracted" text={`OCR${d.paper.irn ? ' + e-invoice QR' : ''} · ${dateTime(d.receivedAt).slice(11)}`} />{d.confidence != null && <Confidence value={d.confidence}>{d.confidence}% overall</Confidence>}</span>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-text-2">
              <span className="flex items-center gap-1"><span className="h-2.5 w-3.5 rounded-[2px] border-[1.5px] border-dashed border-warn" />Low confidence, not yet confirmed ({low})</span>
              <span>Click a field to see it on the document</span>
            </div>
            <div className="flex flex-col gap-0.5">{head.map(fieldRow)}</div>
            {d.lines.length > 0 && (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full border-separate border-spacing-0 text-[12.5px] [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:text-text-2">
                  <thead><tr><th>Line</th><th>HSN</th><th className="text-right!">Qty</th><th className="text-right!">Rate</th><th className="text-right!">Taxable</th><th>Conf.</th></tr></thead>
                  <tbody>
                    {d.lines.map((l, i) => (
                      <tr key={i} className={cn(focus === 'hsn' && i === 0 && '[&>td]:bg-acc-weak')} onClick={() => i === 0 && setFocus('hsn')}>
                        <td>{l.desc}</td>
                        <td><span className={cn('inline-flex rounded-sm px-1.5 py-px font-mono', l.confidence < 80 && !d.confirmedBy && 'border-[1.5px] border-dashed border-warn bg-warn-bg')}>{l.hsn}</span></td>
                        <td className="text-right tabular-nums">{l.qty.toLocaleString('en-IN')}</td><td className="text-right tabular-nums">{num2(l.rate)}</td><td className="text-right tabular-nums">{num2(l.amount)}</td>
                        <td><Confidence value={d.confirmedBy ? 100 : l.confidence}>{d.confirmedBy ? 'Confirmed' : undefined}</Confidence></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-col gap-0.5">{tail.map(fieldRow)}</div>

            {d.suggestedLink && d.status !== 'linked' && !done && (
              <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
                <Link2 className="size-4 text-acc" />
                <div className="min-w-0 flex-[1_1_220px]"><div className="text-xs font-medium">Suggested link: PO {d.suggestedLink.poId}{d.suggestedLink.grnId && ` · GRN ${d.suggestedLink.grnId}`}</div><div className="text-[11px] text-text-3">{d.suggestedLink.note} · {d.suggestedLink.match}% match{d.suggestedLink.diffs ? ` · ${d.suggestedLink.diffs} difference${d.suggestedLink.diffs > 1 ? 's' : ''} go to Invoice review` : ''}</div></div>
                <Button size="sm" disabled={disabled} onClick={() => act(() => api.linkToPo(d.id, d.suggestedLink!.poId, user.id), `Linked to PO ${d.suggestedLink!.poId} · sent to Invoice review`)}>Link to PO</Button>
              </div>
            )}

            {readOnly ? <Restricted>Your role can view documents but not confirm, link or reject them.</Restricted> : !done ? (
              <>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="default" disabled={disabled || !!d.confirmedBy} onClick={() => act(() => api.confirmFields(d.id, user.id), low ? `Fields confirmed · ${low} low-confidence field${low > 1 ? 's' : ''} logged under your name` : 'Fields confirmed')}><Check />{d.confirmedBy ? 'Fields confirmed' : 'Confirm fields'}</Button>
                  <Button disabled={disabled} onClick={() => setLinkOpen(true)}><Link2 />Link to PO</Button>
                  {twin && <Button disabled={disabled} onClick={() => act(() => api.markDuplicate(d.id, user.id, twin.id), 'Marked duplicate')}><Copy />Mark duplicate</Button>}
                  <Button disabled={disabled} onClick={() => act(() => api.setIntakeStatus(d.id, 'notfinance', user.id), 'Marked not an invoice')}>Not an invoice</Button>
                  <Button disabled={disabled} onClick={() => setAskOpen(true)}><Send />Ask vendor</Button>
                  <Button variant="destructive" disabled={disabled} onClick={() => setRejectOpen(true)}>Reject</Button>
                </div>
                <div className="text-[11px] text-text-3">Confirm stays available with low-confidence fields; each one you accept unchanged is logged with your name in the audit log.</div>
              </>
            ) : d.status === 'linked' && d.invoiceId ? (
              <Banner tone="ok" icon={<Check className="size-4" />} actions={<Button size="sm" asChild><Link to={`/review/${d.invoiceId}`}>Open in Invoice review</Link></Button>}>Linked to PO {d.linkedPoId}. The invoice is in the review queue.</Banner>
            ) : null}
          </div>
        </div>
      )}

      <CompareDialog open={compare} onOpenChange={setCompare} a={d} b={twin} />
      <LinkPoDialog open={linkOpen} onOpenChange={setLinkOpen} d={d} />
      <AskVendorDialog open={askOpen} onOpenChange={setAskOpen} to={vendor?.email ?? d.from} subject={`${d.docNo}: please confirm`}
        body={`Dear ${d.vendorName},\n\nWe received ${d.type.toLowerCase()} ${d.docNo}${d.amount != null ? ' for ' + inr(d.amount) : ''}. Before we can process it, please confirm the following:\n\n- \n\nRegards,\n${user.name}\n${user.title}`} />
      <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} onReject={reason => act(() => api.setIntakeStatus(d.id, 'rejected', user.id, reason), 'Document rejected')} />
    </Card>
  )
}

function CompareDialog({ open, onOpenChange, a, b }: { open: boolean; onOpenChange: (o: boolean) => void; a: IntakeDoc; b?: IntakeDoc }) {
  if (!b || !a.paper || !b.paper) return null
  const keys = [...new Set([...a.fields, ...b.fields].map(f => f.key))]
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-[1180px]">
        <DialogHeader><DialogTitle>Compare {a.docNo}</DialogTitle><DialogDescription>{a.channel} copy on the left, {b.channel} copy on the right.</DialogDescription></DialogHeader>
        <div className="grid gap-4 lg:grid-cols-2">
          {[a, b].map(x => <div key={x.id} className="flex flex-col gap-2"><div className="flex items-center gap-2 text-xs"><Source name={x.channel} text={dateTime(x.receivedAt)} /><Confidence value={x.confidence} /></div><div className="flex justify-center overflow-auto rounded-lg bg-surface-3 p-4"><Paper doc={x.paper!} width={500} /></div></div>)}
        </div>
        <table className="w-full text-xs [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5">
          <tbody>{keys.map(k => { const fa = a.fields.find(f => f.key === k), fb = b.fields.find(f => f.key === k); const same = fa?.value === fb?.value; return <tr key={k}><td className="text-text-2">{fa?.label ?? fb?.label}</td><td className="font-mono">{fa?.value ?? '—'}</td><td className="font-mono">{fb?.value ?? '—'}</td><td>{same ? <StatusPill tone="ok" plain>Same</StatusPill> : <StatusPill tone="bad" plain>Differs</StatusPill>}</td></tr> })}</tbody>
        </table>
      </DialogContent>
    </Dialog>
  )
}

function LinkPoDialog({ open, onOpenChange, d }: { open: boolean; onOpenChange: (o: boolean) => void; d: IntakeDoc }) {
  const pos = usePOs().data ?? []
  const vendors = useVendors().data ?? []
  const { user } = useSession()
  const { act, pending } = useAct()
  const [sel, setSel] = useState<string>(d.suggestedLink?.poId ?? '')
  const list = [...pos].sort((a, b) => Number(b.vendorId === d.vendorId) - Number(a.vendorId === d.vendorId))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader><DialogTitle>Link {d.docNo} to a purchase order</DialogTitle><DialogDescription>POs from the same vendor are listed first.</DialogDescription></DialogHeader>
        <div className="flex max-h-[360px] flex-col gap-1.5 overflow-auto">
          {list.map(p => {
            const v = vendors.find(v => v.id === p.vendorId)
            return (
              <label key={p.id} className={cn('flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2', sel === p.id ? 'border-acc bg-acc-weak' : 'border-border hover:bg-surface-2')}>
                <input type="radio" name="po" checked={sel === p.id} onChange={() => setSel(p.id)} className="accent-[var(--primary)]" />
                <span className="flex flex-1 flex-col"><span className="font-medium">PO {p.id} · {v?.name}</span><span className="text-[11px] text-text-3">{p.lines[0].material} · {p.lines[0].ordered.toLocaleString('en-IN')} {p.lines[0].uom} at {inr(p.lines[0].rate)}</span></span>
                <span className="text-xs tabular-nums">{inr(p.value)}</span>
                {p.id === d.suggestedLink?.poId && <Chip acc>Suggested · {d.suggestedLink.match}%</Chip>}
              </label>
            )
          })}
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="default" disabled={!sel || pending} onClick={async () => { if (await act(() => api.linkToPo(d.id, sel, user.id), `Linked to PO ${sel}`)) onOpenChange(false) }}><Link2 />Link to PO {sel}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AskVendorDialog({ open, onOpenChange, to, subject, body }: { open: boolean; onOpenChange: (o: boolean) => void; to: string; subject: string; body: string }) {
  const { entity, user } = useSession()
  const { act, pending } = useAct()
  const [s, setS] = useState(subject)
  const [b, setB] = useState(body)
  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (o) { setS(subject); setB(body) } }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader><DialogTitle>Ask vendor</DialogTitle><DialogDescription>Sent from {entity.intakeEmail}; the reply comes back to the intake inbox and is linked automatically.</DialogDescription></DialogHeader>
        <label className="text-xs font-medium text-text-2">To<Input value={to} readOnly className="mt-1" /></label>
        <label className="text-xs font-medium text-text-2">Subject<Input value={s} onChange={e => setS(e.target.value)} className="mt-1" /></label>
        <label className="text-xs font-medium text-text-2">Message<Textarea value={b} onChange={e => setB(e.target.value)} rows={8} className="mt-1" /></label>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="default" disabled={pending} onClick={async () => { if (await act(() => api.askVendor(entity.id, user.id, to, s, b), `Message sent to ${to}`)) onOpenChange(false) }}><Send />Send</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RejectDialog({ open, onOpenChange, onReject }: { open: boolean; onOpenChange: (o: boolean) => void; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  const options = ['GSTIN cancelled', 'Not addressed to us', 'Illegible', 'Missing mandatory fields', 'Vendor not onboarded']
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reject document</DialogTitle><DialogDescription>The reason is logged and sent to the sender.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-2">{options.map(o => <FilterChip key={o} on={reason === o} onClick={() => setReason(o)}>{o}</FilterChip>)}</div>
        <Input placeholder="Or type a reason" value={reason} onChange={e => setReason(e.target.value)} />
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="destructive" disabled={!reason.trim()} onClick={() => { onReject(reason.trim()); onOpenChange(false) }}>Reject</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
