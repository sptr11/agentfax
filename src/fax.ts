import { z } from 'zod'

// Question ids go straight into the reply fragment (#id=value), so they must never need encoding.
// `message` and `ack` are reserved: every reply can carry a free-text message, and ack is the read confirmation.
const QuestionId = z.string().regex(/^(?!(message|ack)$)[a-z][a-z0-9_]{0,39}$/, 'lowercase letters, digits and _, starting with a letter, max 40; not message or ack')

const base = {
  id: QuestionId,
  label: z.string().min(1).max(200),
  required: z.boolean().optional(),
  // Shown to people under the question and to agents in the agent section.
  hint: z.string().min(1).max(200).optional(),
  // Follow-ups the sender wants the answer to cover.
  probes: z.array(z.string().min(1).max(150)).min(1).max(3).optional(),
}

const FreeQuestion = z.strictObject({ ...base, type: z.enum(['text', 'longtext', 'number']) })
const ChoiceQuestion = z.strictObject({
  ...base,
  type: z.literal('choice'),
  options: z.array(z.string().min(1).max(100)).min(1).max(20),
})

export const QuestionSchema = z.discriminatedUnion('type', [FreeQuestion, ChoiceQuestion])

export const FaxSchema = z
  .object({
    agentfax: z.literal('0.1'),
    title: z.string().min(1).max(200),
    from: z.object({ name: z.string().min(1).max(100), origin: z.url() }),
    to: z.string().max(100).optional(),
    note: z.string().max(2000).optional(),
    content: z.object({ text: z.string(), view: z.url().optional() }),
    questions: z.array(QuestionSchema).max(20),
    ack: z.boolean().optional(),
    reply: z.object({ link: z.url().endsWith('#'), format: z.string() }).optional(),
    expires: z.iso.datetime().optional(),
    about: z.url(),
  })
  // Cross-field rules. JSON Schema can't express these, so SPEC.md states them as rules.
  .superRefine((fax, ctx) => {
    const ids = fax.questions.map((q) => q.id)
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['questions'], message: 'question ids must be unique' })
    const expectsReply = fax.questions.length > 0 || fax.ack === true
    if (expectsReply && !fax.reply) ctx.addIssue({ code: 'custom', path: ['reply'], message: 'reply is required when the fax has questions or ack' })
    if (!expectsReply && fax.reply) ctx.addIssue({ code: 'custom', path: ['reply'], message: 'reply is only allowed when the fax has questions or ack' })
  })

export type Question = z.infer<typeof QuestionSchema>
export type Fax = z.infer<typeof FaxSchema>

export const faxJsonSchema = () => ({
  $id: 'https://github.com/sptr11/agentfax/blob/main/spec/fax.schema.json',
  title: 'AgentFax 0.1',
  ...z.toJSONSchema(FaxSchema, { target: 'draft-2020-12', io: 'input' }),
})
