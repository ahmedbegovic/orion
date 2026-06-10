import { useEffect } from 'react'
import { ExternalLink } from 'lucide-react'
import type { ResearchRunMeta, ResearchSource } from '@shared/types'
import { useResearchStore } from '@/stores/research'
import { toastError } from '@/stores/toasts'
import { hostname } from './cast'

interface Props {
  run: ResearchRunMeta
}

export default function ReportView({ run }: Props) {
  const report = useResearchStore((s) => s.reportsByRun[run.id])
  const sources = useResearchStore((s) => s.sourcesByRun[run.id])
  const loadReport = useResearchStore((s) => s.loadReport)

  useEffect(() => {
    if (!report) void loadReport(run.id).catch(toastError)
  }, [report, run.id, loadReport])

  if (!report)
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-zinc-600">
        Loading report…
      </div>
    )

  if (report.html === null)
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-zinc-600">
        The report file is missing from disk.
      </div>
    )

  // The report numbers fetched sources only, in row order — mirror that here
  // so the strip's [n] matches the report's citations. Unfetched rows (failed
  // visits) render unnumbered below with a marker.
  const all = sources ?? []
  const numbered = all.filter((s) => s.fetched)
  const unfetched = all.filter((s) => !s.fetched)

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 p-4">
        {/* No allow-scripts — the template is inert HTML with inline CSS only.
            allow-popups lets target=_blank reach the window-open handler,
            which opens the system browser and denies the in-app popup. The
            frame matches the template's #101013 and fades in on load so
            switching to the report never flashes white. */}
        <iframe
          sandbox="allow-popups"
          srcDoc={report.html}
          title="Research report"
          onLoad={(e) => e.currentTarget.classList.remove('opacity-0')}
          className="h-full w-full rounded-lg border border-zinc-800 bg-[#101013] opacity-0 transition-opacity duration-150"
        />
      </div>

      <aside className="flex w-64 shrink-0 flex-col border-l border-zinc-800/80 bg-zinc-950/30">
        <div className="shrink-0 px-3 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-600">
          Sources
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {all.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-zinc-600">No sources recorded.</p>
          ) : (
            <>
              {numbered.map((source, i) => (
                <SourceRow key={source.id} source={source} index={i + 1} />
              ))}
              {unfetched.map((source) => (
                <SourceRow key={source.id} source={source} />
              ))}
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

function SourceRow({ source, index }: { source: ResearchSource; index?: number }) {
  return (
    // target=_blank routes through main's setWindowOpenHandler -> shell.openExternal.
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      title={source.url}
      className="group mb-0.5 flex items-start gap-1.5 rounded-md px-2 py-1.5 hover:bg-zinc-900"
    >
      <span className="shrink-0 pt-px tabular-nums text-[10.5px] text-zinc-600">
        {index === undefined ? '–' : `[${index}]`}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[11.5px] leading-snug text-zinc-300">
          {source.title ?? hostname(source.url)}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-zinc-600">
          <span className="truncate">{hostname(source.url)}</span>
          {source.cited && (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-medium text-emerald-400">
              cited
            </span>
          )}
          {!source.fetched && (
            <span className="shrink-0 rounded-full bg-zinc-800 px-1.5 py-px text-[9px] font-medium text-zinc-500">
              not fetched
            </span>
          )}
        </span>
      </span>
      <ExternalLink
        size={10}
        className="mt-1 shrink-0 text-zinc-700 group-hover:text-zinc-400"
      />
    </a>
  )
}
