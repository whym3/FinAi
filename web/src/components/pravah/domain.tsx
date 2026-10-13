import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Book, Box, Check, DoorOpen, File, FileCheck, IndianRupee, RefreshCw, Tag, Truck, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { daysFromNow, dayMonthTime, date, inr } from '@/lib/format'
import type { Comment, ExceptionItem, MatchCell, Stage } from '@/lib/types'
import { useSession } from '@/app/session'
import { Avatar, BadIcon, NoneIcon, OkIcon, Prio, Sla, StatusPill, WarnIcon } from './status'

/* ---------- comparison-grid cell ---------- */

export function CompareCell({ c }: { c: MatchCell }) {
  const I = { ok: OkIcon, warn: WarnIcon, bad: BadIcon, none: NoneIcon, na: null }[c.s]
  const v = c.s === 'na' ? 'n/a' : c.s === 'none' ? (c.v || 'Missing') : c.v
  return (
    <div className={cn('relative flex min-h-[34px] flex-col gap-0.5 px-2.5 py-[7px]',
      c.s === 'warn' && 'bg-warn-bg shadow-[inset_0_0_0_1px_var(--warn-bd)]',
      c.s === 'bad' && 'bg-bad-bg shadow-[inset_0_0_0_1px_var(--bad-bd)]',
      c.s === 'none' && 'hatch text-text-3', c.s === 'na' && 'text-text-3')}>
      <div className="flex items-center justify-between gap-1.5">
        {I && <I className={{ ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', none: 'text-none', na: '' }[c.s]} />}
        <span className={cn(c.num && 'tabular-nums', 'text-right')}>{v}</span>
      </div>
      {c.d && <div className={cn('text-[11px] leading-[14px]', c.s === 'bad' ? 'font-semibold text-bad' : c.s === 'warn' ? 'font-semibold text-warn' : 'text-text-3')}>{c.d}</div>}
    </div>
  )
}

/* ---------- timeline stage ---------- */

const stageIcon: Record<string, typeof File> = { neg: Tag, po: File, dispatch: Truck, gate: DoorOpen, grn: Box, review: FileCheck, posting: Book, payment: IndianRupee, recon: RefreshCw }

export function TimelineStage({ s, last }: { s: Stage; last?: boolean }) {
  const I = s.state === 'done' ? Check : s.state === 'blk' ? X : stageIcon[s.key] ?? File
  return (
    <div className="relative flex flex-col gap-1.5 pr-2">
      <div className="flex h-7 items-center">
        <span className={cn('z-[1] grid size-7 flex-none place-items-center rounded-full border-2',
          s.state === 'done' && 'border-ok bg-ok text-surface',
          s.state === 'cur' && 'border-acc bg-acc-weak text-acc shadow-[0_0_0_4px_var(--accent)]',
          s.state === 'blk' && 'border-bad bg-bad-bg text-bad',
          s.state === 'ns' && 'border-dashed border-border-2 bg-surface text-text-3')}>
          <I className="size-3.5" aria-hidden />
        </span>
        <span className={cn('ml-1 h-0.5 flex-auto', s.state === 'done' ? 'bg-ok' : s.state === 'cur' || s.state === 'ns' ? 'dash-line' : 'bg-border-2', last && 'invisible')} />
      </div>
      <div className={cn('flex min-h-[150px] flex-col gap-[3px] rounded-lg border bg-surface px-2.5 py-2 text-[11.5px] leading-4',
        s.state === 'cur' && 'border-acc shadow-[0_0_0_1px_var(--primary)]', s.state === 'blk' && 'border-bad-bd',
        s.state === 'ns' && 'border-dashed bg-transparent text-text-3', s.state !== 'cur' && s.state !== 'blk' && s.state !== 'ns' && 'border-border')}>
        <div className={cn('text-[12.5px] leading-[17px] font-semibold', s.state === 'ns' ? 'text-text-2' : 'text-text')}>{s.name}</div>
        <div className="text-text-2">{s.date}</div>
        <div className="flex items-center gap-[5px]">{s.ownerId && <Avatar id={s.ownerId} size="sm" />}<span className="min-w-0">{s.owner}</span></div>
        <div className="font-mono text-[11px] text-text-2">{s.ref}</div>
        {s.docs.length > 0 && <div className="mt-0.5 flex flex-wrap gap-x-1 gap-y-[3px]">{s.docs.map(d => <span key={d} className="inline-flex items-center gap-[3px] text-[11px] text-acc"><File className="size-3" aria-hidden />{d}</span>)}</div>}
        <div className="mt-auto pt-1"><StatusPill tone={s.sla.tone} plain>{s.sla.label}</StatusPill></div>
      </div>
    </div>
  )
}

/* ---------- exceptions ---------- */

export function slaOver(x: ExceptionItem): number {
  if (x.status === 'resolved') return 0
  return Math.max(0, -daysFromNow(x.due))
}
export function ageOf(x: ExceptionItem): string {
  return x.status === 'resolved' ? '—' : `${Math.max(0, -daysFromNow(x.createdAt))} d`
}

export function ExceptionCard({ x, onOpen, active }: { x: ExceptionItem; onOpen?: () => void; active?: boolean }) {
  const { users } = useSession()
  const over = slaOver(x)
  const owner = users.find(u => u.id === x.ownerId)
  return (
    <article className={cn('flex flex-col gap-1.5 rounded-lg border bg-surface px-3 py-2.5 text-xs leading-[17px]', x.priority === 'Critical' && x.status !== 'resolved' ? 'border-bad-bd' : 'border-border', active && 'ring-2 ring-acc')}>
      <div className="flex items-center justify-between gap-2"><span className="text-[11px] font-medium text-text-3">{x.id} · {x.type}</span><Prio p={x.priority} label={false} /></div>
      <button type="button" onClick={onOpen} className="cursor-pointer text-left text-[12.5px] leading-[17px] font-semibold hover:text-acc">{x.title}</button>
      <div className="font-mono text-[11px]">{x.docRoute ? <Link to={x.docRoute}>{x.docRef}</Link> : x.docRef}</div>
      <div className="flex items-center justify-between"><span className="font-medium tabular-nums">{inr(x.amount)}</span>{over > 0 && <Sla>SLA +{over} d</Sla>}</div>
      <div className="flex items-center justify-between gap-2"><span className="inline-flex items-center gap-[5px]"><Avatar id={x.ownerId} size="sm" /><span className="text-[11px] text-text-2">{owner?.name ?? 'Auto'}</span></span><span className="text-[11px] whitespace-nowrap text-text-3">{x.status === 'resolved' ? 'Closed ' + date(x.resolvedAt) : 'Due ' + date(x.due)}</span></div>
    </article>
  )
}

export function CommentRow({ c }: { c: Comment }) {
  const { users } = useSession()
  const u = users.find(u => u.id === c.byId)
  return (
    <div className="flex gap-2 text-[12.5px] leading-[18px]">
      <Avatar id={c.byId} />
      <div className="min-w-0 flex-1 rounded-lg bg-surface-2 px-2.5 py-1.5">
        <div className="text-[11px] text-text-3"><span className="font-medium text-text">{u?.name ?? 'Pravah rule'}</span> · {dayMonthTime(c.at)}</div>
        {c.text}
      </div>
    </div>
  )
}

/* ---------- radio option card (decision, approval) ---------- */

export function OptionCard({ name, checked, onChange, title, desc, disabled }: { name: string; checked: boolean; onChange: () => void; title: ReactNode; desc?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2 rounded-md border bg-surface px-2.5 py-2', checked ? 'border-acc bg-acc-weak' : 'border-border', disabled && 'cursor-not-allowed opacity-60')}>
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5 accent-[var(--primary)]" />
      <span className="flex flex-col"><span className="font-medium">{title}</span>{desc && <span className="text-[11px] text-text-3">{desc}</span>}</span>
    </label>
  )
}
