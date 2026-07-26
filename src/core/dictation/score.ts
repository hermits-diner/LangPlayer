import { toTokens, type NormalizeOptions } from './normalize'

/**
 * 받아쓰기 채점.
 *
 * 단순 문자열 일치로 O/X를 내면 학습에 쓸모가 없다. 어느 단어를 못 들었고,
 * 무엇으로 잘못 들었는지가 정보다. 그래서 WER(단어 오류율) 정렬을 그대로 쓴다.
 * 편집거리 DP로 정렬하면 삭제/삽입뿐 아니라 "치환"이 나오는데, 이게 곧
 * "A라고 말한 걸 B로 들었다"에 해당한다.
 */

export type TokenStatus =
  /** 정확히 일치 */
  | 'match'
  /** 오타로 보이는 근접 오류 (부분 점수) */
  | 'typo'
  /** 다른 단어로 잘못 들음 */
  | 'substitute'
  /** 못 듣고 빠뜨림 */
  | 'missing'
  /** 없는 단어를 넣음 */
  | 'extra'

export interface DiffToken {
  status: TokenStatus
  /** 학습자가 입력한 토큰. missing이면 null */
  input: string | null
  /** 정답 토큰. extra면 null */
  reference: string | null
}

export interface DictationResult {
  /** 정답 순서대로 정렬된 diff. extra는 해당 위치에 끼어든다 */
  tokens: DiffToken[]
  /** 0..1 */
  accuracy: number
  counts: Record<TokenStatus, number>
  referenceTokenCount: number
  isPerfect: boolean
}

/** 오타로 인정할 최대 편집거리 */
const TYPO_MAX_DISTANCE = 2
/** 짧은 단어의 오류는 오타가 아니라 청취 오류로 본다 (he/we 등) */
const TYPO_MIN_LENGTH = 4
/** 오타의 부분 점수 */
const TYPO_CREDIT = 0.5

export function scoreDictation(
  reference: string,
  input: string,
  options?: Partial<NormalizeOptions>,
): DictationResult {
  const ref = toTokens(reference, options)
  const hyp = toTokens(input, options)
  const tokens = classify(align(ref, hyp))

  const counts: Record<TokenStatus, number> = {
    match: 0,
    typo: 0,
    substitute: 0,
    missing: 0,
    extra: 0,
  }
  for (const token of tokens) counts[token.status]++

  const earned = counts.match + counts.typo * TYPO_CREDIT
  // 정답에 없는 단어를 마구 넣어 점수를 올릴 수 없도록 extra도 감점한다
  const penalized = Math.max(0, earned - counts.extra * TYPO_CREDIT)
  const accuracy = ref.length === 0 ? (hyp.length === 0 ? 1 : 0) : clamp01(penalized / ref.length)

  return {
    tokens,
    accuracy,
    counts,
    referenceTokenCount: ref.length,
    isPerfect: ref.length > 0 && counts.match === ref.length && counts.extra === 0,
  }
}

/**
 * 편집거리 DP + 역추적으로 정답/입력을 정렬한다.
 * 치환을 삭제+삽입보다 먼저 검사해 "잘못 들은 단어" 쌍이 유지되게 한다.
 */
function align(ref: string[], hyp: string[]): DiffToken[] {
  const n = ref.length
  const m = hyp.length

  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 0; i <= n; i++) d[i][0] = i
  for (let j = 0; j <= m; j++) d[0][j] = j

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const substitution = d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)
      d[i][j] = Math.min(substitution, d[i - 1][j] + 1, d[i][j - 1] + 1)
    }
  }

  const out: DiffToken[] = []
  let i = n
  let j = m

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1
      if (d[i][j] === d[i - 1][j - 1] + cost) {
        out.push({
          status: cost === 0 ? 'match' : 'substitute',
          input: hyp[j - 1],
          reference: ref[i - 1],
        })
        i--
        j--
        continue
      }
    }

    if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      out.push({ status: 'missing', input: null, reference: ref[i - 1] })
      i--
      continue
    }

    out.push({ status: 'extra', input: hyp[j - 1], reference: null })
    j--
  }

  return out.reverse()
}

/** 치환 중 오타로 보이는 것을 걸러낸다 */
function classify(tokens: DiffToken[]): DiffToken[] {
  return tokens.map((token) => {
    if (token.status !== 'substitute' || !token.input || !token.reference) return token

    const isNearMiss =
      token.reference.length >= TYPO_MIN_LENGTH &&
      editDistance(token.reference, token.input) <= TYPO_MAX_DISTANCE

    return isNearMiss ? { ...token, status: 'typo' as const } : token
  })
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > TYPO_MAX_DISTANCE) return TYPO_MAX_DISTANCE + 1

  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)

  for (let i = 1; i <= a.length; i++) {
    const curr = new Array<number>(b.length + 1)
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        prev[j] + 1,
        curr[j - 1] + 1,
      )
    }
    prev = curr
  }

  return prev[b.length]
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
