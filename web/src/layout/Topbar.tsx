import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { Bell, Building2, Calendar, ChevronDown, KeyRound, LogOut, Moon, Search, Sun, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Avatar, Freshness, Gstin, toneIcon, toneText, useStale } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useTheme } from '@/app/theme'
import { useAct, useCounts, useNotifications, useSearch } from '@/api/hooks'
import * as api from '@/api'
import { ago, dateTime } from '@/lib/format'
import type { SyncKey } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Link } from 'react-router'

export function EntitySwitcher({ compact }: { compact?: boolean }) {
  const { entity, entities, firm, scope, setEntityId, setScope, period } = useSession()
  const nav = useNavigate()
  const firmView = scope === 'firm'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Switch client entity" className={cn('flex min-w-0 xl:shrink-0 cursor-pointer items-center gap-2.5 rounded-lg bg-surface text-left', compact ? 'min-h-11 flex-auto border-0 px-1 py-0.5' : 'border border-border py-1 pr-2.5 pl-1.5')}>
          {!compact && <span className="grid size-[30px] flex-none place-items-center rounded-md bg-surface-3 text-text-2">{firmView ? <Users className="size-4" /> : <Building2 className="size-4" />}</span>}
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] leading-[18px] font-semibold">{firmView ? (compact ? 'All clients' : `All clients — ${firm.name}`) : compact ? entity.shortName : entity.name}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-[11px] leading-4 text-text-3">
              {compact ? (firmView ? `${entities.length} entities` : `FY 2026-27 · ${period}`) : firmView ? `${entities.length} entities · ${entities.reduce((n, e) => n + e.gstins.length, 0)} GSTINs · ${entities.map(e => e.city).join(', ')}` : <>
                <span>PAN <span className="font-mono">{entity.pan}</span></span>
                {entity.gstins.map(g => <Gstin key={g.gstin} state={`${g.code} · ${g.state}`} />)}
              </>}
            </span>
          </span>
          <ChevronDown className="size-4 flex-none text-text-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>{firm.name}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => { setScope('firm'); nav('/') }}><Users />All clients · firm view</DropdownMenuItem>
        <DropdownMenuSeparator />
        {entities.map(e => (
          <DropdownMenuItem key={e.id} onSelect={() => setEntityId(e.id)} className="items-start">
            <Building2 className="mt-0.5" />
            <span className="flex flex-col"><span className={cn(e.id === entity.id && !firmView && 'font-semibold')}>{e.name}</span><span className="text-[11px] text-text-3">{e.city} · {e.gstins.length} GSTIN{e.gstins.length > 1 ? 's' : ''}{e.status === 'onboarding' ? ' · onboarding' : ''}</span></span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Indian financial year (April–March): the months of the current FY up to today. */
function fyMonths(now = new Date()) {
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  const out: string[] = []
  for (let d = new Date(fyStart, 3, 1); d <= now; d.setMonth(d.getMonth() + 1)) out.push(d.toLocaleString('en-IN', { month: 'short', year: 'numeric' }))
  return { fy: `FY ${fyStart}-${String(fyStart + 1).slice(2)}`, months: out }
}
const quarter = (p: string) => ({ Apr: 'Q1 (Apr–Jun)', May: 'Q1 (Apr–Jun)', Jun: 'Q1 (Apr–Jun)', Jul: 'Q2 (Jul–Sep)', Aug: 'Q2 (Jul–Sep)', Sep: 'Q2 (Jul–Sep)', Oct: 'Q3 (Oct–Dec)', Nov: 'Q3 (Oct–Dec)', Dec: 'Q3 (Oct–Dec)', Jan: 'Q4 (Jan–Mar)', Feb: 'Q4 (Jan–Mar)', Mar: 'Q4 (Jan–Mar)' } as Record<string, string>)[p.slice(0, 3)]

function PeriodPicker() {
  const { period, setPeriod } = useSession()
  const { fy, months } = fyMonths()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Financial year and period"><Calendar className="text-text-3" />{fy}<span className="text-text-3">·</span>{period}<span className="hidden text-xs text-text-3 2xl:inline">{quarter(period)}</span><ChevronDown className="text-text-3" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{fy}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={period} onValueChange={setPeriod}>
          {months.map(m => <DropdownMenuRadioItem key={m} value={m}>{m} <span className="ml-auto pl-3 text-[11px] text-text-3">{quarter(m)}</span></DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SearchPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState('')
  const r = useSearch(q)
  const nav = useNavigate()
  const groups = (r.data ?? []).reduce<Record<string, typeof r.data>>((m, h) => ({ ...m, [h.kind]: [...(m[h.kind] ?? []), h] }), {})
  return (
    <CommandDialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setQ('') }} title="Search" description="Invoice no., GSTIN, PO, GRN, vendor or exception">
      <CommandInput placeholder="Invoice no., GSTIN, PO, GRN, UTR, IRN" value={q} onValueChange={setQ} />
      <CommandList>
        <CommandEmpty>{q.trim().length < 2 ? 'Type at least 2 characters.' : r.isFetching ? 'Searching…' : 'No matches.'}</CommandEmpty>
        {Object.entries(groups).map(([kind, hits]) => (
          <CommandGroup key={kind} heading={kind}>
            {hits!.map(h => (
              <CommandItem key={h.route + h.label} value={h.label + ' ' + h.sub} onSelect={() => { nav(h.route); onOpenChange(false); setQ('') }}>
                <span className="flex min-w-0 flex-col"><span className="font-medium">{h.label}</span><span className="truncate text-[11px] text-text-3">{h.sub}</span></span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}

/** Opens the search palette on Ctrl/Cmd-K. */
export function useSearchShortcut() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o) } }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  return [open, setOpen] as const
}

function FeedChip({ k }: { k: SyncKey }) {
  const { sync, stale } = useStale(k)
  const nav = useNavigate()
  return (
    <Popover>
      <PopoverTrigger asChild><button type="button" className="cursor-pointer rounded-[13px]" aria-label={`${sync.system} feed status`}><Freshness k={k} /></button></PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-xs">
        <div className="mb-1 font-semibold">{sync.system}</div>
        {sync.at ? <>
          <div className="text-text-2">Last synced {dateTime(sync.at)} · {ago(sync.at)}{sync.detail ? ` · ${sync.detail}` : ''}</div>
          <div className={cn('mt-1', stale ? 'text-warn' : 'text-ok')}>{stale ? `Stale: older than ${Math.round(sync.staleAfterH)} h. Figures from this source are marked.` : 'Up to date.'}</div>
          {sync.error && <div className="mt-1 text-bad">{sync.error}</div>}
        </> : <div className="text-text-2">{sync.error ?? 'Not connected yet.'}</div>}
        <Button size="sm" className="mt-2" onClick={() => nav(k === 'sap' && !sync.at ? '/imports' : '/settings/integrations')}>{k === 'sap' && !sync.at ? 'Import an SAP export' : 'Open integrations'}</Button>
      </PopoverContent>
    </Popover>
  )
}

export function NotificationsMenu({ big }: { big?: boolean }) {
  const { entity } = useSession()
  const list = useNotifications().data ?? []
  const unread = list.filter(n => !n.read).length
  const nav = useNavigate()
  const { act } = useAct()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Notifications, ${unread} unread`} className={cn('relative grid flex-none cursor-pointer place-items-center rounded-md text-text-2 hover:bg-surface-2 hover:text-text', big ? 'size-11' : 'size-8')}>
          <Bell className="size-4" />
          {unread > 0 && <span className="absolute top-[3px] right-0.5 min-w-4 rounded-lg border-2 border-surface bg-bad px-1 text-[10px] leading-[14px] font-semibold text-white">{unread}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px]">
        <div className="flex items-center justify-between px-2 py-1.5"><span className="text-xs font-semibold">Notifications</span>{unread > 0 && <button type="button" className="cursor-pointer text-[11px] text-acc hover:underline" onClick={() => act(() => api.markNotificationsRead(entity.id))}>Mark all read</button>}</div>
        <DropdownMenuSeparator />
        {list.length === 0 && <div className="px-2 py-4 text-center text-xs text-text-3">Nothing new.</div>}
        {list.slice(0, 8).map(n => {
          const I = toneIcon[n.tone]
          return (
            <DropdownMenuItem key={n.id} className="items-start gap-2" onSelect={() => { act(() => api.markNotificationsRead(entity.id, n.id)); nav(n.route) }}>
              <I className={cn('mt-0.5', toneText[n.tone])} />
              <span className="flex min-w-0 flex-col"><span className={cn('text-xs', !n.read && 'font-semibold')}>{n.title}</span><span className="text-[11px] text-text-2">{n.body}</span><span className="text-[10.5px] text-text-3">{ago(n.at)}</span></span>
              {!n.read && <span className="mt-1 ml-auto size-2 flex-none rounded-full bg-acc" aria-label="unread" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function UserMenu() {
  const { user, role, approvalLimit, entity, signOut } = useSession()
  const { theme, toggle } = useTheme()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" aria-label="User menu" className="gap-1.5 px-1 py-0.5"><Avatar id={user.id} /><ChevronDown className="text-text-3" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex flex-col"><span>{user.name}</span><span className="text-[11px] font-normal text-text-3">{user.email}</span>
          <span className="text-[11px] font-normal text-text-3">{role ? `${role} on ${entity.shortName}` : user.isAdmin ? 'Firm admin' : 'No client assigned'}{approvalLimit > 0 && approvalLimit < 1e11 ? ` · approves up to ₹${approvalLimit.toLocaleString('en-IN')}` : ''}</span></DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={toggle}>{theme === 'dark' ? <Sun /> : <Moon />}{theme === 'dark' ? 'Light theme' : 'Dark theme'}</DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/settings/account"><KeyRound />Password and security</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut()}><LogOut />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Topbar() {
  const [open, setOpen] = useSearchShortcut()
  return (
    <header className="sticky top-0 z-20 hidden min-h-[60px] flex-wrap items-center xl:flex-nowrap gap-x-3 gap-y-2.5 border-b border-border bg-surface px-6 py-2.5 md:flex">
      <EntitySwitcher />
      <PeriodPicker />
      <button type="button" onClick={() => setOpen(true)} className="flex h-9 max-w-[460px] min-w-[140px] xl:min-w-0 flex-[1_1_200px] cursor-text items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-left text-text-3">
        <Search className="size-4" /><span className="flex-1 truncate">Invoice no., GSTIN, PO, GRN, UTR, IRN</span>
        <span className="rounded-sm border border-border-2 bg-surface px-[5px] text-[11px] leading-4 whitespace-nowrap">Ctrl K</span>
      </button>
      <SearchPalette open={open} onOpenChange={setOpen} />
      <div className="ml-auto flex items-center gap-1.5">
        <FeedChip k="sap" /><FeedChip k="email" /><FeedChip k="gst" /><FeedChip k="bank" />
      </div>
      <NotificationsMenu />
      <UserMenu />
    </header>
  )
}

export function useCriticalCount() { return useCounts().data?.critical ?? 0 }
