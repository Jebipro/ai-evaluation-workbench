import { describe, expect, it } from "vitest"
import { deriveFinalStatus, getCaseOutcome, InvalidTransitionError, isActiveStatus, transition } from "./status.ts"

const ok = { error: undefined }
const err = { error: { kind: "http_5xx" as const, message: "x", attempts: 3 } }

describe("deriveFinalStatus", () => {
  it("execution error가 없으면 점수와 무관하게 completed", () => {
    expect(deriveFinalStatus({ cancelled: false, fatalError: false, results: [ok, ok] })).toBe("completed")
  })

  it("error 1건 이상 + 성공 1건 이상 → partiallyFailed", () => {
    expect(deriveFinalStatus({ cancelled: false, fatalError: false, results: [ok, err] })).toBe("partiallyFailed")
  })

  it("모든 실행이 error → failed", () => {
    expect(deriveFinalStatus({ cancelled: false, fatalError: false, results: [err, err] })).toBe("failed")
  })

  it("runner 치명적 오류 → failed", () => {
    expect(deriveFinalStatus({ cancelled: false, fatalError: true, results: [ok] })).toBe("failed")
  })

  it("사용자 취소 → cancelled (error 여부와 무관)", () => {
    expect(deriveFinalStatus({ cancelled: true, fatalError: false, results: [ok, err] })).toBe("cancelled")
  })
})

describe("transition", () => {
  it("정상 경로", () => {
    let status = transition("idle", { type: "start" })
    expect(status).toBe("validating")
    status = transition(status, { type: "validationPassed" })
    expect(status).toBe("running")
    expect(transition(status, { type: "finish", status: "partiallyFailed" })).toBe("partiallyFailed")
  })

  it("validation 실패 → idle", () => {
    expect(transition("validating", { type: "validationFailed" })).toBe("idle")
  })

  it("terminal 상태에서 새 run 시작 → validating", () => {
    for (const s of ["completed", "partiallyFailed", "failed", "cancelled"] as const) {
      expect(transition(s, { type: "start" })).toBe("validating")
    }
  })

  it("활성 run 중에는 새 run을 시작할 수 없다", () => {
    expect(() => transition("running", { type: "start" })).toThrow(InvalidTransitionError)
    expect(() => transition("validating", { type: "start" })).toThrow(InvalidTransitionError)
    expect(isActiveStatus("running")).toBe(true)
    expect(isActiveStatus("completed")).toBe(false)
  })

  it("잘못된 전이는 throw", () => {
    expect(() => transition("idle", { type: "finish", status: "completed" })).toThrow(InvalidTransitionError)
    expect(() => transition("idle", { type: "validationPassed" })).toThrow(InvalidTransitionError)
  })
})

describe("getCaseOutcome", () => {
  it("error가 있으면 error, 아니면 passed 기준", () => {
    expect(getCaseOutcome({ passed: true })).toBe("pass")
    expect(getCaseOutcome({ passed: false })).toBe("fail")
    expect(getCaseOutcome({ passed: false, error: err.error })).toBe("error")
  })
})
