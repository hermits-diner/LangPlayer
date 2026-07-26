import type { Cue } from '../types'
import { SubtitleParseError } from '../types'
import { cleanCueText, sanitizeCues } from './shared'

/**
 * YouTube '스크립트 표시'에서 복사한 텍스트 파서.
 *
 * 유튜브는 자막 텍스트를 API로 내주지 않고, 자막 엔드포인트는 CORS로 막혀 있다.
 * 하지만 사용자가 화면에서 직접 복사하는 것은 아무 문제가 없다. 그렇게 얻은
 * 스크립트는 이런 모양이다.
 *
 *     0:15
 *     I was sitting with my friend
 *     0:19
 *     It was the Horn and Hardart
 *
 * 시작 시각만 있고 종료 시각이 없다는 점에서 SMI와 구조가 같다 — 다음 항목의
 * 시작이 곧 앞 항목의 끝이다.
 *
 * 한 줄에 시각과 텍스트가 함께 오는 변형(`0:15 I was sitting…`)도 받는다.
 */

/** `0:15`, `1:02:03`, `00:15` 모두 허용 */
const TIMESTAMP = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/
/** 같은 줄에 텍스트가 이어 붙은 경우 */
const INLINE = /^((?:\d{1,2}:)?\d{1,2}:\d{2}(?:\.\d{1,3})?)\s+(.*\S)\s*$/

/** 마지막 항목은 종료 시각을 알 수 없어 이만큼 이어진다고 본다 */
const TAIL_DURATION_SEC = 5

function toSeconds(stamp: string): number | null {
  const match = stamp.match(TIMESTAMP)
  if (!match) return null

  const [, hours, minutes, seconds, fraction] = match
  return (
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    (fraction ? Number(fraction) / 10 ** fraction.length : 0)
  )
}

/** 이 텍스트가 유튜브 스크립트 형식인지 */
export function looksLikeTranscript(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40)
  if (lines.length < 4) return false

  const stamped = lines.filter((line) => TIMESTAMP.test(line) || INLINE.test(line)).length

  // 시각만 있는 줄이 번갈아 나오므로 대략 절반, 한 줄 형식이면 대부분이 걸린다
  return stamped >= lines.length * 0.35
}

interface Entry {
  start: number
  text: string
}

export function parseTranscript(text: string): Cue[] {
  const lines = text.split('\n').map((line) => line.trim())
  const entries: Entry[] = []
  let pending: number | null = null

  for (const line of lines) {
    if (!line) continue

    const inline = line.match(INLINE)
    if (inline) {
      const start = toSeconds(inline[1])
      if (start !== null) {
        entries.push({ start, text: inline[2] })
        pending = null
        continue
      }
    }

    const start = toSeconds(line)
    if (start !== null) {
      // 시각이 연달아 나오면 앞엣것은 내용 없는 항목이다
      pending = start
      continue
    }

    if (pending === null) {
      // 시각 없이 시작한 텍스트는 직전 항목에 이어 붙인다
      if (entries.length > 0) entries[entries.length - 1].text += ` ${line}`
      continue
    }

    entries.push({ start: pending, text: line })
    pending = null
  }

  const cues: Cue[] = []

  entries.forEach((entry, index) => {
    const body = cleanCueText(entry.text)
    if (!body) return

    // 종료 시각은 다음 항목의 시작 — 마지막만 짐작한다
    const end = entries[index + 1]?.start ?? entry.start + TAIL_DURATION_SEC

    cues.push({ id: `yt-${index}`, start: entry.start, end, text: body })
  })

  if (cues.length === 0) {
    throw new SubtitleParseError('스크립트에서 자막을 찾지 못했습니다. 시각과 문장이 함께 복사되었는지 확인해 주세요.', 'transcript')
  }

  return sanitizeCues(cues)
}
