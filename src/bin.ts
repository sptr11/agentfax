#!/usr/bin/env node
import { run } from './cli.js'

const code = await run(process.argv.slice(2), {
  env: process.env,
  stdout: (s) => console.log(s),
  stderr: (s) => console.error(s),
  fetch: (url, init) => fetch(url, init),
})
if (typeof code === 'number') process.exit(code)
