import { DatabaseSync } from 'node:sqlite'
import type { FaxRecord, ReplyRecord, Store } from './store.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS faxes (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  data TEXT NOT NULL,
  inbox_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS links (
  token_hash TEXT PRIMARY KEY,
  fax_id TEXT NOT NULL REFERENCES faxes(id),
  recipient TEXT
);
CREATE TABLE IF NOT EXISTS replies (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  fax_id TEXT NOT NULL REFERENCES faxes(id),
  link_hash TEXT NOT NULL,
  recipient TEXT,
  answers TEXT NOT NULL,
  ack INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS replies_fax ON replies(fax_id);
`

type FaxRow = { id: string; sender_id: string; data: string; created_at: string; expires_at: string; revoked_at: string | null }

const toFax = (r: FaxRow): FaxRecord => ({
  id: r.id,
  senderId: r.sender_id,
  data: JSON.parse(r.data),
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
})

export function sqliteStore(path: string): Store {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  db.exec(SCHEMA)

  const insertFax = db.prepare('INSERT INTO faxes (id, sender_id, data, inbox_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const insertLink = db.prepare('INSERT INTO links (token_hash, fax_id, recipient) VALUES (?, ?, ?)')
  const linkWithFax = db.prepare('SELECT l.token_hash, l.fax_id, l.recipient, f.* FROM links l JOIN faxes f ON f.id = l.fax_id WHERE l.token_hash = ?')
  const faxByInbox = db.prepare('SELECT * FROM faxes WHERE inbox_hash = ?')
  const repliesByFax = db.prepare('SELECT * FROM replies WHERE fax_id = ? ORDER BY seq')
  const deleteRepliesForLink = db.prepare('DELETE FROM replies WHERE link_hash = ?')
  const insertReply = db.prepare('INSERT INTO replies (id, fax_id, link_hash, recipient, answers, ack, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const revokeFax = db.prepare('UPDATE faxes SET revoked_at = ? WHERE id = ? AND sender_id = ?')

  const tx = (fn: () => void) => {
    db.exec('BEGIN')
    try {
      fn()
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }

  return {
    async createFax(fax, links, inboxHash) {
      tx(() => {
        insertFax.run(fax.id, fax.senderId, JSON.stringify(fax.data), inboxHash, fax.createdAt, fax.expiresAt, fax.revokedAt)
        for (const l of links) insertLink.run(l.tokenHash, l.faxId, l.recipient)
      })
    },
    async findLink(tokenHash) {
      const r = linkWithFax.get(tokenHash) as (FaxRow & { token_hash: string; fax_id: string; recipient: string | null }) | undefined
      return r ? { fax: toFax(r), link: { tokenHash: r.token_hash, faxId: r.fax_id, recipient: r.recipient } } : null
    },
    async findInbox(inboxHash) {
      const f = faxByInbox.get(inboxHash) as FaxRow | undefined
      if (!f) return null
      const rows = repliesByFax.all(f.id) as { id: string; fax_id: string; link_hash: string; recipient: string | null; answers: string; ack: number; created_at: string }[]
      const replies: ReplyRecord[] = rows.map((r) => ({
        id: r.id,
        faxId: r.fax_id,
        linkHash: r.link_hash,
        recipient: r.recipient,
        answers: JSON.parse(r.answers),
        ack: r.ack === 1,
        createdAt: r.created_at,
      }))
      return { fax: toFax(f), replies }
    },
    async saveReply(reply, mode) {
      tx(() => {
        if (mode === 'replace') deleteRepliesForLink.run(reply.linkHash)
        insertReply.run(reply.id, reply.faxId, reply.linkHash, reply.recipient, JSON.stringify(reply.answers), reply.ack ? 1 : 0, reply.createdAt)
      })
    },
    async revoke(faxId, senderId, at) {
      return Number(revokeFax.run(at, faxId, senderId).changes) > 0
    },
  }
}
