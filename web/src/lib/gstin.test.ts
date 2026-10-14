import { describe, expect, it } from 'vitest'
import { checkGstin } from './gstin'

describe('checkGstin', () => {
  it('accepts real-format GSTINs with a valid check digit', () => {
    expect(checkGstin('27AAPFU0939F1ZV')).toMatchObject({ ok: true, warnings: [], state: 'Maharashtra' })
    expect(checkGstin('29aagcb7383j1z4', 'AAGCB7383J')).toMatchObject({ ok: true, warnings: [] })
  })
  it('warns on a bad check digit but still allows it', () => {
    const r = checkGstin('27AAPFU0939F1ZA')
    expect(r.ok).toBe(true)
    expect(r.warnings).toHaveLength(1)
  })
  it('rejects shape, state and PAN mismatches', () => {
    expect(checkGstin('27AAPFU0939F1Z').ok).toBe(false)
    expect(checkGstin('99AAPFU0939F1ZV').ok).toBe(false)
    expect(checkGstin('27AAPFU0939F1ZV', 'AAACM0000M').errors[0]).toMatch(/PAN/)
  })
})
