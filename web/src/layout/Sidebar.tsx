import { NavLink } from 'react-router'
import { Menu } from 'lucide-react'
import { Count } from '@/components/pravah'
import { useSession } from '@/app/session'
import { useCounts } from '@/mock/hooks'
import { cn } from '@/lib/utils'
import { BrandMark } from './Brand'
import { NAV, OVERVIEW, SETTINGS, type NavItem } from './nav'

function Item({ it, rail, onNavigate }: { it: NavItem; rail: boolean; onNavigate?: () => void }) {
  const counts = useCounts().data
  const n = it.count ? counts?.[it.count] : undefined
  const I = it.icon
  return (
    <NavLink to={it.to} end={it.to === '/'} onClick={onNavigate} title={rail ? it.label + (n ? `, ${n}` : '') : undefined} aria-label={rail ? it.label + (n ? `, ${n}` : '') : undefined}
      className={({ isActive }) => cn('relative flex min-h-8 items-center gap-2.5 rounded-md text-[13px] leading-[18px] font-medium no-underline hover:no-underline',
        rail ? 'h-10 w-11 justify-center p-0' : 'px-2 py-1.5',
        isActive ? 'bg-acc-weak text-acc hover:text-acc' : 'text-text-2 hover:bg-surface-2 hover:text-text')}>
      <I className="size-4 shrink-0" aria-hidden />
      {!rail && <span className="min-w-0 flex-auto">{it.label}</span>}
      {!!n && <Count n={n} tone={it.tone} className={rail ? 'absolute top-px -right-0.5 min-w-4 px-1 text-[10px] leading-[14px]' : ''} />}
    </NavLink>
  )
}

export function SidebarNav({ rail = false, onNavigate }: { rail?: boolean; onNavigate?: () => void }) {
  return (
    <>
      <Item it={OVERVIEW} rail={rail} onNavigate={onNavigate} />
      {NAV.map(g => (
        <div key={g.title} className={cn('flex flex-col gap-0.5', rail && 'items-center')}>
          {rail ? <span aria-hidden className="my-2 block h-px w-7 bg-border" /> : <div className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-[.06em] text-text-3 uppercase">{g.title}</div>}
          {g.items.map(it => <Item key={it.to} it={it} rail={rail} onNavigate={onNavigate} />)}
        </div>
      ))}
    </>
  )
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { firm, entities } = useSession()
  return (
    <nav aria-label="Main" className={cn('sticky top-0 hidden h-svh flex-none flex-col gap-0.5 overflow-y-auto border-r border-border bg-surface transition-[width] duration-200 md:flex', collapsed ? 'w-16 items-center px-2 pt-3 pb-4' : 'w-60 px-2.5 pt-3 pb-4')}>
      {collapsed ? (
        <>
          <BrandMark className="mt-1.5 mb-2" />
          <button type="button" onClick={onToggle} aria-label="Expand sidebar" aria-expanded="false" title="Expand sidebar" className="mb-2 grid size-8 cursor-pointer place-items-center rounded-md text-text-2 hover:bg-surface-2"><Menu className="size-4" /></button>
        </>
      ) : (
        <div className="flex items-center gap-2.5 px-2 pt-1.5 pb-3.5">
          <BrandMark />
          <span className="flex min-w-0 flex-auto flex-col"><span className="text-sm leading-[18px] font-semibold">Pravah</span><span className="text-[11px] leading-[14px] text-text-3">Finance Control</span></span>
          <button type="button" onClick={onToggle} aria-label="Collapse sidebar" aria-expanded="true" title="Collapse sidebar" className="grid size-8 cursor-pointer place-items-center rounded-md text-text-2 hover:bg-surface-2"><Menu className="size-4" /></button>
        </div>
      )}
      <SidebarNav rail={collapsed} />
      <div className="min-h-4 flex-auto" />
      <Item it={SETTINGS} rail={collapsed} />
      {collapsed ? <span className="mt-2"><span title="Mehta & Rao Chartered Accountants" className="grid size-8 place-items-center rounded-full border border-[#BCD2F0] bg-[#DCE8F8] text-xs font-semibold text-[#173E73] dark:border-[#2C4D78] dark:bg-[#1B3352] dark:text-[#BCD6F7]">MR</span></span> : (
        <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-border p-2.5">
          <span title="Mehta & Rao Chartered Accountants" className="grid size-8 place-items-center rounded-full border border-[#BCD2F0] bg-[#DCE8F8] text-xs font-semibold text-[#173E73] dark:border-[#2C4D78] dark:bg-[#1B3352] dark:text-[#BCD6F7]">MR</span>
          <span className="flex min-w-0 flex-col"><span className="text-xs font-medium">{firm.short}</span><span className="text-[11px] text-text-3">Chartered Accountants · {entities.length} clients</span></span>
        </div>
      )}
    </nav>
  )
}
