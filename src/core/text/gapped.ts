/**
 * 약형드랩 생성 — 패치에서 일부 단어를 빈칸으로 뚫는다.
 *
 * 전체 받아쓰기는 부담이 크고, 그냥 읽기만 하면 남지 않는다. 그 사이를
 * 메우는 게 빈칸 받아쓰기다. 그래서 두 가지 성질이 필요하다.
 *
 * 1. **결정적이어야 한다.** 같은 패치에서는 늘 같은 빈칸이 나와야 복습이 된다.
 * 2. **길이를 남겨야 한다.** 밑줄 개수가 글자 수 단서가 되어 난이도를 조절한다.
 */

export interface GapOptions {
  /** 빈칸으로 만들 비율 (0~1) */
  ratio: number
  /** 이 길이 미만의 짧은 단어는 건드리지 않는다 — 관사·전치사는 단서가 못 된다 */
  minWordLength: number
}

export const DEFAULT_GAP_OPTIONS: GapOptions = {
  ratio: 0.3,
  minWordLength: 4,
}

const LETTER = /[\p{L}\p{N}]/u

function coreLength(word: string): number {
  let count = 0
  for (const char of word) if (LETTER.test(char)) count++
  return count
}

/** 글자·숫자만 밑줄로 바꾸고 문장부호는 남긴다 — 문장 구조는 단서로 남겨 둔다 */
function blankOut(word: string): string {
  return word.replace(/[\p{L}\p{N}]/gu, '_')
}

export function makeGappedDraft(text: string, options: Partial<GapOptions> = {}): string {
  const { ratio, minWordLength } = { ...DEFAULT_GAP_OPTIONS, ...options }
  if (ratio <= 0) return text

  // 몇 개마다 하나를 뚫을지 — 비율의 역수
  const step = Math.max(1, Math.round(1 / Math.min(1, ratio)))

  // 줄이 바뀌어도 이어서 세야 빈칸이 특정 줄에 몰리지 않는다
  let eligibleSeen = 0

  return text
    .split('\n')
    .map((line) =>
      line
        .split(' ')
        .map((word) => {
          if (coreLength(word) < minWordLength) return word

          eligibleSeen++
          return eligibleSeen % step === 0 ? blankOut(word) : word
        })
        .join(' '),
    )
    .join('\n')
}
