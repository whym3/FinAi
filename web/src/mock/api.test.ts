import { beforeEach, describe, expect, it } from 'vitest'
import * as api from './api'
import { db, resetDb } from './db'

beforeEach(() => resetDb())

describe('invoice decision workflow', () => {
  it('a debit note resolves the money flags, parks the HSN flag with the vendor and advances the PO', async () => {
    const inv = await api.submitDecision('inv-0418', 'dn', ['RT-01', 'FR-02'], 'v1 rates', 'RK')
    expect(inv.status).toBe('dn-raised')
    expect(inv.decision?.debitNote).toMatchObject({ no: 'DN/2026-27/0091', total: 4720 })
    const ex = (id: string) => db.exceptions.find(e => e.id === id)!
    expect(ex('EX-1042').status).toBe('resolved')
    expect(ex('EX-1043').status).toBe('resolved')
    expect(ex('EX-1044').status).toBe('waiting-vendor')
    const po = db.purchaseOrders.find(p => p.id === '4500012345')!
    expect(po.stages.find(s => s.key === 'review')!.state).toBe('done')
    expect(po.stages.find(s => s.key === 'posting')!.state).toBe('cur')
    expect(db.audit[0].action).toBe('Invoice decision: dn')
  })

  it('requires a note for hold and blocks the read-only auditor', async () => {
    await expect(api.submitDecision('inv-0418', 'hold', ['RT-01'], '', 'RK')).rejects.toThrow(/note is required/)
    await expect(api.submitDecision('inv-0418', 'approve', ['OK-00'], '', 'NR')).rejects.toThrow(/read-only/)
  })

  it('routes invoices above the decider limit to a second approver', async () => {
    const inv = await api.submitDecision('inv-bf1352', 'approve', ['OK-00'], '', 'RK')
    expect(inv.decision?.secondApproverNeeded).toBe(true)
    expect((await api.listApprovals('meridian', 'FS')).invoices.map(i => i.id)).toContain('inv-bf1352')
    await expect(api.confirmSecondApproval('inv-bf1352', 'RK')).rejects.toThrow(/different person/)
    expect((await api.confirmSecondApproval('inv-bf1352', 'FS')).decision?.secondApproverNeeded).toBe(false)
  })
})

describe('payment run approval', () => {
  it('releases the run once the CFO approves after the Controller', async () => {
    await expect(api.approveRun('PR-2026-10-16', '', 'RK')).rejects.toThrow(/not an approver/)
    const run = await api.approveRun('PR-2026-10-16', '', 'AN')
    expect(run.status).toBe('released')
    expect(run.h2hFile).toBe('H2H-2026-10-16-0042')
  })
})

describe('IMS', () => {
  it('stages actions locally and saves them to the portal', async () => {
    const { applied } = await api.applyRecommendations('meridian', '27AAACM0000M1Z2', 'PN')
    expect(applied).toBeGreaterThan(0)
    const { saved } = await api.saveImsToPortal('meridian', '27AAACM0000M1Z2', 'PN')
    expect(saved).toBe(applied)
    expect(db.imsRows.find(r => r.id === 'ims1')!.portal).toBe('Accepted')
    expect(db.exceptions.find(e => e.id === 'EX-1035')!.status).toBe('resolved')
  })
})

describe('intake', () => {
  it('linking a new invoice to a PO creates it in the review queue', async () => {
    await api.linkToPo('in-rrp561', '4500012398', 'RK')
    const inv = db.invoices.find(i => i.intakeId === 'in-rrp561')!
    expect(inv.status).toBe('needs-decision')
    expect(inv.flags).toHaveLength(0)
  })
})
