import { scoreDictation, type DictationResult } from '../dictation/score'

/**
 * 비교 모드 (F9) — 드랩·약형드랩을 패치와 맞춰 본다.
 *
 * 문장 하나가 한 줄이므로 줄 번호로 짝을 짓는다. 채점은 문장별 받아쓰기와
 * 똑같은 엔진을 쓴다. 어디서 틀렸는지 보여주는 방식이 두 곳에서 달라야 할
 * 이유가 없다.
 */

export interface LineComparison {
  /** 0부터 세는 줄 번호 = 문장 번호 */
  line: number
  reference: string
  input: string
  result: DictationResult
}

export interface DocumentComparison {
  lines: LineComparison[]
  /** 정답 토큰 수로 가중한 전체 정확도 */
  accuracy: number
  /** 한 글자도 안 쓴 줄 수 */
  emptyLines: number
}

/**
 * 약형드랩의 빈칸(`___`)은 아직 안 채운 자리이지 틀린 답이 아니다.
 * 그대로 채점하면 정확도가 엉뚱하게 낮아지므로 지운 뒤 비교한다.
 */
function stripBlanks(text: string): string {
  return text.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function compareDocuments(input: string, reference: string): DocumentComparison {
  const inputLines = input.split('\n')
  const referenceLines = reference.split('\n')
  const count = Math.max(inputLines.length, referenceLines.length)

  const lines: LineComparison[] = []
  let earned = 0
  let total = 0
  let emptyLines = 0

  for (let line = 0; line < count; line++) {
    const referenceLine = (referenceLines[line] ?? '').trim()
    const inputLine = stripBlanks(inputLines[line] ?? '')

    // 양쪽 다 비어 있으면 비교할 것이 없다
    if (!referenceLine && !inputLine) continue
    if (!inputLine) emptyLines++

    const result = scoreDictation(referenceLine, inputLine)
    lines.push({ line, reference: referenceLine, input: inputLine, result })

    // 긴 문장이 짧은 문장과 같은 무게를 갖지 않도록 토큰 수로 가중한다
    earned += result.accuracy * result.referenceTokenCount
    total += result.referenceTokenCount
  }

  return {
    lines,
    accuracy: total === 0 ? 0 : earned / total,
    emptyLines,
  }
}
