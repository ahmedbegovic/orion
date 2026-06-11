import { useEffect, type RefObject } from 'react'

/**
 * Autosize a textarea after every value commit (covers programmatic clears on
 * send), capped at maxPx — keep maxPx equal to the element's Tailwind max-h-*
 * so the CSS clamp never hides content the JS cap allowed. The scrollbar only
 * appears past the cap: subpixel scrollHeight rounding otherwise leaves a
 * permanent 1px overflow and a stray styled thumb (v2 feedback).
 */
export function useAutosizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxPx: number
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden'
  }, [ref, value, maxPx])
}
