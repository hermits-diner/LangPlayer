/**
 * 받아쓰기 채점 전 정규화.
 *
 * 학습자가 틀린 것과 "표기만 다른 것"을 구분해야 한다. 문장부호나 대소문자로
 * 감점하면 정작 중요한 청취 오류가 묻힌다.
 */

export interface NormalizeOptions {
  /** don't → do not 로 펼쳐서 비교 (축약형 표기 차이 무시) */
  expandContractions: boolean
  /** 대소문자 무시 */
  ignoreCase: boolean
  /** 문장부호 무시 */
  ignorePunctuation: boolean
}

export const DEFAULT_NORMALIZE_OPTIONS: NormalizeOptions = {
  expandContractions: true,
  ignoreCase: true,
  ignorePunctuation: true,
}

const CONTRACTIONS: Record<string, string> = {
  "won't": 'will not',
  "can't": 'cannot',
  "shan't": 'shall not',
  "n't": ' not',
  "'re": ' are',
  "'ve": ' have',
  "'ll": ' will',
  "'m": ' am',
  "'d": ' would',
}

/** 유니코드 굽은 따옴표를 ASCII로 — 자막과 키보드 입력이 서로 다르게 쓴다 */
function normalizeQuotes(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
}

function expandContractions(text: string): string {
  let out = text
  for (const [from, to] of Object.entries(CONTRACTIONS)) {
    out = out.replaceAll(from, to)
  }
  return out
}

export function normalizeForScoring(raw: string, options: Partial<NormalizeOptions> = {}): string {
  const opts = { ...DEFAULT_NORMALIZE_OPTIONS, ...options }

  let text = normalizeQuotes(raw.normalize('NFKC'))
  if (opts.ignoreCase) text = text.toLowerCase()
  if (opts.expandContractions) text = expandContractions(text)

  if (opts.ignorePunctuation) {
    // 하이픈은 공백으로 (well-known → well known), 나머지 부호는 제거.
    // 어퍼스트로피는 축약형 확장 뒤 남은 소유격이므로 지운다.
    text = text.replace(/[-–—]/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '')
  }

  return text.replace(/\s+/g, ' ').trim()
}

export function tokenize(normalized: string): string[] {
  return normalized.length === 0 ? [] : normalized.split(' ')
}

/** 채점용 토큰 배열 */
export function toTokens(raw: string, options?: Partial<NormalizeOptions>): string[] {
  return tokenize(normalizeForScoring(raw, options))
}
