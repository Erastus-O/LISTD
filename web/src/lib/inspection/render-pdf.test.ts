import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  renderInspectionPdf,
  type InspectionItemInput,
  type InspectionPdfInputs,
  type InspectionRoomInput,
} from './render-pdf'

/**
 * The wizard seeds every room with its full template checklist and the
 * clerk writes against a handful. Those untouched rows used to print
 * anyway — a kitchen arrived as thirteen named items with an empty
 * condition column, which reads as an inspection that wasn't done.
 *
 * These are behavioural assertions on the rendered document (page count,
 * successful render) rather than on the filter in isolation, because the
 * bug that mattered wasn't "the predicate is wrong" — it was that the
 * schedule, the room tables and the follow-up cross-references each
 * decided independently what an item was.
 */

const TEMPLATE_ITEMS = [
  'Walls',
  'Ceiling',
  'Flooring',
  'Skirting boards',
  'Windows',
  'Window coverings',
  'Light fittings',
  'Sockets & switches',
  'Doors & handles',
  'Oven',
  'Hob',
  'Extractor fan / hood',
  'Fridge / freezer',
]

function emptyItem(name: string): InspectionItemInput {
  return { itemName: name, description: null, condition: null, photoUrls: [] }
}

function baseInputs(rooms: InspectionRoomInput[]): InspectionPdfInputs {
  return {
    reportLabel: 'Job test1234',
    inspectionTypeLabel: 'New Inventory',
    propertyAddress: '1 rue Joliot Curie, Bristol, BS2',
    clerkName: 'Kay Osei',
    clientName: 'Kwabena OSEI-TUTU',
    inspectionStartedAt: new Date('2026-06-07T16:08:00Z'),
    inspectionCompletedAt: new Date('2026-06-07T16:13:00Z'),
    generalNotes: null,
    meterReadings: [],
    smokeAlarmsChecked: false,
    carbonMonoxideChecked: false,
    rooms,
    clerkTypedName: 'Kay Osei',
    photoBytes: new Map(),
  }
}

const room = (
  name: string,
  items: InspectionItemInput[]
): InspectionRoomInput => ({
  name,
  roomType: 'kitchen',
  overallCondition: null,
  notes: null,
  items,
  photoUrls: [],
})

async function pageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPageCount()
}

describe('renderInspectionPdf — untouched template items', () => {
  it('drops items with no description, condition or photo', async () => {
    // The shape that produced the complaint: a whole property's worth of
    // seeded checklists, none of them written against.
    const areas = [
      'Hallway',
      'Living Room',
      'Kitchen',
      'Bedroom 1',
      'Bedroom 2',
      'Bathroom',
      'Garden',
    ]
    const untouched = await renderInspectionPdf(
      baseInputs(areas.map((a) => room(a, TEMPLATE_ITEMS.map(emptyItem))))
    )
    const written = await renderInspectionPdf(
      baseInputs(
        areas.map((a) =>
          room(
            a,
            TEMPLATE_ITEMS.map((n) => ({
              itemName: n,
              description: 'A described item with a sentence of detail.',
              condition: 'Good order, no visible damage noted anywhere.',
              photoUrls: [],
            }))
          )
        )
      )
    )
    // Same fixed chrome either side (cover, executive summary,
    // interpretations, disclaimer, schedule, declaration) — the difference
    // is 91 blank rows. If the filter regresses, these converge.
    const untouchedPages = await pageCount(untouched)
    const writtenPages = await pageCount(written)
    expect(untouchedPages).toBeLessThan(writtenPages)
    // Each untouched area collapses to a heading plus one line, so no
    // area should be spilling onto a second page.
    expect(untouchedPages).toBeLessThanOrEqual(areas.length + 6)
  })

  it('keeps an item recorded with photos but no prose', async () => {
    const bytes = await renderInspectionPdf(
      baseInputs([
        room('Kitchen', [
          emptyItem('Walls'),
          {
            itemName: 'Oven',
            description: null,
            condition: null,
            photoUrls: ['https://example.test/oven.jpg'],
          },
        ]),
      ])
    )
    expect(await pageCount(bytes)).toBeGreaterThan(0)
  })

  it('renders an area whose items were all untouched', async () => {
    // The area keeps its heading: silently dropping a room would hide
    // that it existed and wasn't inspected, which is what a deposit
    // dispute turns on.
    const bytes = await renderInspectionPdf(
      baseInputs([
        room('Kitchen', TEMPLATE_ITEMS.map(emptyItem)),
        room('Hallway', [
          {
            itemName: 'Flooring',
            description: 'Polished hardwood.',
            condition: 'Excellent, minimal wear.',
            photoUrls: [],
          },
        ]),
      ])
    )
    expect(await pageCount(bytes)).toBeGreaterThan(0)
  })

  it('keeps an action-only item and adds the investigation section', async () => {
    const blank = await renderInspectionPdf(
      baseInputs([room('Kitchen', [emptyItem('Oven')])])
    )
    const flagged = await renderInspectionPdf(
      baseInputs([
        room('Kitchen', [
          {
            ...emptyItem('Oven'),
            actionType: 'maintenance',
            actionComment: 'Door hinge needs checking.',
          },
        ]),
      ])
    )
    expect(await pageCount(flagged)).toBeGreaterThan(await pageCount(blank))
  })
})

describe('renderInspectionPdf — cover property photo', () => {
  /** Smallest valid PNG: 1×1 opaque pixel. */
  const PNG_1PX = Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
  )

  it('fits the photo on the cover without spilling to a new page', async () => {
    // The cover is a fixed absolute layout: letterhead, title, address,
    // then the details card, with the standing footnote pinned near the
    // bottom. Inserting the photo pushes the card down, so the thing to
    // guard is that the whole cover still fits on ONE page — page count
    // must match the same report rendered without a photo.
    const inputs = baseInputs([room('Kitchen', [emptyItem('Walls')])])
    const withPhoto = await renderInspectionPdf({
      ...inputs,
      propertyPhoto: { bytes: PNG_1PX, contentType: 'image/png' },
    })
    const without = await renderInspectionPdf(inputs)
    expect(await pageCount(withPhoto)).toBe(await pageCount(without))
  })

  it('renders unchanged when there is no property photo', async () => {
    const withNone = await renderInspectionPdf({
      ...baseInputs([room('Kitchen', [emptyItem('Walls')])]),
      propertyPhoto: null,
    })
    const withUndefined = await renderInspectionPdf(
      baseInputs([room('Kitchen', [emptyItem('Walls')])])
    )
    expect(await pageCount(withNone)).toBe(await pageCount(withUndefined))
  })

  it('renders the clerk mark on the declaration', async () => {
    const inputs = baseInputs([room('Kitchen', [emptyItem('Walls')])])
    const signed = await renderInspectionPdf({
      ...inputs,
      clerkSignature: { bytes: PNG_1PX, contentType: 'image/png' },
    })
    const unsigned = await renderInspectionPdf(inputs)
    // The declaration box is fixed-height and the mark is scaled to fit
    // inside it, so adopting a signature must not add a page.
    expect(await pageCount(signed)).toBe(await pageCount(unsigned))
  })

  it('falls back to the typed name when there is no clerk mark', async () => {
    // Reports submitted before adopt-a-signature, and the mobile app,
    // have no mark — the declaration must still render.
    const bytes = await renderInspectionPdf({
      ...baseInputs([room('Kitchen', [emptyItem('Walls')])]),
      clerkSignature: null,
    })
    expect(await pageCount(bytes)).toBeGreaterThan(0)
  })

  it('survives an unreadable property photo', async () => {
    // A corrupt upload must not fail the render — the clerk is standing
    // in the property when they submit.
    const bytes = await renderInspectionPdf({
      ...baseInputs([room('Kitchen', [emptyItem('Walls')])]),
      propertyPhoto: {
        bytes: Uint8Array.from([1, 2, 3, 4]),
        contentType: 'image/png',
      },
    })
    expect(await pageCount(bytes)).toBeGreaterThan(0)
  })
})
