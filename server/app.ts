import http from "node:http"
import { ProviderError } from "../src/core/providers/base.ts"
import { DEFAULT_OLLAMA_BASE_URL, OllamaChatProvider, type FetchLike } from "../src/core/providers/ollama.ts"
import type { ProxyRunRequestBody } from "../src/core/providers/proxy.ts"
import type { ErrorKind } from "../src/core/types.ts"

// 최소 local HTTP server: browser → server → Ollama
// 담당: request validation, Ollama /api/chat(stream: false) 호출, timeout, ErrorKind 정규화,
//       client 연결 종료 시 upstream 요청 abort, usage 정규화(core normalizer 재사용).
// auth / DB / framework 없음. 127.0.0.1에만 bind한다.

export type WorkbenchServerOptions = {
  ollamaBaseUrl?: string
  /** server 측 upstream timeout. Runner timeout(기본 30초)보다 길게 둔다 */
  upstreamTimeoutMs?: number
  maxBodyBytes?: number
  fetch?: FetchLike
}

export const DEFAULT_UPSTREAM_TIMEOUT_MS = 120_000
const DEFAULT_MAX_BODY_BYTES = 1_000_000

class HttpError extends Error {
  readonly status: number
  readonly kind: ErrorKind
  constructor(status: number, kind: ErrorKind, message: string) {
    super(message)
    this.status = status
    this.kind = kind
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return
  const text = JSON.stringify(body)
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  res.end(text)
}

function sendError(res: http.ServerResponse, status: number, kind: ErrorKind, message: string, httpStatus?: number): void {
  sendJson(res, status, { error: { kind, message, ...(httpStatus === undefined ? {} : { httpStatus }) } })
}

async function readJsonBody(req: http.IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, "http_4xx", "request body가 너무 큽니다.")
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new HttpError(400, "http_4xx", "request body가 valid JSON이 아닙니다.")
  }
}

export function validateRunRequest(body: unknown): ProxyRunRequestBody {
  if (typeof body !== "object" || body === null) throw new HttpError(400, "http_4xx", "request body는 object여야 합니다.")
  const b = body as Record<string, unknown>
  const problems: string[] = []
  if (typeof b.model !== "string" || b.model.trim() === "" || b.model.length > 200) problems.push("model은 1~200자 문자열이어야 합니다")
  if (typeof b.prompt !== "string" || b.prompt.length > 100_000) problems.push("prompt는 100,000자 이하 문자열이어야 합니다")
  if (b.systemPrompt !== undefined && typeof b.systemPrompt !== "string") problems.push("systemPrompt는 문자열이어야 합니다")
  if (b.temperature !== undefined && (typeof b.temperature !== "number" || !(b.temperature >= 0 && b.temperature <= 2))) {
    problems.push("temperature는 0~2 숫자여야 합니다")
  }
  if (b.seed !== undefined && !Number.isInteger(b.seed)) problems.push("seed는 정수여야 합니다")
  if (problems.length > 0) throw new HttpError(400, "http_4xx", `잘못된 request: ${problems.join(", ")}`)
  return {
    model: (b.model as string).trim(),
    prompt: b.prompt as string,
    systemPrompt: b.systemPrompt as string | undefined,
    temperature: b.temperature as number | undefined,
    seed: b.seed as number | undefined,
  }
}

/** upstream ErrorKind → browser에 돌려줄 HTTP status. kind는 body에 그대로 담는다. */
function statusForKind(kind: ErrorKind): number {
  switch (kind) {
    case "timeout":
      return 504
    case "http_429":
      return 429
    default:
      return 502
  }
}

export function createWorkbenchServer(options: WorkbenchServerOptions = {}): http.Server {
  const ollamaBaseUrl = (options.ollamaBaseUrl ?? DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "")
  const upstreamTimeoutMs = options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init))
  const provider = new OllamaChatProvider({ baseUrl: ollamaBaseUrl, fetch: fetchImpl })

  async function handleRun(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = validateRunRequest(await readJsonBody(req, maxBodyBytes))
    const controller = new AbortController()
    let timedOut = false
    // client가 연결을 끊으면(취소) upstream Ollama 요청도 abort한다
    const onClose = () => {
      if (!res.writableFinished) controller.abort()
    }
    res.on("close", onClose)
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, upstreamTimeoutMs)
    try {
      const response = await provider.run({ ...body, input: "" }, { signal: controller.signal })
      sendJson(res, 200, { output: response.output, usage: response.usage, raw: response.raw })
    } catch (error) {
      if (timedOut) {
        sendError(res, 504, "timeout", `Ollama가 ${upstreamTimeoutMs}ms 안에 응답하지 않았습니다.`)
      } else if (controller.signal.aborted) {
        // client가 이미 떠났으므로 보낼 곳이 없다
      } else if (error instanceof ProviderError) {
        sendError(res, statusForKind(error.kind), error.kind, error.message, error.httpStatus)
      } else {
        sendError(res, 500, "unknown", error instanceof Error ? error.message : String(error))
      }
    } finally {
      clearTimeout(timer)
      res.off("close", onClose)
    }
  }

  async function handleHealth(res: http.ServerResponse): Promise<void> {
    try {
      const response = await fetchImpl(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      if (!response.ok) {
        sendJson(res, 200, { ok: true, ollama: { baseUrl: ollamaBaseUrl, reachable: false, error: `HTTP ${response.status}` } })
        return
      }
      const json = (await response.json()) as { models?: { name?: unknown }[] }
      const models = (json.models ?? []).map((m) => m.name).filter((name): name is string => typeof name === "string")
      sendJson(res, 200, { ok: true, ollama: { baseUrl: ollamaBaseUrl, reachable: true, models } })
    } catch (error) {
      sendJson(res, 200, {
        ok: true,
        ollama: { baseUrl: ollamaBaseUrl, reachable: false, error: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    const route = `${req.method} ${url.pathname}`
    const handler =
      route === "POST /api/run" ? handleRun(req, res) : route === "GET /api/health" ? handleHealth(res) : undefined
    if (!handler) {
      sendError(res, 404, "http_4xx", `알 수 없는 경로: ${route}`)
      return
    }
    handler.catch((error: unknown) => {
      if (error instanceof HttpError) sendError(res, error.status, error.kind, error.message)
      else sendError(res, 500, "unknown", error instanceof Error ? error.message : String(error))
    })
  })
}
