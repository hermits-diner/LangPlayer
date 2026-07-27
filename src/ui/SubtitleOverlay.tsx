import { useAppStore } from '../store/useAppStore'

/**
 * 영상 위 자막.
 *
 * 받아쓰기를 할 때는 정답이 보이면 안 되지만, 늘 받아쓰기만 하는 것은 아니다.
 * 한 번 훑어볼 때, 뜻을 확인할 때, 남에게 보여줄 때는 여느 플레이어처럼 화면
 * 아래에 자막이 떠 있는 편이 낫다. 그래서 **선택 사항**으로 둔다.
 *
 * `자막 숨김`을 켜면 이 자막도 함께 사라진다. 숨김은 "정답을 보지 않겠다"는
 * 뜻인데, 화면에 그대로 떠 있으면 그 선언이 무의미해지기 때문이다.
 */
/**
 * 글자 크기 선택지.
 *
 * 기준 크기는 화면 폭을 따라간다 — 창을 키우면 자막도 커져야 비율이 유지된다.
 * 여기 배수는 그 위에 얹는 개인 취향이다.
 */
export const SUBTITLE_SCALES = [
  { value: 0.8, label: '작게' },
  { value: 1, label: '보통' },
  { value: 1.3, label: '크게' },
  { value: 1.7, label: '아주 크게' },
]

/** 기준 크기 — 좁은 화면에서도 읽히고, 넓은 화면에서 과하게 커지지도 않는다 */
const BASE_SIZE = 'clamp(0.95rem, 1.9vw, 1.5rem)'

export function SubtitleOverlay() {
  const scale = useAppStore((s) => s.videoSubtitleScale)
  const text = useAppStore((state) => {
    if (!state.videoSubtitles || state.hideSubtitles) return ''

    const { segments } = state
    if (segments.length === 0) return ''

    // 재생 위치를 담고 있는 문장 — start가 오름차순이므로 이분 탐색
    let low = 0
    let high = segments.length - 1
    let found = -1
    while (low <= high) {
      const mid = (low + high) >> 1
      if (segments[mid].start <= state.currentTime) {
        found = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    if (found >= 0 && state.currentTime < segments[found].end) return segments[found].text

    // 여기부터는 문장 사이 침묵이다.
    //
    // 구간 반복 중이라면 그 문장을 계속 띄운다. 반복은 문장 시작 0.2초 전부터
    // 걸리므로, 침묵이라고 비워 버리면 반복할 때마다 자막이 깜빡여 읽을 수가 없다.
    // 멈춘 뒤에도 targetId는 남아 있으므로 재생 중일 때만 인정한다
    const target = state.loopStatus.running ? state.loopStatus.targetId : null
    if (target) {
      const targeted = segments.find((segment) => segment.id === target)
      if (targeted) return targeted.text
    }

    // 연속 재생 중 문장 사이라면 비운다 — 플레이어의 상식이 그렇다.
    // 멈춰 있을 때는 지금 공부하는 문장이 보이는 편이 쓸모 있다
    return state.loopStatus.running ? '' : (segments[state.activeIndex]?.text ?? '')
  })

  if (!text) return null

  return (
    // 12%는 자막의 표준 높이지만, 재생 영역이 낮을 때는 그 12%가 브라우저 기본
    // 컨트롤 막대(약 40px) 안으로 들어간다. 그래서 최소 높이를 함께 준다.
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-[max(3.5rem,12%)] flex justify-center px-6"
    >
      {/*
        영상 위 글자는 배경을 가리지 않고도 읽혀야 한다. 반투명 판만으로는 밝은
        장면에서 묻히고, 그림자만으로는 복잡한 장면에서 묻힌다 — 둘 다 쓴다.
      */}
      <p
        style={{ fontSize: `calc(${BASE_SIZE} * ${scale})` }}
        className="max-w-[92%] rounded-md bg-black/55 px-3 py-1 text-center font-medium leading-snug text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]"
      >
        {text}
      </p>
    </div>
  )
}
