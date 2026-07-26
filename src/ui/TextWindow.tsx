import { useMemo, useState } from 'react'
import { compareDocuments } from '../core/text/compare'
import { TEXT_KINDS, TEXT_KIND_ORDER, type TextKind } from '../core/text/types'
import { useAppStore } from '../store/useAppStore'
import { useTextStore } from '../store/useTextStore'
import { DiffView } from './DiffView'
import { useWorkspace } from './useWorkspace'

/**
 * 텍스트창.
 *
 * 문장별로 오가며 받아쓰던 것을 **한 편의 글로 놓고** 고치는 자리다.
 * 위창에는 내 드랩(또는 약형드랩), 아래창에는 정답인 패치를 둔다.
 * F9 비교 모드는 문장별 채점과 똑같은 엔진으로 줄마다 대조한다.
 */
export function TextWindow() {
  const open = useTextStore((s) => s.open)
  const lowerOpen = useTextStore((s) => s.lowerOpen)
  const size = useTextStore((s) => s.size)
  const upperKind = useTextStore((s) => s.upperKind)
  const compare = useTextStore((s) => s.compare)
  const patch = useTextStore((s) => s.patch)
  const gapped = useTextStore((s) => s.gapped)
  const translation = useTextStore((s) => s.translation)
  const inputs = useAppStore((s) => s.inputs)
  const segments = useAppStore((s) => s.segments)

  const setText = useTextStore((s) => s.setText)
  const setUpperKind = useTextStore((s) => s.setUpperKind)
  const toggleLower = useTextStore((s) => s.toggleLower)
  const toggleSize = useTextStore((s) => s.toggleSize)
  const toggleCompare = useTextStore((s) => s.toggleCompare)
  const setOpen = useTextStore((s) => s.setOpen)
  const generateGapped = useTextStore((s) => s.generateGapped)

  const workspace = useWorkspace()
  const [menu, setMenu] = useState<'save' | 'load' | null>(null)

  // inputs/segments가 바뀌면 드랩도 다시 만들어진다
  const upperText = useMemo(
    () => useTextStore.getState().getText(upperKind),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [upperKind, inputs, segments, gapped, translation],
  )

  const comparison = useMemo(
    () => (compare ? compareDocuments(upperText, patch) : null),
    [compare, upperText, patch],
  )

  if (!open) return null

  const heightClass = size === 'full' ? 'h-full' : 'h-1/2'

  const pick = (kind: TextKind) => {
    if (menu === 'save') void workspace.save(kind)
    else void workspace.load(kind)
    setMenu(null)
  }

  return (
    <div className={`absolute inset-x-0 bottom-0 z-30 flex flex-col border-t border-white/15 bg-ink-950 ${heightClass}`}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/10 px-3 py-2">
        <span className="text-xs font-semibold text-slate-300">텍스트창</span>

        <div className="flex items-center gap-1">
          {(['draft', 'gapped', 'translation'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setUpperKind(kind)}
              className={`chip ${upperKind === kind ? 'chip-active' : ''}`}
            >
              {TEXT_KINDS[kind].label}
            </button>
          ))}
        </div>

        <span className="mx-1 h-4 w-px bg-white/10" />

        <button type="button" onClick={() => setMenu(menu === 'load' ? null : 'load')} className="chip">
          불러오기
        </button>
        <button type="button" onClick={() => setMenu(menu === 'save' ? null : 'save')} className="chip">
          저장
        </button>
        <button
          type="button"
          onClick={() => {
            if (!generateGapped()) useAppStore.getState().setError('먼저 패치를 채워 주세요 (아래창).')
          }}
          className="chip"
          title="패치에서 빈칸을 뚫어 약형드랩을 만듭니다 (Alt+D)"
        >
          약형드랩 만들기
        </button>

        <span className="mx-1 h-4 w-px bg-white/10" />

        <button type="button" onClick={toggleCompare} className={`chip ${compare ? 'chip-active' : ''}`}>
          비교 F9
        </button>
        <button type="button" onClick={toggleLower} className={`chip ${lowerOpen ? 'chip-active' : ''}`}>
          아래창 F2
        </button>
        <button type="button" onClick={toggleSize} className="chip">
          {size === 'half' ? '크게 F12' : '줄이기 F12'}
        </button>

        <div className="ml-auto flex items-center gap-2">
          {workspace.supported ? (
            workspace.workspaceName ? (
              <button
                type="button"
                onClick={() => void workspace.disconnect()}
                className="text-[11px] text-emerald-400/80 underline decoration-dotted underline-offset-2"
                title="작업 폴더 연결 해제"
              >
                📁 {workspace.workspaceName}
              </button>
            ) : (
              <button type="button" onClick={() => void workspace.connect()} className="chip">
                작업 폴더 연결
              </button>
            )
          ) : (
            <span className="text-[11px] text-slate-600">이 브라우저는 폴더 저장을 지원하지 않습니다</span>
          )}
          <button type="button" onClick={() => setOpen(false)} className="chip">
            닫기
          </button>
        </div>
      </header>

      {menu && (
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
          <span className="text-slate-500">{menu === 'save' ? '무엇을 저장할까요?' : '무엇을 불러올까요?'}</span>
          {TEXT_KIND_ORDER.map((kind) => (
            <button key={kind} type="button" onClick={() => pick(kind)} className="chip">
              {TEXT_KINDS[kind].label} ({TEXT_KINDS[kind].accessKey})
            </button>
          ))}
          <button type="button" onClick={() => setMenu(null)} className="ml-auto chip">
            취소
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {comparison ? (
            <ComparisonView comparison={comparison} />
          ) : (
            <textarea
              value={upperText}
              onChange={(e) => setText(upperKind, e.target.value)}
              spellCheck={false}
              placeholder={
                upperKind === 'draft'
                  ? '문장 하나가 한 줄입니다. 여기서 고치면 문장별 받아쓰기에도 반영됩니다.'
                  : `${TEXT_KINDS[upperKind].label}을 입력하거나 불러오세요.`
              }
              className="dictation-input h-full w-full resize-none bg-transparent p-3 text-sm text-slate-100 outline-none placeholder:text-slate-600"
            />
          )}
        </div>

        {lowerOpen && (
          <div className="flex min-h-0 flex-1 flex-col border-t border-white/10">
            <div className="px-3 pt-1.5 text-[11px] text-slate-500">패치 (정답)</div>
            <textarea
              value={patch}
              onChange={(e) => setText('patch', e.target.value)}
              spellCheck={false}
              placeholder="자막에서 자동으로 채워집니다. 다른 정답본이 있으면 불러오세요."
              className="dictation-input min-h-0 flex-1 resize-none bg-transparent px-3 pb-3 text-sm text-slate-300 outline-none placeholder:text-slate-600"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ComparisonView({ comparison }: { comparison: ReturnType<typeof compareDocuments> }) {
  const setActiveIndex = useAppStore((s) => s.setActiveIndex)

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-slate-500">전체 정확도</span>
        <span className="text-lg font-semibold tabular-nums text-slate-100">
          {Math.round(comparison.accuracy * 100)}%
        </span>
        {comparison.emptyLines > 0 && (
          <span className="text-xs text-slate-600">아직 안 쓴 줄 {comparison.emptyLines}개</span>
        )}
      </div>

      {comparison.lines.map(({ line, result }) => (
        <div key={line} className="rounded-lg border border-white/10 bg-black/20 p-3">
          <button
            type="button"
            onClick={() => setActiveIndex(line)}
            className="mb-1.5 text-[11px] text-slate-600 transition hover:text-sky-400"
          >
            {line + 1}번 문장
          </button>
          <DiffView result={result} />
        </div>
      ))}
    </div>
  )
}
