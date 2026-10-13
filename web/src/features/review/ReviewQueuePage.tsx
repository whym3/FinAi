import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Avatar, Chip, DataTable, LineTabs, MsmeBadge, PageHeader, Pill, Q } from '@/components/pravah'
import { useInvoices, useVendors } from '@/mock/hooks'
import { date, dateTime, inr } from '@/lib/format'
import type { Invoice, Status } from '@/lib/types'
import { Flag } from 'lucide-react'

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
  const q = useInvoices()
  const vendors = useVendors().data ?? []
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
      }}</Q>
    </>
  )
}
