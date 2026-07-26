import { useEffect, useRef } from 'react'
import { SHORTCUT_GROUPS, SHORTCUT_NOTE } from './shortcuts'

/**
 * 도움말 (F1).
 *
 * 단축키가 스물 몇 개가 되면 외울 수 없다. 손이 키보드에 있는 채로 한 번에
 * 펼쳐 보고 바로 닫을 수 있어야 한다.
 */
export function HelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    // 열리면 포커스를 안으로 들여 Esc가 바로 먹게 한다
    closeRef.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'F1') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    // 캡처 단계에서 먼저 받아 전역 단축키보다 앞선다
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="단축키 도움말"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-2xl shadow-black/60"
      >
        <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-100">단축키</h2>
          <span className="text-[11px] text-slate-600">Esc 또는 F1로 닫기</span>
          <button ref={closeRef} type="button" onClick={onClose} className="ml-auto chip">
            닫기
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-x-8 gap-y-6 overflow-y-auto p-5 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-[11px] font-medium tracking-wide text-sky-300/80">
                {group.title}
              </h3>
              <dl className="space-y-1.5">
                {group.items.map((item) => (
                  <div key={item.label} className="flex items-baseline gap-3">
                    <dt className="flex shrink-0 gap-1">
                      {item.keys.map((key) => (
                        <kbd key={key} className="kbd whitespace-nowrap">
                          {key}
                        </kbd>
                      ))}
                    </dt>
                    <dd className="text-xs leading-relaxed text-slate-400">{item.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <footer className="border-t border-white/10 px-5 py-3 text-[11px] leading-relaxed text-slate-600">
          {SHORTCUT_NOTE}
        </footer>
      </div>
    </div>
  )
}
