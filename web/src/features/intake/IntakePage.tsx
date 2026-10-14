import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Check, ChevronLeft, ChevronRight, Copy, Database, ExternalLink, Filter, Link2, Mail, Mailbox, MessageCircle, Pencil, RefreshCw, Send, Sparkles, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Banner, BulkBar, Card, Chip, Confidence, DataTable, EmptyState, FieldRow, FilterChip, LineTabs, MsmeBadge, PageHeader, Pill, Q, Source, Spacer, Restricted,
} from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useIntake, usePOs, useVendors } from '@/api/hooks'
import * as api from '@/api'
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
  const { entity, readOnly } = useSession()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') ?? (sp.get('doc') ? 'all' : 'new')) as 'all' | IntakeStatus
  const docId = sp.get('doc')
  const set = (k: string, v: string | null) => setSp(p => { const n = new URLSearchParams(p); if (v == null) n.delete(k); else n.set(k, v); return n }, { replace: true })
  const [recent, setRecent] = useState(false)
  const [lowConf, setLowConf] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [vendors, setVendors] = useState<string[]>([])
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { act } = useAct()

  // A scanned bundle is listed with the documents it was split into right under it.
  const all = useMemo(() => (q.data ?? []).flatMap(d => d.kind === 'bundle' ? [d, ...(d.parts ?? [])] : [d]), [q.data])
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
    { accessorKey: 'type', header: 'Detected type', cell: ({ row: { original: d } }) => d.bundleId
      ? <span className="whitespace-nowrap pl-3 text-text-2">↳ {d.type}<span className="ml-1 text-[11px] text-text-3">p{d.pageFrom}{d.pageTo !== d.pageFrom ? `–${d.pageTo}` : ''}</span></span>
      : <span className="whitespace-nowrap">{d.kind === 'bundle' ? <b>{d.type} · {d.parts?.length ?? 0} documents</b> : d.type}</span> },
    { accessorKey: 'vendorName', header: 'Vendor', cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { accessorKey: 'docNo', header: 'Document no.', cell: ({ getValue }) => <span className="font-mono whitespace-nowrap">{getValue()}</span> },
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

  const onUpload = async (files: FileList | File[] | null) => {
    if (!files?.length) return
    const r = await act(() => api.uploadDocs(entity.id, [...files]), r => `${r.documents.length} file${r.documents.length === 1 ? '' : 's'} uploaded · reading starts now`)
    r?.skipped.forEach(m => toast.warning(m))
    setSp({ tab: 'all' }, { replace: true })
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <>
      <PageHeader title="Intake inbox" sub={`Every document that reaches ${entity.shortName}: emailed, uploaded or scanned. Bundles are split into their documents and each is read by Claude.`}
        actions={<>
          {entity.intakeEmail
            ? <Chip><Mail className="size-3.5" /><span className="font-mono">{entity.intakeEmail}</span>
              <button type="button" aria-label="Copy mailbox address" className="grid size-5 cursor-pointer place-items-center rounded-sm hover:bg-surface-3" onClick={() => { navigator.clipboard?.writeText(entity.intakeEmail); toast.success('Mailbox address copied') }}><Copy className="size-3" /></button></Chip>
            : <Button asChild><Link to="/settings/integrations"><Mail />Connect a mailbox</Link></Button>}
          <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.xml,.json,.zip" className="hidden" onChange={e => onUpload(e.target.files)} />
          <Button variant="default" disabled={readOnly} onClick={() => fileRef.current?.click()}><Upload />Upload documents</Button>
        </>} />
      {!readOnly && (
        <div onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); onUpload(e.dataTransfer.files) }}
          className={cn('rounded-lg border-2 border-dashed px-4 py-3 text-center text-xs transition-colors', drag ? 'border-acc bg-acc-weak text-acc' : 'border-border-2 text-text-3')}>
          Drop invoices, scanned bundles, photos or ZIPs here · PDF, JPG, PNG, TIFF, XML, JSON up to 50 MB each
        </div>
      )}

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
                <Button size="sm" disabled={readOnly} onClick={async () => { for (const r of rows) await api.setIntakeStatus(r.id, 'notfinance'); clear(); act(async () => null, `${rows.length} marked not finance`) }}>Not finance</Button>
                <Button size="sm" disabled={readOnly} onClick={async () => { for (const r of rows) await api.setIntakeStatus(r.id, 'new'); clear(); act(async () => null, `${rows.length} moved back to New`) }}>Move to New</Button>
                <Button size="icon-sm" aria-label="Clear selection" onClick={clear}><X /></Button>
              </BulkBar>
            )}
            empty={<EmptyState title={tab === 'new' ? 'Nothing waiting for review' : 'No documents here'} action={<Button size="sm" onClick={() => fileRef.current?.click()}><Upload />Upload documents</Button>}>Documents from connected mailboxes and uploads appear here as they arrive.</EmptyState>} />

          {selected && <ReviewPanel key={selected.id} d={selected} onOpen={id => set('doc', id)} pos={idx >= 0 ? `${idx + 1} of ${filtered.length}` : ''}
            prev={idx > 0 ? () => set('doc', filtered[idx - 1].id) : undefined} next={idx >= 0 && idx < filtered.length - 1 ? () => set('doc', filtered[idx + 1].id) : undefined}
            onClose={() => set('doc', null)} />}
        </>
      )}</Q>

    </>
  )
}

const TOTAL_KEYS = ['taxable', 'cgst', 'sgst', 'igst', 'total', 'bank', 'terms']

function ReviewPanel({ d, pos, prev, next, onClose, onOpen }: { d: IntakeDoc; pos: string; prev?: () => void; next?: () => void; onClose: () => void; onOpen: (id: string) => void }) {
  const { user, readOnly } = useSession()
  const vendor = useVendors().data?.find(v => v.id === d.vendorId)
  const { act, pending } = useAct()
  const [focus, setFocus] = useState<string | undefined>()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
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
        <form className="flex w-full items-center gap-1" onSubmit={e => { e.preventDefault(); act(() => api.editField(d.id, f.key, f.num ? String(Number(draft.replace(/[₹,\s]/g, ''))) : draft), `${f.label} updated`); setEditing(null) }} onClick={e => e.stopPropagation()}>
          <Input autoFocus value={draft} onChange={e => setDraft(e.target.value)} className="h-6 flex-1 px-1.5 text-xs" aria-label={f.label} />
          <Button size="icon-xs" type="submit" aria-label="Save"><Check /></Button>
          <Button size="icon-xs" type="button" aria-label="Cancel" onClick={() => setEditing(null)}><X /></Button>
        </form>
      ) : <>
        <span className={cn('min-w-0 break-words', f.mono && 'font-mono text-[12px]')}>{show(f)}</span>
        {f.check && <span className={cn('flex items-center gap-1 text-[11px] font-medium', { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', none: 'text-text-3', acc: 'text-acc' }[f.check.tone])}>{f.check.label}</span>}
        {f.key === 'irn' && f.confidence < 90 && !f.confirmedBy && <Button size="xs" disabled={disabled} onClick={e => { e.stopPropagation(); act(() => api.editField(d.id, 'irn', f.value), 'IRN verified on IRP: signed QR matches') }}>Verify on IRP</Button>}
        {!done && !readOnly && <button type="button" aria-label={`Edit ${f.label}`} className="ml-auto grid size-5 flex-none cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-surface-3 hover:text-text" onClick={e => { e.stopPropagation(); setDraft(show(f)); setEditing(f.key) }}><Pencil className="size-3" /></button>}
      </>} />
  )

  return (
    <Card aria-label="Review selected document">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <div className="mr-auto flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2"><h2>{d.docNo === '—' ? d.type : d.docNo}</h2><Pill s={docStatus(d)} />{vendor?.msme && <MsmeBadge cls={vendor.msme} udyam />}</div>
          <div className="text-[11px] text-text-3">{d.vendorName} · {d.channel === 'Email' ? 'emailed' : d.channel === 'WhatsApp' ? 'sent on WhatsApp' : d.channel === 'Post' ? 'received by post' : d.channel === 'SAP' ? 'from SAP' : 'uploaded'} by {d.from} on {dateTime(d.receivedAt)} · {d.filename}, {d.pages} page{d.pages > 1 ? 's' : ''}, {d.sizeKb} KB{d.subject && <> · “{d.subject}”</>}</div>
        </div>
        <Button size="icon" className="border-border-2 bg-surface" aria-label="Previous document" disabled={!prev} onClick={prev}><ChevronLeft /></Button>
        <span className="text-[11px] text-text-3">{pos}</span>
        <Button size="icon" className="border-border-2 bg-surface" aria-label="Next document" disabled={!next} onClick={next}><ChevronRight /></Button>
        <Button size="icon" aria-label="Close review panel" onClick={onClose}><X /></Button>
      </div>

      {d.status === 'duplicate' && (
        <div className="px-4 pt-3">
          <Banner tone="info" actions={<>{d.duplicateOf && <Button size="sm" onClick={() => onOpen(d.duplicateOf!)}>Open the original</Button>}<Button size="sm" disabled={disabled} onClick={() => act(() => api.setIntakeStatus(d.id, 'new'), 'Moved back to New')}>Not a duplicate</Button></>}>
            {d.statusNote ?? 'This file already came in.'} The copy is kept for the audit trail and is not read again.
          </Banner>
        </div>
      )}
      {d.kind === 'bundle' && (
        <div className="px-4 pt-3">
          <Banner tone="info">This file held {d.parts?.length ?? 0} documents. Each one was split out and read on its own; open one to check its fields.</Banner>
          <div className="mt-2 flex flex-wrap gap-2">
            {(d.parts ?? []).map(p => <Button key={p.id} size="sm" onClick={() => onOpen(p.id)}>{p.type} · p{p.pageFrom}{p.pageTo !== p.pageFrom ? `–${p.pageTo}` : ''}{p.docNo && p.docNo !== p.filename ? ` · ${p.docNo}` : ''}</Button>)}
          </div>
        </div>
      )}

      {(
        <div className="flex flex-wrap items-stretch gap-4 px-4 pt-3 pb-4">
          <div className="min-w-0 flex-[1_1_540px]">
            <FileView d={d} />
          </div>
          <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3>Extracted fields</h3>
              <span className="flex items-center gap-2"><Source name="Extracted" text="read by Claude" />{d.confidence != null && <Confidence value={d.confidence}>{d.confidence}% overall</Confidence>}</span>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-text-2">
              <span className="flex items-center gap-1"><span className="h-2.5 w-3.5 rounded-[2px] border-[1.5px] border-dashed border-warn" />Low confidence, not yet confirmed ({low})</span>
            </div>
            {!fields.length && d.kind !== 'bundle' && (
              <EmptyState title={d.statusNote ?? 'Not read yet'} icon={<Sparkles className="size-5" />}
                action={!readOnly && !done && <Button size="sm" disabled={disabled} onClick={() => act(() => api.reExtract(d.id), 'Queued · fields appear in a few seconds')}><RefreshCw />Read again</Button>}>
                Claude reads each document; every value stays unconfirmed until a person checks it.
              </EmptyState>
            )}
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
                <Button size="sm" disabled={disabled} onClick={() => act(() => api.linkToPo(d.id, d.suggestedLink!.poId), `Linked to PO ${d.suggestedLink!.poId} · sent to Invoice review`)}>Link to PO</Button>
              </div>
            )}

            {readOnly ? <Restricted>Your role can view documents but not confirm, link or reject them.</Restricted> : !done ? (
              <>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button variant="default" disabled={disabled || !!d.confirmedBy} onClick={() => act(() => api.confirmFields(d.id), low ? `Fields confirmed · ${low} low-confidence field${low > 1 ? 's' : ''} logged under your name` : 'Fields confirmed')}><Check />{d.confirmedBy ? 'Fields confirmed' : 'Confirm fields'}</Button>
                  <Button disabled={disabled} onClick={() => setLinkOpen(true)}><Link2 />{d.linkedPoId ? 'Change PO' : 'Link to PO'}</Button>
                  {!d.confirmedBy && fields.length > 0 && <Button disabled={disabled} onClick={() => act(() => api.reExtract(d.id), 'Queued for reading')}><RefreshCw />Read again</Button>}
                  <Button disabled={disabled} onClick={() => act(() => api.markDuplicate(d.id), 'Marked duplicate')}><Copy />Mark duplicate</Button>
                  <Button disabled={disabled} onClick={() => act(() => api.setIntakeStatus(d.id, 'notfinance'), 'Marked not an invoice')}>Not an invoice</Button>
                  <Button disabled={disabled} onClick={() => setAskOpen(true)}><Send />Ask vendor</Button>
                  <Button variant="destructive" disabled={disabled} onClick={() => setRejectOpen(true)}>Reject</Button>
                </div>
                <div className="text-[11px] text-text-3">Confirm stays available with low-confidence fields; each one you accept unchanged is logged with your name in the audit log.</div>
              </>
            ) : null}
            {(d.invoiceId || d.linkedPoId) && (
              <Banner tone="ok" icon={<Link2 className="size-4" />} actions={<>
                {d.invoiceId && <Button size="sm" asChild><Link to={`/review/${d.invoiceId}`}>Open invoice review</Link></Button>}
                {d.linkedPoId && <Button size="sm" asChild><Link to={`/p2p/${d.linkedPoId}`}>Open purchase order</Link></Button>}
              </>}>Linked{d.invoiceId ? ' to an invoice in the review queue' : ''}{d.linkedPoId ? ' and its purchase order' : ''}.</Banner>
            )}
          </div>
        </div>
      )}

      <LinkPoDialog open={linkOpen} onOpenChange={setLinkOpen} d={d} />
      <AskVendorDialog open={askOpen} onOpenChange={setAskOpen} to={vendor?.email ?? d.from} subject={`${d.docNo}: please confirm`}
        body={`Dear ${d.vendorName},\n\nWe received ${d.type.toLowerCase()} ${d.docNo}${d.amount != null ? ' for ' + inr(d.amount) : ''}. Before we can process it, please confirm the following:\n\n- \n\nRegards,\n${user.name}\n${user.title}`} />
      <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} onReject={reason => act(() => api.setIntakeStatus(d.id, 'rejected', reason), 'Document rejected')} />
    </Card>
  )
}

/** The original file as received, served by the server. PDFs and text in a frame, images inline. */
function FileView({ d }: { d: IntakeDoc }) {
  const url = api.fileUrl(d)
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-2"><span className="font-medium">Original</span><Source name="Email" text={dateTime(d.receivedAt)} /></span>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-acc"><ExternalLink className="size-3.5" />Open in new tab</a>
      </div>
      {d.mime?.startsWith('image/')
        ? <img src={url} alt={`Original ${d.filename}`} className="max-h-[760px] w-full rounded-lg border border-border bg-surface-3 object-contain" />
        : <iframe src={url} title={`Original ${d.filename}`} className="h-[760px] w-full rounded-lg border border-border bg-surface-3" />}
    </div>
  )
}

function LinkPoDialog({ open, onOpenChange, d }: { open: boolean; onOpenChange: (o: boolean) => void; d: IntakeDoc }) {
  const [text, setText] = useState('')
  const list = usePOs({ q: text.trim() || undefined }).data?.items ?? []
  const { act, pending } = useAct()
  const [sel, setSel] = useState<string>(d.linkedPoId ?? '')
  const selPo = list.find(p => p.id === sel)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader><DialogTitle>Link {d.docNo} to a purchase order</DialogTitle><DialogDescription>Search by PO number or vendor.</DialogDescription></DialogHeader>
        <Input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="PO number or vendor" />
        <div className="flex max-h-[360px] flex-col gap-1.5 overflow-auto">
          {list.length === 0 && <div className="py-6 text-center text-xs text-text-3">No purchase orders match. Import the PO register on the Imports page.</div>}
          {list.map(p => {
            return (
              <label key={p.id} className={cn('flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2', sel === p.id ? 'border-acc bg-acc-weak' : 'border-border hover:bg-surface-2')}>
                <input type="radio" name="po" checked={sel === p.id} onChange={() => setSel(p.id)} className="accent-[var(--primary)]" />
                <span className="flex flex-1 flex-col"><span className="font-medium">PO {p.poNo} · {p.vendorName}</span>{p.lines[0] && <span className="text-[11px] text-text-3">{p.lines[0].material} · {p.lines[0].ordered.toLocaleString('en-IN')} {p.lines[0].uom} at {inr(p.lines[0].rate)}{p.lines.length > 1 ? ` · +${p.lines.length - 1} lines` : ''}</span>}</span>
                <span className="text-xs tabular-nums">{inr(p.value)}</span>
              </label>
            )
          })}
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="default" disabled={!sel || pending} onClick={async () => { if (await act(() => api.linkToPo(d.id, sel), `Linked to PO ${selPo?.poNo ?? ''}`)) onOpenChange(false) }}><Link2 />Link to PO {selPo?.poNo ?? ''}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function AskVendorDialog({ open, onOpenChange, to, subject, body }: { open: boolean; onOpenChange: (o: boolean) => void; to: string; subject: string; body: string }) {
  const { entity } = useSession()
  const { act, pending } = useAct()
  const [s, setS] = useState(subject)
  const [b, setB] = useState(body)
  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (o) { setS(subject); setB(body) } }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader><DialogTitle>Ask vendor</DialogTitle><DialogDescription>{entity.intakeEmail ? `Replies to ${entity.intakeEmail} come back to this inbox.` : 'Sent from the firm address set on the server.'}</DialogDescription></DialogHeader>
        <label className="text-xs font-medium text-text-2">To<Input value={to} readOnly className="mt-1" /></label>
        <label className="text-xs font-medium text-text-2">Subject<Input value={s} onChange={e => setS(e.target.value)} className="mt-1" /></label>
        <label className="text-xs font-medium text-text-2">Message<Textarea value={b} onChange={e => setB(e.target.value)} rows={8} className="mt-1" /></label>
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="default" disabled={pending} onClick={async () => { if (await act(() => api.askVendor(entity.id, to, s, b), r => r.sent ? `Message sent to ${to}` : 'Logged · email is not set up on the server, so send it yourself')) onOpenChange(false) }}><Send />Send</Button></DialogFooter>
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
