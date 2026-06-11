import { create } from 'zustand'
import type { WorkspaceEntry } from '@shared/types'
import { call, onEvent } from '@/lib/ipc'
import { pushToast } from '@/stores/toasts'

export interface OpenFile {
  /** Workspace-relative path, '/'-separated. */
  path: string
  content: string
  /** mtime of the last loaded/saved disk state — writeFile's expectedMtime guard. */
  savedMtime: number
  dirty: boolean
  /** Changed on disk under local edits (or a guarded write was refused). */
  conflict: boolean
}

/** A pending Cut/Copy from the file tree's context menu. */
export interface CodeClipboard {
  /** Workspace-relative source path. */
  path: string
  op: 'cut' | 'copy'
}

/** Which panel the left aside shows. */
export type AsideView = 'files' | 'changes' | 'history' | 'search'

export interface SearchHit {
  path: string
  line: number
  column: number
  preview: string
}

/** A side-by-side diff replacing the editor until closed. */
export interface DiffView {
  /** Workspace-relative file path the diff concerns. */
  path: string
  /** Header label, e.g. "staged" or a short commit hash. */
  label: string
  original: string
  modified: string
}

function parentDir(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

/** Prefix-remap after a move: `from` itself and anything under `from/` follow it. */
function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to
  return path.startsWith(from + '/') ? to + path.slice(from.length) : path
}

/** 'name.ts' → 'name copy.ts' → 'name copy 2.ts'; dirs/dotfiles suffix the whole name. */
function copyName(name: string, isDir: boolean, taken: Set<string>): string {
  const dot = isDir ? -1 : name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; ; n++) {
    const candidate = `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Open buffers (dirty/conflict state intact), the active path, and loaded-tree
 * state all follow a move — remapped expanded/childrenByDir keys keep an
 * expanded moved dir from rendering a stuck "Loading…". The stale row left in
 * the source's parent listing is corrected by the caller's loadDir refresh.
 */
function movedState(
  s: Pick<CodeStore, 'openFiles' | 'activePath' | 'childrenByDir' | 'expanded'>,
  from: string,
  to: string
): Pick<CodeStore, 'openFiles' | 'activePath' | 'childrenByDir' | 'expanded'> {
  const childrenByDir: Record<string, WorkspaceEntry[]> = {}
  for (const [dir, entries] of Object.entries(s.childrenByDir)) {
    const key = remapPath(dir, from, to)
    childrenByDir[key] =
      key === dir ? entries : entries.map((e) => ({ ...e, path: remapPath(e.path, from, to) }))
  }
  const expanded: Record<string, boolean> = {}
  for (const [dir, open] of Object.entries(s.expanded)) {
    expanded[remapPath(dir, from, to)] = open
  }
  return {
    openFiles: s.openFiles.map((f) => {
      const path = remapPath(f.path, from, to)
      return path === f.path ? f : { ...f, path }
    }),
    activePath: s.activePath === null ? null : remapPath(s.activePath, from, to),
    childrenByDir,
    expanded
  }
}

// Cmd+S is handled by both a monaco command and a DOM keydown fallback — the
// in-flight set absorbs the double fire so two writes never race one mtime.
const savingPaths = new Set<string>()

/** State with every trace of a removed path pruned (shared by trash + permanent delete). */
function stateWithoutPath(
  s: Pick<CodeStore, 'openFiles' | 'activePath' | 'childrenByDir' | 'expanded' | 'clipboard'>,
  path: string
): Pick<CodeStore, 'openFiles' | 'activePath' | 'childrenByDir' | 'expanded' | 'clipboard'> {
  const gone = (p: string): boolean => p === path || p.startsWith(path + '/')
  const activeIndex = s.openFiles.findIndex((f) => f.path === s.activePath)
  const openFiles = s.openFiles.filter((f) => !gone(f.path))
  const childrenByDir: Record<string, WorkspaceEntry[]> = {}
  for (const [dir, entries] of Object.entries(s.childrenByDir)) {
    if (!gone(dir)) childrenByDir[dir] = entries
  }
  const expanded = Object.fromEntries(Object.entries(s.expanded).filter(([dir]) => !gone(dir)))
  return {
    openFiles,
    activePath:
      s.activePath !== null && gone(s.activePath)
        ? (openFiles[Math.min(activeIndex, openFiles.length - 1)]?.path ?? null)
        : s.activePath,
    childrenByDir,
    expanded,
    clipboard: s.clipboard && gone(s.clipboard.path) ? null : s.clipboard
  }
}

interface CodeStore {
  /** Absolute path of the open workspace; null = empty state. */
  root: string | null
  /** Loaded listings keyed by workspace-relative dir ('' = the root level). */
  childrenByDir: Record<string, WorkspaceEntry[]>
  expanded: Record<string, boolean>
  openFiles: OpenFile[]
  activePath: string | null
  initialized: boolean
  init: () => Promise<void>
  /** Native folder picker -> openWorkspace. No-op when cancelled. */
  pickWorkspace: () => Promise<void>
  openWorkspace: (root: string) => Promise<void>
  closeWorkspace: () => Promise<void>
  toggleDir: (dir: string) => void
  loadDir: (dir: string) => Promise<void>
  openFile: (path: string, opts?: { line?: number }) => Promise<void>
  setActive: (path: string) => void
  edit: (path: string, content: string) => void
  /** overwrite skips the expectedMtime guard — the conflict bar's Overwrite. */
  save: (path: string, opts?: { overwrite?: boolean }) => Promise<void>
  reloadFromDisk: (path: string) => Promise<void>
  /** Drops the buffer without saving — callers confirm dirty closes first. */
  closeFile: (path: string) => void
  clipboard: CodeClipboard | null
  setClipboard: (path: string, op: 'cut' | 'copy') => void
  clearClipboard: () => void
  /** Creates dir/name ('' = root level), refreshes the listing, opens the file. */
  createFile: (dir: string, name: string) => Promise<void>
  createDir: (dir: string, name: string) => Promise<void>
  /** Move within the same parent; open buffers and tree state follow the new path. */
  renameEntry: (path: string, newName: string) => Promise<void>
  /** To the macOS Trash; buffers under the path close without a dirty confirm. */
  deleteEntry: (path: string) => Promise<void>
  /** Pastes the clipboard; sibling name clashes get ' copy' / ' copy N' names. */
  pasteInto: (dir: string) => Promise<void>
  /** code.copy next to the source with the next free ' copy' name. */
  duplicateEntry: (path: string) => Promise<void>
  reveal: (path: string) => Promise<void>
  asideView: AsideView
  setAsideView: (view: AsideView) => void
  /** File whose log the History panel shows; null = none picked yet. */
  historyPath: string | null
  openHistory: (path: string) => void
  /** Non-null replaces the editor with a side-by-side Monaco diff. */
  diffView: DiffView | null
  openDiff: (diff: DiffView) => void
  closeDiff: () => void
  /** PERMANENT delete (rm -rf) — callers confirm first. */
  deletePermanentEntry: (path: string) => Promise<void>
  openDefault: (path: string) => Promise<void>
  collapseAll: () => void
  // Terminal state lives here so the context menu can drive the pane.
  terminalOpen: boolean
  setTerminalOpen: (open: boolean) => void
  termId: string | null
  setTermId: (id: string | null) => void
  /** cd command queued for a pty that hasn't spawned yet. */
  pendingTermCommand: string | null
  consumePendingTermCommand: () => string | null
  /** Open the terminal pane and cd the live shell into the dir ('' = root). */
  openInTerminal: (dirPath: string) => Promise<void>
  // Find in Folder
  searchDir: string
  searchQuery: string
  searchResults: SearchHit[] | null
  searching: boolean
  openSearch: (dir: string) => void
  runSearch: (query: string) => Promise<void>
  /** Set when a search hit opens a file — EditorPane reveals then clears. */
  pendingReveal: { path: string; line: number } | null
  clearReveal: () => void
}

export const useCodeStore = create<CodeStore>((set, get) => ({
  root: null,
  childrenByDir: {},
  expanded: {},
  openFiles: [],
  activePath: null,
  initialized: false,
  clipboard: null,

  init: async () => {
    if (get().initialized) return
    set({ initialized: true })

    onEvent('code.fsChanged', (event) => {
      if (event.root !== get().root) return
      const dirs = new Set<string>()
      for (const path of event.paths) {
        dirs.add(parentDir(path))
        const file = get().openFiles.find((f) => f.path === path)
        if (!file) continue
        if (file.dirty) {
          // May be the echo of our own save — flag only if the disk actually
          // diverged from the last saved state (writeFile's +1ms tolerance).
          void call('code.readFile', { root: event.root, path })
            .then(({ mtime }) => {
              if (get().root !== event.root) return
              set((s) => ({
                openFiles: s.openFiles.map((f) =>
                  f.path === path && f.dirty && mtime > f.savedMtime + 1
                    ? { ...f, conflict: true }
                    : f
                )
              }))
            })
            .catch(() => {
              // Unreadable now (deleted/moved?) — surface the conflict bar.
              set((s) => ({
                openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, conflict: true } : f))
              }))
            })
        } else {
          // Clean buffers follow the disk silently; re-check dirty at apply
          // time in case an edit landed while the read was in flight.
          void call('code.readFile', { root: event.root, path })
            .then(({ content, mtime }) => {
              if (get().root !== event.root) return
              set((s) => ({
                openFiles: s.openFiles.map((f) =>
                  f.path === path && !f.dirty
                    ? { ...f, content, savedMtime: mtime, conflict: false }
                    : f
                )
              }))
            })
            .catch(() => {
              // Unreadable now (deleted/moved?) — surface the conflict bar.
              set((s) => ({
                openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, conflict: true } : f))
              }))
            })
        }
      }
      for (const dir of dirs) {
        if (!get().childrenByDir[dir]) continue // never loaded — nothing to refresh
        void call('code.listDir', { root: event.root, dir })
          .then(({ entries }) => {
            if (get().root !== event.root) return
            set((s) => ({ childrenByDir: { ...s.childrenByDir, [dir]: entries } }))
          })
          .catch(() => {
            // The dir itself is gone; its parent's refresh removes the row.
            // Also collapse it so a recreated dir re-expands with a fresh
            // loadDir instead of rendering a stuck "Loading…".
            set((s) => {
              const { [dir]: _c, ...childrenByDir } = s.childrenByDir
              const { [dir]: _e, ...expanded } = s.expanded
              return { childrenByDir, expanded }
            })
          })
      }
    })

    const { path } = await call('code.lastWorkspace')
    if (path && get().root === null) {
      // A stale last-workspace (moved/deleted) just lands on the empty state.
      await get()
        .openWorkspace(path)
        .catch(() => {})
    }
  },

  pickWorkspace: async () => {
    const { path } = await call('code.pickWorkspace')
    if (!path) return
    await get().openWorkspace(path)
  },

  openWorkspace: async (root) => {
    const prev = get().root
    const { entries } = await call('code.openWorkspace', { root })
    if (prev === root) {
      // Re-picked the same folder — just refresh the top level.
      set((s) => ({ childrenByDir: { ...s.childrenByDir, '': entries } }))
      return
    }
    // Open the new root first so a failed pick keeps the old workspace intact.
    if (prev) void call('code.closeWorkspace', { root: prev }).catch(() => {})
    set({
      root,
      childrenByDir: { '': entries },
      expanded: {},
      openFiles: [],
      activePath: null,
      clipboard: null,
      // Per-workspace feature state must not leak across the switch: a stale
      // diff/history/search would present workspace A's data as B's, and a
      // queued cd would steer B's fresh shell into A.
      asideView: 'files',
      historyPath: null,
      diffView: null,
      searchDir: '',
      searchQuery: '',
      searchResults: null,
      pendingReveal: null,
      pendingTermCommand: null
    })
  },

  closeWorkspace: async () => {
    const root = get().root
    if (!root) return
    set({
      root: null,
      childrenByDir: {},
      expanded: {},
      openFiles: [],
      activePath: null,
      clipboard: null,
      asideView: 'files',
      historyPath: null,
      diffView: null,
      searchDir: '',
      searchQuery: '',
      searchResults: null,
      pendingReveal: null,
      pendingTermCommand: null
    })
    await call('code.closeWorkspace', { root })
  },

  toggleDir: (dir) => {
    const expand = !get().expanded[dir]
    set((s) => ({ expanded: { ...s.expanded, [dir]: expand } }))
    if (expand && !get().childrenByDir[dir]) {
      void get()
        .loadDir(dir)
        .catch((err) =>
          pushToast('error', err instanceof Error ? err.message : String(err))
        )
    }
  },

  loadDir: async (dir) => {
    const root = get().root
    if (!root) return
    const { entries } = await call('code.listDir', { root, dir })
    if (get().root !== root) return
    set((s) => ({ childrenByDir: { ...s.childrenByDir, [dir]: entries } }))
  },

  openFile: async (path, opts) => {
    const reveal = opts?.line !== undefined ? { path, line: opts.line } : null
    if (get().openFiles.some((f) => f.path === path)) {
      set({ activePath: path, ...(reveal ? { pendingReveal: reveal } : {}) })
      return
    }
    const root = get().root
    if (!root) return
    const { content, mtime } = await call('code.readFile', { root, path })
    if (get().root !== root) return
    set((s) =>
      s.openFiles.some((f) => f.path === path)
        ? { activePath: path, ...(reveal ? { pendingReveal: reveal } : {}) } // double-click race
        : {
            openFiles: [
              ...s.openFiles,
              { path, content, savedMtime: mtime, dirty: false, conflict: false }
            ],
            activePath: path,
            ...(reveal ? { pendingReveal: reveal } : {})
          }
    )
  },

  setActive: (path) => {
    if (get().openFiles.some((f) => f.path === path)) set({ activePath: path })
  },

  edit: (path, content) => {
    set((s) => ({
      openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, content, dirty: true } : f))
    }))
  },

  save: async (path, opts) => {
    const root = get().root
    const file = get().openFiles.find((f) => f.path === path)
    if (!root || !file) return
    if (!file.dirty && !file.conflict) return
    if (savingPaths.has(path)) return
    savingPaths.add(path)
    try {
      const result = await call('code.writeFile', {
        root,
        path,
        content: file.content,
        expectedMtime: opts?.overwrite ? undefined : file.savedMtime
      })
      if (result.conflict) {
        set((s) => ({
          openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, conflict: true } : f))
        }))
        return
      }
      set((s) => ({
        openFiles: s.openFiles.map((f) =>
          f.path === path
            ? {
                ...f,
                // Edits that landed during the write keep the buffer dirty.
                dirty: f.content !== file.content,
                savedMtime: result.mtime ?? f.savedMtime,
                conflict: false
              }
            : f
        )
      }))
    } finally {
      savingPaths.delete(path)
    }
  },

  reloadFromDisk: async (path) => {
    const root = get().root
    if (!root) return
    const { content, mtime } = await call('code.readFile', { root, path })
    if (get().root !== root) return
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === path ? { ...f, content, savedMtime: mtime, dirty: false, conflict: false } : f
      )
    }))
  },

  closeFile: (path) => {
    set((s) => {
      const index = s.openFiles.findIndex((f) => f.path === path)
      if (index === -1) return {}
      const openFiles = s.openFiles.filter((f) => f.path !== path)
      return {
        openFiles,
        activePath:
          s.activePath === path
            ? (openFiles[Math.min(index, openFiles.length - 1)]?.path ?? null)
            : s.activePath
      }
    })
  },

  setClipboard: (path, op) => set({ clipboard: { path, op } }),

  clearClipboard: () => set({ clipboard: null }),

  // The fsChanged watcher re-lists the same dirs ~250ms after each mutation
  // below — the loadDir refreshes here are idempotent with that batch.
  createFile: async (dir, name) => {
    const root = get().root
    if (!root) return
    const path = dir ? `${dir}/${name}` : name
    await call('code.createFile', { root, path })
    if (get().root !== root) return
    await get().loadDir(dir)
    await get().openFile(path)
  },

  createDir: async (dir, name) => {
    const root = get().root
    if (!root) return
    const path = dir ? `${dir}/${name}` : name
    await call('code.createDir', { root, path })
    if (get().root !== root) return
    set((s) => ({ expanded: { ...s.expanded, [dir]: true } }))
    await get().loadDir(dir)
  },

  renameEntry: async (path, newName) => {
    const root = get().root
    if (!root) return
    const dir = parentDir(path)
    const to = dir ? `${dir}/${newName}` : newName
    if (to === path) return
    await call('code.move', { root, from: path, to })
    if (get().root !== root) return
    set((s) => movedState(s, path, to))
    await get().loadDir(dir)
  },

  deleteEntry: async (path) => {
    const root = get().root
    if (!root) return
    await call('code.delete', { root, path })
    if (get().root !== root) return
    // Trashed files are recoverable — buffers drop without a dirty confirm.
    set((s) => stateWithoutPath(s, path))
    await get().loadDir(parentDir(path))
  },

  pasteInto: async (dir) => {
    const root = get().root
    const clipboard = get().clipboard
    if (!root || !clipboard) return
    const source = clipboard.path
    if (dir === source || dir.startsWith(source + '/')) {
      throw new Error('Cannot paste a folder into itself')
    }
    // Cutting back into the source's own parent has nothing to move.
    if (clipboard.op === 'cut' && parentDir(source) === dir) {
      get().clearClipboard()
      return
    }
    if (!get().childrenByDir[dir]) await get().loadDir(dir)
    const siblings = new Set((get().childrenByDir[dir] ?? []).map((e) => e.name))
    const sourceKind = get().childrenByDir[parentDir(source)]?.find((e) => e.path === source)?.kind
    const base = baseName(source)
    const name = siblings.has(base) ? copyName(base, sourceKind === 'dir', siblings) : base
    const to = dir ? `${dir}/${name}` : name
    if (clipboard.op === 'cut') {
      await call('code.move', { root, from: source, to })
      if (get().root !== root) return
      set((s) => ({ ...movedState(s, source, to), clipboard: null }))
      await Promise.all([get().loadDir(parentDir(source)), get().loadDir(dir)])
    } else {
      // Clipboard kept — a copy pastes repeatedly.
      await call('code.copy', { root, from: source, to })
      if (get().root !== root) return
      await get().loadDir(dir)
    }
    set((s) => ({ expanded: { ...s.expanded, [dir]: true } }))
  },

  duplicateEntry: async (path) => {
    const root = get().root
    if (!root) return
    const dir = parentDir(path)
    if (!get().childrenByDir[dir]) await get().loadDir(dir)
    const entries = get().childrenByDir[dir] ?? []
    const siblings = new Set(entries.map((e) => e.name))
    const isDir = entries.find((e) => e.path === path)?.kind === 'dir'
    const name = copyName(baseName(path), isDir, siblings)
    await call('code.copy', { root, from: path, to: dir ? `${dir}/${name}` : name })
    if (get().root !== root) return
    await get().loadDir(dir)
  },

  reveal: async (path) => {
    const root = get().root
    if (!root) return
    await call('code.reveal', { root, path })
  },

  asideView: 'files',
  setAsideView: (view) => set({ asideView: view }),
  historyPath: null,
  openHistory: (path) => set({ asideView: 'history', historyPath: path }),
  diffView: null,
  openDiff: (diff) => set({ diffView: diff }),
  closeDiff: () => set({ diffView: null }),

  deletePermanentEntry: async (path) => {
    const root = get().root
    if (!root) return
    await call('code.deletePermanent', { root, path })
    if (get().root !== root) return
    set((s) => stateWithoutPath(s, path))
    await get().loadDir(parentDir(path))
  },

  openDefault: async (path) => {
    const root = get().root
    if (!root) return
    await call('code.openDefault', { root, path })
  },

  collapseAll: () => set({ expanded: {} }),

  terminalOpen: true,
  setTerminalOpen: (open) => set({ terminalOpen: open }),
  termId: null,
  setTermId: (id) => set({ termId: id }),
  pendingTermCommand: null,
  consumePendingTermCommand: () => {
    const command = get().pendingTermCommand
    if (command !== null) set({ pendingTermCommand: null })
    return command
  },

  openInTerminal: async (dirPath) => {
    const root = get().root
    if (!root) return
    const abs = dirPath ? `${root}/${dirPath}` : root
    const command = `cd '${abs.replaceAll("'", `'\\''`)}' && clear\n`
    set({ terminalOpen: true })
    const termId = get().termId
    if (termId) await call('term.write', { termId, data: command })
    else set({ pendingTermCommand: command }) // the pane writes it once the pty spawns
  },

  searchDir: '',
  searchQuery: '',
  searchResults: null,
  searching: false,

  openSearch: (dir) => set({ asideView: 'search', searchDir: dir, searchResults: null }),

  runSearch: async (query) => {
    const root = get().root
    if (!root) return
    const dir = get().searchDir
    set({ searchQuery: query, searching: true })
    try {
      if (!query.trim()) {
        set({ searchResults: null })
        return
      }
      const { results } = await call('code.search', { root, dir, query })
      // Drop stale responses (typed-ahead query or workspace switch).
      if (get().root === root && get().searchQuery === query) set({ searchResults: results })
    } finally {
      if (get().searchQuery === query) set({ searching: false })
    }
  },

  pendingReveal: null,
  clearReveal: () => set({ pendingReveal: null })
}))

/** Paste availability for menu builders that run outside a react subscription. */
export function hasClipboard(): boolean {
  return useCodeStore.getState().clipboard !== null
}
