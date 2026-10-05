import { describe, expect, it } from "vitest"
import { renderTemplate, validateTemplate } from "./template.ts"
import {
  REGEX_MAX_PATTERN_LENGTH,
  validateDataset,
  validateEvaluatorConfig,
  validateRegex,
  validateRunInput,
} from "./validation.ts"
import type { Dataset, PromptVariant } from "./types.ts"

describe("regex validation", () => {
  it("잘못된 pattern은 validation error", () => {
    expect(validateRegex("(abc", undefined)[0]).toContain("regex를 생성할 수 없습니다")
  })

  it("i m s u 외의 flag는 금지 (g, y는 stateful)", () => {
    expect(validateRegex("a", "imsu")).toEqual([])
    expect(validateRegex("a", "g")[0]).toContain('허용되지 않는 regex flag "g"')
    expect(validateRegex("a", "y")[0]).toContain('"y"')
    expect(validateRegex("a", "ii")[0]).toContain("중복")
  })

  it("pattern 길이 상한", () => {
    expect(validateRegex("a".repeat(REGEX_MAX_PATTERN_LENGTH), undefined)).toEqual([])
    expect(validateRegex("a".repeat(REGEX_MAX_PATTERN_LENGTH + 1), undefined)[0]).toContain("너무 깁니다")
  })

  it("빈 pattern은 error", () => {
    expect(validateRegex("", undefined).length).toBeGreaterThan(0)
  })
})

describe("evaluator config validation", () => {
  it("threshold 범위", () => {
    expect(validateEvaluatorConfig({ type: "json-valid", threshold: 1.5 })[0]).toContain("threshold")
    expect(validateEvaluatorConfig({ type: "json-valid", threshold: -0.1 }).length).toBe(1)
    expect(validateEvaluatorConfig({ type: "json-valid", threshold: Number.NaN }).length).toBe(1)
    expect(validateEvaluatorConfig({ type: "json-valid", threshold: 0 })).toEqual([])
  })

  it("빈 json-fields rule 목록 / 잘못된 rule", () => {
    expect(validateEvaluatorConfig({ type: "json-fields", rules: [] })[0]).toContain("비어 있습니다")
    const issues = validateEvaluatorConfig({ type: "json-fields", rules: [{ path: "" }, { path: "a..b" }, { path: "c", oneOf: [] }] })
    expect(issues).toHaveLength(3)
  })

  it("빈 contains expected는 error", () => {
    expect(validateEvaluatorConfig({ type: "contains", expected: "" }).length).toBe(1)
  })
})

describe("dataset validation", () => {
  const base: Dataset = {
    id: "d",
    name: "d",
    cases: [{ id: "c1", name: "c1", input: "x", evaluator: { type: "json-valid" } }],
  }

  it("정상 dataset은 issue 없음", () => {
    expect(validateDataset(base)).toEqual([])
  })

  it("빈 dataset, 중복 id, 잘못된 evaluator를 모두 보고한다", () => {
    expect(validateDataset({ ...base, cases: [] })[0].message).toContain("test case가 없습니다")
    const issues = validateDataset({
      ...base,
      cases: [
        base.cases[0],
        { id: "c1", name: "dup", input: "y", evaluator: { type: "regex", pattern: "a", flags: "g" } },
      ],
    })
    expect(issues.map((i) => i.message).join("\n")).toContain('중복된 case id "c1"')
    expect(issues.some((i) => i.path.endsWith(".evaluator"))).toBe(true)
  })
})

describe("template", () => {
  it("{{input}} 존재 여부 / 지원하지 않는 placeholder / 빈 template", () => {
    expect(validateTemplate("분류: {{input}}")).toEqual([])
    expect(validateTemplate("   ")[0].message).toContain("비어 있습니다")
    expect(validateTemplate("분류하세요")[0].message).toContain("{{input}} placeholder가 없습니다")
    const issues = validateTemplate("{{input}} {{context}} {{ input }}")
    expect(issues.map((i) => i.message)).toEqual([
      "지원하지 않는 placeholder {{context}} (지원: {{input}})",
      "지원하지 않는 placeholder {{ input }} (지원: {{input}})",
    ])
  })

  it("모든 occurrence를 치환한다", () => {
    expect(renderTemplate("A {{input}} B {{input}}", "x")).toBe("A x B x")
  })

  it("$& 같은 특수 치환 패턴이 그대로 들어간다", () => {
    const input = "가격은 $& 그리고 $1, $$, $` 입니다"
    expect(renderTemplate("Input: {{input}}", input)).toBe(`Input: ${input}`)
  })
})

describe("run input validation", () => {
  const dataset: Dataset = { id: "d", name: "d", cases: [{ id: "c", name: "c", input: "x", evaluator: { type: "json-valid" } }] }
  const variant: PromptVariant = {
    id: "a",
    name: "A",
    promptTemplate: "{{input}}",
    modelConfig: { provider: "demo", model: "m" },
  }
  const config = { concurrency: 3, defaultTimeoutMs: 1000, maxRetries: 2 }

  it("알 수 없는 provider, 범위 밖 concurrency, 빈 template을 보고한다", () => {
    const issues = validateRunInput(
      {
        dataset,
        variants: [variant, { ...variant, id: "b", promptTemplate: "", modelConfig: { provider: "nope", model: "m" } }],
        config: { ...config, concurrency: 5 },
      },
      ["demo"],
    )
    const text = issues.map((i) => `${i.path}: ${i.message}`).join("\n")
    expect(text).toContain("template이 비어 있습니다")
    expect(text).toContain('사용할 수 없는 provider "nope"')
    expect(text).toContain("concurrency는 1 ~ 4")
  })

  it("variant가 없으면 error", () => {
    expect(validateRunInput({ dataset, variants: [], config })[0].message).toContain("variant가 없습니다")
  })
})
