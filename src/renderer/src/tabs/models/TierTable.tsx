import { useState } from 'react'
import { TIER_ORDER, TIERS } from '@shared/model-tiers'
import type {
  DownloadInfo,
  EngineModelState,
  ModelsOverview,
  Tier,
  TierCandidateInfo
} from '@shared/types'
import { useModelsStore } from '@/stores/models'
import ConfirmDialog from '@/components/ConfirmDialog'

const TIER_LABELS: Record<Tier, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  extraHigh: 'Extra high',
  ultra: 'Ultra'
}

function shortName(repoId: string): string {
  return repoId.split('/').pop() ?? repoId
}

interface ChipProps {
  candidate: TierCandidateInfo
  active: boolean
  /** Live state from overview.engine; falls back to the overview snapshot. */
  engineState: EngineModelState | null
  download: DownloadInfo | undefined
  onLoad: (repoId: string) => void
  onDownload: (repoId: string) => void
}

function CandidateChip({ candidate, active, engineState, download, onLoad, onDownload }: ChipProps) {
  let action: React.ReactNode
  if (!candidate.installed) {
    action = download ? (
      <span className="animate-pulse text-[11px] tabular-nums text-amber-400">
        {download.bytesTotal !== null
          ? `${Math.floor((download.bytesDone / download.bytesTotal) * 100)}%`
          : 'downloading…'}
      </span>
    ) : (
      <button
        onClick={() => onDownload(candidate.repoId)}
        className="rounded-md border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      >
        Download
      </button>
    )
  } else if (engineState === 'loaded') {
    action = (
      <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Loaded
      </span>
    )
  } else if (engineState === 'loading') {
    action = <span className="animate-pulse text-[11px] text-amber-400">Loading…</span>
  } else if (engineState === 'unloading' || engineState === 'preempting') {
    action = (
      <span className="text-[11px] text-amber-400">
        {engineState === 'unloading' ? 'Unloading…' : 'Preempting…'}
      </span>
    )
  } else {
    action = (
      <button
        onClick={() => onLoad(candidate.repoId)}
        className="rounded-md bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-zinc-700"
      >
        Load
      </button>
    )
  }

  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 ${
        active ? 'ring-1 ring-zinc-500/50' : ''
      }`}
    >
      <span className="max-w-56 truncate text-[12px] text-zinc-300" title={candidate.repoId}>
        {shortName(candidate.repoId)}
      </span>
      {action}
    </div>
  )
}

/** One row per quality tier: policy from model-tiers, live state from the overview. */
export default function TierTable({ overview }: { overview: ModelsOverview }) {
  const load = useModelsStore((s) => s.load)
  const download = useModelsStore((s) => s.download)
  const [guard, setGuard] = useState<{ repoId: string; reason: string } | null>(null)

  const liveState = (repoId: string, fallback: EngineModelState | null): EngineModelState | null =>
    overview.engine.models.find((m) => m.id === repoId)?.state ?? fallback

  const activeDownload = (repoId: string): DownloadInfo | undefined =>
    overview.downloads.find(
      (d) => d.repoId === repoId && (d.status === 'queued' || d.status === 'downloading')
    )

  const onLoad = async (repoId: string): Promise<void> => {
    const result = await load(repoId)
    if (!result.ok) setGuard({ repoId, reason: result.reason ?? 'The RAM guard blocked this load.' })
  }

  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        Tiers
      </h2>
      <div className="divide-y divide-zinc-800/70 rounded-lg border border-zinc-800 bg-zinc-900/30">
        {TIER_ORDER.map((tier) => {
          const spec = TIERS[tier]
          const resolution = overview.tiers.find((t) => t.tier === tier)
          return (
            <div key={tier} className="flex items-center gap-4 px-4 py-3">
              <div className="w-44 shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-medium text-zinc-200">{TIER_LABELS[tier]}</span>
                  {spec.caps
                    .filter((cap) => cap !== 'text')
                    .map((cap) => (
                      <span
                        key={cap}
                        className="rounded border border-zinc-700/80 px-1 text-[9px] uppercase tracking-wide text-zinc-500"
                      >
                        {cap}
                      </span>
                    ))}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  ~{spec.approxGB} GB · {Math.round(spec.defaultCtx / 1024)}k ctx
                </div>
              </div>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                {(resolution?.candidates ?? []).map((candidate) => (
                  <CandidateChip
                    key={candidate.repoId}
                    candidate={candidate}
                    active={resolution?.active === candidate.repoId}
                    engineState={liveState(candidate.repoId, candidate.engineState)}
                    download={activeDownload(candidate.repoId)}
                    onLoad={(repoId) => void onLoad(repoId)}
                    onDownload={(repoId) => void download(repoId)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <ConfirmDialog
        open={guard !== null}
        title="Not enough free RAM"
        body={guard?.reason ?? ''}
        confirmLabel="Load anyway"
        danger
        onConfirm={() => {
          if (guard) void load(guard.repoId, true)
          setGuard(null)
        }}
        onCancel={() => setGuard(null)}
      />
    </section>
  )
}
