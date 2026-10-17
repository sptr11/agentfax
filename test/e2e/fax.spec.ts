import { serve, type ServerType } from '@hono/node-server'
import { expect, test } from '@playwright/test'
import type { AddressInfo } from 'node:net'
import { agentfax } from '../../src/server.js'
import { memoryStore } from '../../src/store.js'

let server: ServerType
let base: string

test.beforeAll(async () => {
  await new Promise<void>((resolve) => {
    let app: ReturnType<typeof agentfax>
    server = serve({ fetch: (req) => app.fetch(req), port: 0, hostname: '127.0.0.1' }, (info: AddressInfo) => {
      base = `http://127.0.0.1:${info.port}`
      app = agentfax({ store: memoryStore(), publicUrl: base, senderKey: 'k' })
      resolve()
    })
  })
})

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

async function send(body: object): Promise<{ links: { url: string }[]; inbox: string }> {
  const res = await fetch(`${base}/api/faxes`, { method: 'POST', headers: { authorization: 'Bearer k', 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return res.json()
}

const lunch = {
  from: 'Ops team',
  title: 'Team lunch on Friday',
  note: 'Pick a spot.',
  to: ['Priya'],
  html: '<h2>Friday lunch</h2><table><tr><th>Place</th><th>Walk</th></tr><tr><td>Salad bar</td><td>in the building</td></tr></table>',
  questions: [
    { id: 'spot', label: 'Where should we go?', type: 'choice', options: ['Tacos', 'Ramen', 'Salad bar'], required: true },
    { id: 'note', label: 'Anything we should know?', type: 'longtext' },
  ],
}

test('sender content runs scripts but cannot make network calls', async ({ page }) => {
  const { links } = await send({
    ...lunch,
    html: `<p id="r">waiting</p><script>fetch('${'https://example.com/collect'}').then(()=>{r.textContent='sent'},()=>{r.textContent='blocked'})</script>`,
  })
  const outbound: string[] = []
  page.on('request', (r) => { if (!r.url().startsWith(base)) outbound.push(r.url()) })
  await page.goto(links[0]!.url)
  await expect(page.frameLocator('iframe').locator('#r')).toHaveText('blocked')
  expect(outbound).toEqual([])
})

test('a reply link fills in the answers and sends nothing until Send', async ({ page }) => {
  const { links, inbox } = await send(lunch)
  const posts: string[] = []
  page.on('request', (r) => { if (r.method() !== 'GET') posts.push(r.url()) })
  await page.goto(`${links[0]!.url}#spot=Ramen&note=Vegetarian%20%F0%9F%99%82&evil=1`)
  await expect(page.locator('#prefill-banner')).toBeVisible()
  await expect(page.locator('input[name="spot"][value="Ramen"]')).toBeChecked()
  await expect(page.locator('textarea[name="note"]')).toHaveValue('Vegetarian 🙂')
  expect(page.url()).not.toContain('#')
  await page.waitForTimeout(300)
  expect(posts).toEqual([])

  await page.getByRole('button', { name: 'Send to Ops team' }).click()
  await expect(page.getByText('TRANSMISSION REPORT')).toBeVisible()
  expect(posts).toEqual([`${links[0]!.url}/reply`])
  const replies = (await (await fetch(`${inbox}.json`)).json()).replies
  expect(replies).toEqual([expect.objectContaining({ to: 'Priya', answers: { spot: 'Ramen', note: 'Vegetarian 🙂' } })])
})

test('a reply link opened while the fax is already open still fills in the answers', async ({ page }) => {
  const { links } = await send(lunch)
  await page.goto(links[0]!.url)
  await page.goto(`${links[0]!.url}#spot=Tacos&note=Late`)
  await expect(page.locator('#prefill-banner')).toBeVisible()
  await expect(page.locator('input[name="spot"][value="Tacos"]')).toBeChecked()
  await expect(page.locator('textarea[name="note"]')).toHaveValue('Late')
})

test('the reply box sends a free-text message with the answers', async ({ page }) => {
  const { links, inbox } = await send(lunch)
  await page.goto(links[0]!.url)
  await page.getByRole('radio', { name: 'Ramen' }).check()
  await page.getByLabel('Or type or paste your reply here').fill('Is the broth vegetarian?')
  await page.getByRole('button', { name: 'Send to Ops team' }).click()
  await expect(page.getByText('TRANSMISSION REPORT')).toBeVisible()
  await expect(page.getByText('Is the broth vegetarian?')).toBeVisible()
  expect((await (await fetch(`${inbox}.json`)).json()).replies[0]).toMatchObject({ answers: { spot: 'Ramen' }, message: 'Is the broth vegetarian?' })
})

test('the reply box alone is enough, even when a question is required', async ({ page }) => {
  const { links, inbox } = await send(lunch)
  await page.goto(links[0]!.url)
  await page.getByLabel('Or type or paste your reply here').fill('Ramen please. Vegetarian, there by 12:40.')
  await page.getByRole('button', { name: 'Send to Ops team' }).click()
  await expect(page.getByText('TRANSMISSION REPORT')).toBeVisible()
  expect((await (await fetch(`${inbox}.json`)).json()).replies[0]).toMatchObject({ message: 'Ramen please. Vegetarian, there by 12:40.' })
})

test('a pasted reply that names one option picks that choice', async ({ page }) => {
  const { links } = await send(lunch)
  await page.goto(links[0]!.url)
  await page.getByLabel('Or type or paste your reply here').fill('I’ll be there by 12:40. Please confirm the broth and ramen are vegetarian.')
  await expect(page.getByRole('radio', { name: 'Ramen' })).toBeChecked()
  await expect(page.locator('[data-picked-for="spot"]')).toBeVisible()
})

test('a pasted reply that names several options picks nothing', async ({ page }) => {
  const { links } = await send(lunch)
  await page.goto(links[0]!.url)
  await page.getByLabel('Or type or paste your reply here').fill('Tacos or ramen, either is fine.')
  await expect(page.getByRole('radio', { name: 'Ramen' })).not.toBeChecked()
  await expect(page.getByRole('radio', { name: 'Tacos' })).not.toBeChecked()
})

test('a pasted reply never overrides a choice the person made', async ({ page }) => {
  const { links } = await send(lunch)
  await page.goto(links[0]!.url)
  await page.getByRole('radio', { name: 'Tacos' }).check()
  await page.getByLabel('Or type or paste your reply here').fill('Ramen sounds good too.')
  await expect(page.getByRole('radio', { name: 'Tacos' })).toBeChecked()
})

test('an empty reply asks for an answer or a message, without sending', async ({ page }) => {
  const { links } = await send(lunch)
  const posts: string[] = []
  page.on('request', (r) => { if (r.method() !== 'GET') posts.push(r.url()) })
  await page.goto(links[0]!.url)
  await page.getByRole('button', { name: 'Send to Ops team' }).click()
  await expect(page.locator('#form-note')).toHaveText('Answer “Where should we go?”, or type a reply in the box.')
  expect(posts).toEqual([])
})

test('an information-only fax can be answered with just a message', async ({ page }) => {
  const { links, inbox } = await send({ from: 'Facilities', title: 'Office move', text: 'Monday, 4th floor.', to: ['Sam'] })
  await page.goto(links[0]!.url)
  await page.getByLabel('Or type or paste your reply here').fill('Which lockers are ours?')
  await page.getByRole('button', { name: 'Send to Facilities' }).click()
  await expect(page.getByText('TRANSMISSION REPORT')).toBeVisible()
  expect((await (await fetch(`${inbox}.json`)).json()).replies[0]).toMatchObject({ message: 'Which lockers are ours?' })
})

test('Ask your AI copies a prompt with the fax link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const { links } = await send(lunch)
  await page.goto(links[0]!.url)
  await page.getByRole('button', { name: 'Ask your AI' }).click()
  await expect(page.locator('#ask-note')).toHaveText('Copied. Paste it into your AI.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(links[0]!.url)
})

test('Got it records a read confirmation', async ({ page }) => {
  const { links, inbox } = await send({ from: 'Facilities', title: 'Office move', text: 'Monday, 4th floor.', ack: true, to: ['Sam'] })
  await page.goto(links[0]!.url)
  await page.getByRole('button', { name: 'Got it' }).click()
  await expect(page.getByText('FACILITIES KNOWS YOU READ IT')).toBeVisible()
  expect((await (await fetch(`${inbox}.json`)).json()).replies[0]).toMatchObject({ to: 'Sam', ack: true })
})

test('the sender frame grows and shrinks to fit its content', async ({ page }) => {
  const short = await send({ ...lunch, html: '<p>Short.</p>' })
  await page.goto(short.links[0]!.url)
  await expect.poll(async () => (await page.locator('iframe').boundingBox())!.height).toBeLessThan(200)
  const tall = await send({ ...lunch, html: '<div style="height:1500px">Tall.</div>' })
  await page.goto(tall.links[0]!.url)
  await expect.poll(async () => (await page.locator('iframe').boundingBox())!.height).toBeGreaterThan(1400)
})

for (const width of [375, 1280]) {
  test(`no sideways scrolling at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: width < 600 })
    const page = await context.newPage()
    const { links } = await send({ ...lunch, note: 'A long note without spaces: ' + 'x'.repeat(200) })
    await page.goto(links[0]!.url)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
    await context.close()
  })
}
