import { useEffect, useRef, type ReactNode } from 'react'
import {
  ChevronDown,
  FileText,
  Globe,
  ListTodo,
  Loader2,
  MousePointerClick,
  NotebookPen,
  Scale,
  Search,
  Sparkles,
  type LucideIcon
} from 'lucide-react'
import type { ResearchRunMeta, ResearchStep, ResearchStepType } from '@shared/types'
import { hostname, list, rec, stepError, str, strings } from './cast'

const STEP_ICONS: Record<ResearchStepType, LucideIcon> = {
  plan: ListTodo,
  search: Search,
  select: MousePointerClick,
  visit: Globe,
  note: NotebookPen,
  sufficiency: Scale,
  synthesis: Sparkles,
  render: FileText
}

const STEP_LABELS: Record<ResearchStepType, string> = {
  plan: 'Plan',
  search: 'Search',
  select: 'Select sources',
  visit: 'Visit',
  note: 'Notes',
  sufficiency: 'Sufficiency',
  synthesis: 'Synthesis',
  render: 'Render report'
}

function dotClass(step: ResearchStep): string {
  switch (step.status) {
    case 'done':
      return 'bg-emerald-400'
    case 'failed':
      return 'bg-red-400'
    case 'running':
      return 'animate-pulse bg-amber-400'
    default:
      return 'bg-zinc-600'
  }
}

function searchQueries(input: Record<string, unknown>): string[] {
  const queries = strings(input.queries)
  if (queries.length > 0) return queries
  const single = str(input.query)
  return single ? [single] : []
}

/** Search output is "the result list" — accept a raw array or {results}. */
function searchResults(output: unknown): Record<string, unknown>[] {
  const raw = Array.isArray(output) ? output : list(rec(output).results)
  return raw.map(rec)
}

function summaryOf(step: ResearchStep): string {
  const input = rec(step.input)
  const output = rec(step.output)
  const running = step.status === 'running'
  switch (step.type) {
    case 'plan': {
      if (running) return 'Breaking the question down…'
      const subs = strings(output.subquestions)
      return subs.length > 0 ? `${subs.length} subquestions` : ''
    }
    case 'search': {
      const queries = searchQueries(input)
      const head = queries[0] ?? ''
      const more = queries.length > 1 ? ` +${queries.length - 1}` : ''
      if (running) return head ? `${head}${more}` : 'Searching…'
      return `${head}${more} · ${searchResults(step.output).length} results`
    }
    case 'select': {
      if (running) return 'Choosing sources…'
      return `${list(output.selections).length} sources selected`
    }
    case 'visit': {
      const url = str(input.url) ?? ''
      const title = str(output.title)
      if (running) return url ? `Reading ${hostname(url)}…` : 'Reading…'
      return title ?? (url ? hostname(url) : '')
    }
    case 'note': {
      if (running) return 'Taking notes…'
      const url = str(input.url)
      return `${strings(output.claims).length} claims${url ? ` from ${hostname(url)}` : ''}`
    }
    case 'sufficiency': {
      if (running) return 'Assessing coverage…'
      if (output.sufficient === true) return 'Sufficient — ready to synthesize'
      if (output.sufficient === false)
        return `Needs more · ${strings(output.missing).length} gaps`
      return ''
    }
    case 'synthesis':
      return running ? 'Writing the report…' : (str(output.title) ?? 'Report drafted')
    case 'render':
      return running ? 'Rendering…' : 'Report rendered'
  }
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item, i) => (
        <span
          key={`${i}-${item}`}
          className="rounded-full border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 text-[10.5px] text-zinc-400"
        >
          {item}
        </span>
      ))}
    </div>
  )
}

function UrlLink({ url, label }: { url: string; label?: string }) {
  return (
    // target=_blank routes through main's setWindowOpenHandler -> shell.openExternal.
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={url}
      className="block max-w-full truncate text-[11px] text-sky-400 hover:underline"
    >
      {label ?? url}
    </a>
  )
}

function Bullets({ items, className }: { items: string[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <ul className={`list-disc space-y-1 pl-4 text-[11.5px] leading-relaxed ${className ?? 'text-zinc-400'}`}>
      {items.map((item, i) => (
        <li key={i} className="select-text">
          {item}
        </li>
      ))}
    </ul>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
        {label}
      </div>
      {children}
    </div>
  )
}

function prettyJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  try {
    const json = JSON.stringify(value, null, 2)
    return json === '{}' || json === undefined ? null : json
  } catch {
    return String(value)
  }
}

function StepBody({ step }: { step: ResearchStep }) {
  const input = rec(step.input)
  const output = rec(step.output)
  switch (step.type) {
    case 'plan': {
      const subs = strings(output.subquestions)
      const queries = strings(output.initial_queries)
      return (
        <>
          {subs.length > 0 && (
            <Section label="Subquestions">
              <ol className="list-decimal space-y-1 pl-4 text-[11.5px] leading-relaxed text-zinc-400">
                {subs.map((q, i) => (
                  <li key={i} className="select-text">
                    {q}
                  </li>
                ))}
              </ol>
            </Section>
          )}
          {queries.length > 0 && (
            <Section label="Initial queries">
              <Chips items={queries} />
            </Section>
          )}
        </>
      )
    }
    case 'search': {
      const results = searchResults(step.output)
      return (
        <>
          <Section label="Queries">
            <Chips items={searchQueries(input)} />
          </Section>
          {results.length > 0 && (
            <Section label="Results">
              <div className="space-y-1.5">
                {results.map((r, i) => {
                  const url = str(r.url)
                  return (
                    <div key={i} className="min-w-0">
                      <p className="select-text truncate text-[11.5px] text-zinc-300">
                        {str(r.title) ?? url ?? '—'}
                      </p>
                      {url && <UrlLink url={url} />}
                    </div>
                  )
                })}
              </div>
            </Section>
          )}
        </>
      )
    }
    case 'select': {
      const selections = list(output.selections).map(rec)
      if (selections.length === 0) return null
      return (
        <Section label="Chosen sources">
          <div className="space-y-1.5">
            {selections.map((sel, i) => {
              const url = str(sel.url)
              return (
                <div key={i} className="min-w-0">
                  {url && <UrlLink url={url} />}
                  {str(sel.reason) && (
                    <p className="select-text text-[11px] text-zinc-500">{str(sel.reason)}</p>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )
    }
    case 'visit': {
      const url = str(input.url) ?? str(output.url)
      const title = str(output.title)
      if (!url && !title) return null
      return (
        <Section label="Page">
          {title && <p className="select-text text-[11.5px] text-zinc-300">{title}</p>}
          {url && <UrlLink url={url} />}
        </Section>
      )
    }
    case 'note': {
      const claims = strings(output.claims)
      const quotes = strings(output.quotes)
      if (claims.length === 0 && quotes.length === 0) return null
      return (
        <>
          {claims.length > 0 && (
            <Section label="Claims">
              <Bullets items={claims} />
            </Section>
          )}
          {quotes.length > 0 && (
            <Section label="Quotes">
              <div className="space-y-1.5">
                {quotes.map((q, i) => (
                  <p
                    key={i}
                    className="select-text border-l-2 border-zinc-700 pl-2 text-[11px] italic leading-relaxed text-zinc-500"
                  >
                    {q}
                  </p>
                ))}
              </div>
            </Section>
          )}
        </>
      )
    }
    case 'sufficiency': {
      const missing = strings(output.missing)
      const nextQueries = strings(output.next_queries)
      const roundReport = str(output.round_report)
      return (
        <>
          {output.sufficient !== undefined && (
            <p
              className={`text-[11.5px] font-medium ${
                output.sufficient === true ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {output.sufficient === true
                ? 'Enough evidence gathered.'
                : 'Not enough evidence yet.'}
            </p>
          )}
          {missing.length > 0 && (
            <Section label="Missing">
              <Bullets items={missing} />
            </Section>
          )}
          {nextQueries.length > 0 && (
            <Section label="Next queries">
              <Chips items={nextQueries} />
            </Section>
          )}
          {roundReport && (
            <Section label="Round report">
              <p className="select-text whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">
                {roundReport}
              </p>
            </Section>
          )}
        </>
      )
    }
    case 'synthesis': {
      const headings = list(output.sections)
        .map((s) => str(rec(s).heading))
        .filter((h): h is string => h !== undefined)
      if (headings.length === 0) return null
      return (
        <Section label="Sections">
          <Bullets items={headings} />
        </Section>
      )
    }
    case 'render': {
      // No structured payload worth a custom view — fall through to raw JSON.
      const raw = prettyJson(step.output)
      if (!raw) return null
      return (
        <pre className="select-text overflow-x-auto whitespace-pre-wrap rounded bg-zinc-950/60 p-2 font-mono text-[11px] leading-relaxed text-zinc-400">
          {raw}
        </pre>
      )
    }
  }
}

function StepCard({ step }: { step: ResearchStep }) {
  const Icon = STEP_ICONS[step.type]
  const error = stepError(step)
  return (
    <details className="group/step rounded-lg border border-zinc-800/80 bg-zinc-900/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 [&::-webkit-details-marker]:hidden">
        <Icon size={12} className="shrink-0 text-zinc-500" />
        <span className="shrink-0 text-[11.5px] font-medium text-zinc-300">
          {STEP_LABELS[step.type]}
        </span>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(step)}`} />
        <span
          className={`truncate text-[11px] ${error ? 'text-red-400' : 'text-zinc-600'}`}
        >
          {error ?? summaryOf(step)}
        </span>
        <ChevronDown
          size={12}
          className="ml-auto shrink-0 text-zinc-600 transition-transform group-open/step:rotate-180"
        />
      </summary>
      <div className="space-y-2 border-t border-zinc-800/80 px-3 py-2">
        <StepBody step={step} />
        {error && (
          <p className="select-text whitespace-pre-wrap break-words rounded bg-red-500/10 p-2 text-[11px] leading-relaxed text-red-300">
            {error}
          </p>
        )}
        {step.status === 'running' && (
          <p className="text-[11px] text-zinc-600">Running…</p>
        )}
      </div>
    </details>
  )
}

type Phase = 'plan' | 'round' | 'final'

function phaseOf(step: ResearchStep): Phase {
  if (step.type === 'plan') return 'plan'
  if (step.type === 'synthesis' || step.type === 'render') return 'final'
  return 'round'
}

interface StepGroup {
  key: string
  label: string
  steps: ResearchStep[]
}

function groupSteps(steps: ResearchStep[]): StepGroup[] {
  const groups: StepGroup[] = []
  for (const step of steps) {
    const phase = phaseOf(step)
    const key = `${phase}:${step.round}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.steps.push(step)
      continue
    }
    groups.push({
      key,
      label:
        phase === 'plan' ? 'Planning' : phase === 'final' ? 'Synthesis' : `Round ${step.round || 1}`,
      steps: [step]
    })
  }
  return groups
}

interface Props {
  run: ResearchRunMeta
  steps: ResearchStep[] | undefined
}

export default function StepTimeline({ run, steps }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const active =
    run.status === 'planning' || run.status === 'rounds' || run.status === 'synthesis'

  // Follow new steps only while the user is already near the bottom.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) el.scrollTop = el.scrollHeight
  }, [steps])

  if (!steps)
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-zinc-600">
        Loading…
      </div>
    )

  if (steps.length === 0)
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-5">
          {run.status === 'planning' ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-11 animate-pulse rounded-lg bg-zinc-900"
                  style={{ opacity: 1 - i * 0.3 }}
                />
              ))}
              <p className="flex items-center gap-2 pt-1 text-[12px] text-zinc-500">
                <Loader2 size={13} className="animate-spin" />
                Planning the research… loading the model can take a while the first time.
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-zinc-600">No steps recorded for this run.</p>
          )}
        </div>
      </div>
    )

  return (
    <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-4 px-6 py-5">
        {groupSteps(steps).map((group) => (
          <div key={group.key}>
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-600">
              {group.label}
            </div>
            <div className="space-y-1.5">
              {group.steps.map((step) => (
                <StepCard key={step.id} step={step} />
              ))}
            </div>
          </div>
        ))}
        {active && (
          <p className="flex items-center gap-2 text-[12px] text-zinc-500">
            <Loader2 size={13} className="animate-spin" />
            Working…
          </p>
        )}
      </div>
    </div>
  )
}
