import type { Cue } from '../types'
import { SubtitleParseError } from '../types'
import { cleanCueText, sanitizeCues } from './shared'

const SYNC = /<sync\s+start\s*=\s*"?(-?\d+)"?[^>]*>/gi
const P_TAG = /<p\b([^>]*)>/gi
const CLASS_ATTR = /class\s*=\s*"?([\w-]+)"?/i

interface SyncEntry {
  startMs: number
  /** P Class → 텍스트. 이중언어 SMI는 한 SYNC 안에 여러 언어가 들어간다 */
  byClass: Map<string, string>
}

const DEFAULT_CLASS = '__default__'

/**
 * SAMI(.smi) 파서 — 국내 자막에서 여전히 흔한 포맷.
 *
 * SMI에는 종료 시각이 없다. 각 `<SYNC Start=…>`의 종료는 "다음 SYNC의 시작"이며,
 * 내용이 비어 있는(`&nbsp;`) SYNC는 자막을 지우라는 신호다. 즉 빈 SYNC는 큐가
 * 아니라 직전 큐의 종료 지점으로만 쓰인다.
 */
export function parseSmi(text: string): Cue[] {
  const entries = extractSyncEntries(text)
  if (entries.length === 0) {
    throw new SubtitleParseError('SMI에서 <SYNC> 블록을 찾지 못했습니다.', 'smi')
  }

  const dominant = pickDominantClass(entries)
  const cues: Cue[] = []

  entries.forEach((entry, i) => {
    const body = entry.byClass.get(dominant) ?? ''
    if (!body) return // 자막 지움 신호 — 다음 항목의 종료 시각 역할만 한다

    const nextStart = entries[i + 1]?.startMs
    // 마지막 큐는 종료 시각이 없으므로 5초로 가정 (뒤에서 패딩이 더 붙는다)
    const endMs = nextStart ?? entry.startMs + 5000

    cues.push({
      id: `smi-${i}`,
      start: entry.startMs / 1000,
      end: endMs / 1000,
      text: body,
    })
  })

  if (cues.length === 0) {
    throw new SubtitleParseError('SMI에 표시할 자막 텍스트가 없습니다.', 'smi')
  }

  return sanitizeCues(cues)
}

function extractSyncEntries(text: string): SyncEntry[] {
  const entries: SyncEntry[] = []

  // SYNC 태그 위치를 모두 찾아 그 사이 구간을 각 SYNC의 내용으로 자른다
  const marks: { startMs: number; tagStart: number; contentFrom: number }[] = []
  for (const m of text.matchAll(SYNC)) {
    marks.push({ startMs: Number(m[1]), tagStart: m.index, contentFrom: m.index + m[0].length })
  }

  marks.forEach((mark, i) => {
    const contentTo = marks[i + 1]?.tagStart ?? text.length
    entries.push({
      startMs: mark.startMs,
      byClass: parseParagraphs(text.slice(mark.contentFrom, contentTo)),
    })
  })

  return entries.sort((a, b) => a.startMs - b.startMs)
}

function parseParagraphs(chunk: string): Map<string, string> {
  const byClass = new Map<string, string>()
  const pMatches = [...chunk.matchAll(P_TAG)]

  if (pMatches.length === 0) {
    const body = cleanCueText(chunk)
    if (body) byClass.set(DEFAULT_CLASS, body)
    return byClass
  }

  pMatches.forEach((m, i) => {
    const className = m[1].match(CLASS_ATTR)?.[1]?.toUpperCase() ?? DEFAULT_CLASS
    const from = m.index + m[0].length
    const to = i + 1 < pMatches.length ? pMatches[i + 1].index : chunk.length
    const body = cleanCueText(chunk.slice(from, to))
    if (body) byClass.set(className, body)
  })

  return byClass
}

/** 이중언어 SMI에서 실제 대사가 가장 많이 들어 있는 Class를 고른다 */
function pickDominantClass(entries: SyncEntry[]): string {
  const counts = new Map<string, number>()

  for (const entry of entries) {
    for (const [cls, body] of entry.byClass) {
      if (body) counts.set(cls, (counts.get(cls) ?? 0) + 1)
    }
  }

  let best = DEFAULT_CLASS
  let bestCount = -1
  for (const [cls, count] of counts) {
    if (count > bestCount) {
      best = cls
      bestCount = count
    }
  }

  return best
}
