import { createBrowserRouter, Link } from 'react-router'
import { AppShell } from '@/layout/AppShell'
import { Card, EmptyState } from '@/components/pravah'
import OverviewPage from '@/features/overview/OverviewPage'
import IntakePage from '@/features/intake/IntakePage'
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
import ComponentsPage from '@/features/dev/ComponentsPage'

function NotFound() {
  return <Card><EmptyState title="Page not found" action={<Link to="/">Back to overview</Link>}>This address does not match any screen.</EmptyState></Card>
}

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/intake', element: <IntakePage /> },
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
      { path: '/dev/components', element: <ComponentsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
