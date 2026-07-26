import { create } from 'zustand'
import { fromDocument, toDocument } from '../core/text/document'
import { makeGappedDraft } from '../core/text/gapped'
import type { TextKind } from '../core/text/types'
import { segmentKey, useAppStore } from './useAppStore'

/**
 * 텍스트창 상태.
 *
 * 학습 문서(드랩·약형드랩·패치·해석)는 자막·재생과 관심사가 달라 별도 스토어에
 * 둔다. 다만 **드랩만은 문장별 받아쓰기 입력과 같은 데이터**다. 한쪽을 고치면
 * 다른 쪽에 바로 반영돼야 하므로 여기서 양방향으로 이어 준다.
 */

export type TextWindowSize = 'half' | 'full'

interface TextState {
  open: boolean
  /** 아래창(패치 대조용) 열림 — F2 */
  lowerOpen: boolean
  size: TextWindowSize
  /** 위창에 무엇을 띄울지 */
  upperKind: Exclude<TextKind, 'patch'>
  /** 비교 모드 — F9 */
  compare: boolean

  gapped: string
  patch: string
  translation: string

  /** 작업 폴더 이름 (권한을 받은 경우) */
  workspaceName: string | null

  toggleOpen: () => void
  setOpen: (open: boolean) => void
  toggleLower: () => void
  toggleSize: () => void
  toggleCompare: () => void
  setUpperKind: (kind: Exclude<TextKind, 'patch'>) => void

  setText: (kind: TextKind, value: string) => void
  getText: (kind: TextKind) => string
  /** 패치에서 약형드랩을 만들어 위창에 올린다 — Alt+D */
  generateGapped: () => boolean
  /** 자막에서 패치를 채운다 (아직 비어 있을 때만) */
  seedPatchFromSubtitle: () => void

  setWorkspaceName: (name: string | null) => void
  reset: () => void
}

/** 드랩은 문장별 입력에서 만들어진다 — 별도로 들고 있지 않는다 */
function readDraft(): string {
  const { segments, inputs } = useAppStore.getState()
  return toDocument(segments, (segment) => inputs[segmentKey(segment)] ?? '')
}

function writeDraft(document: string): void {
  const store = useAppStore.getState()
  const values = fromDocument(store.segments, document)

  const inputs = { ...store.inputs }
  store.segments.forEach((segment, index) => {
    inputs[segmentKey(segment)] = values[index]
  })

  useAppStore.setState({ inputs })
}

export const useTextStore = create<TextState>()((set, get) => ({
  open: false,
  lowerOpen: false,
  size: 'half',
  upperKind: 'draft',
  compare: false,

  gapped: '',
  patch: '',
  translation: '',

  workspaceName: null,

  toggleOpen: () =>
    set((state) => {
      const open = !state.open
      if (open) get().seedPatchFromSubtitle()
      return { open }
    }),

  setOpen: (open) => {
    if (open) get().seedPatchFromSubtitle()
    set({ open })
  },

  toggleLower: () => set((state) => ({ lowerOpen: !state.lowerOpen })),
  toggleSize: () => set((state) => ({ size: state.size === 'half' ? 'full' : 'half' })),
  toggleCompare: () => set((state) => ({ compare: !state.compare })),
  setUpperKind: (upperKind) => set({ upperKind }),

  setText: (kind, value) => {
    if (kind === 'draft') {
      writeDraft(value)
      // 드랩은 파생값이라 이 스토어에 담지 않는다. 구독자를 깨우기 위해서만 갱신
      set({})
      return
    }
    set({ [kind]: value } as Partial<TextState>)
  },

  getText: (kind) => {
    if (kind === 'draft') return readDraft()
    const state = get()
    return kind === 'gapped' ? state.gapped : kind === 'patch' ? state.patch : state.translation
  },

  generateGapped: () => {
    const patch = get().patch.trim()
    if (!patch) return false

    set({ gapped: makeGappedDraft(patch), upperKind: 'gapped' })
    return true
  },

  seedPatchFromSubtitle: () => {
    if (get().patch.trim()) return // 이미 불러온 패치를 덮어쓰지 않는다

    const { segments } = useAppStore.getState()
    if (segments.length === 0) return
    set({ patch: toDocument(segments, (segment) => segment.text) })
  },

  setWorkspaceName: (workspaceName) => set({ workspaceName }),

  /**
   * 학습 자료를 비운다. 창 배치(열림·크기·아래창)는 사용자 취향이므로 남긴다.
   * 다른 영상으로 넘어갈 때 앞 영상의 패치가 따라오면 안 된다.
   */
  reset: () => set({ compare: false, gapped: '', patch: '', translation: '', upperKind: 'draft' }),
}))
