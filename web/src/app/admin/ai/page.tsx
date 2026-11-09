import { AlertTriangle, Image as ImageIcon, MessageSquareText, Sparkles } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import {
  AI_TEXT_MODEL_OPTIONS,
  AI_VISION_MODEL_OPTIONS,
} from '@/lib/ai/openrouter'
import { getAiSettings, isAiConfigured } from '@/lib/ai/settings'
import { AiSettingsForm } from './_components/ai-settings-form'

export const metadata = { title: 'Admin · AI' }
export const dynamic = 'force-dynamic'

/**
 * AI settings — per-capability model picks. One key + one OpenRouter
 * env var covers every model in either dropdown.
 *
 * Capability split:
 *   Vision model — image-capable. Used by the condition-assist agent
 *                  on /inspect today; future room/photo agents reuse it.
 *   Text model   — text-only. Reserved for the next agent (report
 *                  summariser, QA flag triage); selectable today so it
 *                  picks up the admin's choice when shipped without an
 *                  intervening deploy.
 */
export default async function AdminAiPage() {
  await requireRole('admin')
  const settings = await getAiSettings()
  const configured = isAiConfigured()

  return (
    <div className="w-full max-w-3xl space-y-6 px-6 py-10">
      <div>
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          AI settings
        </div>
        <h1 className="mt-1 font-display text-3xl text-foreground">
          Agentic AI
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick the OpenRouter model for each capability the LISTD agents
          can call. One API key covers every model in the dropdowns :
          add <code className="rounded bg-muted px-1">OPENROUTER_API_KEY</code>{' '}
          to the server env to enable.
        </p>
      </div>

      {!configured && (
        <Card className="border-amber-500/40 bg-amber-50/50">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                OpenRouter API key not set on the server.
              </p>
              <p className="mt-1 text-xs">
                Add{' '}
                <code className="rounded bg-amber-100 px-1 py-0.5">
                  OPENROUTER_API_KEY
                </code>{' '}
                to Vercel → Settings → Environment Variables. Until then,
                model selections save but every AI agent call will fail
                at runtime with a 500.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <AiSettingsForm
        initial={{
          visionModel: settings.visionModel,
          textModel: settings.textModel,
        }}
        visionOptions={AI_VISION_MODEL_OPTIONS}
        textOptions={AI_TEXT_MODEL_OPTIONS}
      />

      <Card>
        <CardContent className="space-y-3 p-6 text-xs text-muted-foreground">
          <p className="text-sm font-semibold text-foreground">
            Capability split
          </p>
          <div className="flex items-start gap-2">
            <ImageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground" />
            <p>
              <span className="font-medium text-foreground">Vision model</span>
              {' '}: picks up image inputs. Used by the condition-assist
              agent on{' '}
              <code className="rounded bg-muted px-1">/inspect</code>{' '}
              today. Dropdown is restricted to models OpenRouter
              advertises as image-capable, so a non-vision model can
              never land here by mistake.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground" />
            <p>
              <span className="font-medium text-foreground">Text model</span>
              {' '}: creates the inspection executive summary and powers
              the platform assistants. The report generator keeps a
              deterministic fallback so submission still succeeds if the
              provider is unavailable.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
