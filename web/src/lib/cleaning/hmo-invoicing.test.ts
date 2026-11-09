import { describe, it, expect } from 'vitest'
import { computeHmoCleaningSplit } from './hmo-invoicing'

describe('computeHmoCleaningSplit', () => {
  it('splits evenly across bedrooms + communal', () => {
    const lines = computeHmoCleaningSplit(200, 4)
    expect(lines).toHaveLength(5) // 4 bedrooms + communal
    expect(lines.slice(0, 4).every((l) => l.amount === 40)).toBe(true)
    expect(lines[4]).toEqual({ label: 'Communal areas', amount: 40 })
  })

  it('parts always sum back to the total (remainder on communal)', () => {
    for (const [total, beds] of [
      [100, 2],
      [195, 4],
      [175, 3],
      [37, 5],
      [650, 9],
    ] as const) {
      const lines = computeHmoCleaningSplit(total, beds)
      const sum = lines.reduce((t, l) => t + l.amount, 0)
      expect(Math.round(sum * 100)).toBe(Math.round(total * 100))
      expect(lines).toHaveLength(beds + 1)
    }
  })

  it('puts the rounding remainder on the communal line', () => {
    // £100 / 3 parts = £33.33 each, communal gets the extra penny.
    const lines = computeHmoCleaningSplit(100, 2)
    expect(lines[0].amount).toBe(33.33)
    expect(lines[1].amount).toBe(33.33)
    expect(lines[2]).toEqual({ label: 'Communal areas', amount: 33.34 })
  })

  it('zero / negative total yields no lines', () => {
    expect(computeHmoCleaningSplit(0, 4)).toEqual([])
    expect(computeHmoCleaningSplit(-50, 4)).toEqual([])
  })

  it('no bedrooms → a single communal line for the whole total', () => {
    expect(computeHmoCleaningSplit(120, 0)).toEqual([
      { label: 'Communal areas', amount: 120 },
    ])
  })
})
