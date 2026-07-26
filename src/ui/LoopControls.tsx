import { useAppStore } from '../store/useAppStore'
import { formatTime } from './format'

const RATES = [0.6, 0.75, 0.9, 1, 1.25]
const GAPS = [
  { ms: 0, label: '없음' },
  { ms: 1000, label: '1초' },
  { ms: 2000, label: '2초' },
  { ms: 3000, label: '3초' },
]

/** 반복 재생 조작 막대 — 학습 중 가장 자주 만지는 값들만 올려둔다 */
export function LoopControls({ onStop }: { onStop: () => void }) {
  const settings = useAppStore((s) => s.loopSettings)
  const status = useAppStore((s) => s.loopStatus)
  const currentTime = useAppStore((s) => s.currentTime)
  const offsetSec = useAppStore((s) => s.offsetSec)
  const hideSubtitles = useAppStore((s) => s.hideSubtitles)
  const autoAdvance = useAppStore((s) => s.autoAdvance)
  const update = useAppStore((s) => s.updateLoopSettings)
  const nudgeOffset = useAppStore((s) => s.nudgeOffset)
  const toggleHide = useAppStore((s) => s.toggleHideSubtitles)
  const toggleAutoAdvance = useAppStore((s) => s.toggleAutoAdvance)

  const isInfinite = !Number.isFinite(settings.repeatCount)

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/10 bg-black/20 px-4 py-2.5 text-sm">
      <div className="flex items-center gap-2 tabular-nums">
        {status.running ? (
          <button type="button" onClick={onStop} className="chip chip-active">
            ■ 정지
          </button>
        ) : (
          <span className="text-slate-600">대기</span>
        )}
        <span className={status.inGap ? 'text-amber-300' : 'text-slate-300'}>
          {status.running ? (status.inGap ? '따라 말하기' : `${status.repeat} / ${isInfinite ? '∞' : status.total}`) : '—'}
        </span>
      </div>

      <Field label="반복">
        <div className="flex items-center gap-1">
          {[1, 2, 3, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => update({ repeatCount: n })}
              className={`chip ${settings.repeatCount === n ? 'chip-active' : ''}`}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            onClick={() => update({ repeatCount: Infinity })}
            className={`chip ${isInfinite ? 'chip-active' : ''}`}
          >
            ∞
          </button>
        </div>
      </Field>

      <Field label="배속">
        <select
          value={settings.rate}
          onChange={(e) => update({ rate: Number(e.target.value) })}
          className="select"
        >
          {RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}x
            </option>
          ))}
        </select>
      </Field>

      <Field label="따라 말할 시간">
        <select value={settings.gapMs} onChange={(e) => update({ gapMs: Number(e.target.value) })} className="select">
          {GAPS.map((gap) => (
            <option key={gap.ms} value={gap.ms}>
              {gap.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="싱크">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => nudgeOffset(-0.1)} className="chip">
            −
          </button>
          <span className="w-14 text-center text-xs tabular-nums text-slate-400">
            {offsetSec > 0 ? '+' : ''}
            {offsetSec.toFixed(1)}s
          </span>
          <button type="button" onClick={() => nudgeOffset(0.1)} className="chip">
            +
          </button>
        </div>
      </Field>

      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={toggleAutoAdvance} className={`chip ${autoAdvance ? 'chip-active' : ''}`}>
          자동 넘김
        </button>
        <button type="button" onClick={toggleHide} className={`chip ${hideSubtitles ? 'chip-active' : ''}`}>
          {hideSubtitles ? '자막 숨김' : '자막 보임'}
        </button>
        <span className="text-xs tabular-nums text-slate-600">{formatTime(currentTime)}</span>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      {children}
    </div>
  )
}
