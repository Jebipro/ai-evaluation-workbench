import { describe, expect, it } from "vitest"
import { ProviderError } from "./base.ts"
import { DemoProvider, extractContact, lexiconSentiment, simulateDemoOutput } from "./demo.ts"
import { renderTemplate } from "../template.ts"
import type { ModelRequest } from "../types.ts"

function request(template: string, input: string, systemPrompt?: string): ModelRequest {
  return { model: "demo", prompt: renderTemplate(template, input), input, systemPrompt }
}

const LABELED_FORMATTED = "positive, negative, neutral 중 하나로 분류하세요. 레이블 하나만 출력하세요.\n{{input}}"

describe("DemoProvider 규칙 (README 표와 동일)", () => {
  it("R0: input이 prompt에 렌더링되지 않으면 입력 없음 응답", () => {
    expect(simulateDemoOutput({ prompt: "분류하세요", input: "좋아요" })).toBe("입력이 제공되지 않았습니다.")
  })

  it("R1: 지시문에 json이 있으면 JSON task, 없으면 분류 task", () => {
    expect(simulateDemoOutput(request("JSON only. name: {{input}}", "저는 김민수입니다."))).toBe('{"name":"김민수"}')
    expect(simulateDemoOutput(request(LABELED_FORMATTED, "최고예요"))).toBe("positive")
  })

  it("R1: input 안의 단어는 지시문으로 취급하지 않는다", () => {
    // input에 "json"이 있어도 지시문에는 없으므로 분류 task
    expect(simulateDemoOutput(request(LABELED_FORMATTED, "json 파일이 별로예요"))).toBe("negative")
  })

  it("R2: category 목록이 없으면 neutral을 모르고 mixed라고 답한다", () => {
    expect(simulateDemoOutput(request("감정을 한 단어로만 답하세요.\n{{input}}", "상품을 받았습니다."))).toBe("mixed")
    expect(simulateDemoOutput(request(LABELED_FORMATTED, "상품을 받았습니다."))).toBe("neutral")
  })

  it("R3: 출력 형식 지시가 없으면 label이 문장에 섞인다", () => {
    expect(simulateDemoOutput(request("positive, negative, neutral로 분류하세요.\n{{input}}", "최악이에요"))).toBe(
      "The sentiment is negative.",
    )
  })

  it("R4: JSON only 지시가 없으면 설명문 + code fence", () => {
    const output = simulateDemoOutput(request("JSON으로 추출하세요. name을 포함하세요.\n{{input}}", "저는 김민수입니다."))
    expect(output).toContain("```json")
    expect(output.startsWith("다음은")).toBe(true)
  })

  it("R5: prompt에 명시된 field만 출력하고 못 찾은 값은 null", () => {
    const output = simulateDemoOutput(request("JSON only. name, age, city.\n{{input}}", "저는 김민수입니다. 29세."))
    expect(JSON.parse(output)).toEqual({ name: "김민수", age: 29, city: null })
  })

  it("lexicon 감정 판단은 단순 substring 비교다 (부정어 미처리)", () => {
    expect(lexiconSentiment("배송은 빨랐지만 포장이 별로였어요.")).toBe("neutral")
    expect(lexiconSentiment("고객센터가 불친절해요")).toBe("negative")
    expect(lexiconSentiment("좋지 않았어요")).toBe("positive")
  })

  it("연락처 추출 패턴", () => {
    expect(extractContact("이름: 박서연, seoyeon@example.org, 부산, 34살")).toEqual({
      name: "박서연",
      email: "seoyeon@example.org",
      age: 34,
      city: "부산",
    })
  })
})

describe("DemoProvider determinism / prompt sensitivity", () => {
  it("같은 prompt + 같은 input → 항상 같은 output", async () => {
    const provider = new DemoProvider({ delayMs: 0 })
    const req = request(LABELED_FORMATTED, "배송이 빨라서 만족해요")
    const outputs = await Promise.all(
      Array.from({ length: 5 }, () => provider.run(req, { signal: new AbortController().signal })),
    )
    expect(new Set(outputs.map((o) => o.output)).size).toBe(1)
  })

  it("prompt를 바꾸면 output이 달라진다", () => {
    const input = "상품을 오늘 수령했습니다."
    const vague = simulateDemoOutput(request("감정을 알려주세요.\n{{input}}", input))
    const precise = simulateDemoOutput(request(LABELED_FORMATTED, input))
    expect(vague).toBe("The sentiment is mixed.")
    expect(precise).toBe("neutral")
  })

  it("simulated provider는 usage를 만들지 않는다", async () => {
    const response = await new DemoProvider({ delayMs: 0 }).run(request(LABELED_FORMATTED, "좋아요"), {
      signal: new AbortController().signal,
    })
    expect(response.usage).toBeUndefined()
  })
})

describe("DemoProvider abort", () => {
  it("지연 중 abort되면 즉시 cancelled ProviderError로 reject", async () => {
    const provider = new DemoProvider({ delayMs: 10_000 })
    const controller = new AbortController()
    const started = Date.now()
    const promise = provider.run(request(LABELED_FORMATTED, "좋아요"), { signal: controller.signal })
    setTimeout(() => controller.abort(), 5)
    await expect(promise).rejects.toMatchObject({ kind: "cancelled" })
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it("이미 abort된 signal이면 바로 reject", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      new DemoProvider({ delayMs: 0 }).run(request(LABELED_FORMATTED, "좋아요"), { signal: controller.signal }),
    ).rejects.toBeInstanceOf(ProviderError)
  })
})
