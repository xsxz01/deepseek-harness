import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as MarketplaceInvariant from '../src/invariant.ts'

describe('plugin-marketplace invariant companion', () => {
  it('registers and disposes the package-owned empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(MarketplaceInvariant)
    await expect(fiber.await()).resolves.toBeDefined()
    await fiber.dispose()
    await expect(ctx.plugin(MarketplaceInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
})
