import { useCallback, useState, type ComponentType } from 'react'
import { createBrowserRouter, Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router'
import { AppShell } from '@/layout/AppShell'
import { Card, EmptyState, PageSkeleton } from '@/components/pravah'
import { SessionProvider } from '@/app/session'
import { ForgotPage, InvitePage, LoginPage, MfaEnrolPage, MfaPage, ResetPage, SetupPage } from '@/features/auth/pages'
import OverviewPage from '@/features/overview/OverviewPage'
import IntakePage from '@/features/intake/IntakePage'
import ImportsPage from '@/features/imports/ImportsPage'
import P2PListPage from '@/features/p2p/P2PListPage'
import P2PPage from '@/features/p2p/P2PPage'
import ReviewQueuePage from '@/features/review/ReviewQueuePage'
import InvoiceReviewPage from '@/features/review/InvoiceReviewPage'
import ExceptionsPage from '@/features/exceptions/ExceptionsPage'
import GstPage from '@/features/gst/GstPage'
import PayablesPage from '@/features/payables/PayablesPage'
import RunPage from '@/features/payables/RunPage'
import ApprovalsPage from '@/features/approvals/ApprovalsPage'
import ReceivablesPage from '@/features/receivables/ReceivablesPage'
import BankPage from '@/features/bank/BankPage'
import TdsPage from '@/features/tds/TdsPage'
import MsmePage from '@/features/msme/MsmePage'
import ClosePage from '@/features/close/ClosePage'
import ReportsPage from '@/features/reports/ReportsPage'
import AuditPage from '@/features/audit/AuditPage'
import VendorsPage from '@/features/vendors/VendorsPage'
import VendorPage from '@/features/vendors/VendorPage'
import CustomersPage from '@/features/customers/CustomersPage'
import SettingsPage from '@/features/settings/SettingsPage'
import OnboardClientPage from '@/features/settings/clients/OnboardClientPage'
import ClientPage from '@/features/settings/clients/ClientPage'

function NotFound() {
  return <Card><EmptyState title="Page not found" action={<Link to="/">Back to overview</Link>}>This address does not match any screen.</EmptyState></Card>
}

/** Everything inside needs a signed-in, MFA-verified session. */
function Protected() {
  const nav = useNavigate()
  const loc = useLocation()
  const [key, setKey] = useState(0)
  const onUnauthenticated = useCallback((why: string) => {
    const to = why === 'mfa_required' ? '/mfa' : why === 'mfa_enrol' ? '/mfa/enrol' : '/login'
    nav(to + (to === '/login' && loc.pathname !== '/' ? `?from=${encodeURIComponent(loc.pathname + loc.search)}` : ''), { replace: true })
    setKey(k => k + 1)
  }, [nav, loc.pathname, loc.search])
  return (
    <SessionProvider key={key} fallback={<div className="p-6"><PageSkeleton /></div>} onUnauthenticated={onUnauthenticated}>
      <Outlet />
    </SessionProvider>
  )
}

export const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/mfa', element: <MfaPage /> },
  { path: '/mfa/enrol', element: <MfaEnrolPage /> },
  { path: '/forgot', element: <ForgotPage /> },
  { path: '/reset/:token', element: <ResetPage /> },
  { path: '/invite/:token', element: <InvitePage /> },
  {
    element: <Protected />,
    children: [{
      element: <AppShell />,
      children: [
        { path: '/', element: <OverviewPage /> },
        { path: '/intake', element: <IntakePage /> },
        { path: '/imports', element: <ImportsPage /> },
        { path: '/p2p', element: <P2PListPage /> },
        { path: '/p2p/:poId', element: <P2PPage /> },
        { path: '/review', element: <ReviewQueuePage /> },
        { path: '/review/:invoiceId', element: <InvoiceReviewPage /> },
        { path: '/exceptions', element: <ExceptionsPage /> },
        { path: '/gst', element: <GstPage /> },
        { path: '/payables', element: <PayablesPage /> },
        { path: '/payables/runs/:runId', element: <RunPage /> },
        { path: '/approvals', element: <ApprovalsPage /> },
        { path: '/receivables', element: <ReceivablesPage /> },
        { path: '/bank', element: <BankPage /> },
        { path: '/tds', element: <TdsPage /> },
        { path: '/msme', element: <MsmePage /> },
        { path: '/close', element: <ClosePage /> },
        { path: '/reports', element: <ReportsPage /> },
        { path: '/audit', element: <AuditPage /> },
        { path: '/vendors', element: <VendorsPage /> },
        { path: '/vendors/:vendorId', element: <VendorPage /> },
        { path: '/customers', element: <CustomersPage /> },
        { path: '/settings', element: <SettingsPage /> },
        { path: '/settings/:section', element: <SettingsPage /> },
        { path: '/settings/clients/new', element: <OnboardClientPage /> },
        { path: '/settings/clients/:id', element: <ClientPage /> },
        { path: '/dev/components', element: import.meta.env.DEV ? <DevComponents /> : <Navigate to="/" /> },
        { path: '*', element: <NotFound /> },
      ],
    }],
  },
])

function DevComponents() {
  const [C, setC] = useState<ComponentType | null>(null)
  if (!C) { import('@/features/dev/ComponentsPage').then(m => setC(() => m.default)); return <PageSkeleton /> }
  return <C />
}
