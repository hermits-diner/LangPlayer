import type { Segment } from '../subtitle/types'

/**
 * 문장별 입력 ↔ 한 문서.
 *
 * 텍스트창은 받아쓰기 전체를 하나의 글로 보여주고 고치게 한다. 그러려면 두
 * 표현이 정확히 왕복해야 한다. 그래서 **문장 하나가 정확히 한 줄**이라는 규칙을
 * 둔다. 줄 번호가 곧 문장 번호이므로 어느 쪽을 고쳐도 짝이 어긋나지 않는다.
 */

/** 문장 하나가 한 줄. 아직 안 쓴 문장은 빈 줄로 자리를 지킨다 */
export function toDocument(segments: readonly Segment[], valueOf: (segment: Segment) => string): string {
  return segments.map((segment) => valueOf(segment).replace(/\s*\n\s*/g, ' ').trim()).join('\n')
}

/**
 * 문서를 다시 문장별로 쪼갠다.
 *
 * 줄 수가 문장 수와 다를 수 있다 — 사용자가 줄을 지우거나 더할 수 있기 때문이다.
 * 모자라면 빈 문자열로, 남으면 마지막 문장에 이어 붙여 내용을 잃지 않는다.
 */
export function fromDocument(segments: readonly Segment[], document: string): string[] {
  if (segments.length === 0) return []

  const lines = document.split('\n')
  const values = segments.map((_, index) => lines[index] ?? '')

  // 남는 줄을 버리면 사용자가 쓴 내용이 소리 없이 사라진다
  if (lines.length > segments.length) {
    const overflow = lines.slice(segments.length).join(' ').trim()
    if (overflow) {
      const last = segments.length - 1
      values[last] = `${values[last]} ${overflow}`.trim()
    }
  }

  return values.map((value) => value.trim())
}
