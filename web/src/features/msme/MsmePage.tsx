import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { CalendarClock, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Banner, Bar, DataTable, KpiCard, MsmeBadge, PageHeader, Pill, Q, Source } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useMsme, useVendors } from '@/api/hooks'
import * as api from '@/api'
import { date, daysBetween, daysFromNow, inr, todayIso } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import type { MsmeInvoice } from '@/lib/types'
import { cn } from '@/lib/utils'

export default function MsmePage() {
  const q = useMsme()
  const vendors = useVendors().data ?? []
  const { readOnly } = useSession()
  const { act } = useAct()
  const [sched, setSched] = useState<MsmeInvoice | null>(null)
  const [d, setD] = useState(todayIso())
  const v = (id: string) => vendors.find(x => x.id === id)
  const columns = useMemo<ColumnDef<MsmeInvoice, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { id: 'vendor', header: 'Vendor', accessorFn: m => v(m.vendorId)?.name, cell: ({ row: { original: m } }) => <span className="flex items-center gap-1.5 whitespace-nowrap"><Link to={'/vendors/' + m.vendorId} className="font-medium text-text">{v(m.vendorId)?.name}</Link>{v(m.vendorId)?.msme && <MsmeBadge cls={v(m.vendorId)!.msme!} />}</span> },
    { accessorKey: 'invoiceNo', header: 'Invoice no.', cell: ({ getValue }) => <span className="font-mono">{getValue()}</span> },
    { accessorKey: 'amount', header: 'Amount', meta: { num: true }, cell: ({ getValue }) => inr(getValue()) },
    { accessorKey: 'acceptedOn', header: 'Accepted', cell: ({ getValue }) => date(getValue()) },
    { id: 'clock', header: '45-day clock', accessorFn: m => m.paidOn ? 9999 : daysFromNow(m.limitOn), cell: ({ row: { original: m } }) => { if (m.paidOn) return <span className="text-xs text-text-3">Paid {date(m.paidOn)}</span>; const left = daysFromNow(m.limitOn); return <div className="w-36"><div className="flex justify-between text-[11px]"><span className={cn(left <= 7 ? 'font-medium text-bad' : 'text-text-2')}>{left < 0 ? `${-left} d past limit` : `${left} d left`}</span><span className="text-text-3">{date(m.limitOn)}</span></div><Bar pct={(daysBetween(m.acceptedOn, todayIso()) / 45) * 100} tone={left <= 7 ? 'bad' : left <= 15 ? 'warn' : 'ok'} /></div> } },
    { id: 'st', header: 'Payment', accessorFn: m => m.status.label, cell: ({ row: { original: m } }) => <Pill s={m.status} /> },
    { id: 'act', header: '', enableSorting: false, cell: ({ row: { original: m } }) => !m.paidOn && <Button size="sm" disabled={readOnly} onClick={() => { setD(m.limitOn < todayIso() ? todayIso() : m.limitOn); setSched(m) }}><CalendarClock />Schedule</Button> },
  ], [vendors, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader title="MSME tracker" sub="Invoices from micro and small enterprises: MSMED Act 45-day limit, Section 43B(h) and MSME Form 1." actions={<><Source name="Udyam" text="verified registrations" /><Source name="SAP" syncKey="sap" /></>} />
      <Q q={q}>{items => {
        const open = items.filter(m => !m.paidOn)
        const risk = open.filter(m => daysFromNow(m.limitOn) <= 7)
        return (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              <KpiCard k={{ id: 'open', label: 'Unpaid MSME invoices', value: open.reduce((s, m) => s + m.amount, 0), sub: `${open.length} invoices`, source: 'SAP', syncKey: 'sap' }} />
              <KpiCard k={{ id: 'risk', label: 'Limit within 7 days', value: risk.reduce((s, m) => s + m.amount, 0), sub: `${risk.length} invoices`, source: 'SAP', syncKey: 'sap', tone: risk.length ? 'bad' : undefined, status: risk.length ? 'Pay or reschedule' : undefined }} />
              <KpiCard k={{ id: 'form', label: 'MSME Form 1 (Apr–Sep)', value: daysFromNow('2026-10-31'), unit: 'days', sub: 'Due 31-10-2026 · draft lists 6 vendors', source: 'MCA', syncKey: 'sap', tone: 'warn', status: 'Draft' }} />
            </div>
            {risk.length > 0 && <Banner tone="bad">{risk.length} invoice{risk.length > 1 ? 's are' : ' is'} scheduled after, or within a week of, the 45-day limit. Late payment carries compound interest at 3× the RBI bank rate and the expense is disallowed under 43B(h) until paid.</Banner>}
            <DataTable id="msme" data={items} columns={columns} getRowId={m => m.id} initialSort={[{ id: 'clock', desc: false }]}
              toolbar={<Button size="sm" onClick={() => downloadCsv('msme-form-1-draft.csv', ['Vendor', 'Udyam', 'Invoice', 'Amount', 'Accepted', 'Limit', 'Status'], items.map(m => [v(m.vendorId)?.name, v(m.vendorId)?.udyam, m.invoiceNo, m.amount, date(m.acceptedOn), date(m.limitOn), m.status.label]))}><Download />MSME Form 1 draft</Button>} />
          </>
        )
      }}</Q>
      <Dialog open={!!sched} onOpenChange={o => !o && setSched(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Schedule manual payment</DialogTitle><DialogDescription>{sched && `${v(sched.vendorId)?.name} · ${sched.invoiceNo} · ${inr(sched.amount)} · limit ${date(sched.limitOn)}`}</DialogDescription></DialogHeader>
          <Input type="date" value={d} min={todayIso()} onChange={e => setD(e.target.value)} />
          {sched && d > sched.limitOn && <Banner tone="warn">This date is after the 45-day limit.</Banner>}
          <DialogFooter><Button variant="ghost" onClick={() => setSched(null)}>Cancel</Button><Button variant="default" onClick={async () => { if (sched && await act(() => api.scheduleMsmePayment(sched.id, d), 'Payment scheduled')) setSched(null) }}>Schedule</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
