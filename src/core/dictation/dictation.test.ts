import { describe, expect, it } from 'vitest'
import { normalizeForScoring, toTokens } from './normalize'
import { scoreDictation } from './score'

describe('normalizeForScoring', () => {
  it('대소문자와 문장부호를 지운다', () => {
    expect(normalizeForScoring('Hello, World!')).toBe('hello world')
  })

  it('굽은 따옴표를 ASCII로 통일한다', () => {
    expect(normalizeForScoring('don’t')).toBe(normalizeForScoring("don't")) // ' vs '
  })

  it('축약형을 펼쳐 표기 차이를 없앤다', () => {
    expect(normalizeForScoring("I don't know")).toBe(normalizeForScoring('I do not know'))
    expect(normalizeForScoring("can't")).toBe('cannot')
    expect(normalizeForScoring("won't")).toBe('will not')
  })

  it('하이픈은 공백으로 바꾼다', () => {
    expect(normalizeForScoring('well-known')).toBe('well known')
  })

  it('빈 문자열은 토큰 0개', () => {
    expect(toTokens('   ')).toEqual([])
  })
})

describe('scoreDictation', () => {
  it('완전 일치는 100%', () => {
    const result = scoreDictation('The quick brown fox', 'the quick brown fox')

    expect(result.accuracy).toBe(1)
    expect(result.isPerfect).toBe(true)
    expect(result.counts.match).toBe(4)
  })

  it('문장부호만 달라도 100%', () => {
    const result = scoreDictation('Hello, world!', 'hello world')
    expect(result.accuracy).toBe(1)
  })

  it('단어 하나를 빠뜨리면 missing으로 잡는다', () => {
    const result = scoreDictation('the quick brown fox', 'the quick fox')

    expect(result.counts.missing).toBe(1)
    expect(result.accuracy).toBeCloseTo(3 / 4)
    expect(result.tokens.find((t) => t.status === 'missing')?.reference).toBe('brown')
  })

  it('잘못 들은 단어는 substitute 쌍으로 남는다', () => {
    const result = scoreDictation('I can see the ship', 'I can see the sheep')
    const sub = result.tokens.find((t) => t.status === 'substitute' || t.status === 'typo')

    expect(sub).toMatchObject({ reference: 'ship', input: 'sheep' })
  })

  it('오타는 substitute가 아니라 typo로 부분 점수를 준다', () => {
    const typo = scoreDictation('the beautiful morning', 'the beatiful morning')
    expect(typo.counts.typo).toBe(1)
    expect(typo.accuracy).toBeCloseTo(2.5 / 3)

    // 짧은 단어의 오류는 오타가 아니라 청취 오류로 본다
    const misheard = scoreDictation('he went home', 'we went home')
    expect(misheard.counts.substitute).toBe(1)
    expect(misheard.counts.typo).toBe(0)
  })

  it('없는 단어를 넣으면 extra로 잡고 감점한다', () => {
    const result = scoreDictation('I see you', 'I can see you')

    expect(result.counts.extra).toBe(1)
    expect(result.tokens.find((t) => t.status === 'extra')?.input).toBe('can')
    expect(result.accuracy).toBeLessThan(1)
  })

  it('빈 입력은 전부 missing이고 0점', () => {
    const result = scoreDictation('the quick brown fox', '')

    expect(result.accuracy).toBe(0)
    expect(result.counts.missing).toBe(4)
    expect(result.tokens).toHaveLength(4)
  })

  it('전혀 다른 문장이어도 점수는 0 아래로 내려가지 않는다', () => {
    const result = scoreDictation('one two', 'completely different words here now')
    expect(result.accuracy).toBeGreaterThanOrEqual(0)
  })

  it('diff 토큰이 정답 순서를 유지한다', () => {
    const result = scoreDictation('a b c', 'a x c')
    expect(result.tokens.map((t) => t.reference)).toEqual(['a', 'b', 'c'])
  })

  it('축약형으로 받아써도 정답 처리한다', () => {
    const result = scoreDictation("I don't think so", 'I do not think so')
    expect(result.accuracy).toBe(1)
  })

  it('어순이 뒤바뀌면 감점된다', () => {
    const result = scoreDictation('the cat sat on the mat', 'the mat sat on the cat')
    expect(result.accuracy).toBeLessThan(1)
    expect(result.isPerfect).toBe(false)
  })
})
