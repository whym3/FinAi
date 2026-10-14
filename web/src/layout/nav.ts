import { ArrowDownLeft, CalendarCheck, Database, ChartColumn, FileCheck, History, Inbox, Landmark, LayoutGrid, Percent, Receipt, ShieldCheck, SlidersHorizontal, TriangleAlert, Truck, Users, Wallet, Workflow, type LucideIcon } from 'lucide-react'

export type CountKey = 'imports' | 'intake' | 'p2p' | 'review' | 'exceptions' | 'payables' | 'receivables' | 'bank' | 'gst' | 'tds' | 'msme' | 'close' | 'vendors'
export interface NavItem { to: string; label: string; icon: LucideIcon; count?: CountKey; tone?: 'acc' | 'warn' | 'bad' }

export const OVERVIEW: NavItem = { to: '/', label: 'Overview', icon: LayoutGrid }
export const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: SlidersHorizontal }

export const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Work', items: [
    { to: '/intake', label: 'Intake inbox', icon: Inbox, count: 'intake', tone: 'acc' },
    { to: '/imports', label: 'Imports', icon: Database, count: 'imports', tone: 'warn' },
    { to: '/p2p', label: 'Purchase-to-pay', icon: Workflow, count: 'p2p', tone: 'warn' },
    { to: '/review', label: 'Invoice review', icon: FileCheck, count: 'review' },
    { to: '/exceptions', label: 'Exceptions', icon: TriangleAlert, count: 'exceptions', tone: 'bad' },
  ] },
  { title: 'Money', items: [
    { to: '/payables', label: 'Payables & payment runs', icon: Wallet, count: 'payables' },
    { to: '/receivables', label: 'Receivables', icon: ArrowDownLeft, count: 'receivables' },
    { to: '/bank', label: 'Bank', icon: Landmark, count: 'bank' },
  ] },
  { title: 'Compliance', items: [
    { to: '/gst', label: 'GST hub', icon: Receipt, count: 'gst' },
    { to: '/tds', label: 'TDS hub', icon: Percent, count: 'tds' },
    { to: '/msme', label: 'MSME tracker', icon: ShieldCheck, count: 'msme', tone: 'warn' },
  ] },
  { title: 'Close & reports', items: [
    { to: '/close', label: 'Month-end close', icon: CalendarCheck, count: 'close' },
    { to: '/reports', label: 'Reports', icon: ChartColumn },
    { to: '/audit', label: 'Audit log', icon: History },
  ] },
  { title: 'Masters', items: [
    { to: '/vendors', label: 'Vendors', icon: Truck, count: 'vendors', tone: 'bad' },
    { to: '/customers', label: 'Customers', icon: Users },
  ] },
]
