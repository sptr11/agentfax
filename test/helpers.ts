import type { Fax } from '../src/fax.js'

// The two faxes served during the receiver tests, as JSON-view faxes.
export const lunch: Fax = {
  agentfax: '0.1',
  title: 'Team lunch on Friday',
  from: { name: 'AgentFax test', origin: 'http://localhost:8799' },
  note: 'We are booking lunch for Friday at 12:30. Pick a spot and tell us anything we should know.',
  content: { text: 'Friday team lunch, 12:30.\nOptions: Tacos (5 min walk), Ramen (10 min walk), Salad bar (in the building).' },
  questions: [
    { id: 'spot', label: 'Where should we go?', type: 'choice', options: ['Tacos', 'Ramen', 'Salad bar'], required: true },
    { id: 'email', label: 'Email for the booking confirmation', type: 'text' },
    { id: 'note', label: 'Anything we should know? (diet, timing)', type: 'longtext' },
  ],
  reply: { link: 'http://localhost:8799/f/lunch#', format: 'id=value pairs, URL-encoded, joined with &' },
  about: 'https://github.com/sptr11/agentfax/blob/main/SPEC.md',
}

export const update: Fax = {
  agentfax: '0.1',
  title: 'Office move: what changes on Monday',
  from: { name: 'AgentFax test', origin: 'http://localhost:8799' },
  note: 'Nothing needed from you. Read when you have a minute.',
  content: { text: 'From Monday we work from the 4th floor.\nBadges are reissued at the front desk from 8:30.\nDesks are unassigned; lockers are on the east wall.\nParking is unchanged.' },
  questions: [],
  ack: true,
  reply: { link: 'http://localhost:8799/f/update#', format: 'id=value pairs, URL-encoded, joined with &' },
  about: 'https://github.com/sptr11/agentfax/blob/main/SPEC.md',
}
