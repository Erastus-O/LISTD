import { describe, expect, it } from 'vitest'
import {
  arrivalTimeOptionsForSlot,
  formatUkTime,
  ukWallTimeToUtcIso,
} from './exact-time'

describe('ukWallTimeToUtcIso', () => {
  it('converts a BST (summer) wall time to UTC-1h', () => {
    expect(ukWallTimeToUtcIso('2026-07-15', '09:00')).toBe(
      '2026-07-15T08:00:00.000Z'
    )
  })

  it('converts a GMT (winter) wall time to the same UTC hour', () => {
    expect(ukWallTimeToUtcIso('2026-01-15', '09:00')).toBe(
      '2026-01-15T09:00:00.000Z'
    )
  })

  it('handles the spring-forward day (BST starts 2026-03-29 01:00)', () => {
    // 09:00 wall clock on switch day is BST → 08:00 UTC.
    expect(ukWallTimeToUtcIso('2026-03-29', '09:00')).toBe(
      '2026-03-29T08:00:00.000Z'
    )
    // Before the 01:00 switch it's still GMT.
    expect(ukWallTimeToUtcIso('2026-03-29', '00:30')).toBe(
      '2026-03-29T00:30:00.000Z'
    )
  })

  it('handles the fall-back day (GMT resumes 2026-10-25 02:00)', () => {
    expect(ukWallTimeToUtcIso('2026-10-25', '09:00')).toBe(
      '2026-10-25T09:00:00.000Z'
    )
    // 00:30 wall clock is still BST (switch is at 02:00 BST).
    expect(ukWallTimeToUtcIso('2026-10-25', '00:30')).toBe(
      '2026-10-24T23:30:00.000Z'
    )
  })

  it('rejects malformed inputs', () => {
    expect(ukWallTimeToUtcIso('2026-07-15', '9:00')).toBeNull()
    expect(ukWallTimeToUtcIso('2026-07-15', '24:00')).toBeNull()
    expect(ukWallTimeToUtcIso('15/07/2026', '09:00')).toBeNull()
    expect(ukWallTimeToUtcIso('2026-13-01', '09:00')).toBeNull()
  })

  it('round-trips through formatUkTime', () => {
    const iso = ukWallTimeToUtcIso('2026-07-15', '14:30')
    expect(iso).not.toBeNull()
    expect(formatUkTime(iso as string)).toBe('14:30')
  })
})

describe('arrivalTimeOptionsForSlot', () => {
  it('morning options span 9am to 11:30 (slots.ts canonical range)', () => {
    const opts = arrivalTimeOptionsForSlot('morning')
    expect(opts[0]).toBe('09:00')
    expect(opts[opts.length - 1]).toBe('11:30')
  })

  it('afternoon options span 12pm to 4:30pm', () => {
    const opts = arrivalTimeOptionsForSlot('afternoon')
    expect(opts[0]).toBe('12:00')
    expect(opts[opts.length - 1]).toBe('16:30')
  })

  it('evening options span 5pm to 7:30pm', () => {
    const opts = arrivalTimeOptionsForSlot('evening')
    expect(opts[0]).toBe('17:00')
    expect(opts[opts.length - 1]).toBe('19:30')
  })

  it('flexible/unknown slots span the working day', () => {
    for (const slot of ['flexible', null, undefined, 'weird']) {
      const opts = arrivalTimeOptionsForSlot(slot)
      expect(opts[0]).toBe('09:00')
      expect(opts[opts.length - 1]).toBe('16:30')
    }
  })
})
