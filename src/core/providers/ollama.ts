import { cancelledError, httpStatusToErrorKind, ProviderError } from "./base.ts"
import type { ModelProvider, ModelRequest, ModelResponse, ProviderDescriptor, TokenUsage } from "../types.ts"

// Ollama /api/chat (stream: false) 호출과 응답 정규화.
// 이 provider는 local Node server에서 사용한다. 브라우저는 ProxyProvider로 server를 거친다.

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"
export const DEFAULT_TEMPERATURE = 0
export const DEFAULT_SEED = 42

export type OllamaChatBody = {
  model: string
  messages: { role: "system" | "user"; content: string }[]
  stream: false
  options: { temperature: number; seed: number }
}

/** request.input은 DemoProvider 전용 metadata이므로 Ollama로 보내지 않는다. */
export function buildOllamaChatBody(request: Omit<ModelRequest, "input">): OllamaChatBody {
  const messages: OllamaChatBody["messages"] = []
  if (request.systemPrompt?.trim()) messages.push({ role: "system", content: request.systemPrompt })
  messages.push({ role: "user", content: request.prompt })
  return {
    model: request.model,
    messages,
    stream: false,
    options: {
      temperature: request.temperature ?? DEFAULT_TEMPERATURE,
      seed: request.seed ?? DEFAULT_SEED,
    },
  }
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

const RAW_METADATA_KEYS = [
  "model",
  "created_at",
  "done_reason",
  "total_duration",
  "load_duration",
  "prompt_eval_count",
  "prompt_eval_duration",
  "eval_count",
  "eval_duration",
] as const

/**
 * Ollama chat 응답 → ModelResponse.
 * - output: message.content (문자열이 아니면 invalid_response)
 * - usage: prompt_eval_count → inputTokens, eval_count → outputTokens. 없으면 undefined
 * - 서버 보고 duration은 raw metadata에만 보존한다 (latency는 Runner가 측정).
 */
export function normalizeOllamaChatResponse(json: unknown): ModelResponse {
  if (typeof json !== "object" || json === null) {
    throw new ProviderError("invalid_response", "Ollama 응답이 JSON object가 아닙니다.")
  }
  const body = json as Record<string, unknown>
  const message = body.message as Record<string, unknown> | undefined
  if (typeof message !== "object" || message === null || typeof message.content !== "string") {
    throw new ProviderError("invalid_response", "Ollama 응답에 message.content 문자열이 없습니다.")
  }
  const inputTokens = optionalCount(body.prompt_eval_count)
  const outputTokens = optionalCount(body.eval_count)
  const usage: TokenUsage | undefined =
    inputTokens === undefined && outputTokens === undefined ? undefined : { inputTokens, outputTokens }
  const raw: Record<string, unknown> = {}
  for (const key of RAW_METADATA_KEYS) if (body[key] !== undefined) raw[key] = body[key]
  return { output: message.content, usage, raw }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export type OllamaChatProviderOptions = {
  baseUrl?: string
  fetch?: FetchLike
}

export class OllamaChatProvider implements ModelProvider {
  readonly descriptor: ProviderDescriptor
  private readonly baseUrl: string
  private readonly fetchImpl: FetchLike

  constructor(options: OllamaChatProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "")
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
    this.descriptor = { id: "ollama", kind: "ollama", simulated: false, baseUrl: this.baseUrl }
  }

  async run(request: ModelRequest, options: { signal: AbortSignal }): Promise<ModelResponse> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildOllamaChatBody(request)),
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal.aborted) throw cancelledError()
      throw new ProviderError("network", `Ollama에 연결할 수 없습니다: ${(error as Error).message}`, { cause: error })
    }
    if (!response.ok) {
      const detail = await readErrorDetail(response)
      throw new ProviderError(httpStatusToErrorKind(response.status), `Ollama HTTP ${response.status}${detail}`, {
        httpStatus: response.status,
      })
    }
    let json: unknown
    try {
      json = await response.json()
    } catch (error) {
      if (options.signal.aborted) throw cancelledError()
      throw new ProviderError("invalid_response", "Ollama 응답 JSON을 읽을 수 없습니다.", { cause: error })
    }
    return normalizeOllamaChatResponse(json)
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text()
    if (!text) return ""
    try {
      const parsed = JSON.parse(text) as { error?: unknown }
      if (typeof parsed.error === "string") return `: ${parsed.error}`
    } catch {
      // plain text body
    }
    return `: ${text.slice(0, 200)}`
  } catch {
    return ""
  }
}
