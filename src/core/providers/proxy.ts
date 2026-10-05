import { cancelledError, httpStatusToErrorKind, isErrorKind, ProviderError } from "./base.ts"
import type { FetchLike } from "./ollama.ts"
import type { ModelProvider, ModelRequest, ModelResponse, ProviderDescriptor } from "../types.ts"

// Browser → local Node server(/api/run) → Ollama.
// AbortSignal을 fetch에 그대로 넘기므로 취소 시 server 연결이 끊기고, server는 upstream 요청을 abort한다.

export type ProxyRunRequestBody = {
  model: string
  systemPrompt?: string
  prompt: string
  temperature?: number
  seed?: number
}

export type ProxyRunSuccessBody = Pick<ModelResponse, "output" | "usage" | "raw">
export type ProxyRunErrorBody = { error: { kind: string; message: string; httpStatus?: number } }

export type ProxyProviderOptions = {
  /** 기본 "" (같은 origin, Vite dev proxy가 /api를 server로 넘긴다) */
  serverUrl?: string
  model?: string
  fetch?: FetchLike
}

export class ProxyProvider implements ModelProvider {
  readonly descriptor: ProviderDescriptor
  private readonly serverUrl: string
  private readonly fetchImpl: FetchLike

  constructor(options: ProxyProviderOptions = {}) {
    this.serverUrl = (options.serverUrl ?? "").replace(/\/+$/, "")
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
    this.descriptor = { id: "ollama", kind: "ollama", simulated: false, model: options.model, baseUrl: `${this.serverUrl}/api` }
  }

  async run(request: ModelRequest, options: { signal: AbortSignal }): Promise<ModelResponse> {
    const body: ProxyRunRequestBody = {
      model: request.model,
      systemPrompt: request.systemPrompt,
      prompt: request.prompt,
      temperature: request.temperature,
      seed: request.seed,
    }
    let response: Response
    try {
      response = await this.fetchImpl(`${this.serverUrl}/api/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal.aborted) throw cancelledError()
      throw new ProviderError("network", `local server에 연결할 수 없습니다: ${(error as Error).message}`, { cause: error })
    }
    let json: unknown
    try {
      json = await response.json()
    } catch (error) {
      if (options.signal.aborted) throw cancelledError()
      if (!response.ok) throw new ProviderError(httpStatusToErrorKind(response.status), `server HTTP ${response.status}`, { httpStatus: response.status })
      throw new ProviderError("invalid_response", "server 응답 JSON을 읽을 수 없습니다.", { cause: error })
    }
    if (!response.ok) {
      const error = (json as Partial<ProxyRunErrorBody>).error
      const kind = isErrorKind(error?.kind) ? error.kind : httpStatusToErrorKind(response.status)
      throw new ProviderError(kind, error?.message ?? `server HTTP ${response.status}`, {
        httpStatus: error?.httpStatus ?? response.status,
      })
    }
    const success = json as Partial<ProxyRunSuccessBody>
    if (typeof success.output !== "string") {
      throw new ProviderError("invalid_response", "server 응답에 output 문자열이 없습니다.")
    }
    return { output: success.output, usage: success.usage, raw: success.raw }
  }
}
