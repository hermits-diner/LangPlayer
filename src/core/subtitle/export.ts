import type { Segment } from './types'

/**
 * 고친 자막을 다시 자막 파일로.
 *
 * 이 앱에서 하는 편집 — 문장 합치기·나누기, 오타 수정, 싱크 보정, 문장별 맞춤 —
 * 은 전부 segments 안에 들어 있다. 학습 기록으로 저장되니 다음에 열면 이어지지만,
 * 그건 이 브라우저 안에서만 사는 기록이다. 다른 기기·다른 플레이어로 가져갈 수도,
 * 백업할 수도 없다. 몇 시간 들여 고친 자막이 브라우저 저장소와 운명을 함께해서는
 * 곤란하다.
 *
 * 형식은 SRT 하나로 둔다. 어떤 플레이어든 읽고, 이 앱의 파서도 읽는다 — 내보낸
 * 파일을 그대로 다시 올리면 편집 결과가 그대로 열린다.
 */

/** 시작과 끝이 같은 큐는 플레이어가 그냥 건너뛴다 */
const MIN_DURATION_SEC = 0.001

export function toSrt(segments: readonly Segment[]): string {
  return segments
    .map((segment) => {
      // 싱크를 앞으로 밀면 음수가 될 수 있다. 자막 시각에 음수는 없다
      const start = Math.max(0, segment.start)
      return {
        start,
        end: Math.max(start + MIN_DURATION_SEC, segment.end),
        // 한 문장이 한 줄 — 편집 규칙을 파일에도 그대로 옮긴다
        text: segment.text.replace(/\s*\n\s*/g, ' ').trim(),
      }
    })
    // 빈 큐는 자막이 아니다. 번호는 남은 것만으로 다시 매긴다
    .filter((cue) => cue.text)
    .map(
      (cue, index) =>
        `${index + 1}\n${timecode(cue.start)} --> ${timecode(cue.end)}\n${cue.text}\n`,
    )
    .join('\n')
}

/** `HH:MM:SS,mmm` — SRT의 시각 표기 */
function timecode(sec: number): string {
  const total = Math.round(sec * 1000)
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor(total / 60_000) % 60
  const s = Math.floor(total / 1000) % 60
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(total % 1000, 3)}`
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}
