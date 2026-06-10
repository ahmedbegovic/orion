import { useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import type { NewsSource } from '@shared/types'
import { useNewsStore } from '@/stores/news'
import { toastError } from '@/stores/toasts'
import { relativeTime } from '@/lib/format'
import ConfirmDialog from '@/components/ConfirmDialog'

export default function SourcesPanel() {
  const sources = useNewsStore((s) => s.sources)
  const addSource = useNewsStore((s) => s.addSource)
  const updateSource = useNewsStore((s) => s.updateSource)
  const removeSource = useNewsStore((s) => s.removeSource)

  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<NewsSource | null>(null)

  const submit = (): void => {
    const trimmed = url.trim()
    if (trimmed === '' || adding) return
    setAdding(true)
    void addSource(trimmed)
      .then(() => setUrl(''))
      .catch(toastError)
      .finally(() => setAdding(false))
  }

  return (
    <section className="shrink-0 border-b border-zinc-800/80 bg-zinc-950/50 px-6 py-3">
      <div className="flex items-center gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="Feed URL (RSS or Atom)…"
          spellCheck={false}
          className="w-full max-w-md rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-[12px] text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={adding || url.trim() === ''}
          className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[12px] font-medium text-white enabled:hover:bg-emerald-500 disabled:opacity-40"
        >
          {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          Add
        </button>
      </div>

      {sources.length > 0 && (
        <ul className="mt-2.5 space-y-0.5">
          {sources.map((source) => (
            <li
              key={source.id}
              className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-zinc-900"
            >
              <input
                type="checkbox"
                checked={source.enabled}
                onChange={(e) =>
                  void updateSource(source.id, e.target.checked).catch(toastError)
                }
                title={source.enabled ? 'Disable (skipped on fetch cycles)' : 'Enable'}
                className="accent-emerald-600"
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[12px] ${
                    source.enabled ? 'text-zinc-200' : 'text-zinc-500'
                  }`}
                >
                  {source.title ?? source.url}
                </span>
                {source.title !== null && (
                  <span className="block truncate text-[10.5px] text-zinc-600">{source.url}</span>
                )}
              </span>
              <span className="shrink-0 text-[10.5px] text-zinc-600">
                {source.lastFetchedAt !== null
                  ? `fetched ${relativeTime(source.lastFetchedAt)}`
                  : 'never fetched'}
              </span>
              <button
                onClick={() => setDeleteTarget(source)}
                title="Remove source"
                className="shrink-0 rounded p-1 text-zinc-600 opacity-0 hover:bg-zinc-800 hover:text-red-400 group-hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Remove source"
        body={`Remove "${deleteTarget?.title ?? deleteTarget?.url ?? ''}" and its fetched items? This cannot be undone.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          if (deleteTarget) void removeSource(deleteTarget.id).catch(toastError)
          setDeleteTarget(null)
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  )
}
