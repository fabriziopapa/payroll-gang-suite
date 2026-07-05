import { useEffect, useRef } from 'react'

interface Props {
  open:          boolean
  title:         string
  message:       string
  danger?:       boolean
  confirmLabel?: string
  onConfirm:     () => void
  onCancel:      () => void
}

export function ConfirmDialog({
  open, title, message, danger, confirmLabel = 'Conferma', onConfirm, onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <h3 id="confirm-dialog-title" className="text-white font-semibold mb-2">{title}</h3>
        <p className="text-slate-400 text-sm mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-slate-300 hover:text-white text-sm transition"
          >
            Annulla
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-white text-sm font-medium transition
              ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
