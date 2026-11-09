import { Icon } from '@/components/listd/icon'
import { STAGES, jobStage, serviceStyle } from '@/lib/listd/job-stage'

const vars = (o: Record<string, string>) => o as React.CSSProperties

/** Dot + word for a job's status, in the design's client-facing stages. */
export function StatusPill({ status }: { status: string }) {
  const stage = jobStage(status)
  const c = stage.tone === 'muted' ? 'var(--border-strong)' : `var(--status-${stage.tone})`
  return (
    <span className="ld-pill" style={vars({ '--c': c })}>
      <i aria-hidden="true" />
      {stage.label}
    </span>
  )
}

/** Coloured service tag for an `inspection_type` value. */
export function ServiceTag({ type, label }: { type: string; label?: string }) {
  const s = serviceStyle(type, label)
  return (
    <span
      className="ld-tag"
      style={vars({
        '--t': `var(--service-${s.key}-subtle)`,
        '--tx': `var(--service-${s.key}-text)`,
      })}
    >
      <Icon name={s.icon} size={16} />
      {label ?? s.label}
    </span>
  )
}

/** Six-stage progress rail. Renders nothing for cancelled or unpaid jobs. */
export function ProgressRail({ status }: { status: string }) {
  const { step } = jobStage(status)
  if (step < 0) return null
  // The last stage is a finished state, not "currently happening".
  const finished = step === STAGES.length - 1
  return (
    <ol className="ld-rail" style={vars({ '--n': String(STAGES.length) })} aria-label="Job progress">
      {STAGES.map((label, i) => {
        const state = i < step || (finished && i === step) ? 'done' : i === step ? 'current' : 'todo'
        return (
          <li key={label} className={state} aria-current={state === 'current' ? 'step' : undefined}>
            <i aria-hidden="true" />
            <b>{label}</b>
          </li>
        )
      })}
    </ol>
  )
}
