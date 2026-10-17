import { describe, expect, it } from 'vitest'
import type { FaxRecord, Store } from '../src/store.js'

const fax = (id: string, senderId = 'alice'): FaxRecord => ({
  id,
  senderId,
  data: { from: 'Ops team', title: 'Team lunch', text: 'Friday 12:30', questions: [{ id: 'spot', label: 'Where?', type: 'choice', options: ['Tacos', 'Ramen'] }], ack: false },
  createdAt: '2026-10-17T00:00:00.000Z',
  expiresAt: '2026-11-16T00:00:00.000Z',
  revokedAt: null,
})

const reply = (id: string, linkHash: string, recipient: string | null, spot: string) => ({
  id, faxId: 'fx1', linkHash, recipient, answers: { spot }, ack: false, createdAt: '2026-10-17T01:00:00.000Z',
})

// One contract, run against every store.
export function storeContract(name: string, make: () => Store | Promise<Store>) {
  describe(`${name} store`, () => {
    it('finds a fax by link hash, with the link recipient', async () => {
      const store = await make()
      await store.createFax(fax('fx1'), [{ tokenHash: 'h-priya', faxId: 'fx1', recipient: 'Priya' }], 'h-inbox')
      const found = await store.findLink('h-priya')
      expect(found?.fax).toEqual(fax('fx1'))
      expect(found?.link.recipient).toBe('Priya')
    })

    it('returns null for an unknown link or inbox', async () => {
      const store = await make()
      expect(await store.findLink('nope')).toBeNull()
      expect(await store.findInbox('nope')).toBeNull()
    })

    it('replaces the reply on a personal link', async () => {
      const store = await make()
      await store.createFax(fax('fx1'), [{ tokenHash: 'h-priya', faxId: 'fx1', recipient: 'Priya' }], 'h-inbox')
      await store.saveReply(reply('r1', 'h-priya', 'Priya', 'Tacos'), 'replace')
      await store.saveReply(reply('r2', 'h-priya', 'Priya', 'Ramen'), 'replace')
      const inbox = await store.findInbox('h-inbox')
      expect(inbox?.replies.map((r) => r.answers.spot)).toEqual(['Ramen'])
    })

    it('appends replies on a shared link', async () => {
      const store = await make()
      await store.createFax(fax('fx1'), [{ tokenHash: 'h-shared', faxId: 'fx1', recipient: null }], 'h-inbox')
      await store.saveReply(reply('r1', 'h-shared', null, 'Tacos'), 'append')
      await store.saveReply(reply('r2', 'h-shared', null, 'Ramen'), 'append')
      const inbox = await store.findInbox('h-inbox')
      expect(inbox?.replies.map((r) => r.answers.spot)).toEqual(['Tacos', 'Ramen'])
    })

    it('shows a fax only its own replies in the inbox', async () => {
      const store = await make()
      await store.createFax(fax('fx1'), [{ tokenHash: 'h-1', faxId: 'fx1', recipient: null }], 'h-inbox-1')
      await store.createFax(fax('fx2'), [{ tokenHash: 'h-2', faxId: 'fx2', recipient: null }], 'h-inbox-2')
      await store.saveReply(reply('r1', 'h-1', null, 'Tacos'), 'append')
      await store.saveReply({ ...reply('r2', 'h-2', null, 'Ramen'), faxId: 'fx2' }, 'append')
      expect((await store.findInbox('h-inbox-1'))?.replies.map((r) => r.id)).toEqual(['r1'])
    })

    it('revokes only for the fax owner', async () => {
      const store = await make()
      await store.createFax(fax('fx1', 'alice'), [{ tokenHash: 'h-1', faxId: 'fx1', recipient: null }], 'h-inbox')
      expect(await store.revoke('fx1', 'mallory', '2026-10-18T00:00:00.000Z')).toBe(false)
      expect((await store.findLink('h-1'))?.fax.revokedAt).toBeNull()
      expect(await store.revoke('fx1', 'alice', '2026-10-18T00:00:00.000Z')).toBe(true)
      expect((await store.findLink('h-1'))?.fax.revokedAt).toBe('2026-10-18T00:00:00.000Z')
    })
  })
}
