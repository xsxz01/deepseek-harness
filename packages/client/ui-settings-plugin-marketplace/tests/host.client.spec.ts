import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, name } from '../src/index.ts'

describe('ui-settings-plugin-marketplace Host face', () => {
  it('remains an inert client bundle carrier', () => {
    expect(name).toBe('client-ui-settings-plugin-marketplace')
    apply(new Context())
  })
})
