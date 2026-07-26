import { describe, expect, it } from 'vitest'
import { toSrt } from './export'
import { parseSrt } from './parse/srt'
import type { Segment } from './types'

function segment(partial: Partial<Segment> & Pick<Segment, 'start' | 'end' | 'text'>): Segment {
  return { id: 'seg-0', cueIds: ['srt-0'], ...partial }
}

describe('toSrt', () => {
  it('SRT 시각 표기로 쓴다', () => {
    const out = toSrt([segment({ start: 1.5, end: 3.25, text: 'Hello there.' })])

    expect(out).toBe('1\n00:00:01,500 --> 00:00:03,250\nHello there.\n')
  })

  it('한 시간이 넘어가도 시·분·초가 어긋나지 않는다', () => {
    const out = toSrt([segment({ start: 3661.007, end: 3662, text: 'ok' })])

    expect(out).toContain('01:01:01,007 --> 01:01:02,000')
  })

  it('내보낸 파일을 다시 읽으면 편집 결과가 그대로 돌아온다', () => {
    const edited = [
      segment({ start: 0.4, end: 2, text: '고친 첫 문장' }),
      segment({ start: 2, end: 5.75, text: '합쳐서 길어진 두 번째 문장' }),
    ]

    const cues = parseSrt(toSrt(edited))

    expect(cues.map((c) => c.text)).toEqual(['고친 첫 문장', '합쳐서 길어진 두 번째 문장'])
    expect(cues.map((c) => [c.start, c.end])).toEqual([
      [0.4, 2],
      [2, 5.75],
    ])
  })

  it('빈 문장은 빼고 번호를 다시 매긴다', () => {
    const out = toSrt([
      segment({ start: 0, end: 1, text: '있음' }),
      segment({ start: 1, end: 2, text: '   ' }),
      segment({ start: 2, end: 3, text: '또 있음' }),
    ])

    expect(out.match(/^\d+$/gm)).toEqual(['1', '2'])
    expect(out).not.toContain('00:00:01,000 --> 00:00:02,000')
  })

  it('싱크를 앞으로 밀어 음수가 된 시각은 0으로 잡는다', () => {
    const out = toSrt([segment({ start: -1.2, end: 0.5, text: '앞으로 밀렸다' })])

    expect(out).toContain('00:00:00,000 --> 00:00:00,500')
  })

  it('길이가 0인 구간도 플레이어가 건너뛰지 않게 최소 길이를 준다', () => {
    const out = toSrt([segment({ start: 2, end: 2, text: '순간' })])

    expect(out).toContain('00:00:02,000 --> 00:00:02,001')
  })

  it('줄바꿈이 섞인 문장도 한 줄로 접는다 — 한 문장이 한 큐다', () => {
    const out = toSrt([segment({ start: 0, end: 1, text: '앞줄\n  뒷줄' })])

    expect(out).toBe('1\n00:00:00,000 --> 00:00:01,000\n앞줄 뒷줄\n')
  })
})
