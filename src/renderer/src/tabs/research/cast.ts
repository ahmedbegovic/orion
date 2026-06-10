import type { ResearchStep } from '@shared/types'

// ---------------------------------------------------------------------------
// Tolerant casts over step input/output JSON. The contract deliberately ships
// them as unknown (shapes belong to the orchestrator) — never trust a field.
// ---------------------------------------------------------------------------

export function rec(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** A failed step's output carries the error; fall back to a generic label. */
export function stepError(step: ResearchStep): string | undefined {
  if (step.status !== 'failed') return undefined
  return str(rec(step.output).error) ?? 'Step failed'
}
