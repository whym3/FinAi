import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { ChevronDown, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Banner, DataTable, FilterChip, KpiCard, PageHeader, Pill, Q, Source } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useAr, useCustomers } from '@/api/hooks'
import * as api from '@/api'
import { addDays, date, daysBetween, inr, todayIso } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import type { ArItem } from '@/lib/types'
import { cn } from '@/lib/utils'

export default function ReceivablesPage() {
  const q = useAr()
  const customers = useCustomers().data ?? []
  const { readOnly } = useSession()
  const { act } = useAct()
  const [sp, setSp] = useSearchParams()
  const focus = sp.get('c')
  const [bucket, setBucket] = useState<'all' | 'current' | '0-30' | '31-90' | '90+'>('all')
  const [text, setText] = useState('')
  const [ask, setAsk] = useState<{ a: ArItem; kind: 'promise' | 'dispute' } | null>(null)
  const [val, setVal] = useState('')
  const cname = (id: string) => customers.find(c => c.id === id)?.name ?? id
  const overdue = (a: ArItem) => (a.due ? Math.max(0, daysBetween(a.due, todayIso())) : 0)
  const openOf = (a: ArItem) => (a.docType === 'credit_memo' ? -1 : 1) * (a.amount - a.received)
  const columns = useMemo<ColumnDef<ArItem, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { id: 'cust', header: 'Customer', accessorFn: a => a.customer || cname(a.customerId), cell: ({ getValue }) => <span className="font-medium whitespace-nowrap">{getValue()}</span> },
    { accessorKey: 'invoiceNo', header: 'Invoice no.', cell: ({ row: { original: a } }) => <span className="font-mono">{a.gstInvoiceNo || a.invoiceNo}{a.docType === 'credit_memo' && <span className="ml-1 font-sans text-[11px] text-text-3">credit memo</span>}</span> },
    { accessorKey: 'state', header: 'State', cell: ({ getValue }) => <span className="text-text-2">{getValue() ?? ''}</span> },
    { accessorKey: 'date', header: 'Invoice date', cell: ({ getValue }) => date(getValue()) },
    { accessorKey: 'due', header: 'Due', cell: ({ getValue }) => date(getValue()) },
    { id: 'days', header: 'Days overdue', meta: { num: true }, accessorFn: overdue, cell: ({ getValue }) => <span className={cn(getValue() > 90 ? 'font-medium text-bad' : getValue() > 45 ? 'font-medium text-warn' : '')}>{getValue()}</span> },
    { id: 'open', header: 'Open', meta: { num: true }, accessorFn: openOf, cell: ({ getValue }) => inr(getValue()) },
    { id: 'st', header: 'Follow-up', accessorFn: a => a.status.label, cell: ({ row: { original: a } }) => <div><Pill s={a.status} />{a.lastAction && <div className="mt-0.5 text-[11px] text-text-3">{a.lastAction}</div>}</div> },
    { id: 'act', header: '', enableSorting: false, cell: ({ row: { original: a } }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" disabled={readOnly} onClick={e => e.stopPropagation()}>Follow up<ChevronDown /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => act(() => api.logFollowUp(a.id, 'reminder', ''), 'Reminder sent to ' + (a.customer || cname(a.customerId)))}>Send reminder</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { setVal(addDays(todayIso(), 7)); setAsk({ a, kind: 'promise' }) }}>Record promise to pay</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { setVal(''); setAsk({ a, kind: 'dispute' }) }}>Mark disputed</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => act(() => api.logFollowUp(a.id, 'escalate', ''), 'Escalated to the CFO')}>Escalate to CFO</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) },
  ], [customers, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader title="Receivables" sub="Customer invoices from the sales register, with follow-ups. Due date = invoice date + the customer's credit days." actions={<Source name="SAP" syncKey="sap" />} />
      <Q q={q}>{({ items, total }) => {
        const t = text.trim().toLowerCase()
        const list = items.filter(a => (!focus || a.customerId === focus) && (!t || `${a.customer} ${a.invoiceNo} ${a.gstInvoiceNo ?? ''} ${a.state ?? ''}`.toLowerCase().includes(t))
          && (bucket === 'all' || (bucket === 'current' && overdue(a) === 0) || (bucket === '0-30' && overdue(a) > 0 && overdue(a) <= 30) || (bucket === '31-90' && overdue(a) > 30 && overdue(a) <= 90) || (bucket === '90+' && overdue(a) > 90)))
        const open = items.reduce((s, a) => s + openOf(a), 0)
        const over = items.filter(a => overdue(a) > 0 && a.docType !== 'credit_memo')
        return (
          <>
            {items.length > 0 && <Banner tone="info">Collections are not imported yet, so outstanding assumes nothing has been paid. Import customer open items (Imports page) or connect the bank to apply receipts.</Banner>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              <KpiCard k={{ id: 'o', label: 'Receivables outstanding', value: open, sub: `${total.toLocaleString('en-IN')} invoices · ${new Set(items.map(a => a.customerId)).size} customers`, source: 'SAP', syncKey: 'sap' }} />
              <KpiCard k={{ id: 'od', label: 'Overdue', value: over.reduce((s, a) => s + openOf(a), 0), sub: `${over.length} invoices past due date`, source: 'SAP', syncKey: 'sap', tone: over.length ? 'bad' : undefined }} />
              <KpiCard k={{ id: '90', label: 'Over 90 days', value: items.filter(a => overdue(a) > 90).reduce((s, a) => s + openOf(a), 0), sub: `${items.filter(a => overdue(a) > 90).length} invoices`, source: 'SAP', syncKey: 'sap', tone: 'bad' }} />
              <KpiCard k={{ id: 'd', label: 'Disputed', value: items.filter(a => a.status.label.startsWith('Disputed')).reduce((s, a) => s + openOf(a), 0), sub: 'reported separately in Schedule III', source: 'SAP', syncKey: 'sap', tone: 'warn' }} />
            </div>
            <DataTable id="ar" data={list} columns={columns} getRowId={a => a.id} initialSort={[{ id: 'days', desc: true }]}
              toolbar={<>
                {focus && <FilterChip on onClick={() => setSp({}, { replace: true })}>{cname(focus)} ×</FilterChip>}
                <Input value={text} onChange={e => setText(e.target.value)} placeholder="Customer, invoice no., state" className="h-8 w-[220px] text-xs" aria-label="Search receivables" />
                {(['all', 'current', '0-30', '31-90', '90+'] as const).map(b => <FilterChip key={b} on={bucket === b} onClick={() => setBucket(b)}>{b === 'all' ? 'All open' : b === 'current' ? 'Not yet due' : b + ' days overdue'}</FilterChip>)}
                <Button size="sm" onClick={() => downloadCsv('receivables.csv', ['Customer', 'Invoice', 'GST invoice', 'Date', 'Due', 'Days overdue', 'Open', 'Follow-up'], list.map(a => [a.customer || cname(a.customerId), a.invoiceNo, a.gstInvoiceNo, date(a.date), date(a.due), overdue(a), openOf(a), a.status.label]))}><Download />Export</Button>
              </>}
              footer={<tr><td colSpan={6}>{list.length.toLocaleString('en-IN')} invoices</td><td className="text-right tabular-nums">{inr(list.reduce((s, a) => s + openOf(a), 0))}</td><td colSpan={2} /></tr>} />
          </>
        )
      }}</Q>
      <Dialog open={!!ask} onOpenChange={o => !o && setAsk(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{ask?.kind === 'promise' ? 'Record promise to pay' : 'Mark disputed'}</DialogTitle><DialogDescription>{ask && `${ask.a.customer || cname(ask.a.customerId)} · ${ask.a.invoiceNo} · ${inr(ask.a.amount)}`}</DialogDescription></DialogHeader>
          {ask?.kind === 'promise' ? <Input type="date" value={val} min={todayIso()} onChange={e => setVal(e.target.value)} /> : <Input placeholder="Reason, e.g. short supply" value={val} onChange={e => setVal(e.target.value)} />}
          <DialogFooter><Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button><Button variant="default" disabled={!val} onClick={async () => { if (ask && await act(() => api.logFollowUp(ask.a.id, ask.kind, ask.kind === 'promise' ? date(val) : val), 'Follow-up recorded')) setAsk(null) }}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
