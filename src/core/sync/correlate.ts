import { fftInPlace, nextPowerOfTwo } from './fft'

/**
 * FFT 상호상관으로 두 신호의 시간차를 찾는다.
 *
 * 신호를 평균 중심화하는 것이 중요하다. 말함/침묵 이진 신호는 DC 성분이 커서
 * 그냥 상관시키면 어느 지연에서나 겹침이 비슷하게 나와 봉우리가 뭉개진다.
 * 평균을 빼면 봉우리가 날카로워지고, 덤으로 0으로 채운 패딩 구간이 "평균값"
 * 취급을 받아 중립이 된다.
 */

export interface CorrelationPeak {
  /** 프레임 단위 지연. 양수면 자막을 뒤로 밀어야 한다 */
  lag: number
  /** 정규화 상관계수 (-1 ~ 1) */
  score: number
  /**
   * 최고 봉우리 ÷ 봉우리 근방을 제외한 차선 봉우리.
   *
   * 상관값의 절대 크기는 신뢰도로 못 쓴다. 실제 오디오는 음악·효과음 때문에
   * 자막과 완벽히 겹치지 않아 정답이어도 0.5 언저리가 나오기 때문이다.
   * 반면 "정답이 차선책보다 얼마나 앞서는가"는 잘 구분된다 — 맞으면 봉우리가
   * 하나만 우뚝 솟고, 틀리면 고만고만한 봉우리가 여럿 생긴다.
   */
  sharpness: number
}

/** 봉우리가 완전히 고립됐을 때 sharpness가 무한대로 튀지 않게 자른다 */
const MAX_SHARPNESS = 10

function meanOf(values: Float32Array): number {
  let sum = 0
  for (const v of values) sum += v
  return values.length === 0 ? 0 : sum / values.length
}

/**
 * `reference`(오디오)와 `target`(자막)의 상호상관 최대점을 찾는다.
 *
 * 반환된 lag만큼 target을 뒤로 밀면 reference와 겹친다.
 */
export function findBestLag(
  reference: Float32Array,
  target: Float32Array,
  maxLag: number,
  /** 차선 봉우리를 찾을 때 최고점 주변 이만큼은 같은 봉우리로 보고 건너뛴다 */
  exclusionFrames = 100,
): CorrelationPeak {
  const valid = Math.max(reference.length, target.length)
  // 순환 상관이 반대쪽 끝을 오염시키지 않도록 2배 이상으로 채운다
  const n = nextPowerOfTwo(valid * 2)

  const refMean = meanOf(reference)
  const targetMean = meanOf(target)

  const aRe = new Float64Array(n)
  const aIm = new Float64Array(n)
  const bRe = new Float64Array(n)
  const bIm = new Float64Array(n)

  let refEnergy = 0
  let targetEnergy = 0

  for (let i = 0; i < reference.length; i++) {
    const v = reference[i] - refMean
    aRe[i] = v
    refEnergy += v * v
  }
  for (let i = 0; i < target.length; i++) {
    const v = target[i] - targetMean
    bRe[i] = v
    targetEnergy += v * v
  }

  const norm = Math.sqrt(refEnergy * targetEnergy)
  if (norm === 0) return { lag: 0, score: 0, sharpness: 0 }

  fftInPlace(aRe, aIm)
  fftInPlace(bRe, bIm)

  // A · conj(B) → 역변환하면 c[d] = Σ a[i+d]·b[i]
  for (let i = 0; i < n; i++) {
    const re = aRe[i] * bRe[i] + aIm[i] * bIm[i]
    const im = aIm[i] * bRe[i] - aRe[i] * bIm[i]
    aRe[i] = re
    aIm[i] = im
  }

  fftInPlace(aRe, aIm, true)

  const limit = Math.min(maxLag, Math.floor(n / 2) - 1)
  let bestLag = 0
  let bestValue = -Infinity

  for (let lag = -limit; lag <= limit; lag++) {
    // 음수 지연은 배열 뒤쪽에 감겨 있다
    const value = aRe[lag >= 0 ? lag : n + lag]
    if (value > bestValue) {
      bestValue = value
      bestLag = lag
    }
  }

  // 봉우리 근방을 뺀 나머지에서 차선을 찾아 얼마나 우뚝한지 잰다
  let runnerUp = -Infinity
  for (let lag = -limit; lag <= limit; lag++) {
    if (Math.abs(lag - bestLag) <= exclusionFrames) continue
    const value = aRe[lag >= 0 ? lag : n + lag]
    if (value > runnerUp) runnerUp = value
  }

  const sharpness =
    bestValue <= 0 ? 0 : runnerUp <= 0 ? MAX_SHARPNESS : Math.min(MAX_SHARPNESS, bestValue / runnerUp)

  return { lag: bestLag, score: bestValue / norm, sharpness }
}
