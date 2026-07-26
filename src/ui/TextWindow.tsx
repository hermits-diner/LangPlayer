import { useMemo, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { useTextStore } from '../store/useTextStore'

/**
 * 텍스트창.
 *
 * 문장별로 오가며 받아쓰던 것을 **한 편의 글로 놓고** 고치는 자리다.
 * 위창은 내 받아쓰기 전문, 아래창(F2)은 자막 원문이다. 둘 다 별도로 보관하지
 * 않고 그때그때 만들어지므로 어디를 고쳐도 한 곳만 바뀐다.
 */

export interface TextWindowProps {
  /** 커서가 놓인 줄의 문장으로 옮긴다. play가 참이면 그 구간을 재생한다 */
  onFocusLine: (line: number, play: boolean) => void
}

/** 커서 위치가 몇 번째 줄인지 — 한 줄이 한 문장이라 곧 문장 번호다 */
function lineAtCursor(textarea: HTMLTextAreaElement): number {
  return textarea.value.slice(0, textarea.selectionStart).split('\n').length - 1
}

function fileNameFor(mediaName: string | undefined): string {
  if (!mediaName) return 'transcript.txt'
  const dot = mediaName.lastIndexOf('.')
  return `${dot === -1 ? mediaName : mediaName.slice(0, dot)}.txt`
}

export function TextWindow({ onFocusLine }: TextWindowProps) {
  const open = useTextStore((s) => s.open)
  const lowerOpen = useTextStore((s) => s.lowerOpen)
  const size = useTextStore((s) => s.size)
  const setTranscript = useTextStore((s) => s.setTranscript)
  const toggleLower = useTextStore((s) => s.toggleLower)
  const toggleSize = useTextStore((s) => s.toggleSize)
  const setOpen = useTextStore((s) => s.setOpen)

  const media = useAppStore((s) => s.media)
  const inputs = useAppStore((s) => s.inputs)
  const segments = useAppStore((s) => s.segments)

  const [busy, setBusy] = useState(false)
  const lastLine = useRef(-1)

  // 받아쓰기가 바뀌면 전문도 다시 만들어진다
  const transcript = useMemo(
    () => useTextStore.getState().getTranscript(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inputs, segments],
  )
  const reference = useMemo(
    () => useTextStore.getState().getReference(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segments],
  )

  /**
   * 커서가 놓인 줄을 현재 문장으로 삼는다.
   *
   * 한 줄이 한 문장이므로 줄 번호가 곧 문장 번호다. Enter로 줄을 넘기면 다음
   * 문장이 재생되고, 마우스로 다른 줄을 짚으면 그 문장으로 옮겨간다. 전체
   * 스크립트를 한 문서로 써 내려가면서도 듣기가 따라오게 하기 위해서다.
   */
  const syncCursorLine = (textarea: HTMLTextAreaElement, play: boolean) => {
    const line = lineAtCursor(textarea)
    if (line === lastLine.current && !play) return

    lastLine.current = line
    onFocusLine(line, play)
  }

  const save = () => {
    if (!transcript.trim()) {
      useAppStore.getState().setNotice('저장할 내용이 없습니다.')
      return
    }

    const url = URL.createObjectURL(new Blob([transcript], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileNameFor(media?.name)
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)

    useAppStore.getState().setNotice(`${link.download}으로 내려받았습니다.`)
  }

  const load = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.txt,text/plain'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setBusy(true)
      setTranscript(await file.text())
      setBusy(false)
      useAppStore.getState().setNotice(`${file.name}을 불러왔습니다.`)
    }
    input.click()
  }

  if (!open) return null

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-30 flex flex-col border-t border-white/15 bg-ink-950 ${
        size === 'full' ? 'h-full' : 'h-1/2'
      }`}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/10 px-3 py-2">
        <span className="text-xs font-semibold text-slate-300">받아쓰기 전문</span>
        <span className="text-[11px] text-slate-600">한 줄이 한 문장 · Enter로 다음 문장</span>

        <span className="mx-1 h-4 w-px bg-white/10" />

        <button type="button" onClick={toggleLower} className={`chip ${lowerOpen ? 'chip-active' : ''}`}>
          자막 원문 <kbd className="kbd ml-0.5">F2</kbd>
        </button>
        <button type="button" onClick={toggleSize} className="chip">
          {size === 'half' ? '크게' : '줄이기'} <kbd className="kbd ml-0.5">F12</kbd>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={load} className="chip" disabled={busy}>
            불러오기
          </button>
          <button type="button" onClick={save} className="chip">
            저장 <kbd className="kbd ml-0.5">Ctrl+S</kbd>
          </button>
          <button type="button" onClick={() => setOpen(false)} className="chip">
            닫기
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            // 줄바꿈은 그대로 두고(한 줄 = 한 문장), 커서가 옮겨간 줄만 따라간다
            onKeyUp={(e) => syncCursorLine(e.currentTarget, e.key === 'Enter')}
            onClick={(e) => syncCursorLine(e.currentTarget, false)}
            spellCheck={false}
            placeholder="들리는 대로 받아쓰세요. 여기서 고치면 문장별 받아쓰기에도 그대로 반영됩니다."
            className="dictation-input h-full w-full resize-none bg-transparent p-3 text-sm text-slate-100 outline-none placeholder:text-slate-600"
          />
        </div>

        {lowerOpen && (
          <div className="flex min-h-0 flex-1 flex-col border-t border-white/10">
            <div className="flex items-baseline gap-2 px-3 pt-1.5">
              <span className="text-[11px] text-slate-500">자막 원문</span>
              <span className="text-[10.5px] text-slate-700">고치면 자막이 바뀝니다</span>
            </div>
            {/* 자동생성 자막의 오타를 한 화면에서 훑어 잡을 수 있어야 한다 */}
            <textarea
              value={reference}
              onChange={(e) => useTextStore.getState().setReference(e.target.value)}
              spellCheck={false}
              className="dictation-input min-h-0 flex-1 resize-none bg-transparent px-3 pb-3 text-sm text-slate-400 outline-none"
            />
          </div>
        )}
      </div>
    </div>
  )
}

