import { useState } from 'react'
import { NavLink } from 'react-router'
import { Check, LayoutGrid, Menu, Search, TriangleAlert } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Count, Freshness } from '@/components/pravah'
import { useApprovals, useCounts } from '@/api/hooks'
import { cn } from '@/lib/utils'
import { BrandMark } from './Brand'
import { SidebarNav } from './Sidebar'
import { EntitySwitcher, NotificationsMenu, SearchPalette, UserMenu, useSearchShortcut } from './Topbar'
import { SETTINGS } from './nav'

export function MobileTopBar() {
  const [open, setOpen] = useSearchShortcut()
  return (
    <header className="sticky top-0 z-20 flex flex-col gap-2 border-b border-border bg-surface px-4 py-2 md:hidden">
      <div className="flex items-center gap-2">
        <BrandMark size={28} />
        <EntitySwitcher compact />
        <button type="button" aria-label="Search" onClick={() => setOpen(true)} className="grid size-11 flex-none cursor-pointer place-items-center rounded-md text-text-2 hover:bg-surface-2"><Search className="size-4" /></button>
        <NotificationsMenu big />
      </div>
      <SearchPalette open={open} onOpenChange={setOpen} />
    </header>
  )
}

export function MobileFreshness() {
  return <div className="flex flex-wrap gap-1.5 md:hidden"><Freshness k="sap" /><Freshness k="gst" /><Freshness k="bank" /></div>
}

const tab = ({ isActive }: { isActive: boolean }) => cn('relative flex min-h-11 flex-col items-center gap-0.5 py-1.5 text-[11px] font-medium no-underline hover:no-underline', isActive ? 'text-acc hover:text-acc' : 'text-text-3 hover:text-text')

export function MobileTabs() {
  const [more, setMore] = useState(false)
  const approvals = useApprovals().data
  const nApprovals = approvals ? approvals.runs.length + approvals.invoices.length + approvals.exceptions.length : 0
  const critical = useCounts().data?.critical ?? 0
  return (
    <>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-surface px-1 pt-1.5 pb-[max(18px,env(safe-area-inset-bottom))] md:hidden">
        <NavLink to="/" end className={tab}><LayoutGrid className="size-5" />Overview</NavLink>
        <NavLink to="/approvals" className={tab}><Check className="size-5" />Approvals{nApprovals > 0 && <Count n={nApprovals} tone="acc" className="absolute top-0.5 left-[56%]" />}</NavLink>
        <NavLink to="/exceptions" className={tab}><TriangleAlert className="size-5" />Exceptions{critical > 0 && <Count n={critical} tone="bad" className="absolute top-0.5 left-[56%]" />}</NavLink>
        <button type="button" onClick={() => setMore(true)} className={tab({ isActive: more })}><Menu className="size-5" />More</button>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="left" className="w-[300px] gap-0 overflow-y-auto p-3">
          <SheetTitle className="flex items-center gap-2.5 px-2 pt-1 pb-3"><BrandMark /><span className="flex flex-col"><span className="text-sm">Pravah</span><span className="text-[11px] font-normal text-text-3">Finance Control</span></span></SheetTitle>
          <div className="flex flex-col gap-0.5"><SidebarNav onNavigate={() => setMore(false)} /></div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <NavLink to={SETTINGS.to} onClick={() => setMore(false)} className="text-[13px] font-medium text-text-2">Settings</NavLink>
            <UserMenu />
          </div>
        </SheetContent>
      </Sheet>
      {/* keep count in sync for screen readers */}
      <span className="sr-only" aria-live="polite">{critical} critical exceptions</span>
    </>
  )
}
