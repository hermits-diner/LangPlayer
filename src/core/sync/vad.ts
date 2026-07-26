/**
 * 음성 활동 검출 (Voice Activity Detection).
 *
 * 자막을 맞추는 데 필요한 정보는 "무슨 말을 하는가"가 아니라 "언제 소리가
 * 나는가"뿐이다. 그래서 언어·내용과 무관하게 동작한다. 프레임별 에너지에
 * 임계값을 씌워 말함/침묵 이진 신호를 만든다.
 */

/** 포락선 해상도. 10ms면 사람 말의 리듬을 담기에 충분하고 계산량도 가볍다 */
export const FRAME_SEC = 0.01

/** 샘플 배열 → 프레임별 RMS 에너지 */
export function buildEnvelope(samples: Float32Array, sampleRate: number, frameSec = FRAME_SEC): Float32Array {
  const frameSize = Math.max(1, Math.round(sampleRate * frameSec))
  const frameCount = Math.floor(samples.length / frameSize)
  const envelope = new Float32Array(frameCount)

  for (let f = 0; f < frameCount; f++) {
    const from = f * frameSize
    let sum = 0
    for (let i = from; i < from + frameSize; i++) sum += samples[i] * samples[i]
    envelope[f] = Math.sqrt(sum / frameSize)
  }

  return envelope
}

/** 정렬 없이 근사 백분위수 — 수백만 프레임을 정렬하면 느리다 */
export function approximatePercentile(values: Float32Array, percentile: number, buckets = 1024): number {
  if (values.length === 0) return 0

  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  if (max <= min) return min

  const histogram = new Uint32Array(buckets)
  const scale = buckets / (max - min)
  for (const v of values) {
    const bucket = Math.min(buckets - 1, Math.floor((v - min) * scale))
    histogram[bucket]++
  }

  const target = values.length * percentile
  let cumulative = 0
  for (let b = 0; b < buckets; b++) {
    cumulative += histogram[b]
    if (cumulative >= target) return min + (b + 0.5) / scale
  }

  return max
}

/**
 * 에너지 포락선 → 말함/침묵 이진 신호.
 *
 * 고정 임계값은 못 쓴다. 녹음 레벨이 콘텐츠마다 다르고, 조용한 강의와 시끄러운
 * 영화가 섞이기 때문이다. 하위/상위 백분위수로 신호 자체에서 잡음 바닥과
 * 최대치를 읽어 그 사이에 임계값을 잡는다.
 */
export function detectSpeech(envelope: Float32Array, sensitivity = 0.25): Float32Array {
  const floor = approximatePercentile(envelope, 0.1)
  const ceiling = approximatePercentile(envelope, 0.9)
  const threshold = floor + (ceiling - floor) * sensitivity

  const speech = new Float32Array(envelope.length)
  for (let i = 0; i < envelope.length; i++) speech[i] = envelope[i] > threshold ? 1 : 0

  return speech
}

/** 자막 구간 → 같은 해상도의 이진 신호 */
export function subtitleSignal(
  cues: readonly { start: number; end: number }[],
  frameCount: number,
  frameSec = FRAME_SEC,
): Float32Array {
  const signal = new Float32Array(frameCount)

  for (const cue of cues) {
    const from = Math.max(0, Math.floor(cue.start / frameSec))
    const to = Math.min(frameCount, Math.ceil(cue.end / frameSec))
    for (let i = from; i < to; i++) signal[i] = 1
  }

  return signal
}
