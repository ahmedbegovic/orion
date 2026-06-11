import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import { ChevronRight } from 'lucide-react'
import type { WorkspaceEntry } from '@shared/types'
import { hasClipboard, useCodeStore, type AsideView } from '@/stores/code'
import { buildDecorations, useGitStore, type PathDecoration } from '@/stores/git'
import { pushToast, toastError } from '@/stores/toasts'
import ConfirmDialog from '@/components/ConfirmDialog'
import TreeContextMenu, { type MenuEntry } from './TreeContextMenu'
import ChangesPanel from './ChangesPanel'
import HistoryPanel from './HistoryPanel'
import SearchPanel from './SearchPanel'

const INDENT_PX = 12
const BASE_PAD_PX = 8
/** Chevron width + gap — keeps file names aligned with sibling dir names. */
const FILE_EXTRA_PAD_PX = 17

type Editing =
  | { kind: 'create'; entryKind: 'file' | 'dir'; dir: string }
  | { kind: 'rename'; path: string }

interface TreeUi {
  openMenu: (e: MouseEvent, entry: WorkspaceEntry | null) => void
  editing: Editing | null
  commitEditing: (name: string) => Promise<void>
  cancelEditing: () => void
  /** Git decorations: file color by state, dot for dirs with dirty descendants. */
  decorations: Map<string, PathDecoration>
  dirtyDirs: Set<string>
  /** Keyboard selection model (independent of the open file). */
  selectedPath: string | null
  select: (path: string) => void
}

const TreeUiContext = createContext<TreeUi>({
  openMenu: () => {},
  editing: null,
  commitEditing: async () => {},
  cancelEditing: () => {},
  decorations: new Map(),
  dirtyDirs: new Set(),
  selectedPath: null,
  select: () => {}
})

function parentDir(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** The rows the tree currently renders, in visual order — the arrow-key space. */
function visibleRows(
  childrenByDir: Record<string, WorkspaceEntry[]>,
  expanded: Record<string, boolean>
): WorkspaceEntry[] {
  const out: WorkspaceEntry[] = []
  const walk = (dir: string): void => {
    for (const entry of childrenByDir[dir] ?? []) {
      out.push(entry)
      if (entry.kind === 'dir' && expanded[entry.path]) walk(entry.path)
    }
  }
  walk('')
  return out
}

const DECORATION_CLASS: Record<Exclude<PathDecoration, null>, string> = {
  modified: 'text-amber-400',
  added: 'text-emerald-400'
}

function InlineNameInput({ initial }: { initial: string }) {
  const { commitEditing, cancelEditing } = useContext(TreeUiContext)
  // A successful Enter unmounts the input — the flag keeps the resulting blur
  // from firing a cancel over the commit.
  const committing = useRef(false)

  const commit = (input: HTMLInputElement): void => {
    const name = input.value.trim()
    if (!name) return
    if (name.includes('/')) {
      pushToast('error', 'Names cannot contain "/"')
      return
    }
    committing.current = true
    void commitEditing(name).catch((err) => {
      committing.current = false
      toastError(err) // input stays open for another attempt
    })
  }

  return (
    <input
      autoFocus
      defaultValue={initial}
      onContextMenu={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget)
        else if (e.key === 'Escape') cancelEditing()
      }}
      onBlur={() => {
        if (!committing.current) cancelEditing()
      }}
      className="w-full min-w-0 rounded-sm border border-emerald-600/70 bg-zinc-900 px-1 text-[12px] text-zinc-100 outline-none"
    />
  )
}

function TreeNode({ entry, depth }: { entry: WorkspaceEntry; depth: number }) {
  const { openMenu, editing, decorations, dirtyDirs, selectedPath, select } =
    useContext(TreeUiContext)
  const expanded = useCodeStore((s) => Boolean(s.expanded[entry.path]))
  const active = useCodeStore((s) => s.activePath === entry.path)
  const cutPending = useCodeStore(
    (s) => s.clipboard?.op === 'cut' && s.clipboard.path === entry.path
  )
  const toggleDir = useCodeStore((s) => s.toggleDir)
  const openFile = useCodeStore((s) => s.openFile)

  const renaming = editing?.kind === 'rename' && editing.path === entry.path
  const cutClass = cutPending ? ' opacity-40' : ''
  const selectedClass =
    selectedPath === entry.path ? ' ring-1 ring-inset ring-zinc-600/70 bg-zinc-900/70' : ''
  const decoration = decorations.get(entry.path) ?? null

  if (entry.kind === 'dir') {
    const dirty = dirtyDirs.has(entry.path)
    return (
      <>
        {renaming ? (
          <div
            style={{ paddingLeft: BASE_PAD_PX + depth * INDENT_PX }}
            className="flex items-center gap-1 py-[3px] pr-2"
          >
            <ChevronRight
              size={12}
              className={`shrink-0 text-zinc-600 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
            <InlineNameInput initial={entry.name} />
          </div>
        ) : (
          <button
            onClick={() => {
              select(entry.path)
              toggleDir(entry.path)
            }}
            onContextMenu={(e) => openMenu(e, entry)}
            title={entry.path}
            style={{ paddingLeft: BASE_PAD_PX + depth * INDENT_PX }}
            className={`flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[12px] text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200${cutClass}${selectedClass}`}
          >
            <ChevronRight
              size={12}
              className={`shrink-0 text-zinc-600 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
            <span className="truncate">{entry.name}</span>
            {dirty && (
              <span
                title="Contains changes"
                className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/70"
              />
            )}
          </button>
        )}
        {expanded && <TreeLevel dir={entry.path} depth={depth + 1} />}
      </>
    )
  }
  if (renaming) {
    return (
      <div
        style={{ paddingLeft: BASE_PAD_PX + FILE_EXTRA_PAD_PX + depth * INDENT_PX }}
        className="py-[3px] pr-2"
      >
        <InlineNameInput initial={entry.name} />
      </div>
    )
  }
  const fileColor = decoration
    ? DECORATION_CLASS[decoration]
    : 'text-zinc-400 hover:text-zinc-200'
  return (
    <button
      onClick={() => {
        select(entry.path)
        void openFile(entry.path).catch(toastError)
      }}
      onContextMenu={(e) => openMenu(e, entry)}
      title={entry.path}
      style={{ paddingLeft: BASE_PAD_PX + FILE_EXTRA_PAD_PX + depth * INDENT_PX }}
      className={`flex w-full items-center py-[3px] pr-2 text-left text-[12px] ${
        active ? `bg-zinc-800 ${decoration ? DECORATION_CLASS[decoration] : 'text-zinc-100'}` : `${fileColor} hover:bg-zinc-900`
      }${cutClass}${selectedClass}`}
    >
      <span className="truncate">{entry.name}</span>
    </button>
  )
}

function TreeLevel({ dir, depth }: { dir: string; depth: number }) {
  const entries = useCodeStore((s) => s.childrenByDir[dir])
  const { editing } = useContext(TreeUiContext)
  const creating = editing?.kind === 'create' && editing.dir === dir
  if (!entries)
    return (
      <div
        style={{ paddingLeft: BASE_PAD_PX + FILE_EXTRA_PAD_PX + depth * INDENT_PX }}
        className="py-[3px] text-[11px] text-zinc-600"
      >
        Loading…
      </div>
    )
  if (entries.length === 0 && depth > 0 && !creating)
    return (
      <div
        style={{ paddingLeft: BASE_PAD_PX + FILE_EXTRA_PAD_PX + depth * INDENT_PX }}
        className="py-[3px] text-[11px] italic text-zinc-700"
      >
        empty
      </div>
    )
  return (
    <>
      {creating && (
        <div
          style={{ paddingLeft: BASE_PAD_PX + FILE_EXTRA_PAD_PX + depth * INDENT_PX }}
          className="py-[3px] pr-2"
        >
          <InlineNameInput initial="" />
        </div>
      )}
      {entries.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={depth} />
      ))}
    </>
  )
}

export default function FileTree() {
  const [menu, setMenu] = useState<{ x: number; y: number; entry: WorkspaceEntry | null } | null>(
    null
  )
  const [editing, setEditing] = useState<Editing | null>(null)
  const [trashTarget, setTrashTarget] = useState<WorkspaceEntry | null>(null)
  const root = useCodeStore((s) => s.root)
  const asideView = useCodeStore((s) => s.asideView)
  const setAsideView = useCodeStore((s) => s.setAsideView)
  const openHistory = useCodeStore((s) => s.openHistory)
  const historyPath = useCodeStore((s) => s.historyPath)
  const gitStatus = useGitStore((s) => (root ? s.statusByRoot[root] : undefined))
  const { byPath: decorations, dirtyDirs } = useMemo(
    () => buildDecorations(gitStatus),
    [gitStatus]
  )
  const changeCount = gitStatus?.repo ? gitStatus.files.length : 0

  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [permanentTarget, setPermanentTarget] = useState<WorkspaceEntry | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)

  const openMenu = (e: MouseEvent, entry: WorkspaceEntry | null): void => {
    e.preventDefault()
    e.stopPropagation() // row menus beat the container's root-context handler
    if (entry) setSelectedPath(entry.path)
    setMenu({ x: e.clientX, y: e.clientY, entry })
  }

  const commitEditing = async (name: string): Promise<void> => {
    if (!editing) return
    const s = useCodeStore.getState()
    if (editing.kind === 'rename') await s.renameEntry(editing.path, name)
    else if (editing.entryKind === 'file') await s.createFile(editing.dir, name)
    else await s.createDir(editing.dir, name)
    setEditing(null)
  }

  const startCreate = (entryKind: 'file' | 'dir', dir: string): void => {
    const s = useCodeStore.getState()
    if (dir && !s.expanded[dir]) s.toggleDir(dir) // the input renders inside the level
    setEditing({ kind: 'create', entryKind, dir })
  }

  const deleteToTrash = (entry: WorkspaceEntry): void => {
    void useCodeStore
      .getState()
      .deleteEntry(entry.path)
      .then(() => pushToast('info', 'Moved to Trash'))
      .catch(toastError)
  }

  // Exact structure (order, separators, shortcuts) from the PDF screenshot.
  const itemsFor = (entry: WorkspaceEntry | null): MenuEntry[] => {
    const s = useCodeStore.getState()
    const repo = gitStatus?.repo ?? false
    if (!entry) {
      return [
        { label: 'New File…', shortcut: '⌘N', onClick: () => startCreate('file', '') },
        { label: 'New Folder…', shortcut: '⌥⌘N', onClick: () => startCreate('dir', '') },
        'separator',
        {
          label: 'Reveal in Finder',
          shortcut: '⌥⌘R',
          onClick: () => void s.reveal('').catch(toastError)
        },
        { label: 'Open in Terminal', onClick: () => void s.openInTerminal('').catch(toastError) },
        'separator',
        { label: 'Find in Folder…', shortcut: '⌥⌘⇧F', onClick: () => s.openSearch('') },
        'separator',
        {
          label: 'Paste',
          shortcut: '⌘V',
          disabled: !hasClipboard(),
          onClick: () => void s.pasteInto('').catch(toastError)
        },
        'separator',
        { label: 'Collapse All', onClick: () => s.collapseAll() }
      ]
    }
    const isDir = entry.kind === 'dir'
    // New/Find/Paste/Terminal target the dir itself, or a file's parent.
    const containerDir = isDir ? entry.path : parentDir(entry.path)
    return [
      { label: 'New File…', shortcut: '⌘N', onClick: () => startCreate('file', containerDir) },
      { label: 'New Folder…', shortcut: '⌥⌘N', onClick: () => startCreate('dir', containerDir) },
      'separator',
      {
        label: 'Reveal in Finder',
        shortcut: '⌥⌘R',
        onClick: () => void s.reveal(entry.path).catch(toastError)
      },
      {
        label: 'Open in Default App',
        shortcut: '⌃⇧↵',
        onClick: () => void s.openDefault(entry.path).catch(toastError)
      },
      {
        label: 'Open in Terminal',
        onClick: () => void s.openInTerminal(containerDir).catch(toastError)
      },
      'separator',
      { label: 'Find in Folder…', shortcut: '⌥⌘⇧F', onClick: () => s.openSearch(containerDir) },
      'separator',
      { label: 'Cut', shortcut: '⌘X', onClick: () => s.setClipboard(entry.path, 'cut') },
      { label: 'Copy', shortcut: '⌘C', onClick: () => s.setClipboard(entry.path, 'copy') },
      {
        label: 'Duplicate',
        shortcut: '⌘D',
        onClick: () => void s.duplicateEntry(entry.path).catch(toastError)
      },
      {
        label: 'Paste',
        shortcut: '⌘V',
        disabled: !hasClipboard(),
        onClick: () => void s.pasteInto(containerDir).catch(toastError)
      },
      'separator',
      {
        // Absolute path — Copy Relative Path below carries the old behavior.
        label: 'Copy Path',
        shortcut: '⌥⌘C',
        onClick: () => void navigator.clipboard.writeText(`${s.root}/${entry.path}`)
      },
      {
        label: 'Copy Relative Path',
        shortcut: '⌥⌘⇧C',
        onClick: () => void navigator.clipboard.writeText(entry.path)
      },
      ...(repo
        ? ([
            'separator',
            {
              label: 'Add to .gitignore',
              onClick: () => {
                const root = s.root
                if (root)
                  void useGitStore
                    .getState()
                    .ignoreAdd(root, `/${entry.path}`)
                    .then(() => pushToast('info', `Added /${entry.path} to .gitignore`))
                    .catch(toastError)
              }
            },
            ...(!isDir
              ? ([{ label: 'View History', onClick: () => openHistory(entry.path) }] satisfies MenuEntry[])
              : [])
          ] satisfies MenuEntry[])
        : []),
      'separator',
      {
        label: 'Rename…',
        shortcut: 'F2',
        onClick: () => setEditing({ kind: 'rename', path: entry.path })
      },
      {
        label: 'Trash',
        shortcut: '⌫',
        danger: true,
        onClick: () => (isDir ? setTrashTarget(entry) : deleteToTrash(entry))
      },
      {
        label: 'Delete',
        shortcut: '⌥⌘⌫',
        danger: true,
        onClick: () => setPermanentTarget(entry)
      },
      'separator',
      { label: 'Collapse All', onClick: () => s.collapseAll() }
    ]
  }

  /** Keyboard model over the visible rows; the tree div has tabIndex=0. */
  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Inline rename/create inputs own their keys.
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    const s = useCodeStore.getState()
    const rows = visibleRows(s.childrenByDir, s.expanded)
    const index = selectedPath ? rows.findIndex((r) => r.path === selectedPath) : -1
    const entry = index >= 0 ? rows[index] : null
    const meta = e.metaKey || e.ctrlKey
    const containerDir =
      entry === null ? '' : entry.kind === 'dir' ? entry.path : parentDir(entry.path)

    const moveTo = (i: number): void => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, i))]
      if (next) setSelectedPath(next.path)
    }

    const handled = (): void => {
      e.preventDefault()
      e.stopPropagation()
    }

    if (e.key === 'ArrowDown') {
      handled()
      moveTo(index === -1 ? 0 : index + 1)
    } else if (e.key === 'ArrowUp') {
      handled()
      moveTo(index === -1 ? rows.length - 1 : index - 1)
    } else if (e.key === 'ArrowRight' && entry?.kind === 'dir') {
      handled()
      if (!s.expanded[entry.path]) s.toggleDir(entry.path)
    } else if (e.key === 'ArrowLeft' && entry) {
      handled()
      if (entry.kind === 'dir' && s.expanded[entry.path]) s.toggleDir(entry.path)
      else if (parentDir(entry.path)) setSelectedPath(parentDir(entry.path))
    } else if (e.key === 'Enter' && entry && !meta) {
      handled()
      if (entry.kind === 'dir') s.toggleDir(entry.path)
      else void s.openFile(entry.path).catch(toastError)
    } else if (e.key === 'F2' && entry) {
      handled()
      setEditing({ kind: 'rename', path: entry.path })
    } else if (e.key === 'Backspace' && entry && e.altKey && meta) {
      handled()
      setPermanentTarget(entry)
    } else if (e.key === 'Backspace' && entry) {
      handled()
      if (entry.kind === 'dir') setTrashTarget(entry)
      else deleteToTrash(entry)
    } else if (meta && e.key.toLowerCase() === 'x' && entry) {
      handled()
      s.setClipboard(entry.path, 'cut')
    } else if (meta && e.key.toLowerCase() === 'c' && entry) {
      handled()
      s.setClipboard(entry.path, 'copy')
    } else if (meta && e.key.toLowerCase() === 'v') {
      handled()
      void s.pasteInto(containerDir).catch(toastError)
    } else if (meta && e.key.toLowerCase() === 'd' && entry) {
      handled()
      void s.duplicateEntry(entry.path).catch(toastError)
    } else if (meta && e.key.toLowerCase() === 'n') {
      handled()
      startCreate(e.altKey ? 'dir' : 'file', containerDir)
    }
  }

  const ui: TreeUi = {
    openMenu,
    editing,
    commitEditing,
    cancelEditing: () => setEditing(null),
    decorations,
    dirtyDirs,
    selectedPath,
    select: setSelectedPath
  }

  const tabs: Array<{ id: AsideView; label: string }> = [
    { id: 'files', label: 'Files' },
    { id: 'changes', label: changeCount > 0 ? `Changes · ${changeCount}` : 'Changes' },
    ...(historyPath !== null ? [{ id: 'history' as const, label: 'History' }] : []),
    ...(asideView === 'search' ? [{ id: 'search' as const, label: 'Search' }] : [])
  ]

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950/50">
      {/* In-band header: h-12 row shares the hiddenInset titlebar band and drags the window. */}
      <div className="drag-region flex h-12 shrink-0 items-center gap-1 px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setAsideView(tab.id)}
            className={`no-drag rounded-md px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider ${
              asideView === tab.id
                ? 'bg-zinc-800 text-zinc-200'
                : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {asideView === 'changes' ? (
        <ChangesPanel />
      ) : asideView === 'history' ? (
        <HistoryPanel />
      ) : asideView === 'search' ? (
        <SearchPanel />
      ) : (
        <div
          ref={treeRef}
          tabIndex={0}
          onKeyDown={onTreeKeyDown}
          className="no-drag min-h-0 flex-1 overflow-y-auto pb-2 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-zinc-700/60"
          onContextMenu={(e) => openMenu(e, null)}
        >
          <TreeUiContext.Provider value={ui}>
            <TreeLevel dir="" depth={0} />
          </TreeUiContext.Provider>
        </div>
      )}
      {menu && (
        <TreeContextMenu
          x={menu.x}
          y={menu.y}
          items={itemsFor(menu.entry)}
          onClose={() => setMenu(null)}
        />
      )}
      <ConfirmDialog
        open={trashTarget !== null}
        title="Move to Trash?"
        body={`The folder "${trashTarget?.name ?? ''}" and everything inside it will move to the Trash.`}
        confirmLabel="Move to Trash"
        danger
        onConfirm={() => {
          if (trashTarget) deleteToTrash(trashTarget)
          setTrashTarget(null)
        }}
        onCancel={() => setTrashTarget(null)}
      />
      <ConfirmDialog
        open={permanentTarget !== null}
        title="Delete permanently?"
        body={`"${permanentTarget?.path ?? ''}" is deleted in place — NOT moved to the Trash. This cannot be undone.`}
        confirmLabel="Delete permanently"
        danger
        onConfirm={() => {
          if (permanentTarget) {
            void useCodeStore
              .getState()
              .deletePermanentEntry(permanentTarget.path)
              .catch(toastError)
          }
          setPermanentTarget(null)
        }}
        onCancel={() => setPermanentTarget(null)}
      />
    </aside>
  )
}
