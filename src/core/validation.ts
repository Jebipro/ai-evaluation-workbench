import { validateTemplate } from "./template.ts"
import type { Dataset, EvaluatorConfig, JsonFieldRule, PromptVariant, RunConfig } from "./types.ts"

// 실행 전 validation. 하나라도 issue가 있으면 run을 시작하지 않는다.

export type ValidationIssue = {
  /** 사람이 읽을 수 있는 위치. 예: "dataset.cases[2].evaluator", "variant B.promptTemplate" */
  path: string
  message: string
}

export const REGEX_MAX_PATTERN_LENGTH = 500
export const ALLOWED_REGEX_FLAGS = ["i", "m", "s", "u"] as const

export const CONCURRENCY_RANGE = { min: 1, max: 4 } as const
export const TIMEOUT_RANGE_MS = { min: 1, max: 600_000 } as const
export const MAX_RETRIES_RANGE = { min: 0, max: 5 } as const

const JSON_VALUE_TYPES = ["string", "number", "boolean", "object", "array", "null"]

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isJsonPrimitive(value: unknown): boolean {
  return value === null || typeof value === "string" || typeof value === "boolean" || isFiniteNumber(value)
}

export function validateRegex(pattern: string, flags: string | undefined): string[] {
  const issues: string[] = []
  if (pattern.length === 0) issues.push("regex pattern이 비어 있습니다.")
  if (pattern.length > REGEX_MAX_PATTERN_LENGTH) {
    issues.push(`regex pattern이 너무 깁니다 (${pattern.length}자, 상한 ${REGEX_MAX_PATTERN_LENGTH}자).`)
  }
  const flagText = flags ?? ""
  const seen = new Set<string>()
  for (const flag of flagText) {
    if (!(ALLOWED_REGEX_FLAGS as readonly string[]).includes(flag)) {
      issues.push(`허용되지 않는 regex flag "${flag}" (허용: ${ALLOWED_REGEX_FLAGS.join(" ")}).`)
    } else if (seen.has(flag)) {
      issues.push(`중복된 regex flag "${flag}".`)
    }
    seen.add(flag)
  }
  if (issues.length === 0) {
    try {
      new RegExp(pattern, flagText)
    } catch (error) {
      issues.push(`regex를 생성할 수 없습니다: ${(error as Error).message}`)
    }
  }
  return issues
}

function validateJsonFieldRule(rule: JsonFieldRule): string[] {
  const issues: string[] = []
  if (typeof rule.path !== "string" || rule.path.trim() === "") {
    issues.push("rule path가 비어 있습니다.")
  } else if (rule.path.split(".").some((segment) => segment === "")) {
    issues.push(`rule path "${rule.path}"에 빈 segment가 있습니다.`)
  }
  if (rule.type !== undefined && !JSON_VALUE_TYPES.includes(rule.type)) {
    issues.push(`알 수 없는 type "${String(rule.type)}".`)
  }
  if (rule.equals !== undefined && !isJsonPrimitive(rule.equals)) {
    issues.push("equals는 JSON primitive여야 합니다.")
  }
  if (rule.oneOf !== undefined) {
    if (!Array.isArray(rule.oneOf) || rule.oneOf.length === 0) issues.push("oneOf는 비어 있지 않은 배열이어야 합니다.")
    else if (!rule.oneOf.every(isJsonPrimitive)) issues.push("oneOf의 값은 JSON primitive여야 합니다.")
  }
  return issues
}

export function validateEvaluatorConfig(config: EvaluatorConfig): string[] {
  const issues: string[] = []
  if (config.threshold !== undefined && (!isFiniteNumber(config.threshold) || config.threshold < 0 || config.threshold > 1)) {
    issues.push(`threshold는 0 ~ 1 범위여야 합니다 (현재 ${String(config.threshold)}).`)
  }
  switch (config.type) {
    case "exact-match":
      if (typeof config.expected !== "string") issues.push("expected는 문자열이어야 합니다.")
      break
    case "contains":
      if (typeof config.expected !== "string" || config.expected === "") {
        issues.push("contains의 expected가 비어 있습니다 (항상 통과하게 됩니다).")
      }
      break
    case "regex":
      issues.push(...validateRegex(config.pattern, config.flags))
      break
    case "json-valid":
      break
    case "json-fields":
      if (!Array.isArray(config.rules) || config.rules.length === 0) {
        issues.push("json-fields rule 목록이 비어 있습니다.")
      } else {
        config.rules.forEach((rule, index) => {
          for (const message of validateJsonFieldRule(rule)) issues.push(`rules[${index}]: ${message}`)
        })
      }
      break
    default:
      issues.push(`알 수 없는 evaluator type "${(config as { type: unknown }).type}".`)
  }
  return issues
}

export function validateDataset(dataset: Dataset): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (dataset.cases.length === 0) {
    issues.push({ path: "dataset", message: "test case가 없습니다." })
  }
  const seenIds = new Set<string>()
  dataset.cases.forEach((testCase, index) => {
    const path = `dataset.cases[${index}] (${testCase.name || testCase.id})`
    if (!testCase.id) issues.push({ path, message: "case id가 비어 있습니다." })
    else if (seenIds.has(testCase.id)) issues.push({ path, message: `중복된 case id "${testCase.id}".` })
    seenIds.add(testCase.id)
    if (!testCase.name?.trim()) issues.push({ path, message: "case name이 비어 있습니다." })
    if (typeof testCase.input !== "string") issues.push({ path, message: "input은 문자열이어야 합니다." })
    for (const message of validateEvaluatorConfig(testCase.evaluator)) {
      issues.push({ path: `${path}.evaluator`, message })
    }
  })
  return issues
}

export function validateVariant(variant: PromptVariant, knownProviders?: readonly string[]): ValidationIssue[] {
  const label = `variant ${variant.name || variant.id}`
  const issues: ValidationIssue[] = []
  for (const issue of validateTemplate(variant.promptTemplate)) {
    issues.push({ path: `${label}.promptTemplate`, message: issue.message })
  }
  const { provider, model, temperature, seed } = variant.modelConfig
  if (!provider) issues.push({ path: `${label}.provider`, message: "provider가 지정되지 않았습니다." })
  else if (knownProviders && !knownProviders.includes(provider)) {
    issues.push({ path: `${label}.provider`, message: `사용할 수 없는 provider "${provider}".` })
  }
  if (!model?.trim()) issues.push({ path: `${label}.model`, message: "model이 비어 있습니다." })
  if (temperature !== undefined && (!isFiniteNumber(temperature) || temperature < 0 || temperature > 2)) {
    issues.push({ path: `${label}.temperature`, message: "temperature는 0 ~ 2 범위여야 합니다." })
  }
  if (seed !== undefined && !Number.isInteger(seed)) {
    issues.push({ path: `${label}.seed`, message: "seed는 정수여야 합니다." })
  }
  return issues
}

function checkRange(value: number, range: { min: number; max: number }, path: string, label: string): ValidationIssue[] {
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    return [{ path, message: `${label}는 ${range.min} ~ ${range.max} 사이의 정수여야 합니다 (현재 ${value}).` }]
  }
  return []
}

export function validateRunConfig(config: RunConfig): ValidationIssue[] {
  return [
    ...checkRange(config.concurrency, CONCURRENCY_RANGE, "config.concurrency", "concurrency"),
    ...checkRange(config.defaultTimeoutMs, TIMEOUT_RANGE_MS, "config.defaultTimeoutMs", "timeout(ms)"),
    ...checkRange(config.maxRetries, MAX_RETRIES_RANGE, "config.maxRetries", "maxRetries"),
  ]
}

export function validateRunInput(
  input: { dataset: Dataset; variants: PromptVariant[]; config: RunConfig },
  knownProviders?: readonly string[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (input.variants.length === 0) issues.push({ path: "variants", message: "선택된 variant가 없습니다." })
  const seenIds = new Set<string>()
  for (const variant of input.variants) {
    if (seenIds.has(variant.id)) issues.push({ path: "variants", message: `중복된 variant id "${variant.id}".` })
    seenIds.add(variant.id)
  }
  issues.push(...validateDataset(input.dataset))
  for (const variant of input.variants) issues.push(...validateVariant(variant, knownProviders))
  issues.push(...validateRunConfig(input.config))
  return issues
}
