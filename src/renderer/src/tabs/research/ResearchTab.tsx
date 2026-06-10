import { useEffect } from 'react'
import { Telescope } from 'lucide-react'
import { useLibraryStore } from '@/stores/library'
import { useResearchStore } from '@/stores/research'
import { toastError } from '@/stores/toasts'
import RunSidebar from './RunSidebar'
import RunView from './RunView'

export default function ResearchTab() {
  const init = useResearchStore((s) => s.init)
  const initLibrary = useLibraryStore((s) => s.init)
  const activeId = useResearchStore((s) => s.activeId)
  const run = useResearchStore((s) =>
    s.activeId !== null ? s.runs.find((r) => r.id === s.activeId) : undefined
  )

  useEffect(() => {
    void init().catch(toastError)
    // The composer's collection picker needs the library list.
    void initLibrary().catch(toastError)
  }, [init, initLibrary])

  return (
    <div className="flex h-full">
      <RunSidebar />
      {run ? (
        <RunView key={activeId} run={run} />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4">
          <Telescope size={32} strokeWidth={1.5} className="text-zinc-700" />
          <div className="text-center">
            <h2 className="text-[14px] font-medium text-zinc-300">No research selected</h2>
            <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-zinc-600">
              Ask a question in the sidebar — a local model plans subquestions, searches the
              web, reads sources and writes a cited report.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
