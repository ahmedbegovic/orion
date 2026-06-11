import { create } from 'zustand'
import type { GitStatus } from '@shared/types'
import { call, onEvent } from '@/lib/ipc'
import { useCodeStore } from '@/stores/code'

/** fsChanged batches arrive every 250ms during busy writes — slow git down a bit. */
const FS_REFRESH_DEBOUNCE_MS = 500

interface GitStore {
  /** Latest status per workspace root (absolute path key, same as code store). */
  statusByRoot: Record<string, GitStatus>
  initialized: boolean
  init: () => void
  refresh: (root: string) => Promise<void>
  stage: (root: string, paths: string[]) => Promise<void>
  unstage: (root: string, paths: string[]) => Promise<void>
  discard: (root: string, paths: string[]) => Promise<void>
  commit: (root: string, message: string) => Promise<void>
  initRepo: (root: string) => Promise<void>
  ignoreAdd: (root: string, pattern: string) => Promise<void>
}

let fsDebounce: ReturnType<typeof setTimeout> | null = null

// Two refreshes for one root can be in flight at once (mutation burst, focus
// racing git.changed) — only the NEWEST response may land, or a stale status
// snapshot overwrites the fresh one.
const refreshEpochs = new Map<string, number>()

export const useGitStore = create<GitStore>((set, get) => ({
  statusByRoot: {},
  initialized: false,

  init: () => {
    if (get().initialized) return
    set({ initialized: true })

    // Three refresh triggers: our own mutations (git.changed), workspace file
    // writes (fsChanged, debounced), and window focus — `.git` sits in
    // chokidar's ignore list, so terminal-made commits never emit fs events.
    onEvent('git.changed', (event) => {
      void get()
        .refresh(event.root)
        .catch(() => {})
    })
    onEvent('code.fsChanged', (event) => {
      if (!(event.root in get().statusByRoot)) return
      if (fsDebounce) clearTimeout(fsDebounce)
      fsDebounce = setTimeout(() => {
        fsDebounce = null
        void get()
          .refresh(event.root)
          .catch(() => {})
      }, FS_REFRESH_DEBOUNCE_MS)
    })
    window.addEventListener('focus', () => {
      const root = useCodeStore.getState().root
      if (root && root in get().statusByRoot) {
        void get()
          .refresh(root)
          .catch(() => {})
      }
    })
  },

  refresh: async (root) => {
    const epoch = (refreshEpochs.get(root) ?? 0) + 1
    refreshEpochs.set(root, epoch)
    const status = await call('git.status', { root })
    if (refreshEpochs.get(root) !== epoch) return // a newer refresh superseded this one
    set((s) => ({ statusByRoot: { ...s.statusByRoot, [root]: status } }))
  },

  stage: async (root, paths) => {
    await call('git.stage', { root, paths }) // git.changed refreshes
  },

  unstage: async (root, paths) => {
    await call('git.unstage', { root, paths })
  },

  discard: async (root, paths) => {
    await call('git.discard', { root, paths })
  },

  commit: async (root, message) => {
    await call('git.commit', { root, message })
  },

  initRepo: async (root) => {
    await call('git.init', { root })
  },

  ignoreAdd: async (root, pattern) => {
    await call('git.ignoreAdd', { root, pattern })
  }
}))

export type PathDecoration = 'modified' | 'added' | null

/**
 * Tree decoration maps from one status: file color by state plus a dot for
 * dirs with dirty descendants (path-prefix walk; status lists stay small).
 */
export function buildDecorations(status: GitStatus | undefined): {
  byPath: Map<string, PathDecoration>
  dirtyDirs: Set<string>
} {
  const byPath = new Map<string, PathDecoration>()
  const dirtyDirs = new Set<string>()
  if (!status?.repo) return { byPath, dirtyDirs }
  for (const file of status.files) {
    const added = file.untracked || file.indexState === 'A'
    // Defensive trailing-slash strip (status runs -uall, but older snapshots
    // could carry collapsed 'dir/' untracked entries).
    byPath.set(file.path.replace(/\/$/, ''), added ? 'added' : 'modified')
    let dir = file.path
    for (;;) {
      const slash = dir.lastIndexOf('/')
      if (slash === -1) break
      dir = dir.slice(0, slash)
      dirtyDirs.add(dir)
    }
  }
  return { byPath, dirtyDirs }
}
