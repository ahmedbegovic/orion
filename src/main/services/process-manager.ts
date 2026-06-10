import { spawn, type ChildProcess } from 'node:child_process'
import type { ProcessSnapshot, ProcessState } from '@shared/types'
import { scopedLogger } from './logger'

export interface SpawnPlan {
  cmd: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export interface ManagedProcessSpec {
  name: string
  /** Resolved lazily at each spawn so ports/config are always current. */
  command: () => Promise<SpawnPlan>
  /** URL that returns 2xx once the process is ready to serve. */
  healthUrl: () => string
  port: () => number | null
  /** How long to wait for first healthy response after spawn. */
  startTimeoutMs?: number
  healthIntervalMs?: number
  /**
   * While true, failed probes still count and broadcast 'unhealthy' but never
   * escalate to a kill — the engine blocks its event loop (and thus /health)
   * for the whole of a cold model load, which is work, not a hang.
   */
  busy?: () => boolean
}

const BACKOFF_MS = [1000, 2000, 5000, 15000, 30000]
const CRASH_WINDOW_MS = 60_000
const MAX_CRASHES_IN_WINDOW = 3
const HEALTH_FAILS_BEFORE_RESTART = 3

export type ProcessChangeListener = (snapshot: ProcessSnapshot) => void

export class ManagedProcess {
  private child: ChildProcess | null = null
  private state: ProcessState = 'stopped'
  private detail = ''
  private stopping = false
  /** Bumped by stop(): a spawn parked in spec.command() must not proceed. */
  private epoch = 0
  /** Terminal latch for app quit — once set, nothing may respawn. */
  private shuttingDown = false
  private crashTimes: number[] = []
  private healthFails = 0
  private healthTimer: ReturnType<typeof setInterval> | null = null
  private pendingRestart: ReturnType<typeof setTimeout> | null = null
  private restartAttempt = 0
  private readonly log: ReturnType<typeof scopedLogger>

  constructor(
    readonly spec: ManagedProcessSpec,
    private readonly onChange: ProcessChangeListener
  ) {
    this.log = scopedLogger(spec.name)
  }

  snapshot(): ProcessSnapshot {
    return {
      name: this.spec.name,
      state: this.state,
      port: this.state === 'stopped' || this.state === 'failed' ? null : this.spec.port(),
      pid: this.child?.pid ?? null,
      detail: this.detail || undefined
    }
  }

  private setState(state: ProcessState, detail = ''): void {
    this.state = state
    this.detail = detail
    this.log.info(`state → ${state}${detail ? ` (${detail})` : ''}`)
    this.onChange(this.snapshot())
  }

  async start(): Promise<void> {
    if (this.shuttingDown) return
    if (this.state !== 'stopped' && this.state !== 'failed') return
    this.stopping = false
    this.crashTimes = []
    this.restartAttempt = 0
    await this.spawnOnce()
  }

  private async spawnOnce(): Promise<void> {
    if (this.stopping) return
    const epoch = ++this.epoch
    this.setState('spawning')
    let plan: SpawnPlan
    try {
      plan = await this.spec.command()
    } catch (err) {
      if (!this.stopping && epoch === this.epoch) {
        this.setState('failed', `could not build command: ${err instanceof Error ? err.message : err}`)
      }
      return
    }
    // command() yields the event loop — a stop()/restart() may have landed
    // meanwhile, and its replacement spawn owns the process from here.
    if (this.stopping || epoch !== this.epoch) return
    this.log.info(`spawn: ${plan.cmd} ${plan.args.join(' ')}`)
    const child = spawn(plan.cmd, plan.args, {
      cwd: plan.cwd,
      env: { ...process.env, ...plan.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group so wrappers like `uv run` die together with the
      // servers they spawn — no orphaned children squatting on our ports.
      detached: true
    })
    this.child = child
    child.stdout?.on('data', (b: Buffer) => this.log.info(b.toString().trimEnd()))
    child.stderr?.on('data', (b: Buffer) => this.log.warn(b.toString().trimEnd()))
    child.once('error', (err) => {
      this.log.error(`spawn error: ${err.message}`)
      // A child that never spawned (ENOENT) emits 'error' but never 'exit' —
      // drive the same failure path so backoff and stop()/restart() still work.
      if (child.pid === undefined && this.child === child) this.onExit(null, null)
    })
    child.once('exit', (code, signal) => {
      // A superseded child's exit must not clobber the current child's state.
      if (this.child === child) this.onExit(code, signal)
    })

    this.setState('waiting_healthy')
    const healthy = await this.waitHealthy(child)
    if (this.stopping || this.child !== child) {
      // Superseded while waiting: nothing supervises this child anymore (stop()
      // only handles the current one) — reap its group so it can't be orphaned.
      if (this.child !== child && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
      return
    }
    if (healthy) {
      this.restartAttempt = 0
      this.healthFails = 0
      this.setState('running')
      this.startHealthLoop()
    } else {
      this.log.warn('never became healthy within timeout; killing for restart')
      this.killTree('SIGKILL') // exit handler drives the restart
    }
  }

  /** Signal the whole process group (uv wrapper + python child). */
  private killTree(signal: NodeJS.Signals): void {
    const pid = this.child?.pid
    if (!pid) return
    try {
      process.kill(-pid, signal)
    } catch {
      try {
        this.child?.kill(signal)
      } catch {
        // already gone
      }
    }
  }

  private async probe(): Promise<boolean> {
    try {
      const res = await fetch(this.spec.healthUrl(), { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch {
      return false
    }
  }

  private async waitHealthy(child: ChildProcess): Promise<boolean> {
    const deadline = Date.now() + (this.spec.startTimeoutMs ?? 30_000)
    while (Date.now() < deadline) {
      if (this.stopping || this.child !== child || child.exitCode !== null) return false
      if (await this.probe()) return true
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }

  private startHealthLoop(): void {
    this.stopHealthLoop()
    this.healthTimer = setInterval(async () => {
      if (this.state !== 'running' && this.state !== 'unhealthy') return
      const ok = await this.probe()
      if (ok) {
        if (this.state === 'unhealthy') this.setState('running')
        this.healthFails = 0
        return
      }
      this.healthFails += 1
      if (this.state === 'running') this.setState('unhealthy', `${this.healthFails} failed probes`)
      if (this.healthFails >= HEALTH_FAILS_BEFORE_RESTART && !this.spec.busy?.()) {
        this.log.warn('health probes exhausted; killing for restart')
        this.healthFails = 0
        this.killTree('SIGKILL') // exit handler drives the restart
      }
    }, this.spec.healthIntervalMs ?? 5000)
  }

  private stopHealthLoop(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = null
  }

  private onExit(code: number | null, signal: string | null): void {
    this.stopHealthLoop()
    this.child = null
    if (this.stopping) {
      this.setState('stopped')
      return
    }
    const now = Date.now()
    this.crashTimes = [...this.crashTimes.filter((t) => now - t < CRASH_WINDOW_MS), now]
    if (this.crashTimes.length >= MAX_CRASHES_IN_WINDOW) {
      this.setState('failed', `crashed ${this.crashTimes.length}× in ${CRASH_WINDOW_MS / 1000}s — check logs`)
      return
    }
    const backoff = BACKOFF_MS[Math.min(this.restartAttempt, BACKOFF_MS.length - 1)]
    this.restartAttempt += 1
    this.setState('restarting', `exit ${signal ?? code}; retry in ${backoff / 1000}s`)
    this.pendingRestart = setTimeout(() => {
      this.pendingRestart = null
      void this.spawnOnce()
    }, backoff)
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.epoch += 1 // invalidate any spawn still parked in spec.command()
    this.stopHealthLoop()
    if (this.pendingRestart) {
      clearTimeout(this.pendingRestart)
      this.pendingRestart = null
    }
    const child = this.child
    if (!child) {
      this.setState('stopped')
      return
    }
    this.killTree('SIGTERM')
    const exited = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 3000)
      child.once('exit', () => {
        clearTimeout(t)
        resolve(true)
      })
    })
    if (!exited) {
      this.killTree('SIGKILL')
      // SIGKILL on the group cannot be ignored — wait (bounded) for the exit
      // so onExit reaches 'stopped' before a follow-up start() checks state.
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 2000)
        child.once('exit', () => {
          clearTimeout(t)
          resolve()
        })
      })
    }
  }

  async restart(reason: string): Promise<void> {
    this.log.info(`restart requested: ${reason}`)
    await this.stop()
    await this.start()
  }

  /** Terminal stop for app quit: a restart in flight must not respawn after. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true
    await this.stop()
  }
}

export class ProcessManager {
  private readonly procs = new Map<string, ManagedProcess>()

  constructor(private readonly onChange: ProcessChangeListener) {}

  register(spec: ManagedProcessSpec): ManagedProcess {
    // Overwriting a live entry would drop it from the map while its child
    // keeps running (detached process group) — shutdown() could never reach
    // it. Callers must stop and unregister before re-registering a name.
    const existing = this.procs.get(spec.name)
    if (existing) {
      const state = existing.snapshot().state
      if (state !== 'stopped' && state !== 'failed') {
        throw new Error(`process ${spec.name} is still ${state}`)
      }
    }
    const proc = new ManagedProcess(spec, this.onChange)
    this.procs.set(spec.name, proc)
    return proc
  }

  /** Remove a process from supervision; pass `instance` to guard against races. */
  unregister(name: string, instance?: ManagedProcess): void {
    const cur = this.procs.get(name)
    if (cur && (!instance || cur === instance)) this.procs.delete(name)
  }

  get(name: string): ManagedProcess | undefined {
    return this.procs.get(name)
  }

  snapshots(): ProcessSnapshot[] {
    return [...this.procs.values()].map((p) => p.snapshot())
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.procs.values()].map((p) => p.shutdown()))
  }
}
