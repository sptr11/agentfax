// Plain-text version of a sender's page, for the agent section.
// Drops anything a person wouldn't see, so hidden text can't reach the agent.
// Text hidden through CSS classes can't be detected here; neutralization still applies downstream.

const DROP_ELEMENTS = /<(script|style|template|noscript|head|svg)\b[\s\S]*?<\/\1\s*>/gi
const HIDDEN_ATTR = /\s(hidden|aria-hidden\s*=\s*["']?true["']?|style\s*=\s*["'][^"']*(display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'])/i
const BLOCK = /^(p|div|section|article|header|footer|main|aside|nav|h[1-6]|li|ul|ol|tr|table|blockquote|pre|br|hr|dt|dd|figure|figcaption)$/i
const VOID = /^(br|hr|img|input|meta|link|area|base|col|embed|source|track|wbr)$/i

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

export function htmlToText(html: string): string {
  const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(DROP_ELEMENTS, '')
  let out = ''
  let hiddenDepth = 0
  const hiddenStack: string[] = []
  for (const part of src.split(/(<[^>]+>)/)) {
    if (!part.startsWith('<')) {
      // Source newlines are just whitespace in HTML; only block elements break lines.
      if (hiddenDepth === 0) out += part.replace(/\s+/g, ' ')
      continue
    }
    const m = part.match(/^<\s*(\/)?\s*([a-z0-9]+)/i)
    if (!m) continue
    const [, closing, tag] = m as unknown as [string, string | undefined, string]
    if (closing) {
      if (hiddenStack.length && hiddenStack[hiddenStack.length - 1] === tag.toLowerCase()) {
        hiddenStack.pop()
        hiddenDepth--
      }
    } else if (hiddenDepth > 0 && !VOID.test(tag) && !part.endsWith('/>')) {
      if (hiddenStack.length && hiddenStack[hiddenStack.length - 1] === tag.toLowerCase()) {
        hiddenStack.push(tag.toLowerCase())
        hiddenDepth++
      }
    } else if (HIDDEN_ATTR.test(part) && !VOID.test(tag)) {
      hiddenStack.push(tag.toLowerCase())
      hiddenDepth++
    }
    if (hiddenDepth === 0 && BLOCK.test(tag)) out += '\n'
    else if (hiddenDepth === 0 && !closing && /^t[dh]$/i.test(tag)) out += ' | '
  }
  return decode(out)
    .split('\n')
    .map((l) => l.replace(/[ \t\r\f\v ]+/g, ' ').trim().replace(/^\|\s*/, '').replace(/\s*\|$/, ''))
    .filter(Boolean)
    .join('\n')
}
