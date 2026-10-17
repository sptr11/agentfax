import { describe, expect, it } from 'vitest'
import { FaxSchema } from '../src/fax.js'
import { lunch, update } from './helpers.js'

const withQuestions = (questions: unknown[]) => ({ ...lunch, questions })

describe('FaxSchema', () => {
  it('accepts a fax with questions', () => {
    expect(FaxSchema.safeParse(lunch).success).toBe(true)
  })

  it('accepts an information-only fax with ack', () => {
    expect(FaxSchema.safeParse(update).success).toBe(true)
  })

  it('accepts an information-only fax with no reply at all', () => {
    const { reply: _, ...rest } = update
    expect(FaxSchema.safeParse({ ...rest, ack: false }).success).toBe(true)
  })

  it('rejects an unknown version', () => {
    expect(FaxSchema.safeParse({ ...lunch, agentfax: '0.2' }).success).toBe(false)
  })

  it('rejects a choice question without options', () => {
    expect(FaxSchema.safeParse(withQuestions([{ id: 'spot', label: 'Where?', type: 'choice' }])).success).toBe(false)
  })

  it('rejects multichoice, which 0.1 does not support', () => {
    expect(FaxSchema.safeParse(withQuestions([{ id: 'days', label: 'Days', type: 'multichoice', options: ['mon'] }])).success).toBe(false)
  })

  it('accepts a hint and follow-ups on a question', () => {
    const q = { id: 'note', label: 'Note', type: 'longtext', hint: 'Allergies first.', probes: ['When will you arrive?', 'Anything you cannot eat?'] }
    expect(FaxSchema.safeParse(withQuestions([q])).success).toBe(true)
  })

  it('rejects more than 3 follow-ups on a question', () => {
    const q = { id: 'note', label: 'Note', type: 'longtext', probes: ['a', 'b', 'c', 'd'] }
    expect(FaxSchema.safeParse(withQuestions([q])).success).toBe(false)
  })

  it('rejects a hint over 200 characters', () => {
    const q = { id: 'note', label: 'Note', type: 'longtext', hint: 'x'.repeat(201) }
    expect(FaxSchema.safeParse(withQuestions([q])).success).toBe(false)
  })

  it('rejects options on a text question', () => {
    expect(FaxSchema.safeParse(withQuestions([{ id: 'email', label: 'Email', type: 'text', options: ['a'] }])).success).toBe(false)
  })

  it.each(['has space', 'a&b', 'a=b', 'a#b', 'Upper', '1st', ''])('rejects question id %j, which would break the reply fragment', (id) => {
    expect(FaxSchema.safeParse(withQuestions([{ id, label: 'Q', type: 'text' }])).success).toBe(false)
  })

  it.each(['message', 'ack'])('rejects the reserved question id %j', (id) => {
    expect(FaxSchema.safeParse(withQuestions([{ id, label: 'Q', type: 'text' }])).success).toBe(false)
  })

  it('rejects duplicate question ids', () => {
    const q = { id: 'email', label: 'Email', type: 'text' }
    expect(FaxSchema.safeParse(withQuestions([q, q])).success).toBe(false)
  })

  it('rejects more than 20 questions', () => {
    const qs = Array.from({ length: 21 }, (_, i) => ({ id: `q${i}`, label: 'Q', type: 'text' }))
    expect(FaxSchema.safeParse(withQuestions(qs)).success).toBe(false)
  })

  it('requires reply when the fax has questions', () => {
    const { reply: _, ...rest } = lunch
    expect(FaxSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects reply on a fax with no questions and no ack', () => {
    expect(FaxSchema.safeParse({ ...update, ack: false }).success).toBe(false)
  })

  it('requires reply.link to end with #', () => {
    expect(FaxSchema.safeParse({ ...lunch, reply: { ...lunch.reply, link: 'http://localhost:8799/f/lunch' } }).success).toBe(false)
  })
})
