import type { Cue, Segment } from './types'

/**
 * 자막 큐 → 의미 단위 세그먼트.
 *
 * 이 앱의 핵심. SRT 큐는 "화면에 한 번에 띄울 분량"으로 잘려 있어서 한 문장이
 * 2~3개 큐에 흩어지는 일이 흔하다. 그대로 구간 반복을 걸면 문장 중간에서
 * 끊겨 받아쓰기가 불가능하다. 그래서 문장 종결 신호를 기준으로 다시 붙인다.
 *
 * 자동 규칙은 어디까지나 초안이며, UI에서 수동 병합/분할로 교정할 수 있다.
 */

export interface SegmentOptions {
  /** 이 길이를 넘으면 문장이 안 끝났어도 자른다 (반복 학습이 불가능해지므로) */
  maxDurationSec: number
  /** 큐 사이가 이만큼 벌어지면 다른 맥락으로 보고 자른다 */
  maxGapSec: number
  /** 문장부호가 전혀 없는 자동생성 자막용 상한 */
  maxChars: number
  /** 이 길이를 넘어선 뒤로는 짧은 쉼(softGapSec)에서도 자를 수 있다 */
  softDurationSec: number
  softGapSec: number
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  maxDurationSec: 15,
  maxGapSec: 2,
  maxChars: 300,
  softDurationSec: 8,
  softGapSec: 0.4,
}

/** 문장 종결 부호. 닫는 따옴표/괄호가 뒤에 붙는 경우까지 허용 */
const SENTENCE_END = /[.!?…。！？]["'”’」』\)\]]*$/

/**
 * 마침표로 끝나지만 문장 끝이 아닌 것들.
 * 이걸 거르지 않으면 "Mr." 뒤에서 매번 끊긴다.
 */
const ABBREVIATION =
  /(?:^|\s)(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|no|fig|inc|ltd|co|corp|dept|est|approx|e\.g|i\.e|a\.m|p\.m|u\.s|u\.k)\.$/i

/** 이니셜 (J. K. Rowling) */
const INITIAL = /(?:^|\s)[A-Z]\.$/

function endsSentence(text: string): boolean {
  if (!SENTENCE_END.test(text)) return false
  if (ABBREVIATION.test(text)) return false
  if (INITIAL.test(text)) return false
  return true
}

export function buildSegments(cues: Cue[], options: Partial<SegmentOptions> = {}): Segment[] {
  const opts = { ...DEFAULT_SEGMENT_OPTIONS, ...options }
  const segments: Segment[] = []

  let current: Segment | null = null

  for (const cue of cues) {
    if (!current) {
      current = newSegment(cue, segments.length)
      continue
    }

    if (canMerge(current, cue, opts)) {
      current = {
        ...current,
        end: cue.end,
        text: `${current.text} ${cue.text}`,
        cueIds: [...current.cueIds, cue.id],
      }
    } else {
      segments.push(current)
      current = newSegment(cue, segments.length)
    }
  }

  if (current) segments.push(current)

  return segments
}

function newSegment(cue: Cue, index: number): Segment {
  return {
    id: `seg-${index}`,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    cueIds: [cue.id],
  }
}

function canMerge(current: Segment, next: Cue, opts: SegmentOptions): boolean {
  const gap = next.start - current.end
  const mergedDuration = next.end - current.start
  const mergedChars = current.text.length + next.text.length

  // 하드 상한 — 무조건 자른다
  if (gap > opts.maxGapSec) return false
  if (mergedDuration > opts.maxDurationSec) return false
  if (mergedChars > opts.maxChars) return false

  // 문장이 끝났으면 붙이지 않는다
  if (endsSentence(current.text)) return false

  // 문장부호가 없는 자동생성 자막 대비:
  // 이미 충분히 길어졌다면 짧은 쉼도 경계로 인정한다
  if (mergedDuration > opts.softDurationSec && gap >= opts.softGapSec) return false

  return true
}

// ─── 수동 교정 ────────────────────────────────────────────────

/** index 세그먼트를 다음 세그먼트와 합친다 */
export function mergeWithNext(segments: Segment[], index: number): Segment[] {
  const a = segments[index]
  const b = segments[index + 1]
  if (!a || !b) return segments

  const merged: Segment = {
    id: a.id,
    start: a.start,
    end: b.end,
    text: `${a.text} ${b.text}`,
    cueIds: [...a.cueIds, ...b.cueIds],
  }

  return reindex([...segments.slice(0, index), merged, ...segments.slice(index + 2)])
}

/** 세그먼트를 원래 큐 단위로 되돌린다 */
export function splitSegment(segments: Segment[], index: number, cues: Cue[]): Segment[] {
  const target = segments[index]
  if (!target || target.cueIds.length < 2) return segments

  const byId = new Map(cues.map((c) => [c.id, c]))
  const restored = target.cueIds
    .map((id) => byId.get(id))
    .filter((c): c is Cue => Boolean(c))
    .map((c, i) => newSegment(c, index + i))

  if (restored.length < 2) return segments

  return reindex([...segments.slice(0, index), ...restored, ...segments.slice(index + 1)])
}

/** id는 위치 기반이므로 목록이 바뀌면 다시 매긴다 */
function reindex(segments: Segment[]): Segment[] {
  return segments.map((s, i) => ({ ...s, id: `seg-${i}` }))
}

/** 자막 싱크가 밀렸을 때 전체를 offset초만큼 이동 */
export function shiftSegments(segments: Segment[], offsetSec: number): Segment[] {
  return segments.map((s) => ({
    ...s,
    start: Math.max(0, s.start + offsetSec),
    end: Math.max(0, s.end + offsetSec),
  }))
}

/** 현재 재생 위치에 해당하는 세그먼트 index (없으면 -1) */
export function findSegmentAt(segments: Segment[], timeSec: number): number {
  return segments.findIndex((s) => timeSec >= s.start && timeSec < s.end)
}
