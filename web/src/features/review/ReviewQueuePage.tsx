import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Avatar, Card, CardBody, Chip, DataTable, LineTabs, MsmeBadge, PageHeader, Pill, Q } from '@/components/pravah'
import { Button } from '@/components/ui/button'
import { useSession } from '@/app/session'
import { useAct, useAi, useInvoices, useVendors } from '@/api/hooks'
import * as api from '@/api'
import { date, dateTime, inr } from '@/lib/format'
import type { Invoice, Status } from '@/lib/types'
import { Flag, Upload } from 'lucide-react'

export function invoiceStatus(i: Invoice): Status {
  if (i.decision?.secondApproverNeeded) return { tone: 'warn', label: 'Awaiting second approver' }
  return ({
    'needs-decision': { tone: 'warn', label: i.draft ? 'Needs decision · draft saved' : 'Needs decision' },
    approved: { tone: 'ok', label: 'Approved' },
    'dn-raised': { tone: 'ok', label: 'Approved · debit note ' + (i.decision?.debitNote?.no ?? '') },
    held: { tone: 'bad', label: 'On hold' },
    rejected: { tone: 'bad', label: 'Rejected' },
    posted: { tone: 'ok', label: 'Posted' },
  } as const)[i.status]
}

type Tab = 'open' | 'second' | 'decided' | 'all'

export default function ReviewQueuePage() {
  const { entity } = useSession()
  const q = useInvoices()
  const vq = useVendors().data
  const vendors = useMemo(() => vq ?? [], [vq])
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') ?? 'open') as Tab
  const columns = useMemo<ColumnDef<Invoice, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { accessorKey: 'invoiceNo', header: 'Invoice no.', cell: ({ getValue }) => <span className="font-mono font-medium whitespace-nowrap">{getValue()}</span> },
    { id: 'vendor', header: 'Vendor', accessorFn: i => vendors.find(v => v.id === i.vendorId)?.name, cell: ({ row: { original: i } }) => { const v = vendors.find(v => v.id === i.vendorId); return <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="font-medium">{v?.name}</span>{v?.msme && <MsmeBadge cls={v.msme} />}</span> } },
    { accessorKey: 'date', header: 'Dated', cell: ({ getValue }) => date(getValue()) },
    { accessorKey: 'receivedAt', header: 'Received', cell: ({ getValue, row }) => <span className="whitespace-nowrap">{dateTime(getValue())} <span className="text-text-3">· {row.original.channel}</span></span> },
    { accessorKey: 'poId', header: 'PO', cell: ({ getValue }) => <span className="font-mono">{getValue() ?? '—'}</span> },
    { id: 'flags', header: 'Flags', accessorFn: i => i.flags.length, cell: ({ getValue }) => getValue() ? <Chip><Flag className="size-3" />{getValue()} flag{getValue() > 1 ? 's' : ''}</Chip> : <span className="text-xs text-ok">Clean match</span> },
    { accessorKey: 'total', header: 'Total', meta: { num: true }, cell: ({ getValue }) => inr(getValue()) },
    { id: 'status', header: 'Status', accessorFn: i => invoiceStatus(i).label, cell: ({ row: { original: i } }) => <Pill s={invoiceStatus(i)} /> },
    { id: 'by', header: 'Decided by', accessorFn: i => i.decision?.byId ?? '', cell: ({ row: { original: i } }) => i.decision ? <Avatar id={i.decision.byId} /> : <span className="text-text-3">—</span> },
  ], [vendors])
  return (
    <>
      <PageHeader title="Invoice review" sub="Three-way match of negotiated terms, PO, goods receipt and invoice. Pravah flags differences; a person decides." />
      <ReviewUpload />
      {!entity.id ? null :
      <Q q={q}>{all => {
        const lists: Record<Tab, Invoice[]> = {
          open: all.filter(i => i.status === 'needs-decision'),
          second: all.filter(i => i.decision?.secondApproverNeeded),
          decided: all.filter(i => i.status !== 'needs-decision'),
          all,
        }
        return (
          <>
            <LineTabs label="Queue" value={tab} onChange={v => setSp({ tab: v }, { replace: true })} items={[
              { value: 'open', label: 'Needs decision', count: lists.open.length, tone: 'warn' },
              { value: 'second', label: 'Second approval', count: lists.second.length },
              { value: 'decided', label: 'Decided', count: lists.decided.length },
              { value: 'all', label: 'All', count: all.length },
            ]} />
            <DataTable id="review" data={lists[tab]} columns={columns} getRowId={i => i.id} onRowClick={i => nav('/review/' + i.id)} initialSort={[{ id: 'receivedAt', desc: true }]} toolbar={null} />
          </>
        )
      }}</Q>}
    </>
  )
}

function ReviewUpload() {
  const { entity, entities, isAdmin, firmWide, readOnly, refresh, setEntityId } = useSession()
  const aiSettings = useAi(isAdmin || firmWide).data
  const { act, pending } = useAct()
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [suggestion, setSuggestion] = useState<{ legal_name: string; gstin: string; source: string; warnings: string[] } | null>(null)
  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [gstin, setGstin] = useState('')
  const [drag, setDrag] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const canUpload = !!entity.id && !readOnly
  const canCreate = entities.length === 0 && (isAdmin || firmWide)

  async function upload(selected: File[], clientId: string) {
    const result = await act(() => api.uploadDocs(clientId, selected), r => `${r.documents.length} document${r.documents.length === 1 ? '' : 's'} uploaded for reading`)
    result?.skipped.forEach(message => toast.warning(message))
    if (result?.documents.length) {
      setFiles([])
      setSuggestion(null)
      setUploaded(true)
      toast.info('Open Intake to check extracted fields. Matched invoices appear here when reading finishes.')
    }
  }

  async function choose(selected: FileList | File[] | null) {
    if (!selected?.length) return
    const next = Array.from(selected)
    setFiles(next)
    setSuggestion(null)
    setUploaded(false)
    if (canUpload) return upload(next, entity.id)
    if (!canCreate) return
    const found = await act(() => api.suggestClientFromDocs(next))
    if (found) {
      setSuggestion(found)
      setName(found.legal_name)
      setShortName(found.legal_name.slice(0, 80))
      setGstin(found.gstin)
    }
  }

  async function createAndUpload() {
    const legal = name.trim()
    const short = shortName.trim()
    const gst = gstin.trim().toUpperCase()
    if (legal.length < 2 || short.length < 2 || gst.length !== 15) {
      toast.error('Enter the client name, short name and 15-character bill-to GSTIN')
      return
    }
    const created = await act(() => api.createEntity({ legal_name: legal, short_name: short, pan: gst.slice(2, 12), gstins: [{ gstin: gst }] }), 'Client created from invoice details')
    if (!created) return
    setEntityId(created.id)
    refresh()
    await upload(files, created.id)
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="text-sm font-medium">Upload documents for matching</div>
        <p className="text-xs text-text-2">Add a combined PDF or separate invoice, PO, GRN and supporting images. Pravah splits bundles, reads the documents and flags differences for review.</p>
        {aiSettings && (!aiSettings.configured || aiSettings.lastTestResult?.startsWith('Failed')) &&
          <p className="rounded-md bg-warn-bg px-3 py-2 text-xs text-warn">Document reading needs a working AI key. <Link to="/settings/integrations">Check document reading settings</Link> before uploading.</p>}
        {canUpload || canCreate ? <>
          <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.xml,.json,.zip" className="hidden" onChange={e => { void choose(e.target.files); e.target.value = '' }} />
          <div role="button" tabIndex={0} aria-label="Upload documents for invoice review"
            onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') input.current?.click() }}
            onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); void choose(e.dataTransfer.files) }}
            className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-5 text-center text-xs ${drag ? 'border-acc bg-acc-weak' : 'border-border-2'}`}>
            <Upload className="mx-auto mb-2 size-5" />{pending ? 'Reading or uploading…' : 'Drop PDF and images here, or click to choose files'}
          </div>
          {files.length > 0 && <p className="text-xs text-text-2">Selected: {files.map(f => f.name).join(', ')}</p>}
        </> : <p className="text-xs text-text-2">{readOnly ? 'Your role can review documents but cannot upload them.' : 'Ask a firm admin or partner to create a client and grant you access.'}</p>}
        {canCreate && !suggestion && <p className="text-xs text-text-2">No client exists yet. Include an invoice; Pravah will read its bill-to details and let you confirm the new client.</p>}
        {uploaded && <p className="rounded-md bg-acc-weak px-3 py-2 text-xs text-acc">Documents are being read. Check <Link to="/intake">Intake</Link> for progress; linked invoices and differences will appear in this queue.</p>}
        {suggestion && canCreate && <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <div className="text-xs font-medium">Confirm client details from {suggestion.source}</div>
          {suggestion.warnings.map(w => <p key={w} className="text-xs text-warn">{w}</p>)}
          <label className="flex flex-col gap-1 text-xs">Legal name<input className="rounded-md border border-border-2 bg-surface px-2 py-1.5" value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-xs">Short name<input className="rounded-md border border-border-2 bg-surface px-2 py-1.5" value={shortName} onChange={e => setShortName(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-xs">Bill-to GSTIN<input className="rounded-md border border-border-2 bg-surface px-2 py-1.5 font-mono" value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} maxLength={15} /></label>
          <Button variant="default" disabled={pending} onClick={createAndUpload}>Create client and upload {files.length} file{files.length === 1 ? '' : 's'}</Button>
        </div>}
        {entity.id && <p className="text-xs text-text-2">Files will be assigned to {entity.shortName}. <Link to="/intake">Open Intake</Link> to confirm extracted fields and track processing.</p>}
      </CardBody>
    </Card>
  )
}
