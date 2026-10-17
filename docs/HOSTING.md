# Hosting AgentFax

A fax is a link. The person you send it to, and their AI assistant, have to be able to open it. That means your fax server needs:

1. **A public address.** `localhost` and home-network addresses only work on your machine.
2. **Nothing in front that blocks AI assistants.** Some CDNs and tunnels block ChatGPT or Claude by default. Your faxes would load for people and fail for their agents.
3. **An address that stays up** for as long as your faxes should work. The default is 30 days.

There are two ways to get there: run it on your own computer and open it to the outside, or put it on something you already have on the web.

## Option 1: Your own computer, reachable from outside

Good for trying AgentFax, demos, and short-lived faxes. Links work while your computer is on and the server is running.

Start the server with a public tunnel:

```bash
npx agentfax serve --tunnel
# → Fax server running at https://3f9a2c.lhr.life
```

That's the whole setup. `--tunnel` uses [localhost.run](https://localhost.run), a free SSH tunnel with no account. In our tests it was the only free tunnel that both ChatGPT and Claude could read through.

To run the tunnel yourself instead:

```bash
npx agentfax serve
ssh -R 80:localhost:8787 nokey@localhost.run
```

Then tell AgentFax its public address, so fax links use it:

```bash
AGENTFAX_PUBLIC_URL=https://3f9a2c.lhr.life npx agentfax serve
```

**Keep in mind:**

- The free address changes every time the tunnel restarts. Faxes sent before a restart stop working.
- When your computer sleeps, your faxes are unreachable.
- For anything people rely on, use option 2.

## Option 2: Something you already have on the web

### An app you already run

If you have a Hono app deployed, mount AgentFax in it. Faxes then live on your existing domain, with nothing new to host.

```ts
import { Hono } from 'hono'
import { agentfax } from 'agentfax/hono'
import { sqliteStore } from 'agentfax/sqlite'

const app = new Hono()
app.route('/', agentfax({ store: sqliteStore('fax.db') }))
```

Set `AGENTFAX_PUBLIC_URL` to your app's public address, for example `https://yourapp.com`.

Two things to check when you embed it:

- **Mount it at the root.** Fax pages use paths like `/f/…` and `/i/…`, so mounting under a sub-path breaks them.
- **Your app's `robots.txt` wins.** If your app already serves one, or a catch-all route answers first, AgentFax's doesn't load. Make sure yours doesn't disallow AI assistants, or their agents get "this site blocks automated access."

### A server or Node host

Any machine that runs Node 22 or newer works: a VPS, a home server, Fly.io, Render or Railway. AgentFax stores everything in one SQLite file, so give it a disk that survives restarts.

```bash
AGENTFAX_PUBLIC_URL=https://fax.yourcompany.com npx agentfax serve --port 8787 --db /data/fax.db
```

### Your own domain

Faxes show the address they came from, so `fax.yourcompany.com` reads as more trustworthy than a random hostname.

1. **Point a subdomain at your server.** At your DNS provider, add an `A` record for `fax` with your server's IP address.
2. **Add HTTPS.** The simplest way is [Caddy](https://caddyserver.com) in front of AgentFax. It gets and renews the certificate on its own. Your whole Caddy config:

   ```
   fax.yourcompany.com {
       reverse_proxy localhost:8787
   }
   ```

3. **Set the public address** so fax links use your domain:

   ```bash
   AGENTFAX_PUBLIC_URL=https://fax.yourcompany.com
   ```

## What blocks AI assistants

These are what we found while testing. Check them before you share links.

| Setup | What happens | Fix |
|---|---|---|
| Domain proxied through Cloudflare | AI bot blocking and a managed `robots.txt` can stop ChatGPT and Claude | In Cloudflare, allow AI agents (the "Agent" policy) for your fax subdomain, or set its DNS record to "DNS only" |
| Cloudflare `workers.dev` addresses | ChatGPT gets `403 Forbidden` before your code runs, with no setting to change | Use a different host |
| Cloudflare quick tunnels (`trycloudflare.com`) | A managed `robots.txt` blocks Claude, ChatGPT and other assistants | Use localhost.run |
| ngrok free plan | A warning page is shown to Claude and to browsers | Use localhost.run, or a paid ngrok plan |

## Check your setup

From any terminal:

```bash
curl -A "Claude-User/1.0" https://fax.yourcompany.com/robots.txt
```

You should see AgentFax's own two lines:

```
User-agent: *
Allow: /
```

A long list with `Disallow` under `Claude-User` or `ChatGPT-User` means something in front of your server is blocking assistants.

Then do the real test. Send yourself a fax, and ask ChatGPT and Claude: *"Read <your fax link> and tell me its title."* If both can, you're set.

Search engines still won't index your faxes, because every fax page sends `X-Robots-Tag: noindex`.
