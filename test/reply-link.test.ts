import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildReplyLink, parseReplyFragment } from '../src/reply-link.js'
import { lunch } from './helpers.js'

// Reply links that claude.ai and ChatGPT actually produced in the receiver tests.
const captured: { assistant: string; fragment: string; expected: Record<string, string> }[] =
  JSON.parse(readFileSync(new URL('./fixtures/receiver-test-reply-links.json', import.meta.url), 'utf8'))

describe('parseReplyFragment', () => {
  it.each(captured.map((c) => [c.assistant, c] as const))('parses the link from %s', (_, c) => {
    expect(parseReplyFragment(c.fragment, lunch.questions)).toEqual(c.expected)
  })

  it('accepts a leading #', () => {
    expect(parseReplyFragment('#spot=Ramen', lunch.questions)).toEqual({ spot: 'Ramen' })
  })

  it('keeps %2B as a literal plus and never turns + into a space', () => {
    expect(parseReplyFragment('email=a%2Bb%40x.example&note=1+1', lunch.questions)).toEqual({ email: 'a+b@x.example', note: '1+1' })
  })

  it('drops keys that are not questions on the fax', () => {
    expect(parseReplyFragment('spot=Ramen&evil=1', lunch.questions)).toEqual({ spot: 'Ramen' })
  })

  it('skips a pair that fails to decode', () => {
    expect(parseReplyFragment('spot=Ramen&note=%E0%A4%A', lunch.questions)).toEqual({ spot: 'Ramen' })
  })

  it('keeps the last value when a key repeats', () => {
    expect(parseReplyFragment('spot=Tacos&spot=Ramen', lunch.questions)).toEqual({ spot: 'Ramen' })
  })
})

describe('buildReplyLink', () => {
  it('builds a link that parses back to the same answers', () => {
    const answers = { spot: 'Ramen', email: 'sumit+lunch@example.com', note: 'I’m vegetarian; 10 min late 🙂' }
    const link = buildReplyLink('http://localhost:8799/f/lunch', lunch.questions, answers)
    expect(link.startsWith('http://localhost:8799/f/lunch#spot=Ramen&')).toBe(true)
    expect(parseReplyFragment(link.split('#')[1]!, lunch.questions)).toEqual(answers)
  })

  it('reproduces the exact link claude.ai built', () => {
    const c = captured[0]!
    expect(buildReplyLink('http://localhost:8799/f/lunch', lunch.questions, c.expected)).toBe(`http://localhost:8799/f/lunch#${c.fragment}`)
  })

  it('leaves out unanswered questions', () => {
    expect(buildReplyLink('http://x.example/f/a', lunch.questions, { spot: 'Tacos' })).toBe('http://x.example/f/a#spot=Tacos')
  })
})
