import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable, FilterChip, Gstin, MsmeBadge, PageHeader, Pill, Q, Source, StatusPill } from '@/components/pravah'
import { useVendors } from '@/api/hooks'
import { inr } from '@/lib/format'
import type { Vendor } from '@/lib/types'

export default function VendorsPage() {
  const q = useVendors()
  const nav = useNavigate()
  const [f, setF] = useState<'all' | 'msme' | 'blocked' | 'rcm'>('all')
  const columns = useMemo<ColumnDef<Vendor, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { accessorKey: 'code', header: 'Vendor', cell: ({ getValue }) => <span className="font-mono">{getValue() ?? '—'}</span> },
    { accessorKey: 'name', header: 'Name', cell: ({ row: { original: v } }) => <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="font-medium">{v.name}</span>{v.msme && <MsmeBadge cls={v.msme} />}{v.tags.map(t => <span key={t} className="rounded-sm bg-acc-weak px-1.5 text-[11px] font-semibold text-acc">{t}</span>)}</span> },
    { accessorKey: 'gstin', header: 'GSTIN', cell: ({ getValue }) => <Gstin g={getValue()} /> },
    { accessorKey: 'gstinStatus', header: 'GST registration', cell: ({ getValue }) => <StatusPill tone={getValue() === 'Active' ? 'ok' : 'bad'}>{getValue()}</StatusPill> },
    { accessorKey: 'paymentTermsDays', header: 'Terms', meta: { num: true }, cell: ({ getValue }) => `${getValue()} d` },
    { accessorKey: 'outstanding', header: 'Outstanding', meta: { num: true }, cell: ({ getValue }) => inr(getValue()) },
    { accessorKey: 'overdue', header: 'Overdue', meta: { num: true }, cell: ({ getValue }) => <span className={getValue() ? 'text-bad' : 'text-text-3'}>{inr(getValue())}</span> },
    { id: 'st', header: 'Status', accessorFn: v => v.status.label, cell: ({ row: { original: v } }) => <Pill s={v.status} /> },
    { accessorKey: 'ytdPurchases', header: 'Purchases FY to date', meta: { num: true, hidden: true, label: 'Purchases FY to date' }, cell: ({ getValue }) => inr(getValue()) },
  ], [])
  return (
    <>
      <PageHeader title="Vendors" sub="Vendor master from SAP with GST, MSME and bank checks." actions={<Source name="SAP" syncKey="sap" />} />
      <Q q={q}>{vs => {
        const list = vs.filter(v => f === 'all' || (f === 'msme' && v.msme) || (f === 'blocked' && v.blocked) || (f === 'rcm' && v.tags.includes('RCM')))
        return <DataTable id="vendors" data={list} columns={columns} getRowId={v => v.id} onRowClick={v => nav('/vendors/' + v.id)} initialSort={[{ id: 'outstanding', desc: true }]}
          toolbar={<>{(['all', 'msme', 'blocked', 'rcm'] as const).map(k => <FilterChip key={k} on={f === k} onClick={() => setF(k)}>{{ all: 'All', msme: 'MSME', blocked: 'Payments blocked', rcm: 'Reverse charge' }[k]} · {vs.filter(v => k === 'all' || (k === 'msme' && v.msme) || (k === 'blocked' && v.blocked) || (k === 'rcm' && v.tags.includes('RCM'))).length}</FilterChip>)}</>} />
      }}</Q>
    </>
  )
}
