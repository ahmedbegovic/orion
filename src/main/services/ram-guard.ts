import type { EngineModelInfo, RamReport } from '@shared/types'
import type { TierSpec } from '@shared/model-tiers'
import type { MacosMemory } from './macos-memory'

/** Hard cap on the engine budget, even on bigger machines. */
const BUDGET_CAP_GB = 18.5
/** Leave this much for macOS + Electron + sidecars + opencode. */
const SYSTEM_RESERVE_GB = 5.5
const BUDGET_FLOOR_GB = 4
/** Keep this much of *available* memory untouched when judging a load. */
const SAFETY_GB = 2

const round2 = (n: number): number => Math.round(n * 100) / 100

export interface CanLoadOptions {
  loadedModels: EngineModelInfo[]
  /** Tier policy for the model being loaded, when it matches a tier candidate. */
  spec?: TierSpec
}

export type CanLoadResult = { ok: true } | { ok: false; reason: string }

/** Keeps model loads from pushing the machine into swap. */
export class RamGuard {
  constructor(private readonly memory: MacosMemory) {}

  report(loadedGB: number): RamReport {
    // NB: process.getSystemMemoryInfo() reports KILOBYTES.
    const mem = process.getSystemMemoryInfo()
    const snap = this.memory.snapshot()
    const totalGB = snap.totalGB
    const freeGB = mem.free / 1024 ** 2
    const budgetGB = Math.min(BUDGET_CAP_GB, Math.max(BUDGET_FLOOR_GB, totalGB - SYSTEM_RESERVE_GB))
    return {
      totalGB: round2(totalGB),
      freeGB: round2(freeGB),
      availableGB: snap.availableGB === null ? null : round2(snap.availableGB),
      budgetGB: round2(budgetGB),
      loadedGB: round2(loadedGB)
    }
  }

  canLoad(estimatedGB: number, opts: CanLoadOptions): CanLoadResult {
    const ram = this.report(0)
    if (estimatedGB > ram.budgetGB) {
      return {
        ok: false,
        reason: `Needs ~${estimatedGB.toFixed(1)} GB, which exceeds the ${ram.budgetGB.toFixed(1)} GB memory budget.`
      }
    }

    // The engine evicts IDLE loaded models LRU-style to fit the budget, so
    // their footprints count as reclaimable headroom — even for a noCoload
    // (ultra) model, which simply guarantees everything else gets evicted.
    const reclaimableGB = opts.loadedModels
      .filter((m) => m.state === 'loaded')
      .reduce((sum, m) => sum + (m.memoryGB ?? 0), 0)
    const shortfallGB = estimatedGB - reclaimableGB
    if (shortfallGB <= 0) return { ok: true }

    if (ram.availableGB !== null) {
      // vm_stat-derived available memory is what loads actually have to work
      // with (free + inactive + purgeable + speculative) — block only when the
      // shortfall would eat into the last SAFETY_GB of it.
      if (shortfallGB > ram.availableGB - SAFETY_GB) {
        return {
          ok: false,
          reason:
            `Only ~${ram.availableGB.toFixed(1)} GB available; loading ~${estimatedGB.toFixed(1)} GB ` +
            `(after evicting ~${reclaimableGB.toFixed(1)} GB of idle models) would likely swap. ` +
            'Close some apps or unload models first.'
        }
      }
      return { ok: true }
    }

    // Sampler fallback: macOS "free" badly understates what's reclaimable, so
    // grant free memory a 1.5× benefit of the doubt before blocking.
    if (ram.freeGB * 1.5 < shortfallGB) {
      return {
        ok: false,
        reason:
          `Only ~${ram.freeGB.toFixed(1)} GB free; loading ~${estimatedGB.toFixed(1)} GB ` +
          `(after evicting ~${reclaimableGB.toFixed(1)} GB of idle models) would likely swap. ` +
          'Close some apps or unload models first.'
      }
    }

    return { ok: true }
  }
}
