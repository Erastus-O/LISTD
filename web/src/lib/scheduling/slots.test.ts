import { describe, it, expect } from 'vitest'
import {
  formatSlot,
  isTimeframe,
  sanitiseSlots,
  slotsForTimeframe,
  timeframeWindow,
} from './slots'

describe('inspection slots', () => {
  it('generates 30-min slots within each timeframe', () => {
    expect(slotsForTimeframe('morning')).toEqual([
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    ])
    expect(slotsForTimeframe('afternoon')).toHaveLength(10) // 12:00–17:00
    expect(slotsForTimeframe('evening')).toEqual([
      '17:00', '17:30', '18:00', '18:30', '19:00', '19:30',
    ])
  })

  it('returns no slots for unknown / flexible timeframes', () => {
    expect(slotsForTimeframe('flexible')).toEqual([])
    expect(slotsForTimeframe(null)).toEqual([])
    expect(isTimeframe('morning')).toBe(true)
    expect(isTimeframe('flexible')).toBe(false)
  })

  it('formats a slot start as a 30-min window', () => {
    expect(formatSlot('09:00')).toBe('9:00 – 9:30')
    expect(formatSlot('12:30')).toBe('12:30 – 13:00')
    expect(timeframeWindow('morning')).toBe('9:00 – 12:00')
  })

  it('sanitises tenant slot input: only in-range, deduped, sorted', () => {
    expect(
      sanitiseSlots('morning', ['10:00', '09:00', '10:00', '13:00', 'bogus'])
    ).toEqual(['09:00', '10:00']) // 13:00 is afternoon, dropped; dupes removed
    expect(sanitiseSlots('flexible', ['09:00'])).toEqual([])
  })
})
