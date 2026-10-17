import { serve as nodeServe } from '@hono/node-server'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { userInfo } from 'node:os'
import { basename, extname } from 'node:path'
import { agentfax } from './server.js'
import { sqliteStore } from './sqlite.js'
import { newToken } from './token.js'

export type Io = {
  env: Record<string, string | undefined>
  stdout: (s: string) => void
  stderr: (s: string) => void
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  // Tests: make `serve` return a handle instead of running until killed.
  keepAlive?: boolean
}

type Args = { _: string[] } & Record<string, (string | true)[]>

const BOOLEAN = new Set(['ack', 'tunnel', 'help'])

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] } as unknown as Args
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) { out._.push(a); continue }
    let name = a.slice(2)
    let value: string | true = true
    const eq = name.indexOf('=')
    if (eq >= 0) { value = name.slice(eq + 1); name = name.slice(0, eq) }
    else if (!BOOLEAN.has(name) && i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) value = argv[++i]!
    ;(out[name] ??= []).push(value)
  }
  return out
}

const one = (args: Args, name: string): string | undefined => {
  const v = args[name]?.at(-1)
  return typeof v === 'string' ? v : undefined
}

export function tunnelUrl(line: string): string | null {
  return line.match(/https:\/\/[a-z0-9-]+\.lhr\.life/)?.[0] ?? null
}

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(url)

const USAGE = `AgentFax: the fax machine, rebuilt for agents.

  agentfax serve [--tunnel] [--port 8787] [--db agentfax.db] [--public-url https://fax.example.com]
      Run a fax server. --tunnel gives it a temporary public address (demos only).

  agentfax send <file> [--to name]... [--ask "question"] [--choice "A|B|C"] [--ack]
                [--title …] [--note …] [--from …] [--expires days]
      Send an .html, .md or .txt file as a fax. Prints a link per recipient and your inbox link.

  agentfax replies <inbox-link>
      Show the replies to a fax.

Settings: AGENTFAX_URL (server to send to), AGENTFAX_KEY (sender key), AGENTFAX_PUBLIC_URL (for serve).
Spec and docs: https://github.com/sptr11/agentfax`

export async function run(argv: string[], io: Io): Promise<number | { stop: () => Promise<void>; url: string }> {
  const args = parseArgs(argv)
  const [command] = args._
  if (!command || command === 'help' || args.help) { io.stdout(USAGE); return 0 }
  if (command === 'send') return send(args, io)
  if (command === 'replies') return replies(args, io)
  if (command === 'serve') return serve(args, io)
  io.stderr(`Unknown command "${command}".\n\n${USAGE}`)
  return 1
}

function titleOf(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const t = m?.[1]?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  return t || undefined
}

async function send(args: Args, io: Io): Promise<number> {
  const file = args._[1]
  const key = one(args, 'key') ?? io.env.AGENTFAX_KEY ?? (existsSync('agentfax.db.key') ? readFileSync('agentfax.db.key', 'utf8').trim() : undefined)
  if (!key) { io.stderr('No sender key. Set AGENTFAX_KEY, or run this next to the agentfax.db your server created.'); return 1 }
  if (!file) { io.stderr('Name a file to send: agentfax send report.html'); return 1 }
  if (!existsSync(file)) { io.stderr(`Can't find ${file}.`); return 1 }
  const server = (one(args, 'url') ?? io.env.AGENTFAX_URL ?? 'http://localhost:8787').replace(/\/+$/, '')
  const raw = readFileSync(file, 'utf8')
  const isHtml = /^\.html?$/i.test(extname(file))
  const ask = one(args, 'ask')
  const choice = one(args, 'choice')
  const expires = one(args, 'expires')
  const body = {
    from: one(args, 'from') ?? io.env.AGENTFAX_FROM ?? userInfo().username,
    title: one(args, 'title') ?? (isHtml ? titleOf(raw) : undefined) ?? basename(file, extname(file)),
    ...(one(args, 'note') ? { note: one(args, 'note') } : {}),
    ...(isHtml ? { html: raw } : { text: raw }),
    ...(args.to ? { to: args.to.filter((t): t is string => typeof t === 'string') } : {}),
    ...(ask ? { questions: [choice ? { id: 'answer', label: ask, type: 'choice', options: choice.split('|').map((o) => o.trim()).filter(Boolean), required: true } : { id: 'answer', label: ask, type: 'longtext', required: true }] } : {}),
    ...(args.ack ? { ack: true } : {}),
    ...(expires ? { expiresInDays: Number(expires) } : {}),
  }
  let res: Response
  try {
    res = await io.fetch(`${server}/api/faxes`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    io.stderr(`Couldn't reach ${server}. Is the server running? Start one with: agentfax serve`)
    return 1
  }
  const data = (await res.json().catch(() => ({}))) as { links?: { to: string | null; url: string }[]; inbox?: string; message?: string; issues?: { path?: unknown[]; message?: string }[] }
  if (res.status === 401) { io.stderr('The server rejected your sender key. Check AGENTFAX_KEY.'); return 1 }
  if (res.status !== 201 || !data.links || !data.inbox) {
    io.stderr(`The server didn't accept the fax: ${data.message ?? `status ${res.status}`}`)
    for (const i of data.issues ?? []) io.stderr(`  ${(i.path ?? []).join('.')}: ${i.message}`)
    return 1
  }
  for (const l of data.links) io.stdout(`${l.url}   ${l.to ? `send this to ${l.to}` : 'share this link'}`)
  io.stdout(`${data.inbox}   your inbox, keep it private`)
  if (isLocal(data.links[0]!.url)) io.stderr('\nThese links only work on this machine. Run `agentfax serve --tunnel`, or give your server a public address (docs/HOSTING.md).')
  return 0
}

async function replies(args: Args, io: Io): Promise<number> {
  const inbox = args._[1]
  if (!inbox) { io.stderr('Give the inbox link: agentfax replies https://…/i/…'); return 1 }
  const res = await io.fetch(`${inbox.replace(/\.json$/, '').replace(/\/+$/, '')}.json`).catch(() => null)
  if (!res || !res.ok) { io.stderr(res?.status === 404 ? 'No inbox at that link.' : `Couldn't read the inbox${res ? ` (status ${res.status})` : ''}.`); return 1 }
  const data = (await res.json()) as { title: string; replies: { to: string | null; answers: Record<string, string>; message?: string; ack: boolean; at: string }[] }
  io.stdout(`${data.title}: ${data.replies.length} repl${data.replies.length === 1 ? 'y' : 'ies'}`)
  for (const r of data.replies) {
    io.stdout(`\n${r.to ?? 'Someone'} · ${r.at}${r.ack ? ' · Got it' : ''}`)
    for (const [k, v] of Object.entries(r.answers)) io.stdout(`  ${k}: ${v}`)
    if (r.message) io.stdout(`  message: ${r.message}`)
  }
  return 0
}

async function serve(args: Args, io: Io): Promise<number | { stop: () => Promise<void>; url: string }> {
  const port = Number(one(args, 'port') ?? io.env.PORT ?? 8787)
  const db = one(args, 'db') ?? io.env.AGENTFAX_DB ?? 'agentfax.db'
  const keyFile = `${db}.key`
  let key = io.env.AGENTFAX_KEY
  let created = false
  if (!key) {
    if (existsSync(keyFile)) key = readFileSync(keyFile, 'utf8').trim()
    else {
      key = `afx_${newToken(32)}`
      writeFileSync(keyFile, key + '\n', { mode: 0o600 })
      chmodSync(keyFile, 0o600)
      created = true
    }
  }
  let current = one(args, 'public-url') ?? io.env.AGENTFAX_PUBLIC_URL
  const app = agentfax({ store: sqliteStore(db), senderKey: key, publicUrl: () => current })

  const server = await new Promise<ReturnType<typeof nodeServe>>((resolve) => {
    const s = nodeServe({ fetch: app.fetch, port }, () => resolve(s))
  })
  const local = `http://localhost:${(server.address() as AddressInfo).port}`

  let tunnel: ChildProcess | undefined
  if (args.tunnel) {
    tunnel = spawn('ssh', ['-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30', '-R', `80:localhost:${(server.address() as AddressInfo).port}`, 'nokey@localhost.run'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const onData = (chunk: Buffer) => {
      const url = tunnelUrl(chunk.toString())
      if (!url || url === current) return
      if (current) io.stderr(`The tunnel moved to ${url}. Links sent before this stopped working.`)
      else io.stdout(`Public address: ${url}  (temporary: links stop working when the tunnel reconnects)`)
      current = url
    }
    tunnel.stdout?.on('data', onData)
    tunnel.stderr?.on('data', onData)
    tunnel.on('exit', () => io.stderr('The tunnel closed. Your faxes are only reachable on this machine now.'))
  }

  io.stdout(`AgentFax is running at ${current ?? local}`)
  io.stdout(`Sender key: ${key}${created ? `  (new, saved in ${keyFile})` : ''}`)
  if (!current && !args.tunnel) io.stderr(`\nFax links will use ${local} and only work on this machine. Use --tunnel, or set AGENTFAX_PUBLIC_URL to your public address.`)
  io.stdout(`\nSend a fax:\n  AGENTFAX_URL=${local} AGENTFAX_KEY=${key} npx agentfax send report.html --to priya`)

  const stop = () => new Promise<void>((resolve) => { tunnel?.kill(); server.close(() => resolve()) })
  if (io.keepAlive) return { stop, url: local }
  await new Promise(() => {})
  return 0
}
