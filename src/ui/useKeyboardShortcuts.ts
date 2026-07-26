import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'

const RATE_STEPS = [0.6, 0.75, 0.9, 1, 1.25]

interface Handlers {
  replay: () => void
  stop: () => void
  move: (delta: number) => void
}

/**
 * 전역 단축키.
 *
 * 이 앱은 입력창에 포커스가 가 있는 시간이 대부분이라, 타이핑을 방해하지 않는
 * 것이 최우선이다. 그래서 글자 키 단축키는 입력 중일 때 완전히 비활성화하고,
 * 대신 Ctrl 조합으로 같은 동작을 열어둔다.
 */
export function useKeyboardShortcuts({ replay, stop, move }: Handlers) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTyping = Boolean(target?.closest('input, textarea, [contenteditable="true"]'))
      const hasModifier = e.ctrlKey || e.altKey || e.metaKey

      // F5는 브라우저 새로고침을 가로채 구간 반복으로 쓴다 (새로고침은 Ctrl+R)
      // 입력창 안에서도 동작해야 하므로 타이핑 검사보다 먼저 처리한다
      if (e.key === 'F5' && !hasModifier) {
        e.preventDefault()
        replay()
        return
      }

      // 타이핑 중에는 수식키 조합만 받는다
      if (isTyping && !hasModifier) return

      const store = useAppStore.getState()

      // 자막 싱크 미세 조정 — 입력 중에도 쓸 수 있어야 한다
      if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        store.nudgeOffset(e.key === 'ArrowLeft' ? -0.1 : 0.1)
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        move(e.key === 'ArrowDown' ? 1 : -1)
        return
      }

      if (hasModifier) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          if (store.loopStatus.running) stop()
          else replay()
          break

        case 'Tab':
          e.preventDefault()
          store.toggleHideSubtitles()
          break

        case '[':
        case ']': {
          e.preventDefault()
          const current = RATE_STEPS.indexOf(store.loopSettings.rate)
          const base = current === -1 ? RATE_STEPS.indexOf(1) : current
          const next = Math.min(Math.max(base + (e.key === ']' ? 1 : -1), 0), RATE_STEPS.length - 1)
          store.updateLoopSettings({ rate: RATE_STEPS[next] })
          break
        }

        default:
          if (/^[1-9]$/.test(e.key)) {
            e.preventDefault()
            store.updateLoopSettings({ repeatCount: Number(e.key) })
          }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [move, replay, stop])
}
