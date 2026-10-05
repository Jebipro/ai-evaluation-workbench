import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { ProviderError } from "./base.ts"
import { DemoProvider } from "./demo.ts"
import { buildOllamaChatBody, normalizeOllamaChatResponse, OllamaChatProvider, type FetchLike } from "./ollama.ts"
import { ProxyProvider } from "./proxy.ts"
import type { ErrorKind, ModelProvider, ModelRequest } from "../types.ts"

// 모든 provider 구현이 공통으로 통과해야 하는 계약:
// 1. 정상 응답 → ModelResponse shape
// 2. abort 시 즉시 reject (cancelled)
// 3. 실패 → ProviderError + 올바른 ErrorKind

const fixture = JSON.parse(readFileSync(new URL("../../../fixtures/ollama-chat-response.json", import.meta.url), "utf8"))

const request: ModelRequest = {
  model: "llama3.2",
  systemPrompt: "분류기",
  prompt: "positive, negative, neutral 중 하나만 출력하세요.\n최고예요",
  input: "최고예요",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

/** signal을 존중하며 영원히 대기하는 fetch */
const hangingFetch: FetchLike = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
  })

type ContractSubject = {
  name: string
  create: () => ModelProvider
  createHanging: () => ModelProvider
  failures: { kind: ErrorKind; create: () => ModelProvider }[]
}

const subjects: ContractSubject[] = [
  {
    name: "DemoProvider",
    create: () => new DemoProvider({ delayMs: 0 }),
    createHanging: () => new DemoProvider({ delayMs: 60_000 }),
    // DemoProvider는 transport 오류가 없다. 실패 계약은 FaultInjectingProvider 테스트에서 다룬다.
    failures: [],
  },
  {
    name: "OllamaChatProvider (fixture + mock fetch)",
    create: () => new OllamaChatProvider({ fetch: async () => jsonResponse(fixture) }),
    createHanging: () => new OllamaChatProvider({ fetch: hangingFetch }),
    failures: [
      { kind: "http_429", create: () => new OllamaChatProvider({ fetch: async () => jsonResponse({ error: "busy" }, 429) }) },
      { kind: "http_5xx", create: () => new OllamaChatProvider({ fetch: async () => jsonResponse({ error: "boom" }, 500) }) },
      {
        kind: "http_4xx",
        create: () => new OllamaChatProvider({ fetch: async () => jsonResponse({ error: "model not found" }, 404) }),
      },
      {
        kind: "network",
        create: () => new OllamaChatProvider({ fetch: async () => Promise.reject(new TypeError("fetch failed")) }),
      },
      {
        kind: "invalid_response",
        create: () => new OllamaChatProvider({ fetch: async () => jsonResponse({ done: true }) }),
      },
    ],
  },
  {
    name: "ProxyProvider (mock server)",
    create: () =>
      new ProxyProvider({ fetch: async () => jsonResponse(normalizeOllamaChatResponse(fixture)) }),
    createHanging: () => new ProxyProvider({ fetch: hangingFetch }),
    failures: [
      {
        kind: "timeout",
        create: () =>
          new ProxyProvider({ fetch: async () => jsonResponse({ error: { kind: "timeout", message: "upstream timeout" } }, 504) }),
      },
      { kind: "http_5xx", create: () => new ProxyProvider({ fetch: async () => new Response("bad gateway", { status: 502 }) }) },
      { kind: "network", create: () => new ProxyProvider({ fetch: async () => Promise.reject(new TypeError("fetch failed")) }) },
      { kind: "invalid_response", create: () => new ProxyProvider({ fetch: async () => jsonResponse({ nope: 1 }) }) },
    ],
  },
]

for (const subject of subjects) {
  describe(`provider contract: ${subject.name}`, () => {
    it("정상 응답 → ModelResponse shape", async () => {
      const response = await subject.create().run(request, { signal: new AbortController().signal })
      expect(typeof response.output).toBe("string")
      if (response.usage !== undefined) {
        for (const value of Object.values(response.usage)) expect(value === undefined || typeof value === "number").toBe(true)
      }
    })

    it("abort 시 즉시 cancelled로 reject", async () => {
      const controller = new AbortController()
      const promise = subject.createHanging().run(request, { signal: controller.signal })
      controller.abort()
      await expect(promise).rejects.toMatchObject({ kind: "cancelled" })
    })

    for (const failure of subject.failures) {
      it(`실패 → ProviderError(${failure.kind})`, async () => {
        const promise = failure.create().run(request, { signal: new AbortController().signal })
        await expect(promise).rejects.toBeInstanceOf(ProviderError)
        await expect(failure.create().run(request, { signal: new AbortController().signal })).rejects.toMatchObject({
          kind: failure.kind,
        })
      })
    }
  })
}

describe("Ollama fixture normalizer", () => {
  it("fixture 출처가 명시되어 있다", () => {
    expect(typeof fixture._source).toBe("string")
  })

  it("message.content → output, prompt_eval_count / eval_count → usage", () => {
    const response = normalizeOllamaChatResponse(fixture)
    expect(response.output).toBe(fixture.message.content)
    expect(response.usage).toEqual({ inputTokens: fixture.prompt_eval_count, outputTokens: fixture.eval_count })
  })

  it("서버 보고 duration은 raw metadata에만 둔다", () => {
    const response = normalizeOllamaChatResponse(fixture)
    expect(response.raw).toMatchObject({ total_duration: fixture.total_duration, eval_duration: fixture.eval_duration })
    expect(response.raw).not.toHaveProperty("_source")
  })

  it("count field가 없으면 usage는 undefined (가짜 숫자를 만들지 않는다)", () => {
    const withoutCounts = { ...fixture }
    delete withoutCounts.prompt_eval_count
    delete withoutCounts.eval_count
    expect(normalizeOllamaChatResponse(withoutCounts).usage).toBeUndefined()

    const onlyOutput = { ...fixture }
    delete onlyOutput.prompt_eval_count
    expect(normalizeOllamaChatResponse(onlyOutput).usage).toEqual({ inputTokens: undefined, outputTokens: fixture.eval_count })
  })

  it("request body: stream false, temperature 기본 0, seed 기본 고정, input은 보내지 않음", () => {
    const body = buildOllamaChatBody(request)
    expect(body).toEqual({
      model: "llama3.2",
      stream: false,
      messages: [
        { role: "system", content: "분류기" },
        { role: "user", content: request.prompt },
      ],
      options: { temperature: 0, seed: 42 },
    })
    expect(buildOllamaChatBody({ ...request, temperature: 0.7, seed: 7 }).options).toEqual({ temperature: 0.7, seed: 7 })
  })
})
