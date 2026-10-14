import { Link, useParams } from 'react-router'
import { Lock } from 'lucide-react'
import { Banner, Card, CardBody, CardHeader, Gstin, KV, MsmeBadge, PageHeader, Pill, Q, Source, StatusPill, Prio } from '@/components/pravah'
import { useVendor } from '@/api/hooks'
import { date, inr } from '@/lib/format'
import { invoiceStatus } from '@/features/review/ReviewQueuePage'
import { poHealth } from '@/features/p2p/P2PListPage'

const T = 'w-full border-separate border-spacing-0 text-[12.5px] [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:text-text-2'

export default function VendorPage() {
  const { vendorId = '' } = useParams()
  const q = useVendor(vendorId)
  return (
    <Q q={q}>{({ vendor: v, pos, invoices, ap, exceptions, msme }) => (
      <>
        <PageHeader crumbs={[{ label: 'Vendors', to: '/vendors' }, { label: v.name }]} title={v.name}
          badges={<>{v.msme && <MsmeBadge cls={v.msme} udyam={!!v.udyam} />}<Pill s={v.status} /></>}
          meta={<><span className="font-mono">Vendor {v.code ?? v.id}</span><Gstin g={v.gstin} state={v.gstinStatus} /><span>PAN <span className="font-mono">{v.pan}</span></span><Source name="SAP" syncKey="sap" /></>} />
        {v.blocked && <Banner tone="bad" icon={<Lock className="size-4" />}>Payments to this vendor are blocked until the bank-detail change is verified. {exceptions[0] && <Link to={'/exceptions?ex=' + exceptions[0].id}>Open {exceptions[0].id}</Link>}</Banner>}
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-4">
            <Card>
              <CardHeader title="Purchase orders" as="h3" />
              {pos.length ? <div className="overflow-auto"><table className={T}><thead><tr><th>PO</th><th>Material</th><th className="text-right!">Value</th><th>Status</th></tr></thead><tbody>{pos.map(p => <tr key={p.id}><td><Link to={'/p2p/' + p.id} className="font-mono">{p.poNo}</Link></td><td>{p.lines[0]?.material ?? '—'}</td><td className="text-right tabular-nums">{inr(p.value)}</td><td><Pill s={poHealth(p)} /></td></tr>)}</tbody></table></div> : <CardBody className="text-xs text-text-3">No open POs.</CardBody>}
            </Card>
            <Card>
              <CardHeader title="Invoices in review" as="h3" />
              {invoices.length ? <div className="overflow-auto"><table className={T}><thead><tr><th>Invoice</th><th>Date</th><th className="text-right!">Total</th><th>Status</th></tr></thead><tbody>{invoices.map(i => <tr key={i.id}><td><Link to={'/review/' + i.id} className="font-mono">{i.invoiceNo}</Link></td><td>{date(i.date)}</td><td className="text-right tabular-nums">{inr(i.total)}</td><td><Pill s={invoiceStatus(i)} /></td></tr>)}</tbody></table></div> : <CardBody className="text-xs text-text-3">Nothing in review.</CardBody>}
            </Card>
            <Card>
              <CardHeader title="Open payables" as="h3"><Link to="/payables?tab=due" className="text-xs">All payables</Link></CardHeader>
              {ap.length ? <div className="overflow-auto"><table className={T}><thead><tr><th>Invoice</th><th>Due</th><th className="text-right!">Amount</th><th>Run</th><th>Status</th></tr></thead><tbody>{ap.map(a => <tr key={a.id}><td className="font-mono">{a.invoiceNo}</td><td>{date(a.due)}</td><td className="text-right tabular-nums">{inr(a.amount)}</td><td className="font-mono text-xs">{a.runId ? <Link to={'/payables/runs/' + a.runId}>{a.runId}</Link> : '—'}</td><td><Pill s={a.status} /></td></tr>)}</tbody></table></div> : <CardBody className="text-xs text-text-3">No open payables.</CardBody>}
            </Card>
            {exceptions.length > 0 && (
              <Card>
                <CardHeader title="Exceptions" as="h3" />
                {exceptions.map(x => <Link key={x.id} to={'/exceptions?ex=' + x.id} className="flex items-center gap-2.5 border-b border-border px-4 py-2.5 text-text no-underline last:border-b-0 hover:bg-surface-2 hover:text-text"><Prio p={x.priority} label={false} /><span className="flex-1"><span className="block text-[11px] text-text-3">{x.id} · {x.type}</span><span className="text-xs font-medium">{x.title}</span></span><StatusPill tone={x.status === 'resolved' ? 'ok' : 'warn'}>{x.status === 'resolved' ? 'Resolved' : 'Open'}</StatusPill></Link>)}
              </Card>
            )}
          </div>
          <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
            <Card>
              <CardHeader title="Master data" as="h3"><Source name="SAP" text="vendor master" /></CardHeader>
              <CardBody><KV items={[['Email', v.email], ['Phone', v.phone], ['Payment terms', `${v.paymentTermsDays} days`], ['TDS', v.tdsSection ?? '—'], ['Outstanding', inr(v.outstanding), 'text-right tabular-nums'], ['Overdue', <span className={v.overdue ? 'text-bad' : ''}>{inr(v.overdue)}</span>, 'text-right tabular-nums'], ['Purchases FY to date', inr(v.ytdPurchases), 'text-right tabular-nums']]} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Bank account" as="h3"><Source name="SAP" text="vendor master" /></CardHeader>
              <CardBody><KV items={[['Bank', v.bank.bank ? `${v.bank.bank}${v.bank.branch ? ', ' + v.bank.branch : ''}` : '—'], ['IFSC', <span className="font-mono">{v.bank.ifsc || '—'}</span>], ['Account', v.bank.account ? <span className="font-mono">••••{v.bank.account.slice(-4)}</span> : '—'], ['Name at bank', v.bank.nameAtBank || '—']]} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="GST & MSME" as="h3"><Source name="GST portal" syncKey="gst" /></CardHeader>
              <CardBody className="flex flex-col gap-3">
                <KV items={[['Registration', <StatusPill tone={v.gstinStatus === 'Active' ? 'ok' : 'bad'}>{v.gstinStatus}</StatusPill>], ['GSTR-1 on time', v.filing.of ? `${v.filing.onTime} of ${v.filing.of} months` : '—'], ['Udyam', v.udyam ? <span className="font-mono text-[11px]">{v.udyam}</span> : 'Not registered'], ['Verified', v.udyamVerifiedOn ? date(v.udyamVerifiedOn) : '—']]} />
                {msme.length > 0 && <div className="text-[11px] text-text-2">{msme.filter(m => !m.paidOn).length} unpaid MSME invoice(s) · next limit {date(msme.filter(m => !m.paidOn).sort((a, b) => a.limitOn.localeCompare(b.limitOn))[0]?.limitOn)}</div>}
              </CardBody>
            </Card>
          </div>
        </div>
      </>
    )}</Q>
  )
}
