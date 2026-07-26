import type { Cue } from '../types'
import { SubtitleParseError } from '../types'
import { cleanCueText, parseTimestamp, sanitizeCues, splitBlocks } from './shared'

const ARROW = /-->/

/**
 * SRT 파서.
 *
 * 인덱스 번호가 없거나, 콤마 대신 마침표를 쓰거나, 타임코드 뒤에 좌표 정보
 * (`X1:0 X2:0 Y1:0 Y2:0`)가 붙은 변종이 흔해서 블록 안에서 `-->` 줄을 찾아내는
 * 방식으로 처리한다. 인덱스 줄은 신뢰하지 않고 버린다.
 */
export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = []

  splitBlocks(text).forEach((block, blockIndex) => {
    const lines = block.split('\n')
    const arrowLine = lines.findIndex((l) => ARROW.test(l))
    if (arrowLine === -1) return // 인덱스만 있는 쓰레기 블록

    const [rawStart, rawEndAndExtra] = lines[arrowLine].split(ARROW)
    const start = parseTimestamp(rawStart)
    // 타임코드 뒤 좌표 정보 제거
    const end = parseTimestamp((rawEndAndExtra ?? '').trim().split(/\s+/)[0] ?? '')
    if (start === null || end === null) return

    const body = cleanCueText(lines.slice(arrowLine + 1).join('\n'))
    if (!body) return // 빈 큐는 학습 단위가 될 수 없다

    cues.push({ id: `srt-${blockIndex}`, start, end, text: body })
  })

  if (cues.length === 0) {
    throw new SubtitleParseError('SRT에서 자막 큐를 하나도 찾지 못했습니다.', 'srt')
  }

  return sanitizeCues(cues)
}
