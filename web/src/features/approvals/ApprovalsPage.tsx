import { Link } from 'react-router'
import { ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, EmptyState, PageHeader, Prio, Q } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useApprovals } from '@/api/hooks'
import { inr } from '@/lib/format'

export default function ApprovalsPage() {
  const q = useApprovals()
  const { user } = useSession()
  return (
    <>
      <PageHeader title="Approvals" sub={`Waiting for ${user.name} · ${user.title}`} />
      <Q q={q}>{({ invoices, exceptions }) => (invoices.length + exceptions.length === 0 ? (
        <Card><EmptyState title="Nothing waiting for you" icon={<Check className="size-5" />}>Payment runs, invoices above another person's limit and exceptions that need sign-off appear here.</EmptyState></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {invoices.length > 0 && (
            <Card>
              <CardHeader title="Invoices needing a second approver" as="h3" />
              {invoices.map(i => (
                <div key={i.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                  <div className="min-w-0 flex-1"><div className="font-mono font-medium">{i.invoiceNo}</div><div className="text-[11px] text-text-3">{i.vendorName} · {i.decision?.kind === 'dn' ? 'debit note raised' : 'approved'} by first approver</div></div>
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
