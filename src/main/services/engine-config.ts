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

/**
 * vllm-mlx's reasoning parser is a server-wide global, not per-model — pick
 * one only when every registry model agrees on a family. Mixed registries get
 * raw passthrough (the Chat tab parses gemma's thought channel itself; the
 * Agent tab needs the engine to do it, so mixed-family is degraded there).
 */
function reasoningParserFor(models: EngineConfigModel[]): string | null {
  const ids = models.map((m) => m.name.toLowerCase())
  if (ids.length === 0) return null
  if (ids.every((id) => id.includes('gemma'))) return 'gemma4'
  if (ids.every((id) => id.includes('qwen'))) return 'qwen3'
  return null
}

export function engineConfigPath(): string {
  return join(dataDir(), 'engine', 'engine-config.json')
}

/**
 * Write the engine config — the contract between Electron main (writer) and
 * run_engine.py (reader). Rewritten at every engine spawn so the port and
 * registry are always current. Pure function of its inputs. Returns the
 * computed reasoning parser alongside the path so callers can tell when the
 * engine runs degraded (null = raw passthrough; gemma agent sessions hang).
 */
export function writeEngineConfig(opts: EngineConfigOptions): {
  path: string
  reasoningParser: string | null
} {
  const reasoningParser = reasoningParserFor(opts.models)
  const config = {
    port: opts.port,
    memory_budget_gb: opts.budgetGB,
    contention: { strategy: 'wait_then_fail', wait_timeout_s: 180 },
    reasoning_parser: reasoningParser,
    models: opts.models.map((m) => ({
      name: m.name,
      source: m.source,
      estimated_memory_gb: m.estimatedMemoryGB
    }))
  }
  const path = engineConfigPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
  return { path, reasoningParser }
}
