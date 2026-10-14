import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable, Gstin, PageHeader, Pill, Q, Source } from '@/components/pravah'
import { useCustomers } from '@/api/hooks'
import { inr } from '@/lib/format'
import type { Customer } from '@/lib/types'
import { cn } from '@/lib/utils'

export default function CustomersPage() {
  const q = useCustomers()
  const nav = useNavigate()
  const columns = useMemo<ColumnDef<Customer, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { accessorKey: 'code', header: 'Customer', cell: ({ getValue }) => <span className="font-mono">{getValue() ?? '—'}</span> },
    { accessorKey: 'name', header: 'Name', cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { accessorKey: 'gstin', header: 'GSTIN', cell: ({ getValue }) => <Gstin g={getValue()} /> },
    { accessorKey: 'creditDays', header: 'Credit', meta: { num: true }, cell: ({ getValue }) => `${getValue()} d` },
    { accessorKey: 'outstanding', header: 'Outstanding', meta: { num: true }, cell: ({ getValue }) => inr(getValue()) },
    { accessorKey: 'overdue', header: 'Overdue', meta: { num: true }, cell: ({ getValue }) => inr(getValue()) },
    { accessorKey: 'daysOverdue', header: 'Days', meta: { num: true }, cell: ({ getValue }) => <span className={cn(getValue() > 90 ? 'font-medium text-bad' : getValue() > 45 ? 'font-medium text-warn' : '')}>{getValue()}</span> },
    { id: 'f', header: 'Follow-up', accessorFn: c => c.followUp.label, cell: ({ row: { original: c } }) => <Pill s={c.followUp} /> },
    { accessorKey: 'contact', header: 'Contact', meta: { hidden: true, label: 'Contact' }, cell: ({ getValue }) => <span className="text-xs">{getValue()}</span> },
  ], [])
  return (
    <>
      <PageHeader title="Customers" sub="Customer master from SAP. Click a customer to see their open invoices." actions={<Source name="SAP" syncKey="sap" />} />
      <Q q={q}>{list => <DataTable id="customers" data={list} columns={columns} getRowId={c => c.id} onRowClick={c => nav('/receivables?c=' + c.id)} initialSort={[{ id: 'overdue', desc: true }]} toolbar={null} />}</Q>
    </>
  )
}
