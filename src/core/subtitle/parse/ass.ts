import type { Cue } from '../types'
import { SubtitleParseError } from '../types'
import { cleanCueText, parseTimestamp, sanitizeCues } from './shared'

/**
 * ASS/SSA 파서 — 텍스트와 타이밍만 추출한다.
 *
 * `[Events]` 섹션의 `Format:` 줄이 필드 순서를 정의하므로 하드코딩하지 않고
 * 그 줄을 읽어 인덱스를 잡는다. Text 필드는 항상 마지막이고 콤마를 포함할 수
 * 있어서, 앞 필드 개수만큼만 분리하고 나머지를 통째로 텍스트로 취급한다.
 */
export function parseAss(text: string): Cue[] {
  const lines = text.split('\n')

  let fields: string[] | null = null
  const cues: Cue[] = []

  lines.forEach((line, i) => {
    const trimmed = line.trim()

    if (/^format\s*:/i.test(trimmed)) {
      fields = trimmed
        .slice(trimmed.indexOf(':') + 1)
        .split(',')
        .map((f) => f.trim().toLowerCase())
      return
    }

    if (!/^dialogue\s*:/i.test(trimmed)) return

    // Format 줄이 없는 파일을 위한 표준 기본값
    const layout = fields ?? ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
    const startIdx = layout.indexOf('start')
    const endIdx = layout.indexOf('end')
    const textIdx = layout.indexOf('text')
    if (startIdx === -1 || endIdx === -1 || textIdx === -1) return

    // Text 필드 앞까지만 콤마로 분리 — 대사 안의 콤마를 보존한다
    const parts = trimmed.slice(trimmed.indexOf(':') + 1).split(',')
    if (parts.length <= textIdx) return
    const values = [...parts.slice(0, textIdx), parts.slice(textIdx).join(',')]

    const start = parseTimestamp(values[startIdx])
    const end = parseTimestamp(values[endIdx])
    if (start === null || end === null) return

    // ASS의 줄바꿈 지시자를 공백으로
    const body = cleanCueText(values[textIdx].replace(/\\[Nnh]/g, ' '))
    if (!body) return

    cues.push({ id: `ass-${i}`, start, end, text: body })
  })

  if (cues.length === 0) {
    throw new SubtitleParseError('ASS/SSA에서 Dialogue 줄을 찾지 못했습니다.', 'ass')
  }

  return sanitizeCues(cues)
}
