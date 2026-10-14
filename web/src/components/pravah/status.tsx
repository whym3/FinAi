import type { ComponentProps, ReactNode } from 'react'
import { useSession } from '@/app/session'
import { cn } from '@/lib/utils'
import { agoShort, ago, hoursSince } from '@/lib/format'
import type { AvatarColor, MsmeClass, SourceName, Status, SyncKey, Tone } from '@/lib/types'
import { ShieldCheck } from 'lucide-react'

/* ---------- the four status icons, drawn exactly as in the design ---------- */

type IconProps = ComponentProps<'svg'> & { size?: number }
const svg = (paths: ReactNode) => ({ size = 14, className, ...p }: IconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn('shrink-0', className)} {...p}>{paths}</svg>
)
export const OkIcon = svg(<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.8 2.8L16 9.5" /></>)
export const WarnIcon = svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)
export const BadIcon = svg(<><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></>)
export const NoneIcon = svg(<><circle cx="12" cy="12" r="9" strokeDasharray="3.2 3" /><path d="M8 12h8" /></>)
export const AccIcon = svg(<><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>)
export const toneIcon: Record<Tone, ReturnType<typeof svg>> = { ok: OkIcon, warn: WarnIcon, bad: BadIcon, none: NoneIcon, acc: AccIcon }
export const toneText: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', none: 'text-none', acc: 'text-acc' }

/* ---------- status pill: always icon + text ---------- */

const pill: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok border-ok-bd',
  warn: 'bg-warn-bg text-warn border-warn-bd',
  bad: 'bg-bad-bg text-bad border-bad-bd',
  none: 'bg-none-bg text-none border-none-bd',
  acc: 'bg-acc-weak text-acc border-transparent',
}

export function StatusPill({ tone, children, plain, icon, className }: { tone: Tone; children: ReactNode; plain?: boolean; icon?: ReactNode; className?: string }) {
  const I = toneIcon[tone]
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-[5px] rounded-full border pr-2 pl-1.5 text-xs leading-4 font-medium whitespace-nowrap', pill[tone], plain && 'border-transparent bg-transparent pl-0', className)}>
      {icon ?? <I />}{children}
    </span>
  )
}
export const Pill = ({ s, plain }: { s: Status; plain?: boolean }) => <StatusPill tone={s.tone} plain={plain}>{s.label}</StatusPill>

/* ---------- priority bars, SLA badge, counts ---------- */

export function Prio({ p, label = true }: { p: 'Critical' | 'High' | 'Medium' | 'Low'; label?: boolean }) {
  const lit = { Critical: 3, High: 2, Medium: 1, Low: 0 }[p]
  const color = { Critical: 'bg-bad', High: 'bg-warn', Medium: 'bg-text-2', Low: '' }[p]
  return (
    <span className="inline-flex items-center gap-[5px] text-xs font-medium whitespace-nowrap" aria-label={label ? undefined : `Priority ${p}`}>
      <i className="inline-flex h-[11px] items-end gap-[1.5px]" aria-hidden="true">
        {[5, 8, 11].map((h, i) => <s key={h} className={cn('block w-[3px] rounded-[1px]', i < lit ? color : 'bg-border-2')} style={{ height: h }} />)}
      </i>
      {label && p}
    </span>
  )
}

export function Sla({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-5 items-center gap-1 rounded-sm bg-[var(--sla)] px-1.5 text-[11px] font-semibold whitespace-nowrap text-white"><WarnIcon size={12} />{children}</span>
}

export function Count({ n, tone, className }: { n: number | string; tone?: 'bad' | 'warn' | 'acc'; className?: string }) {
  return (
    <span className={cn('min-w-5 rounded-[9px] px-1.5 text-center text-[11px] leading-4 font-semibold', !tone && 'bg-surface-3 text-text-2', tone === 'bad' && 'bg-bad-bg text-bad', tone === 'warn' && 'bg-warn-bg text-warn', tone === 'acc' && 'bg-acc text-on-acc', className)}>{n}</span>
  )
}

/* ---------- chips ---------- */

export function Chip({ children, acc, className }: { children: ReactNode; acc?: boolean; className?: string }) {
  return <span className={cn('inline-flex h-[22px] items-center gap-[5px] rounded-full border px-2 text-[11.5px] leading-4 font-medium whitespace-nowrap', acc ? 'border-transparent bg-acc-weak text-acc' : 'border-border bg-surface-2 text-text-2', className)}>{children}</span>
}

export function MsmeBadge({ cls, udyam }: { cls: MsmeClass | string; udyam?: boolean }) {
  return <span className="inline-flex h-[22px] items-center gap-[5px] rounded-sm bg-acc-weak px-2 text-[11.5px] font-semibold whitespace-nowrap text-acc"><ShieldCheck className="size-3" aria-hidden />{cls}{udyam && ' · Udyam'}</span>
}

export function Gstin({ g, state, short }: { g?: string; state?: string; short?: boolean }) {
  return (
    <span className="inline-flex items-stretch overflow-hidden rounded-[5px] border border-border-2 align-middle text-[11.5px] leading-5 whitespace-nowrap">
      {g && <span className="bg-surface px-1.5 font-mono tracking-[.02em] text-text">{g}</span>}
      {state && !short && <span className={cn('bg-surface-2 px-1.5 text-text-2', g && 'border-l border-border-2')}>{state}</span>}
    </span>
  )
}

/** Source chip: "[SAP] synced 10 min ago". Pass syncKey to derive time and staleness from the live source state. */
export function Source({ name, text, syncKey, stale }: { name: SourceName | string; text?: string; syncKey?: SyncKey; stale?: boolean }) {
  const { sync } = useSession()
  const s = syncKey ? sync.find(x => x.key === syncKey) : undefined
  const isStale = stale ?? (s ? (!s.at ? !!s.error : hoursSince(s.at) > s.staleAfterH) : false)
  const label = text ?? (s ? (s.at ? 'synced ' + ago(s.at) : s.error ?? 'not connected') : '')
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] leading-4 whitespace-nowrap', isStale ? 'text-warn' : 'text-text-3')}>
      <b className={cn('rounded-sm border px-1.5 font-medium', isStale ? 'border-warn-bd bg-warn-bg text-warn' : 'border-border bg-surface-2 text-text-2')}>{name}</b>{label}
    </span>
  )
}

export function Freshness({ k }: { k: SyncKey }) {
  const { sync } = useSession()
  const s = sync.find(x => x.key === k)
  if (!s) return null
  if (!s.at) {
    return <span title={`${s.system}: ${s.error ?? 'not connected'}`} className="inline-flex h-[26px] items-center gap-1.5 rounded-[13px] border border-dashed border-border-2 bg-surface px-[9px] text-[11.5px] whitespace-nowrap text-text-3"><NoneIcon size={12} />{s.label} · off</span>
  }
  const stale = hoursSince(s.at) > s.staleAfterH
  return (
    <span title={`${s.system} ${s.detail ? '· ' + s.detail + ' ' : ''}synced ${s.at.replace('T', ' ')}${stale ? ' — stale' : ''}`} className={cn('inline-flex h-[26px] items-center gap-1.5 rounded-[13px] border px-[9px] text-[11.5px] whitespace-nowrap', stale ? 'border-warn-bd bg-warn-bg text-warn' : 'border-border bg-surface text-text-2')}>
      {stale ? <WarnIcon size={12} /> : <span className="size-[7px] rounded-full bg-ok" />}{s.label} · {agoShort(s.at)}
    </span>
  )
}

export function useStale(k: SyncKey) {
  const { sync } = useSession()
  const s = sync.find(x => x.key === k) ?? { key: k, label: k.toUpperCase(), system: k, at: null, staleAfterH: 0, error: 'Not connected' }
  return { stale: s.at ? hoursSince(s.at) > s.staleAfterH : !!s.error, at: s.at, sync: s }
}

/* ---------- avatar ---------- */

const av: Record<Exclude<AvatarColor, ''>, string> = {
  a1: 'bg-[#DCE8F8] text-[#173E73] border-[#BCD2F0] dark:bg-[#1B3352] dark:text-[#BCD6F7] dark:border-[#2C4D78]',
  a2: 'bg-[#F7E2D6] text-[#6E2E0E] border-[#EEC6AF] dark:bg-[#4A2614] dark:text-[#F6CBB3] dark:border-[#6D3A1F]',
  a3: 'bg-[#DDEFE6] text-[#1A5235] border-[#B9DEC9] dark:bg-[#173A28] dark:text-[#B9E5CB] dark:border-[#24563C]',
  a4: 'bg-[#ECE3F6] text-[#47236E] border-[#D6C4EC] dark:bg-[#33204D] dark:text-[#DCC9F2] dark:border-[#4C3170]',
  a5: 'bg-[#F4ECCB] text-[#5B4605] border-[#E5D490] dark:bg-[#3D3210] dark:text-[#EEDD9E] dark:border-[#5C4B18]',
}

export function Avatar({ id, size = 'md', className }: { id: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const { users } = useSession()
  const u = users.find(u => u.id === id)
  const color = u?.color
  const auto = !id || id === 'PV'
  return (
    <span title={u ? `${u.name} · ${u.title}` : auto ? 'Pravah (automatic)' : `User ${id}`} className={cn('inline-grid shrink-0 place-items-center rounded-full border font-semibold', color ? av[color] : 'border-border-2 bg-surface-3 text-text', size === 'sm' && 'size-5 text-[9px]', size === 'md' && 'size-6 text-[10px]', size === 'lg' && 'size-8 text-xs', className)}>
      {u?.initials ?? (auto ? 'PV' : '?')}
    </span>
  )
}

export function Person({ id, sub }: { id: string; sub?: boolean }) {
  const { users } = useSession()
  const u = users.find(u => u.id === id)
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Avatar id={id} /><span className="text-xs">{u?.name ?? (!id || id === 'PV' ? 'Pravah (auto)' : 'Unassigned')}{sub && u && <span className="text-text-3"> · {u.title}</span>}</span></span>
}

/* ---------- confidence meter ---------- */

export function Confidence({ value, children }: { value?: number; children?: ReactNode }) {
  if (value == null) return <span className="text-[11.5px] text-text-3">—</span>
  const lvl = value >= 90 ? 'hi' : value >= 75 ? 'mid' : 'lo'
  const lit = { hi: 5, mid: 3, lo: 2 }[lvl]
  const color = { hi: 'bg-ok', mid: 'bg-warn', lo: 'bg-bad' }[lvl]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11.5px] font-medium whitespace-nowrap', { hi: 'text-ok', mid: 'text-warn', lo: 'text-bad' }[lvl])}>
      <span className="inline-flex gap-0.5" aria-hidden>{[0, 1, 2, 3, 4].map(i => <s key={i} className={cn('block h-2.5 w-1 rounded-[1px]', i < lit ? color : 'bg-border-2')} />)}</span>
      {children ?? `${value}%`}
    </span>
  )
}

/* ---------- progress bar ---------- */

export function Bar({ pct, tone, className }: { pct: number; tone?: 'ok' | 'warn' | 'bad'; className?: string }) {
  return (
    <span className={cn('block h-1.5 overflow-hidden rounded-[3px] bg-surface-3', className)} role="presentation">
      <i className={cn('block h-full rounded-[3px]', tone ? { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }[tone] : 'bg-acc')} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  )
}
