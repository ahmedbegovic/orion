import { create } from 'zustand'
import type { NewsItem, NewsSource } from '@shared/types'
import { call, onEvent } from '@/lib/ipc'

interface NewsStore {
  sources: NewsSource[]
  /** Unread first, newest first — ordering is main's. */
  items: NewsItem[]
  /** True while the ultra model is loaded; summaries wait as pending_summary. */
  paused: boolean
  selectedItemId: string | null
  /** Snapshot of the open item — survives the item dropping out of the 200-item window. */
  selectedItem: NewsItem | null
  /** Extracted article markdown per opened item; null = no body extracted. */
  readerMarkdown: Record<string, string | null>
  /** Manual feed refresh in flight (header spinner). */
  refreshing: boolean
  /** Header search — items refetch with it as a LIKE filter. */
  query: string
  /** True = browsing the archive instead of the live list. */
  showArchived: boolean
  initialized: boolean
  init: () => Promise<void>
  /** Authoritative re-pull of items + sources (also the news.updated handler). */
  refresh: () => Promise<void>
  addSource: (url: string) => Promise<void>
  updateSource: (id: string, enabled: boolean) => Promise<void>
  removeSource: (id: string) => Promise<void>
  /** Open the reader: cache the article body and mark the item read. */
  open: (itemId: string) => Promise<void>
  /** Back to the grid. */
  close: () => void
  markAllRead: () => Promise<void>
  /** Kick a manual fetch cycle across all enabled sources. */
  refreshFeeds: () => Promise<void>
  /** The tab became visible — main fetches if the last cycle is stale. */
  opened: () => Promise<void>
  setQuery: (query: string) => Promise<void>
  setShowArchived: (show: boolean) => Promise<void>
  archive: (id: string) => Promise<void>
  archiveAll: () => Promise<void>
}

export const useNewsStore = create<NewsStore>((set, get) => ({
  sources: [],
  items: [],
  paused: false,
  selectedItemId: null,
  selectedItem: null,
  readerMarkdown: {},
  refreshing: false,
  query: '',
  showArchived: false,
  initialized: false,

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })
    // Fetch cycles, summaries and reads all collapse into one signal — refetch both lists.
    onEvent('news.updated', () => {
      void get()
        .refresh()
        .catch(() => {})
    })
    // paused mirrors the ultra model's load state — keep the badge fresh across model swaps.
    onEvent('models.statusChanged', () => {
      void get()
        .refresh()
        .catch(() => {})
    })
    await get().refresh()
  },

  refresh: async () => {
    const { query, showArchived } = get()
    const [{ items, paused }, { sources }] = await Promise.all([
      call('news.items', { query: query || undefined, archived: showArchived || undefined }),
      call('news.sources')
    ])
    set((s) => {
      // Drop stale null bodies once extraction has moved on — the next open refetches.
      let readerMarkdown = s.readerMarkdown
      for (const item of items) {
        if (
          readerMarkdown[item.id] === null &&
          item.status !== 'new' &&
          item.status !== 'extracting'
        ) {
          if (readerMarkdown === s.readerMarkdown) readerMarkdown = { ...readerMarkdown }
          delete readerMarkdown[item.id]
        }
      }
      return {
        items,
        paused,
        sources,
        readerMarkdown,
        // Re-resolve the open item; keep the snapshot if it fell out of the 200-item window.
        selectedItem:
          s.selectedItemId !== null
            ? (items.find((i) => i.id === s.selectedItemId) ?? s.selectedItem)
            : null
      }
    })
  },

  addSource: async (url) => {
    const { source } = await call('news.addSource', { url })
    set((s) => ({ sources: [...s.sources, source] }))
  },

  updateSource: async (id, enabled) => {
    await call('news.updateSource', { id, enabled })
    set((s) => ({ sources: s.sources.map((src) => (src.id === id ? { ...src, enabled } : src)) }))
  },

  removeSource: async (id) => {
    await call('news.removeSource', { id })
    set((s) => ({
      sources: s.sources.filter((src) => src.id !== id),
      items: s.items.filter((item) => item.sourceId !== id),
      // The open reader can belong to the removed source — fall back to the grid.
      selectedItemId: s.selectedItem?.sourceId === id ? null : s.selectedItemId,
      selectedItem: s.selectedItem?.sourceId === id ? null : s.selectedItem
    }))
  },

  open: async (itemId) => {
    // Mark read optimistically — news.read persists it and the next refresh confirms.
    const now = Date.now()
    set((s) => {
      const items = s.items.map((i) =>
        i.id === itemId && i.readAt === null ? { ...i, readAt: now } : i
      )
      return {
        selectedItemId: itemId,
        selectedItem: items.find((i) => i.id === itemId) ?? s.selectedItem,
        items
      }
    })
    // Only a cached string body is authoritative — a null entry gets refetched on reopen.
    if (typeof get().readerMarkdown[itemId] === 'string') return
    const { markdown } = await call('news.read', { itemId })
    // No body for an item still pre-extraction means "not extracted yet" — don't cache it.
    const status = get().items.find((i) => i.id === itemId)?.status
    if (markdown === null && (status === 'new' || status === 'extracting')) return
    set((s) => ({ readerMarkdown: { ...s.readerMarkdown, [itemId]: markdown } }))
  },

  close: () => set({ selectedItemId: null, selectedItem: null }),

  markAllRead: async () => {
    await call('news.markAllRead')
    const now = Date.now()
    set((s) => ({ items: s.items.map((i) => (i.readAt === null ? { ...i, readAt: now } : i)) }))
  },

  refreshFeeds: async () => {
    if (get().refreshing) return
    set({ refreshing: true })
    try {
      // Resolves once the cycle is kicked off; items land via news.updated events.
      await call('news.refresh')
      await get().refresh()
    } finally {
      set({ refreshing: false })
    }
  },

  opened: async () => {
    // Fire-and-forget: a stale cycle fetches and lands via news.updated.
    await call('news.opened')
  },

  setQuery: async (query) => {
    set({ query })
    await get().refresh()
  },

  setShowArchived: async (show) => {
    set({ showArchived: show, selectedItemId: null, selectedItem: null })
    await get().refresh()
  },

  archive: async (id) => {
    // Optimistic: the card disappears immediately; news.updated confirms.
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      selectedItemId: s.selectedItemId === id ? null : s.selectedItemId,
      selectedItem: s.selectedItem?.id === id ? null : s.selectedItem
    }))
    await call('news.archive', { id })
  },

  archiveAll: async () => {
    await call('news.archiveAll')
    await get().refresh()
  }
}))
