import { DEMO_MODEL, DEMO_PROVIDER_ID } from "./providers/demo.ts"
import type { Dataset, JsonFieldRule, PromptVariant } from "./types.ts"

// 초기 preset. DemoProvider의 규칙(R0~R5)에 실제로 반응하도록 설계했다.
// 입력은 작은 lexicon / 단순 패턴으로 처리 가능한 문장만 쓴다.

export type Preset = {
  id: string
  title: string
  summary: string
  dataset: Dataset
  variantA: PromptVariant
  variantB: PromptVariant
}

const demoModel = { provider: DEMO_PROVIDER_ID, model: DEMO_MODEL, temperature: 0, seed: 42 }

// ---------------------------------------------------------------------------
// Classification (exact-match)
// ---------------------------------------------------------------------------

function sentimentCase(id: string, name: string, input: string, expected: string, tags: string[]) {
  return { id, name, input, tags, evaluator: { type: "exact-match" as const, expected } }
}

const classificationDataset: Dataset = {
  id: "preset-sentiment",
  name: "리뷰 감정 분류",
  description: "쇼핑몰 리뷰를 positive / negative / neutral로 분류합니다. exact-match (trim, case-sensitive).",
  cases: [
    sentimentCase("sent-01", "빠른 배송 만족", "배송이 빨라서 정말 만족스러워요.", "positive", ["positive"]),
    sentimentCase("sent-02", "최악의 경험", "최악의 경험이었습니다. 다시는 안 삽니다.", "negative", ["negative"]),
    sentimentCase("sent-03", "품질 추천", "품질이 훌륭하고 가격도 좋아요. 추천합니다.", "positive", ["positive"]),
    sentimentCase("sent-04", "배송 지연 실망", "주문한 지 일주일이 지났는데 아직 안 왔어요. 실망입니다.", "negative", ["negative"]),
    sentimentCase("sent-05", "단순 수령 보고", "상품을 오늘 수령했습니다.", "neutral", ["neutral"]),
    sentimentCase("sent-06", "색상 사실 진술", "색상은 사진과 같습니다.", "neutral", ["neutral"]),
    sentimentCase("sent-07", "장단점 혼재", "배송은 빨랐지만 포장이 별로였어요.", "neutral", ["neutral", "mixed"]),
    sentimentCase("sent-08", "부정어 포함", "기대만큼 좋지는 않았어요.", "negative", ["negative", "negation"]),
    sentimentCase("sent-09", "고객센터 불만", "고객센터가 불친절하고 환불도 느렸어요.", "negative", ["negative"]),
    sentimentCase("sent-10", "재입고 문의", "사이즈 문의드립니다. 재입고 예정이 있나요?", "neutral", ["neutral", "question"]),
  ],
}

export const classificationPreset: Preset = {
  id: "classification",
  title: "Classification",
  summary: "category 목록과 출력 형식을 명시한 Prompt B vs 모호한 Prompt A",
  dataset: classificationDataset,
  variantA: {
    id: "variant-a",
    name: "Prompt A",
    promptTemplate: "다음 리뷰의 감정을 한 단어로만 답하세요.\n\n{{input}}",
    modelConfig: { ...demoModel },
  },
  variantB: {
    id: "variant-b",
    name: "Prompt B",
    systemPrompt: "너는 쇼핑몰 리뷰 감정 분류기다.",
    promptTemplate:
      "다음 리뷰를 positive, negative, neutral 중 하나로 분류하세요.\n레이블 하나만 출력하세요.\n\nInput:\n{{input}}",
    modelConfig: { ...demoModel },
  },
}

// ---------------------------------------------------------------------------
// Structured JSON (json-valid + json-fields)
// ---------------------------------------------------------------------------

const required = (path: string, type: JsonFieldRule["type"]): JsonFieldRule => ({ path, type })

const jsonDataset: Dataset = {
  id: "preset-contact-json",
  name: "연락처 JSON 추출",
  description: "자기소개 문장에서 name / email / age / city를 strict JSON으로 추출합니다.",
  cases: [
    {
      id: "json-01",
      name: "기본 연락처 (valid JSON)",
      input: "안녕하세요, 저는 김민수입니다. 이메일은 minsu@example.com 이고 서울에 살아요. 나이는 29세입니다.",
      evaluator: { type: "json-valid" },
      tags: ["json-valid"],
    },
    {
      id: "json-02",
      name: "name / email 필수",
      input: "이름: 박서연, 연락처 seoyeon.park@example.org, 부산 거주, 34살",
      evaluator: { type: "json-fields", rules: [required("name", "string"), required("email", "string")] },
      tags: ["fields"],
    },
    {
      id: "json-03",
      name: "age는 number",
      input: "저는 이도윤이고 41세입니다. 메일 doyoon@example.com, 대구에서 일합니다.",
      evaluator: { type: "json-fields", rules: [required("name", "string"), required("age", "number")] },
      tags: ["fields", "number"],
    },
    {
      id: "json-04",
      name: "city 허용 목록",
      input: "저는 최하린입니다. 인천에 살고 있고 이메일은 harin@example.net 입니다. 27살이에요.",
      evaluator: {
        type: "json-fields",
        rules: [{ path: "city", type: "string", oneOf: ["서울", "부산", "대구", "인천", "광주", "대전"] }],
      },
      tags: ["fields", "oneOf"],
    },
    {
      id: "json-05",
      name: "email 정확히 일치",
      input: "이름은 정우진이고 이메일은 woojin.jung@example.com 입니다. 광주, 38세.",
      evaluator: { type: "json-fields", rules: [{ path: "email", equals: "woojin.jung@example.com" }] },
      tags: ["fields", "equals"],
    },
    {
      id: "json-06",
      name: "4개 field 모두",
      input: "저는 한지우입니다. jiwoo@example.com 으로 연락 주세요. 대전에 사는 22살입니다.",
      evaluator: {
        type: "json-fields",
        rules: [required("name", "string"), required("email", "string"), required("age", "number"), required("city", "string")],
      },
      tags: ["fields"],
    },
    {
      id: "json-07",
      name: "나이를 한글로 표기",
      input: "저는 윤소희입니다. 이메일 sohee@example.com, 서울 거주, 나이는 스물아홉입니다.",
      evaluator: {
        type: "json-fields",
        rules: [required("name", "string"), required("email", "string"), required("age", "number"), required("city", "string")],
      },
      tags: ["fields", "hard"],
    },
    {
      id: "json-08",
      name: "도시 정보 없음 → null",
      input: "저는 강태오입니다. 이메일은 taeo@example.com 이고 45세입니다.",
      evaluator: { type: "json-fields", rules: [{ path: "city", equals: null }, required("age", "number")] },
      tags: ["fields", "null"],
    },
    {
      id: "json-09",
      name: "선택 field(nickname) 없음",
      input: "이름: 오나래, 제주에 사는 31살입니다. 이메일은 없어요.",
      evaluator: {
        type: "json-fields",
        rules: [required("name", "string"), required("age", "number"), { path: "nickname", required: false, type: "string" }],
      },
      tags: ["fields", "optional"],
    },
    {
      id: "json-10",
      name: "울산 거주자 (valid JSON)",
      input: "저는 서지안이고 울산에 삽니다. 연락은 jian.seo@example.com 으로 부탁드려요. 36세.",
      evaluator: { type: "json-valid" },
      tags: ["json-valid"],
    },
  ],
}

export const jsonPreset: Preset = {
  id: "structured-json",
  title: "Structured JSON",
  summary: "\"JSON only + field 명시\" Prompt B vs 형식 지시가 약한 Prompt A (fence / 누락 field)",
  dataset: jsonDataset,
  variantA: {
    id: "variant-a",
    name: "Prompt A",
    promptTemplate: "다음 텍스트에서 연락처 정보를 JSON으로 추출하세요. name과 email을 포함하세요.\n\n{{input}}",
    modelConfig: { ...demoModel },
  },
  variantB: {
    id: "variant-b",
    name: "Prompt B",
    systemPrompt: "너는 정보 추출기다. 다른 텍스트 없이 JSON만 출력한다.",
    promptTemplate:
      "다음 텍스트에서 name, email, age, city 필드를 추출하세요.\n값을 찾을 수 없으면 null을 사용하세요. JSON only.\n\nInput:\n{{input}}",
    modelConfig: { ...demoModel },
  },
}

export const PRESETS: readonly Preset[] = [classificationPreset, jsonPreset]
