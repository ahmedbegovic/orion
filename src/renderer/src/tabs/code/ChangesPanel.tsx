import { useEffect, useState } from 'react'
import { GitCommitHorizontal, Minus, Plus, Undo2 } from 'lucide-react'
import type { GitFileStatus } from '@shared/types'
import { call } from '@/lib/ipc'
import { useCodeStore } from '@/stores/code'
import { useGitStore } from '@/stores/git'
import { pushToast, toastError } from '@/stores/toasts'
import ConfirmDialog from '@/components/ConfirmDialog'

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

function dirName(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/** One-letter porcelain state for the row badge. */
function badge(file: GitFileStatus, staged: boolean): string {
  if (file.untracked) return 'U'
  const state = staged ? file.indexState : file.worktreeState
  return state === '.' ? '' : state
}

function Row({
  file,
  staged,
  onOpenDiff,
  actions
}: {
  file: GitFileStatus
  staged: boolean
  onOpenDiff: () => void
  actions: Array<{ icon: typeof Plus; title: string; onClick: () => void }>
}) {
  return (
    <div className="group flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-zinc-900">
      <button onClick={onOpenDiff} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <span className="min-w-0 truncate text-[12px] text-zinc-300">{baseName(file.path)}</span>
        {dirName(file.path) && (
          <span className="min-w-0 truncate text-[10.5px] text-zinc-600">{dirName(file.path)}</span>
        )}
      </button>
      <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        {actions.map(({ icon: Icon, title, onClick }) => (
          <button
            key={title}
            onClick={onClick}
            title={title}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200"
          >
            <Icon size={12} />
          </button>
        ))}
      </div>
      <span className="w-3 shrink-0 text-center text-[10px] font-semibold text-amber-400/80">
        {badge(file, staged)}
      </span>
    </div>
  )
}

/** Staged/unstaged groups with stage/unstage/discard, diffs and the commit box. */
export default function ChangesPanel() {
  const root = useCodeStore((s) => s.root)
  const openDiff = useCodeStore((s) => s.openDiff)
  const status = useGitStore((s) => (root ? s.statusByRoot[root] : undefined))
  const refresh = useGitStore((s) => s.refresh)
  const stage = useGitStore((s) => s.stage)
  const unstage = useGitStore((s) => s.unstage)
  const discard = useGitStore((s) => s.discard)
  const commit = useGitStore((s) => s.commit)
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [discardTarget, setDiscardTarget] = useState<GitFileStatus | null>(null)

  useEffect(() => {
    if (root) void refresh(root).catch(() => {})
  }, [root, refresh])

  if (!root) return null
  if (!status?.repo) {
    return (
      <p className="px-3 py-3 text-[11.5px] leading-relaxed text-zinc-600">
        This workspace is not a git repository.
      </p>
    )
  }

  const staged = status.files.filter((f) => !f.untracked && f.indexState !== '.')
  const unstaged = status.files.filter((f) => f.untracked || f.worktreeState !== '.')

  const showDiff = (file: GitFileStatus, fromStaged: boolean): void => {
    void call('git.diffFile', { root, path: file.path, staged: fromStaged })
      .then(({ original, modified }) =>
        openDiff({ path: file.path, label: fromStaged ? 'staged' : 'changes', original, modified })
      )
      .catch(toastError)
  }

  const onCommit = (): void => {
    const trimmed = message.trim()
    if (committing || !trimmed || staged.length === 0) return
    setCommitting(true)
    void commit(root, trimmed)
      .then(() => {
        setMessage('')
        pushToast('info', 'Committed')
      })
      .catch(toastError)
      .finally(() => setCommitting(false))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
          Staged · {staged.length}
        </p>
        {staged.length === 0 && (
          <p className="px-2 text-[11px] text-zinc-700">Nothing staged.</p>
        )}
        {staged.map((file) => (
          <Row
            key={`s-${file.path}`}
            file={file}
            staged
            onOpenDiff={() => showDiff(file, true)}
            actions={[
              {
                icon: Minus,
                title: 'Unstage',
                onClick: () => void unstage(root, [file.path]).catch(toastError)
              }
            ]}
          />
        ))}

        <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
          Changes · {unstaged.length}
        </p>
        {unstaged.length === 0 && <p className="px-2 text-[11px] text-zinc-700">Clean.</p>}
        {unstaged.map((file) => (
          <Row
            key={`u-${file.path}`}
            file={file}
            staged={false}
            onOpenDiff={() => showDiff(file, false)}
            actions={[
              {
                icon: Plus,
                title: 'Stage',
                onClick: () => void stage(root, [file.path]).catch(toastError)
              },
              {
                icon: Undo2,
                title: file.untracked ? 'Move to Trash' : 'Discard changes',
                onClick: () => setDiscardTarget(file)
              }
            ]}
          />
        ))}
      </div>

      <div className="shrink-0 border-t border-zinc-800/80 p-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onCommit()
            }
          }}
          rows={2}
          placeholder="Commit message… (⌘Enter)"
          spellCheck={false}
          className="block w-full resize-none rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-[12px] leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
        />
        <button
          onClick={onCommit}
          disabled={committing || !message.trim() || staged.length === 0}
          className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 py-1.5 text-[12px] font-medium text-white enabled:hover:bg-emerald-500 disabled:opacity-40"
        >
          <GitCommitHorizontal size={13} />
          Commit {staged.length > 0 ? `${staged.length} staged` : ''}
        </button>
      </div>

      <ConfirmDialog
        open={discardTarget !== null}
        title={discardTarget?.untracked ? 'Move to Trash?' : 'Discard changes?'}
        body={
          discardTarget?.untracked
            ? `"${discardTarget.path}" is untracked — it moves to the macOS Trash (recoverable).`
            : `Local changes to "${discardTarget?.path ?? ''}" are restored from the index. This cannot be undone.`
        }
        confirmLabel={discardTarget?.untracked ? 'Move to Trash' : 'Discard'}
        danger
        onConfirm={() => {
          if (discardTarget) void discard(root, [discardTarget.path]).catch(toastError)
          setDiscardTarget(null)
        }}
        onCancel={() => setDiscardTarget(null)}
      />
    </div>
  )
}
