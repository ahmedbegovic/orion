import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  /** Red styling for destructive actions. */
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}

/** Items render in order; 'separator' draws a divider line. */
export type MenuEntry = MenuItem | 'separator'

interface Props {
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
}

const VIEWPORT_MARGIN_PX = 4

/** Fixed-position context menu; closes on outside mousedown, Escape and item clicks. */
export default function TreeContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Measure after render, clamp before paint — no off-screen flash.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(x, window.innerWidth - width - VIEWPORT_MARGIN_PX)
      ),
      top: Math.max(
        VIEWPORT_MARGIN_PX,
        Math.min(y, window.innerHeight - height - VIEWPORT_MARGIN_PX)
      )
    })
  }, [x, y])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      style={pos}
      className="no-drag fixed z-50 min-w-[160px] rounded-md border border-zinc-700/80 bg-zinc-900 py-1 text-[12px] shadow-xl"
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="my-1 border-t border-zinc-800" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onClick()
            }}
            className={`block w-full px-3 py-[3px] text-left ${
              item.disabled
                ? 'text-zinc-600'
                : item.danger
                  ? 'text-red-400 hover:bg-red-950/50'
                  : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
            }`}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
