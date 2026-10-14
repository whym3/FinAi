import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowRight, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, DataTable, FilterChip, LineTabs, MsmeBadge, PageHeader, Pill, Q, Source, KpiCard } from '@/components/pravah'
import { useAp, useRuns, useVendors } from '@/api/hooks'
import { date, daysFromNow, inr } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import type { ApItem, PaymentRun, Status } from '@/lib/types'

export function runStatus(r: PaymentRun): Status {
  return ({
    draft: { tone: 'none', label: 'Draft' },
    'awaiting-approval': { tone: 'warn', label: `Awaiting approval · ${r.approvers.filter(a => a.status === 'approved').length} of ${r.approvers.length}` },
    released: { tone: 'ok', label: 'Released to bank' },
    'sent-back': { tone: 'bad', label: 'Sent back' },
  } as const)[r.status]
}

export default function PayablesPage() {
  const runs = useRuns()
  const ap = useAp()
  const vendors = useVendors().data ?? []
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') ?? 'runs') as 'runs' | 'due'
  const [f, setF] = useState<'all' | 'overdue' | 'msme' | 'unscheduled' | 'held'>('all')
  const vname = (id: string) => vendors.find(v => v.id === id)?.name ?? id

  const runCols = useMemo<ColumnDef<PaymentRun, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { accessorKey: 'id', header: 'Run', cell: ({ getValue }) => <span className="font-mono font-medium">{getValue()}</span> },
    { accessorKey: 'valueDate', header: 'Value date', cell: ({ getValue }) => date(getValue()) },
    { id: 'from', header: 'From account', accessorFn: r => r.bank, cell: ({ row: { original: r } }) => <span className="text-xs">{r.bank} <span className="font-mono">{r.account}</span></span> },
    { accessorKey: 'invoices', header: 'Invoices', meta: { num: true } },
    { accessorKey: 'vendors', header: 'Vendors', meta: { num: true } },
    { accessorKey: 'net', header: 'Net payable', meta: { num: true }, cell: ({ getValue }) => <span className="font-medium">{inr(getValue())}</span> },
    { id: 'approvers', header: 'Approvals', accessorFn: r => r.approvers.filter(a => a.status === 'approved').length, cell: ({ row: { original: r } }) => <span className="flex gap-1">{r.approvers.map(a => <span key={a.userId} className={a.status === 'approved' ? '' : 'opacity-40'} title={a.status}><Avatar id={a.userId} /></span>)}</span> },
    { id: 'status', header: 'Status', accessorFn: r => r.status, cell: ({ row: { original: r } }) => <Pill s={runStatus(r)} /> },
    { id: 'go', header: '', enableSorting: false, cell: () => <ArrowRight className="size-4 text-text-3" /> },
  ], [])

  const apCols = useMemo<ColumnDef<ApItem, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { id: 'vendor', header: 'Vendor', accessorFn: a => vname(a.vendorId), cell: ({ row: { original: a } }) => <span className="flex items-center gap-1.5 whitespace-nowrap"><Link to={'/vendors/' + a.vendorId} className="font-medium text-text" onClick={e => e.stopPropagation()}>{vname(a.vendorId)}</Link>{a.msme && <MsmeBadge cls={a.msme} />}</span> },
    { accessorKey: 'invoiceNo', header: 'Invoice no.', cell: ({ getValue }) => <span className="font-mono">{getValue()}</span> },
    { accessorKey: 'date', header: 'Invoice date', cell: ({ getValue }) => date(getValue()) },
    { accessorKey: 'due', header: 'Due', cell: ({ getValue }) => { const d = daysFromNow(getValue()); return <span className="whitespace-nowrap">{date(getValue())} <span className={d < 0 ? 'text-bad' : 'text-text-3'}>· {d < 0 ? `${-d} d overdue` : `in ${d} d`}</span></span> } },
    { accessorKey: 'amount', header: 'Amount', meta: { num: true }, cell: ({ getValue }) => inr(getValue()) },
    { accessorKey: 'tds', header: 'TDS', meta: { num: true }, cell: ({ getValue }) => getValue() ? inr(getValue()) : <span className="text-text-3">—</span> },
    { accessorKey: 'runId', header: 'Payment run', cell: ({ getValue }) => getValue() ? <Link to={'/payables/runs/' + getValue()} className="font-mono text-xs" onClick={e => e.stopPropagation()}>{getValue()}</Link> : <span className="text-xs text-text-3">Not scheduled</span> },
    { id: 'status', header: 'Status', accessorFn: a => a.status.label, cell: ({ row: { original: a } }) => <Pill s={a.status} /> },
  ], [vendors]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title="Payables & payment runs" sub="Runs are proposed in SAP (F110), checked here and released to the bank host-to-host after the approvals they need." actions={<Source name="SAP" syncKey="sap" />} />
      <LineTabs label="Payables" value={tab} onChange={v => setSp({ tab: v }, { replace: true })} items={[{ value: 'runs', label: 'Payment runs', count: runs.data?.filter(r => r.status === 'awaiting-approval').length }, { value: 'due', label: 'Invoices due', count: ap.data?.length }]} />
      {tab === 'runs' ? (
        <Q q={runs}>{list => (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {list.filter(r => r.status !== 'released').map(r => (
                <KpiCard key={r.id} k={{ id: r.id, label: `${r.id} · value date ${date(r.valueDate)}`, value: r.net, sub: `${r.invoices} invoices · ${r.vendors} vendors`, source: 'SAP', syncKey: 'sap', tone: r.status === 'awaiting-approval' ? 'warn' : r.status === 'sent-back' ? 'bad' : undefined, status: runStatus(r).label, link: '/payables/runs/' + r.id }} />
              ))}
            </div>
            <DataTable id="runs" data={list} columns={runCols} getRowId={r => r.id} onRowClick={r => nav('/payables/runs/' + r.id)} initialSort={[{ id: 'valueDate', desc: true }]} toolbar={null} />
          </>
        )}</Q>
      ) : (
        <Q q={ap}>{items => {
          const list = items.filter(a => f === 'all' || (f === 'overdue' && daysFromNow(a.due) < 0) || (f === 'msme' && !!a.msme) || (f === 'unscheduled' && !a.runId) || (f === 'held' && a.status.label.startsWith('Held')))
          return (
            <DataTable id="ap" data={list} columns={apCols} getRowId={a => a.id} initialSort={[{ id: 'due', desc: false }]}
              toolbar={<>
                {(['all', 'overdue', 'msme', 'unscheduled', 'held'] as const).map(k => <FilterChip key={k} on={f === k} onClick={() => setF(k)}>{{ all: 'All', overdue: 'Overdue', msme: 'MSME', unscheduled: 'Not scheduled', held: 'Held' }[k]} · {items.filter(a => k === 'all' || (k === 'overdue' && daysFromNow(a.due) < 0) || (k === 'msme' && !!a.msme) || (k === 'unscheduled' && !a.runId) || (k === 'held' && a.status.label.startsWith('Held'))).length}</FilterChip>)}
                <Button size="sm" onClick={() => downloadCsv('invoices-due.csv', ['Vendor', 'Invoice', 'Due', 'Amount', 'TDS', 'Run', 'Status'], list.map(a => [vname(a.vendorId), a.invoiceNo, date(a.due), a.amount, a.tds, a.runId ?? '', a.status.label]))}><Download />Export</Button>
              </>}
              footer={<tr><td colSpan={4}>{list.length} invoices</td><td className="text-right tabular-nums">{inr(list.reduce((s, a) => s + a.amount, 0))}</td><td className="text-right tabular-nums">{inr(list.reduce((s, a) => s + a.tds, 0))}</td><td colSpan={2} /></tr>} />
          )
        }}</Q>
      )}
    </>
  )
}
