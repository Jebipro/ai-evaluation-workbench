// Prompt template validation / rendering.
// 지원 placeholder는 {{input}} 하나뿐이다. 공백이 들어간 {{ input }}도 지원하지 않는 형태로 취급한다.

export const INPUT_PLACEHOLDER = "{{input}}"

const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g

export type TemplateIssue = { message: string }

export function findPlaceholders(template: string): string[] {
  return Array.from(template.matchAll(PLACEHOLDER_PATTERN), (match) => match[0])
}

export function validateTemplate(template: string): TemplateIssue[] {
  if (template.trim() === "") return [{ message: "template이 비어 있습니다." }]
  const issues: TemplateIssue[] = []
  const unsupported = [...new Set(findPlaceholders(template).filter((p) => p !== INPUT_PLACEHOLDER))]
  for (const placeholder of unsupported) {
    issues.push({ message: `지원하지 않는 placeholder ${placeholder} (지원: ${INPUT_PLACEHOLDER})` })
  }
  if (!template.includes(INPUT_PLACEHOLDER)) {
    issues.push({ message: `${INPUT_PLACEHOLDER} placeholder가 없습니다.` })
  }
  return issues
}

/**
 * 모든 {{input}} occurrence를 치환한다.
 * String.replace의 "$&" 같은 특수 치환 패턴이 해석되지 않도록 split/join을 쓴다.
 */
export function renderTemplate(template: string, input: string): string {
  return template.split(INPUT_PLACEHOLDER).join(input)
}
