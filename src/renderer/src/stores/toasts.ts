import { create } from 'zustand'
import { onEvent } from '@/lib/ipc'

export type ToastLevel = 'info' | 'warn' | 'error'

export interface Toast {
  id: string
  level: ToastLevel
  message: string
}

const TOAST_TTL_MS = 6000

interface ToastsStore {
  toasts: Toast[]
  initialized: boolean
  init: () => void
  push: (level: ToastLevel, message: string) => void
  dismiss: (id: string) => void
}

/** One stack for main's system.toast broadcasts and renderer-local errors. */
export const useToastsStore = create<ToastsStore>((set, get) => ({
  toasts: [],
  initialized: false,

  init: () => {
    if (get().initialized) return
    set({ initialized: true })
    onEvent('system.toast', (event) => get().push(event.level, event.message))
  },

  push: (level, message) => {
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts, { id, level, message }] }))
    setTimeout(() => get().dismiss(id), TOAST_TTL_MS)
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** Surface a renderer-local notice through the same stack as system.toast events. */
export function pushToast(level: ToastLevel, message: string): void {
  useToastsStore.getState().push(level, message)
}

/** Catch handler for fire-and-forget actions whose rejections would otherwise vanish. */
export function toastError(err: unknown): void {
  pushToast('error', err instanceof Error ? err.message : String(err))
}
