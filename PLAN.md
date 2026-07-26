# LangPlayer — 구간반복 + 받아쓰기 학습 플레이어 (MVP)

## Context

외국어 학습자가 영상/오디오의 **의미 단위(문장) 자막을 클릭하면 그 구간이 지정 횟수만큼 반복 재생**되고, 그 자리에서 **받아쓰기(Transcribe)를 타이핑해 채점**받을 수 있는 앱을 만든다. 기존 플레이어들은 "구간 반복"은 되지만 자막 큐가 문장 단위가 아니고, 받아쓰기 채점·학습 기록이 없다.

확정된 전제:
- 사용자: 본인 우선, **추후 상용화 예정**
- 소스: 로컬 영상 + 로컬 오디오(팟캐스트) + YouTube
- **자막 파일은 항상 존재** → 자동 전사(Whisper) 불필요
- MVP 범위: **구간 반복 + 받아쓰기 채점**까지. 녹음/단어장/SRS는 2차.

결과물: 설치 없이 브라우저에서 도는 SPA. 로컬 파일은 업로드하지 않고 브라우저 내에서만 처리(서버 비용 0, 프라이버시가 그대로 제품 강점).

---

## 플랫폼 결정: 순수 웹앱 (Vite + React + TS)

데스크톱(Electron/Tauri)을 배제한 근거:
- 데스크톱이 필요한 3가지 이유 중 2개가 소멸 — 자동 전사 불필요, 상용 배포는 웹이 압도적으로 유리
- 남은 하나는 **코덱**: 브라우저는 MP4(H.264/AAC)·WebM만 재생. MKV/HEVC/AC3는 불가 → MVP는 "지원 형식 안내 + 변환 안내"로 처리하고, 수요가 확인되면 그때 Tauri 셸을 얹는다(UI 코드 100% 재사용)

이를 위해 **플레이어 접근을 어댑터로 추상화**하는 것이 이 설계의 중심이다. 나중에 Tauri/네이티브 코덱을 붙여도 어댑터 하나만 추가된다.

### 스택
| 영역 | 선택 | 비고 |
|---|---|---|
| 빌드/프레임워크 | Vite + React + TypeScript | |
| 상태 | Zustand | 재생 상태는 rAF 루프에서 갱신되므로 store 밖 ref로 관리 (리렌더 폭주 방지) |
| 스타일 | Tailwind CSS | |
| 로컬 저장 | IndexedDB (Dexie) | 파일 핸들, 진도, 받아쓰기 기록 |
| 자막 파싱 | 직접 구현 | SMI 지원 라이브러리가 없음. 인코딩은 브라우저 내장 `TextDecoder('euc-kr')` 사용 |
| diff | 직접 구현 (토큰 LCS, ~60줄) | |

타깃 브라우저: **Chrome/Edge 우선**(File System Access API). Firefox/Safari는 드래그앤드롭 폴백.

---

## 아키텍처

```
src/
  core/
    player/
      PlayerAdapter.ts        # 공통 인터페이스
      HtmlMediaAdapter.ts     # <video>/<audio> 공용 (HTMLMediaElement)
      YouTubeAdapter.ts       # IFrame Player API
    subtitle/
      decode.ts               # 인코딩 감지 → 문자열
      parse/{srt,vtt,smi,ass}.ts
      segment.ts              # 큐 → 의미 단위 세그먼트 병합
      types.ts
    loop/
      LoopController.ts       # rAF 기반 구간 반복 엔진
    dictation/
      normalize.ts
      score.ts                # 토큰 LCS diff 채점
  store/
  ui/
```

### 1. PlayerAdapter (핵심 추상화)

```ts
interface PlayerAdapter {
  play(): Promise<void>
  pause(): void
  seek(sec: number): Promise<void>   // seeked 완료까지 대기
  getCurrentTime(): number           // 폴링 호출용, 이벤트 아님
  getDuration(): number
  setRate(rate: number): void        // preservesPitch = true 고정
  setVolume(v: number): void
  destroy(): void
}
```

- `HtmlMediaAdapter`: 로컬 영상·오디오 공통. `HTMLMediaElement`라 코드가 동일하다.
- `YouTubeAdapter`: `seekTo(t, true)`, `getCurrentTime()`, `setPlaybackRate()`. HTML5보다 seek 정밀도가 낮고 버퍼링 지연이 있으나 구간 반복에는 충분. 반복 간 지연이 체감되면 gap을 자동으로 늘린다.

> **YouTube 자막 주의(상용 대비)**: 유튜브 자동 캡션을 직접 긁는 것은 ToS 회색지대다. MVP는 **사용자가 srt/vtt 파일을 직접 올려 영상에 매칭**하는 방식만 지원한다.

### 2. 자막 파이프라인

**2-1. 인코딩 디코딩** (`decode.ts`)
1. BOM 검사 → UTF-8/UTF-16
2. UTF-8 strict 디코딩 시도(`fatal: true`) → 성공하면 UTF-8
3. 실패 시 `TextDecoder('euc-kr')` (국내 SRT/SMI 대응)

**2-2. 파서** — SRT, VTT, SMI, ASS(텍스트만 추출). 산출물:
```ts
type Cue = { start: number; end: number; text: string }
```
HTML 태그·`{\an8}` 등 스타일 태그 제거.

**2-3. 세그먼트 병합** (`segment.ts`) — *이 앱의 핵심 차별점*

SRT 큐는 의미 단위가 아니다(한 문장이 2~3줄로 쪼개짐). 규칙 기반으로 병합:
- 텍스트가 문장 종결 부호(`. ! ? … " ' ” 』`)로 끝나지 않으면 다음 큐와 병합
- 다음 큐가 소문자/접속사로 시작하면 병합 신호로 가산
- **중단 조건**: 병합 결과가 15초 초과, 또는 큐 사이 간격이 2초 초과 → 병합하지 않음
- 결과는 항상 **수동 병합/분할 가능**(UI에서 세그먼트 경계 편집). 자동 규칙은 초안일 뿐이다.

```ts
type Segment = { id: string; start: number; end: number; text: string; cueIds: string[] }
```

### 3. LoopController — 정확한 구간 반복

**절대 `timeupdate` 이벤트로 끝을 감지하지 말 것.** 초당 4회만 발생해 최대 250ms 오버런한다. `requestVideoFrameCallback`(영상) 또는 `requestAnimationFrame`(오디오/YouTube)으로 `getCurrentTime()`을 폴링한다.

설정값:
| 항목 | 기본값 | 이유 |
|---|---|---|
| `padLead` | 200ms | 첫 음소 잘림 방지 (없으면 받아쓰기 불가) |
| `padTail` | 300ms | 문장 끝 여운 |
| `repeatCount` | 3 | 사용자 지정 |
| `gapMs` | 0 | 반복 사이 무음 — 따라 말하기용 |
| `rate` | 1.0 | `preservesPitch = true`로 0.75x에서도 음질 유지 |

상태 머신: `idle → seeking → playing → (end 도달) → gap → seeking → …  → done`
- seek는 `seeked` 이벤트 대기 후 play (그렇지 않으면 앞부분이 잘림)
- 진행 중 사용자가 다른 세그먼트를 클릭하면 즉시 취소(토큰 기반 취소로 stale 콜백 무시)
- 마지막 반복 후 동작: `정지` / `다음 세그먼트로` / `무한 반복` 중 선택

### 4. 받아쓰기 채점 (`dictation/`)

**정규화** — 채점 전 양쪽 모두 적용:
- 소문자화, 유니코드 NFKC, 문장부호·따옴표 제거, 다중 공백 축약
- 옵션: 축약형 통일(`don't` ↔ `do not`), 숫자 표기(`5` ↔ `five`)는 2차

**정렬·채점**:
1. 공백 기준 토큰화
2. 참조 토큰 vs 입력 토큰을 **LCS로 정렬** → 각 토큰에 `match | missing | extra | substitute` 태그
   - `substitute`는 편집거리 ≤ 2면 "오타"로 따로 표시(부분 점수)
3. 점수 = `match 수 / 참조 토큰 수` (WER 기반)

**표시**: 입력한 문장 위에 색상 오버레이(맞음/틀림/추가) + 정답 문장에서 놓친 단어 강조. 단순 O/X가 아니라 **어디서 틀렸는지**를 보여주는 게 핵심.

### 5. 파일 입력

- 드래그앤드롭(폴더 째로) + `<input type="file" multiple>`
- 확장자로 **미디어 ↔ 자막 자동 매칭**(basename 일치 우선, 없으면 유일한 자막 파일 자동 연결)
- Chrome/Edge: File System Access API 핸들을 IndexedDB에 저장 → 재방문 시 권한 재확인 후 즉시 이어보기
- 미지원 코덱(MKV 등) 감지 시 명확한 안내 메시지 (`video.error` + `canPlayType`)

### 6. 키보드 단축키 (이 앱 사용성의 절반)

| 키 | 동작 |
|---|---|
| `Space` | 현재 세그먼트 반복 재생 / 정지 |
| `↑ / ↓` | 이전 / 다음 세그먼트 |
| `Enter` | 받아쓰기 채점 |
| `Tab` | 자막 정답 보기 토글 |
| `1~9` | 반복 횟수 즉시 변경 |
| `[ / ]` | 배속 조절 |
| `Ctrl+←/→` | 세그먼트 경계 미세 조정(±100ms) |

입력창 포커스 중에는 `Space`/숫자 단축키를 비활성화(단, `Enter`/`Tab`은 유지).

---

## 화면 구성 (MVP 1화면)

```
┌──────────────────────────────┬─────────────────────┐
│                              │  자막 세그먼트 리스트  │
│        플레이어               │  ▸ 클릭 → 구간 반복   │
│  (영상 / 오디오 파형 자리)     │  ▸ 현재 항목 하이라이트│
│                              │  ▸ [숨김] 토글       │
├──────────────────────────────┤  ▸ 병합/분할 버튼    │
│ ▶ 반복 2/3   0.75x   gap 1s  │                     │
├──────────────────────────────┴─────────────────────┤
│ 받아쓰기 입력창                                      │
│ ─────────────────────────────────────────────────  │
│ 채점 결과: 87%  [색상 diff 표시]                     │
└────────────────────────────────────────────────────┘
```

---

## 구현 순서

1. **프로젝트 셋업** — Vite + React + TS + Tailwind + Zustand + Dexie
2. **자막 파이프라인** — decode → parse(SRT/VTT 먼저) → segment 병합. *브라우저 없이 단위 테스트 가능하므로 여기부터 시작한다.*
3. **HtmlMediaAdapter + 로컬 파일 로딩** — 드래그앤드롭, 자동 매칭, 영상 재생
4. **LoopController** — rAF 폴링, 패딩, 반복 카운트, gap, 취소 처리
5. **자막 리스트 UI** — 클릭 → 반복, 현재 세그먼트 추적, 숨김 토글
6. **받아쓰기 채점** — 정규화 + LCS diff + 색상 표시
7. **키보드 단축키**
8. **YouTubeAdapter** — 어댑터만 추가(1~7이 어댑터에 의존하지 않게 짜여 있어야 함)
9. **오디오 파일 지원** — HtmlMediaAdapter 재사용 + 오디오용 레이아웃
10. **진도 저장** — IndexedDB에 영상별 재생 위치·받아쓰기 기록
11. **세그먼트 수동 병합/분할 + 싱크 오프셋 보정**

MVP 완료 기준: 3~7번까지 동작하면 실사용 가능. 8~11은 같은 사이클 내 후속.

---

## 2차 로드맵 (MVP 이후, 상용 차별화 요소)

- **녹음·쉐도잉**: 구간별 내 음성 녹음(MediaRecorder) → 원본 직후 A/B 비교 재생, 파형 겹쳐보기
- **발음 피드백**: 내 녹음을 ASR에 넣어 "기계가 들은 문장" 표시 → 저비용 고효과
- **문장 채굴**: 단어 클릭 → 사전 조회 → 문장+오디오클립+타임스탬프째 단어장 저장
- **Anki 내보내기 / 내장 SRS(FSRS)** — "플레이어"와 "학습앱"을 가르는 지점
- **AI 해설**: 문장 단위 번역·문법 해설 (Gemini API)
- **이중 자막**(원어+한국어 각각 블러 토글), 아는 단어 기반 **구간 난이도 표시**
- 통계: 정확도 추이, 학습 시간, 연속일, 오답 단어 자동 수집 → 복습 큐
- 코덱 한계가 실제 이탈 요인으로 확인되면 **Tauri 셸** 추가 (UI 재사용)

---

## 검증 방법

**단위 테스트** (Vitest):
- `parse`: EUC-KR SRT, UTF-8 BOM SRT, SMI, 중첩 태그 있는 VTT 샘플이 정확히 파싱되는지
- `segment`: 문장이 3개 큐로 쪼개진 샘플이 1개 세그먼트로 병합되는지 / 15초·2초 갭 중단 조건이 걸리는지
- `score`: 완전 일치=100%, 단어 1개 누락, 오타, 어순 뒤바뀜, 문장부호만 다른 경우의 점수와 태그

**수동 E2E** (`npm run dev` 후 브라우저에서):
1. mp4 + srt를 함께 드롭 → 자동 매칭되고 세그먼트 리스트가 문장 단위로 뜨는지
2. 세그먼트 클릭 → 정확히 그 구간만 3회 반복, **첫 단어가 잘리지 않고 다음 문장이 새어나오지 않는지** (가장 중요한 검증)
3. 반복 중 다른 세그먼트 클릭 → 이전 루프가 즉시 취소되는지
4. 배속 0.75x에서 음높이가 유지되는지
5. 자막 숨긴 채 받아쓰기 → Enter → diff가 정확한 위치를 짚는지
6. 오디오 파일(mp3+srt)로 1~5 반복
7. YouTube URL + srt로 1~5 반복 (seek 지연 체감 확인)
8. MKV 드롭 → 크래시 없이 "지원하지 않는 형식" 안내가 뜨는지
9. 새로고침 후 재방문 → 권한 재확인 후 마지막 위치에서 이어지는지
