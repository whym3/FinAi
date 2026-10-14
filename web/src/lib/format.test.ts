import { describe, expect, it } from 'vitest'
import { addDays, ago, date, dateLong, daysBetween, daysFromNow, inr, inrDelta, lakhCr, num2 } from './format'

describe('format', () => {
  it('uses Indian grouping with paise and a true minus', () => {
    expect(inr(12345678)).toBe('₹1,23,45,678.00')
    expect(inr(-12390)).toBe('−₹12,390.00')
    expect(inr(0)).toBe('₹0.00')
    expect(num2(3842600)).toBe('38,42,600.00')
    expect(inrDelta(4720)).toBe('+₹4,720.00')
  })
  it('scales KPIs to lakh and crore', () => {
    expect(lakhCr(18704310)).toEqual({ v: '₹1.87', u: 'Cr' })
    expect(lakhCr(4862900)).toEqual({ v: '₹48.6', u: 'L' })
    expect(lakhCr(73048)).toEqual({ v: '₹73,048', u: '' })
  })
  it('formats dates without timezone drift', () => {
    expect(date('2026-10-13')).toBe('13-10-2026')
    expect(date('2026-10-13T10:40')).toBe('13-10-2026')
    expect(dateLong('2026-10-13')).toBe('13 Oct 2026')
    expect(daysBetween('2026-10-08', '2026-11-22')).toBe(45)
    expect(addDays('2026-10-08', 45)).toBe('2026-11-22')
    expect(daysFromNow('2026-10-31', '2026-10-13')).toBe(18)
  })
  it('describes ages relative to a given moment', () => {
    const at = new Date('2026-10-13T15:20:00+05:30')
    expect(ago('2026-10-13T15:10', at)).toBe('10 min ago')
    expect(ago('2026-10-12T17:40', at)).toBe('22 h ago')
  })
})

import { rupeesInWords } from './format'
describe('rupeesInWords', () => {
  it('uses lakh and crore', () => {
    expect(rupeesInWords(105020)).toBe('Rupees One Lakh Five Thousand Twenty Only')
    expect(rupeesInWords(34218450)).toBe('Rupees Three Crore Forty Two Lakh Eighteen Thousand Four Hundred Fifty Only')
    expect(rupeesInWords(8010.5)).toBe('Rupees Eight Thousand Ten and Fifty Paise Only')
  })
})
