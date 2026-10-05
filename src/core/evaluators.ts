import type {
  EvaluatorConfig,
  JsonFieldRule,
  JsonValueType,
  NormalizationOptions,
} from "./types.ts"

// Deterministic evaluator. 모두 순수 함수이며 score는 0.0 ~ 1.0.
// 실행 error로 output이 없는 case에는 호출하지 않는다 (runner 책임).

export type EvaluationOutcome = { score: number; reason: string }

export const DEFAULT_NORMALIZATION: NormalizationOptions = {
  trim: true,
  caseSensitive: true,
  collapseWhitespace: false,
}

export const DEFAULT_THRESHOLD = 1.0

export function resolveNormalization(options?: Partial<NormalizationOptions>): NormalizationOptions {
  return { ...DEFAULT_NORMALIZATION, ...options }
}

export function normalizeText(value: string, options: NormalizationOptions): string {
  let result = value
  if (options.trim) result = result.trim()
  if (options.collapseWhitespace) result = result.replace(/\s+/g, " ")
  if (!options.caseSensitive) result = result.toLowerCase()
  return result
}

export function getThreshold(config: EvaluatorConfig): number {
  return config.threshold ?? DEFAULT_THRESHOLD
}

/** passed = score >= threshold */
export function isPassed(score: number, threshold: number): boolean {
  return score >= threshold
}

export function evaluate(config: EvaluatorConfig, output: string): EvaluationOutcome {
  switch (config.type) {
    case "exact-match":
      return evaluateExactMatch(config.expected, output, resolveNormalization(config.normalization))
    case "contains":
      return evaluateContains(config.expected, output, resolveNormalization(config.normalization))
    case "regex":
      return evaluateRegex(config.pattern, config.flags, output)
    case "json-valid":
      return evaluateJsonValid(output)
    case "json-fields":
      return evaluateJsonFields(config.rules, output)
  }
}

const PREVIEW_LIMIT = 80

function preview(value: string): string {
  const oneLine = value.replace(/\n/g, "\\n")
  return oneLine.length > PREVIEW_LIMIT ? `${oneLine.slice(0, PREVIEW_LIMIT)}…` : oneLine
}

function evaluateExactMatch(expected: string, output: string, options: NormalizationOptions): EvaluationOutcome {
  const a = normalizeText(output, options)
  const e = normalizeText(expected, options)
  if (a === e) return { score: 1, reason: "정규화 후 expected와 정확히 일치합니다." }
  return {
    score: 0,
    reason: `정규화 후 expected와 일치하지 않습니다. expected="${preview(e)}", actual="${preview(a)}"`,
  }
}

function evaluateContains(expected: string, output: string, options: NormalizationOptions): EvaluationOutcome {
  const a = normalizeText(output, options)
  const e = normalizeText(expected, options)
  if (a.includes(e)) return { score: 1, reason: `출력에 "${preview(e)}"가 포함되어 있습니다.` }
  return { score: 0, reason: `출력에 "${preview(e)}"가 포함되어 있지 않습니다.` }
}

function evaluateRegex(pattern: string, flags: string | undefined, output: string): EvaluationOutcome {
  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags ?? "")
  } catch (error) {
    // 정상 흐름에서는 실행 전 validation이 막는다.
    return { score: 0, reason: `regex를 생성할 수 없습니다: ${(error as Error).message}` }
  }
  if (regex.test(output)) return { score: 1, reason: `출력이 /${pattern}/${flags ?? ""}와 일치합니다.` }
  return { score: 0, reason: `출력이 /${pattern}/${flags ?? ""}와 일치하지 않습니다.` }
}

// ---------------------------------------------------------------------------
// Strict JSON
// ---------------------------------------------------------------------------

export type StrictJsonResult = { ok: true; value: unknown } | { ok: false; reason: string }

/**
 * output.trim()을 그대로 JSON.parse한다.
 * markdown code fence 제거나 prose 속 JSON 추출 같은 관대한 처리는 하지 않는다.
 */
export function parseStrictJson(output: string): StrictJsonResult {
  const text = output.trim()
  if (text === "") return { ok: false, reason: "출력이 비어 있어 valid JSON이 아닙니다." }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    if (text.includes("```")) {
      return {
        ok: false,
        reason: "출력이 markdown code fence로 감싸져 있어 strict JSON이 아닙니다.",
      }
    }
    return { ok: false, reason: `valid JSON이 아닙니다: ${(error as Error).message}` }
  }
}

function evaluateJsonValid(output: string): EvaluationOutcome {
  const parsed = parseStrictJson(output)
  if (parsed.ok) return { score: 1, reason: "valid JSON입니다." }
  return { score: 0, reason: parsed.reason }
}

type PathLookup = { found: true; value: unknown } | { found: false }

export function resolveJsonPath(root: unknown, path: string): PathLookup {
  let current: unknown = root
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return { found: false }
      const index = Number(segment)
      if (index >= current.length) return { found: false }
      current = current[index]
    } else if (typeof current === "object" && current !== null) {
      if (!Object.hasOwn(current, segment)) return { found: false }
      current = (current as Record<string, unknown>)[segment]
    } else {
      return { found: false }
    }
  }
  return { found: true, value: current }
}

export function jsonTypeOf(value: unknown): JsonValueType {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  const t = typeof value
  if (t === "string" || t === "number" || t === "boolean") return t
  return "object"
}

function formatValue(value: unknown): string {
  const text = JSON.stringify(value)
  return text === undefined ? String(value) : preview(text)
}

/** rule 하나를 검사하고 실패 이유를 돌려준다. 통과하면 undefined */
export function checkJsonFieldRule(root: unknown, rule: JsonFieldRule): string | undefined {
  const lookup = resolveJsonPath(root, rule.path)
  if (!lookup.found) {
    if (rule.required === false) return undefined
    return `${rule.path}: 필수 field가 없습니다`
  }
  const value = lookup.value
  if (rule.type !== undefined && jsonTypeOf(value) !== rule.type) {
    return `${rule.path}: 기대 type ${rule.type}, 실제 ${jsonTypeOf(value)}`
  }
  if (rule.equals !== undefined && value !== rule.equals) {
    return `${rule.path}: 기대 값 ${formatValue(rule.equals)}, 실제 ${formatValue(value)}`
  }
  if (rule.oneOf !== undefined && !rule.oneOf.some((option) => option === value)) {
    return `${rule.path}: ${formatValue(value)}는 허용 값 ${formatValue(rule.oneOf)}에 없습니다`
  }
  return undefined
}

function evaluateJsonFields(rules: JsonFieldRule[], output: string): EvaluationOutcome {
  const parsed = parseStrictJson(output)
  if (!parsed.ok) {
    return { score: 0, reason: `valid JSON 아님 → 모든 field rule 실패 (0/${rules.length}). ${parsed.reason}` }
  }
  const failures = rules
    .map((rule) => checkJsonFieldRule(parsed.value, rule))
    .filter((failure): failure is string => failure !== undefined)
  const passedCount = rules.length - failures.length
  const score = rules.length === 0 ? 0 : passedCount / rules.length
  if (failures.length === 0) {
    return { score, reason: `모든 field rule 충족 (${passedCount}/${rules.length}).` }
  }
  return {
    score,
    reason: `field rule ${passedCount}/${rules.length} 충족. 실패: ${failures.join("; ")}`,
  }
}
