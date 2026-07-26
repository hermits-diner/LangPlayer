import { create } from 'zustand'
import { fromDocument, toDocument } from '../core/text/document'
import { segmentKey, useAppStore } from './useAppStore'

/**
 * 텍스트창 상태.
 *
 * 창 배치만 여기서 들고, 내용은 하나도 저장하지 않는다. 위창은 문장별 받아쓰기를
 * 이어 붙인 것이고 아래창은 자막을 이어 붙인 것이라, 둘 다 이미 있는 데이터에서
 * 그때그때 만들어진다. 사본을 따로 두면 어느 쪽이 진짜인지 헷갈릴 뿐이다.
 */

export type TextWindowSize = 'half' | 'full'

interface TextState {
  open: boolean
  /** 아래창(정답 스크립트) 열림 — F2 */
  lowerOpen: boolean
  size: TextWindowSize
  /** 비교 모드 — F9 */
  compare: boolean

  toggleOpen: () => void
  setOpen: (open: boolean) => void
  toggleLower: () => void
  toggleSize: () => void
  toggleCompare: () => void

  /** 받아쓰기 전문 — 문장 하나가 한 줄 */
  getTranscript: () => string
  setTranscript: (document: string) => void
  /** 정답 스크립트 — 자막을 그대로 이어 붙인 것 */
  getReference: () => string

  reset: () => void
}

export const useTextStore = create<TextState>()((set) => ({
  open: false,
  lowerOpen: false,
  size: 'half',
  compare: false,

  toggleOpen: () => set((state) => ({ open: !state.open })),
  setOpen: (open) => set({ open }),
  toggleLower: () => set((state) => ({ lowerOpen: !state.lowerOpen })),
  toggleSize: () => set((state) => ({ size: state.size === 'half' ? 'full' : 'half' })),
  toggleCompare: () => set((state) => ({ compare: !state.compare })),

  getTranscript: () => {
    const { segments, inputs } = useAppStore.getState()
    return toDocument(segments, (segment) => inputs[segmentKey(segment)] ?? '')
  },

  setTranscript: (document) => {
    const store = useAppStore.getState()
    const values = fromDocument(store.segments, document)

    const inputs = { ...store.inputs }
    store.segments.forEach((segment, index) => {
      inputs[segmentKey(segment)] = values[index]
    })

    useAppStore.setState({ inputs })
  },

  getReference: () => {
    const { segments } = useAppStore.getState()
    return toDocument(segments, (segment) => segment.text)
  },

  reset: () => set({ compare: false }),
}))
