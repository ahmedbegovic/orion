import { z } from 'zod'

// ---------------------------------------------------------------------------
// Schemas shared by methods and events
// ---------------------------------------------------------------------------

export const processStateSchema = z.enum([
  'stopped',
  'spawning',
  'waiting_healthy',
  'running',
  'unhealthy',
  'restarting',
  'failed'
])

export const processSnapshotSchema = z.object({
  name: z.string(),
  state: processStateSchema,
  port: z.number().nullable(),
  pid: z.number().nullable(),
  detail: z.string().optional()
})

export const systemStatusSchema = z.object({
  version: z.string(),
  dataDir: z.string(),
  processes: z.array(processSnapshotSchema)
})

export const tierSchema = z.enum(['low', 'medium', 'high', 'extraHigh', 'ultra'])
export const featureSchema = z.enum(['chat', 'agent', 'code', 'research', 'news'])

export const engineModelStateSchema = z.enum([
  'unloaded',
  'loading',
  'loaded',
  'unloading',
  'preempting'
])

export const engineModelInfoSchema = z.object({
  id: z.string(),
  state: engineModelStateSchema,
  memoryGB: z.number().nullable()
})

export const engineStatusSchema = z.object({
  running: z.boolean(),
  budgetGB: z.number().nullable(),
  models: z.array(engineModelInfoSchema)
})

export const installedModelSchema = z.object({
  repoId: z.string(),
  sizeBytes: z.number(),
  lastModifiedAt: z.number().nullable()
})

export const downloadStateSchema = z.enum(['queued', 'downloading', 'done', 'failed', 'cancelled'])

export const downloadInfoSchema = z.object({
  id: z.string(),
  repoId: z.string(),
  status: downloadStateSchema,
  bytesDone: z.number(),
  bytesTotal: z.number().nullable(),
  error: z.string().nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable()
})

export const hfSearchResultSchema = z.object({
  repoId: z.string(),
  downloads: z.number(),
  likes: z.number(),
  updatedAt: z.number().nullable(),
  warning: z.string().nullable()
})

export const tierResolutionSchema = z.object({
  tier: tierSchema,
  candidates: z.array(
    z.object({
      repoId: z.string(),
      installed: z.boolean(),
      engineState: engineModelStateSchema.nullable()
    })
  ),
  active: z.string().nullable()
})

export const ramReportSchema = z.object({
  totalGB: z.number(),
  freeGB: z.number(),
  budgetGB: z.number(),
  loadedGB: z.number()
})

export const featureDefaultsSchema = z.object({
  chat: tierSchema,
  agent: tierSchema,
  code: tierSchema,
  research: tierSchema,
  news: tierSchema
})

export const modelsOverviewSchema = z.object({
  engine: engineStatusSchema,
  installed: z.array(installedModelSchema),
  downloads: z.array(downloadInfoSchema),
  tiers: z.array(tierResolutionSchema),
  defaults: featureDefaultsSchema,
  ram: ramReportSchema
})

// ---------------------------------------------------------------------------
// Method contract: renderer -> main request/response over `orion:call`.
// Every method is zod-validated on both sides of the bridge.
// ---------------------------------------------------------------------------

export const contract = {
  'system.status': {
    input: z.undefined(),
    output: systemStatusSchema
  },
  'system.restartProcess': {
    input: z.object({ name: z.string() }),
    output: z.object({ ok: z.boolean() })
  },
  'system.openLogs': {
    input: z.undefined(),
    output: z.object({ ok: z.boolean() })
  },

  // --- models / engine -----------------------------------------------------
  'models.overview': {
    input: z.undefined(),
    output: modelsOverviewSchema
  },
  'models.download': {
    /** force bypasses the QAT validator (PLE bug) — UI must confirm first. */
    input: z.object({ repoId: z.string(), force: z.boolean().optional() }),
    output: z.object({ downloadId: z.string() })
  },
  'models.cancelDownload': {
    input: z.object({ downloadId: z.string() }),
    output: z.object({ ok: z.boolean() })
  },
  'models.delete': {
    input: z.object({ repoId: z.string() }),
    output: z.object({ ok: z.boolean() })
  },
  'models.search': {
    input: z.object({ query: z.string() }),
    output: z.object({ results: z.array(hfSearchResultSchema) })
  },
  'models.load': {
    /** force bypasses the RAM guard's free-memory check — UI must confirm first. */
    input: z.object({ repoId: z.string(), force: z.boolean().optional() }),
    output: z.object({ ok: z.boolean(), reason: z.string().optional() })
  },
  'models.unloadAll': {
    input: z.undefined(),
    output: z.object({ ok: z.boolean() })
  },
  'models.setDefault': {
    input: z.object({ feature: featureSchema, tier: tierSchema }),
    output: z.object({ ok: z.boolean() })
  }
} as const

export type Contract = typeof contract
export type MethodName = keyof Contract
export type MethodInput<M extends MethodName> = z.infer<Contract[M]['input']>
export type MethodOutput<M extends MethodName> = z.infer<Contract[M]['output']>

/** Envelope returned by main for every `orion:call` invoke. */
export type CallResult<T> = { ok: true; data: T } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Event bus: main -> renderer over the single `orion:event` channel.
// ---------------------------------------------------------------------------

export const orionEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('system.processState'),
    process: processSnapshotSchema
  }),
  z.object({
    type: z.literal('system.toast'),
    level: z.enum(['info', 'warn', 'error']),
    message: z.string()
  }),
  z.object({
    type: z.literal('system.ramReport'),
    ram: ramReportSchema
  }),
  z.object({
    type: z.literal('models.downloadProgress'),
    download: downloadInfoSchema
  }),
  z.object({
    type: z.literal('models.statusChanged'),
    engine: engineStatusSchema
  })
])

export type OrionEvent = z.infer<typeof orionEventSchema>
export type OrionEventType = OrionEvent['type']
export type OrionEventOf<T extends OrionEventType> = Extract<OrionEvent, { type: T }>
