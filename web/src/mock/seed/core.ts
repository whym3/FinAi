import type { Customer, Entity, Firm, SyncState, User, Vendor } from '@/lib/types'

export const firm: Firm = { name: 'Mehta & Rao Chartered Accountants', short: 'Mehta & Rao', entityIds: ['meridian', 'northstar', 'kaveri'] }

export const entities: Entity[] = [
  {
    id: 'meridian', name: 'Meridian Auto Components Pvt Ltd', shortName: 'Meridian Auto Components', city: 'Pune', pan: 'AAACM0000M',
    gstins: [{ gstin: '27AAACM0000M1Z2', code: '27', state: 'Maharashtra' }, { gstin: '24AAACM0000M1Z6', code: '24', state: 'Gujarat' }],
    sapCompanyCode: '1000', risk: 'Medium', riskScore: 41,
    intakeEmail: 'invoices+meridian@intake.pravah.example', whatsapp: '+91 20 0000 4100',
  },
  {
    id: 'northstar', name: 'Northstar Pharma Ltd', shortName: 'Northstar Pharma', city: 'Hyderabad', pan: 'AAACN0000N',
    gstins: [{ gstin: '36AAACN0000N1Z8', code: '36', state: 'Telangana' }],
    sapCompanyCode: '2000', risk: 'High', riskScore: 82,
    intakeEmail: 'invoices+northstar@intake.pravah.example', whatsapp: '+91 40 0000 3600',
  },
  {
    id: 'kaveri', name: 'Kaveri Foods LLP', shortName: 'Kaveri Foods', city: 'Bengaluru', pan: 'AAKFK0000K',
    gstins: [{ gstin: '29AAKFK0000K1Z4', code: '29', state: 'Karnataka' }],
    sapCompanyCode: '3000', risk: 'Medium', riskScore: 58,
    intakeEmail: 'invoices+kaveri@intake.pravah.example', whatsapp: '+91 80 0000 2900',
  },
]

const ALL = 'all' as const
export const users: User[] = [
  { id: 'RK', initials: 'RK', name: 'Rohan Kulkarni', role: 'ap', title: 'AP executive', approvalLimit: 500000, color: 'a2', entityIds: ['meridian'] },
  { id: 'FS', initials: 'FS', name: 'Farah Siddiqui', role: 'controller', title: 'Controller', approvalLimit: 5000000, color: 'a4', entityIds: ['meridian'] },
  { id: 'AN', initials: 'AN', name: 'Arvind Nair', role: 'cfo', title: 'CFO', approvalLimit: 1e12, color: 'a1', entityIds: ['meridian'] },
  { id: 'PN', initials: 'PN', name: 'Priya Nair', role: 'gst', title: 'GST analyst', approvalLimit: 0, color: 'a3', entityIds: ['meridian'] },
  { id: 'SU', initials: 'SU', name: 'Suresh Patil', role: 'stores', title: 'Stores', approvalLimit: 0, color: 'a5', entityIds: ['meridian'] },
  { id: 'VJ', initials: 'VJ', name: 'Vikram Joshi', role: 'procurement', title: 'Procurement', approvalLimit: 0, color: 'a1', entityIds: ['meridian'] },
  { id: 'MD', initials: 'MD', name: 'Meera Deshpande', role: 'purchase-head', title: 'Purchase Head', approvalLimit: 0, color: 'a4', entityIds: ['meridian'] },
  { id: 'KM', initials: 'KM', name: 'Kiran Mehta', role: 'partner', title: 'Partner, Mehta & Rao', approvalLimit: 0, color: 'a2', entityIds: ALL },
  { id: 'NR', initials: 'NR', name: 'Neha Rao', role: 'auditor', title: 'Statutory auditor (read-only)', approvalLimit: 0, color: 'a3', entityIds: ALL },
  { id: 'PV', initials: 'PV', name: 'Pravah', role: 'ap', title: 'Automatic rule', approvalLimit: 0, color: '', entityIds: ALL },
]

const v = (o: Partial<Vendor> & Pick<Vendor, 'id' | 'name' | 'gstin'>): Vendor => ({
  entityId: 'meridian', shortName: o.name.replace(/ (Pvt Ltd|Ltd|Products|Traders|Enterprises)$/, ''), pan: o.gstin.slice(2, 12),
  gstinStatus: 'Active', tags: [], email: 'accounts@example.com', phone: '+91 20 0000 0000', paymentTermsDays: 30,
  filing: { onTime: 12, of: 12 }, outstanding: 0, overdue: 0, status: { tone: 'ok', label: 'On schedule' }, ytdPurchases: 0,
  bank: { bank: 'HDFC Bank', ifsc: 'HDFC0000001', account: '50200000000001', nameAtBank: o.name.toUpperCase() },
  ...o,
})

export const vendors: Vendor[] = [
  v({ id: '100102', name: 'Deccan Steel Traders', gstin: '27AAAFX0001X1Z3', outstanding: 3842600, overdue: 412000, nextDue: '2026-10-16', status: { tone: 'bad', label: 'Overdue 12 days' }, tdsSection: '393(1) · purchase of goods', ytdPurchases: 18240000, email: 'billing@deccansteel.example', phone: '+91 20 0000 1102', filing: { onTime: 10, of: 12 }, bank: { bank: 'State Bank of India', branch: 'Pimpri', ifsc: 'SBIN0001122', account: '30000000001187', nameAtBank: 'DECCAN STEEL TRADERS' } }),
  v({ id: '100448', name: 'Konkan Chemicals Pvt Ltd', gstin: '27AAACX0004X1Z7', outstanding: 2418950, overdue: 0, nextDue: '2026-10-18', status: { tone: 'bad', label: 'Held · bank change' }, blocked: true, ytdPurchases: 9640000, email: 'billing@konkanchem.example', phone: '+91 22 0000 0418', filing: { onTime: 11, of: 12 }, bank: { bank: 'HDFC Bank', branch: 'Thane', ifsc: 'HDFC0000456', account: '50200000007120', nameAtBank: 'KONKAN CHEMICALS PVT LTD' } }),
  v({ id: '100231', name: 'Sahyadri Packaging Pvt Ltd', gstin: '27AAACX0000X1Z5', msme: 'Micro', udyam: 'UDYAM-MH-26-0000000', udyamVerifiedOn: '2026-04-02', outstanding: 986320, overdue: 0, nextDue: '2026-10-15', status: { tone: 'warn', label: 'MSME limit in 2 days' }, ytdPurchases: 6172904, email: 'accounts@sahyadripack.example', phone: '+91 98220 00210', bank: { bank: 'HDFC Bank', branch: 'Bhosari', ifsc: 'HDFC0001234', account: '50200000004417', nameAtBank: 'SAHYADRI PACKAGING PVT LTD' }, tdsSection: '393(1) · purchase of goods' }),
  v({ id: '100315', name: 'Bharat Forgings Pvt Ltd', gstin: '27AAACX0006X1Z3', outstanding: 912400, overdue: 210000, nextDue: '2026-10-16', status: { tone: 'bad', label: 'Overdue 21 days' }, ytdPurchases: 7410000, email: 'ar@bharatforgings.example' }),
  v({ id: '100377', name: 'Patel Electricals', gstin: '27AAAFX0003X1Z9', msme: 'Small', udyam: 'UDYAM-MH-26-0000377', udyamVerifiedOn: '2026-05-11', outstanding: 764180, overdue: 118000, nextDue: '2026-10-16', status: { tone: 'bad', label: 'Overdue 9 days' }, ytdPurchases: 3260000, email: 'accounts@patelelectricals.example', filing: { onTime: 9, of: 12 } }),
  v({ id: '100509', name: 'Vyas Roadlines', gstin: '27AAAFX0002X1Z1', tags: ['GTA', 'RCM'], outstanding: 648250, overdue: 0, nextDue: '2026-10-22', ytdPurchases: 1485000, tdsSection: '393(1) · contractor, 1%', email: 'billing@vyasroadlines.example' }),
  v({ id: '100288', name: 'Shakti Castings', gstin: '27AAAFX0009X1Z7', msme: 'Micro', udyam: 'UDYAM-MH-26-0000288', udyamVerifiedOn: '2026-03-18', outstanding: 592100, overdue: 0, nextDue: '2026-10-19', status: { tone: 'warn', label: 'MSME limit in 6 days' }, ytdPurchases: 2140000 }),
  v({ id: '100166', name: 'Pune Precision Tools', gstin: '27AAACX0010X1Z2', outstanding: 488900, overdue: 64000, nextDue: '2026-10-16', status: { tone: 'bad', label: 'Overdue 4 days' }, ytdPurchases: 1980000 }),
  v({ id: '100421', name: 'Ratnagiri Rubber Products', gstin: '27AAAFX0007X1Z1', outstanding: 410320, overdue: 0, nextDue: '2026-10-28', ytdPurchases: 1720000 }),
  v({ id: '100533', name: 'Om Sai Engineering', gstin: '27AAAFX0008X1Z9', msme: 'Micro', udyam: 'UDYAM-MH-26-0000533', udyamVerifiedOn: '2026-06-01', outstanding: 374800, overdue: 0, nextDue: '2026-11-02', ytdPurchases: 1460000 }),
  v({ id: '200110', entityId: 'northstar', name: 'Deccan Bulk Actives Pvt Ltd', gstin: '36AAACX0011X1Z4', outstanding: 2860000, overdue: 1840000, nextDue: '2026-10-15', status: { tone: 'bad', label: 'Overdue 34 days' }, ytdPurchases: 32400000 }),
  v({ id: '200134', entityId: 'northstar', name: 'Golconda Glass Vials', gstin: '36AAAFX0012X1Z2', msme: 'Small', udyam: 'UDYAM-TS-26-0000134', udyamVerifiedOn: '2026-02-10', outstanding: 940000, overdue: 620000, nextDue: '2026-10-14', status: { tone: 'bad', label: 'MSME breached' }, ytdPurchases: 6100000 }),
  v({ id: '200151', entityId: 'northstar', name: 'Charminar Logistics', gstin: '36AAAFX0013X1Z0', tags: ['GTA', 'RCM'], outstanding: 312000, overdue: 0, nextDue: '2026-10-25', ytdPurchases: 2200000 }),
  v({ id: '300210', entityId: 'kaveri', name: 'Mysore Agro Mills', gstin: '29AAACX0014X1Z8', msme: 'Micro', udyam: 'UDYAM-KA-26-0000210', udyamVerifiedOn: '2026-01-22', outstanding: 1220000, overdue: 480000, nextDue: '2026-10-17', status: { tone: 'bad', label: 'MSME breached' }, ytdPurchases: 8800000 }),
  v({ id: '300227', entityId: 'kaveri', name: 'Coorg Spice Traders', gstin: '29AAAFX0015X1Z6', outstanding: 640000, overdue: 0, nextDue: '2026-10-29', ytdPurchases: 4100000 }),
]

const c = (id: string, name: string, outstanding: number, overdue: number, daysOverdue: number, tone: Customer['followUp']['tone'], label: string, gstin: string, entityId = 'meridian'): Customer => ({
  id, entityId, name, outstanding, overdue, daysOverdue, followUp: { tone, label }, gstin, creditDays: 45, contact: 'accounts@' + name.split(' ')[0].toLowerCase() + '.example',
})

export const customers: Customer[] = [
  c('C1001', 'Shivneri Motors Ltd', 6420000, 1190500, 48, 'warn', 'Promise 20-10-2026', '27AAACS0101S1Z1'),
  c('C1002', 'Vardhan Tractors Pvt Ltd', 4180250, 862400, 37, 'warn', 'Reminder 2 sent', '27AAACV0102V1Z9'),
  c('C1003', 'Indrayani Auto Assemblies', 2844600, 510000, 64, 'bad', 'Disputed · short supply', '27AAAFI0103I1Z7'),
  c('C1004', 'Sahyog Two Wheelers Pvt Ltd', 2210900, 425780, 22, 'warn', 'Reminder 1 sent', '24AAACS0104S1Z5'),
  c('C1005', 'Godavari Agro Equipment', 1862300, 318200, 91, 'bad', 'Escalated to CFO', '27AAAFG0105G1Z3'),
  c('C1006', 'Narmada Coach Builders', 1490000, 240000, 31, 'warn', 'Promise 25-10-2026', '24AAACN0106N1Z1'),
  c('C1007', 'Malwa Gears Ltd', 1230450, 196320, 18, 'none', 'No contact yet', '23AAACM0107M1Z9'),
  c('C1008', 'Trident EV Systems', 984000, 162000, 115, 'bad', 'Legal notice drafted', '29AAACT0108T1Z7'),
  c('C1009', 'Ajanta Fleet Services', 712600, 105000, 12, 'none', 'No contact yet', '27AAAFA0109A1Z5'),
  c('C1010', 'Bhima Motor Works', 540000, 80000, 9, 'ok', 'Paid · UTR awaited', '27AAAFB0110B1Z3'),
  c('C2001', 'Apollo Retail Pharmacy', 8400000, 2100000, 52, 'bad', 'Escalated to CFO', '36AAACA0201A1Z2', 'northstar'),
  c('C2002', 'MedPlus Distributors', 3900000, 640000, 28, 'warn', 'Reminder 1 sent', '36AAACM0202M1Z0', 'northstar'),
  c('C3001', 'FreshMart Hypermarkets', 2700000, 420000, 19, 'warn', 'Promise 22-10-2026', '29AAACF0301F1Z6', 'kaveri'),
]

// shortcut: one set of sync clocks for all entities; make it per entity when the backend reports per-system syncs.
export const sync: SyncState[] = [
  { key: 'sap', label: 'SAP', system: 'SAP S/4HANA', at: '2026-10-13T15:10', staleAfterH: 2 },
  { key: 'gst', label: 'GST', system: 'GST portal', at: '2026-10-13T13:05', staleAfterH: 12 },
  { key: 'bank', label: 'Bank', system: 'Bank feed', at: '2026-10-12T13:20', staleAfterH: 12 },
]
