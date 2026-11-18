import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { platformSettings, withServiceRole } from '@/db'

/**
 * How Pro jobs run, editable on Admin › Settings without a rebuild.
 *
 *   autoApproveFromLevel  0 = LISTD approves every accepted job by hand (beta).
 *                         1 to 3 = Pros at or above that level are approved
 *                         automatically; others still wait for LISTD.
 *   clientChat            Clients can message LISTD on their booking. Pros only
 *                         ever talk to LISTD; there is no Pro-to-client chat.
 *   platformRules         Sent to the Pro with every job brief.
 */
export type ProWorkflow = {
  autoApproveFromLevel: number
  clientChat: boolean
  platformRules: string
}

export const PRO_WORKFLOW_KEY = 'pro_workflow'

export const DEFAULT_PRO_WORKFLOW: ProWorkflow = {
  autoApproveFromLevel: 0,
  clientChat: false,
  platformRules: [
    'Check in on arrival with a photo of the front of the building, and check out with one when you leave.',
    'Photograph every area you work in. Remove any photo frame that does not apply.',
    'Do not contact the client or tenants about price or extra work. Raise a requote in the app and LISTD will confirm with the client.',
    'Keep access codes and keys private. Return keys exactly as instructed.',
    'Message LISTD in the app if anything stops you starting or finishing the job.',
  ].join('\n'),
}

export function mergeProWorkflow(raw: unknown): ProWorkflow {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<ProWorkflow>
  const level = Number(v.autoApproveFromLevel)
  return {
    autoApproveFromLevel: Number.isInteger(level) && level >= 0 && level <= 3 ? level : DEFAULT_PRO_WORKFLOW.autoApproveFromLevel,
    clientChat: typeof v.clientChat === 'boolean' ? v.clientChat : DEFAULT_PRO_WORKFLOW.clientChat,
    platformRules: typeof v.platformRules === 'string' && v.platformRules.trim() ? v.platformRules : DEFAULT_PRO_WORKFLOW.platformRules,
  }
}

export async function getProWorkflow(): Promise<ProWorkflow> {
  const [row] = await withServiceRole((tx) =>
    tx.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, PRO_WORKFLOW_KEY)).limit(1)
  )
  if (!row?.value) return DEFAULT_PRO_WORKFLOW
  try {
    return mergeProWorkflow(JSON.parse(row.value))
  } catch {
    return DEFAULT_PRO_WORKFLOW
  }
}

export async function saveProWorkflow(next: ProWorkflow): Promise<void> {
  const value = JSON.stringify(mergeProWorkflow(next))
  await withServiceRole((tx) =>
    tx
      .insert(platformSettings)
      .values({ key: PRO_WORKFLOW_KEY, value })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: sql`now()` } })
  )
}

/** Is this Pro's accept approved straight away? Level 0 setting means never. */
export function autoApproves(w: ProWorkflow, proLevel: number): boolean {
  return w.autoApproveFromLevel > 0 && proLevel >= w.autoApproveFromLevel
}
