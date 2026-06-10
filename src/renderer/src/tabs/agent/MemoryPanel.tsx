import { useEffect, useState } from 'react'
import { FileText, Plus, Trash2 } from 'lucide-react'
import { useAgentStore } from '@/stores/agent'
import { pushToast, toastError } from '@/stores/toasts'
import { relativeTime } from '@/lib/format'
import ConfirmDialog from '@/components/ConfirmDialog'
import Modal from '../chat/Modal'

interface Props {
  open: boolean
  onClose: () => void
}

export default function MemoryPanel({ open, onClose }: Props) {
  const files = useAgentStore((s) => s.memoryFiles)
  const refreshMemory = useAgentStore((s) => s.refreshMemory)
  const readMemory = useAgentStore((s) => s.readMemory)
  const writeMemory = useAgentStore((s) => s.writeMemory)

  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) void refreshMemory().catch(toastError)
  }, [open, refreshMemory])

  const openFile = (name: string): void => {
    setSelected(name)
    setContent('')
    void readMemory(name).then(setContent).catch(toastError)
  }

  const save = (): void => {
    if (!selected || saving) return
    // memory.write with empty content deletes the file — route through the confirm.
    if (!content.trim()) {
      setConfirmDelete(true)
      return
    }
    setSaving(true)
    void writeMemory(selected, content)
      .then(() => pushToast('info', `Saved ${selected}`))
      .catch(toastError)
      .finally(() => setSaving(false))
  }

  const deleteSelected = (): void => {
    setConfirmDelete(false)
    if (!selected) return
    const name = selected
    setSelected(null)
    setContent('')
    void writeMemory(name, '').catch(toastError)
  }

  const createFile = (): void => {
    const trimmed = newName.trim()
    if (!trimmed) return
    // Only *.md files are auto-loaded into agent sessions.
    const name = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`
    // Same pattern main enforces — fail here with a friendlier message.
    if (!/^[\w.-]+\.md$/.test(name)) {
      pushToast('error', 'File names may only use letters, digits, dots, dashes and underscores')
      return
    }
    setCreating(false)
    setNewName('')
    // APFS is case-insensitive — never clobber an existing file with the template.
    const existing = files.find((f) => f.name.toLowerCase() === name.toLowerCase())
    if (existing) {
      openFile(existing.name)
      return
    }
    void writeMemory(name, `# ${name.replace(/\.md$/, '')}\n\n`)
      .then(() => openFile(name))
      .catch(toastError)
  }

  return (
    <Modal open={open} title="Agent memory" wide onClose={onClose}>
      <p className="mb-3 text-[11.5px] leading-relaxed text-zinc-600">
        Markdown notes loaded into every agent session. The agent can read and edit them too.
      </p>
      <div className="flex gap-4">
        <div className="w-48 shrink-0">
          {creating ? (
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createFile()
                if (e.key === 'Escape') {
                  setCreating(false)
                  setNewName('')
                }
              }}
              placeholder="notes.md"
              spellCheck={false}
              className="mb-2 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-zinc-500"
            />
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/60 py-1 text-[11.5px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            >
              <Plus size={12} />
              New file
            </button>
          )}
          {files.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-zinc-600">No memory files yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {files.map((file) => (
                <li key={file.name}>
                  <button
                    onClick={() => openFile(file.name)}
                    className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left ${
                      file.name === selected
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                    }`}
                  >
                    <FileText size={12} className="shrink-0 text-zinc-500" />
                    <span className="min-w-0 flex-1 truncate text-[12px]">{file.name}</span>
                    <span className="shrink-0 text-[10px] text-zinc-600">
                      {relativeTime(file.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {selected ? (
            <>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="truncate font-mono text-[11.5px] text-zinc-400">{selected}</span>
                <button
                  onClick={() => setConfirmDelete(true)}
                  title="Delete file"
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                className="h-72 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-[12px] leading-relaxed text-zinc-300 outline-none focus:border-zinc-600"
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-md bg-emerald-600 px-3 py-1 text-[12px] font-medium text-white enabled:hover:bg-emerald-500 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-[12px] text-zinc-600">
              Select a file to edit, or create one.
            </p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete memory file"
        body={`Delete "${selected ?? ''}"? The agent will no longer see it.`}
        confirmLabel="Delete"
        danger
        onConfirm={deleteSelected}
        onCancel={() => setConfirmDelete(false)}
      />
    </Modal>
  )
}
