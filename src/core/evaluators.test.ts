import { describe, expect, it } from "vitest"
import {
  DEFAULT_NORMALIZATION,
  evaluate,
  getThreshold,
  isPassed,
  normalizeText,
  parseStrictJson,
  resolveJsonPath,
} from "./evaluators.ts"
import type { EvaluatorConfig } from "./types.ts"

describe("exact-match normalization", () => {
  it("기본값은 trim만 적용하고 대소문자 / 내부 공백은 유지한다", () => {
    expect(DEFAULT_NORMALIZATION).toEqual({ trim: true, caseSensitive: true, collapseWhitespace: false })
    const config: EvaluatorConfig = { type: "exact-match", expected: "positive" }
    expect(evaluate(config, "  positive\n").score).toBe(1)
    expect(evaluate(config, "Positive").score).toBe(0)
    expect(evaluate({ type: "exact-match", expected: "a b" }, "a  b").score).toBe(0)
  })

  it("caseSensitive: false면 대소문자를 무시한다", () => {
    const config: EvaluatorConfig = { type: "exact-match", expected: "positive", normalization: { caseSensitive: false } }
    expect(evaluate(config, "POSITIVE").score).toBe(1)
  })

  it("collapseWhitespace: true면 연속 공백을 하나로 합친다", () => {
    const config: EvaluatorConfig = { type: "exact-match", expected: "a b", normalization: { collapseWhitespace: true } }
    expect(evaluate(config, "a \n\t b").score).toBe(1)
  })

  it("trim: false면 앞뒤 공백도 비교한다", () => {
    const config: EvaluatorConfig = { type: "exact-match", expected: "x", normalization: { trim: false } }
    expect(evaluate(config, " x").score).toBe(0)
    expect(normalizeText(" x ", { trim: false, caseSensitive: true, collapseWhitespace: false })).toBe(" x ")
  })

  it("실패 reason에 expected와 actual을 남긴다", () => {
    const { reason } = evaluate({ type: "exact-match", expected: "positive" }, "The sentiment is positive.")
    expect(reason).toContain('expected="positive"')
    expect(reason).toContain('actual="The sentiment is positive."')
  })
})

describe("contains", () => {
  it("출력에 expected가 포함되면 1", () => {
    expect(evaluate({ type: "contains", expected: "positive" }, "The sentiment is positive.").score).toBe(1)
    expect(evaluate({ type: "contains", expected: "negative" }, "The sentiment is positive.").score).toBe(0)
  })

  it("normalization 옵션을 따른다", () => {
    expect(evaluate({ type: "contains", expected: "POSITIVE" }, "positive").score).toBe(0)
    expect(
      evaluate({ type: "contains", expected: "POSITIVE", normalization: { caseSensitive: false } }, "positive").score,
    ).toBe(1)
  })
})

describe("regex", () => {
  it("pattern / flags로 매칭한다", () => {
    expect(evaluate({ type: "regex", pattern: "^pos" }, "positive").score).toBe(1)
    expect(evaluate({ type: "regex", pattern: "^POS" }, "positive").score).toBe(0)
    expect(evaluate({ type: "regex", pattern: "^POS", flags: "i" }, "positive").score).toBe(1)
  })
})

describe("json-valid (strict)", () => {
  it("valid JSON은 1", () => {
    expect(evaluate({ type: "json-valid" }, '  {"a": 1}\n').score).toBe(1)
    expect(evaluate({ type: "json-valid" }, "[1, 2]").score).toBe(1)
  })

  it("invalid JSON은 0", () => {
    const result = evaluate({ type: "json-valid" }, "{a: 1}")
    expect(result.score).toBe(0)
    expect(result.reason).toContain("valid JSON이 아닙니다")
  })

  it("markdown code fence로 감싼 JSON은 strict하게 fail이다", () => {
    const fenced = '```json\n{"name": "김민수"}\n```'
    const result = evaluate({ type: "json-valid" }, fenced)
    expect(result.score).toBe(0)
    expect(result.reason).toBe("출력이 markdown code fence로 감싸져 있어 strict JSON이 아닙니다.")
  })

  it("설명문 + fence 출력도 fail이며 fence를 원인으로 보고한다", () => {
    const result = parseStrictJson('다음은 결과입니다:\n```json\n{"a":1}\n```')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("markdown code fence")
  })

  it("빈 출력은 fail", () => {
    expect(evaluate({ type: "json-valid" }, "   ").score).toBe(0)
  })
})

describe("json-fields", () => {
  const output = JSON.stringify({ user: { name: "민수", age: 29, admin: false }, items: [{ id: "a1" }], tags: [], note: null })

  it("rule 충족 비율이 score가 된다 (partial score)", () => {
    const result = evaluate(
      {
        type: "json-fields",
        rules: [
          { path: "user.name", type: "string" },
          { path: "user.age", type: "string" },
          { path: "user.email" },
        ],
      },
      output,
    )
    expect(result.score).toBeCloseTo(1 / 3)
    expect(result.reason).toContain("1/3")
    expect(result.reason).toContain("user.age: 기대 type string, 실제 number")
    expect(result.reason).toContain("user.email: 필수 field가 없습니다")
  })

  it("required: false면 값이 없을 때 통과, 기본은 required", () => {
    expect(evaluate({ type: "json-fields", rules: [{ path: "missing", required: false }] }, output).score).toBe(1)
    expect(evaluate({ type: "json-fields", rules: [{ path: "missing" }] }, output).score).toBe(0)
    // required: false여도 값이 있으면 나머지 조건을 검사한다
    expect(evaluate({ type: "json-fields", rules: [{ path: "user.age", required: false, type: "string" }] }, output).score).toBe(0)
  })

  it("type 조건: object / array / null / boolean을 구분한다", () => {
    const rules = [
      { path: "user", type: "object" as const },
      { path: "tags", type: "array" as const },
      { path: "note", type: "null" as const },
      { path: "user.admin", type: "boolean" as const },
    ]
    expect(evaluate({ type: "json-fields", rules }, output).score).toBe(1)
    expect(evaluate({ type: "json-fields", rules: [{ path: "tags", type: "object" }] }, output).score).toBe(0)
  })

  it("equals 조건", () => {
    expect(evaluate({ type: "json-fields", rules: [{ path: "user.age", equals: 29 }] }, output).score).toBe(1)
    expect(evaluate({ type: "json-fields", rules: [{ path: "user.age", equals: "29" }] }, output).score).toBe(0)
    expect(evaluate({ type: "json-fields", rules: [{ path: "note", equals: null }] }, output).score).toBe(1)
  })

  it("oneOf 조건", () => {
    expect(evaluate({ type: "json-fields", rules: [{ path: "user.name", oneOf: ["민수", "지우"] }] }, output).score).toBe(1)
    const result = evaluate({ type: "json-fields", rules: [{ path: "user.name", oneOf: ["지우"] }] }, output)
    expect(result.score).toBe(0)
    expect(result.reason).toContain("허용 값")
  })

  it("배열 index path를 지원한다", () => {
    expect(evaluate({ type: "json-fields", rules: [{ path: "items.0.id", equals: "a1" }] }, output).score).toBe(1)
    expect(evaluate({ type: "json-fields", rules: [{ path: "items.1.id" }] }, output).score).toBe(0)
    expect(resolveJsonPath({ a: [1] }, "a.x")).toEqual({ found: false })
  })

  it("JSON이 유효하지 않으면 모든 rule fail, score 0, reason에 valid JSON 아님", () => {
    const result = evaluate(
      { type: "json-fields", rules: [{ path: "name", required: false }, { path: "email" }] },
      '```json\n{"name":"x"}\n```',
    )
    expect(result.score).toBe(0)
    expect(result.reason).toContain("valid JSON 아님")
    expect(result.reason).toContain("0/2")
    expect(result.reason).toContain("markdown code fence")
  })

  it("prototype 속성은 field로 보지 않는다", () => {
    expect(evaluate({ type: "json-fields", rules: [{ path: "toString" }] }, "{}").score).toBe(0)
  })
})

describe("threshold → passed", () => {
  it("기본 threshold는 1.0", () => {
    expect(getThreshold({ type: "json-valid" })).toBe(1)
    expect(isPassed(1, 1)).toBe(true)
    expect(isPassed(0.99, 1)).toBe(false)
  })

  it("score >= threshold면 passed", () => {
    const config: EvaluatorConfig = {
      type: "json-fields",
      threshold: 0.5,
      rules: [{ path: "a" }, { path: "b" }],
    }
    const { score } = evaluate(config, '{"a": 1}')
    expect(score).toBe(0.5)
    expect(isPassed(score, getThreshold(config))).toBe(true)
    expect(isPassed(score, 0.51)).toBe(false)
    expect(isPassed(0, 0)).toBe(true)
  })
})
