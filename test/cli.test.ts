import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseArgs, run, tunnelUrl } from '../src/cli.js'

const dir = () => mkdtempSync(join(tmpdir(), 'agentfax-cli-'))

function io(env: Record<string, string> = {}) {
  const out: string[] = []
  const err: string[] = []
  return { env, out, err, stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) }
}

describe('parseArgs', () => {
  it('reads positionals, flags and repeated options', () => {
    expect(parseArgs(['send', 'report.html', '--to', 'priya', '--to=sam', '--ack', '--title', 'Q3'])).toEqual({
      _: ['send', 'report.html'],
      to: ['priya', 'sam'],
      ack: [true],
      title: ['Q3'],
    })
  })
})

describe('tunnelUrl', () => {
  it('finds the public address in localhost.run output', () => {
    expect(tunnelUrl('abc123.lhr.life tunneled with tls termination, https://abc123.lhr.life')).toBe('https://abc123.lhr.life')
    expect(tunnelUrl('Welcome to localhost.run!')).toBeNull()
  })
})

describe('agentfax send', () => {
  it('sends an HTML file with recipients and a question, and prints the links', async () => {
    const d = dir()
    const file = join(d, 'report.html')
    writeFileSync(file, '<html><head><title>Q3 report</title></head><body><h1>Q3</h1></body></html>')
    let sent: { url: string; init: RequestInit } | undefined
    const fetch = async (url: string, init: RequestInit = {}) => {
      sent = { url, init }
      return new Response(JSON.stringify({ id: 'fx_1', links: [{ to: 'priya', url: 'https://f.example/f/AAA' }, { to: 'sam', url: 'https://f.example/f/BBB' }], inbox: 'https://f.example/i/CCC', expires: '2026-11-16T00:00:00.000Z' }), { status: 201 })
    }
    const t = io({ AGENTFAX_URL: 'https://f.example', AGENTFAX_KEY: 'sk' })
    const code = await run(['send', file, '--to', 'priya', '--to', 'sam', '--ask', 'Approve the numbers?', '--choice', 'Yes|No', '--from', 'Ops'], { ...t, fetch })
    expect(code).toBe(0)
    expect(sent!.url).toBe('https://f.example/api/faxes')
    expect((sent!.init.headers as Record<string, string>).authorization).toBe('Bearer sk')
    expect(JSON.parse(sent!.init.body as string)).toEqual({
      from: 'Ops',
      title: 'Q3 report',
      html: '<html><head><title>Q3 report</title></head><body><h1>Q3</h1></body></html>',
      to: ['priya', 'sam'],
      questions: [{ id: 'answer', label: 'Approve the numbers?', type: 'choice', options: ['Yes', 'No'], required: true }],
    })
    expect(t.out.join('\n')).toContain('https://f.example/f/AAA   send this to priya')
    expect(t.out.join('\n')).toContain('https://f.example/i/CCC   your inbox, keep it private')
  })

  it('sends a markdown or text file as text, titled from the file name', async () => {
    const d = dir()
    const file = join(d, 'office-move.md')
    writeFileSync(file, 'Monday: 4th floor.')
    let body: Record<string, unknown> = {}
    const fetch = async (_: string, init: RequestInit = {}) => {
      body = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ id: 'fx', links: [{ to: null, url: 'https://f.example/f/AAA' }], inbox: 'https://f.example/i/B', expires: 'x' }), { status: 201 })
    }
    await run(['send', file, '--ack'], { ...io({ AGENTFAX_URL: 'https://f.example', AGENTFAX_KEY: 'sk' }), fetch })
    expect(body).toMatchObject({ title: 'office-move', text: 'Monday: 4th floor.', ack: true })
    expect(body.html).toBeUndefined()
  })

  it('warns when the fax links only work on this machine', async () => {
    const d = dir()
    const file = join(d, 'a.txt')
    writeFileSync(file, 'hi')
    const fetch = async () => new Response(JSON.stringify({ id: 'fx', links: [{ to: null, url: 'http://localhost:8787/f/AAA' }], inbox: 'http://localhost:8787/i/B', expires: 'x' }), { status: 201 })
    const t = io({ AGENTFAX_KEY: 'sk' })
    await run(['send', file], { ...t, fetch })
    expect(t.err.join('\n')).toContain('These links only work on this machine')
  })

  it('explains a rejected key', async () => {
    const d = dir()
    const file = join(d, 'a.txt')
    writeFileSync(file, 'hi')
    const fetch = async () => new Response(JSON.stringify({ error: 'unauthorized', message: 'Send your sender key as a Bearer token.' }), { status: 401 })
    const t = io({ AGENTFAX_URL: 'https://f.example', AGENTFAX_KEY: 'wrong' })
    expect(await run(['send', file], { ...t, fetch })).toBe(1)
    expect(t.err.join('\n')).toContain('The server rejected your sender key')
  })

  it('fails clearly without a key', async () => {
    const t = io({ AGENTFAX_URL: 'https://f.example' })
    expect(await run(['send', 'a.txt'], { ...t, fetch: async () => new Response('') })).toBe(1)
    expect(t.err.join('\n')).toContain('No sender key')
  })
})

describe('agentfax replies', () => {
  it('prints each reply with answers and message', async () => {
    const fetch = async (url: string) => {
      expect(url).toBe('https://f.example/i/CCC.json')
      return new Response(JSON.stringify({ title: 'Team lunch', replies: [{ to: 'priya', answers: { spot: 'Ramen' }, message: 'Vegetarian', ack: false, at: '2026-10-17T12:00:00.000Z' }] }))
    }
    const t = io()
    expect(await run(['replies', 'https://f.example/i/CCC'], { ...t, fetch })).toBe(0)
    const text = t.out.join('\n')
    expect(text).toContain('Team lunch: 1 reply')
    expect(text).toContain('priya')
    expect(text).toContain('spot: Ramen')
    expect(text).toContain('message: Vegetarian')
  })
})

describe('agentfax serve', () => {
  const stops: (() => Promise<void>)[] = []
  afterEach(async () => { while (stops.length) await stops.pop()!() })

  it('starts a server, creates a private sender key once, and warns about local links', async () => {
    const d = dir()
    const db = join(d, 'fax.db')
    const t = io()
    const handle = await run(['serve', '--port', '0', '--db', db], { ...t, fetch, keepAlive: true }) as unknown as { stop: () => Promise<void>; url: string }
    stops.push(handle.stop)
    const key = readFileSync(`${db}.key`, 'utf8').trim()
    expect(key).toMatch(/^afx_[A-Za-z0-9]{32}$/)
    expect(statSync(`${db}.key`).mode & 0o777).toBe(0o600)
    expect(t.out.join('\n')).toContain(key)
    expect(t.err.join('\n')).toContain('only work on this machine')
    const res = await fetch(`${handle.url}/robots.txt`)
    expect(await res.text()).toBe('User-agent: *\nAllow: /\n')
    const created = await fetch(`${handle.url}/api/faxes`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: 'A', title: 'T', text: 'x' }) })
    expect(created.status).toBe(201)
  })

  it('reuses the existing key on the next start', async () => {
    const d = dir()
    const db = join(d, 'fax.db')
    const a = await run(['serve', '--port', '0', '--db', db], { ...io(), fetch, keepAlive: true }) as unknown as { stop: () => Promise<void> }
    await a.stop()
    const first = readFileSync(`${db}.key`, 'utf8')
    const b = await run(['serve', '--port', '0', '--db', db], { ...io(), fetch, keepAlive: true }) as unknown as { stop: () => Promise<void> }
    stops.push(b.stop)
    expect(readFileSync(`${db}.key`, 'utf8')).toBe(first)
  })

  it('uses AGENTFAX_PUBLIC_URL for links and does not warn', async () => {
    const d = dir()
    const t = io({ AGENTFAX_PUBLIC_URL: 'https://fax.example.com' })
    const handle = await run(['serve', '--port', '0', '--db', join(d, 'fax.db')], { ...t, fetch, keepAlive: true }) as unknown as { stop: () => Promise<void>; url: string }
    stops.push(handle.stop)
    expect(t.err.join('\n')).not.toContain('only work on this machine')
    expect(t.out.join('\n')).toContain('https://fax.example.com')
  })
})

describe('agentfax help', () => {
  it('prints usage for no command or an unknown one', async () => {
    const t = io()
    expect(await run([], { ...t, fetch })).toBe(0)
    expect(t.out.join('\n')).toContain('agentfax serve')
    const u = io()
    expect(await run(['nope'], { ...u, fetch })).toBe(1)
  })
})
