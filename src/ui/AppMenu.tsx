import { useEffect, useRef } from 'react'

/**
 * 메뉴 (F10).
 *
 * 단축키를 모르는 사람도 모든 기능에 닿을 수 있어야 한다. 헤더에 버튼을
 * 전부 늘어놓으면 상시로 시끄러우므로, 자주 안 쓰는 것들을 여기 모은다.
 */

export interface MenuItem {
  label: string
  hint?: string
  onSelect: () => void
  disabled?: boolean
}

export interface AppMenuProps {
  open: boolean
  onClose: () => void
  items: MenuItem[]
}

export function AppMenu({ open, onClose, items }: AppMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'F10') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute right-4 top-full z-40 mt-1 w-64 overflow-hidden rounded-xl border border-white/10 bg-ink-900 py-1 shadow-2xl shadow-black/60"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
          className="flex w-full items-baseline gap-3 px-3.5 py-2 text-left text-xs text-slate-300 transition duration-150 hover:bg-white/[0.06] hover:text-slate-100 focus-visible:bg-white/[0.06] disabled:cursor-not-allowed disabled:text-slate-700 disabled:hover:bg-transparent"
        >
          <span className="flex-1">{item.label}</span>
          {item.hint && <span className="shrink-0 text-[10px] text-slate-600">{item.hint}</span>}
        </button>
      ))}
    </div>
  )
}
