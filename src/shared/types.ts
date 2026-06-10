export type Tier = 'low' | 'medium' | 'high' | 'extraHigh' | 'ultra'

export type Feature = 'chat' | 'agent' | 'code' | 'research' | 'news'

export type ProcessName = 'tools' | 'engine' | (string & {})

export type ProcessState =
  | 'stopped'
  | 'spawning'
  | 'waiting_healthy'
  | 'running'
  | 'unhealthy'
  | 'restarting'
  | 'failed'

export interface ProcessSnapshot {
  name: ProcessName
  state: ProcessState
  port: number | null
  pid: number | null
  /** Human-readable detail, e.g. last error or restart reason. */
  detail?: string
}

export interface SystemStatus {
  version: string
  dataDir: string
  processes: ProcessSnapshot[]
}

// ---------------------------------------------------------------------------
// Models / engine (M1)
// ---------------------------------------------------------------------------

/** Lifecycle of one registry entry inside the vllm-mlx engine. */
export type EngineModelState = 'unloaded' | 'loading' | 'loaded' | 'unloading' | 'preempting'

export interface EngineModelInfo {
  id: string
  state: EngineModelState
  /** Estimated or measured footprint, GB; null when unknown. */
  memoryGB: number | null
}

export interface EngineStatus {
  running: boolean
  budgetGB: number | null
  models: EngineModelInfo[]
}

/** A model snapshot present in the shared HF cache. */
export interface InstalledModel {
  repoId: string
  sizeBytes: number
  lastModifiedAt: number | null
}

export type DownloadState = 'queued' | 'downloading' | 'done' | 'failed' | 'cancelled'

export interface DownloadInfo {
  id: string
  repoId: string
  status: DownloadState
  bytesDone: number
  bytesTotal: number | null
  error: string | null
  startedAt: number
  finishedAt: number | null
}

export interface HFSearchResult {
  repoId: string
  downloads: number
  likes: number
  updatedAt: number | null
  /** Set when the repo fails the QAT/PLE validator. */
  warning: string | null
}

export interface TierCandidateInfo {
  repoId: string
  installed: boolean
  engineState: EngineModelState | null
}

export interface TierResolution {
  tier: Tier
  candidates: TierCandidateInfo[]
  /** First installed candidate — what this tier resolves to today. */
  active: string | null
}

export interface RamReport {
  totalGB: number
  freeGB: number
  /** Engine registry memory budget. */
  budgetGB: number
  /** Sum of estimated footprints of currently loaded engine models. */
  loadedGB: number
}

export type FeatureDefaults = Record<Feature, Tier>

export interface ModelsOverview {
  engine: EngineStatus
  installed: InstalledModel[]
  downloads: DownloadInfo[]
  tiers: TierResolution[]
  defaults: FeatureDefaults
  ram: RamReport
}
