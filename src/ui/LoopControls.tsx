import { useAppStore } from '../store/useAppStore'
import { formatTime } from './format'
import { useAutoSync } from './useAutoSync'

const RATES = [0.6, 0.75, 0.9, 1, 1.25]
const GAPS = [
  { ms: 0, label: '없음' },
  { ms: 1000, label: '1초' },
  { ms: 2000, label: '2초' },
  { ms: 3000, label: '3초' },
]

export interface LoopControlsProps {
  onStop: () => void
  /** 탭 맞추기 시작 — 문장 시작 조금 전부터 재생한다 */
  onTapSyncStart: () => void
  /** 소리가 시작된 순간을 찍는다 */
  onTapSyncMark: () => void
  tapMode: boolean
}

/** 반복 재생 조작 막대 — 학습 중 가장 자주 만지는 값들만 올려둔다 */
export function LoopControls({ onStop, onTapSyncStart, onTapSyncMark, tapMode }: LoopControlsProps) {
  const settings = useAppStore((s) => s.loopSettings)
  const status = useAppStore((s) => s.loopStatus)
  const currentTime = useAppStore((s) => s.currentTime)
  const sync = useAppStore((s) => s.sync)
  const mediaKind = useAppStore((s) => s.media?.kind)
  const hideSubtitles = useAppStore((s) => s.hideSubtitles)
  const autoAdvance = useAppStore((s) => s.autoAdvance)
  const gradingEnabled = useAppStore((s) => s.gradingEnabled)
  const toggleGrading = useAppStore((s) => s.toggleGrading)
  const update = useAppStore((s) => s.updateLoopSettings)
  const nudgeOffset = useAppStore((s) => s.nudgeOffset)
  const resetSync = useAppStore((s) => s.resetSync)
  const toggleHide = useAppStore((s) => s.toggleHideSubtitles)
  const toggleAutoAdvance = useAppStore((s) => s.toggleAutoAdvance)

  const auto = useAutoSync()
  const isInfinite = !Number.isFinite(settings.repeatCount)
  const isAdjusted = sync.offsetSec !== 0 || sync.scale !== 1

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
          <button type="button" onClick={() => nudgeOffset(-0.1)} className="chip" title="자막을 0.1초 앞으로">
            −
          </button>
          <span
            className={`w-16 text-center text-xs tabular-nums ${isAdjusted ? 'text-sky-300' : 'text-slate-400'}`}
            title={sync.scale !== 1 ? `재생속도 차이 ${(sync.scale * 100 - 100).toFixed(1)}% 보정됨` : undefined}
          >
            {sync.offsetSec > 0 ? '+' : ''}
            {sync.offsetSec.toFixed(1)}s{sync.scale !== 1 ? '*' : ''}
          </span>
          <button type="button" onClick={() => nudgeOffset(0.1)} className="chip" title="자막을 0.1초 뒤로">
            +
          </button>

          {auto.running ? (
            <button type="button" onClick={auto.cancel} className="chip chip-active">
              맞추는 중 · 취소
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void auto.run()}
              disabled={mediaKind === 'youtube'}
              title={
                mediaKind === 'youtube'
                  ? 'YouTube는 오디오에 접근할 수 없어 자동 맞춤을 쓸 수 없습니다'
                  : '음성과 자막을 대조해 자동으로 맞춥니다'
              }
              className="chip disabled:cursor-not-allowed disabled:opacity-40"
            >
              자동 맞춤
            </button>
          )}

          {tapMode ? (
            <button type="button" onClick={onTapSyncMark} className="chip chip-active animate-pulse">
              지금! 소리 시작 순간 클릭
            </button>
          ) : (
            <button
              type="button"
              onClick={onTapSyncStart}
              title="문장 시작 조금 전부터 재생합니다. 소리가 들리는 순간 다시 누르세요"
              className="chip"
            >
              탭 맞추기
            </button>
          )}

          {isAdjusted && (
            <button type="button" onClick={resetSync} className="chip" title="보정 되돌리기">
              ↺
            </button>
          )}
        </div>
      </Field>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={toggleGrading}
          className={`chip ${gradingEnabled ? 'chip-active' : ''}`}
          title={
            gradingEnabled
              ? '끄면 Enter가 곧바로 다음 문장으로 넘어갑니다 (점수 표시도 사라집니다)'
              : '켜면 다음 문장으로 넘어갈 때 방금 문장을 채점합니다'
          }
        >
          채점
        </button>
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
