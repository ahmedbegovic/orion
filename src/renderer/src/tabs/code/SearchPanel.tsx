import { useEffect, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { useCodeStore } from '@/stores/code'
import { toastError } from '@/stores/toasts'

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

/** Find in Folder: literal search scoped to searchDir; hits jump to the line. */
export default function SearchPanel() {
  const searchDir = useCodeStore((s) => s.searchDir)
  const results = useCodeStore((s) => s.searchResults)
  const searching = useCodeStore((s) => s.searching)
  const runSearch = useCodeStore((s) => s.runSearch)
  const openFile = useCodeStore((s) => s.openFile)
  const [draft, setDraft] = useState(useCodeStore.getState().searchQuery)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [])

  const onChange = (next: string): void => {
    setDraft(next)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void runSearch(next).catch(toastError), 300)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pb-1 pt-1">
        <div className="relative">
          {searching ? (
            <Loader2
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 animate-spin text-zinc-500"
            />
          ) : (
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
          )}
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Find in folder…"
            spellCheck={false}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 py-1 pl-6 pr-2 text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
          />
        </div>
        <p className="mt-0.5 truncate px-0.5 text-[10px] text-zinc-600" title={searchDir || '/'}>
          in {searchDir || 'workspace root'}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {results === null ? (
          <p className="px-2 py-1 text-[11px] text-zinc-700">Type to search file contents.</p>
        ) : results.length === 0 ? (
          <p className="px-2 py-1 text-[11px] text-zinc-600">No matches.</p>
        ) : (
          <>
            {results.map((hit, i) => (
              <button
                key={`${hit.path}:${hit.line}:${i}`}
                onClick={() => void openFile(hit.path, { line: hit.line }).catch(toastError)}
                className="block w-full rounded-md px-2 py-1 text-left hover:bg-zinc-900"
                title={`${hit.path}:${hit.line}`}
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="min-w-0 truncate text-[11.5px] text-zinc-300">
                    {baseName(hit.path)}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                    :{hit.line}
                  </span>
                </span>
                <span className="block truncate text-[10.5px] text-zinc-500">{hit.preview}</span>
              </button>
            ))}
            {results.length >= 500 && (
              <p className="px-2 py-1 text-[10px] text-zinc-600">
                Capped at 500 matches — narrow the search.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
