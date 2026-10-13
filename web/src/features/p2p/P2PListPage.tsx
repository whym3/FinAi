import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable, FilterChip, MsmeBadge, PageHeader, Pill, Q, Source } from '@/components/pravah'
import { usePOs, useVendors } from '@/mock/hooks'
import { date, inr } from '@/lib/format'
import type { PurchaseOrder, Status } from '@/lib/types'

export function poHealth(p: PurchaseOrder): Status {
  const blk = p.stages.find(s => s.state === 'blk')
  if (blk) return { tone: 'bad', label: `${blk.name} · ${blk.sla.label}` }
  const cur = p.stages.find(s => s.state === 'cur')
  if (!cur) return { tone: 'ok', label: 'Complete' }
  return cur.sla.tone === 'ok' ? { tone: 'ok', label: cur.name } : { tone: cur.sla.tone, label: `${cur.name} · ${cur.sla.label}` }
}

export default function P2PListPage() {
  const q = usePOs()
  const vendors = useVendors().data ?? []
  const nav = useNavigate()
  const [attention, setAttention] = useState(false)
  const v = (id: string) => vendors.find(x => x.id === id)
  const columns = useMemo<ColumnDef<PurchaseOrder, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { accessorKey: 'id', header: 'PO', cell: ({ getValue }) => <span className="font-mono font-medium">{getValue()}</span> },
    { id: 'vendor', header: 'Vendor', accessorFn: p => v(p.vendorId)?.name, cell: ({ row: { original: p } }) => <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="font-medium">{v(p.vendorId)?.name}</span>{v(p.vendorId)?.msme && <MsmeBadge cls={v(p.vendorId)!.msme!} />}</span> },
    { id: 'item', header: 'Material', accessorFn: p => p.lines[0].material, cell: ({ row: { original: p } }) => <span className="text-xs">{p.lines[0].material}<span className="text-text-3"> · {p.lines[0].ordered.toLocaleString('en-IN')} {p.lines[0].uom}</span></span> },
    { accessorKey: 'createdOn', header: 'Created', cell: ({ getValue }) => date(getValue()) },
    { accessorKey: 'value', header: 'PO value incl. GST', meta: { num: true }, cell: ({ getValue }) => inr(getValue()) },
    { id: 'stage', header: 'Stage', accessorFn: p => p.stages.findIndex(s => s.state === 'cur' || s.state === 'blk'), cell: ({ row: { original: p } }) => { const i = p.stages.findIndex(s => s.state === 'cur' || s.state === 'blk'); return <span className="text-xs whitespace-nowrap">{i + 1} of 9 · {p.stages[i]?.name ?? 'Done'}</span> } },
    { id: 'health', header: 'Status', accessorFn: p => poHealth(p).tone, cell: ({ row: { original: p } }) => <Pill s={poHealth(p)} /> },
    { accessorKey: 'elapsedDays', header: 'Elapsed', meta: { num: true }, cell: ({ getValue }) => `${getValue()} d` },
  ], [vendors]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader title="Purchase-to-pay" sub="Every open purchase order from negotiated terms to bank reconciliation. Click a PO to open its workbench." actions={<Source name="SAP" syncKey="sap" />} />
      <Q q={q}>{pos => {
        const list = attention ? pos.filter(p => poHealth(p).tone !== 'ok') : pos
        return <DataTable id="pos" data={list} columns={columns} getRowId={p => p.id} onRowClick={p => nav('/p2p/' + p.id)}
          toolbar={<><FilterChip on={!attention} onClick={() => setAttention(false)}>All open · {pos.length}</FilterChip><FilterChip on={attention} onClick={() => setAttention(true)}>Needs attention · {pos.filter(p => poHealth(p).tone !== 'ok').length}</FilterChip></>} />
      }}</Q>
    </>
  )
}
