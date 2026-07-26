/**
 * 텍스트창이 다루는 네 가지 학습 문서.
 *
 * - **패치**: 정답 스크립트. 자막에서 자동으로 만들어지고, 교정에 기준이 된다.
 * - **드랩**: 학습자가 받아쓴 초안. 문장별 입력을 한 문서로 이어 붙인 것.
 * - **약형드랩**: 패치에서 일부 단어를 빈칸으로 뚫은 것. 부분 받아쓰기용.
 * - **해석**: 우리말 번역.
 *
 * 저장 시 종류마다 정해진 폴더와 파일명 접두사를 쓴다.
 * 예) `ap1102-1.mp3` → `Drafts/dap1102-1.txt`
 */
export type TextKind = 'draft' | 'gapped' | 'patch' | 'translation'

export interface TextKindInfo {
  label: string
  /** 저장 폴더 이름 */
  folder: string
  /** 파일명 접두사 */
  prefix: string
  /** 대화창에서 고를 때 쓰는 글자 */
  accessKey: string
}

export const TEXT_KINDS: Record<TextKind, TextKindInfo> = {
  draft: { label: '드랩', folder: 'Drafts', prefix: 'd', accessKey: 'D' },
  gapped: { label: '약형드랩', folder: 'Gapped Drafts', prefix: 'g', accessKey: 'G' },
  patch: { label: '패치', folder: 'Patches', prefix: 'p', accessKey: 'P' },
  translation: { label: '해석', folder: 'Translations', prefix: 't', accessKey: 'T' },
}

export const TEXT_KIND_ORDER: TextKind[] = ['draft', 'gapped', 'patch', 'translation']

/** 미디어 파일명에서 확장자를 떼어 학습 자료의 기준 이름을 얻는다 */
export function baseNameOf(mediaName: string): string {
  const dot = mediaName.lastIndexOf('.')
  return dot === -1 ? mediaName : mediaName.slice(0, dot)
}

/** `ap1102-1.mp3` + 드랩 → `dap1102-1.txt` */
export function fileNameFor(kind: TextKind, mediaName: string): string {
  return `${TEXT_KINDS[kind].prefix}${baseNameOf(mediaName)}.txt`
}
