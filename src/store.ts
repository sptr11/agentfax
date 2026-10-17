import type { Question } from './fax.js'

export type StoredFax = {
  from: string
  title: string
  note?: string
  html?: string
  text: string
  questions: Question[]
  ack: boolean
}

export type FaxRecord = { id: string; senderId: string; data: StoredFax; createdAt: string; expiresAt: string; revokedAt: string | null }

// recipient is null for a shared link (anyone with it can reply; replies append).
export type LinkRecord = { tokenHash: string; faxId: string; recipient: string | null }

export type ReplyRecord = {
  id: string
  faxId: string
  linkHash: string
  recipient: string | null
  answers: Record<string, string>
  ack: boolean
  createdAt: string
}

export interface Store {
  createFax(fax: FaxRecord, links: LinkRecord[], inboxHash: string): Promise<void>
  findLink(tokenHash: string): Promise<{ fax: FaxRecord; link: LinkRecord } | null>
  findInbox(inboxHash: string): Promise<{ fax: FaxRecord; replies: ReplyRecord[] } | null>
  // 'replace' keeps one reply per link (personal links); 'append' keeps every reply (shared links).
  saveReply(reply: ReplyRecord, mode: 'replace' | 'append'): Promise<void>
  // Returns false when the fax doesn't exist or belongs to another sender.
  revoke(faxId: string, senderId: string, at: string): Promise<boolean>
}

export function memoryStore(): Store {
  const faxes = new Map<string, FaxRecord>()
  const links = new Map<string, LinkRecord>()
  const inboxes = new Map<string, string>()
  const replies: ReplyRecord[] = []
  const copy = <T>(x: T): T => structuredClone(x)

  return {
    async createFax(fax, newLinks, inboxHash) {
      faxes.set(fax.id, copy(fax))
      for (const l of newLinks) links.set(l.tokenHash, copy(l))
      inboxes.set(inboxHash, fax.id)
    },
    async findLink(tokenHash) {
      const link = links.get(tokenHash)
      const fax = link && faxes.get(link.faxId)
      return link && fax ? { fax: copy(fax), link: copy(link) } : null
    },
    async findInbox(inboxHash) {
      const fax = faxes.get(inboxes.get(inboxHash) ?? '')
      return fax ? { fax: copy(fax), replies: copy(replies.filter((r) => r.faxId === fax.id)) } : null
    },
    async saveReply(reply, mode) {
      if (mode === 'replace') {
        const i = replies.findIndex((r) => r.linkHash === reply.linkHash)
        if (i >= 0) replies.splice(i, 1)
      }
      replies.push(copy(reply))
    },
    async revoke(faxId, senderId, at) {
      const fax = faxes.get(faxId)
      if (!fax || fax.senderId !== senderId) return false
      fax.revokedAt = at
      return true
    },
  }
}
