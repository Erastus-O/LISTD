import { unstable_cache } from 'next/cache'
import { inArray } from 'drizzle-orm'
import { platformSettings, withServiceRole } from '@/db'
import { TrustpilotWidget } from './trustpilot-widget'

const KEYS = [
  'trustpilot_enabled',
  'trustpilot_embed_code',
  'trustpilot_review_link',
] as const

const fetchTrustpilotSettings = unstable_cache(
  async (): Promise<{
    enabled: boolean
    embedCode: string
    reviewLink: string
  }> => {
    try {
      const rows = await withServiceRole(async (tx) =>
        tx
          .select({
            key: platformSettings.key,
            value: platformSettings.value,
          })
          .from(platformSettings)
          .where(inArray(platformSettings.key, [...KEYS]))
      )
      const map = new Map(rows.map((r) => [r.key, r.value ?? '']))
      return {
        enabled: map.get('trustpilot_enabled') === 'true',
        embedCode: map.get('trustpilot_embed_code') ?? '',
        reviewLink: map.get('trustpilot_review_link') ?? '',
      }
    } catch (err) {
      console.warn('[trustpilot] settings fetch failed; hiding section:', err)
      return { enabled: false, embedCode: '', reviewLink: '' }
    }
  },
  ['trustpilot-settings'],
  { revalidate: 3600, tags: ['platform-settings'] }
)

export async function TrustpilotReviews() {
  const { enabled, embedCode, reviewLink } = await fetchTrustpilotSettings()
  if (!enabled) return null

  return <TrustpilotWidget embedCode={embedCode} reviewLink={reviewLink} />
}
