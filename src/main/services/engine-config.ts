import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dataDir } from './paths'

export interface EngineConfigModel {
  name: string
  source: string
  estimatedMemoryGB: number
}

export interface EngineConfigOptions {
  port: number
  models: EngineConfigModel[]
  budgetGB: number
}

export function engineConfigPath(): string {
  return join(dataDir(), 'engine', 'engine-config.json')
}

/**
 * Write the engine config — the contract between Electron main (writer) and
 * run_engine.py (reader). Rewritten at every engine spawn so the port and
 * registry are always current. Pure function of its inputs.
 */
export function writeEngineConfig(opts: EngineConfigOptions): string {
  const config = {
    port: opts.port,
    memory_budget_gb: opts.budgetGB,
    contention: { strategy: 'wait_then_fail', wait_timeout_s: 180 },
    models: opts.models.map((m) => ({
      name: m.name,
      source: m.source,
      estimated_memory_gb: m.estimatedMemoryGB
    }))
  }
  const path = engineConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
  return path
}
