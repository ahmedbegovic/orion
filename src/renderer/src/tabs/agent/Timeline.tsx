import { Virtuoso } from 'react-virtuoso'
import { AlertTriangle, Bot, ChevronDown, Loader2, Wrench } from 'lucide-react'
import { useAgentStore, type AgentMessage, type AgentPart } from '@/stores/agent'
import MarkdownPart from '../chat/MarkdownPart'
import ThoughtBlock from '../chat/ThoughtBlock'

const RENDER_LIMIT = 6000

// Stable component refs so Virtuoso doesn't remount header/footer every render.
const virtuosoComponents = {
  Header: () => <div className="h-4" />,
  Footer: () => <div className="h-4" />
}

function clip(text: string): string {
  return text.length > RENDER_LIMIT ? `${text.slice(0, RENDER_LIMIT)}\n… (truncated)` : text
}

function prettyInput(input: unknown): string | null {
  if (input === undefined || input === null) return null
  try {
    const json = JSON.stringify(input, null, 2)
    return json === '{}' || json === undefined ? null : json
  } catch {
    return String(input)
  }
}

function ToolPartCard({ part }: { part: AgentPart }) {
  const status = part.state?.status
  // No status yet means the call was only just announced — treat as pending.
  const settled = status === 'completed' || status === 'error'
  const dotClass =
    status === 'completed'
      ? 'bg-emerald-400'
      : status === 'error'
        ? 'bg-red-400'
        : 'animate-pulse bg-amber-400'
  const input = prettyInput(part.state?.input)
  const output = status === 'error' ? part.state?.error : part.state?.output
  return (
    <details className="group/tool my-2 rounded-lg border border-zinc-800/80 bg-zinc-900/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 [&::-webkit-details-marker]:hidden">
        <Wrench size={12} className="shrink-0 text-zinc-500" />
        <span className="shrink-0 font-mono text-[11.5px] text-zinc-300">
          {part.tool ?? 'tool'}
        </span>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
        {part.state?.title && (
          <span className="truncate text-[11px] text-zinc-600">{part.state.title}</span>
        )}
        <ChevronDown
          size={12}
          className="ml-auto shrink-0 text-zinc-600 transition-transform group-open/tool:rotate-180"
        />
      </summary>
      <div className="space-y-2 border-t border-zinc-800/80 px-3 py-2">
        {input && (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              Input
            </div>
            <pre className="select-text overflow-x-auto whitespace-pre-wrap rounded bg-zinc-950/60 p-2 font-mono text-[11px] leading-relaxed text-zinc-400">
              {clip(input)}
            </pre>
          </div>
        )}
        {output ? (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              {status === 'error' ? 'Error' : 'Output'}
            </div>
            <pre
              className={`max-h-64 select-text overflow-auto whitespace-pre-wrap rounded bg-zinc-950/60 p-2 font-mono text-[11px] leading-relaxed ${
                status === 'error' ? 'text-red-400' : 'text-zinc-400'
              }`}
            >
              {clip(output)}
            </pre>
          </div>
        ) : !settled ? (
          <p className="text-[11px] text-zinc-600">Waiting for output…</p>
        ) : null}
      </div>
    </details>
  )
}

function MessageRow({ message, busy }: { message: AgentMessage; busy: boolean }) {
  if (message.role === 'user') {
    const text = message.parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('\n\n')
    return (
      <div className="flex justify-end py-2">
        <div className="max-w-[80%] select-text whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-zinc-800 px-3.5 py-2 text-[13.5px] leading-relaxed text-zinc-100">
          {text}
        </div>
      </div>
    )
  }
  const lastId = message.parts[message.parts.length - 1]?.id
  return (
    <div className="py-2">
      {message.parts.map((part) => {
        switch (part.type) {
          case 'text':
            return part.text ? <MarkdownPart key={part.id} text={part.text} /> : null
          case 'reasoning': {
            // trim(): opencode emits whitespace-only reasoning parts for some
            // models — an empty "Thoughts" block is just noise (v2 feedback).
            // While actively streaming it stays visible as the "Thinking…"
            // indicator (parity with the chat-side MessageBubble).
            const active = busy && !message.completed && part.id === lastId
            return part.text?.trim() || active ? (
              <ThoughtBlock key={part.id} text={part.text ?? ''} active={active} />
            ) : null
          }
          case 'tool':
            return <ToolPartCard key={part.id} part={part} />
          default:
            return null // step-start/step-finish/snapshot/patch markers carry no prose
        }
      })}
      {message.error && (
        <div className="my-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <p className="min-w-0 select-text break-words">{message.error}</p>
        </div>
      )}
    </div>
  )
}

interface Props {
  sessionId: string
}

export default function Timeline({ sessionId }: Props) {
  const messages = useAgentStore((s) => s.messagesBySession[sessionId])
  const busy = useAgentStore((s) => Boolean(s.busyBySession[sessionId]))
  const directory = useAgentStore(
    (s) => s.sessions.find((x) => x.id === sessionId)?.directory
  )

  if (!messages)
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-zinc-600">
        Loading…
      </div>
    )

  // Zero-height rows upset Virtuoso — drop user messages that carry no text.
  const visible = messages.filter(
    (m) => m.role !== 'user' || m.parts.some((p) => p.type === 'text' && p.text)
  )
  const last = visible[visible.length - 1]
  const streamingStarted =
    last !== undefined && last.role === 'assistant' && !last.completed && last.parts.length > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {visible.length === 0 && !busy ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
          <Bot size={28} strokeWidth={1.5} className="text-zinc-700" />
          <p className="text-[13px] text-zinc-500">Describe a task to get started.</p>
          <p className="max-w-md text-[12px] leading-relaxed text-zinc-600">
            The agent works inside{' '}
            <span className="select-text break-all font-mono text-zinc-500">{directory}</span> — it
            can read and edit files there, run shell commands and search the web, asking you before
            anything risky.
          </p>
        </div>
      ) : (
        <Virtuoso
          style={{ height: '100%' }}
          // overflow-x-hidden: content wraps (MarkdownPart breaks long inline
          // code); the panel must scroll down, never sideways (v2 feedback).
          className="min-h-0 flex-1 overflow-x-hidden"
          data={visible}
          computeItemKey={(_, m: AgentMessage) => m.id}
          initialTopMostItemIndex={Math.max(0, visible.length - 1)}
          followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
          components={virtuosoComponents}
          itemContent={(_, message: AgentMessage) => (
            <div className="mx-auto w-full max-w-3xl px-6">
              <MessageRow message={message} busy={busy} />
            </div>
          )}
        />
      )}
      {busy && (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-2">
          <div className="flex items-center gap-2 text-[12px] text-zinc-500">
            <Loader2 size={13} className="animate-spin" />
            {streamingStarted
              ? 'Working…'
              : 'Working… loading the model can take a while the first time.'}
          </div>
        </div>
      )}
    </div>
  )
}
