import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Check, Download, Info, Pause, Receipt, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Avatar, Banner, BulkBar, Card, CardBody, CardFooter, CardHeader, Chip, DataTable, EmptyState, FilterChip, Gstin, KV, LineTabs, PageHeader, Pill, Q, Segmented, Source, Spacer, StatusPill, toneIcon, toneText,
} from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useGst } from '@/api/hooks'
import * as api from '@/api'
import { date, dateTime, dayMonthTime, inr, int, todayIso } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import type { ImsAction, ImsRow, OutwardDoc, Vendor } from '@/lib/types'
import { cn } from '@/lib/utils'

type Tab = 'ims' | 'gstr1' | 'gstr3b' | 'einv' | 'rcm' | 'suppliers'
const TABS: { value: Tab; label: string }[] = [
  { value: 'ims', label: 'IMS & GSTR-2B' }, { value: 'gstr1', label: 'GSTR-1' }, { value: 'gstr3b', label: 'GSTR-3B' },
  { value: 'einv', label: 'E-invoice & e-way bill' }, { value: 'rcm', label: 'Reverse charge' }, { value: 'suppliers', label: 'Supplier compliance' },
]

export default function GstPage() {
  const { entity, period, sync } = useSession()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') ?? 'ims') as Tab
  const gstin = sp.get('gstin') ?? entity.gstins[0]?.gstin ?? ''
  const g = entity.gstins.find(x => x.gstin === gstin) ?? entity.gstins[0] ?? { gstin: '', code: '', state: '' }
  const set = (k: string, v: string) => setSp(p => { const n = new URLSearchParams(p); n.set(k, v); return n }, { replace: true })
  const q = useGst(g.gstin)
  const gs = sync.find(s => s.key === 'gst')
  return (
    <>
      <PageHeader crumbs={[{ label: 'GST hub', to: '/gst' }, { label: TABS.find(t => t.value === tab)!.label }]} title={TABS.find(t => t.value === tab)!.label}
        badges={<><Gstin g={g.gstin} state={`${g.code} · ${g.state}`} /><Chip>Return period {period}</Chip></>}
        actions={<>
          {entity.gstins.length > 1 && <Segmented label="GSTIN" value={g.gstin} onChange={v => set('gstin', v)} options={entity.gstins.map(x => ({ value: x.gstin, label: `${x.code} · ${x.state}` }))} />}
          <Source name="GST portal" syncKey="gst" text={gs?.at ? `IMS synced ${dateTime(gs.at)}` : 'not connected'} />
          <Button asChild><Link to="/settings/integrations">Connect GST portal</Link></Button>
        </>} />
      <LineTabs label="GST hub sections" value={tab} onChange={v => set('tab', v)} items={TABS} />
      <Q q={q}>{d => (
        tab === 'ims' ? (d.summary ? <Ims rows={d.rows} summary={d.summary} gstin={g.gstin} /> : <Card><EmptyState title="GST portal not connected" icon={<Receipt className="size-5" />} action={<Button size="sm" asChild><Link to="/settings/integrations">Integrations</Link></Button>}>IMS documents, GSTR-2B and supplier filing status arrive through a GST Suvidha Provider. Until then, GSTR-1 and e-invoice tabs show your sales register, and supplier invoices are matched against POs and GRNs.</EmptyState></Card>) :
        tab === 'gstr1' ? <Gstr1 docs={d.outward} gstin={g.gstin} /> :
        tab === 'gstr3b' ? <Gstr3b outward={d.outward} rows={d.rows} summary={d.summary} /> :
        tab === 'einv' ? <EInvoice docs={d.outward} /> :
        tab === 'rcm' ? <Rcm lrs={d.rcmLrs} summary={d.summary} /> :
        <Suppliers vendors={d.suppliers} />
      )}</Q>
    </>
  )
}

/* ================= IMS & GSTR-2B ================= */

type Filter = 'all' | 'noaction' | 'differs' | 'matched' | 'partial' | 'notbooks'

function Ims({ rows, summary, gstin }: { rows: ImsRow[]; summary: NonNullable<Awaited<ReturnType<typeof api.getGst>>['summary']>; gstin: string }) {
  const { entity, users, readOnly, period } = useSession()
  const { act, pending } = useAct()
  const [filter, setFilter] = useState<Filter>('all')
  const [suppliers, setSuppliers] = useState<string[]>([])
  const dirty = rows.filter(r => r.dirty).length
  const recCount = rows.filter(r => r.portal === 'No action' && !r.final).length
  const list = rows.filter(r =>
    (!suppliers.length || suppliers.includes(r.supplier)) &&
    (filter === 'all' || (filter === 'noaction' && r.portal === 'No action') || (filter === 'differs' && !!r.final && r.final !== r.recommended) ||
      (filter === 'matched' && r.match.tone === 'ok') || (filter === 'partial' && r.match.tone === 'warn') || (filter === 'notbooks' && r.match.tone === 'bad')))
  const setFinal = (ids: string[], a: ImsAction) => act(() => api.setImsFinal(ids, a))
  const portalTone = { 'No action': 'none', Accepted: 'ok', Rejected: 'bad', Pending: 'warn' } as const

  const columns = useMemo<ColumnDef<ImsRow, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { id: 'doc', header: 'Supplier & document', accessorFn: r => r.supplier, cell: ({ row: { original: r } }) => <div className="min-w-[180px]"><div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5"><span className="font-medium">{r.supplier}</span><Gstin g={r.supplierGstin} /></div><div className="text-[11px] text-text-2">{r.docType} <span className="font-mono">{r.docNo}</span> · {date(r.date)}</div></div> },
    { accessorKey: 'itc', header: 'ITC', meta: { num: true }, cell: ({ row: { original: r } }) => <><div className={cn(r.itc < 0 && 'text-bad')}>{inr(r.itc)}</div><div className="text-[11px] text-text-3">on {inr(r.taxable)}</div></> },
    { accessorKey: 'portal', header: 'Portal status', cell: ({ row: { original: r } }) => <StatusPill tone={portalTone[r.portal]}>{r.portal}</StatusPill> },
    { id: 'match', header: 'Our match result', accessorFn: r => r.match.label, cell: ({ row: { original: r } }) => <><StatusPill tone={r.match.tone}>{r.match.label}</StatusPill><div className="mt-0.5 max-w-[200px] text-[11px] text-text-3">{r.match.note}</div></> },
    { accessorKey: 'recommended', header: 'Recommended', cell: ({ getValue }) => <span className="font-medium whitespace-nowrap">{getValue()}</span> },
    { id: 'final', header: 'Final action', accessorFn: r => r.final ?? '', cell: ({ row: { original: r } }) => (
      <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
        <select aria-label="Final action" disabled={readOnly} value={r.final ?? ''} onChange={e => setFinal([r.id], e.target.value as ImsAction)}
          className={cn('h-7 rounded-md border bg-surface px-2 pr-6 text-xs', r.dirty ? 'border-acc' : 'border-border-2', !r.final && 'text-text-3')}>
          <option value="" disabled>Choose…</option><option>Accept</option><option>Reject</option><option>Keep pending</option>
        </select>
        {r.dirty && <span className="size-1.5 rounded-full bg-acc" title="Not saved to portal yet" />}
      </span>
    ) },
    { id: 'acted', header: 'Acted by', accessorFn: r => r.actedBy ?? '', cell: ({ row: { original: r } }) => r.actedBy ? <span className="flex items-center gap-1.5 whitespace-nowrap"><Avatar id={r.actedBy} /><span className="text-[11px] text-text-2">{dayMonthTime(r.actedAt!)}</span></span> : <span className="text-[11px] text-text-3">—</span> },
  ], [readOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  const tileFilter: Record<string, Filter | null> = { matched: 'matched', partial: 'partial', notbooks: 'notbooks', not2b: null }
  return (
    <>
      <Banner tone="info" icon={<Info className="size-4" />} actions={<Popover><PopoverTrigger asChild><Button size="sm">How recompute works</Button></PopoverTrigger><PopoverContent className="w-80 text-xs leading-5">GSTR-2B is generated on the 14th from IMS actions taken by then. Actions taken later are not reflected until you press <b>Recompute GSTR-2B</b> on the portal. File GSTR-3B only after recompute, or the ITC you claim will not match 2B.</PopoverContent></Popover>}>
        <b>GSTR-2B for {period} is generated on {date(summary.twoBDate)}.</b> Until then these figures are a draft built from IMS. Any accept, reject or keep-pending action taken after the 14th needs GSTR-2B to be recomputed on the portal before you file GSTR-3B (due {date(summary.threeBDue)}).
      </Banner>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {summary.tiles.map(t => {
          const I = toneIcon[t.tone]
          const f = tileFilter[t.key]
          return (
            <button key={t.key} type="button" disabled={!f} onClick={() => f && setFilter(filter === f ? 'all' : f)} aria-pressed={!!f && filter === f}
              className={cn('flex flex-col gap-1 rounded-lg border bg-surface px-3.5 pt-3 pb-2.5 text-left', t.tone === 'bad' ? 'border-bad-bd' : t.tone === 'warn' ? 'border-warn-bd' : 'border-border', f && 'cursor-pointer hover:border-border-2', f && filter === f && 'ring-2 ring-acc')}>
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-text-2">{t.label}</span><StatusPill tone={t.tone} icon={<I />}>{t.status}</StatusPill></div>
              <div className="text-[22px] leading-7 font-semibold">{int(t.n)}<small className="ml-0.5 text-[13px] font-medium text-text-2">documents</small></div>
              <div className="text-[11.5px] text-text-2">ITC <span className="font-medium text-text">{inr(t.itc)}</span> · {t.sub}</div>
              <div className="mt-1.5 flex flex-wrap gap-2 border-t border-border pt-2">{t.sources.map(s => <Source key={s} name={s} syncKey={s === 'SAP' ? 'sap' : 'gst'} />)}</div>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[999_1_640px] flex-col gap-2">
          <DataTable id="ims" data={list} columns={columns} getRowId={r => r.id} selectable maxHeight={760}
            rowClassName={r => r.dirty ? '[&>td]:bg-acc-weak/40' : undefined}
            toolbar={<>
              <FilterChip on={filter === 'all'} onClick={() => setFilter('all')}>IMS inward · {rows.length}</FilterChip>
              <FilterChip on={filter === 'noaction'} onClick={() => setFilter('noaction')}>No action on portal · {rows.filter(r => r.portal === 'No action').length}</FilterChip>
              <FilterChip on={filter === 'differs'} onClick={() => setFilter('differs')}>Recommendation differs from final · {rows.filter(r => r.final && r.final !== r.recommended).length}</FilterChip>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><FilterChip on={suppliers.length > 0}>Supplier{suppliers.length ? ' · ' + suppliers.length : ''}</FilterChip></DropdownMenuTrigger>
                <DropdownMenuContent>{[...new Set(rows.map(r => r.supplier))].map(s => <DropdownMenuCheckboxItem key={s} checked={suppliers.includes(s)} onSelect={e => e.preventDefault()} onCheckedChange={c => setSuppliers(c ? [...suppliers, s] : suppliers.filter(x => x !== s))}>{s}</DropdownMenuCheckboxItem>)}</DropdownMenuContent>
              </DropdownMenu>
            </>}
            bulk={(sel, clear) => (
              <BulkBar>
                <span className="font-medium">{sel.length} selected</span><span className="text-xs opacity-80">ITC {inr(sel.reduce((s, r) => s + r.itc, 0))}</span><Spacer />
                <Button size="sm" disabled={readOnly} onClick={async () => { await setFinal(sel.map(r => r.id), 'Accept'); clear() }}><Check />Accept</Button>
                <Button size="sm" disabled={readOnly} onClick={async () => { await setFinal(sel.map(r => r.id), 'Reject'); clear() }}><X />Reject</Button>
                <Button size="sm" disabled={readOnly} onClick={async () => { await setFinal(sel.map(r => r.id), 'Keep pending'); clear() }}><Pause />Keep pending</Button>
                <Button size="sm" disabled={readOnly || !recCount} onClick={async () => { await act(() => api.applyRecommendations(entity.id, gstin), r => `${r.applied} recommendations applied · not saved yet`); clear() }}>Apply all recommendations ({recCount})</Button>
              </BulkBar>
            )}
            cardFooter={
              <CardFooter className="text-[11px] text-text-3">
                Showing {list.length} of {rows.length} · actions are sent to the GST portal IMS when you press Save to portal{summary.lastSaved && <> · last saved {dateTime(summary.lastSaved.at)} by {users.find(u => u.id === summary.lastSaved!.by)?.name}</>}
                <Spacer />
                {recCount > 0 && <Button size="sm" disabled={readOnly || pending} onClick={() => act(() => api.applyRecommendations(entity.id, gstin), r => `${r.applied} recommendations applied · not saved yet`)}>Apply all recommendations ({recCount})</Button>}
                <Button size="sm" variant="default" disabled={readOnly || pending || !dirty} onClick={() => act(() => api.saveImsToPortal(entity.id, gstin), r => `${r.saved} action${r.saved > 1 ? 's' : ''} saved to the GST portal`)}>Save {dirty} action{dirty === 1 ? '' : 's'} to portal</Button>
              </CardFooter>
            } />
        </div>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4" aria-label="ITC risk and liabilities">
          <Card>
            <CardHeader title="ITC at risk"><Source name="SAP" text="+ GST portal" /></CardHeader>
            <CardBody className="flex flex-col gap-3">
              <div>
                <div className="flex items-center justify-between"><span className="text-xs font-medium">180-day payment rule</span>{summary.itc180.length ? <StatusPill tone="bad">{summary.itc180.length} invoices</StatusPill> : <StatusPill tone="ok">None</StatusPill>}</div>
                <div className="mt-0.5 mb-1.5 text-[11px] text-text-2">Unpaid more than 180 days from invoice date. Reverse ITC in GSTR-3B or pay before filing.</div>
                {summary.itc180.length > 0 && (
                  <table className="w-full text-[11px] [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5">
                    <tbody>{summary.itc180.map(r => <tr key={r.ref}><td>{r.supplier} · {r.ref}<div className="text-text-3">{date(r.date)} · {r.days} days</div></td><td className="text-right tabular-nums">{inr(r.itc)}</td></tr>)}</tbody>
                    <tfoot className="[&_td]:border-b-0 [&_td]:bg-surface-2 [&_td]:font-semibold"><tr><td>ITC to reverse</td><td className="text-right tabular-nums">{inr(summary.itc180.reduce((s, r) => s + r.itc, 0))}</td></tr></tfoot>
                  </table>
                )}
              </div>
              <div className="h-px bg-border" />
              <div>
                <div className="flex items-center justify-between"><span className="text-xs font-medium">Section 16(4) cut-off · {summary.s164.fy}</span><StatusPill tone="warn">{summary.s164.daysLeft} days left</StatusPill></div>
                <div className="mt-0.5 text-[11px] text-text-2">{summary.s164.invoices} invoice{summary.s164.invoices > 1 ? 's' : ''} with ITC <span className="font-medium text-text">{inr(summary.s164.itc)}</span> not yet claimed. Last date {date(summary.s164.lastDate)}.</div>
                <Button size="sm" className="mt-1.5" asChild><Link to="/reports">Review {summary.s164.invoices} invoice{summary.s164.invoices > 1 ? 's' : ''}</Link></Button>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Blocked credits"><Chip>Section 17(5)</Chip></CardHeader>
            <CardBody>
              <KV items={[...summary.blocked.map(b => [b.label, inr(b.amount), 'text-right tabular-nums'] as [string, string, string]), [<span className="font-medium text-text">Not claimed</span>, <b>{inr(summary.blocked.reduce((s, b) => s + b.amount, 0))}</b>, 'text-right tabular-nums']]} />
              <div className="mt-2 text-[11px] text-text-3">{summary.blockedNote}</div>
            </CardBody>
          </Card>
          <RcmCard summary={summary} />
        </aside>
      </div>
    </>
  )
}

function RcmCard({ summary }: { summary: NonNullable<Awaited<ReturnType<typeof api.getGst>>['summary']> }) {
  const { entity, readOnly } = useSession()
  const { act, pending } = useAct()
  const r = summary.rcm
  const half = r.freight * r.rate / 200
  const missing = r.lrs - r.selfInvoices
  return (
    <Card>
      <CardHeader title="Reverse-charge liability"><Source name="SAP" syncKey="sap" /></CardHeader>
      <CardBody className="flex flex-col gap-2.5">
        <div className="flex items-center gap-1.5"><Link to={'/vendors/' + r.vendorId} className="font-medium text-text">{r.vendor}</Link><Chip>{r.service}</Chip></div>
        <span className="self-start"><Gstin g={r.gstin} state={`${r.gstin.slice(0, 2)} · ${r.gstin.startsWith('27') ? 'Maharashtra' : 'Gujarat'}`} /></span>
        <KV items={[
          ['Lorry receipts, Oct', String(r.lrs)], ['Freight value', inr(r.freight), 'text-right tabular-nums'],
          [`CGST ${r.rate / 2}%`, inr(half), 'text-right tabular-nums'], [`SGST ${r.rate / 2}%`, inr(half), 'text-right tabular-nums'],
          [<span className="font-medium text-text">Payable in cash</span>, <b>{inr(half * 2)}</b>, 'text-right tabular-nums'],
        ]} />
        <div className="flex flex-wrap items-center gap-1.5"><StatusPill tone={missing ? 'warn' : 'ok'}>Self-invoices {r.selfInvoices} of {r.lrs}</StatusPill><span className="text-[11px] text-text-3">GSTR-3B Table 3.1(d) · ITC after payment</span></div>
        {missing > 0 && <Button size="sm" className="self-start" disabled={readOnly || pending} onClick={() => act(() => api.generateSelfInvoices(entity.id), x => `${x.generated} self-invoice${x.generated > 1 ? 's' : ''} generated`)}>Generate {missing} self-invoice{missing > 1 ? 's' : ''}</Button>}
      </CardBody>
    </Card>
  )
}

/* ================= other GST tabs ================= */

function Gstr1({ docs, gstin }: { docs: OutwardDoc[]; gstin: string }) {
  const ready = docs.filter(d => d.gstr1.tone === 'ok')
  const columns = useMemo<ColumnDef<OutwardDoc, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { accessorKey: 'docNo', header: 'Invoice no.', cell: ({ getValue }) => <span className="font-mono">{getValue()}</span> },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => date(getValue()) },
    { id: 'cust', header: 'Customer', accessorFn: d => d.customer, cell: ({ row: { original: d } }) => <div><div className="font-medium">{d.customer}</div><Gstin g={d.customerGstin} /></div> },
    { id: 'type', header: 'Table', accessorFn: d => d.customerGstin.slice(0, 2) === gstin.slice(0, 2) ? 'B2B · intra' : 'B2B · inter', cell: ({ getValue }) => <span className="text-xs">{getValue()}</span> },
    { accessorKey: 'taxable', header: 'Taxable', meta: { num: true }, cell: ({ getValue }) => inr(getValue()) },
    { accessorKey: 'tax', header: 'Tax', meta: { num: true }, cell: ({ getValue }) => inr(getValue()) },
    { id: 'st', header: 'GSTR-1', accessorFn: d => d.gstr1.label, cell: ({ row: { original: d } }) => <Pill s={d.gstr1} /> },
  ], [gstin])
  const download = () => {
    const json = { gstin, fp: '102026', b2b: ready.map(d => ({ ctin: d.customerGstin, inv: [{ inum: d.docNo, idt: date(d.date), val: d.taxable + d.tax, txval: d.taxable, rt: 18 }] })) }
    const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }))
    Object.assign(document.createElement('a'), { href: url, download: `GSTR1_${gstin}_102026.json` }).click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <>
      <Banner tone={ready.length === docs.length ? 'ok' : 'warn'} actions={<Button size="sm" variant="default" disabled={!ready.length} onClick={download}><Download />Download GSTR-1 JSON ({ready.length})</Button>}>
        {ready.length} of {docs.length} outward invoices are ready for GSTR-1 (due 11-11-2026). {docs.length - ready.length > 0 && <>{docs.length - ready.length} are blocked by e-invoice errors — fix them in <b>E-invoice &amp; e-way bill</b>.</>}
      </Banner>
      <DataTable id="gstr1" data={docs} columns={columns} getRowId={d => d.id} toolbar={null}
        footer={<tr><td colSpan={4}>{docs.length} invoices</td><td className="text-right tabular-nums">{inr(docs.reduce((s, d) => s + d.taxable, 0))}</td><td className="text-right tabular-nums">{inr(docs.reduce((s, d) => s + d.tax, 0))}</td><td /></tr>} />
    </>
  )
}

function Gstr3b({ outward, rows, summary }: { outward: OutwardDoc[]; rows: ImsRow[]; summary: Awaited<ReturnType<typeof api.getGst>>['summary'] }) {
  const outTax = outward.reduce((s, d) => s + d.tax, 0)
  const outTaxable = outward.reduce((s, d) => s + d.taxable, 0)
  const rcmTax = summary ? summary.rcm.freight * summary.rcm.rate / 100 : 0
  const itcAll = rows.filter(r => r.portal === 'Accepted').reduce((s, r) => s + r.itc, 0) + (summary?.tiles.find(t => t.key === 'matched')?.itc ?? 0)
  const reversal = (summary?.itc180.reduce((s, r) => s + r.itc, 0) ?? 0)
  const blocked = summary?.blocked.reduce((s, b) => s + b.amount, 0) ?? 0
  const netItc = itcAll + rcmTax - reversal
  const payable = Math.max(0, outTax + rcmTax - netItc)
  const line = (t: string, sub: string, v: number, strong?: boolean) => <tr className={cn(strong && '[&>td]:bg-surface-2 [&>td]:font-semibold')}><td className="font-mono text-[11px] text-text-3">{t}</td><td>{sub}</td><td className="text-right tabular-nums">{inr(v)}</td></tr>
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Card className="flex-[2_1_560px]">
        <CardHeader title="{`GSTR-3B · ${period} · draft from books`}"><StatusPill tone="none">Not filed</StatusPill><span className="text-[11px] text-text-3">{summary ? `Due ${date(summary.threeBDue)}` : 'Due 20th of next month'}</span></CardHeader>
        <table className="w-full border-separate border-spacing-0 text-[12.5px] [&_td]:border-b [&_td]:border-border [&_td]:px-3 [&_td]:py-2">
          <tbody>
            {line('3.1(a)', `Outward taxable supplies · taxable ${inr(outTaxable)}`, outTax)}
            {line('3.1(d)', 'Inward supplies liable to reverse charge (GTA 5%)', rcmTax)}
            {line('', 'Total output tax', outTax + rcmTax, true)}
            {line('4(A)(3)', 'ITC on reverse-charge supplies', rcmTax)}
            {line('4(A)(5)', 'ITC — all other, as per GSTR-2B (draft)', itcAll)}
            {line('4(B)(2)', 'Reversal · 180-day payment rule', -reversal)}
            {line('4(D)(2)', `Ineligible · Section 17(5), not claimed (${inr(blocked)})`, 0)}
            {line('', 'Net ITC available', netItc, true)}
            {line('6.1', 'Tax payable in cash (after ITC)', payable, true)}
          </tbody>
        </table>
        <CardFooter className="text-[11px] text-text-3">Draft computed from SAP and IMS. File on the GST portal after GSTR-2B is generated (14th of next month) and recomputed if IMS actions change.</CardFooter>
      </Card>
      <Card className="flex-[1_1_300px]">
        <CardHeader title="Before you file" />
        <CardBody className="flex flex-col gap-2 text-xs">
          {[
            [rows.every(r => r.portal !== 'No action'), `IMS actions saved (${rows.filter(r => r.portal === 'No action').length} pending)`],
            [outward.every(d => d.gstr1.tone === 'ok'), 'GSTR-1 filed with all e-invoices'],
            [!!summary && summary.rcm.selfInvoices >= summary.rcm.lrs, 'RCM self-invoices complete'],
            [reversal === 0, '180-day reversals reviewed'],
            [false, 'GSTR-2B generated (14-11-2026)'],
          ].map(([ok, t]) => { const I = toneIcon[ok ? 'ok' : 'warn']; return <div key={t as string} className="flex items-center gap-2"><I className={toneText[ok ? 'ok' : 'warn']} />{t as string}</div> })}
        </CardBody>
      </Card>
    </div>
  )
}

function EInvoice({ docs }: { docs: OutwardDoc[] }) {
  const { readOnly } = useSession()
  const { act } = useAct()
  const failed = docs.filter(d => d.irn.tone === 'bad')
  const columns = useMemo<ColumnDef<OutwardDoc, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { accessorKey: 'docNo', header: 'Invoice no.', cell: ({ getValue }) => <span className="font-mono">{getValue()}</span> },
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => date(getValue()) },
    { accessorKey: 'customer', header: 'Customer', cell: ({ getValue }) => <span className="font-medium">{getValue()}</span> },
    { accessorKey: 'taxable', header: 'Value incl. tax', meta: { num: true }, cell: ({ row: { original: d } }) => inr(d.taxable + d.tax) },
    { id: 'irn', header: 'E-invoice (IRN)', accessorFn: d => d.irn.label, cell: ({ row: { original: d } }) => <Pill s={d.irn} /> },
    { id: 'ewb', header: 'E-way bill', accessorFn: d => d.ewb.label, cell: ({ row: { original: d } }) => <Pill s={d.ewb} /> },
    { id: 'act', header: '', enableSorting: false, cell: ({ row: { original: d } }) => d.irn.tone === 'bad' ? <Button size="sm" disabled={readOnly} onClick={() => act(() => api.retryIrn(d.id), `IRN generated for ${d.docNo}`)}><RefreshCw />Fix and retry</Button> : null },
  ], [readOnly]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {failed.length > 0 && <Banner tone="bad">{failed.length} e-invoice{failed.length > 1 ? 's' : ''} rejected by the IRP. Goods cannot move without an e-way bill, and these are blocked from GSTR-1.</Banner>}
      <DataTable id="einv" data={docs} columns={columns} getRowId={d => d.id} toolbar={null} />
    </>
  )
}

function Rcm({ lrs, summary }: { lrs: Awaited<ReturnType<typeof api.getGst>>['rcmLrs']; summary: Awaited<ReturnType<typeof api.getGst>>['summary'] }) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <Card className="flex-[2_1_560px]">
        <CardHeader title="{`Lorry receipts under reverse charge · ${period}`}"><Source name="SAP" syncKey="sap" /></CardHeader>
        <table className="w-full border-separate border-spacing-0 text-[12.5px] [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:text-text-2">
          <thead><tr><th>LR</th><th>Date</th><th>Route</th><th className="text-right!">Freight</th><th className="text-right!">GST 5% (RCM)</th><th>Self-invoice</th></tr></thead>
          <tbody>{lrs.map(l => <tr key={l.id}><td className="font-mono">{l.lr}</td><td>{date(l.date)}</td><td>{l.route}</td><td className="text-right tabular-nums">{inr(l.freight)}</td><td className="text-right tabular-nums">{inr(l.freight * 0.05)}</td><td>{l.selfInvoice ? <span className="font-mono text-xs">{l.selfInvoice}</span> : <StatusPill tone="warn">Missing</StatusPill>}</td></tr>)}</tbody>
          <tfoot className="[&_td]:bg-surface-2 [&_td]:font-semibold"><tr><td colSpan={3}>{lrs.length} lorry receipts</td><td className="text-right tabular-nums">{inr(lrs.reduce((s, l) => s + l.freight, 0))}</td><td className="text-right tabular-nums">{inr(lrs.reduce((s, l) => s + l.freight * 0.05, 0))}</td><td /></tr></tfoot>
        </table>
      </Card>
      <div className="flex-[1_1_320px]">{summary && <RcmCard summary={summary} />}</div>
    </div>
  )
}

function Suppliers({ vendors }: { vendors: Vendor[] }) {
  const columns = useMemo<ColumnDef<Vendor, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { accessorKey: 'name', header: 'Supplier', cell: ({ row: { original: v } }) => <Link to={'/vendors/' + v.id} className="font-medium text-text">{v.name}</Link> },
    { accessorKey: 'gstin', header: 'GSTIN', cell: ({ getValue }) => <Gstin g={getValue()} /> },
    { accessorKey: 'gstinStatus', header: 'Registration', cell: ({ getValue }) => <StatusPill tone={getValue() === 'Active' ? 'ok' : 'bad'}>{getValue()}</StatusPill> },
    { id: 'filing', header: 'GSTR-1 on time, last 12', accessorFn: v => v.filing.onTime / v.filing.of, cell: ({ row: { original: v } }) => <StatusPill tone={v.filing.onTime === v.filing.of ? 'ok' : v.filing.onTime >= 10 ? 'warn' : 'bad'}>{v.filing.onTime} of {v.filing.of}</StatusPill> },
    { id: 'rating', header: 'ITC risk', accessorFn: v => v.filing.of - v.filing.onTime, cell: ({ row: { original: v } }) => { const late = v.filing.of - v.filing.onTime; return <span className="text-xs">{late === 0 ? 'Low' : late <= 2 ? 'Medium · follow up before 2B' : 'High · hold payment of GST portion'}</span> } },
    { accessorKey: 'ytdPurchases', header: 'Purchases, FY to date', meta: { num: true }, cell: ({ getValue }) => inr(getValue()) },
  ], [])
  return (
    <>
      <div className="flex items-center gap-2 text-xs text-text-2">Filing history from the GST portal; registration checked on every sync.<Spacer /><Button size="sm" onClick={() => downloadCsv(`supplier-compliance-${todayIso()}.csv`, ['Supplier', 'GSTIN', 'Registration', 'On time', 'Of'], vendors.map(v => [v.name, v.gstin, v.gstinStatus, v.filing.onTime, v.filing.of]))}><Download />Export</Button></div>
      <DataTable id="gst-suppliers" data={vendors} columns={columns} getRowId={v => v.id} toolbar={null} initialSort={[{ id: 'rating', desc: true }]} />
    </>
  )
}
