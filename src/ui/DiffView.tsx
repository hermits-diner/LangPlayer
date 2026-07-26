import type { DictationResult, DiffToken } from '../core/dictation/score'

/**
 * 채점 결과 시각화.
 *
 * 점수보다 중요한 건 "어디서 틀렸는가"다. 못 들은 단어(missing)와 잘못 들은
 * 단어(substitute)를 시각적으로 구분해야 다음 반복에서 무엇에 집중할지 알 수 있다.
 */

const STATUS_STYLE: Record<DiffToken['status'], string> = {
  match: 'text-emerald-300',
  typo: 'text-amber-300 underline decoration-dotted decoration-amber-400/70 underline-offset-4',
  substitute: 'text-rose-300 bg-rose-500/10 rounded px-1',
  missing: 'text-rose-200 bg-rose-500/20 rounded px-1 ring-1 ring-rose-400/40',
  extra: 'text-slate-500 line-through decoration-slate-500',
}

const LEGEND: { status: DiffToken['status']; label: string }[] = [
  { status: 'match', label: '정답' },
  { status: 'typo', label: '오타' },
  { status: 'substitute', label: '잘못 들음' },
  { status: 'missing', label: '놓침' },
  { status: 'extra', label: '없는 단어' },
]

export function DiffView({ result }: { result: DictationResult }) {
  const percent = Math.round(result.accuracy * 100)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className={`text-2xl font-semibold tabular-nums ${scoreColor(result.accuracy)}`}>{percent}%</span>
        <ScoreBar accuracy={result.accuracy} />
        {result.isPerfect && <span className="text-sm text-emerald-300">완벽합니다</span>}
      </div>

      <p className="flex flex-wrap gap-x-2 gap-y-1.5 text-lg leading-relaxed">
        {result.tokens.map((token, i) => (
          <TokenChip key={i} token={token} />
        ))}
      </p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {LEGEND.filter(({ status }) => result.counts[status] > 0).map(({ status, label }) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${dotColor(status)}`} />
            {label} {result.counts[status]}
          </span>
        ))}
      </div>
    </div>
  )
}

function TokenChip({ token }: { token: DiffToken }) {
  const shown = token.status === 'missing' ? token.reference : token.input

  // 잘못 들은 단어는 정답을 바로 옆에 붙여줘야 교정이 된다
  const correction =
    (token.status === 'substitute' || token.status === 'typo') && token.reference !== token.input
      ? token.reference
      : null

  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={STATUS_STYLE[token.status]}>{shown}</span>
      {correction && <span className="text-xs text-emerald-400/80">→{correction}</span>}
    </span>
  )
}

function ScoreBar({ accuracy }: { accuracy: number }) {
  return (
    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
      <div
        className={`h-full rounded-full transition-all duration-300 ${barColor(accuracy)}`}
        style={{ width: `${Math.round(accuracy * 100)}%` }}
      />
    </div>
  )
}

function scoreColor(accuracy: number): string {
  if (accuracy >= 0.9) return 'text-emerald-300'
  if (accuracy >= 0.6) return 'text-amber-300'
  return 'text-rose-300'
}

function barColor(accuracy: number): string {
  if (accuracy >= 0.9) return 'bg-emerald-400'
  if (accuracy >= 0.6) return 'bg-amber-400'
  return 'bg-rose-400'
}

function dotColor(status: DiffToken['status']): string {
  switch (status) {
    case 'match':
      return 'bg-emerald-400'
    case 'typo':
      return 'bg-amber-400'
    case 'substitute':
      return 'bg-rose-400'
    case 'missing':
      return 'bg-rose-300'
    case 'extra':
      return 'bg-slate-500'
  }
}
