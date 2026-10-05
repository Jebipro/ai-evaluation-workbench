import type { ErrorKind } from "../types.ts"

export const RETRYABLE_KINDS: readonly ErrorKind[] = ["timeout", "network", "http_429", "http_5xx"]

export function isRetryableKind(kind: ErrorKind): boolean {
  return RETRYABLE_KINDS.includes(kind)
}

export const ERROR_KINDS: readonly ErrorKind[] = [
  "timeout",
  "cancelled",
  "network",
  "http_429",
  "http_5xx",
  "http_4xx",
  "invalid_response",
  "unknown",
]

export function isErrorKind(value: unknown): value is ErrorKind {
  return typeof value === "string" && (ERROR_KINDS as readonly string[]).includes(value)
}

/** provider는 실패 시 kind를 가진 ProviderError를 throw한다. */
export class ProviderError extends Error {
  readonly kind: ErrorKind
  readonly httpStatus?: number

  constructor(kind: ErrorKind, message: string, options?: { httpStatus?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = "ProviderError"
    this.kind = kind
    this.httpStatus = options?.httpStatus
  }
}

export function httpStatusToErrorKind(status: number): ErrorKind {
  if (status === 429) return "http_429"
  if (status >= 500) return "http_5xx"
  if (status >= 400) return "http_4xx"
  return "unknown"
}

export function cancelledError(): ProviderError {
  return new ProviderError("cancelled", "요청이 abort되었습니다.")
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw cancelledError()
}

/** signal이 abort되면 즉시 reject하는 sleep. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelledError())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(cancelledError())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * promise를 signal과 경주시킨다. provider가 signal을 무시하더라도
 * runner는 abort 즉시 다음 단계로 넘어갈 수 있다.
 */
export function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancelledError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(cancelledError())
    signal.addEventListener("abort", onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort)
        reject(error)
      },
    )
  })
}

/** 32-bit FNV-1a. FaultInjectingProvider의 deterministic 판단에 쓴다. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
