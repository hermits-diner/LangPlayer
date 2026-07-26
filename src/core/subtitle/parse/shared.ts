/** 파서들이 공유하는 텍스트/시간 유틸 */

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
}

/**
 * 스타일 태그를 제거해 순수 학습 텍스트만 남긴다.
 * - HTML 태그: <i> <b> <font color=...> <v Speaker> <c.classname>
 * - ASS 오버라이드: {\an8} {\pos(100,200)}
 * - VTT 인라인 타임스탬프: <00:00:01.000>
 */
export function stripTags(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '') // ASS override
    .replace(/<br\s*\/?>/gi, ' ') // 먼저 공백으로 — 그냥 지우면 단어가 들러붙는다
    .replace(/<[^>]*>/g, '') // HTML/VTT 태그 + 인라인 타임스탬프
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m)
}

/** 줄바꿈을 공백으로 접고 연속 공백을 하나로 — 한 세그먼트는 한 줄로 다룬다 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function cleanCueText(raw: string): string {
  return collapseWhitespace(stripTags(raw))
}

/**
 * `HH:MM:SS,mmm` / `HH:MM:SS.mmm` / `MM:SS.mmm` / `H:MM:SS.cc`(ASS) 를 초로 변환.
 * 파싱 불가면 null.
 */
export function parseTimestamp(raw: string): number | null {
  const m = raw.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/)
  if (!m) return null

  const [, h, mm, ss, frac] = m
  // ASS는 1/100초(2자리), SRT/VTT는 1/1000초(3자리) — 자릿수로 판별
  const fracSeconds = Number(frac) / Math.pow(10, frac.length)

  return Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss) + fracSeconds
}

/** 공백 줄 기준으로 블록 분할 (SRT/VTT 공용) */
export function splitBlocks(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
}

/**
 * 시작시간 정렬 + 겹침/역전 보정.
 * 자막 파일에는 end < start 이거나 다음 큐와 겹치는 경우가 흔하다.
 */
export function sanitizeCues<T extends { start: number; end: number }>(cues: T[]): T[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start)

  return sorted
    .map((cue) => (cue.end > cue.start ? cue : { ...cue, end: cue.start + 1 }))
    .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end))
}
