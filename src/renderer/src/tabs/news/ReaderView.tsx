import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { NewsItem } from '@shared/types'
import { useNewsStore } from '@/stores/news'
import { relativeTime } from '@/lib/format'
import MarkdownPart from '../chat/MarkdownPart'

interface Props {
  item: NewsItem
}

export default function ReaderView({ item }: Props) {
  // undefined = news.read still in flight; null = no body was extracted.
  const markdown = useNewsStore((s) =>
    item.id in s.readerMarkdown ? s.readerMarkdown[item.id] : undefined
  )
  const close = useNewsStore((s) => s.close)
  const published = item.publishedAt ?? item.createdAt

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-zinc-800/80 px-6 py-2">
        <button
          onClick={close}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        >
          <ArrowLeft size={11} />
          Back
        </button>
        <span className="min-w-0 truncate text-[11px] text-zinc-600">
          {item.sourceTitle ?? 'Unknown source'} · {relativeTime(published)}
        </span>
        {item.url !== null && (
          // target=_blank routes through main's setWindowOpenHandler -> shell.openExternal.
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-600"
          >
            <ExternalLink size={11} />
            Open original
          </a>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl">
          {item.imageUrl !== null && /^https:/i.test(item.imageUrl) && (
            <img
              src={item.imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
              className="mb-5 max-h-72 w-full rounded-xl object-cover"
            />
          )}
          <h1 className="select-text text-[19px] font-semibold leading-snug text-zinc-100">
            {item.title ?? item.url ?? 'Untitled'}
          </h1>
          <p
            className="mt-1.5 text-[11.5px] text-zinc-500"
            title={new Date(published).toLocaleString()}
          >
            {item.sourceTitle ?? 'Unknown source'} · {relativeTime(published)}
          </p>
          <div className="mt-5">
            {markdown === undefined ? (
              <p className="text-[13px] text-zinc-600">Loading article…</p>
            ) : markdown === null ? (
              <p className="text-[13px] leading-relaxed text-zinc-600">
                No extracted article body — use “Open original” to read it in the browser.
              </p>
            ) : (
              <MarkdownPart text={markdown} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
