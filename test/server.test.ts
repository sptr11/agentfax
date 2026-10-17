import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FaxSchema } from '../src/fax.js'
import { agentfax } from '../src/server.js'
import { memoryStore, type Store } from '../src/store.js'
import { sqliteStore } from '../src/sqlite.js'

const PUBLIC = 'https://fax.example.com'
const KEY = 'sk_test'

const lunch = {
  from: 'Ops team',
  title: 'Team lunch on Friday',
  note: 'Pick a spot.',
  html: '<h1>Friday lunch</h1><p>12:30. Tacos, ramen or salad.</p>',
  questions: [
    { id: 'spot', label: 'Where should we go?', type: 'choice', options: ['Tacos', 'Ramen', 'Salad bar'], required: true },
    { id: 'guests', label: 'How many guests?', type: 'number' },
    { id: 'note', label: 'Anything we should know?', type: 'longtext' },
  ],
}

function setup(opts: { store?: Store; publicUrl?: string | null; authorize?: (req: Request) => Promise<string | null> } = {}) {
  let now = new Date('2026-10-17T12:00:00Z')
  const app = agentfax({
    store: opts.store ?? memoryStore(),
    publicUrl: opts.publicUrl === null ? undefined : (opts.publicUrl ?? PUBLIC),
    senderKey: KEY,
    authorize: opts.authorize,
    now: () => now,
  })
  const req = (path: string, init: RequestInit = {}) => app.request(`http://internal:8787${path}`, init)
  const create = async (body: object, key = KEY) =>
    req('/api/faxes', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const send = async (body: object = lunch) => (await create(body)).json() as Promise<{ id: string; links: { to: string | null; url: string }[]; inbox: string }>
  const path = (url: string) => new URL(url).pathname
  const reply = (url: string, body: object, origin: string | null = PUBLIC) =>
    req(`${path(url)}/reply`, { method: 'POST', headers: { 'content-type': 'application/json', ...(origin === null ? {} : { origin }) }, body: JSON.stringify(body) })
  const advance = (days: number) => { now = new Date(now.getTime() + days * 86_400_000) }
  return { app, req, create, send, path, reply, advance }
}

describe('POST /api/faxes', () => {
  it('creates one link per recipient and a private inbox, on the public URL', async () => {
    const { create } = setup()
    const res = await create({ ...lunch, to: ['Priya', 'Sam'] })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.links.map((l: { to: string }) => l.to)).toEqual(['Priya', 'Sam'])
    for (const l of body.links) expect(l.url).toMatch(/^https:\/\/fax\.example\.com\/f\/[A-Za-z0-9]{22}$/)
    expect(body.inbox).toMatch(/^https:\/\/fax\.example\.com\/i\/[A-Za-z0-9]{22}$/)
  })

  it('creates a single shared link when there are no recipients', async () => {
    const { send } = setup()
    expect((await send()).links).toEqual([{ to: null, url: expect.stringMatching(/\/f\//) }])
  })

  it('reads the public URL fresh on each request when it is a function, for tunnels that move', async () => {
    let current = 'https://one.example'
    const app = agentfax({ store: memoryStore(), publicUrl: () => current, senderKey: KEY })
    const make = async () => (await (await app.request('http://internal/api/faxes', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(lunch) })).json()).links[0].url
    expect(await make()).toMatch(/^https:\/\/one\.example\/f\//)
    current = 'https://two.example'
    expect(await make()).toMatch(/^https:\/\/two\.example\/f\//)
  })

  it('uses the request origin when no public URL is configured', async () => {
    const { send } = setup({ publicUrl: null })
    expect((await send()).links[0]!.url.startsWith('http://internal:8787/f/')).toBe(true)
  })

  it.each([
    ['no title', { ...lunch, title: undefined }],
    ['no content', { ...lunch, html: undefined }],
    ['a bad question id', { ...lunch, questions: [{ id: 'Bad Id', label: 'Q', type: 'text' }] }],
    ['duplicate question ids', { ...lunch, questions: [lunch.questions[1], lunch.questions[1]] }],
  ])('rejects a fax with %s', async (_, body) => {
    expect((await setup().create(body)).status).toBe(422)
  })

  it('rejects a missing or wrong sender key', async () => {
    const { req, create } = setup()
    expect((await req('/api/faxes', { method: 'POST', body: JSON.stringify(lunch) })).status).toBe(401)
    expect((await create(lunch, 'wrong')).status).toBe(401)
  })
})

describe('GET /f/:token', () => {
  it('serves the page with the agent section, built on the public URL', async () => {
    const { req, send, path } = setup()
    const { links } = await send()
    const res = await req(path(links[0]!.url))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Team lunch on Friday')
    expect(html).toContain('For AI assistants')
    expect(html).toContain(`${links[0]!.url}#spot=&lt;answer&gt;&amp;guests=&lt;answer&gt;&amp;note=&lt;answer&gt;`)
    expect(html).toContain('This is an AgentFax from Ops team (fax.example.com).')
  })

  it('sends privacy and framing headers', async () => {
    const { req, send, path } = setup()
    const res = await req(path((await send()).links[0]!.url))
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    // Not no-referrer: under no-referrer a plain form POST carries Origin: null, which the reply route rejects.
    // same-origin still never sends the link to other sites.
    expect(res.headers.get('referrer-policy')).toBe('same-origin')
    expect(res.headers.get('content-security-policy')).toContain("frame-src 'self'")
  })

  it('keeps no-referrer on the view, the JSON view and the inbox', async () => {
    const { req, send, path } = setup()
    const { links, inbox } = await send()
    for (const p of [`${path(links[0]!.url)}/view`, `${path(links[0]!.url)}.json`, path(inbox)]) {
      expect((await req(p)).headers.get('referrer-policy')).toBe('no-referrer')
    }
  })

  it('frames the sender content sandboxed, without allow-same-origin', async () => {
    const { req, send, path } = setup()
    const { links } = await send()
    const html = await (await req(path(links[0]!.url))).text()
    expect(html).toContain(`<iframe src="${path(links[0]!.url)}/view" sandbox="allow-scripts"`)
    expect(html).not.toContain('allow-same-origin')
  })

  it('serves a schema-valid JSON view with .json and with Accept', async () => {
    const { req, send, path } = setup()
    const { links } = await send()
    const url = links[0]!.url
    for (const res of [await req(`${path(url)}.json`), await req(path(url), { headers: { accept: 'application/json' } })]) {
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      const fax = await res.json()
      expect(FaxSchema.safeParse(fax).success).toBe(true)
      expect(fax.reply.link).toBe(`${url}#`)
      expect(fax.content.view).toBe(`${url}/view`)
      expect(fax.content.text).toBe('Friday lunch\n12:30. Tacos, ramen or salad.')
      expect(fax.from).toEqual({ name: 'Ops team', origin: PUBLIC })
    }
  })

  it('caps long content in the agent section so the questions stay visible', async () => {
    const { req, send, path } = setup()
    const { links } = await send({ ...lunch, html: `<p>${'Long report. '.repeat(2000)}</p>` })
    const html = await (await req(path(links[0]!.url))).text()
    const section = html.split('For AI assistants')[1]!
    expect(section).toContain('[The content is longer than this. The rest is on the page.]')
    expect(section).toContain('#spot=&lt;answer&gt;')
    expect(section.length).toBeLessThan(6000)
  })

  it('returns 404 for an unknown link, as JSON for agents', async () => {
    const { req } = setup()
    expect((await req('/f/AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404)
    const res = await req('/f/AAAAAAAAAAAAAAAAAAAAAA.json')
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
  })

  it('returns 410 once the fax expires', async () => {
    const { req, send, path, advance } = setup()
    const { links } = await send()
    advance(31)
    expect((await req(path(links[0]!.url))).status).toBe(410)
  })
})

describe('GET /f/:token/view', () => {
  it('serves sender HTML under a CSP that blocks network calls and gives it no origin', async () => {
    const { req, send, path } = setup()
    const res = await req(`${path((await send()).links[0]!.url)}/view`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<h1>Friday lunch</h1>')
    const csp = res.headers.get('content-security-policy')!
    for (const d of ['sandbox allow-scripts', "default-src 'none'", "connect-src 'none'", "form-action 'none'", "frame-ancestors 'self'"]) expect(csp).toContain(d)
    expect(csp).not.toContain('allow-same-origin')
  })

  it('adds a height reporter so the page can size the frame', async () => {
    const { req, send, path } = setup()
    const html = await (await req(`${path((await send()).links[0]!.url)}/view`)).text()
    expect(html).toContain("parent.postMessage({ type: 'agentfax:height'")
  })

  it('returns 404 when the fax has no HTML', async () => {
    const { req, send, path } = setup()
    const { links } = await send({ ...lunch, html: undefined, text: 'Friday 12:30' })
    expect((await req(`${path(links[0]!.url)}/view`)).status).toBe(404)
  })
})

describe('POST /f/:token/reply', () => {
  it('stores the reply and attributes it to the link recipient', async () => {
    const { req, create, reply, path } = setup()
    const { links, inbox } = await (await create({ ...lunch, to: ['Priya'] })).json()
    const res = await reply(links[0].url, { answers: { spot: 'Ramen', note: 'Vegetarian 🙂' } })
    expect(res.status).toBe(201)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    const box = await (await req(`${path(inbox)}.json`)).json()
    expect(box.replies).toEqual([{ to: 'Priya', answers: { spot: 'Ramen', note: 'Vegetarian 🙂' }, ack: false, at: '2026-10-17T12:00:00.000Z' }])
  })

  it('accepts a plain HTML form post', async () => {
    const { req, send, path } = setup()
    const { links } = await send()
    const res = await req(`${path(links[0]!.url)}/reply`, {
      method: 'POST',
      headers: { origin: PUBLIC, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'spot=Tacos&guests=2',
    })
    expect(res.status).toBe(201)
  })

  it.each([
    ['no Origin', null],
    ['Origin null', 'null'],
    ['a foreign Origin', 'https://evil.example'],
    ['the internal Origin instead of the public one', 'http://internal:8787'],
  ])('rejects a reply with %s', async (_, origin) => {
    const { send, reply } = setup()
    expect((await reply((await send()).links[0]!.url, { answers: { spot: 'Tacos' } }, origin)).status).toBe(403)
  })

  it.each([
    ['an unknown question id', { spot: 'Tacos', evil: 'x' }],
    ['a missing required answer', { note: 'hi' }],
    ['a choice that is not an option', { spot: 'Pizza' }],
    ['a number that is not a number', { spot: 'Tacos', guests: 'two' }],
    ['an answer over 5,000 characters', { spot: 'Tacos', note: 'x'.repeat(5001) }],
  ])('rejects %s', async (_, answers) => {
    const { send, reply } = setup()
    expect((await reply((await send()).links[0]!.url, { answers })).status).toBe(422)
  })

  it('keeps one reply per personal link and every reply on a shared link', async () => {
    const { req, create, reply, path } = setup()
    const personal = await (await create({ ...lunch, to: ['Priya'] })).json()
    const shared = await (await create(lunch)).json()
    for (const spot of ['Tacos', 'Ramen']) {
      await reply(personal.links[0].url, { answers: { spot } })
      await reply(shared.links[0].url, { answers: { spot } })
    }
    const answers = async (inbox: string) => (await (await req(`${path(inbox)}.json`)).json()).replies.map((r: { answers: { spot: string } }) => r.answers.spot)
    expect(await answers(personal.inbox)).toEqual(['Ramen'])
    expect(await answers(shared.inbox)).toEqual(['Tacos', 'Ramen'])
  })

  it('records "Got it" on an information-only fax with ack', async () => {
    const { req, create, reply, path } = setup()
    const { links, inbox } = await (await create({ from: 'Facilities', title: 'Office move', text: 'Monday, 4th floor.', ack: true, to: ['Sam'] })).json()
    expect((await reply(links[0].url, { ack: true })).status).toBe(201)
    expect((await (await req(`${path(inbox)}.json`)).json()).replies[0]).toMatchObject({ to: 'Sam', ack: true, answers: {} })
  })

  it('stores a free-text message alongside the answers', async () => {
    const { req, create, reply, path } = setup()
    const { links, inbox } = await (await create({ ...lunch, to: ['Priya'] })).json()
    expect((await reply(links[0].url, { answers: { spot: 'Ramen' }, message: 'Is the broth vegetarian?' })).status).toBe(201)
    expect((await (await req(`${path(inbox)}.json`)).json()).replies[0]).toMatchObject({ answers: { spot: 'Ramen' }, message: 'Is the broth vegetarian?' })
  })

  it('accepts a message on its own, even on an information-only fax without ack', async () => {
    const { req, create, reply, path } = setup()
    const { links, inbox } = await (await create({ from: 'Facilities', title: 'Office move', text: 'Monday.', to: ['Sam'] })).json()
    expect((await reply(links[0].url, { message: 'Which lockers are ours?' })).status).toBe(201)
    expect((await (await req(`${path(inbox)}.json`)).json()).replies[0]).toMatchObject({ to: 'Sam', message: 'Which lockers are ours?', ack: false })
  })

  it('accepts a message instead of the required answers', async () => {
    const { req, send, reply, path } = setup()
    const { links, inbox } = await send()
    expect((await reply(links[0]!.url, { message: 'Ramen please, I am vegetarian.' })).status).toBe(201)
    expect((await (await req(`${path(inbox)}.json`)).json()).replies[0]).toMatchObject({ answers: {}, message: 'Ramen please, I am vegetarian.' })
  })

  it('rejects a message over 5,000 characters', async () => {
    const { send, reply } = setup()
    expect((await reply((await send()).links[0]!.url, { answers: { spot: 'Tacos' }, message: 'x'.repeat(5001) })).status).toBe(422)
  })

  it('refuses replies to an information-only fax without ack', async () => {
    const { create, reply } = setup()
    const { links } = await (await create({ from: 'Facilities', title: 'Office move', text: 'Monday.' })).json()
    expect((await reply(links[0].url, { ack: true })).status).toBe(409)
  })

  it('rate-limits a personal link at 10 replies a minute', async () => {
    const { create, reply } = setup()
    const url = (await (await create({ ...lunch, to: ['Priya'] })).json()).links[0].url
    for (let i = 0; i < 10; i++) expect((await reply(url, { answers: { spot: 'Tacos' } })).status).toBe(201)
    expect((await reply(url, { answers: { spot: 'Tacos' } })).status).toBe(429)
  })

  it('counts rejected attempts toward the limit', async () => {
    const { create, reply } = setup()
    const url = (await (await create({ ...lunch, to: ['Priya'] })).json()).links[0].url
    for (let i = 0; i < 10; i++) expect((await reply(url, { answers: { spot: 'Pizza' } })).status).toBe(422)
    expect((await reply(url, { answers: { spot: 'Tacos' } })).status).toBe(429)
  })

  it('gives a shared link a higher limit, since many people reply through it', async () => {
    const { send, reply } = setup()
    const url = (await send()).links[0]!.url
    for (let i = 0; i < 60; i++) expect((await reply(url, { answers: { spot: 'Tacos' } })).status).toBe(201)
    expect((await reply(url, { answers: { spot: 'Tacos' } })).status).toBe(429)
  })

  it('rejects a reply body over 64 KB before reading it', async () => {
    const { send, reply } = setup()
    expect((await reply((await send()).links[0]!.url, { answers: { note: 'x'.repeat(70_000) } })).status).toBe(413)
  })

  it('returns 410 after the fax expires', async () => {
    const { send, reply, advance } = setup()
    const url = (await send()).links[0]!.url
    advance(31)
    expect((await reply(url, { answers: { spot: 'Tacos' } })).status).toBe(410)
  })
})

describe('GET /i/:token', () => {
  it('serves the inbox with privacy headers', async () => {
    const { req, send, path } = setup()
    const res = await req(path((await send()).inbox))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(await res.text()).toContain('Team lunch on Friday')
  })

  it('returns 404 for an unknown inbox', async () => {
    expect((await setup().req('/i/AAAAAAAAAAAAAAAAAAAAAA.json')).status).toBe(404)
  })

  it('does not accept a fax link as an inbox', async () => {
    const { req, send } = setup()
    const { links } = await send()
    expect((await req(`/i/${links[0]!.url.split('/f/')[1]}.json`)).status).toBe(404)
  })
})

describe('DELETE /api/faxes/:id', () => {
  const twoSenders = async (req: Request) => {
    const key = req.headers.get('authorization')
    return key === 'Bearer alice-key' ? 'alice' : key === 'Bearer mallory-key' ? 'mallory' : null
  }

  it('revokes a fax for its sender', async () => {
    const { req, send, path } = setup()
    const { id, links } = await send()
    const res = await req(`/api/faxes/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${KEY}` } })
    expect(res.status).toBe(204)
    expect((await req(path(links[0]!.url))).status).toBe(410)
  })

  it("can't revoke another sender's fax", async () => {
    const { req, create, path } = setup({ authorize: twoSenders })
    const { id, links } = await (await create(lunch, 'alice-key')).json()
    expect((await req(`/api/faxes/${id}`, { method: 'DELETE', headers: { authorization: 'Bearer mallory-key' } })).status).toBe(404)
    expect((await req(path(links[0].url))).status).toBe(200)
  })

  it('requires a sender key', async () => {
    const { req, send } = setup()
    const { id } = await send()
    expect((await req(`/api/faxes/${id}`, { method: 'DELETE' })).status).toBe(401)
  })
})

describe('fax page design', () => {
  const html = async (body: object = lunch) => {
    const { req, create, path } = setup()
    const { links } = await (await create(body)).json()
    return (await req(path(links[0].url))).text()
  }

  it('shows a transmission header with sender, recipient and sent time', async () => {
    const page = await html({ ...lunch, to: ['Priya'] })
    expect(page).toContain('From <b>Ops team</b>')
    expect(page).toContain('To <b>Priya</b>')
    expect(page).toContain('17 OCT 2026 12:00 UTC')
  })

  it('shows the origin as the sender identity', async () => {
    expect(await html()).toContain('<span class="origin">fax.example.com</span>')
  })

  it('shows the hint and follow-ups under their question', async () => {
    const page = await html({ ...lunch, questions: [{ id: 'note', label: 'Anything?', type: 'longtext', hint: 'Allergies first.', probes: ['When?', 'Diet?'] }] })
    expect(page).toContain('<p class="hint">Allergies first.</p>')
    expect(page).toContain('<ul class="cover"><li>When?</li><li>Diet?</li></ul>')
  })

  it('loads the prefill script from the same origin', async () => {
    const { req } = setup()
    expect(await html()).toContain('<script src="/assets/fax.js" defer></script>')
    const res = await req('/assets/fax.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
    expect(await res.text()).toContain('location.hash')
  })

  it('shows Got it and a message box, but no questions, on an information-only fax with ack', async () => {
    const page = await html({ from: 'Facilities', title: 'Office move', text: 'Monday.', ack: true })
    expect(page).toContain('>Got it</button>')
    expect(page).toContain('name="message"')
    expect(page).not.toContain('class="chips"')
  })

  it('leaves required checks to the server, so the message box can stand in for answers', async () => {
    expect(await html()).not.toMatch(/<(input|textarea)[^>]* required/)
  })

  it('gives every fax a message box', async () => {
    expect(await html()).toContain('<label class="label" for="q-message">Or type or paste your reply here')
    expect(await html({ from: 'Facilities', title: 'Office move', text: 'Monday.' })).toContain('name="message"')
  })

  it('shows a transmission report after a form reply from a browser', async () => {
    const { req, create, path } = setup()
    const { links } = await (await create({ ...lunch, to: ['Priya'] })).json()
    const res = await req(`${path(links[0].url)}/reply`, {
      method: 'POST',
      headers: { origin: PUBLIC, accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'spot=Ramen&note=Vegetarian',
    })
    expect(res.status).toBe(201)
    const page = await res.text()
    expect(page).toContain('TRANSMISSION REPORT')
    expect(page).toContain('SENT TO OPS TEAM')
    expect(page).toContain('<dd>Ramen</dd>')
  })

  it('explains an expired fax in plain words', async () => {
    const { req, send, path, advance } = setup()
    const { links } = await send()
    advance(31)
    const page = await (await req(path(links[0]!.url))).text()
    expect(page).toContain('This fax has expired')
    expect(page).toContain('Ask Ops team to send it again')
  })
})

describe('server basics', () => {
  it('serves a robots.txt that lets assistants in', async () => {
    expect(await (await setup().req('/robots.txt')).text()).toBe('User-agent: *\nAllow: /\n')
  })

  it('never stores raw tokens', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'agentfax-')), 'fax.db')
    const { send } = setup({ store: sqliteStore(file) })
    const { links, inbox } = await send()
    const bytes = readFileSync(file, 'latin1') + readFileSync(`${file}-wal`, 'latin1')
    expect(bytes).toContain('Team lunch on Friday')
    expect(bytes).not.toContain(links[0]!.url.split('/f/')[1])
    expect(bytes).not.toContain(inbox.split('/i/')[1])
  })
})
