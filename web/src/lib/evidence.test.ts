import { describe, expect, it } from 'vitest'
import { boxStyle, verdictStatus, verificationStatus } from './evidence'

describe('boxStyle', () => {
  it('places a 0-1000 box as percentages', () => {
    expect(boxStyle({ page: 1, x0: 100, y0: 250, x1: 400, y1: 300 })).toEqual({ left: '10%', top: '25%', width: '30%', height: '5%' })
  })
  it('clamps and orders out-of-range corners', () => {
    expect(boxStyle({ page: 1, x0: 1200, y0: -5, x1: 900, y1: 20 })).toEqual({ left: '90%', top: '0%', width: '10%', height: '2%' })
  })
})

describe('verdictStatus', () => {
  it('reads each state', () => {
    expect(verdictStatus(null)).toEqual({ tone: 'none', label: 'Not checked yet' })
    expect(verdictStatus({ state: 'clean', issues: 0, items: [] }).tone).toBe('ok')
    expect(verdictStatus({ state: 'pending', issues: 0, items: [] }).label).toBe('Checking…')
    const warn = { tone: 'warn' as const, title: 'Check', detail: '', blocks: true, action: null }
    expect(verdictStatus({ state: 'issues', issues: 1, items: [warn] })).toEqual({ tone: 'warn', label: '1 issue' })
    expect(verdictStatus({ state: 'issues', issues: 2, items: [warn, { ...warn, tone: 'bad' }] })).toEqual({ tone: 'bad', label: '2 issues' })
  })
})

describe('verificationStatus', () => {
  it('shows a cancelled GSTIN as bad', () => {
    const row = { id: '1', kind: 'gstin' as const, ref: '07ACXPJ3115G1ZJ', status: 'ok' as const, message: null, checkedAt: null }
    expect(verificationStatus({ ...row, detail: { sts: 'Cancelled' } })).toEqual({ tone: 'bad', label: 'Cancelled' })
    expect(verificationStatus({ ...row, detail: { sts: 'Active' } })).toEqual({ tone: 'ok', label: 'Active' })
    expect(verificationStatus({ ...row, kind: 'ewb', status: 'skipped', detail: {} }).label).toBe('Not verified')
  })
})
