/** 자막 파일에서 파싱된 원본 큐 1개 (SRT의 번호 블록 하나에 해당) */
export interface Cue {
  id: string
  /** 초 단위 */
  start: number
  /** 초 단위 */
  end: number
  /** 스타일 태그가 제거된 순수 텍스트. 줄바꿈은 공백으로 합쳐진 상태 */
  text: string
}

/**
 * 학습 단위. 여러 Cue가 한 문장으로 병합된 결과.
 * SRT 큐는 화면 표시용으로 쪼개져 있어 그대로 쓰면 문장 중간에서 끊긴다.
 */
export interface Segment {
  id: string
  start: number
  end: number
  text: string
  /** 이 세그먼트를 구성하는 원본 큐 id들 (분할 복원용) */
  cueIds: string[]
}

export type SubtitleFormat = 'srt' | 'vtt' | 'smi' | 'transcript'

export class SubtitleParseError extends Error {
  constructor(
    message: string,
    readonly format: SubtitleFormat,
  ) {
    super(message)
    this.name = 'SubtitleParseError'
  }
}
