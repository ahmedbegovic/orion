import type { EngineModelInfo, EngineModelState } from '@shared/types'

/** One entry of /v1/status model_manager.models in registry mode. */
interface RegistryModelEntry {
  id: string
  status?: EngineModelState
  loaded?: boolean
  owned_by?: string
  source?: string
  memory_gb?: number | null
}

interface StatusResponse {
  status?: string
  num_running?: number
  model_manager?: {
    memory_budget_gb?: number
    models?: RegistryModelEntry[]
  }
}

/** Typed client for the vllm-mlx engine sidecar (OpenAI-compatible). */
export class EngineClient {
  /**
   * Generation requests in flight through THIS client. Registry-mode
   * /v1/status hides per-request state, and main owns all engine traffic in
   * M1/M2 — so this counter is the idleness signal restart decisions rely on.
   * Status/models probes (GETs) don't count.
   */
  private inflight = 0

  constructor(private readonly baseUrl: () => string) {}

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = 10_000
  ): Promise<T> {
    if (method === 'POST') this.inflight += 1
    try {
      const res = await fetch(`${this.baseUrl()}${path}`, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`engine ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
      }
      return (await res.json()) as T
    } finally {
      if (method === 'POST') this.inflight -= 1
    }
  }

  /**
   * Registry state of every configured model — from /v1/status, because the
   * /v1/models route strips everything but the id. Tolerates the single-model
   * shape (no model_manager) by reporting the active model as loaded.
   */
  async models(): Promise<EngineModelInfo[]> {
    const res = await this.request<StatusResponse & { model?: string }>('GET', '/v1/status')
    if (res.model_manager?.models) {
      return res.model_manager.models.map((m) => ({
        id: m.id,
        state: m.status ?? (m.loaded ? 'loaded' : 'unloaded'),
        memoryGB: typeof m.memory_gb === 'number' ? m.memory_gb : null
      }))
    }
    return res.model ? [{ id: res.model, state: 'loaded', memoryGB: null }] : []
  }

  /** Liveness subset — used to avoid restarting mid-generation. */
  async status(): Promise<{ running: boolean; numRunning: number }> {
    const res = await this.request<StatusResponse>('GET', '/v1/status')
    return {
      running: res.status === 'running',
      numRunning: Math.max(res.num_running ?? 0, this.inflight)
    }
  }

  /**
   * "Load" a model: in registry mode the first request naming a model makes
   * the manager load it (evicting idle models if the budget demands it).
   * Generous timeout — a cold load pages weights in from disk.
   */
  async warm(modelId: string): Promise<void> {
    await this.request(
      'POST',
      '/v1/chat/completions',
      {
        model: modelId,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 1,
        stream: false
      },
      300_000
    )
  }
}
