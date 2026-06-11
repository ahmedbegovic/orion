import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Archive, CheckCheck, Loader2, Newspaper, RefreshCw, Rss, Search, Trash2 } from 'lucide-react'
import { useNewsStore } from '@/stores/news'
import { useUiStore } from '@/stores/ui'
import { toastError } from '@/stores/toasts'
import ConfirmDialog from '@/components/ConfirmDialog'
import SourcesPanel from './SourcesPanel'
import CardGrid from './CardGrid'
import ReaderView from './ReaderView'

export default function NewsTab() {
  const init = useNewsStore((s) => s.init)
  const opened = useNewsStore((s) => s.opened)
  const sources = useNewsStore((s) => s.sources)
  const items = useNewsStore((s) => s.items)
  const paused = useNewsStore((s) => s.paused)
  const refreshing = useNewsStore((s) => s.refreshing)
  const query = useNewsStore((s) => s.query)
  const showArchived = useNewsStore((s) => s.showArchived)
  const refreshFeeds = useNewsStore((s) => s.refreshFeeds)
  const markAllRead = useNewsStore((s) => s.markAllRead)
  const setQuery = useNewsStore((s) => s.setQuery)
  const setShowArchived = useNewsStore((s) => s.setShowArchived)
  const archiveAll = useNewsStore((s) => s.archiveAll)
  const selectedItem = useNewsStore((s) => s.selectedItem)
  const activeTab = useUiStore((s) => s.activeTab)
  const [showSources, setShowSources] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [searchDraft, setSearchDraft] = useState(query)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void init().catch(toastError)
  }, [init])

  // Fetch-on-open: mount + every time this tab becomes the active one. Main
  // no-ops when the last cycle is younger than 15 minutes.
  useEffect(() => {
    if (activeTab === 'news') void opened().catch(() => {})
  }, [activeTab, opened])

  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current)
    },
    []
  )

  const unread = items.filter((i) => i.readAt === null).length

  const onRefresh = (): void => {
    void refreshFeeds().catch(toastError)
  }

  const onSearch = (next: string): void => {
    setSearchDraft(next)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void setQuery(next).catch(toastError), 250)
  }

  return (
    <div className="flex h-full flex-col">
      {/* In-band header: h-12 row shares the hiddenInset titlebar band and drags the window. */}
      <header className="drag-region flex h-12 shrink-0 items-center gap-2.5 border-b border-zinc-800/80 px-6">
        <h1 className="shrink-0 text-[13px] font-semibold text-zinc-100">News</h1>
        {unread > 0 && !showArchived && (
          <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-[10.5px] font-medium tabular-nums text-zinc-300">
            {unread} unread
          </span>
        )}
        {paused && (
          <span className="min-w-0 truncate rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-400">
            summaries paused while the large model is loaded
          </span>
        )}

        <div className="no-drag ml-auto flex shrink-0 items-center gap-1.5">
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input
              value={searchDraft}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search news…"
              spellCheck={false}
              className="w-44 rounded-md border border-zinc-800 bg-zinc-900 py-1 pl-6 pr-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
            />
          </div>
          <button
            onClick={() => void setShowArchived(!showArchived).catch(toastError)}
            title={showArchived ? 'Back to the live list' : 'Browse archived items'}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
              showArchived
                ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600'
            }`}
          >
            <Archive size={11} />
            Archived
          </button>
          <button
            onClick={onRefresh}
            disabled={refreshing || sources.length === 0}
            className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 enabled:hover:border-zinc-600 disabled:opacity-40"
          >
            {refreshing ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <RefreshCw size={11} />
            )}
            Refresh
          </button>
          <button
            onClick={() => void markAllRead().catch(toastError)}
            disabled={unread === 0}
            className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 enabled:hover:border-zinc-600 disabled:opacity-40"
          >
            <CheckCheck size={11} />
            Mark all read
          </button>
          <button
            onClick={() => setConfirmClear(true)}
            disabled={showArchived || items.length === 0}
            title="Archive every item"
            className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 enabled:hover:border-zinc-600 disabled:opacity-40"
          >
            <Trash2 size={11} />
            Clear all
          </button>
          <button
            onClick={() => setShowSources((v) => !v)}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
              showSources
                ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600'
            }`}
          >
            <Rss size={11} />
            Manage sources
          </button>
        </div>
      </header>

      {showSources && <SourcesPanel />}

      {selectedItem ? (
        <ReaderView item={selectedItem} />
      ) : sources.length === 0 ? (
        <EmptyState
          title="No sources yet"
          body="Add an RSS or Atom feed — new items are fetched, extracted and summarized locally."
        >
          <button
            onClick={() => setShowSources(true)}
            className="rounded-md bg-emerald-600 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-emerald-500"
          >
            Add a source
          </button>
        </EmptyState>
      ) : items.length === 0 ? (
        <EmptyState
          title={
            showArchived
              ? 'No archived items'
              : query
                ? 'Nothing matches the search'
                : 'No items yet'
          }
          body={
            showArchived
              ? 'Archived items land here — the hover button on a card archives it.'
              : query
                ? 'Try different words — the search scans titles, summaries and article text.'
                : 'Feeds refresh when you open this tab — or pull them right now.'
          }
        >
          {!showArchived && !query && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[12px] text-zinc-300 enabled:hover:border-zinc-600 disabled:opacity-40"
            >
              {refreshing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              Refresh
            </button>
          )}
        </EmptyState>
      ) : (
        <CardGrid items={items} />
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Archive all items?"
        body="Every item moves to the archive — nothing is deleted, and the Archived view keeps them searchable."
        confirmLabel="Clear all"
        onConfirm={() => {
          setConfirmClear(false)
          void archiveAll().catch(toastError)
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}

function EmptyState({
  title,
  body,
  children
}: {
  title: string
  body: string
  children?: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
      <Newspaper size={32} strokeWidth={1.5} className="text-zinc-700" />
      <div className="text-center">
        <h2 className="text-[14px] font-medium text-zinc-300">{title}</h2>
        <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-zinc-600">{body}</p>
      </div>
      {children}
    </div>
  )
}
