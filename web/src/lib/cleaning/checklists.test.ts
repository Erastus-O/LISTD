import { describe, it, expect } from 'vitest'
import { CLEAN_LEVELS } from '@/lib/pricing-matrix'
import { CLEANING_CHECKLISTS, getCleaningChecklist } from './checklists'

describe('cleaning checklists', () => {
  it('has a non-empty checklist for every clean level', () => {
    for (const level of CLEAN_LEVELS) {
      const cl = getCleaningChecklist(level)
      expect(cl.level).toBe(level)
      expect(cl.label).toBeTruthy()
      expect(cl.scope.length).toBeGreaterThan(10)
      expect(cl.tasks.length).toBeGreaterThan(0)
      expect(cl.tasks.every((t) => t.trim().length > 0)).toBe(true)
    }
  })

  it('deep clean is the most thorough (most tasks)', () => {
    expect(CLEANING_CHECKLISTS.deep.tasks.length).toBeGreaterThanOrEqual(
      CLEANING_CHECKLISTS.general.tasks.length
    )
    expect(CLEANING_CHECKLISTS.general.tasks.length).toBeGreaterThanOrEqual(
      CLEANING_CHECKLISTS.light.tasks.length
    )
  })
})
