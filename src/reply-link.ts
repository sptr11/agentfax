import type { Question } from './fax.js'

export type Answers = Record<string, string>

// Reads `id=value&id=value` from a reply link's fragment.
// Values are percent-decoded only: `+` stays a plus (assistants encode spaces as %20 and plus as %2B).
// Unknown ids and pairs that fail to decode are dropped. A repeated key keeps its last value.
export function parseReplyFragment(fragment: string, questions: Question[]): Answers {
  const ids = new Set(questions.map((q) => q.id))
  const out: Answers = {}
  for (const pair of fragment.replace(/^#/, '').split('&')) {
    const i = pair.indexOf('=')
    if (i < 1) continue
    const id = pair.slice(0, i)
    if (!ids.has(id)) continue
    try {
      out[id] = decodeURIComponent(pair.slice(i + 1))
    } catch {
      continue
    }
  }
  return out
}

export function buildReplyLink(faxUrl: string, questions: Question[], answers: Answers): string {
  const pairs = questions.flatMap((q) => {
    const v = answers[q.id]
    return v === undefined || v === '' ? [] : [`${q.id}=${encode(v)}`]
  })
  return `${faxUrl}#${pairs.join('&')}`
}

// encodeURIComponent leaves ' ( ) ! * alone; assistants in the receiver tests encoded ' as %27.
function encode(value: string): string {
  return encodeURIComponent(value).replace(/['()!*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}
