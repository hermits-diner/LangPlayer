/**
 * 단축키 목록 — 도움말(F1) 화면의 원본.
 *
 * 키 바인딩 자체는 `useKeyboardShortcuts`에 있고 여기는 설명용이다. 둘을 한
 * 파일로 합치려다 실패했는데, 실제 처리는 수식키 조합과 맥락에 따라 갈라져서
 * 목록으로 곧이곧대로 표현되지 않는다. 대신 이 파일을 바인딩 바로 옆에 두고
 * 함께 고치는 쪽을 택했다.
 */

export interface ShortcutGroup {
  title: string
  items: { keys: string[]; label: string }[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '재생과 이동',
    items: [
      { keys: ['F5'], label: '현재 구간 반복 (Space도 동일)' },
      { keys: ['F6', 'F7'], label: '앞 / 뒤 문장' },
      { keys: ['Ctrl+F6', 'Ctrl+F7'], label: '첫 / 끝 문장' },
      { keys: ['F8'], label: '일시정지 — 다시 누르면 3초 되감아 재생' },
      { keys: ['F11'], label: '연속 재생 (선택 구간, 없으면 현재부터 끝까지)' },
      { keys: ['PgUp', 'PgDn'], label: '자막 목록을 한 화면씩 넘기기 (현재 문장은 그대로)' },
      { keys: ['1'], label: '반복 횟수 (1~9)' },
      { keys: ['[', ']'], label: '배속' },
      { keys: ['Ctrl+↑', 'Ctrl+↓'], label: '음량' },
    ],
  },
  {
    title: '받아쓰기',
    items: [
      { keys: ['Enter'], label: '다음 문장' },
      { keys: ['↑', '↓'], label: '앞 / 뒤 문장 (입력 중에도 동작)' },
      { keys: ['Tab'], label: '자막 정답 보기' },
      { keys: ['Esc'], label: '현재 문장 다시 듣기' },
    ],
  },
  {
    title: '문장 편집',
    items: [
      { keys: ['F3'], label: '합치기 — 범위를 골라 두었으면 통째로' },
      { keys: ['F4'], label: '나누기 — 재생 위치 → 문장 단위 → 자막 경계 순으로 시도' },
      { keys: ['두 번 클릭'], label: '자막 문장 고치기' },
      { keys: ['오른쪽 클릭'], label: '문장 개별 선택' },
      { keys: ['Shift+클릭'], label: '범위 선택' },
    ],
  },
  {
    title: '음파창',
    items: [
      { keys: ['왼쪽 클릭'], label: '그 문장을 골라 구간 반복' },
      { keys: ['드래그'], label: '고른 구간만 한 번 재생' },
      { keys: ['오른쪽 클릭'], label: '재생 / 정지' },
      { keys: ['Ctrl+오른쪽 클릭'], label: '마우스 위치에서 나누기' },
      { keys: ['＋', '－'], label: '확대 / 축소 (숫자패드, Ctrl+휠도 동일)' },
      { keys: ['／'], label: '전체 보기 (숫자패드)' },
    ],
  },
  {
    title: '자막 싱크',
    items: [
      { keys: ['Ctrl+←', 'Ctrl+→'], label: '자막을 ±0.1초 옮기기' },
      { keys: ['자동 맞춤'], label: '음성과 대조해 자동 보정 — 구간이 나뉜 파일도 함께 (로컬 파일 전용)' },
      { keys: ['탭 맞추기'], label: '소리가 시작되는 순간을 직접 찍기' },
    ],
  },
  {
    title: '화면',
    items: [
      { keys: ['F9'], label: '극장 모드 — 영상을 키우고 받아쓰기 창을 접는다' },
      { keys: ['경계선 끌기'], label: '영상 크기 조절 (두 번 클릭하면 기본 크기)' },
      { keys: ['화면 자막'], label: '영상 위에 현재 문장을 띄운다 (자막 숨김이면 함께 숨는다)' },
      { keys: ['Ctrl+T'], label: '텍스트창 열기 / 닫기' },
      { keys: ['F2'], label: '자막 원문 보기' },
      { keys: ['F12'], label: '창 크기 (절반 ↔ 전체)' },
    ],
  },
  {
    title: '파일',
    items: [
      { keys: ['Ctrl+O'], label: '영상·자막 파일 열기' },
      { keys: ['Ctrl+S'], label: '받아쓰기 전문 저장' },
      { keys: ['Ctrl+Shift+S'], label: '고친 자막을 .srt 파일로 저장' },
      { keys: ['Ctrl+P'], label: '자막 스크립트 인쇄' },
      { keys: ['F1'], label: '이 도움말' },
      { keys: ['F10'], label: '메뉴' },
    ],
  },
]

/** F5는 새로고침을 가로챈다 — 새로고침은 Ctrl+R */
export const SHORTCUT_NOTE =
  'F5는 브라우저 새로고침을 가로챕니다. 새로고침은 Ctrl+R을 쓰세요. F3(다음 찾기)도 마찬가지이며, 찾기 막대가 열려 있으면 Esc로 닫은 뒤 눌러야 합니다.'
