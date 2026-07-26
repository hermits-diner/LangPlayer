import { describe, expect, it } from 'vitest'
import type { Segment } from '../subtitle/types'
import { compareDocuments } from './compare'
import { fromDocument, toDocument } from './document'
import { makeGappedDraft } from './gapped'
import { fileNameFor, baseNameOf } from './types'

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

describe('makeGappedDraft', () => {
  it('같은 입력에서 항상 같은 빈칸이 나온다', () => {
    const text = 'The quick brown fox jumps over the lazy dog again'
    expect(makeGappedDraft(text)).toBe(makeGappedDraft(text))
  })

  it('짧은 단어는 건드리지 않는다', () => {
    const result = makeGappedDraft('a an the of to in on', { minWordLength: 4 })
    expect(result).toBe('a an the of to in on')
  })

  it('빈칸은 글자 수만큼 밑줄로 남는다', () => {
    const result = makeGappedDraft('alpha bravo charlie delta echo foxtrot', { ratio: 1, minWordLength: 4 })

    expect(result).toBe('_____ _____ _______ _____ ____ _______')
  })

  it('문장부호는 남겨 문장 구조를 단서로 준다', () => {
    const result = makeGappedDraft('Hello, world!', { ratio: 1, minWordLength: 4 })
    expect(result).toBe('_____, _____!')
  })

  it('비율이 낮으면 일부만 뚫린다', () => {
    const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'
    const result = makeGappedDraft(words, { ratio: 0.5, minWordLength: 4 })
    const blanked = result.split(' ').filter((w) => w.includes('_')).length

    expect(blanked).toBe(5)
  })

  it('빈칸이 한 줄에 몰리지 않는다', () => {
    const text = ['alpha bravo charlie', 'delta echo foxtrot', 'golf hotel india'].join('\n')
    const lines = makeGappedDraft(text, { ratio: 1 / 3, minWordLength: 4 }).split('\n')

    // 줄이 바뀌어도 이어서 세므로 각 줄에 고르게 퍼진다
    for (const line of lines) expect(line).toMatch(/_/)
  })

  it('ratio가 0이면 원본 그대로', () => {
    expect(makeGappedDraft('some text here', { ratio: 0 })).toBe('some text here')
  })
})

describe('compareDocuments', () => {
  const patch = 'The quick brown fox\nJumps over the lazy dog'

  it('완전히 같으면 100%', () => {
    const result = compareDocuments(patch, patch)

    expect(result.accuracy).toBe(1)
    expect(result.lines).toHaveLength(2)
  })

  it('줄 번호로 짝을 짓는다', () => {
    const result = compareDocuments('The quick brown fox\nWrong line entirely', patch)

    expect(result.lines[0].result.accuracy).toBe(1)
    expect(result.lines[1].result.accuracy).toBeLessThan(0.5)
  })

  it('약형드랩의 빈칸은 오답으로 세지 않는다', () => {
    const gapped = 'The _____ brown fox\nJumps over the lazy dog'
    const result = compareDocuments(gapped, patch)

    // 'quick'을 못 채운 것은 누락이지만, 밑줄 자체가 오답으로 잡히면 안 된다
    expect(result.lines[0].result.counts.substitute).toBe(0)
    expect(result.lines[0].result.counts.missing).toBe(1)
  })

  it('빈 줄을 센다', () => {
    const result = compareDocuments('The quick brown fox\n', patch)
    expect(result.emptyLines).toBe(1)
  })

  it('긴 문장이 더 큰 비중을 갖는다', () => {
    const reference = 'one\nalpha bravo charlie delta echo foxtrot golf hotel'
    // 짧은 줄만 맞히면 전체 정확도는 낮아야 한다
    const result = compareDocuments('one\n', reference)

    expect(result.accuracy).toBeLessThan(0.2)
  })

  it('양쪽 다 빈 줄은 건너뛴다', () => {
    const result = compareDocuments('a\n\nb', 'a\n\nb')
    expect(result.lines).toHaveLength(2)
  })
})

describe('파일 이름 규칙', () => {
  it('확장자를 떼어 기준 이름을 얻는다', () => {
    expect(baseNameOf('ap1102-1.mp3')).toBe('ap1102-1')
    expect(baseNameOf('no-extension')).toBe('no-extension')
  })

  it('종류별 접두사를 붙인다', () => {
    expect(fileNameFor('draft', 'ap1102-1.mp3')).toBe('dap1102-1.txt')
    expect(fileNameFor('gapped', 'ap1102-1.mp3')).toBe('gap1102-1.txt')
    expect(fileNameFor('patch', 'ap1102-1.mp3')).toBe('pap1102-1.txt')
    expect(fileNameFor('translation', 'ap1102-1.mp3')).toBe('tap1102-1.txt')
  })
})
