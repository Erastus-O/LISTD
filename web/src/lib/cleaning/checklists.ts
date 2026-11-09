import {
  cleanLevelFromType,
  cleaningLabelFromType,
  customCleanFromType,
  isCleaningType,
  type CleanLevel,
  type CleaningPricing,
} from '@/lib/pricing-matrix'

/**
 * Cleaning checklists — the per-level task lists the cleaner works through on
 * site (owner's Light / General / Deep specifications). These are the
 * completion artifact for a cleaning job: the cleaner ticks each task and
 * attaches photos (Stage 5). Defined in code (like the inspection item
 * templates) so they version with the app and need no migration.
 *
 * `scope` is shown to the client at booking ("what's included") and to the
 * cleaner as the job's standard of work.
 */
export type CleaningChecklist = {
  level: CleanLevel
  label: string
  /** One-line description of the level's standard. */
  scope: string
  tasks: string[]
}

const LIGHT: CleaningChecklist = {
  level: 'light',
  label: 'Light Clean',
  scope:
    'A light clean to bring the property up to standard where most cleaning has already been done and the flat has been left in a reasonable state.',
  tasks: [
    'Wipe down / dust hard surfaces as necessary.',
    'Vacuum where necessary; sweep and mop hard flooring areas where necessary.',
    'Clean out interior waste bins where necessary.',
    'Check behind and under furniture : further vacuuming or wiping down of skirting boards and architraves where necessary.',
    'Vacuum soft furnishings, including under the cushions on sofas and chairs as necessary.',
    'Address any obviously dirty items even if not specifically requested, and note them on the invoice so costs can be charged back to tenants.',
    'Bleach / toilet cleaner left in each WC.',
  ],
}

const GENERAL: CleaningChecklist = {
  level: 'general',
  label: 'General Clean',
  scope:
    'A general clean throughout the property where some or very little cleaning has been done.',
  tasks: [
    'Wipe down all woodwork : skirting boards, doors, door frames, window frames, and architrave / dado rails as necessary.',
    'Clean the interior and exterior of the kitchen units including the kick boards.',
    'Clean the oven, hob, extractor fan and grill (unless a separate professional clean is required : inform DIGS to arrange).',
    'Clean and defrost the fridge and/or fridge freezer inside and out.',
    'Vacuum all carpets throughout.',
    'Vacuum all soft furnishings, including under the cushions on sofas and chairs.',
    'Sweep, wash down and dry (where applicable) all vinyl or wooden floors.',
    'Clean and vacuum inside any drawers, wardrobes and fitted cupboards.',
    'Clean the exterior of the kitchen units where necessary.',
    'Clean all sanitary ware, showers and baths, including inside the bathroom cabinets where applicable.',
    'Clean the interior of all windows throughout where applicable.',
    'Clean the exterior of any ground-floor windows where applicable.',
    'Disinfect shower heads.',
    'Clean extractor fan cover.',
  ],
}

const DEEP: CleaningChecklist = {
  level: 'deep',
  label: 'Deep Clean',
  scope: 'A full deep clean of all items / areas throughout the property.',
  tasks: [
    'Wash down and wipe clean all woodwork : skirting boards, doors, door frames, window frames, and architrave / dado rails as necessary.',
    'Clean the interior and exterior of all kitchen units including inside the drawers and kick boards.',
    'Clean the oven, extractor fan, hob and grill (unless a separate professional clean is required : inform DIGS to arrange).',
    'Clean and defrost the fridge and/or fridge freezer inside and out.',
    'Vacuum all carpets throughout.',
    'Pull out and move every item of furniture and vacuum and wipe down the woodwork.',
    'Vacuum all soft furnishings, including under the cushions on sofas and chairs.',
    'Sweep, wash down and dry all vinyl or wooden floors.',
    'Clean and vacuum inside all drawers, wardrobes and fitted cupboards.',
    'Wipe down and dry the exterior doors and surfaces of all kitchen units.',
    'Deep clean all sanitary ware, showers and baths, including inside bathroom cabinets. Use limescale remover where necessary; leave all WCs with toilet cleaner and bleach; descale, wash down and dry all shower screens.',
    'Clean the interior of all windows throughout.',
    'Clean the exterior of any ground-floor windows where applicable.',
    'Wash out dishwasher filters in the sink, then run a full hot cycle with the filters inside.',
    'Remove the detergent drawer from the washing machine, wash out and replace; wipe down the front of the machine.',
    'Remove shower, sink and wash-hand-basin traps where possible, remove any hair or debris, then replace / refit.',
    'Vacuum, clean, wipe down and dry the front covers of the extractor fans in both the kitchen and bathrooms.',
    'Disinfect shower heads.',
    'Clean extractor fan cover.',
  ],
}

export const CLEANING_CHECKLISTS: Record<CleanLevel, CleaningChecklist> = {
  light: LIGHT,
  general: GENERAL,
  deep: DEEP,
}

/** The checklist for a clean level. */
export function getCleaningChecklist(level: CleanLevel): CleaningChecklist {
  return CLEANING_CHECKLISTS[level]
}

/** A checklist shape for ANY cleaning job type — built-in level or an
 *  admin-defined offering (whose scope/tasks live in the rate card).
 *  Returns null for non-cleaning types or unknown customs. */
/** Clean types from the new rate card (lists from the client's design). */
const NAMED_CLEANS: Record<string, { label: string; scope: string; tasks: string[] }> = {
  clean_standard: {
    label: 'Standard Home Cleaning',
    scope: 'A stated checklist for a lived-in or tidy home.',
    tasks: ['Dust all reachable surfaces and sills', 'Clean kitchen worktops, hob exterior and sink', 'Clean bathrooms: WC, basin, bath or shower, taps', 'Vacuum and mop all floors', 'Empty and clean bins', 'Wipe light switches and door handles'],
  },
  clean_deep: {
    label: 'Deep Cleaning',
    scope: 'Everything in a standard clean, plus oven, fridge and freezer, inside cupboards, interior windows, skirting and behind furniture.',
    tasks: ['Move furniture and clean behind and under', 'Descale bathrooms, showers and taps', 'Oven fully degreased', 'Fridge and freezer cleaned inside', 'Inside kitchen cupboards and drawers', 'Skirting boards, doors and frames wiped', 'Interior windows and frames', 'Light fittings and switches cleaned', 'All floors deep cleaned'],
  },
  clean_eot: {
    label: 'End of Tenancy Cleaning',
    scope: 'To a check-out standard, after a condition and appliance assessment.',
    tasks: ['Kitchen units inside and out', 'Oven, hob and extractor degreased', 'Fridge and freezer cleaned and left open', 'Bathrooms descaled and sanitised', 'Interior windows, frames and sills', 'Skirting, doors and frames', 'All floors vacuumed and mopped', 'Bins emptied and cleaned', 'Remove marks from walls where possible'],
  },
  clean_office: {
    label: 'Office Cleaning',
    scope: 'Quoted from floor area, facilities, access and frequency.',
    tasks: ['Desks and work surfaces wiped', 'Kitchen and break areas cleaned', 'Washrooms cleaned and restocked', 'Floors vacuumed and mopped', 'Bins emptied', 'Touch points sanitised'],
  },
}

export function getCleaningChecklistForType(
  type: string,
  cleaning?: CleaningPricing
): Omit<CleaningChecklist, 'level'> & { level: CleanLevel | null } | null {
  if (!isCleaningType(type)) return null
  if (NAMED_CLEANS[type]) return { level: null, ...NAMED_CLEANS[type] }
  const builtin = cleanLevelFromType(type)
  if (builtin) return CLEANING_CHECKLISTS[builtin]
  if (!cleaning) return null
  const custom = customCleanFromType(cleaning, type)
  if (!custom) return null
  return {
    level: null,
    label: cleaningLabelFromType(type, cleaning) ?? custom.label,
    scope: custom.scope,
    tasks: custom.tasks,
  }
}
