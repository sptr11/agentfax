import type { Fax, Question } from './fax.js'
import type { ReplyRecord } from './store.js'

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

// System fonts only: the page CSP blocks font CDNs. Themeable through the custom properties on :root.
const STYLE = `
:root{--desk:#e4e7e3;--paper:#fcfcfa;--ink:#1d2126;--muted:#5e666e;--rule:#d5d9d4;--accent:#27467a;--accent-ink:#fff;--accent-soft:#e6ecf5;--ok:#1f6b45;--ok-soft:#e3f1e8;--warn:#8a5300;--warn-soft:#fbf0dc;--frame:#fff;--shadow:0 1px 2px rgba(20,24,28,.06),0 8px 28px rgba(20,24,28,.08);--font-sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,Roboto,"Helvetica Neue",Arial,sans-serif;--font-mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--desk:#101215;--paper:#1a1d21;--ink:#e5e8eb;--muted:#9aa3ab;--rule:#2c3137;--accent:#8fb0e6;--accent-ink:#0d1a2e;--accent-soft:#1d2a3d;--ok:#74cf9c;--ok-soft:#14291e;--warn:#e8b665;--warn-soft:#2e2412;--frame:#22262b;--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 28px rgba(0,0,0,.35);color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--desk);color:var(--ink);font:16px/1.55 var(--font-sans);padding:24px max(16px,env(safe-area-inset-right)) 64px max(16px,env(safe-area-inset-left))}
[hidden]{display:none!important}
.sheet{max-width:760px;margin:0 auto;background:var(--paper);box-shadow:var(--shadow);border-radius:3px;overflow:hidden}
.tx{font:11.5px/1.4 var(--font-mono);letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:10px 28px;border-bottom:1px dashed var(--rule);display:flex;flex-wrap:wrap;gap:4px 22px}
.tx b{color:var(--ink);font-weight:600}
.body{padding:28px 28px 8px;display:flex;flex-direction:column;gap:18px}
h1{margin:0;font-size:clamp(26px,5vw,34px);line-height:1.12;letter-spacing:-.015em;text-wrap:balance;overflow-wrap:anywhere}
.note{margin:0;font-size:17px;max-width:60ch;overflow-wrap:anywhere}
.from{font-size:14px;color:var(--muted);display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center}
.from strong{color:var(--ink);font-weight:600}
.origin{font-family:var(--font-mono);font-size:12.5px;padding:2px 7px;border-radius:4px;background:var(--accent-soft);color:var(--accent);overflow-wrap:anywhere}
.frame{border:1px solid var(--rule);border-radius:6px;background:var(--frame);overflow:hidden}
.frame-tag{font:10.5px var(--font-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:6px 12px;border-bottom:1px solid var(--rule);display:flex;gap:8px}
.frame-tag span:first-child{margin-right:auto}
.frame iframe{display:block;width:100%;min-height:420px;border:0;background:#fff}
.frame pre{margin:0;padding:16px 18px;font:15px/1.6 var(--font-sans);white-space:pre-wrap;overflow-wrap:anywhere}
.cut{display:flex;align-items:center;gap:12px;font:11px var(--font-mono);letter-spacing:.12em;color:var(--muted);padding:6px 28px 0}
.cut::before,.cut::after{content:"";flex:1;border-top:1px dashed var(--rule)}
.reply{padding:18px 28px 28px;display:flex;flex-direction:column;gap:20px}
.banner{background:var(--accent-soft);border-radius:8px;padding:12px 14px;font-size:14.5px}
.banner b{color:var(--accent)}
.q{display:flex;flex-direction:column;gap:8px;border:0;padding:0;margin:0;min-width:0}
.q>.label,.q>legend{font-weight:600;font-size:15.5px;padding:0}
.req,.filled{font:11px var(--font-mono);letter-spacing:.04em;text-transform:uppercase;font-weight:400;margin-left:6px;color:var(--muted)}
.filled{color:var(--accent);font-weight:500}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{position:relative}
.chip input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.chip span{display:inline-block;padding:8px 14px;border:1px solid var(--rule);border-radius:999px;font-size:15px;background:var(--paper)}
.chip input:checked+span{border-color:var(--accent);background:var(--accent-soft);color:var(--accent);font-weight:600}
.chip input:focus-visible+span,textarea:focus-visible,input:focus-visible,.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
textarea,input[type=text],input[type=number]{font:15.5px/1.5 var(--font-sans);color:var(--ink);background:var(--paper);border:1px solid var(--rule);border-radius:8px;padding:10px 12px;width:100%}
textarea{min-height:96px;resize:vertical}
.hint{font-size:14px;color:var(--muted);margin:0}
.cover{font-size:14px;color:var(--muted);margin:0;padding-left:18px}
.actions{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}
.btn{font:600 15.5px var(--font-sans);padding:11px 22px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-ink);cursor:pointer}
.btn.ghost{background:transparent;color:var(--accent)}
.small{font-size:13.5px;color:var(--muted);margin:0}
.report{margin:0;font:12.5px/1.7 var(--font-mono);background:var(--ok-soft);color:var(--ok);border-radius:8px;padding:14px 16px}
.answers{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 16px;font-size:15px;margin:0}
.answers dt{color:var(--muted)}
.answers dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
.own{border-top:1px dashed var(--rule);padding-top:14px;font-size:14.5px;color:var(--muted);margin:0}
.own a,.back{color:var(--accent);font-weight:600;text-decoration:none}
.gone{background:var(--warn-soft);color:var(--warn);border-radius:8px;padding:14px 16px;font-size:15px;margin:0}
.agent{max-width:760px;margin:28px auto 0;color:var(--muted)}
.agent h2{font:600 11px var(--font-mono);letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px}
.agent pre{margin:0;font:12px/1.6 var(--font-mono);white-space:pre-wrap;overflow-wrap:anywhere;border-left:2px solid var(--rule);padding:4px 0 4px 14px}
.foot{max-width:760px;margin:18px auto 0;font:11.5px var(--font-mono);color:var(--muted);text-align:center}
.foot a{color:inherit}
.replies{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
.replies li{border-top:1px dashed var(--rule);padding-top:12px}
.ai-help{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center}
.pair{display:flex;gap:10px;flex-wrap:wrap}
@media (max-width:560px){.actions>.btn[type=submit]{width:100%}.ai-help{width:100%}.pair{display:grid;grid-template-columns:1fr 1fr;width:100%}.pair .btn{padding-left:8px;padding-right:8px}.tx,.body,.reply,.cut{padding-left:18px;padding-right:18px}.answers{grid-template-columns:minmax(0,1fr);gap:2px}.answers dd{margin-bottom:10px}.frame-tag .long{display:none}}
@media (min-width:561px){.frame-tag .long+span{display:none}}
`

const FOOT = '<p class="foot">Sent with <a href="https://github.com/sptr11/agentfax">AgentFax</a>. Your AI can read this page too.</p>'
const OWN = '<p class="own">Want your own AI to send pages like this? <a href="https://github.com/sptr11/agentfax">Set up AgentFax →</a></p>'

function shell(title: string, body: string, script = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)}</title><style>${STYLE}</style>${script ? '<script src="/assets/fax.js" defer></script>' : ''}</head><body>${body}</body></html>`
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
export function stamp(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`
}

const day = (iso: string) => stamp(iso).split(' ').slice(0, 3).join(' ')

function header(fax: Fax, sentAt: string): string {
  return `<div class="tx"><span>From <b>${esc(fax.from.name)}</b></span>${fax.to ? `<span>To <b>${esc(fax.to)}</b></span>` : ''}<span>${stamp(sentAt)}</span><span>Page 1/1</span></div>`
}

function intro(fax: Fax): string {
  const host = new URL(fax.from.origin).host
  return `<div class="from"><strong>${esc(fax.from.name)}</strong><span>sent from</span><span class="origin">${esc(host)}</span></div><h1>${esc(fax.title)}</h1>${fax.note ? `<p class="note">${esc(fax.note)}</p>` : ''}`
}

function field(q: Question): string {
  const id = `q-${q.id}`
  const tags = `${q.required ? '<span class="req">required</span>' : ''}<span class="filled" data-filled-for="${q.id}" hidden>from your AI</span>${q.type === 'choice' ? `<span class="filled" data-picked-for="${q.id}" hidden>picked from your reply</span>` : ''}`
  const help = `${q.hint ? `<p class="hint">${esc(q.hint)}</p>` : ''}${q.probes ? `<ul class="cover">${q.probes.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}`
  if (q.type === 'choice') {
    const chips = q.options.map((o, i) => `<label class="chip"><input type="radio" name="${q.id}" id="${id}-${i}" value="${esc(o)}"><span>${esc(o)}</span></label>`).join('')
    return `<fieldset class="q"><legend>${esc(q.label)}${tags}</legend>${help}<div class="chips">${chips}</div></fieldset>`
  }
  const input = q.type === 'longtext'
    ? `<textarea id="${id}" name="${q.id}"></textarea>`
    : `<input id="${id}" name="${q.id}" type="${q.type === 'number' ? 'number' : 'text'}"${q.type === 'number' ? ' step="any" inputmode="decimal"' : ''}>`
  return `<div class="q"><label class="label" for="${id}">${esc(q.label)}${tags}</label>${help}${input}</div>`
}

export function faxPage(fax: Fax, faxPath: string, faxUrl: string, agentSection: string, hasHtml: boolean, sentAt: string): string {
  const content = hasHtml
    ? `<div class="frame"><div class="frame-tag"><span>From the sender</span><span class="long">can show anything, can’t send anything</span><span>sandboxed</span></div><iframe src="${faxPath}/view" sandbox="allow-scripts" title="${esc(fax.title)}" loading="lazy"></iframe></div>`
    : `<div class="frame"><pre>${esc(fax.content.text)}</pre></div>`
  const sender = esc(fax.from.name)
  const prompt = fax.questions.length
    ? `Read ${faxUrl} and help me reply. Draft the answers, show me, then give me the reply link.`
    : `Read ${faxUrl} and summarize it for me.`
  const askRow = `<span id="ask-row" class="ai-help"><span class="pair"><button class="btn ghost" type="button" id="ask-ai" data-prompt="${esc(prompt)}" hidden>Ask your AI</button></span><span class="small" id="ask-note">${fax.questions.length ? 'Your AI can read this page and draft your answers.' : 'Your AI can read and summarize this page.'}</span></span>`

  // Every fax has a reply box: the fallback when an AI's reply link won't open, and a way to ask the sender something.
  const messageBox = `<div class="q"><label class="label" for="q-message">Or type or paste your reply here</label><textarea id="q-message" name="message" rows="3" placeholder="Anything for ${sender}. Your AI’s draft works too."></textarea></div>`
  const required = JSON.stringify(fax.questions.filter((q) => q.required).map((q) => ({ id: q.id, label: q.label })))
  const formNote = '<p class="small" id="form-note" aria-live="polite"></p>'

  let reply = ''
  if (fax.questions.length) {
    reply = `<div class="cut">REPLY</div><form class="reply" id="reply-form" method="post" action="${faxPath}/reply" data-required="${esc(required)}">` +
      `<div class="banner" id="prefill-banner" hidden><b>Your AI filled this in.</b> Check the answers, change anything, then send. Nothing has been sent yet.</div>` +
      fax.questions.map(field).join('') + messageBox +
      `<div class="actions"><button class="btn" type="submit">Send to ${sender}</button>${askRow}</div>${formNote}</form>`
  } else {
    const gotIt = fax.ack ? `<button class="btn" type="submit" name="ack" value="1" formnovalidate>Got it</button>` : ''
    reply = `<div class="cut">${fax.ack ? 'NO REPLY NEEDED' : 'REPLY IF YOU LIKE'}</div><form class="reply" id="reply-form" method="post" action="${faxPath}/reply">` +
      (fax.ack ? `<p class="small">Click Got it to let ${sender} know you read it.</p>` : '') +
      `${messageBox}<div class="actions">${gotIt}<button class="btn${fax.ack ? ' ghost' : ''}" type="submit">Send to ${sender}</button></div>${formNote}<div class="actions">${askRow}</div></form>`
  }

  return shell(
    fax.title,
    `<article class="sheet">${header(fax, sentAt)}<div class="body">${intro(fax)}${content}</div>${reply}</article>` +
      `<section class="agent"><h2>For AI assistants</h2><pre>${esc(agentSection)}</pre></section>${FOOT}`,
    true,
  )
}

export function receiptPage(fax: Fax, sentAt: string, answers: Record<string, string>, message: string, ack: boolean, repliedAt: string): string {
  const sender = fax.from.name.toUpperCase()
  const pairs = fax.questions.filter((q) => answers[q.id]).map((q) => `<dt>${esc(q.label)}</dt><dd>${esc(answers[q.id]!)}</dd>`).join('') +
    (message ? `<dt>Message</dt><dd>${esc(message)}</dd>` : '')
  const n = Object.keys(answers).length
  const what = [n ? `${n} ANSWER${n === 1 ? '' : 'S'}` : '', message ? 'A MESSAGE' : ''].filter(Boolean).join(' AND ')
  const report = ack && !n && !message
    ? `<p class="report"><b>OK</b> · ${esc(sender)} KNOWS YOU READ IT · ${stamp(repliedAt)}</p>`
    : `<p class="report"><b>OK</b> · SENT TO ${esc(sender)} · ${stamp(repliedAt)}${what ? ` · ${what}` : ''}</p>`
  const again = fax.questions.length && fax.to && fax.expires
    ? `<p class="small">You can change your answers until the fax expires on ${day(fax.expires)}. Sending again replaces them.</p>`
    : ''
  return shell(
    `Sent: ${fax.title}`,
    `<article class="sheet">${header(fax, sentAt)}<div class="body">${intro(fax)}</div><div class="cut">TRANSMISSION REPORT</div><div class="reply">${report}${pairs ? `<dl class="answers">${pairs}</dl>` : ''}${again}${OWN}</div></article>${FOOT}`,
  )
}

export function problemPage(title: string, message: string, back?: { href: string; label: string }, issues?: string[]): string {
  const list = issues?.length ? `<ul class="cover">${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''
  return shell(title, `<article class="sheet"><div class="body"><h1>${esc(title)}</h1><p class="gone">${esc(message)}</p>${list}${back ? `<p><a class="back" href="${esc(back.href)}">${esc(back.label)}</a></p>` : ''}</div></article>${FOOT}`)
}

export function inboxPage(title: string, replies: ReplyRecord[]): string {
  const rows = replies.length
    ? replies.map((r) => {
        const pairs = Object.entries(r.answers).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + (r.message ? `<dt>message</dt><dd>${esc(r.message)}</dd>` : '')
        return `<li><p class="small"><b>${esc(r.recipient ?? 'Someone')}</b> · ${stamp(r.createdAt)}${r.ack ? ' · Got it' : ''}</p>${pairs ? `<dl class="answers">${pairs}</dl>` : ''}</li>`
      }).join('')
    : '<li><p class="small">No replies yet.</p></li>'
  return shell(`Replies: ${title}`, `<article class="sheet"><div class="tx"><span>Inbox</span><span>${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}</span></div><div class="body"><h1>${esc(title)}</h1><ul class="replies">${rows}</ul></div></article>${FOOT}`)
}
