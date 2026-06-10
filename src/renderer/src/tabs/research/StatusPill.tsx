import type { ResearchStatus } from '@shared/types'

const STATUS_STYLES: Record<ResearchStatus, string> = {
  planning: 'bg-sky-500/15 text-sky-400',
  rounds: 'bg-amber-500/15 text-amber-400',
  synthesis: 'bg-violet-500/15 text-violet-400',
  done: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
  cancelled: 'bg-zinc-500/15 text-zinc-400',
  paused: 'bg-orange-500/15 text-orange-400'
}

const STATUS_LABELS: Record<ResearchStatus, string> = {
  planning: 'planning',
  rounds: 'searching',
  synthesis: 'synthesis',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
  paused: 'paused'
}

/** A run that is currently being driven by the orchestrator. */
export function isActiveStatus(status: ResearchStatus): boolean {
  return status === 'planning' || status === 'rounds' || status === 'synthesis'
}

export default function StatusPill({ status }: { status: ResearchStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[9.5px] font-medium ${STATUS_STYLES[status]}`}
    >
      {isActiveStatus(status) && (
        <span className="h-1 w-1 animate-pulse rounded-full bg-current" />
      )}
      {STATUS_LABELS[status]}
    </span>
  )
}
