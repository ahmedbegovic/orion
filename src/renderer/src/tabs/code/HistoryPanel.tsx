import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import type { GitLogEntry } from '@shared/types'
import { call } from '@/lib/ipc'
import { useCodeStore } from '@/stores/code'
import { toastError } from '@/stores/toasts'
import { relativeTime } from '@/lib/format'

/** Per-file commit log; picking a commit diffs it against its parent. */
export default function HistoryPanel() {
  const root = useCodeStore((s) => s.root)
  const path = useCodeStore((s) => s.historyPath)
  const openDiff = useCodeStore((s) => s.openDiff)
  const [entries, setEntries] = useState<GitLogEntry[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    setEntries(null)
    setPicked(null)
    if (!root || !path) return
    let cancelled = false
    void call('git.log', { root, path })
      .then(({ entries }) => {
        if (!cancelled) setEntries(entries)
      })
      .catch((err) => {
        if (!cancelled) {
          setEntries([])
          toastError(err)
        }
      })
    return () => {
      cancelled = true
    }
  }, [root, path])

  if (!path) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
        <History size={22} strokeWidth={1.5} className="text-zinc-700" />
        <p className="text-[11.5px] leading-relaxed text-zinc-600">
          Pick “View History” on a file to see its commits.
        </p>
      </div>
    )
  }

  const show = (entry: GitLogEntry): void => {
    if (!root) return
    setPicked(entry.hash)
    void Promise.all([
      call('git.show', { root, ref: `${entry.hash}~1`, path }),
      call('git.show', { root, ref: entry.hash, path })
    ])
      .then(([parent, at]) =>
        openDiff({
          path,
          label: entry.hash.slice(0, 7),
          original: parent.content ?? '',
          modified: at.content ?? ''
        })
      )
      .catch(toastError)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 truncate px-3 pb-1 pt-2 text-[10.5px] text-zinc-600" title={path}>
        {path}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {entries === null ? (
          <p className="px-2 py-2 text-[11px] text-zinc-600">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="px-2 py-2 text-[11px] text-zinc-600">No commits touch this file.</p>
        ) : (
          entries.map((entry) => (
            <button
              key={entry.hash}
              onClick={() => show(entry)}
              className={`block w-full rounded-md px-2 py-1.5 text-left ${
                picked === entry.hash ? 'bg-zinc-800' : 'hover:bg-zinc-900'
              }`}
            >
              <span className="block truncate text-[12px] text-zinc-300">{entry.subject}</span>
              <span className="block text-[10.5px] tabular-nums text-zinc-600">
                {entry.hash.slice(0, 7)} · {entry.author} · {relativeTime(entry.timeMs)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
