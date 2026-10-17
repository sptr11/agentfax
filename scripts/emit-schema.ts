import { writeFileSync } from 'node:fs'
import { faxJsonSchema } from '../src/fax.js'

const out = new URL('../spec/fax.schema.json', import.meta.url)
writeFileSync(out, JSON.stringify(faxJsonSchema(), null, 2) + '\n')
console.log(`wrote ${out.pathname}`)
