import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { memoryStore } from '../src/store.js'
import { sqliteStore } from '../src/sqlite.js'
import { storeContract } from './store.contract.js'

storeContract('memory', () => memoryStore())
storeContract('sqlite', () => sqliteStore(join(mkdtempSync(join(tmpdir(), 'agentfax-')), 'fax.db')))
