import { useState } from 'react'
import { Archive, ChevronDown, Clock, Loader2 } from 'lucide-react'
import type { NewsItem } from '@shared/types'
import { useNewsStore } from '@/stores/news'
import { toastError } from '@/stores/toasts'
import { relativeTime } from '@/lib/format'

interface Props {
  items: NewsItem[]
}

const httpsImage = (url: string | null): string | null =>
  url !== null && /^https:/i.test(url) ? url : null

export default function CardGrid({ items }: Props) {
  const open = useNewsStore((s) => s.open)
  const archive = useNewsStore((s) => s.archive)
  const paused = useNewsStore((s) => s.paused)
  // Cards whose summary is expanded in place (line-clamp lifted).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const toggleExpanded = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {items.map((item) => {
          const unread = item.readAt === null
          const thumb = httpsImage(item.imageUrl)
          return (
            <div
              key={item.id}
              className={`group relative flex flex-col items-stretch gap-1.5 rounded-lg border border-zinc-800 border-l-2 bg-zinc-900/40 p-3 text-left transition-colors hover:bg-zinc-900 ${
                unread ? 'border-l-emerald-500' : 'border-l-zinc-800'
              }`}
            >
              <button
                onClick={() => void archive(item.id).catch(toastError)}
                title="Archive"
                className="absolute right-2 top-2 z-10 hidden rounded-md bg-zinc-900/90 p-1.5 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200 group-hover:block"
              >
                <Archive size={12} />
              </button>
              {thumb && (
                <img
                  src={thumb}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                  className="-mx-3 -mt-3 mb-0.5 h-28 w-[calc(100%+1.5rem)] max-w-none rounded-t-lg object-cover"
                />
              )}
              <button
                onClick={() => void open(item.id).catch(toastError)}
                className="flex flex-col items-stretch gap-1.5 text-left"
              >
                <span className="flex items-baseline gap-2 text-[10.5px]">
                  <span className="min-w-0 truncate font-medium text-zinc-500">
                    {item.sourceTitle ?? 'Unknown source'}
                  </span>
                  <span className="ml-auto shrink-0 text-zinc-600">
                    {relativeTime(item.publishedAt ?? item.createdAt)}
                  </span>
                </span>
                <span
                  className={`line-clamp-2 text-[13px] font-medium leading-snug ${
                    unread ? 'text-zinc-100' : 'text-zinc-400'
                  }`}
                >
                  {item.title ?? item.url ?? 'Untitled'}
                </span>
              </button>
              <CardBody
                item={item}
                paused={paused}
                expanded={expanded.has(item.id)}
                onToggle={() => toggleExpanded(item.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CardBody({
  item,
  paused,
  expanded,
  onToggle
}: {
  item: NewsItem
  paused: boolean
  expanded: boolean
  onToggle: () => void
}) {
  if (item.status === 'summarized' && item.summary !== null)
    return (
      // Click expands the summary in place; pre-line keeps bullet lines intact.
      <button onClick={onToggle} className="group/summary text-left">
        <span
          className={`${expanded ? '' : 'line-clamp-6'} block whitespace-pre-line text-[12px] leading-relaxed text-zinc-400`}
        >
          {item.summary}
        </span>
        <span className="mt-1 flex items-center gap-0.5 text-[10px] text-zinc-600 group-hover/summary:text-zinc-400">
          <ChevronDown
            size={10}
            className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
          {expanded ? 'less' : 'more'}
        </span>
      </button>
    )
  if (item.status === 'new' || item.status === 'extracting')
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-zinc-600">
        <Loader2 size={11} className="animate-spin" />
        {item.status === 'new' ? 'fetching article…' : 'extracting article…'}
      </span>
    )
  if (item.status === 'pending_summary')
    return paused ? (
      <span className="self-start rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
        summary paused
      </span>
    ) : (
      <span className="flex items-center gap-1.5 text-[11px] text-zinc-600">
        <Clock size={11} />
        summary queued…
      </span>
    )
  // failed (and the odd summarized row without text) — the title and link still work.
  return <span className="text-[11px] text-zinc-600">no summary</span>
}
