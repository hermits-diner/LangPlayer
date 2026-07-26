/**
 * 미디어 파일에서 정렬용 오디오를 뽑아낸다.
 *
 * 자막을 맞추는 데 필요한 건 말의 리듬뿐이라 음질은 전혀 중요하지 않다.
 * 8 kHz 모노로 리샘플하면 데이터가 20분의 1로 줄어 계산이 훨씬 가벼워진다.
 * `OfflineAudioContext`의 표본율을 8000으로 잡으면 `decodeAudioData`가
 * 리샘플까지 알아서 해준다 — MP4 컨테이너에서 오디오 트랙만 뽑는 것도 함께.
 */

/** 정렬 전용 표본율. 사람 말의 리듬을 담기에 충분하다 */
export const ANALYSIS_SAMPLE_RATE = 8000

/**
 * 이 크기를 넘으면 파일 전체를 메모리에 올리다 실패할 수 있다.
 * `decodeAudioData`는 컨테이너 전체를 요구해서 부분 디코딩이 불가능하다.
 */
export const LARGE_FILE_BYTES = 1_200_000_000

export class AudioExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudioExtractionError'
  }
}

export function isLargeFile(file: Blob): boolean {
  return file.size > LARGE_FILE_BYTES
}

/** 미디어 파일 → 8 kHz 모노 샘플 */
export async function decodeToMono(file: Blob): Promise<Float32Array> {
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    throw new AudioExtractionError(
      '파일이 너무 커서 메모리에 올리지 못했습니다. 자동 맞춤 대신 탭 맞추기를 써 주세요.',
    )
  }

  const context = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE)

  let decoded: AudioBuffer
  try {
    decoded = await context.decodeAudioData(buffer)
  } catch {
    throw new AudioExtractionError(
      '이 파일에서 오디오를 읽지 못했습니다. 브라우저가 지원하지 않는 오디오 코덱일 수 있습니다.',
    )
  }

  return downmix(decoded)
}

/** 스테레오 이상은 채널 평균으로 합친다 — decodeAudioData는 채널 수를 유지한다 */
function downmix(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0)

  const length = buffer.length
  const mixed = new Float32Array(length)

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) mixed[i] += data[i]
  }

  const gain = 1 / buffer.numberOfChannels
  for (let i = 0; i < length; i++) mixed[i] *= gain

  return mixed
}
