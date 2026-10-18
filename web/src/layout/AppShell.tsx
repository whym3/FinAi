import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { useSession } from '@/app/session'
import { Sidebar } from './Sidebar'
import { SearchPalette, Topbar, useSearchShortcut } from './Topbar'
import { MobileTabs, MobileTopBar } from './Mobile'

export function AppShell() {
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('pv-side') === 'rail' } catch { return false } })
  const { pathname } = useLocation()
  const { scope, setScope } = useSession()
  const [search, setSearch] = useSearchShortcut()
  useEffect(() => { try { localStorage.setItem('pv-side', collapsed ? 'rail' : 'full') } catch { /* not remembered */ } }, [collapsed])
  // The firm (all-clients) scope only exists on Overview.
  useEffect(() => { if (pathname !== '/' && scope === 'firm') setScope('entity') }, [pathname, scope, setScope])
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return (
    <div className="flex min-h-svh bg-bg">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onSearch={() => setSearch(true)} />
        <MobileTopBar onSearch={() => setSearch(true)} />
        <SearchPalette open={search} onOpenChange={setSearch} />
        <main className="flex flex-col gap-4 px-4 pt-3.5 pb-28 md:px-6 md:pt-5 md:pb-10">
          <Outlet />
        </main>
      </div>
      <MobileTabs />
    </div>
  )
}
