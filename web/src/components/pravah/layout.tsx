import type { ComponentProps, ReactNode } from 'react'
import { Link } from 'react-router'
import { Tabs as TabsPrimitive } from 'radix-ui'
import { ChevronRight, Inbox, Lock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { inr, lakhCr } from '@/lib/format'
import type { Kpi, SyncKey, Tone } from '@/lib/types'
import { BadIcon, Count, Source, StatusPill, WarnIcon, toneText } from './status'

/* ---------- page header ---------- */

export function PageHeader({ title, sub, crumbs, badges, actions, meta }: {
  title: ReactNode; sub?: ReactNode; crumbs?: { label: string; to?: string }[]; badges?: ReactNode; actions?: ReactNode; meta?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        {crumbs && (
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs text-text-3">
            {crumbs.map((c, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="size-3" aria-hidden />}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2.5"><h1>{title}</h1>{badges}</div>
        {sub && <p className="text-xs text-text-2">{sub}</p>}
        {meta && <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-text-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/* ---------- card ---------- */

export function Card({ className, ...p }: ComponentProps<'section'>) {
  return <section className={cn('min-w-0 rounded-lg border border-border bg-surface', className)} {...p} />
}
export function CardHeader({ title, children, className, as: H = 'h2' }: { title?: ReactNode; children?: ReactNode; className?: string; as?: 'h2' | 'h3' }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3', className)}>
      {title && <H className="mr-auto">{title}</H>}
      {children}
    </div>
  )
}
export const CardBody = ({ className, ...p }: ComponentProps<'div'>) => <div className={cn('px-4 py-3.5', className)} {...p} />
export const CardFooter = ({ className, ...p }: ComponentProps<'div'>) => <div className={cn('flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5', className)} {...p} />

/* ---------- banner ---------- */

export function Banner({ tone, icon, children, actions, className, role = 'status' }: { tone: 'info' | 'warn' | 'bad' | 'ok'; icon?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; role?: string }) {
  const style = {
    info: 'bg-acc-weak border-transparent [&>.bi]:text-acc',
    warn: 'bg-warn-bg border-warn-bd [&>.bi]:text-warn',
    bad: 'bg-bad-bg border-bad-bd [&>.bi]:text-bad',
    ok: 'bg-ok-bg border-ok-bd [&>.bi]:text-ok',
  }[tone]
  return (
    <div role={role} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-[18px] text-text', style, className)}>
      <span className="bi shrink-0">{icon ?? (tone === 'bad' ? <BadIcon size={16} /> : <WarnIcon size={16} />)}</span>
      <div className="min-w-0 flex-[1_1_220px]">{children}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

/* ---------- key-value ---------- */

export function KV({ items, className }: { items: [ReactNode, ReactNode, string?][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[minmax(110px,auto)_minmax(0,1fr)] gap-x-3.5 gap-y-[7px] text-[12.5px] leading-[18px]', className)}>
      {items.map(([k, v, cls], i) => [
        <dt key={'k' + i} className="text-text-2">{k}</dt>,
        <dd key={'v' + i} className={cn('m-0 min-w-0', cls)}>{v}</dd>,
      ])}
    </dl>
  )
}

/* ---------- filters, segmented, tabs, bulk bar ---------- */

export function FilterChip({ on, children, icon, className, ...rest }: { on?: boolean; icon?: ReactNode } & ComponentProps<'button'>) {
  return (
    <button type="button" aria-pressed={!!on} {...rest} className={cn(className, 'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium whitespace-nowrap', on ? 'border-solid border-acc bg-acc-weak text-acc' : 'border-dashed border-border-2 bg-surface text-text-2 hover:text-text')}>
      {icon}{children}
    </button>
  )
}
export const Filters = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>
export const Spacer = () => <span className="flex-auto" />

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit gap-0.5 rounded-lg bg-surface-3 p-0.5">
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          className={cn('inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-md px-3 py-1 text-[12.5px] font-medium whitespace-nowrap', o.value === value ? 'bg-surface text-text shadow-[0_1px_2px_rgba(0,0,0,.12)]' : 'text-text-2 hover:text-text')}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  )
}

export function LineTabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number; tone?: 'bad' | 'warn' | 'acc' }[]; label: string }) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={v => onChange(v as T)} activationMode="manual">
      <TabsPrimitive.List aria-label={label} className="flex flex-wrap gap-x-[18px] gap-y-0.5 border-b border-border">
        {items.map(i => (
          <TabsPrimitive.Trigger key={i.value} value={i.value}
            className="-mb-px inline-flex cursor-pointer items-center gap-1.5 border-b-2 border-transparent pt-2 pb-[9px] font-medium whitespace-nowrap text-text-2 hover:text-text data-[state=active]:border-acc data-[state=active]:text-text">
            {i.label}{i.count != null && <Count n={i.count} tone={i.tone} />}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}

/** Dark bar shown when table rows are selected. Buttons inside should use variant="bulk". */
export function BulkBar({ children, label = 'Bulk actions' }: { children: ReactNode; label?: string }) {
  return <div role="region" aria-label={label} className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg bg-text px-3 py-2 text-surface [&_button]:border-white/30 [&_button]:bg-transparent [&_button]:text-surface [&_button:hover]:bg-white/10 [&_button:hover]:text-surface dark:[&_button]:border-black/25 dark:[&_button:hover]:bg-black/10">{children}</div>
}

/* ---------- KPI card ---------- */

export function KpiCard({ k, compact }: { k: Kpi; compact?: boolean }) {
  const scaled = (k.unit ?? 'inr') === 'inr' ? lakhCr(k.value) : { v: String(k.value), u: k.unit === 'days' ? 'days' : '' }
  const body = (
    <article title={k.exact ?? ((k.unit ?? 'inr') === 'inr' ? inr(k.value) : undefined)} className={cn('flex h-full min-w-0 flex-col gap-1 rounded-lg border bg-surface', compact ? 'px-3 pt-2.5 pb-2' : 'px-3.5 pt-3 pb-2.5', k.tone === 'bad' ? 'border-bad-bd' : k.tone === 'warn' ? 'border-warn-bd' : 'border-border')}>
      <div className={cn('text-xs leading-4 font-medium text-text-2', compact ? 'min-h-8' : 'min-h-8')}>{k.label}</div>
      <div className={cn('font-semibold tracking-[-.01em] whitespace-nowrap', compact ? 'text-xl leading-[26px]' : 'text-[22px] leading-7')}>
        {scaled.v}{scaled.u && <small className="ml-0.5 text-[13px] font-medium text-text-2">{scaled.u}</small>}
      </div>
      {!compact && <div className="min-h-4 text-[11.5px] leading-4 text-text-2">{k.sub}</div>}
      {k.status && k.tone && <div><StatusPill tone={k.tone}>{k.status}</StatusPill></div>}
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2"><Source name={k.source} syncKey={k.syncKey as SyncKey} /></div>
    </article>
  )
  return k.link ? <Link to={k.link} className="block text-inherit no-underline hover:text-inherit hover:no-underline [&>article]:hover:border-border-2">{body}</Link> : body
}

/* ---------- amounts ---------- */

export function Amount({ n, masked, delta, className }: { n: number; masked?: boolean; delta?: boolean; className?: string }) {
  if (masked) return <span className={cn('inline-flex items-center gap-1 text-text-3', className)}><Lock className="size-3" aria-hidden />₹ ••••••</span>
  return <span className={cn('tabular-nums whitespace-nowrap', n < 0 && 'text-bad', n === 0 && 'text-text-3', delta && n > 0 && 'font-medium text-bad', className)}>{delta && n > 0 ? '+' : ''}{inr(n)}</span>
}

/* ---------- states ---------- */

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-7 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-text-2">{icon ?? <Inbox className="size-5" />}</span>
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-[300px] text-xs text-text-2">{children}</div>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-7 text-center" role="alert">
      <span className="grid size-11 place-items-center rounded-full bg-bad-bg text-bad"><BadIcon size={20} /></span>
      <div className="font-medium">Couldn't load this</div>
      <div className="max-w-[300px] text-xs text-text-2">{error instanceof Error ? error.message : 'Something went wrong.'}</div>
      {onRetry && <Button size="sm" onClick={onRetry}><RefreshCw />Retry</Button>}
    </div>
  )
}

export function Restricted({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-7 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-surface-2 text-text-2"><Lock className="size-5" /></span>
      <div className="font-medium">You have read-only access</div>
      <div className="max-w-[300px] text-xs text-text-2">{children}</div>
    </div>
  )
}

export function Sk({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn('block h-3 animate-sk rounded-sm bg-[linear-gradient(90deg,var(--muted)_0%,var(--surface-3)_50%,var(--muted)_100%)] bg-[length:200%_100%]', className)} style={style} />
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Sk className="h-6 w-60" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"><Sk className="w-3/4" /><Sk className="h-5 w-1/2" /><Sk className="w-2/3" /></div>)}
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">{Array.from({ length: 6 }, (_, i) => <Sk key={i} style={{ width: `${70 + ((i * 7) % 30)}%` }} />)}</div>
    </div>
  )
}

/** Renders loading / error / data for a react-query result. */
export function Q<T>({ q, children, skeleton }: { q: { data?: T; error: unknown; isLoading: boolean; refetch: () => unknown }; children: (d: T) => ReactNode; skeleton?: ReactNode }) {
  if (q.isLoading) return <>{skeleton ?? <PageSkeleton />}</>
  if (q.error || q.data === undefined) return <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
  return <>{children(q.data)}</>
}

/* ---------- small text helpers ---------- */

export const Up = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cn('text-[11px] font-semibold tracking-[.06em] text-text-3 uppercase', className)}>{children}</div>
export const ToneText = ({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) => <span className={cn(toneText[tone], className)}>{children}</span>
