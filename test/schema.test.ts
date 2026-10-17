import { readFileSync, readdirSync } from 'node:fs'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { FaxSchema, faxJsonSchema } from '../src/fax.js'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const published = JSON.parse(read('../spec/fax.schema.json'))
const ajv = new Ajv2020({ allErrors: true, strict: false })
ajv.addFormat('uri', true).addFormat('date-time', true)
const validate = ajv.compile(published)

const examples = readdirSync(new URL('../examples/', import.meta.url)).filter((f) => f.endsWith('.json'))
const specExample = JSON.parse(read('../SPEC.md').split('## 4. JSON view')[1]!.split('```json')[1]!.split('```')[0]!)

describe('published JSON schema', () => {
  it('is in sync with the zod schema (run npm run schema)', () => {
    expect(published).toEqual(faxJsonSchema())
  })

  it.each(examples)('validates examples/%s with both zod and the JSON schema', (file) => {
    const fax = JSON.parse(read(`../examples/${file}`))
    expect(FaxSchema.safeParse(fax).success).toBe(true)
    expect(validate(fax)).toBe(true)
  })

  it('validates the example in SPEC.md', () => {
    expect(FaxSchema.safeParse(specExample).success).toBe(true)
    expect(validate(specExample)).toBe(true)
  })

  it.each([
    ['a choice question without options', { id: 'spot', label: 'Where?', type: 'choice' }],
    ['options on a text question', { id: 'email', label: 'Email', type: 'text', options: ['a'] }],
    ['a question id with a space', { id: 'has space', label: 'Q', type: 'text' }],
  ])('rejects %s in the JSON schema too', (_, question) => {
    expect(validate({ ...specExample, questions: [question] })).toBe(false)
  })
})
