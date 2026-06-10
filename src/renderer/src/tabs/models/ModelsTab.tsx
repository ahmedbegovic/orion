import { useEffect } from 'react'
import { useModelsStore } from '@/stores/models'
import RamMeter from './RamMeter'
import TierTable from './TierTable'
import DefaultsMatrix from './DefaultsMatrix'
import DownloadsPanel from './DownloadsPanel'
import LocalModels from './LocalModels'
import HFSearch from './HFSearch'

export default function ModelsTab() {
  const overview = useModelsStore((s) => s.overview)
  const init = useModelsStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  return (
    <div className="h-full overflow-y-auto">
      {/* pt-10 clears the hiddenInset titlebar drag region overlay (h-9). */}
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-8 pb-12 pt-10">
        <div className="flex items-center justify-between gap-6">
          <h1 className="text-xl font-semibold text-zinc-100">Models</h1>
          {overview && <RamMeter ram={overview.ram} />}
        </div>
        {overview ? (
          <>
            <TierTable overview={overview} />
            <DefaultsMatrix overview={overview} />
            <DownloadsPanel overview={overview} />
            <LocalModels overview={overview} />
            <HFSearch />
          </>
        ) : (
          <p className="text-sm text-zinc-600">Loading…</p>
        )}
      </div>
    </div>
  )
}
