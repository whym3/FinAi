import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowRight, Calendar, Check, ChevronDown, Download, Kanban, Lock, Pause, Phone, Send, SlidersHorizontal, Table, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import {
  Avatar, Banner, BulkBar, Card, Chk, CommentRow, DataTable, EmptyState, ExceptionCard, FilterChip, Filters, LineTabs, PageHeader, Prio, Q, Segmented, Sla, Source, Spacer, StatusPill, Up, ageOf, slaOver,
} from '@/components/pravah'
import { useSession } from '@/app/session'
import { useAct, useExceptions, useRules } from '@/api/hooks'
import * as api from '@/api'
import { addDays, date, dayMonthTime, inr, lakhCrStr, todayIso } from '@/lib/format'
import { downloadCsv } from '@/lib/csv'
import type { ExceptionItem, ExceptionStatus, Priority, Status } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS: Record<ExceptionStatus, Status> = {
  open: { tone: 'none', label: 'Open' }, 'in-progress': { tone: 'warn', label: 'In progress' }, 'waiting-vendor': { tone: 'warn', label: 'Waiting on vendor' },
  'awaiting-approval': { tone: 'warn', label: 'Awaiting approval' }, resolved: { tone: 'ok', label: 'Resolved' },
}
const exStatus = (x: ExceptionItem): Status => x.statusNote && x.status !== 'resolved' ? { tone: x.status === 'awaiting-approval' && x.ownerId === 'PV' ? 'ok' : STATUS[x.status].tone, label: x.statusNote } : STATUS[x.status]
const PRIOS: Priority[] = ['Critical', 'High', 'Medium', 'Low']
const prioRank = { Critical: 0, High: 1, Medium: 2, Low: 3 }
type StatusFilter = 'open' | 'snoozed' | 'resolved' | 'all'

export default function ExceptionsPage() {
  const q = useExceptions()
  const { user, users, readOnly, entity } = useSession()
  const [sp, setSp] = useSearchParams()
  const set = (k: string, v: string | null) => setSp(p => { const n = new URLSearchParams(p); if (v == null) n.delete(k); else n.set(k, v); return n }, { replace: true })
  const view = (sp.get('view') ?? 'table') as 'table' | 'board'
  const type = sp.get('type')
  const exId = sp.get('ex')
  const [owner, setOwner] = useState<string | null>(null)
  const [prio, setPrio] = useState<Priority | null>(null)
  const [due, setDue] = useState<'overdue' | 'week' | null>(null)
  const [status, setStatus] = useState<StatusFilter>('open')
  const [mine, setMine] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)

  const all = q.data ?? []
  const today = todayIso()
  const isSnoozed = (x: ExceptionItem) => !!x.snoozedUntil && x.snoozedUntil > today && x.status !== 'resolved'
  const byStatus = (x: ExceptionItem) => status === 'all' || (status === 'resolved' ? x.status === 'resolved' : status === 'snoozed' ? isSnoozed(x) : x.status !== 'resolved' && !isSnoozed(x))
  const base = all.filter(x => byStatus(x) && (!owner || x.ownerId === owner) && (!prio || x.priority === prio) && (!mine || x.ownerId === user.id) &&
    (!due || (due === 'overdue' ? slaOver(x) > 0 : x.due <= addDays(today, 7))))
  const list = base.filter(x => !type || x.type === type).sort((a, b) => prioRank[a.priority] - prioRank[b.priority] || a.due.localeCompare(b.due))
  const open = all.filter(x => x.status !== 'resolved')
  const types = [...new Set(all.map(x => x.type))].map(t => ({ t, n: base.filter(x => x.type === t).length }))
  const selected = all.find(x => x.id === exId)

  const columns = useMemo<ColumnDef<ExceptionItem, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { id: 'ex', header: 'Exception', accessorFn: x => x.id, cell: ({ row: { original: x } }) => <div className="min-w-[240px]"><div className="text-[11px] font-medium text-text-3">{x.id} · {x.type}</div><div className="font-medium">{x.title}</div></div> },
    { accessorKey: 'docRef', header: 'Linked document', cell: ({ row: { original: x } }) => <span className="font-mono text-[11px] whitespace-nowrap">{x.docRoute ? <Link to={x.docRoute} onClick={e => e.stopPropagation()}>{x.docRef}</Link> : x.docRef}</span> },
    { id: 'owner', header: 'Owner', accessorFn: x => users.find(u => u.id === x.ownerId)?.name ?? 'Auto', cell: ({ row: { original: x } }) => <span className="flex items-center gap-1.5 whitespace-nowrap"><Avatar id={x.ownerId} /><span className="text-xs">{users.find(u => u.id === x.ownerId)?.name ?? 'Auto'}</span></span> },
    { id: 'status', header: 'Status', accessorFn: x => x.status, cell: ({ row: { original: x } }) => <div className="flex flex-col items-start gap-0.5"><StatusPill tone={exStatus(x).tone}>{exStatus(x).label}</StatusPill>{isSnoozed(x) && <span className="text-[11px] text-text-3">Snoozed to {date(x.snoozedUntil)}</span>}</div> },
    { id: 'prio', header: 'Priority', accessorFn: x => prioRank[x.priority], cell: ({ row: { original: x } }) => <Prio p={x.priority} /> },
    { accessorKey: 'due', header: 'Due', cell: ({ row: { original: x } }) => <div className="whitespace-nowrap"><div>{date(x.due)}</div>{slaOver(x) > 0 && <Sla>SLA +{slaOver(x)} d</Sla>}</div> },
    { id: 'age', header: 'Age', meta: { num: true }, accessorFn: x => x.createdAt, cell: ({ row: { original: x } }) => <span className="text-text-2">{ageOf(x)}</span> },
    { accessorKey: 'amount', header: '₹ impact', meta: { num: true }, cell: ({ getValue }) => <span className="font-medium">{inr(getValue())}</span> },
  ], [users]) // eslint-disable-line react-hooks/exhaustive-deps

  const atStake = open.reduce((s, x) => s + x.amount, 0)
  const exportCsv = () => downloadCsv(`exceptions-${entity.id}-${today}.csv`, ['ID', 'Type', 'Title', 'Document', 'Owner', 'Status', 'Priority', 'Due', 'Impact'],
    list.map(x => [x.id, x.type, x.title, x.docRef, users.find(u => u.id === x.ownerId)?.name ?? 'Auto', exStatus(x).label, x.priority, date(x.due), x.amount]))

  return (
    <>
      <PageHeader title="Exceptions"
        sub={<>{open.length} open · <span className="font-medium text-bad">{open.filter(x => x.priority === 'Critical').length} critical</span> · <span className="font-medium text-bad">{open.filter(x => slaOver(x) > 0).length} past SLA</span> · {lakhCrStr(atStake)} at stake · rules run on every SAP and GST portal sync</>}
        actions={<>
          <Segmented label="View" value={view} onChange={v => set('view', v)} options={[{ value: 'table', label: 'Table', icon: <Table className="size-3.5" /> }, { value: 'board', label: 'Board', icon: <Kanban className="size-3.5" /> }]} />
          <Button onClick={() => setRulesOpen(true)}><SlidersHorizontal />Rules</Button>
          <Button onClick={exportCsv}><Download />Export</Button>
        </>} />

      <Filters>
        <FilterChip on={!type} onClick={() => set('type', null)}>All types · {base.length}</FilterChip>
        {types.map(t => <FilterChip key={t.t} on={type === t.t} onClick={() => set('type', type === t.t ? null : t.t)}>{t.t} · {t.n}</FilterChip>)}
      </Filters>
      <Filters>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><FilterChip on={!!owner} icon={<User className="size-3.5" />}>{owner ? users.find(u => u.id === owner)?.name : 'Owner'}</FilterChip></DropdownMenuTrigger>
          <DropdownMenuContent align="start"><DropdownMenuRadioGroup value={owner ?? ''} onValueChange={v => setOwner(v || null)}><DropdownMenuRadioItem value="">Anyone</DropdownMenuRadioItem>{users.map(u => <DropdownMenuRadioItem key={u.id} value={u.id}>{u.name}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><FilterChip on={!!prio}>{prio ? 'Priority: ' + prio : 'Priority'}</FilterChip></DropdownMenuTrigger>
          <DropdownMenuContent align="start"><DropdownMenuRadioGroup value={prio ?? ''} onValueChange={v => setPrio((v || null) as Priority | null)}><DropdownMenuRadioItem value="">Any</DropdownMenuRadioItem>{PRIOS.map(p => <DropdownMenuRadioItem key={p} value={p}>{p}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><FilterChip on={!!due}>{due === 'overdue' ? 'Due: past SLA' : due === 'week' ? 'Due: within 7 days' : 'Due date'}</FilterChip></DropdownMenuTrigger>
          <DropdownMenuContent align="start"><DropdownMenuRadioGroup value={due ?? ''} onValueChange={v => setDue((v || null) as typeof due)}><DropdownMenuRadioItem value="">Any</DropdownMenuRadioItem><DropdownMenuRadioItem value="overdue">Past SLA</DropdownMenuRadioItem><DropdownMenuRadioItem value="week">Within 7 days</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><FilterChip on>{'Status: ' + { open: 'open', snoozed: 'snoozed', resolved: 'resolved', all: 'all' }[status]}</FilterChip></DropdownMenuTrigger>
          <DropdownMenuContent align="start"><DropdownMenuRadioGroup value={status} onValueChange={v => setStatus(v as StatusFilter)}>{(['open', 'snoozed', 'resolved', 'all'] as const).map(s => <DropdownMenuRadioItem key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
        </DropdownMenu>
        <FilterChip on={mine} onClick={() => setMine(m => !m)}>Assigned to me</FilterChip>
        <Spacer /><span className="text-[11px] text-text-3">Sorted by priority, then due date</span>
      </Filters>

      <Q q={q}>{() => view === 'table' ? (
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-2">
            <DataTable id="exceptions" data={list} columns={columns} getRowId={x => x.id} selectable maxHeight={820} activeId={exId ?? undefined}
              onRowClick={x => set('ex', x.id)} toolbar={null}
              bulk={(rows, clear) => <ExceptionBulk rows={rows} clear={clear} />}
              empty={<EmptyState title="No exceptions match" icon={<Check className="size-5" />}>Change the filters, or enjoy the quiet.</EmptyState>} />
          </div>
          {selected && <Card className="flex-[1_1_380px]"><Detail x={selected} onClose={() => set('ex', null)} /></Card>}
        </div>
      ) : (
        <Board list={list} all={all.filter(x => (!type || x.type === type))} onOpen={id => set('ex', id)} activeId={exId} />
      )}</Q>

      {view === 'board' && (
        <Sheet open={!!selected} onOpenChange={o => !o && set('ex', null)}>
          <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[460px]"><SheetTitle className="sr-only">Exception detail</SheetTitle>{selected && <Detail x={selected} onClose={() => set('ex', null)} />}</SheetContent>
        </Sheet>
      )}

      <RulesDialog open={rulesOpen} onOpenChange={setRulesOpen} readOnly={readOnly} />
    </>
  )
}

function ExceptionBulk({ rows, clear }: { rows: ExceptionItem[]; clear: () => void }) {
  const { users, readOnly } = useSession()
  const { act } = useAct()
  const [dueOpen, setDueOpen] = useState(false)
  const [resolveOpen, setResolveOpen] = useState(false)
  const ids = rows.map(r => r.id)
  const run = async (patch: Parameters<typeof api.updateExceptions>[1], msg: string) => { if (await act(() => api.updateExceptions(ids, patch), msg)) clear() }
  return (
    <BulkBar>
      <span className="font-medium">{rows.length} selected</span>
      <span className="text-xs opacity-80">{inr(rows.reduce((s, r) => s + r.amount, 0))} at stake</span>
      <Spacer />
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" disabled={readOnly}><User />Assign to<ChevronDown /></Button></DropdownMenuTrigger>
        <DropdownMenuContent>{users.map(u => <DropdownMenuItem key={u.id} onSelect={() => run({ ownerId: u.id }, `Assigned ${rows.length} to ${u.name}`)}>{u.name}<span className="ml-auto pl-2 text-[11px] text-text-3">{u.title}</span></DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" disabled={readOnly}>Priority<ChevronDown /></Button></DropdownMenuTrigger>
        <DropdownMenuContent>{PRIOS.map(p => <DropdownMenuItem key={p} onSelect={() => run({ priority: p }, `Priority set to ${p}`)}><Prio p={p} /></DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" disabled={readOnly} onClick={() => setDueOpen(true)}><Calendar />Due date</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" disabled={readOnly}><Pause />Snooze</Button></DropdownMenuTrigger>
        <DropdownMenuContent>{[1, 3, 7].map(d => <DropdownMenuItem key={d} onSelect={() => run({ snoozeDays: d }, `Snoozed for ${d} day${d > 1 ? 's' : ''}`)}>{d} day{d > 1 ? 's' : ''}</DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" disabled={readOnly} onClick={() => setResolveOpen(true)}><Check />Resolve</Button>
      <Button size="icon-sm" aria-label="Clear selection" className="text-surface" onClick={clear}><X /></Button>
      <DueDialog open={dueOpen} onOpenChange={setDueOpen} onSave={d => run({ due: d }, `Due date set to ${date(d)}`)} />
      <ResolveDialog open={resolveOpen} onOpenChange={setResolveOpen} count={rows.length} onSave={r => run({ status: 'resolved', resolution: r }, `${rows.length} resolved`)} />
    </BulkBar>
  )
}

function DueDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (d: string) => void }) {
  const [d, setD] = useState(addDays(todayIso(), 2))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-text sm:max-w-[360px]"><DialogHeader><DialogTitle>Set due date</DialogTitle></DialogHeader>
        <Input type="date" value={d} min={todayIso()} onChange={e => setD(e.target.value)} />
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="default" onClick={() => { onSave(d); onOpenChange(false) }}>Set</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResolveDialog({ open, onOpenChange, count, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; count: number; onSave: (r: string) => void }) {
  const [r, setR] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-text"><DialogHeader><DialogTitle>Resolve {count} exception{count > 1 ? 's' : ''}</DialogTitle><DialogDescription>Say how it was resolved. This goes to the history and the audit log.</DialogDescription></DialogHeader>
        <Textarea rows={3} value={r} onChange={e => setR(e.target.value)} placeholder="e.g. Vendor issued credit note KC/CN/0043" />
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="default" disabled={!r.trim()} onClick={() => { onSave(r.trim()); onOpenChange(false); setR('') }}><Check />Resolve</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Detail({ x, onClose }: { x: ExceptionItem; onClose: () => void }) {
  const { users, readOnly } = useSession()
  const { act, pending } = useAct()
  const [tab, setTab] = useState<'evidence' | 'comments' | 'history'>('evidence')
  const [comment, setComment] = useState('')
  const [callback, setCallback] = useState(false)
  const [resolve, setResolve] = useState(false)
  const owner = users.find(u => u.id === x.ownerId)
  const done = x.status === 'resolved'
  const dis = readOnly || pending
  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="mr-auto flex min-w-0 flex-col gap-1">
          <div className="text-[11px] font-medium text-text-3">{x.id} · {x.type}</div>
          <h2>{x.title}</h2>
          <div className="flex flex-wrap items-center gap-1.5"><Prio p={x.priority} /><StatusPill tone={exStatus(x).tone}>{exStatus(x).label}</StatusPill><span className="text-[11px] text-text-3">{done ? `Resolved ${date(x.resolvedAt)}` : `Due ${date(x.due)} · age ${ageOf(x)}`}</span>{slaOver(x) > 0 && <Sla>SLA +{slaOver(x)} d</Sla>}</div>
        </div>
        <Button size="icon" aria-label="Close panel" onClick={onClose}><X /></Button>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3.5">
        {x.blocks && !done && <Banner tone="bad" icon={<Lock className="size-4" />} className="py-2">Payments to vendor {x.blocks.vendorId} are blocked. <span className="font-medium">{inr(x.blocks.amount)}</span> held out of payment run {x.blocks.runId}.</Banner>}
        {done && x.resolution && <Banner tone="ok" icon={<Check className="size-4" />} className="py-2">{x.resolution}</Banner>}
        <div className="flex flex-wrap items-center gap-2">
          <Avatar id={x.ownerId} /><span className="text-xs">Owner <span className="font-medium">{owner?.name ?? 'Pravah (auto)'}</span>{owner && ` · ${owner.title}`}</span><Spacer />
          {!done && <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" disabled={dis}>Status<ChevronDown /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">{(['open', 'in-progress', 'waiting-vendor', 'awaiting-approval'] as ExceptionStatus[]).map(s => <DropdownMenuItem key={s} disabled={s === x.status} onSelect={() => act(() => api.updateExceptions([x.id], { status: s }), `Moved to ${STATUS[s].label}`)}>{STATUS[s].label}</DropdownMenuItem>)}</DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" disabled={dis}>Reassign</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end"><DropdownMenuLabel>Assign to</DropdownMenuLabel><DropdownMenuSeparator />{users.map(u => <DropdownMenuItem key={u.id} onSelect={() => act(() => api.updateExceptions([x.id], { ownerId: u.id }), `Assigned to ${u.name}`)}>{u.name}<span className="ml-auto pl-2 text-[11px] text-text-3">{u.title}</span></DropdownMenuItem>)}</DropdownMenuContent>
            </DropdownMenu>
          </>}
        </div>

        <LineTabs label="Exception sections" value={tab} onChange={setTab} items={[{ value: 'evidence', label: 'Evidence' }, { value: 'comments', label: 'Comments', count: x.comments.length }, { value: 'history', label: 'History' }]} />

        {tab === 'evidence' && <>
          {x.evidence ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full table-fixed border-separate border-spacing-0 text-[12.5px] [&_td]:[overflow-wrap:anywhere] [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_th]:border-b [&_th]:border-border [&_th]:bg-surface-2 [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:text-text-2">
                <thead><tr><th /><th>{x.evidence.head[0]}</th><th>{x.evidence.head[1]}</th></tr></thead>
                <tbody>{x.evidence.rows.map(r => (
                  <tr key={r.label}><td className="text-text-2">{r.label}</td><td className={cn('text-[11px]', r.mono && 'font-mono')}>{r.current}</td>
                    <td><span className="flex items-center gap-1">{r.bad ? <X className="size-3.5 flex-none text-bad" /> : null}<span className={cn('text-[11px]', r.mono && 'font-mono')}>{r.requested}</span></span>{r.sub && <div className="text-[11px] text-text-3">{r.sub}</div>}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="text-xs text-text-2">{x.evidenceNote ?? `Raised by rule on ${date(x.createdAt)} for ${x.docRef}. Open the linked document to see the details.`}</p>}
          {x.sources && <div className="flex flex-wrap gap-1.5">{x.sources.map(s => <Source key={s.source} name={s.source} text={s.text} />)}</div>}
          {x.docRoute && <Link to={x.docRoute} className="inline-flex items-center gap-1 text-xs">Open {x.docRef}<ArrowRight className="size-3" /></Link>}
          {x.checklist && !done && (
            <div className="flex flex-col gap-1.5">
              <Up>To release payments</Up>
              {x.checklist.map(c => <label key={c.id} className="flex items-start gap-2 text-xs"><Chk checked={c.done} disabled={dis} onChange={() => act(() => api.toggleChecklist(x.id, c.id))} /><span className={cn(c.done && 'text-text-3 line-through')}>{c.label}</span></label>)}
            </div>
          )}
          {!done && (
            <div className="flex flex-wrap gap-2">
              {x.type === 'Vendor bank details changed' ? <>
                <Button variant="default" disabled={dis} onClick={() => setCallback(true)}><Phone />Record call-back</Button>
                <Button variant="destructive" disabled={dis} onClick={() => act(() => api.rejectBankChange(x.id), 'Bank change rejected · payments released to the existing account')}>Reject change</Button>
              </> : <Button variant="default" disabled={dis} onClick={() => setResolve(true)}><Check />Resolve</Button>}
              <Button disabled={dis || owner?.role === 'cfo'} onClick={() => act(() => api.escalate(x.id), 'Escalated to the CFO')}>Escalate</Button>
            </div>
          )}
        </>}

        {tab === 'comments' && <>
          {x.comments.map(c => <CommentRow key={c.id} c={c} />)}
          {!x.comments.length && <p className="text-xs text-text-3">No comments yet.</p>}
          <form className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-2.5" onSubmit={async e => { e.preventDefault(); if (await act(() => api.addComment(x.id, comment))) setComment('') }}>
            <input className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-3" aria-label="Add a comment" placeholder="Comment, or @mention someone" value={comment} onChange={e => setComment(e.target.value)} disabled={readOnly} />
            <Button size="icon-sm" type="submit" aria-label="Send comment" disabled={!comment.trim() || dis}><Send /></Button>
          </form>
          <div className="text-[11px] text-text-3">Mention with @ and a first name, e.g. {users.slice(0, 3).map(u => '@' + u.name.split(' ')[0]).join(', ')}.</div>
        </>}

        {tab === 'history' && (
          <div className="flex flex-col gap-1.5 text-[11px] text-text-2">
            {[...x.history].reverse().map((h, i) => <div key={i} className="flex gap-2"><span className="whitespace-nowrap text-text-3">{dayMonthTime(h.at)}</span><span>{h.text}</span></div>)}
          </div>
        )}
      </div>
      <CallbackDialog open={callback} onOpenChange={setCallback} x={x} />
      <ResolveDialog open={resolve} onOpenChange={setResolve} count={1} onSave={r => act(() => api.updateExceptions([x.id], { status: 'resolved', resolution: r }), `${x.id} resolved`)} />
    </div>
  )
}

function CallbackDialog({ open, onOpenChange, x }: { open: boolean; onOpenChange: (o: boolean) => void; x: ExceptionItem }) {
  const { act, pending } = useAct()
  const [outcome, setOutcome] = useState<'confirmed' | 'denied' | 'no-answer'>('confirmed')
  const [note, setNote] = useState('')
  const number = x.evidence?.rows.find(r => r.label === 'Call-back')?.current
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Record call-back</DialogTitle><DialogDescription>Call the number in the vendor master{number ? ` (${number})` : ''}, not the one in the email.</DialogDescription></DialogHeader>
        <div className="flex flex-col gap-1.5">
          {([['confirmed', 'Vendor confirmed the change'], ['denied', 'Vendor denied making the request'], ['no-answer', 'No answer']] as const).map(([v, l]) => (
            <label key={v} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2', outcome === v ? 'border-acc bg-acc-weak' : 'border-border')}><input type="radio" name="cb" checked={outcome === v} onChange={() => setOutcome(v)} className="accent-[var(--primary)]" />{l}</label>
          ))}
        </div>
        <Textarea rows={2} placeholder="Who you spoke to, and what they said" value={note} onChange={e => setNote(e.target.value)} />
        <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="default" disabled={pending} onClick={async () => { if (await act(() => api.recordCallback(x.id, outcome, note), 'Call-back recorded')) onOpenChange(false) }}><Phone />Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const LANES: { key: ExceptionStatus; title: string }[] = [
  { key: 'open', title: 'Open' }, { key: 'in-progress', title: 'In progress' }, { key: 'waiting-vendor', title: 'Waiting on vendor' }, { key: 'awaiting-approval', title: 'Awaiting approval' }, { key: 'resolved', title: 'Resolved this week' },
]

function Board({ list, all, onOpen, activeId }: { list: ExceptionItem[]; all: ExceptionItem[]; onOpen: (id: string) => void; activeId: string | null }) {
  const [expanded, setExpanded] = useState<string[]>([])
  return (
    <div className="overflow-auto">
      <div className="grid min-w-[1100px] grid-cols-5 items-start gap-3">
        {LANES.map(l => {
          const items = (l.key === 'resolved' ? all.filter(x => x.status === 'resolved') : list.filter(x => x.status === l.key))
          const shown = expanded.includes(l.key) ? items : items.slice(0, 4)
          return (
            <section key={l.key} aria-label={l.title} className="flex min-w-0 flex-col gap-2 rounded-lg bg-surface-2 p-2">
              <div className="flex items-center gap-2 px-1 pt-1 pb-0.5 text-[12.5px] font-semibold"><span>{l.title}</span><span className="rounded-[9px] bg-surface-3 px-1.5 text-[11px] text-text-2">{items.length}</span><Spacer /><span className="text-[11px] font-normal text-text-3">{lakhCrStr(items.reduce((s, x) => s + x.amount, 0))}</span></div>
              {shown.map(x => <ExceptionCard key={x.id} x={x} onOpen={() => onOpen(x.id)} active={activeId === x.id} />)}
              {!items.length && <div className="px-1 py-3 text-center text-[11px] text-text-3">Nothing here</div>}
              {items.length > 4 && <Button size="sm" variant="ghost" className="justify-start" onClick={() => setExpanded(e => e.includes(l.key) ? e.filter(k => k !== l.key) : [...e, l.key])}>{expanded.includes(l.key) ? 'Show fewer' : `+ ${items.length - 4} more`}</Button>}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function RulesDialog({ open, onOpenChange, readOnly }: { open: boolean; onOpenChange: (o: boolean) => void; readOnly: boolean }) {
  const rules = useRules().data ?? []
  const { act } = useAct()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader><DialogTitle>Exception rules</DialogTitle><DialogDescription>Rules run on every SAP and GST portal sync. Turning one off stops new exceptions of that type; open ones stay.</DialogDescription></DialogHeader>
        <div className="flex max-h-[420px] flex-col gap-1.5 overflow-auto">
          {rules.map(r => (
            <label key={r.id} className="flex items-start gap-3 rounded-md border border-border px-3 py-2">
              <Chk checked={r.enabled} disabled={readOnly} onChange={() => act(() => api.toggleRule(r), `${r.name} ${r.enabled ? 'off' : 'on'}`)} />
              <span className="flex flex-1 flex-col"><span className="font-medium">{r.name} <span className="font-mono text-[11px] text-text-3">{r.id}</span></span><span className="text-[11px] text-text-2">{r.description}</span></span>
              <span className="flex flex-col items-end gap-1"><Prio p={r.priority} /><span className="text-[11px] text-text-3">SLA {r.slaDays} d</span></span>
            </label>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
