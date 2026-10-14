import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowRight, Building2, Download, RefreshCw, SlidersHorizontal, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Banner, Card, CardBody, CardHeader, Chk, Count, Gstin, KpiCard, MsmeBadge, PageHeader, Pill, Q, Segmented, Source, StatusPill, Up, Bar, useStale, Freshness,
} from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useFirmOverview, useOverview } from '@/mock/hooks'
import * as api from '@/mock/api'
import { ago, date, dateLong, dateTime, daysFromNow, inr, lakhCrStr, num2 } from '@/lib/format'
import type { Kpi } from '@/lib/types'
import { cn } from '@/lib/utils'
import { CashForecastChart, CashForecastTable, forecastSummary } from './CashForecast'

const SECTIONS = [
  ['payables', 'Payables KPIs'], ['receivables', 'Receivables, cash & tax KPIs'], ['critical', 'Critical exceptions & compliance calendar'],
  ['cash', '13-week cash forecast & Schedule III ageing'], ['top', 'Top vendors & customers'],
] as const
type SectionKey = (typeof SECTIONS)[number][0]
const loadHidden = (): SectionKey[] => { try { return JSON.parse(localStorage.getItem('pv-overview-hidden') ?? '[]') } catch { return [] } }

export default function OverviewPage() {
  const { scope, setScope, entity, firm, entities } = useSession()
  const [hidden, setHidden] = useState<SectionKey[]>(loadHidden)
  const [customise, setCustomise] = useState(false)
  const isFirm = scope === 'firm'
  const save = (h: SectionKey[]) => { setHidden(h); try { localStorage.setItem('pv-overview-hidden', JSON.stringify(h)) } catch { /* not remembered */ } }
  return (
    <>
      <div className="hidden md:contents">
        <PageHeader title="Overview"
          sub={isFirm ? `${firm.name} · ${entities.length} client entities · as of ${dateLong('2026-10-13')}, 15:20 IST · sorted by risk` : `${entity.name} · as of ${dateLong('2026-10-13')}, 15:20 IST · cards in lakh (L) and crore (Cr), tables in full rupees`}
          actions={<>
            <Segmented label="Overview scope" value={scope} onChange={setScope} options={[{ value: 'entity', label: 'Entity', icon: <Building2 className="size-3.5" /> }, { value: 'firm', label: `Firm · ${entities.length} clients`, icon: <Users className="size-3.5" /> }]} />
            {!isFirm && <Button onClick={() => setCustomise(true)}><SlidersHorizontal />Customise</Button>}
            <Button onClick={() => window.print()}><Download />Export PDF</Button>
          </>} />
        {isFirm ? <FirmView /> : <EntityView hidden={hidden} />}
      </div>
      <div className="contents md:hidden"><MobileOverview /></div>
      <Dialog open={customise} onOpenChange={setCustomise}>
        <DialogContent>
          <DialogHeader><DialogTitle>Customise overview</DialogTitle><DialogDescription>Choose which sections show. Saved for you on this device.</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-1">
            {SECTIONS.map(([k, label]) => (
              <label key={k} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2"><Chk checked={!hidden.includes(k)} onChange={e => save(e.target.checked ? hidden.filter(h => h !== k) : [...hidden, k])} />{label}</label>
            ))}
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => save([])}>Show all</Button><Button variant="default" onClick={() => setCustomise(false)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function StaleBankBanner({ compact }: { compact?: boolean }) {
  const { user } = useSession()
  const { stale, at } = useStale('bank')
  const { act, pending } = useAct()
  if (!stale) return null
  return (
    <Banner tone="warn" className={compact ? 'px-3' : ''} actions={<>
      <Button size="sm" disabled={pending} onClick={() => act(() => api.retrySync('bank', user.id), 'Bank feed synced')}><RefreshCw className={cn(pending && 'animate-spin')} />{compact ? 'Retry' : 'Retry sync'}</Button>
      {!compact && <Button size="sm" variant="ghost" asChild><Link to="/bank">Feed status</Link></Button>}
    </>}>
      {compact ? <><b>Bank feed is stale</b> — last statement {dateTime(at)}.</> : <><b>Bank feed is stale.</b> Last statement synced {dateTime(at)} ({ago(at)}). Bank balance and the opening balance of the cash forecast may be out of date.</>}
    </Banner>
  )
}

function KpiGrid({ title, hint, kpis }: { title: string; hint: string; kpis: Kpi[] }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-center gap-2"><Up>{title}</Up><span className="text-[11px] text-text-3">{hint}</span></div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">{kpis.map(k => <KpiCard key={k.id} k={k} />)}</div>
    </section>
  )
}

/** A newly onboarded client: nothing from SAP, the bank or the GST portal yet. */
function NoDataYet() {
  const { entity } = useSession()
  return (
    <Card>
      <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-text-2"><Building2 className="size-5" /></span>
        <h2>No figures for {entity.shortName} yet</h2>
        <p className="max-w-[520px] text-xs text-text-2">The overview fills in once SAP, the bank feed and the GST portal are connected. Emailed invoices already arrive in the Intake inbox.</p>
        <div className="flex gap-2 pt-1"><Button size="sm" asChild><Link to="/intake">Open Intake inbox</Link></Button><Button size="sm" asChild><Link to={`/settings/clients/${entity.id}`}>Client settings</Link></Button></div>
      </div>
    </Card>
  )
}

function EntityView({ hidden }: { hidden: SectionKey[] }) {
  const q = useOverview()
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const show = (k: SectionKey) => !hidden.includes(k)
  return (
    <Q q={q}>{({ snapshot: s, deadlines, vendors, customers }) => {
      if (!s.cash.weeks.length) return <NoDataYet />
      const fc = forecastSummary(s.cash.opening, s.cash.weeks)
      const apMax = Math.max(...s.apAgeing.map(r => r.msme + r.others))
      const arMax = Math.max(...s.arAgeing.map(r => r.amount))
      const apTotal = s.apAgeing.reduce((n, r) => n + r.msme + r.others, 0)
      const arTotal = s.arAgeing.reduce((n, r) => n + r.amount, 0)
      const msmeOld = s.apAgeing.slice(1).reduce((n, r) => n + r.msme, 0)
      return (
        <div className="flex flex-col gap-4">
          <StaleBankBanner />
          {show('payables') && <KpiGrid title="Payables" hint="Purchase commitments to posted liabilities" kpis={s.kpiPay} />}
          {show('receivables') && <KpiGrid title="Receivables, cash & tax" hint="Collections, liquidity and input tax credit" kpis={s.kpiRec} />}

          {show('critical') && (
            <div className="flex flex-wrap items-stretch gap-3">
              <article className="flex max-w-[320px] flex-[1_1_220px] flex-col gap-1 rounded-lg border border-bad-bd bg-surface px-3.5 pt-3 pb-2.5">
                <div className="min-h-8 text-xs font-medium text-text-2">Critical exceptions</div>
                <div className="text-[22px] leading-7 font-semibold">{s.critical.open}<small className="ml-0.5 text-[13px] font-medium text-text-2">open</small></div>
                <div className="text-[11.5px] text-text-2">{s.critical.pastSla} past SLA · {lakhCrStr(s.critical.blocked)} of payments blocked</div>
                <div className="mt-1 flex flex-col gap-1">
                  {s.critical.breakdown.map(b => (
                    <Link key={b.label} to={`/exceptions?type=${encodeURIComponent(b.type)}`} className="flex justify-between text-xs text-text no-underline hover:text-acc"><span className="text-text-2">{b.label}</span><span className="font-medium">{b.n}</span></Link>
                  ))}
                </div>
                <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-2"><Source name="SAP" syncKey="sap" /><Source name="GST portal" syncKey="gst" /></div>
              </article>
              <Card className="flex-[999_1_640px]" aria-label="Compliance calendar">
                <CardHeader title="Compliance calendar"><Source name="GST portal" syncKey="gst" /><Source name="SAP" syncKey="sap" /><Link to="/close" className="text-xs">All due dates</Link></CardHeader>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
                  {deadlines.map(d => {
                    const days = daysFromNow(d.due)
                    return (
                      <Link key={d.id} to={d.link ?? '#'} className="flex flex-col gap-1.5 border-r border-border px-4 py-3 text-text no-underline last:border-r-0 hover:bg-surface-2 hover:text-text">
                        <div className="text-xs font-medium">{d.name}</div>
                        <div className="text-[11px] text-text-3">{d.what}</div>
                        <div className="flex items-baseline gap-1.5"><span className="text-lg leading-6 font-semibold">{days}</span><span className="text-[11px] text-text-2">days left</span></div>
                        <Bar pct={Math.max(4, 100 - (days / d.windowDays) * 100)} tone={days <= 20 ? 'warn' : undefined} />
                        <div className="text-[11px] text-text-2">Due <span className="font-medium text-text">{date(d.due)}</span></div>
                        <div><Pill s={d.status} /></div>
                      </Link>
                    )
                  })}
                </div>
              </Card>
            </div>
          )}

          {show('cash') && (
            <div className="flex flex-wrap items-stretch gap-4">
              <Card className="flex-[2_1_640px]" aria-label="13-week cash forecast">
                <CardHeader title="13-week cash forecast">
                  <Source name="SAP" text="due dates · 10 min ago" />
                  <Source name="Bank" syncKey="bank" text="opening balance" />
                  <Segmented label="Chart or table" value={view} onChange={setView} options={[{ value: 'chart', label: 'Chart' }, { value: 'table', label: 'Table' }]} />
                </CardHeader>
                <CardBody className="flex flex-col gap-2.5">
                  <div className="flex flex-wrap items-center gap-4 text-xs text-text-2">
                    <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-s-in" />Collections in</span>
                    <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[2px] bg-s-out" />Payments out</span>
                    <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-s-line" />Closing balance</span>
                    <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-bad" />Minimum balance {lakhCrStr(s.cash.minimum)}</span>
                    <span className="flex-auto" />
                    <span>Opening {lakhCrStr(s.cash.opening)} · Closing w/c {date(s.cash.weeks.at(-1)!.week)} <span className="font-medium text-text">{lakhCrStr(fc.closing)}</span></span>
                  </div>
                  {view === 'chart' ? <CashForecastChart {...s.cash} /> : <CashForecastTable opening={s.cash.opening} weeks={s.cash.weeks} />}
                </CardBody>
              </Card>
              <Card className="flex-[1_1_340px]" aria-label="Schedule III ageing">
                <CardHeader title="Schedule III ageing"><Source name="SAP" syncKey="sap" /></CardHeader>
                <CardBody className="flex flex-col gap-3.5">
                  <div className="flex items-center justify-between">
                    <h3>Trade payables <span className="text-[11px] font-normal text-text-3">from due date</span></h3>
                    <span className="flex gap-2.5 text-[11px] text-text-2"><span className="flex items-center gap-1"><span className="size-2 rounded-[2px] bg-s-out" />MSME</span><span className="flex items-center gap-1"><span className="size-2 rounded-[2px] bg-s-in" />Others</span></span>
                  </div>
                  <div className="grid grid-cols-[78px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-2 text-xs">
                    {s.apAgeing.map(r => [
                      <span key={r.bucket + 'l'} className="text-text-2">{r.bucket}</span>,
                      <span key={r.bucket + 'b'} className="flex h-3.5 gap-0.5" title={`MSME ${inr(r.msme)} · others ${inr(r.others)}`}>
                        {r.msme > 0 && <span className="block rounded-[2px] bg-s-out" style={{ width: `${Math.max(0.6, (r.msme / apMax) * 100)}%` }} />}
                        <span className="block rounded-[2px] bg-s-in" style={{ width: `${Math.max(0.8, (r.others / apMax) * 100)}%` }} />
                      </span>,
                      <span key={r.bucket + 'v'} className="text-right tabular-nums"><span className="font-medium">{lakhCrStr(r.msme + r.others)}</span><span className="text-[11px] text-text-3"> · MSME {lakhCrStr(r.msme)}</span></span>,
                    ])}
                  </div>
                  <div className="text-[11px] text-text-3">Total {lakhCrStr(apTotal)} · {s.apNote} · MSME balances older than 1 year: <span className="font-medium text-bad">{lakhCrStr(msmeOld)}</span></div>
                  <div className="h-px bg-border" />
                  <h3>Trade receivables <span className="text-[11px] font-normal text-text-3">from due date · undisputed, considered good</span></h3>
                  <div className="grid grid-cols-[78px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-2 text-xs">
                    {s.arAgeing.map(r => [
                      <span key={r.bucket + 'l'} className="text-text-2">{r.bucket}</span>,
                      <span key={r.bucket + 'b'} className="flex h-3.5" title={inr(r.amount)}><span className="block rounded-[2px] bg-s-in" style={{ width: `${Math.max(0.8, (r.amount / arMax) * 100)}%` }} /></span>,
                      <span key={r.bucket + 'v'} className="text-right font-medium tabular-nums">{lakhCrStr(r.amount)}</span>,
                    ])}
                  </div>
                  <div className="text-[11px] text-text-3">Total {lakhCrStr(arTotal)} · {s.arNote}</div>
                </CardBody>
              </Card>
            </div>
          )}

          {show('top') && (
            <div className="flex flex-wrap items-start gap-4">
              <TopTable title="Top 10 vendors by outstanding" all="/payables" allLabel="All payables" head={['Vendor', 'Outstanding', 'Overdue', 'Next due', 'Status']}
                rows={vendors.map((v, i) => ({ key: v.id, to: '/vendors/' + v.id, cells: [
                  <div className="flex items-center gap-1.5"><span className="w-3.5 text-[11px] text-text-3">{i + 1}</span><span className="font-medium whitespace-nowrap">{v.name}</span>{v.msme && <MsmeBadge cls={v.msme} />}{v.tags.includes('RCM') && <span className="inline-flex h-[22px] whitespace-nowrap items-center rounded-sm bg-acc-weak px-2 text-[11.5px] font-semibold text-acc">GTA · RCM</span>}</div>,
                  num2(v.outstanding), <span className={v.overdue ? 'text-bad' : 'text-text-3'}>{num2(v.overdue)}</span>, <span className="whitespace-nowrap">{date(v.nextDue)}</span>, <Pill s={v.status} />,
                ] }))} />
              <TopTable title="Top 10 overdue customers" all="/receivables" allLabel="All receivables" head={['Customer', 'Outstanding', 'Overdue', 'Days', 'Follow-up']}
                rows={customers.map((c, i) => ({ key: c.id, to: '/receivables?c=' + c.id, cells: [
                  <div className="flex items-center gap-1.5"><span className="w-3.5 text-[11px] text-text-3">{i + 1}</span><span className="font-medium whitespace-nowrap">{c.name}</span></div>,
                  num2(c.outstanding), num2(c.overdue), <span className={c.daysOverdue > 90 ? 'font-medium text-bad' : c.daysOverdue > 45 ? 'font-medium text-warn' : ''}>{c.daysOverdue}</span>, <Pill s={c.followUp} />,
                ] }))} />
            </div>
          )}
        </div>
      )
    }}</Q>
  )
}

function TopTable({ title, all, allLabel, head, rows }: { title: string; all: string; allLabel: string; head: string[]; rows: { key: string; to: string; cells: React.ReactNode[] }[] }) {
  const nav = useNavigate()
  return (
    <Card className="flex-[1_1_520px]" aria-label={title}>
      <CardHeader title={title}><Source name="SAP" syncKey="sap" /><Link to={all} className="text-xs">{allLabel}</Link></CardHeader>
      <div className="overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[12.5px] leading-[18px]">
          <thead><tr>{head.map((h, i) => <th key={h} className={cn('sticky top-0 border-b border-border bg-surface-2 px-2.5 py-2 text-left text-[11.5px] font-semibold whitespace-nowrap text-text-2', i > 0 && i < 3 && 'text-right', i === 3 && head[3] === 'Days' && 'text-right')}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="group cursor-pointer" onClick={() => nav(r.to)}>
                {r.cells.map((c, i) => <td key={i} className={cn('border-b border-border px-2.5 py-2 group-hover:bg-surface-2', i > 0 && i < 3 && 'text-right tabular-nums', i === 3 && head[3] === 'Days' && 'text-right tabular-nums')}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/* ================= firm view ================= */

function FirmView() {
  const q = useFirmOverview()
  const { setEntityId } = useSession()
  return (
    <Q q={q}>{({ rows, filing, filingHeads }) => {
      const sum = (f: (r: typeof rows[number]) => number) => rows.reduce((n, r) => n + f(r), 0)
      const worst = [...rows].sort((a, b) => b.overduePayables - a.overduePayables)[0]
      const kpis: Kpi[] = [
        { id: 'c', label: 'Client entities', value: rows.length, unit: 'count', sub: `${rows.filter(r => r.entity.risk === 'High').length} high risk · ${rows.filter(r => r.entity.risk === 'Medium').length} medium`, source: 'SAP', syncKey: 'sap' },
        { id: 'od', label: 'Overdue payables, all clients', value: sum(r => r.overduePayables), sub: `${worst.entity.shortName} ${lakhCrStr(worst.overduePayables)} of it`, source: 'SAP', syncKey: 'sap', tone: 'bad' },
        { id: 'msme', label: 'MSME 45-day breaches', value: sum(r => r.msme), unit: 'count', sub: `${rows.filter(r => r.msme > 0).length} clients · 43B(h) exposure`, source: 'Udyam', syncKey: 'sap', tone: 'bad' },
        { id: 'ims', label: 'IMS actions pending', value: sum(r => r.imsPending), unit: 'count', sub: 'GSTR-2B (Oct) generates 14-11-2026', source: 'GST portal', syncKey: 'gst', tone: 'warn' },
        { id: 'next', label: 'Next statutory deadline', value: daysFromNow('2026-10-31'), unit: 'days', sub: `MSME Form 1 · 31-10-2026 · ${rows.length} clients`, source: 'MCA', syncKey: 'sap' },
      ]
      return (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">{kpis.map(k => <KpiCard key={k.id} k={{ ...k, status: undefined }} />)}</div>
          <Card aria-label="Client entities by risk">
            <CardHeader title="Client entities by risk"><span className="text-[11px] text-text-3">Risk = overdue ageing, MSME breaches, ITC at risk and close delay, weighted</span></CardHeader>
            <div className="overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-[12.5px] leading-[18px] [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:whitespace-nowrap [&_th]:text-text-2">
                <thead><tr><th>Risk</th><th>Client entity</th><th>GSTINs</th><th className="text-right!">Overdue payables</th><th className="text-right!">MSME breaches</th><th className="text-right!">IMS pending</th><th className="text-right!">2B mismatch</th><th className="text-right!">TDS due</th><th>Close status (Sep 2026)</th><th /></tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.entityId} className="hover:[&>td]:bg-surface-2">
                      <td><StatusPill tone={r.entity.risk === 'High' ? 'bad' : 'warn'}>{r.entity.risk}</StatusPill><div className="mt-0.5 text-[11px] text-text-3">Score {r.entity.riskScore}</div></td>
                      <td><div className="font-medium">{r.entity.name}</div><div className="text-[11px] text-text-3">{r.entity.city} · PAN <span className="font-mono">{r.entity.pan}</span></div></td>
                      <td><div className="flex flex-col items-start gap-1">{r.entity.gstins.map(g => <Gstin key={g.gstin} g={g.gstin} state={`${g.code} · ${g.state}`} />)}</div></td>
                      <td className="text-right tabular-nums">{num2(r.overduePayables)}</td>
                      <td className="text-right"><StatusPill tone={r.msmeTone}>{r.msmeLabel}</StatusPill></td>
                      <td className="text-right tabular-nums">{r.imsPending}</td>
                      <td className="text-right tabular-nums">{num2(r.mismatch)}</td>
                      <td className="text-right tabular-nums"><div>{num2(r.tdsDue)}</div><div className="text-[11px] text-text-3">by 07-11-2026</div></td>
                      <td><Pill s={r.close} /><div className="mt-0.5 text-[11px] text-text-3">{r.closeSub}</div></td>
                      <td><Button size="sm" onClick={() => setEntityId(r.entityId)}>Open<ArrowRight /></Button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="[&_td]:border-b-0 [&_td]:bg-surface-2 [&_td]:font-semibold"><tr><td /><td>{rows.length} entities</td><td>{rows.reduce((n, r) => n + r.entity.gstins.length, 0)} GSTINs</td><td className="text-right tabular-nums">{num2(sum(r => r.overduePayables))}</td><td className="text-right">{sum(r => r.msme)}</td><td className="text-right">{sum(r => r.imsPending)}</td><td className="text-right tabular-nums">{num2(sum(r => r.mismatch))}</td><td className="text-right tabular-nums">{num2(sum(r => r.tdsDue))}</td><td colSpan={2} /></tr></tfoot>
              </table>
            </div>
          </Card>
          <Card aria-label="Filing status by client">
            <CardHeader title="Filing status by client — Oct 2026 period"><Source name="GST portal" syncKey="gst" /><Source name="TRACES" text="1 day ago" /></CardHeader>
            <div className="overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-[12.5px] [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2 [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:whitespace-nowrap [&_th]:text-text-2">
                <thead><tr><th>Client entity</th>{filingHeads.map(h => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{filing.map(f => <tr key={f.entityId}><td className="font-medium">{rows.find(r => r.entityId === f.entityId)?.entity.name}</td>{f.cells.map((c, i) => <td key={i}><Pill s={c} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          </Card>
        </div>
      )
    }}</Q>
  )
}

/* ================= mobile ================= */

function MobileOverview() {
  const q = useOverview()
  const { user, users } = useSession()
  const [all, setAll] = useState(false)
  return (
    <Q q={q}>{({ snapshot: s, deadlines, customers, pendingRun }) => {
      if (!s.cash.weeks.length) return <NoDataYet />
      const kpis = [...s.kpiPay, ...s.kpiRec]
      const pick = ['due7', 'apod', 'msme', 'bank', 'arod', 'itc', 'dso', 'dpo']
      const shown = all ? kpis : pick.map(id => kpis.find(k => k.id === id)!).filter(Boolean)
      const fc = forecastSummary(s.cash.opening, s.cash.weeks)
      const nextApprover = pendingRun?.approvers.find(a => a.status === 'pending')
      const mine = nextApprover?.userId === user.id
      const firstApproved = pendingRun?.approvers.find(a => a.status === 'approved')
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5"><Freshness k="sap" /><Freshness k="gst" /><Freshness k="bank" /></div>
          <StaleBankBanner compact />
          {pendingRun && (
            <Card className={mine ? 'border-acc' : ''} aria-label="Waiting for approval">
              <CardBody className="flex flex-col gap-2">
                <div className="flex items-center justify-between"><Up className={mine ? 'text-acc' : ''}>{mine ? 'Waiting for you' : 'Awaiting approval'}</Up>{mine && <Count n={1} tone="acc" />}</div>
                <div className="font-medium">Payment run {pendingRun.id}</div>
                <div className="flex items-baseline justify-between"><span className="text-[22px] leading-7 font-semibold tabular-nums">{inr(pendingRun.net)}</span><span className="text-[11px] text-text-2">{pendingRun.invoices} invoices · {pendingRun.vendors} vendors</span></div>
                <div className="text-[11px] text-text-2">{firstApproved ? `Approved by ${users.find(u => u.id === firstApproved.userId)?.name} · ` : ''}{mine ? 'your approval completes it' : `waiting for ${users.find(u => u.id === nextApprover?.userId)?.name}`} · value date {date(pendingRun.valueDate)}</div>
                <Button variant={mine ? 'default' : 'outline'} size="lg" className="w-full" asChild><Link to={'/payables/runs/' + pendingRun.id}>{mine ? 'Review and approve' : 'View run'}<ArrowRight /></Link></Button>
              </CardBody>
            </Card>
          )}
          <div className="flex items-center justify-between"><Up>Key figures</Up><span className="text-[11px] text-text-3">tap for detail</span></div>
          <div className="grid grid-cols-2 gap-2.5">{shown.map(k => <KpiCard key={k.id} k={k} compact />)}</div>
          <Button className="w-full" onClick={() => setAll(a => !a)}>{all ? 'Fewer figures' : `All ${kpis.length} figures`}</Button>
          <Card aria-label="13-week cash forecast">
            <CardHeader title="13-week cash forecast" as="h3" className="px-3 py-2.5"><Source name="Bank" syncKey="bank" text="opening" /></CardHeader>
            <CardBody className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex flex-wrap gap-2.5 text-[11px] text-text-2">
                <span className="flex items-center gap-1"><span className="size-2 rounded-[2px] bg-s-in" />In</span>
                <span className="flex items-center gap-1"><span className="size-2 rounded-[2px] bg-s-out" />Out</span>
                <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-s-line" />Closing</span>
                <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-bad" />Min {lakhCrStr(s.cash.minimum)}</span>
              </div>
              <CashForecastChart {...s.cash} compact />
              <div className="flex justify-between text-xs"><span className="text-text-2">Lowest closing</span><span className="font-medium">{lakhCrStr(fc.low.v)} · w/c {date(fc.low.week)}</span></div>
            </CardBody>
          </Card>
          <Card aria-label="Due dates">
            <CardHeader title="Due dates" as="h3" className="px-3 py-2.5"><Source name="GST portal" syncKey="gst" /></CardHeader>
            {deadlines.map(d => (
              <Link key={d.id} to={d.link ?? '#'} className="flex min-h-14 items-center gap-2.5 border-b border-border px-3 py-2.5 text-text no-underline last:border-b-0 hover:text-text">
                <div className="w-11 flex-none text-center"><div className="text-lg leading-[22px] font-semibold">{daysFromNow(d.due)}</div><div className="text-[11px] text-text-3">days</div></div>
                <div className="min-w-0 flex-auto"><div className="text-xs font-medium">{d.name}</div><div className="text-[11px] text-text-3">Due {date(d.due)}</div></div>
                <Pill s={d.status} />
              </Link>
            ))}
          </Card>
          <Card aria-label="Top overdue customers">
            <CardHeader title="Top overdue customers" as="h3" className="px-3 py-2.5"><Source name="SAP" syncKey="sap" /></CardHeader>
            {customers.slice(0, 3).map(c => (
              <Link key={c.id} to={'/receivables?c=' + c.id} className="flex min-h-[52px] items-center gap-2.5 border-b border-border px-3 py-2.5 text-text no-underline hover:text-text">
                <div className="min-w-0 flex-auto"><div className="text-xs font-medium">{c.name}</div><div className="text-[11px] text-text-3">{c.daysOverdue} days overdue · {c.followUp.label.toLowerCase()}</div></div>
                <span className="text-xs font-medium tabular-nums">{inr(c.overdue)}</span>
              </Link>
            ))}
            <Link to="/receivables" className="block p-3 text-center text-xs">All {customers.length} overdue customers</Link>
          </Card>
        </div>
      )
    }}</Q>
  )
}
