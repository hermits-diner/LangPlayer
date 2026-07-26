import { useAppStore } from '../store/useAppStore'
import { formatTime } from './format'

/**
 * 인쇄용 자막 스크립트 (Ctrl+P).
 *
 * 화면과 종이는 요구가 정반대다. 화면은 어둡고 빽빽해야 오래 보기 좋지만,
 * 종이는 밝고 성겨야 손으로 표시하며 읽을 수 있다. 그래서 별도의 문서를
 * 만들어 두고 인쇄할 때만 이쪽을 보여준다.
 */
export function PrintView() {
  const segments = useAppStore((s) => s.segments)
  const media = useAppStore((s) => s.media)
  const subtitle = useAppStore((s) => s.subtitle)

  return (
    <div className="print-only">
      <h1>{media?.name ?? '자막 스크립트'}</h1>
      <p className="print-meta">
        {subtitle?.name} · {segments.length}문장
      </p>

      <ol className="print-script">
        {segments.map((segment) => (
          <li key={segment.id}>
            <span className="print-time">{formatTime(segment.start)}</span>
            <span className="print-text">{segment.text}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
