import { scoreDictation, type DictationResult } from '../dictation/score'

/**
 * 정답 대조 (F9) — 받아쓰기 전문을 자막 원문과 맞춰 본다.
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
 * 밑줄(`___`)은 못 알아들어 비워 둔 자리로 본다.
 *
 * 받아쓰다 안 들리는 단어를 밑줄로 남기는 건 흔한 습관이다. 그걸 오답으로
 * 세면 "틀리게 들었다"와 "못 들었다"가 뭉개진다. 지우고 비교하면 누락으로만
 * 잡힌다.
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
