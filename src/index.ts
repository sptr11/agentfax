// The fax format and helpers. The server lives at 'agentfax/hono', the SQLite store at 'agentfax/sqlite'.
export { FaxSchema, QuestionSchema, faxJsonSchema, type Fax, type Question } from './fax.js'
export { renderAgentSection } from './agent-section.js'
export { buildReplyLink, parseReplyFragment, type Answers } from './reply-link.js'
export { htmlToText } from './html-to-text.js'
export { memoryStore, type Store, type FaxRecord, type LinkRecord, type ReplyRecord, type StoredFax } from './store.js'
