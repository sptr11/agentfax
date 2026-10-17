import type { Fax } from './fax.js'
import type { ReplyRecord } from './store.js'

// Phase 2 page: plain server-rendered HTML. Styling and reply-link prefill come later.

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const shell = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body>${body}</body></html>`

function field(q: Fax['questions'][number]): string {
  const id = `q-${q.id}`
  const req = q.required ? ' required' : ''
  const extra = [q.hint && `<small style="display:block">${esc(q.hint)}</small>`, q.probes && `<small style="display:block">Also cover: ${esc(q.probes.join('; '))}</small>`].filter(Boolean).join('')
  if (q.type === 'choice') {
    const opts = q.options.map((o, i) => `<label><input type="radio" name="${q.id}" id="${id}-${i}" value="${esc(o)}"${req}> ${esc(o)}</label>`).join(' ')
    return `<fieldset><legend>${esc(q.label)}</legend>${opts}${extra}</fieldset>`
  }
  const input = q.type === 'longtext'
    ? `<textarea id="${id}" name="${q.id}" rows="4"${req}></textarea>`
    : `<input id="${id}" name="${q.id}" type="${q.type === 'number' ? 'number' : 'text'}"${req}>`
  return `<p><label for="${id}">${esc(q.label)}</label><br>${input}${extra}</p>`
}

export function faxPage(fax: Fax, faxPath: string, agentSection: string, hasHtml: boolean): string {
  const host = new URL(fax.from.origin).host
  const content = hasHtml
    ? `<iframe src="${faxPath}/view" sandbox="allow-scripts" title="${esc(fax.title)}" style="width:100%;min-height:360px;border:1px solid #ccc"></iframe>`
    : `<pre>${esc(fax.content.text)}</pre>`
  const action = fax.questions.length
    ? `<form method="post" action="${faxPath}/reply">${fax.questions.map(field).join('')}<button type="submit">Send</button></form>`
    : fax.ack
      ? `<form method="post" action="${faxPath}/reply"><input type="hidden" name="ack" value="1"><button type="submit">Got it</button></form>`
      : ''
  return shell(
    fax.title,
    `<p><strong>${esc(fax.from.name)}</strong> · sent from ${esc(host)}${fax.to ? ` · to ${esc(fax.to)}` : ''}</p>` +
      `<h1>${esc(fax.title)}</h1>${fax.note ? `<p>${esc(fax.note)}</p>` : ''}${content}${action}` +
      `<section><h2>For AI assistants</h2><pre>${esc(agentSection)}</pre></section>`,
  )
}

export function inboxPage(title: string, replies: ReplyRecord[]): string {
  const rows = replies.length
    ? replies.map((r) => `<li><strong>${esc(r.recipient ?? 'Someone')}</strong> · ${esc(r.createdAt)}${r.ack ? ' · Got it' : ''}<pre>${esc(Object.entries(r.answers).map(([k, v]) => `${k}: ${v}`).join('\n'))}</pre></li>`).join('')
    : '<li>No replies yet.</li>'
  return shell(`Replies: ${title}`, `<h1>${esc(title)}</h1><ul>${rows}</ul>`)
}

export const messagePage = (title: string, message: string) => shell(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p>`)
