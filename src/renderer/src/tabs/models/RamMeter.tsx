import type { RamReport } from '@shared/types'

function gb(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

/** Slim bar of loaded-vs-budget engine memory plus free system RAM. */
export default function RamMeter({ ram }: { ram: RamReport }) {
  // Scale to the budget; if loads ever exceed it the overflow shows in red.
  const scale = Math.max(ram.budgetGB, ram.loadedGB, 0.001)
  const loadedPct = (Math.min(ram.loadedGB, ram.budgetGB) / scale) * 100
  const overPct = (Math.max(ram.loadedGB - ram.budgetGB, 0) / scale) * 100

  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] tabular-nums text-zinc-500">
        {gb(ram.availableGB ?? ram.freeGB)} GB available of {gb(ram.totalGB)} · budget{' '}
        {gb(ram.budgetGB)} · {gb(ram.loadedGB)} loaded
      </span>
      <div
        className="flex h-1.5 w-44 overflow-hidden rounded-full bg-zinc-800"
        title={`${gb(ram.loadedGB)} GB loaded of ${gb(ram.budgetGB)} GB engine budget`}
      >
        <div className="h-full bg-emerald-500" style={{ width: `${loadedPct}%` }} />
        <div className="h-full bg-red-500" style={{ width: `${overPct}%` }} />
      </div>
    </div>
  )
}
