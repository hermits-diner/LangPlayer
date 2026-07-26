import { describe, expect, it } from 'vitest'
import type { Segment } from '../subtitle/types'
import { compareDocuments } from './compare'
import { fromDocument, toDocument } from './document'

const segment = (id: string, text: string): Segment => ({
  id,
  start: 0,
  end: 1,
  text,
  cueIds: [id],
})

const SEGMENTS = [segment('a', 'First sentence.'), segment('b', 'Second one.'), segment('c', 'Third.')]

describe('문서 ↔ 문장별 값', () => {
  it('문장 하나가 한 줄이 된다', () => {
    const doc = toDocument(SEGMENTS, (s) => s.text)
    expect(doc).toBe('First sentence.\nSecond one.\nThird.')
  })

  it('빈 문장도 줄 자리를 지킨다', () => {
    const values: Record<string, string> = { a: 'written', c: 'also written' }
    const doc = toDocument(SEGMENTS, (s) => values[s.id] ?? '')

    expect(doc.split('\n')).toEqual(['written', '', 'also written'])
  })

  it('왕복해도 값이 유지된다', () => {
    const doc = toDocument(SEGMENTS, (s) => s.text)
    expect(fromDocument(SEGMENTS, doc)).toEqual(['First sentence.', 'Second one.', 'Third.'])
  })

  it('줄이 모자라면 빈 문자열로 채운다', () => {
    expect(fromDocument(SEGMENTS, 'only one line')).toEqual(['only one line', '', ''])
  })

  it('줄이 남으면 마지막 문장에 붙여 내용을 잃지 않는다', () => {
    const result = fromDocument(SEGMENTS, 'one\ntwo\nthree\nextra line\nmore')
    expect(result[2]).toBe('three extra line more')
  })

  it('문장 안의 줄바꿈은 공백으로 접어 한 줄 규칙을 지킨다', () => {
    const doc = toDocument([segment('a', 'line one\nline two')], (s) => s.text)
    expect(doc).toBe('line one line two')
  })

  it('문장이 없으면 빈 배열', () => {
    expect(fromDocument([], 'anything')).toEqual([])
  })
})

describe('compareDocuments', () => {
  const reference = 'The quick brown fox\nJumps over the lazy dog'

  it('완전히 같으면 100%', () => {
    const result = compareDocuments(reference, reference)

    expect(result.accuracy).toBe(1)
    expect(result.lines).toHaveLength(2)
  })

  it('줄 번호로 짝을 짓는다', () => {
    const result = compareDocuments('The quick brown fox\nWrong line entirely', reference)

    expect(result.lines[0].result.accuracy).toBe(1)
    expect(result.lines[1].result.accuracy).toBeLessThan(0.5)
  })

  it('빈 줄을 센다', () => {
    const result = compareDocuments('The quick brown fox\n', reference)
    expect(result.emptyLines).toBe(1)
  })

  it('긴 문장이 더 큰 비중을 갖는다', () => {
    const long = 'one\nalpha bravo charlie delta echo foxtrot golf hotel'
    // 짧은 줄만 맞히면 전체 정확도는 낮아야 한다
    const result = compareDocuments('one\n', long)

    expect(result.accuracy).toBeLessThan(0.2)
  })

  it('양쪽 다 빈 줄은 건너뛴다', () => {
    const result = compareDocuments('a\n\nb', 'a\n\nb')
    expect(result.lines).toHaveLength(2)
  })
})
