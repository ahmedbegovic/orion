import { Clock, Loader2 } from 'lucide-react'
import type { NewsItem } from '@shared/types'
import { useNewsStore } from '@/stores/news'
import { toastError } from '@/stores/toasts'
import { relativeTime } from '@/lib/format'

interface Props {
  items: NewsItem[]
}

export default function CardGrid({ items }: Props) {
  const open = useNewsStore((s) => s.open)
  const paused = useNewsStore((s) => s.paused)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        {items.map((item) => {
          const unread = item.readAt === null
          return (
            <button
              key={item.id}
              onClick={() => void open(item.id).catch(toastError)}
              className={`flex flex-col items-stretch gap-1.5 rounded-lg border border-zinc-800 border-l-2 bg-zinc-900/40 p-3 text-left transition-colors hover:bg-zinc-900 ${
                unread ? 'border-l-emerald-500' : 'border-l-zinc-800'
              }`}
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
              <CardBody item={item} paused={paused} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CardBody({ item, paused }: { item: NewsItem; paused: boolean }) {
  if (item.status === 'summarized' && item.summary !== null)
    return (
      // pre-line keeps the summary's bullet lines on their own lines.
      <span className="line-clamp-6 whitespace-pre-line text-[12px] leading-relaxed text-zinc-400">
        {item.summary}
      </span>
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
