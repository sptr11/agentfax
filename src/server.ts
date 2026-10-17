import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { renderAgentSection } from './agent-section.js'
import { QuestionSchema, type Fax } from './fax.js'
import { htmlToText } from './html-to-text.js'
import { faxPage, inboxPage, messagePage } from './page.js'
import type { FaxRecord, Store } from './store.js'
import { hashToken, newToken } from './token.js'

export type AgentfaxOptions = {
  store: Store
  // Public address of this server, e.g. https://fax.example.com. Links and the reply Origin check use it.
  // Falls back to the request origin, which is wrong behind proxies and tunnels.
  publicUrl?: string
  // Default sender auth: `Authorization: Bearer <senderKey>`.
  senderKey?: string
  // Custom sender auth for apps that embed AgentFax. Return a sender id, or null to reject.
  authorize?: (req: Request) => Promise<string | null>
  now?: () => Date
  about?: string
  // Replies per link per minute. Shared links serve many people, so they get more.
  repliesPerMinute?: { personal?: number; shared?: number }
}

const SPEC_URL = 'https://github.com/sptr11/agentfax/blob/main/SPEC.md'
const TOKEN = /^[A-Za-z0-9]{22}$/
const MAX_ANSWER = 5000
const MAX_REPLY_BODY = 64 * 1024

const CreateFax = z
  .object({
    from: z.string().min(1).max(100),
    title: z.string().min(1).max(200),
    note: z.string().max(2000).optional(),
    html: z.string().min(1).max(2_000_000).optional(),
    text: z.string().min(1).max(100_000).optional(),
    questions: z.array(QuestionSchema).max(20).default([]),
    ack: z.boolean().optional(),
    to: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
    expiresInDays: z.number().int().min(1).max(365).default(30),
  })
  .superRefine((f, ctx) => {
    if (!f.html && !f.text) ctx.addIssue({ code: 'custom', path: ['html'], message: 'send html or text' })
    const ids = f.questions.map((q) => q.id)
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['questions'], message: 'question ids must be unique' })
  })

const ReplyBody = z.object({ answers: z.record(z.string(), z.unknown()).default({}), ack: z.boolean().optional() })

// Sender content runs here. Opaque origin even when opened directly, no network, no forms, only framed by us.
const VIEW_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'"
const PAGE_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
const PRIVATE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }
// The fax page can't use no-referrer: a plain form POST would then carry Origin: null, which the reply route rejects.
// same-origin still never sends the link to other sites.
const PAGE_HEADERS = { ...PRIVATE, 'referrer-policy': 'same-origin', 'content-security-policy': PAGE_CSP }

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function splitJson(raw: string): { token: string; json: boolean } {
  return raw.endsWith('.json') ? { token: raw.slice(0, -5), json: true } : { token: raw, json: false }
}

export function agentfax(opts: AgentfaxOptions) {
  const { store } = opts
  const now = opts.now ?? (() => new Date())
  const about = opts.about ?? SPEC_URL
  const authorize =
    opts.authorize ??
    (async (req: Request) => {
      const auth = req.headers.get('authorization') ?? ''
      return opts.senderKey && safeEqual(auth, `Bearer ${opts.senderKey}`) ? 'default' : null
    })
  const recent = new Map<string, number[]>()
  const limits = { personal: opts.repliesPerMinute?.personal ?? 10, shared: opts.repliesPerMinute?.shared ?? 60 }

  const base = (c: Context) => (opts.publicUrl ?? new URL(c.req.url).origin).replace(/\/+$/, '')
  const wantsJson = (c: Context, suffix: boolean) => suffix || (c.req.header('accept') ?? '').includes('application/json')
  const fail = (c: Context, json: boolean, status: 401 | 403 | 404 | 409 | 410 | 422 | 429, error: string, message: string, issues?: unknown) =>
    json ? c.json({ error, message, ...(issues ? { issues } : {}) }, status) : c.html(messagePage(message, message), status)

  const isLive = (fax: FaxRecord) => !fax.revokedAt && new Date(fax.expiresAt) > now()

  function toFax(record: FaxRecord, url: string, origin: string, recipient: string | null): Fax {
    const d = record.data
    const expectsReply = d.questions.length > 0 || d.ack
    return {
      agentfax: '0.1',
      title: d.title,
      from: { name: d.from, origin },
      ...(recipient ? { to: recipient } : {}),
      ...(d.note ? { note: d.note } : {}),
      content: { text: d.text, ...(d.html ? { view: `${url}/view` } : {}) },
      questions: d.questions,
      ...(d.ack ? { ack: true } : {}),
      ...(expectsReply ? { reply: { link: `${url}#`, format: 'id=value pairs, URL-encoded, joined with &' } } : {}),
      expires: record.expiresAt,
      about,
    }
  }

  async function resolve(token: string) {
    return TOKEN.test(token) ? store.findLink(await hashToken(token)) : null
  }

  const app = new Hono()

  app.get('/robots.txt', (c) => c.text('User-agent: *\nAllow: /\n'))

  app.post('/api/faxes', async (c) => {
    const senderId = await authorize(c.req.raw)
    if (!senderId) return fail(c, true, 401, 'unauthorized', 'Send your sender key as a Bearer token.')
    const parsed = CreateFax.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, true, 422, 'invalid_fax', "The fax didn't validate.", parsed.error.issues)
    const f = parsed.data
    const created = now()
    const id = `fx_${newToken(16)}`
    const recipients = f.to ?? [null]
    const tokens = recipients.map(() => newToken())
    const inbox = newToken()
    const record: FaxRecord = {
      id,
      senderId,
      data: { from: f.from, title: f.title, ...(f.note ? { note: f.note } : {}), ...(f.html ? { html: f.html } : {}), text: f.text ?? htmlToText(f.html!), questions: f.questions, ack: f.ack ?? false },
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + f.expiresInDays * 86_400_000).toISOString(),
      revokedAt: null,
    }
    const links = await Promise.all(tokens.map(async (t, i) => ({ tokenHash: await hashToken(t), faxId: id, recipient: recipients[i] ?? null })))
    await store.createFax(record, links, await hashToken(inbox))
    const b = base(c)
    return c.json({ id, links: tokens.map((t, i) => ({ to: recipients[i] ?? null, url: `${b}/f/${t}` })), inbox: `${b}/i/${inbox}`, expires: record.expiresAt }, 201)
  })

  app.delete('/api/faxes/:id', async (c) => {
    const senderId = await authorize(c.req.raw)
    if (!senderId) return fail(c, true, 401, 'unauthorized', 'Send your sender key as a Bearer token.')
    const ok = await store.revoke(c.req.param('id'), senderId, now().toISOString())
    return ok ? c.body(null, 204) : fail(c, true, 404, 'not_found', 'No fax with that id.')
  })

  app.get('/f/:token/view', async (c) => {
    const found = await resolve(c.req.param('token'))
    if (!found || !isLive(found.fax) || !found.fax.data.html) return c.text('Not found', 404)
    return c.body(found.fax.data.html, 200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': VIEW_CSP, ...PRIVATE })
  })

  app.get('/f/:token', async (c) => {
    const { token, json: suffix } = splitJson(c.req.param('token'))
    const json = wantsJson(c, suffix)
    const found = await resolve(token)
    if (!found) return fail(c, json, 404, 'not_found', 'No fax here. Check the link.')
    if (!isLive(found.fax)) return fail(c, json, 410, 'gone', found.fax.revokedAt ? 'The sender withdrew this fax.' : 'This fax has expired.')
    const b = base(c)
    const url = `${b}/f/${token}`
    const fax = toFax(found.fax, url, b, found.link.recipient)
    if (json) return c.json(fax, 200, { ...PRIVATE, 'access-control-allow-origin': '*' })
    return c.html(faxPage(fax, `/f/${token}`, renderAgentSection(fax, url), Boolean(found.fax.data.html)), 200, PAGE_HEADERS)
  })

  app.post(
    '/f/:token/reply',
    bodyLimit({ maxSize: MAX_REPLY_BODY, onError: (c) => c.json({ error: 'too_large', message: 'Replies are limited to 64 KB.' }, 413) }),
    async (c) => {
    const token = c.req.param('token')
    const json = !(c.req.header('accept') ?? '').includes('text/html')
    const found = await resolve(token)
    if (!found) return fail(c, json, 404, 'not_found', 'No fax here. Check the link.')
    if (c.req.header('origin') !== new URL(base(c)).origin) return fail(c, json, 403, 'wrong_origin', 'Replies are sent from the fax page.')
    const { fax, link } = found
    if (!isLive(fax)) return fail(c, json, 410, 'gone', fax.revokedAt ? 'The sender withdrew this fax.' : 'This fax has expired.')
    const { questions, ack: takesAck } = fax.data
    if (!questions.length && !takesAck) return fail(c, json, 409, 'no_replies', "This fax doesn't take replies.")

    // Every attempt counts, valid or not, so invalid spam isn't free.
    const t = now().getTime()
    const times = (recent.get(link.tokenHash) ?? []).filter((x) => t - x < 60_000)
    if (times.length >= (link.recipient ? limits.personal : limits.shared)) return fail(c, json, 429, 'too_many_replies', 'Too many replies from this link. Try again in a minute.')
    times.push(t)
    recent.set(link.tokenHash, times)

    let body: z.infer<typeof ReplyBody>
    if ((c.req.header('content-type') ?? '').includes('application/json')) {
      const parsed = ReplyBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return fail(c, json, 422, 'invalid_reply', 'Send { answers, ack }.')
      body = parsed.data
    } else {
      const form = await c.req.parseBody()
      const { ack, ...answers } = form
      body = { answers, ack: ack !== undefined }
    }

    const issues: string[] = []
    const answers: Record<string, string> = {}
    const byId = new Map(questions.map((q) => [q.id, q]))
    for (const [id, raw] of Object.entries(body.answers)) {
      const q = byId.get(id)
      if (!q) { issues.push(`${id}: not a question on this fax`); continue }
      if (typeof raw !== 'string') { issues.push(`${id}: must be text`); continue }
      const v = raw.trim()
      if (!v) continue
      if (v.length > MAX_ANSWER) issues.push(`${id}: over ${MAX_ANSWER} characters`)
      else if (q.type === 'choice' && !q.options.includes(v)) issues.push(`${id}: must be one of ${q.options.join(', ')}`)
      else if (q.type === 'number' && !Number.isFinite(Number(v))) issues.push(`${id}: must be a number`)
      else answers[id] = v
    }
    for (const q of questions) if (q.required && !answers[q.id] && !issues.some((i) => i.startsWith(`${q.id}:`))) issues.push(`${q.id}: required`)
    if (!questions.length && !body.ack) issues.push('ack: required')
    if (issues.length) return fail(c, json, 422, 'invalid_reply', 'Some answers need fixing.', issues)

    await store.saveReply(
      { id: `rp_${newToken(16)}`, faxId: fax.id, linkHash: link.tokenHash, recipient: link.recipient, answers, ack: Boolean(body.ack && takesAck), createdAt: now().toISOString() },
      link.recipient ? 'replace' : 'append',
    )
    return json ? c.json({ ok: true }, 201) : c.html(messagePage('Sent', `Sent to ${fax.data.from}.`), 201)
    },
  )

  app.get('/i/:token', async (c) => {
    const { token, json: suffix } = splitJson(c.req.param('token'))
    const json = wantsJson(c, suffix)
    const found = TOKEN.test(token) ? await store.findInbox(await hashToken(token)) : null
    if (!found) return fail(c, json, 404, 'not_found', 'No inbox here. Check the link.')
    if (json) {
      const replies = found.replies.map((r) => ({ to: r.recipient, answers: r.answers, ack: r.ack, at: r.createdAt }))
      return c.json({ title: found.fax.data.title, replies }, 200, PRIVATE)
    }
    return c.html(inboxPage(found.fax.data.title, found.replies), 200, PRIVATE)
  })

  return app
}
