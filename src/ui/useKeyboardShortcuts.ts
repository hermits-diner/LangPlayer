import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTextStore } from '../store/useTextStore'

const RATE_STEPS = [0.6, 0.75, 0.9, 1, 1.25]

/** 음파창·섹션 조작 명령 모음 */
export interface PlayerCommands {
  replay: () => void
  stop: () => void
  move: (delta: number) => void
  gotoFirst: () => void
  gotoLast: () => void
  /** F8 — 일시정지, 멈춰 있으면 되감아 재생 */
  togglePause: () => void
  /** F11 — 선택 구간(없으면 현재부터) 연속 재생 */
  playContinuous: () => void
  mergeSections: () => void
  splitSection: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomToAll: () => void
  /** PageUp/PageDown — 자막 목록을 한 화면씩 넘긴다 (현재 문장은 그대로) */
  scrollSegments: (direction: 1 | -1) => void
  adjustVolume: (delta: number) => void
  /** Ctrl+O — 미디어·자막 파일 열기 */
  openFiles: () => void
  /** Ctrl+S — 받아쓰기 전문 저장 */
  saveDraft: () => void
  /** F9 — 극장 모드 (영상을 키우고 받아쓰기 창을 접는다) */
  toggleTheater: () => void
  /** F1 — 단축키 도움말 */
  toggleHelp: () => void
  /** F10 — 메뉴 */
  toggleMenu: () => void
  /** Ctrl+P — 자막 스크립트 인쇄 */
  print: () => void
}

/**
 * 전역 단축키.
 *
 * 두 가지 원칙이 있다.
 *
 * 1. **타이핑을 방해하지 않는다.** 받아쓰기 입력창에 포커스가 가 있는 시간이
 *    대부분이라, 글자 키 단축키는 입력 중 완전히 비활성화한다.
 * 2. **F키와 수식키 조합은 어디서나 듣는다.** 받아쓰다가도 손을 떼지 않고
 *    다시 듣고, 앞뒤 문장으로 옮길 수 있어야 하기 때문이다.
 *
 * F5·Ctrl+O·Ctrl+S·Ctrl+P는 브라우저 기본 동작을 가로챈다 (새로고침은 Ctrl+R).
 */
export function useKeyboardShortcuts(commands: PlayerCommands) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 이벤트 target이 아니라 실제 포커스를 본다. target은 window나 document일
      // 수 있어(합성 이벤트 등) closest가 없고, "지금 타이핑 중인가"의 답도 아니다.
      const focused = document.activeElement
      const isTyping =
        focused instanceof Element &&
        Boolean(focused.closest('input, textarea, [contenteditable="true"]'))
      const store = useAppStore.getState()

      // ── 어디서나 듣는 키 ────────────────────────────────────────
      //
      // F3은 크롬의 '다음 찾기'와 겹친다. 페이지가 먼저 keydown을 받으므로
      // preventDefault로 막을 수 있지만, 찾기 막대가 열려 있으면 그쪽이 가져간다.
      // 그럴 때는 Esc로 찾기 막대를 닫으면 다시 앱으로 온다.
      switch (e.key) {
        case 'F1':
          e.preventDefault()
          commands.toggleHelp()
          return

        case 'F10':
          e.preventDefault()
          commands.toggleMenu()
          return

        case 'F5':
          e.preventDefault()
          commands.replay()
          return

        // 이동은 F6·F7 한 쌍으로 둔다. 손이 가장 자주 가는 동작이라
        // 나란히 붙어 있는 편이 낫고, Ctrl 조합도 같은 키에 얹는다.
        case 'F6':
          e.preventDefault()
          if (e.ctrlKey) commands.gotoFirst()
          else commands.move(-1)
          return

        case 'F7':
          e.preventDefault()
          if (e.ctrlKey) commands.gotoLast()
          else commands.move(1)
          return

        case 'F8':
          e.preventDefault()
          commands.togglePause()
          return

        case 'F3':
          e.preventDefault()
          commands.mergeSections()
          return

        case 'F4':
          e.preventDefault()
          commands.splitSection()
          return

        case 'F11':
          e.preventDefault()
          commands.playContinuous()
          return

        // 앞뒤 자막을 훑어볼 때 — 입력 중에도 손을 떼지 않고 넘길 수 있어야 한다
        case 'PageDown':
          e.preventDefault()
          commands.scrollSegments(1)
          return

        case 'PageUp':
          e.preventDefault()
          commands.scrollSegments(-1)
          return

        case 'F9':
          e.preventDefault()
          commands.toggleTheater()
          return

        // ── 텍스트창 ──────────────────────────────────────────────
        case 'F2':
          e.preventDefault()
          useTextStore.getState().toggleLower()
          return

        case 'F12':
          // 브라우저가 개발자 도구로 먼저 가로챌 수 있다 — 막지 못하면 그쪽이 이긴다
          e.preventDefault()
          useTextStore.getState().toggleSize()
          return
      }

      // 텍스트창 열고 닫기
      if (e.ctrlKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        useTextStore.getState().toggleOpen()
        return
      }

      if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault()
        commands.openFiles()
        return
      }

      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        commands.saveDraft()
        return
      }

      if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        commands.print()
        return
      }


      if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault()
        store.nudgeOffset(e.key === 'ArrowLeft' ? -0.1 : 0.1)
        return
      }

      if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        commands.adjustVolume(e.key === 'ArrowUp' ? 0.1 : -0.1)
        return
      }

      // 숫자 패드 줌 — 노트북을 위해 일반 +/- 도 함께 받는다
      switch (e.code) {
        case 'NumpadAdd':
          e.preventDefault()
          commands.zoomIn()
          return
        case 'NumpadSubtract':
          e.preventDefault()
          commands.zoomOut()
          return
        case 'NumpadDivide':
          e.preventDefault()
          commands.zoomToAll()
          return
      }

      // ── 여기부터는 타이핑 중이면 넘긴다 ─────────────────────────
      if (isTyping || e.ctrlKey || e.altKey || e.metaKey) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          if (store.loopStatus.running) commands.stop()
          else commands.replay()
          break

        case 'ArrowDown':
        case 'ArrowUp':
          e.preventDefault()
          commands.move(e.key === 'ArrowDown' ? 1 : -1)
          break

        case 'Tab':
          e.preventDefault()
          store.toggleHideSubtitles()
          break

        case '+':
        case '=':
          e.preventDefault()
          commands.zoomIn()
          break

        case '-':
          e.preventDefault()
          commands.zoomOut()
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
  }, [commands])
}
