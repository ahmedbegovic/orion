import { handle } from '../ipc/router'
import type { NewsScheduler } from '../services/news-scheduler'

/** Registers every news.* IPC method. */
export function registerNewsFeature(news: NewsScheduler): void {
  handle('news.sources', () => ({ sources: news.sources() }))

  handle('news.addSource', ({ url }) => ({ source: news.addSource(url) }))

  handle('news.updateSource', ({ id, enabled }) => {
    news.updateSource(id, enabled)
    return { ok: true }
  })

  handle('news.removeSource', ({ id }) => {
    news.removeSource(id)
    return { ok: true }
  })

  handle('news.items', (input) => ({
    items: news.items({
      limit: input?.limit,
      query: input?.query,
      archived: input?.archived
    }),
    paused: news.paused()
  }))

  handle('news.archive', ({ id }) => {
    news.archive(id)
    return { ok: true }
  })

  handle('news.archiveAll', () => {
    news.archiveAll()
    return { ok: true }
  })

  handle('news.opened', () => {
    news.ensureFresh()
    return { ok: true }
  })

  handle('news.read', ({ itemId }) => ({ markdown: news.read(itemId) }))

  handle('news.markAllRead', () => {
    news.markAllRead()
    return { ok: true }
  })

  handle('news.refresh', async () => {
    await news.refresh()
    return { ok: true }
  })
}
