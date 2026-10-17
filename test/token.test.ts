import { describe, expect, it } from 'vitest'
import { hashToken, newToken } from '../src/token.js'

describe('newToken', () => {
  it('is 22 base62 characters, which is over 128 bits', () => {
    expect(newToken()).toMatch(/^[A-Za-z0-9]{22}$/)
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 1000 }, newToken))
    expect(seen.size).toBe(1000)
  })
})

describe('hashToken', () => {
  it('is a stable sha-256 hex digest', async () => {
    const a = await hashToken('k3J9xQ')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashToken('k3J9xQ')).toBe(a)
    expect(await hashToken('k3J9xR')).not.toBe(a)
  })
})
