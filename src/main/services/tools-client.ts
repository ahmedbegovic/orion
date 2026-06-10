export interface JobSnapshot<TData = unknown> {
  id: string
  kind: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  /** 0..1, or -1 when indeterminate. */
  progress: number
  detail?: string
  error?: string | null
  /** Job-kind-specific live payload (e.g. download byte counts). */
  data?: TData
  result?: unknown
}

export interface DownloadJobData {
  repo_id: string
  bytes_done: number
  bytes_total: number | null
}

export interface LocalModelEntry {
  repo_id: string
  size_bytes: number
  last_modified_ms: number | null
}

export interface HubSearchEntry {
  repo_id: string
  downloads: number
  likes: number
  last_modified_ms: number | null
}

/** Typed client for the orion-tools FastAPI sidecar. Grows with each milestone. */
export class ToolsClient {
  constructor(private readonly baseUrl: () => string) {}

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl()}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`tools ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
    }
    return (await res.json()) as T
  }

  healthz(): Promise<{ status: string; service: string; version: string }> {
    return this.request('GET', '/healthz')
  }

  job<TData = unknown>(id: string): Promise<JobSnapshot<TData>> {
    return this.request('GET', `/jobs/${id}`)
  }

  cancelJob(id: string): Promise<{ ok: boolean }> {
    return this.request('POST', `/jobs/${id}/cancel`)
  }

  // --- models / HF cache -----------------------------------------------------

  downloadModel(repoId: string): Promise<{ job_id: string }> {
    return this.request('POST', '/models/download', { repo_id: repoId })
  }

  localModels(): Promise<{ models: LocalModelEntry[] }> {
    return this.request('GET', '/models/local')
  }

  /** repo_id contains a slash — the sidecar uses a path-typed param. */
  deleteModel(repoId: string): Promise<{ ok: boolean }> {
    return this.request('DELETE', `/models/${repoId}`)
  }

  searchModels(q: string): Promise<{ results: HubSearchEntry[] }> {
    return this.request('GET', `/models/search?q=${encodeURIComponent(q)}`)
  }
}
