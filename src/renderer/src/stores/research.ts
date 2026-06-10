import { create } from 'zustand'
import type {
  ResearchMode,
  ResearchRunMeta,
  ResearchSource,
  ResearchStep,
  Tier
} from '@shared/types'
import { call, onEvent } from '@/lib/ipc'

export interface ResearchStartOptions {
  mode: ResearchMode
  tier?: Tier
  collectionId?: string
}

interface ResearchStore {
  runs: ResearchRunMeta[]
  activeId: string | null
  /** Steps per run; only runs opened (or started) this session have an entry. */
  stepsByRun: Record<string, ResearchStep[]>
  sourcesByRun: Record<string, ResearchSource[]>
  /** Rendered report html + structured JSON, fetched on demand once done. */
  reportsByRun: Record<string, { html: string | null; report: unknown }>
  initialized: boolean
  init: () => Promise<void>
  refreshList: () => Promise<void>
  /** Authoritative re-pull of one run's meta + steps + sources. */
  refreshRun: (runId: string) => Promise<void>
  select: (runId: string) => Promise<void>
  start: (question: string, options: ResearchStartOptions) => Promise<void>
  cancel: (runId: string) => Promise<void>
  resume: (runId: string) => Promise<void>
  remove: (runId: string) => Promise<void>
  loadReport: (runId: string) => Promise<void>
  exportPdf: (runId: string) => Promise<string | null>
}

function upsertStep(steps: ResearchStep[], step: ResearchStep): ResearchStep[] {
  const index = steps.findIndex((s) => s.id === step.id)
  if (index !== -1) return steps.map((s, i) => (i === index ? step : s))
  return [...steps, step].sort((a, b) => a.seq - b.seq)
}

export const useResearchStore = create<ResearchStore>((set, get) => ({
  runs: [],
  activeId: null,
  stepsByRun: {},
  sourcesByRun: {},
  reportsByRun: {},
  initialized: false,

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })

    onEvent('research.step', (event) => {
      set((s) => {
        const steps = s.stepsByRun[event.runId]
        // Runs never opened this session have no entry — research.get fills
        // the full history when they are selected.
        if (!steps) return {}
        return {
          stepsByRun: { ...s.stepsByRun, [event.runId]: upsertStep(steps, event.step) }
        }
      })
    })

    onEvent('research.status', (event) => {
      set((s) => ({
        runs: s.runs.map((r) =>
          r.id === event.runId ? { ...r, status: event.status, round: event.round } : r
        )
      }))
      // Sources (fetched/cited flags), reportPath and finishedAt only travel
      // via research.get — status transitions are the cheap moments to
      // reconcile them for runs we are watching.
      if (get().stepsByRun[event.runId])
        void get()
          .refreshRun(event.runId)
          .catch(() => {})
    })

    await get().refreshList()
    const first = get().runs[0]
    if (first && get().activeId === null) await get().select(first.id)
  },

  refreshList: async () => {
    const { runs } = await call('research.list')
    set({ runs })
  },

  refreshRun: async (runId) => {
    const { run, steps, sources } = await call('research.get', { runId })
    set((s) => ({
      // Upsert: prepend when missing (research.list orders by created_at DESC
      // and a run absent from the list is almost always the newest), so a run
      // survives a failed refreshList after research.start.
      runs: s.runs.some((r) => r.id === run.id)
        ? s.runs.map((r) => (r.id === run.id ? run : r))
        : [run, ...s.runs],
      stepsByRun: { ...s.stepsByRun, [runId]: steps },
      sourcesByRun: { ...s.sourcesByRun, [runId]: sources }
    }))
  },

  select: async (runId) => {
    set({ activeId: runId })
    await get().refreshRun(runId)
  },

  start: async (question, options) => {
    const { runId } = await call('research.start', {
      question,
      mode: options.mode,
      tier: options.tier,
      collectionId: options.collectionId
    })
    // Prime the caches immediately so step events landing before the first
    // research.get snapshot are not dropped.
    set((s) => ({
      activeId: runId,
      stepsByRun: { ...s.stepsByRun, [runId]: s.stepsByRun[runId] ?? [] },
      sourcesByRun: { ...s.sourcesByRun, [runId]: s.sourcesByRun[runId] ?? [] }
    }))
    await get().refreshList()
    await get().refreshRun(runId)
  },

  cancel: async (runId) => {
    // The cancelled status lands via research.status.
    await call('research.cancel', { runId })
  },

  resume: async (runId) => {
    await call('research.resume', { runId })
    await get().refreshRun(runId)
  },

  remove: async (runId) => {
    await call('research.delete', { runId })
    set((s) => {
      const { [runId]: _s, ...stepsByRun } = s.stepsByRun
      const { [runId]: _o, ...sourcesByRun } = s.sourcesByRun
      const { [runId]: _r, ...reportsByRun } = s.reportsByRun
      return {
        runs: s.runs.filter((r) => r.id !== runId),
        stepsByRun,
        sourcesByRun,
        reportsByRun,
        activeId: s.activeId === runId ? null : s.activeId
      }
    })
    const next = get().runs[0]
    if (get().activeId === null && next) await get().select(next.id)
  },

  loadReport: async (runId) => {
    const { html, report } = await call('research.report', { runId })
    set((s) => ({ reportsByRun: { ...s.reportsByRun, [runId]: { html, report } } }))
  },

  exportPdf: async (runId) => {
    // Main writes report.pdf and reveals it in Finder; null = nothing to export.
    const { path } = await call('research.exportPdf', { runId })
    return path
  }
}))
