import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { RotateCw, X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { call, onEvent } from '@/lib/ipc'
import { useCodeStore } from '@/stores/code'
import { toastError } from '@/stores/toasts'

interface Props {
  /** Absolute workspace root — the shell's cwd. Key the component by it. */
  root: string
  /** Toggled pane visibility; the pty stays alive while hidden. */
  open: boolean
}

function dirName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

const TERMINAL_THEME = {
  background: '#0c0c0e',
  foreground: '#d4d4d8',
  cursor: '#d4d4d8',
  selectionBackground: '#3f3f46'
}

export default function TerminalPane({ root, open }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termIdRef = useRef<string | null>(null)
  const restartingRef = useRef(false)
  // First reveal latches: the shell spawns once, then the pty stays alive
  // while the pane is hidden. State (not a ref) so StrictMode's simulated
  // remount re-runs the lifecycle effect below instead of skipping it.
  const [revealed, setRevealed] = useState(open)
  const [exited, setExited] = useState(false)

  useEffect(() => {
    if (open) setRevealed(true)
  }, [open])

  // One symmetric lifecycle: the xterm instance, the pty and the event
  // subscriptions are created together and torn down together, so a
  // cleanup + re-run (StrictMode's simulated remount) rebuilds a working
  // terminal instead of leaving a disposed one behind a stale latch.
  useEffect(() => {
    if (!revealed) return
    const el = containerRef.current
    if (!el) return
    let disposed = false

    const term = new Terminal({
      fontSize: 12,
      fontFamily: '"SF Mono", Menlo, monospace',
      scrollback: 5000,
      cursorBlink: true,
      theme: TERMINAL_THEME
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()
    term.onData((data) => {
      const termId = termIdRef.current
      if (termId) void call('term.write', { termId, data }).catch(() => {})
    })
    termRef.current = term
    fitRef.current = fit

    const offData = onEvent('term.data', (event) => {
      if (event.termId === termIdRef.current) termRef.current?.write(event.data)
    })
    const offExit = onEvent('term.exit', (event) => {
      if (event.termId !== termIdRef.current) return
      termIdRef.current = null
      useCodeStore.getState().setTermId(null)
      setExited(true)
    })

    void call('term.create', { cwd: root, cols: term.cols, rows: term.rows })
      .then(({ termId }) => {
        if (disposed) {
          // Torn down while create was in flight — kill the orphan pty
          // instead of adopting it, so it never counts against the cap.
          void call('term.kill', { termId }).catch(() => {})
          return
        }
        termIdRef.current = termId
        const store = useCodeStore.getState()
        store.setTermId(termId)
        // "Open in Terminal" may have queued a cd before the pty existed.
        const pending = store.consumePendingTermCommand()
        if (pending) void call('term.write', { termId, data: pending }).catch(() => {})
        setExited(false)
        term.focus()
      })
      .catch((err) => {
        if (disposed) return
        setExited(true) // the Restart overlay is the retry surface
        toastError(err)
      })

    return () => {
      disposed = true
      offData()
      offExit()
      // Cleanup also runs on workspace close/switch (the component is keyed
      // by root) — kill the pty along with the buffer.
      const termId = termIdRef.current
      if (termId) void call('term.kill', { termId }).catch(() => {})
      termIdRef.current = null
      useCodeStore.getState().setTermId(null)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [revealed, root])

  // The exited overlay's retry — reuses the live Terminal buffer.
  const restart = async (): Promise<void> => {
    const term = termRef.current
    if (!term || restartingRef.current) return
    restartingRef.current = true
    try {
      // The title-strip restart also lands here with a live shell — kill it
      // first; store termId goes null NOW so openInTerminal queues instead of
      // writing to the dying pty.
      const oldId = termIdRef.current
      termIdRef.current = null
      useCodeStore.getState().setTermId(null)
      if (oldId) await call('term.kill', { termId: oldId }).catch(() => {})
      term.reset()
      const { termId } = await call('term.create', { cwd: root, cols: term.cols, rows: term.rows })
      if (termRef.current !== term) {
        // The lifecycle tore down mid-create — don't leak the pty.
        void call('term.kill', { termId }).catch(() => {})
        return
      }
      termIdRef.current = termId
      const store = useCodeStore.getState()
      store.setTermId(termId)
      // Same contract as the mount path: a cd queued while no pty was alive
      // must land in this fresh shell, never linger to poison a later one.
      const pending = store.consumePendingTermCommand()
      if (pending) void call('term.write', { termId, data: pending }).catch(() => {})
      setExited(false)
      term.focus()
    } finally {
      restartingRef.current = false
    }
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const term = termRef.current
      const fit = fitRef.current
      if (!term || !fit) return
      // A hidden pane (display:none) proposes no dimensions — skip until shown.
      const dims = fit.proposeDimensions()
      if (!dims || !Number.isFinite(dims.cols) || dims.cols < 2 || dims.rows < 1) return
      fit.fit()
      const termId = termIdRef.current
      if (termId)
        void call('term.resize', { termId, cols: term.cols, rows: term.rows }).catch(() => {})
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    // Distinct outline per the PDF: inset rounded border, emerald on focus.
    <div
      className={`no-drag mx-2 mb-2 shrink-0 overflow-hidden rounded-lg border border-zinc-700/70 bg-[#0c0c0e] focus-within:border-emerald-600/50 ${
        open ? '' : 'hidden'
      }`}
    >
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/60 px-2.5">
        <span className="min-w-0 truncate text-[11px] text-zinc-500">zsh — {dirName(root)}</span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => void restart().catch(toastError)}
            title="Restart shell"
            className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <RotateCw size={11} />
          </button>
          <button
            onClick={() => useCodeStore.getState().setTerminalOpen(false)}
            title="Hide terminal"
            className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
          >
            <X size={11} />
          </button>
        </div>
      </div>
      <div className="relative h-56">
        <div ref={containerRef} className="absolute inset-0 pl-2 pt-1.5" />
        {exited && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/70">
            <p className="text-[12px] text-zinc-500">The shell exited or failed to start.</p>
            <button
              onClick={() => void restart().catch(toastError)}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[12px] font-medium text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
            >
              <RotateCw size={12} />
              Restart
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
