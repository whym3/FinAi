import { Link } from 'react-router'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, EmptyState, PageHeader, Prio, Q } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useApprovals, useVendors } from '@/mock/hooks'
import { date, inr } from '@/lib/format'

export default function ApprovalsPage() {
  const q = useApprovals()
  const { user } = useSession()
  const vendors = useVendors().data ?? []
  return (
    <>
      <PageHeader title="Approvals" sub={`Waiting for ${user.name} · ${user.title}`} />
      <Q q={q}>{({ runs, invoices, exceptions }) => (runs.length + invoices.length + exceptions.length === 0 ? (
        <Card><EmptyState title="Nothing waiting for you" icon={<Check className="size-5" />}>Payment runs, invoices above another person's limit and exceptions that need sign-off appear here. Use the user menu to act as the Controller or CFO.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {runs.length > 0 && (
            <Card>
              <CardHeader title="Payment runs" as="h3" />
              {runs.map(r => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1"><div className="font-medium">{r.id}</div><div className="text-[11px] text-text-3">{r.invoices} invoices · {r.vendors} vendors · value date {date(r.valueDate)}</div></div>
                  <span className="font-semibold tabular-nums">{inr(r.net)}</span>
                  <Button variant="default" asChild><Link to={'/payables/runs/' + r.id}>Review and approve<ArrowRight /></Link></Button>
                </div>
              ))}
            </Card>
          )}
          {invoices.length > 0 && (
            <Card>
              <CardHeader title="Invoices needing a second approver" as="h3" />
              {invoices.map(i => (
                <div key={i.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1"><div className="font-mono font-medium">{i.invoiceNo}</div><div className="text-[11px] text-text-3">{vendors.find(v => v.id === i.vendorId)?.name} · {i.decision?.kind === 'dn' ? 'debit note raised' : 'approved'} by first approver</div></div>
                  <span className="font-semibold tabular-nums">{inr(i.total)}</span>
                  <Button asChild><Link to={'/review/' + i.id}>Open<ArrowRight /></Link></Button>
                </div>
              ))}
            </Card>
          )}
          {exceptions.length > 0 && (
            <Card>
              <CardHeader title="Exceptions awaiting approval" as="h3" />
              {exceptions.map(x => (
                <div key={x.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                  <Prio p={x.priority} label={false} />
                  <div className="min-w-0 flex-1"><div className="text-[11px] text-text-3">{x.id} · {x.type}</div><div className="font-medium">{x.title}</div></div>
                  <span className="tabular-nums">{inr(x.amount)}</span>
                  <Button asChild><Link to={'/exceptions?ex=' + x.id}>Open<ArrowRight /></Link></Button>
                </div>
              ))}
            </Card>
          )}
        </div>
      ))}</Q>
    </>
  )
}
