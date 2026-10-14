import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Download, ExternalLink, Link2, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { date, num2, rupeesInWords } from '@/lib/format'
import type { EvidenceDoc, ExtractedField, PaperDoc, Status } from '@/lib/types'
import { Chk } from './data-table'
import { Spacer, LineTabs } from './layout'
import { Confidence, Pill, Source } from './status'

const BOX_LABEL: Record<string, string> = { supplier: 'Supplier', gstin: 'GSTIN', number: 'Doc no.', date: 'Date', irn: 'IRN', billTo: 'Bill-to', pos: 'POS', hsn: 'HSN', bank: 'Bank', terms: 'Terms', total: 'Total', taxable: 'Taxable' }

/** A field highlight box over the paper; dashed amber below 80% confidence. */
function Hl({ k, doc, focus, onPick, children, label = true }: { k: string; doc: PaperDoc; focus?: string; onPick?: (k: string) => void; children: ReactNode; label?: boolean }) {
  const c = doc.boxes[k]
  if (c == null) return <>{children}</>
  return (
    <span className="relative inline-block" onClick={onPick ? () => onPick(k) : undefined} style={{ cursor: onPick ? 'pointer' : undefined }}>
      {children}
      <span className={cn('hl', c < 80 && 'lo', focus === k && 'cur')} style={{ inset: '-3px -5px' }}>
        {label && <span className="hl-t">{BOX_LABEL[k] ?? k} {c}%{c < 75 && ' · unconfirmed'}</span>}
      </span>
    </span>
  )
}

export function Paper({ doc, focus, onPick, width = 540 }: { doc: PaperDoc; focus?: string; onPick?: (k: string) => void; width?: number }) {
  const h = (k: string, node: ReactNode, label = true) => <Hl k={k} doc={doc} focus={focus} onPick={onPick} label={label}>{node}</Hl>
  const hasTax = doc.cgst || doc.sgst || doc.igst
  return (
    <div className="doc flex flex-col gap-3 px-7 pt-[26px] pb-6" style={{ width }}>
      <div className="flex items-start justify-between border-b-[1.5px] border-[#1b1e23] pb-2">
        <div className="flex flex-col gap-0.5">
          {h('supplier', <span className="text-sm leading-[18px] font-bold">{doc.supplier}</span>)}
          <span className="dl">{doc.address}</span>
          {doc.supplierGstin && <span className="self-start">{h('gstin', <>GSTIN: <b>{doc.supplierGstin}</b></>)}</span>}
          {doc.udyam && <span className="dl">Udyam: {doc.udyam}</span>}
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="text-[15px] font-bold tracking-[.06em]">{doc.kind}</span>
          <span className="dl">Original for recipient</span>
          <span className="mt-1">{h('number', <>No: <b>{doc.number}</b></>)}</span>
          <span className="mt-1.5">{h('date', <>Date: <b>{date(doc.date)}</b></>)}</span>
          {doc.refs && <span className="dl">{doc.refs}</span>}
        </div>
      </div>

      {doc.irn && (
        <div className="flex items-center gap-3">
          <div role="img" aria-label="Signed QR code" className="size-[54px] flex-none opacity-85 outline-3 -outline-offset-3 outline-[#1b1e23]" style={{ backgroundImage: 'repeating-linear-gradient(0deg, #1b1e23 0 3px, transparent 3px 6px), repeating-linear-gradient(90deg, #1b1e23 0 3px, transparent 3px 7px)', backgroundBlendMode: 'multiply' }} />
          {h('irn', <span className="font-mono text-[9.5px] leading-[13px] break-all">IRN: {doc.irn}</span>)}
        </div>
      )}

      <div className="flex justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="dl">Bill to / Ship to</span>
          <b>{doc.billTo}</b>
          <span>{doc.billToAddress}</span>
          {doc.billToGstin && <span className="self-start">{h('billTo', <>GSTIN: <b>{doc.billToGstin}</b></>)}</span>}
        </div>
        {doc.pos && (
          <div className="flex flex-col items-end gap-0.5">
            {h('pos', <>Place of supply: <b>{doc.pos}</b></>)}
            <span className="dl">Reverse charge: No</span>
          </div>
        )}
      </div>

      {doc.body && <p className="whitespace-pre-line">{doc.body}</p>}

      {doc.lines.length > 0 && (
        <table>
          <thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td><td>{l.desc}</td>
                <td>{i === 0 ? h('hsn', l.hsn) : l.hsn}</td>
                <td style={{ textAlign: 'right' }}>{l.qty.toLocaleString('en-IN')} {l.unit}</td>
                <td style={{ textAlign: 'right' }}>{num2(l.rate)}</td>
                <td style={{ textAlign: 'right' }}>{num2(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="flex max-w-[250px] flex-col gap-[3px]">
          {doc.bank && <><span className="dl">Bank details</span>{h('bank', <span>{doc.bank}</span>)}</>}
          {doc.terms && <span className="mt-1.5 self-start">{h('terms', <>Terms: {doc.terms}</>)}</span>}
        </div>
        {doc.total > 0 && (
          <div className="grid min-w-[200px] grid-cols-[auto_auto] gap-x-4 gap-y-[3px] text-right">
            <span className="dl">Taxable value</span>{h('taxable', num2(doc.taxable), false)}
            {hasTax ? (doc.igst ? <><span className="dl">IGST @ 18%</span><span>{num2(doc.igst)}</span></> : <><span className="dl">CGST @ 9%</span><span>{num2(doc.cgst)}</span><span className="dl">SGST @ 9%</span><span>{num2(doc.sgst)}</span></>) : null}
            <b>Total (₹)</b>{h('total', <b>{num2(doc.total)}</b>)}
          </div>
        )}
      </div>
      {doc.total > 0 && <div className="dl italic">{rupeesInWords(doc.total)}</div>}
      <div className="flex justify-end pt-[18px]"><span className="dl">For {doc.supplier} — Authorised signatory</span></div>
    </div>
  )
}

/** Paper for a document we only know by metadata (no extraction yet). */
export function placeholderPaper(d: { title: string; number: string; date: string; source: string; linkedBy?: string; billTo?: string }): PaperDoc {
  return {
    kind: 'LETTER', supplier: d.title, address: `Source: ${d.source}${d.linkedBy ? ' · linked by ' + d.linkedBy : ''}`, number: d.number, date: d.date.split('-').reverse().join('-'),
    billTo: d.billTo ?? '', billToAddress: '', lines: [], taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0,
    body: 'No fields have been extracted from this document. The original file is kept as received.', boxes: {},
  }
}

/** Toolbar + scrollable paper, as in the intake and drawer viewers. */
export function DocumentViewer({ doc, label, source, focus, onPick, compact }: { doc: PaperDoc; label: string; source?: ReactNode; focus?: string; onPick?: (k: string) => void; compact?: boolean }) {
  const [zoom, setZoom] = useState(compact ? 80 : 100)
  const [rot, setRot] = useState(0)
  const [boxes, setBoxes] = useState(true)
  const [big, setBig] = useState(false)
  const w = compact ? 420 : 540
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg bg-surface-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface px-2 py-1.5">
        <span className="text-xs font-medium">{label}</span>
        {source}
        <Spacer />
        <label className="flex items-center gap-1.5 text-[11px] text-text-2"><Chk checked={boxes} onChange={e => setBoxes(e.target.checked)} />Show field boxes</label>
        <Button size="icon" aria-label="Zoom out" onClick={() => setZoom(z => Math.max(50, z - 10))}><ZoomOut /></Button>
        <span className="w-9 text-center text-[11px] text-text-2">{zoom}%</span>
        <Button size="icon" aria-label="Zoom in" onClick={() => setZoom(z => Math.min(200, z + 10))}><ZoomIn /></Button>
        <Button size="icon" aria-label="Rotate" onClick={() => setRot(r => (r + 90) % 360)}><RotateCw /></Button>
        <Button size="icon" aria-label="Open larger" onClick={() => setBig(true)}><ExternalLink /></Button>
      </div>
      <div className={cn('flex justify-center overflow-auto p-5', !boxes && 'hide-boxes')} style={{ maxHeight: compact ? 520 : 760 }}>
        <div style={{ width: (rot % 180 ? 760 : w) * zoom / 100, height: rot % 180 ? w * zoom / 100 : undefined, flex: 'none' }}>
          <div style={{ transform: `scale(${zoom / 100}) rotate(${rot}deg)`, transformOrigin: rot ? 'center' : 'top left', width: w }}>
            <Paper doc={doc} focus={focus} onPick={onPick} width={w} />
          </div>
        </div>
      </div>
      <Dialog open={big} onOpenChange={setBig}>
        <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-[760px]">
          <DialogHeader><DialogTitle>{label} · {doc.number}</DialogTitle></DialogHeader>
          <div className={cn('flex justify-center rounded-lg bg-surface-3 p-6', !boxes && 'hide-boxes')}><Paper doc={doc} width={640} /></div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Extracted-field row: label, value box, confidence. Low confidence gets a dashed amber outline until someone confirms. */
export function FieldRow({ f, on, onClick, value, action }: { f: ExtractedField; on?: boolean; onClick?: () => void; value?: ReactNode; action?: ReactNode }) {
  const low = f.confidence < 90 && !f.confirmedBy
  return (
    <div onClick={onClick} className={cn('grid grid-cols-[minmax(110px,34%)_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 rounded-md border border-transparent px-2 py-1.5', onClick && 'cursor-pointer hover:bg-surface-2', on && 'bg-acc-weak hover:bg-acc-weak')}>
      <span className="text-xs font-medium text-text-2">{f.label}</span>
      <span className={cn('flex min-h-[30px] min-w-0 flex-wrap items-center gap-1.5 rounded-[5px] border px-2 py-1', low ? 'border-[1.5px] border-dashed border-warn bg-warn-bg' : 'border-border-2 bg-surface', on && !low && 'border-acc', value == null && f.mono && 'font-mono text-[12px]', f.num && 'justify-end tabular-nums')}>
        {value ?? f.value}{action}
      </span>
      {f.confirmedBy && f.confidence === 100 ? <Confidence value={100}>{f.edited ? 'Edited' : 'Confirmed'}</Confidence> : <Confidence value={f.confidence} />}
    </div>
  )
}

/** Side drawer that opens any linked document over the page. */
export function DocumentDrawer({ docs, index, onIndex, kicker }: { docs: EvidenceDoc[]; index: number | null; onIndex: (i: number | null) => void; kicker?: string }) {
  const [tab, setTab] = useState<'doc' | 'fields' | 'links' | 'history'>('doc')
  const d = index == null ? null : docs[index]
  const paper = d && (d.paper ?? placeholderPaper(d))
  return (
    <Sheet open={d != null} onOpenChange={o => !o && onIndex(null)}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px]">
        {d && paper && <>
          <div className="flex items-start gap-2 border-b border-border px-4 py-3 pr-12">
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="text-[11px] font-medium text-text-3">{d.title}{kicker && ' · ' + kicker}</div>
              <SheetTitle className="text-[13px] font-semibold">{d.number}</SheetTitle>
              <SheetDescription asChild><div className="flex flex-wrap items-center gap-1.5"><Source name={d.source} text={d.date} /><Pill s={d.check as Status} /></div></SheetDescription>
            </div>
          </div>
          <div className="px-4"><LineTabs label="Document sections" value={tab} onChange={setTab} items={[{ value: 'doc', label: 'Document' }, { value: 'fields', label: 'Fields' }, { value: 'links', label: 'Links' }, { value: 'history', label: 'History' }]} /></div>
          <div className="flex-1 overflow-auto p-4">
            {tab === 'doc' && (d.fileUrl
              ? <div className="flex h-full flex-col gap-2"><a href={d.fileUrl} target="_blank" rel="noreferrer" className="self-end text-xs text-acc">Open in new tab</a><iframe src={d.fileUrl} title={`${d.title} ${d.number}`} className="min-h-[640px] w-full flex-1 rounded-lg border border-border bg-surface-3" /></div>
              : <DocumentViewer doc={paper} label={`Page 1 of 1`} compact />)}
            {tab === 'fields' && (
              <div className="flex flex-col gap-1">
                {Object.entries(paper.boxes).length ? Object.entries(paper.boxes).map(([k, c]) => (
                  <FieldRow key={k} f={{ key: k, label: BOX_LABEL[k] ?? k, value: fieldValue(paper, k), confidence: c, mono: ['gstin', 'number', 'irn', 'billTo'].includes(k) }} />
                )) : <p className="text-xs text-text-2">No fields extracted from this document.</p>}
              </div>
            )}
            {tab === 'links' && <ul className="flex flex-col gap-2 text-xs">{docs.filter(x => x.id !== d.id).slice(0, 6).map(x => <li key={x.id} className="flex items-center gap-2"><Link2 className="size-3.5 text-text-3" /><button type="button" className="cursor-pointer text-acc hover:underline" onClick={() => onIndex(docs.indexOf(x))}>{x.title} · {x.number}</button></li>)}</ul>}
            {tab === 'history' && <ul className="flex flex-col gap-1.5 text-xs text-text-2"><li>{d.date} · received by {d.source}</li><li>{d.date} · linked by {d.linkedBy}</li><li>Check: {d.check.label}</li></ul>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
            {d.fileUrl ? <Button size="sm" asChild><a href={`${d.fileUrl}?download=true`}><Download />Download</a></Button> : <Button size="sm" onClick={() => window.print()}><Download />Print</Button>}
            <Spacer />
            <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => onIndex(index! - 1)}><ChevronLeft />Prev</Button>
            <span className="text-[11px] text-text-3">{index! + 1} of {docs.length}</span>
            <Button size="sm" variant="ghost" disabled={index === docs.length - 1} onClick={() => onIndex(index! + 1)}>Next<ChevronRight /></Button>
          </div>
        </>}
      </SheetContent>
    </Sheet>
  )
}

function fieldValue(p: PaperDoc, k: string): string {
  const m: Record<string, string | undefined> = { supplier: p.supplier, gstin: p.supplierGstin, number: p.number, date: date(p.date), irn: p.irn, billTo: p.billToGstin, pos: p.pos, hsn: p.lines[0]?.hsn, bank: p.bank, terms: p.terms, total: '₹' + num2(p.total), taxable: '₹' + num2(p.taxable) }
  return m[k] ?? '—'
}
