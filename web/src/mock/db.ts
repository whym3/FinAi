import * as core from './seed/core'
import * as ex from './seed/exceptions'
import * as gst from './seed/gst'
import * as money from './seed/money'
import * as ov from './seed/overview'
import * as p2p from './seed/p2p'

function seed() {
  return structuredClone({
    firm: core.firm, entities: core.entities, users: core.users, vendors: core.vendors, customers: core.customers, sync: core.sync,
    overview: ov.overview, deadlines: ov.deadlines, firmRows: ov.firmRows, filing: ov.filing, filingHeads: ov.filingHeads,
    intake: p2p.intake, purchaseOrders: p2p.purchaseOrders, invoices: p2p.invoices,
    exceptions: ex.exceptions, rules: ex.rules,
    imsRows: gst.imsRows, gstSummaries: gst.gstSummaries, outward: gst.outward, rcmLrs: gst.rcmLrs,
    paymentRuns: money.paymentRuns, apItems: money.apItems, arItems: money.arItems, bankAccounts: money.bankAccounts, bankLines: money.bankLines,
    tdsLines: money.tdsLines, msmeInvoices: money.msmeInvoices, closeTasks: money.closeTasks, reports: money.reports,
    notifications: money.notifications, audit: money.audit,
    seq: { dn: 91, intake: 1, audit: 100, comment: 100, selfInvoice: 45 },
  })
}

// shortcut: in-memory store, reset on page reload; the backend replaces this module.
export let db = seed()
export type Db = typeof db
export function resetDb() { db = seed() }
