import { describe, expect, it } from 'vitest'
import { cleaningAreas, framesComplete, repairAreas } from './area-frames'

describe('photo frames', () => {
  it('cleaning gets a frame for every room', () => {
    expect(cleaningAreas({ bedrooms: 2, bathrooms: 1, kitchens: 1, livingRooms: 1 })).toEqual([
      'Entrance and hallway',
      'Kitchen',
      'Living room',
      'Bedroom 1',
      'Bedroom 2',
      'Bathroom',
    ])
    expect(cleaningAreas({ bedrooms: 0, bathrooms: 2, kitchens: 1, livingRooms: 0 })).toContain('Bathroom 2')
  })
  it('repairs photograph the area reported', () => {
    expect(repairAreas({ location: 'Kitchen sink' })[0]).toBe('Repair area: Kitchen sink')
    expect(repairAreas(null)[0]).toBe('Repair area')
  })
  it('every remaining frame needs a photo', () => {
    expect(framesComplete([])).toBe(false)
    expect(framesComplete([{ area: 'Kitchen', paths: ['a'] }, { area: 'Bath', paths: [] }])).toBe(false)
    expect(framesComplete([{ area: 'Kitchen', paths: ['a'] }])).toBe(true)
  })
})
