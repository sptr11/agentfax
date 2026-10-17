import { describe, expect, it } from 'vitest'
import { CLIENT_JS } from '../src/client.js'

describe('CLIENT_JS', () => {
  // It lives in a template string, where backslashes are easy to lose.
  it('is valid JavaScript', () => {
    expect(() => new Function(CLIENT_JS)).not.toThrow()
  })

})
