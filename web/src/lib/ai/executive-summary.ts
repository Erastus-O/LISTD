import 'server-only'

import { getAiSettings } from './settings'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const MAX_PROMPT_CHARS = 48_000
const MAX_OVERALL_CHARS = 1_600
const MAX_BULLET_CHARS = 600

export type ReportActionType = 'maintenance' | 'cleaning'

export type ExecutiveSummary = {
  overall: string
  maintenance: string[]
  cleaning: string[]
  source: 'ai' | 'fallback'
}

export type ExecutiveSummaryInput = {
  propertyAddress?: string | null
  inspectionType?: string | null
  generalNotes?: string | null
  rooms: Array<{
    name: string
    overallCondition?: string | null
    items: Array<{
      ref?: string | null
      name: string
      description?: string | null
      condition?: string | null
      actionType?: ReportActionType | null
      actionComment?: string | null
    }>
  }>
  meterReadings?: Array<{
    label: string
    value?: string | null
    location?: string | null
  }>
  smokeAlarmsChecked?: boolean
  carbonMonoxideChecked?: boolean
}

const MAINTENANCE_RE =
  /\b(damaged|broken|missing|crack(?:ed)?|leak(?:ing)?|unsafe|mou?ld|repair|replace|maintenance)\b/i
const CLEANING_RE =
  /\b(dirty|stain(?:ed)?|grease|limescale|unclean|dust(?:y)?|clean(?:ing)? required)\b/i

function cap(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function bulletFor(
  room: string,
  item: ExecutiveSummaryInput['rooms'][number]['items'][number]
): string {
  const detail =
    cap(item.actionComment, MAX_BULLET_CHARS) ||
    cap(item.condition, MAX_BULLET_CHARS) ||
    cap(item.description, MAX_BULLET_CHARS) ||
    'Follow-up requested by the inspecting clerk.'
  const ref = cap(item.ref, 40)
  return `${ref ? `${ref} - ` : ''}${room} / ${item.name}: ${detail}`
}

function collectActions(input: ExecutiveSummaryInput): {
  maintenance: string[]
  cleaning: string[]
} {
  const maintenance: string[] = []
  const cleaning: string[] = []

  for (const room of input.rooms) {
    for (const item of room.items) {
      const combined = [
        item.actionComment,
        item.condition,
        item.description,
      ]
        .filter(Boolean)
        .join(' ')
      const type =
        item.actionType ??
        (CLEANING_RE.test(combined)
          ? 'cleaning'
          : MAINTENANCE_RE.test(combined)
            ? 'maintenance'
            : null)
      if (type === 'maintenance') maintenance.push(bulletFor(room.name, item))
      if (type === 'cleaning') cleaning.push(bulletFor(room.name, item))
    }
  }

  return {
    maintenance: Array.from(new Set(maintenance)),
    cleaning: Array.from(new Set(cleaning)),
  }
}

export function buildFallbackExecutiveSummary(
  input: ExecutiveSummaryInput
): ExecutiveSummary {
  const actions = collectActions(input)
  const recordedItems = input.rooms.reduce(
    (count, room) =>
      count +
      room.items.filter(
        (item) =>
          cap(item.description, 1) ||
          cap(item.condition, 1) ||
          item.actionType
      ).length,
    0
  )
  const ratedRooms = input.rooms
    .map((room) => room.overallCondition)
    .filter((rating): rating is string => Boolean(rating))
  const inaccessibleMeters = (input.meterReadings ?? []).filter((meter) =>
    /not accessible|inaccessible|unreadable/i.test(meter.value ?? '')
  )

  const conditionLead =
    ratedRooms.length > 0
      ? `Recorded room ratings range across ${Array.from(new Set(ratedRooms)).join(', ')} condition.`
      : `The inspection records ${recordedItems} item observation${recordedItems === 1 ? '' : 's'} across ${input.rooms.length} area${input.rooms.length === 1 ? '' : 's'}.`
  const actionLead =
    actions.maintenance.length || actions.cleaning.length
      ? ` ${actions.maintenance.length} maintenance and ${actions.cleaning.length} cleaning item${actions.maintenance.length + actions.cleaning.length === 1 ? ' is' : 's are'} flagged for follow-up.`
      : ' No maintenance or cleaning actions were explicitly flagged.'
  const safety = [
    input.smokeAlarmsChecked ? 'smoke alarms recorded as checked' : null,
    input.carbonMonoxideChecked
      ? 'carbon monoxide alarms recorded as checked'
      : null,
    inaccessibleMeters.length
      ? `${inaccessibleMeters.length} meter reading${inaccessibleMeters.length === 1 ? ' was' : 's were'} not accessible`
      : null,
  ].filter(Boolean)

  return {
    overall: cap(
      `${conditionLead}${actionLead}${safety.length ? ` Safety and access notes: ${safety.join('; ')}.` : ''} ${cap(input.generalNotes, 500)}`,
      MAX_OVERALL_CHARS
    ),
    maintenance: actions.maintenance,
    cleaning: actions.cleaning,
    source: 'fallback',
  }
}

function compactInput(input: ExecutiveSummaryInput): string {
  const compact = {
    propertyAddress: cap(input.propertyAddress, 300),
    inspectionType: cap(input.inspectionType, 120),
    generalNotes: cap(input.generalNotes, 1_000),
    rooms: input.rooms.map((room) => ({
      name: cap(room.name, 120),
      overallCondition: cap(room.overallCondition, 80),
      items: room.items.map((item) => ({
        ref: cap(item.ref, 40),
        name: cap(item.name, 120),
        description: cap(item.description, 700),
        condition: cap(item.condition, 700),
        actionType: item.actionType ?? null,
        actionComment: cap(item.actionComment, 700),
      })),
    })),
    meterReadings: (input.meterReadings ?? []).map((meter) => ({
      label: cap(meter.label, 80),
      value: cap(meter.value, 160),
      location: cap(meter.location, 200),
    })),
    smokeAlarmsChecked: Boolean(input.smokeAlarmsChecked),
    carbonMonoxideChecked: Boolean(input.carbonMonoxideChecked),
  }

  let text = JSON.stringify(compact)
  if (text.length <= MAX_PROMPT_CHARS) return text

  // Preserve every action while trimming ordinary observations first.
  for (const room of compact.rooms) {
    room.items = room.items.filter(
      (item) => item.actionType || item.actionComment
    )
  }
  text = JSON.stringify(compact)
  if (text.length <= MAX_PROMPT_CHARS) return text

  // Keep the model payload valid JSON even for an extreme inspection. The
  // deterministic fallback still retains every explicit action and is merged
  // into the result below, so trimming model context cannot drop a clerk flag.
  while (text.length > MAX_PROMPT_CHARS) {
    const room = [...compact.rooms]
      .reverse()
      .find((candidate) => candidate.items.length > 0)
    if (!room) break
    room.items.pop()
    text = JSON.stringify(compact)
  }
  return text
}

function parseSummary(raw: string, fallback: ExecutiveSummary): ExecutiveSummary {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return fallback
  try {
    const parsed = JSON.parse(match[0]) as {
      overall?: unknown
      maintenance?: unknown
      cleaning?: unknown
    }
    const overall = cap(parsed.overall, MAX_OVERALL_CHARS)
    if (!overall) return fallback
    const toList = (value: unknown): string[] =>
      Array.isArray(value)
        ? value
            .map((entry) => cap(entry, MAX_BULLET_CHARS))
            .filter(Boolean)
            .slice(0, 40)
        : []
    const generatedMaintenance = toList(parsed.maintenance)
    const generatedCleaning = toList(parsed.cleaning)
    return {
      overall,
      // Explicit clerk flags are authoritative. Model prose may populate an
      // otherwise-empty category, but it never replaces the deterministic
      // action list assembled from the clerk's structured flags.
      maintenance:
        fallback.maintenance.length > 0
          ? fallback.maintenance
          : generatedMaintenance,
      cleaning:
        fallback.cleaning.length > 0
          ? fallback.cleaning
          : generatedCleaning,
      source: 'ai',
    }
  } catch {
    return fallback
  }
}

export async function generateExecutiveSummary(
  input: ExecutiveSummaryInput
): Promise<ExecutiveSummary> {
  const fallback = buildFallbackExecutiveSummary(input)
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return fallback

  const settings = await getAiSettings()
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd-pro.vercel.app'
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': siteUrl,
      'X-Title': 'LISTD Pro',
    },
    body: JSON.stringify({
      model: settings.textModel,
      max_tokens: 1_200,
      temperature: 0.2,
      provider: { allow_fallbacks: true, data_collection: 'deny' },
      messages: [
        {
          role: 'system',
          content:
            'You write concise UK property inventory executive summaries. Use only the supplied evidence. Return JSON only with keys overall (one factual paragraph), maintenance (array of short prose bullets), and cleaning (array of short prose bullets). Preserve every explicit action flag, mention material alarm or inaccessible-meter issues, and do not invent defects or responsibility assignments.',
        },
        {
          role: 'user',
          content: `Create the report-wide executive summary from this structured inspection:\n${compactInput(input)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.warn(
      `[ai/executive-summary] OpenRouter ${response.status}: ${detail.slice(0, 200)}`
    )
    return fallback
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return parseSummary(json.choices?.[0]?.message?.content ?? '', fallback)
}
