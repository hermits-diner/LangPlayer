export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'

  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`
}

/** 자막을 가릴 때 글자 대신 보여줄 자리표시 — 단어 수는 남겨 학습 단서를 준다 */
export function maskText(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => '•'.repeat(Math.min(word.length, 8)))
    .join(' ')
}
