import { execFile } from 'node:child_process'
import os from 'node:os'
import { scopedLogger } from './logger'

const log = scopedLogger('macos-memory')

const SAMPLE_MS = 3000

export interface MemorySnapshot {
  totalGB: number
  /** Reclaimable-under-pressure memory à la Activity Monitor; null until sampled or on parse failure. */
  availableGB: number | null
}

/**
 * macOS keeps "free" pages near zero by design (the file cache eats idle RAM),
 * so process.getSystemMemoryInfo().free reads ~0.1 GB on a healthy machine.
 * What loads actually have to work with is free + inactive + purgeable +
 * speculative pages — sampled from `vm_stat` every few seconds.
 */
export class MacosMemory {
  private timer: NodeJS.Timeout | null = null
  private availableGB: number | null = null
  private warned = false

  start(): void {
    if (this.timer) return
    this.sample()
    this.timer = setInterval(() => this.sample(), SAMPLE_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  snapshot(): MemorySnapshot {
    return { totalGB: os.totalmem() / 1024 ** 3, availableGB: this.availableGB }
  }

  private sample(): void {
    execFile('/usr/bin/vm_stat', { timeout: 5_000 }, (err, stdout) => {
      const parsed = err ? null : parseVmStat(stdout)
      if (parsed === null && !this.warned) {
        this.warned = true
        log.warn(
          `vm_stat sampling failed (${err ? String(err) : 'unparseable output'}) — ` +
            'falling back to the free-memory heuristic'
        )
      }
      this.availableGB = parsed
    })
  }
}

/** Exported for the fallback check; returns decimal GB or null when the format surprises us. */
export function parseVmStat(text: string): number | null {
  const pageSizeMatch = /page size of (\d+) bytes/.exec(text)
  if (!pageSizeMatch) return null
  const pageSize = Number(pageSizeMatch[1])

  const pages = (label: string): number | null => {
    const m = new RegExp(`^Pages ${label}:\\s+(\\d+)\\.`, 'm').exec(text)
    return m ? Number(m[1]) : null
  }

  const free = pages('free')
  const inactive = pages('inactive')
  const purgeable = pages('purgeable')
  const speculative = pages('speculative')
  if (free === null || inactive === null || purgeable === null || speculative === null) return null
  return ((free + inactive + purgeable + speculative) * pageSize) / 1e9
}
