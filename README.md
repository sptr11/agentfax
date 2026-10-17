<h1 align="center">AgentFax</h1>

<p align="center"><strong>The fax machine, rebuilt for agents.</strong></p>

<p align="center">Send a page from your agent. People read it. Their agents read it too.<br>When you ask something, replies come back with one click.</p>

<p align="center"><a href="SPEC.md">Read the spec</a> · <a href="#use-cases">Use cases</a> · <a href="#quickstart">Quickstart</a></p>

---

Your agent just finished something: a report, a proposal, a form someone needs to fill in. Now it has to reach a person who isn't in your chat, doesn't use your tools, and may have their own agent.

AgentFax turns it into a link. The person opens a clean page. Their agent opens the same link and knows exactly what it's looking at. If the page asks something, their agent drafts the answers and the person sends them back with one click.

## Not MCP. Not A2A.

MCP connects an agent to tools. A2A connects an agent to another agent. Both are software talking to software, with servers on each end.

AgentFax connects **people**, through whatever agents they happen to have. A person reads it. A person decides what goes back.

| | MCP | A2A | AgentFax |
|---|---|---|---|
| **Connects** | an agent to tools | an agent to an agent | a person to a person |
| **Who reads it** | the agent | the agent | a person, plus their agent if they want |
| **The other side needs** | an MCP client | an A2A server | a link |
| **Who sends the reply** | the agent | the agent | the person, with one click |

They work together. Your agent can use MCP tools to build a report, then fax it to the person who needs it.

## Use cases

| | You send | They get |
|---|---|---|
| **Share a report** | Your agent's analysis, charts included | A page they can read on their phone. Their agent can summarize it. |
| **Weekly update** | A status page for a client or another team | One link instead of a long email. "Got it" tells you they read it. |
| **Collect details** | Onboarding questions for a vendor or customer | Their agent fills in what it already knows. They check it and send. |
| **Get an approval** | "Approve the Q3 budget?" with the numbers | A yes or no, plus a comment, in under a minute. |
| **Hand off work** | An incident summary for the next shift | Context, open questions, and a way to answer them. |
| **Pick a time** | A few slots for a call | One tap on a choice, or their agent checks their calendar and drafts it. |

## How it works

**1. Send.** Your agent publishes a page. Each person gets their own link.

```bash
npx agentfax send report.html --to priya --ask "Approve the Q3 numbers?"
```

**2. Read.** Priya opens the link. If she wants help, she taps **Ask your AI** and pastes it into the assistant she already uses. Same link, nothing to install.

**3. Reply.** Her agent drafts the answer and hands her a reply link:

```
https://fax.example.com/f/k3J9xQ#approve=yes&comment=Ship%20it
```

She opens it, sees the answer filled in, and clicks **Send**. The answer never leaves her side before that click.

Not every fax asks something. Many are just information: a report, an update, a heads-up. Those stop at step 2.

## Why AgentFax

- **One link for people and agents.** Every page includes a short section written for AI assistants. No special agent URL, no SDK, no plugin.
- **Agents draft, people send.** An agent can fill in every answer. Only a person can send it.
- **No accounts.** The link is the permission, like "anyone with the link" in Google Docs. Each recipient gets their own, so you know who replied.
- **The sender's page can't snoop.** Sender content runs in a sandbox with no network access. It can show anything and send nothing.
- **Self-hosted and open.** Run it on your own server. It's an open spec, so faxes from any compliant server work with any agent.

## Why a fax?

Faxes got one thing right: a document arrives, a person reads it, an answer goes back. Everything else about them was terrible. We kept the one thing.

## Quickstart

Available with the first release.

Run a fax server, with SQLite and nothing else to set up:

```bash
npx agentfax serve
```

Send a fax:

```bash
npx agentfax send report.html --to priya --ask "Approve the Q3 numbers?"
# → http://localhost:8787/f/k3J9xQ   send this to Priya
# → http://localhost:8787/i/Zp81wL   your inbox, keep it private
```

Or add it to a Hono app:

```ts
import { Hono } from 'hono'
import { agentfax } from 'agentfax/hono'
import { sqliteStore } from 'agentfax/sqlite'

const app = new Hono()
app.route('/', agentfax({ store: sqliteStore('fax.db') }))
```

## The spec

AgentFax is a small open spec: one page, two rules, six routes. Read it in five minutes: [SPEC.md](SPEC.md).

## Contributing

The spec is the best place to start. If something is unclear, wrong, or missing a case you've hit, [open an issue](../../issues).

## License

Announced with the first release.
