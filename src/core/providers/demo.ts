import { abortableSleep, throwIfAborted } from "./base.ts"
import type { ModelProvider, ModelRequest, ModelResponse, ProviderDescriptor } from "../types.ts"

// ============================================================================
// Rule-based DemoProvider
//
// 실제 LLM 응답이 아닌 규칙 기반 시뮬레이션이다. 같은 prompt + 같은 input에는 항상 같은
// output을 낸다. case ID / variant ID로 성공·실패를 결정하지 않으며, prompt의 지시문에만 반응한다.
//
// "지시문(instructions)" = systemPrompt + rendered prompt에서 input 텍스트를 제거한 나머지.
//
// | #  | 규칙                         | 지시가 있을 때                     | 지시가 없을 때                                   |
// |----|------------------------------|------------------------------------|--------------------------------------------------|
// | R0 | input이 prompt에 렌더링됨     | 아래 규칙 적용                     | "입력이 제공되지 않았습니다." 출력               |
// | R1 | 지시문에 "json" 포함          | 연락처 JSON 추출 task               | 감정 분류 task                                   |
// | R2 | (분류) positive/negative/neutral 세 label 모두 명시 | 세 label 중 선택 | neutral을 모름 → 중립 입력에 "mixed"            |
// | R3 | (분류) 출력 형식 지시 (only, 하나만, 만 출력, 만 답, 한 단어) | label만 출력 | "The sentiment is <label>." 문장 |
// | R4 | (JSON) JSON only 지시 (json only, only json, json만, 다른 텍스트 없이) | raw JSON | 설명문 + ```json fence |
// | R5 | (JSON) field 이름(name, email, age, city) 명시 | 해당 field 포함 (못 찾으면 null) | 해당 field 누락 |
//
// 감정 판단은 작은 lexicon의 substring 개수 비교다 (부정어 처리 없음 → "좋지 않았어요"는 positive로
// 오판한다. 일부러 두 prompt 모두 틀리는 case를 만들기 위한 단순함이다).
// ============================================================================

export const DEMO_PROVIDER_ID = "demo"
export const DEMO_MODEL = "demo-rule-based-v1"
export const DEFAULT_DEMO_DELAY_MS = 150

export const POSITIVE_LEXICON = ["좋", "최고", "만족", "훌륭", "추천", "빨라", "빠르", "빨랐", "친절"]
export const NEGATIVE_LEXICON = ["별로", "최악", "실망", "느리", "느렸", "느려", "불친절", "환불", "고장"]

export const SENTIMENT_LABELS = ["positive", "negative", "neutral"] as const

export const FORMAT_HINTS = ["only", "하나만", "만 출력", "만 답", "한 단어"]
export const JSON_ONLY_HINTS = ["json only", "only json", "json만", "다른 텍스트 없이"]
export const KNOWN_FIELDS = ["name", "email", "age", "city"] as const
export const KNOWN_CITIES = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "제주"]

function countHits(text: string, lexicon: readonly string[]): number {
  return lexicon.reduce((count, word) => count + text.split(word).length - 1, 0)
}

/** "불친절"이 "친절"로도 집계되지 않도록 부정 lexicon에 포함된 긍정 단어 중복을 보정한다. */
export function lexiconSentiment(input: string): "positive" | "negative" | "neutral" {
  const negative = countHits(input, NEGATIVE_LEXICON)
  const positive = countHits(input, POSITIVE_LEXICON) - countHits(input, ["불친절"])
  if (positive > negative) return "positive"
  if (negative > positive) return "negative"
  return "neutral"
}

export function getInstructions(request: Pick<ModelRequest, "systemPrompt" | "prompt" | "input">): string {
  const prompt = request.input === "" ? request.prompt : request.prompt.split(request.input).join("")
  return `${request.systemPrompt ?? ""}\n${prompt}`.toLowerCase()
}

function hasAny(text: string, hints: readonly string[]): boolean {
  return hints.some((hint) => text.includes(hint))
}

function simulateClassification(instructions: string, input: string): string {
  const listsAllLabels = SENTIMENT_LABELS.every((label) => instructions.includes(label))
  const sentiment = lexiconSentiment(input)
  const label = sentiment === "neutral" && !listsAllLabels ? "mixed" : sentiment
  return hasAny(instructions, FORMAT_HINTS) ? label : `The sentiment is ${label}.`
}

export function extractContact(input: string): Record<(typeof KNOWN_FIELDS)[number], string | number | null> {
  const name = /(?:저는|이름은|이름:)\s*([가-힣]{2,4}?)(?:입니다|이고|이며|이에요|예요|[,.\s]|$)/.exec(input)?.[1] ?? null
  const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(input)?.[0] ?? null
  const ageMatch = /(\d{1,3})\s*(?:세|살)/.exec(input)
  const city = KNOWN_CITIES.find((c) => input.includes(c)) ?? null
  return { name, email, age: ageMatch ? Number(ageMatch[1]) : null, city }
}

function simulateJsonExtraction(instructions: string, input: string): string {
  const contact = extractContact(input)
  const object: Record<string, string | number | null> = {}
  for (const field of KNOWN_FIELDS) {
    if (new RegExp(`\\b${field}\\b`).test(instructions)) object[field] = contact[field]
  }
  if (hasAny(instructions, JSON_ONLY_HINTS)) return JSON.stringify(object)
  return `다음은 추출한 연락처 정보입니다:\n\`\`\`json\n${JSON.stringify(object, null, 2)}\n\`\`\``
}

/** DemoProvider의 순수 simulator. 동일 request → 동일 output */
export function simulateDemoOutput(request: Pick<ModelRequest, "systemPrompt" | "prompt" | "input">): string {
  if (request.input !== "" && !request.prompt.includes(request.input)) return "입력이 제공되지 않았습니다."
  const instructions = getInstructions(request)
  if (instructions.includes("json")) return simulateJsonExtraction(instructions, request.input)
  return simulateClassification(instructions, request.input)
}

export type DemoProviderOptions = { delayMs?: number }

export class DemoProvider implements ModelProvider {
  readonly descriptor: ProviderDescriptor = {
    id: DEMO_PROVIDER_ID,
    kind: "demo",
    simulated: true,
    model: DEMO_MODEL,
  }
  private readonly delayMs: number

  constructor(options: DemoProviderOptions = {}) {
    this.delayMs = options.delayMs ?? DEFAULT_DEMO_DELAY_MS
  }

  async run(request: ModelRequest, options: { signal: AbortSignal }): Promise<ModelResponse> {
    throwIfAborted(options.signal)
    if (this.delayMs > 0) await abortableSleep(this.delayMs, options.signal)
    // simulated provider는 usage를 만들지 않는다 (가짜 숫자 금지).
    return { output: simulateDemoOutput(request), raw: { simulated: true, rules: "demo-rule-based-v1" } }
  }
}
