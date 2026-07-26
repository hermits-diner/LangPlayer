import type { Cue } from '../types'
import { SubtitleParseError } from '../types'
import { cleanCueText, parseTimestamp, sanitizeCues, splitBlocks } from './shared'

const ARROW = /-->/
const META_BLOCK = /^(WEBVTT|NOTE|STYLE|REGION)\b/

/**
 * WebVTT 파서.
 *
 * SRT와 구조가 거의 같지만 헤더(`WEBVTT`)와 메타 블록(NOTE/STYLE/REGION),
 * 큐 식별자 줄, 타임코드 뒤 설정(`line:0 position:20%`)이 추가로 존재한다.
 * 시간은 `MM:SS.mmm`처럼 시간 단위가 생략될 수 있다.
 */
export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = []

  splitBlocks(text).forEach((block, blockIndex) => {
    if (META_BLOCK.test(block)) return

    const lines = block.split('\n')
    const arrowLine = lines.findIndex((l) => ARROW.test(l))
    if (arrowLine === -1) return

    const [rawStart, rawEndAndSettings] = lines[arrowLine].split(ARROW)
    const start = parseTimestamp(rawStart)
    // 타임코드 뒤 큐 설정 제거
    const end = parseTimestamp((rawEndAndSettings ?? '').trim().split(/\s+/)[0] ?? '')
    if (start === null || end === null) return

    const body = cleanCueText(lines.slice(arrowLine + 1).join('\n'))
    if (!body) return

    cues.push({ id: `vtt-${blockIndex}`, start, end, text: body })
  })

  if (cues.length === 0) {
    throw new SubtitleParseError('VTT에서 자막 큐를 하나도 찾지 못했습니다.', 'vtt')
  }

  return sanitizeCues(cues)
}
