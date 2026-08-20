/** Package-owned invariant companion. @module @deepseek-ai/dsh-client-ui-settings-plugin-marketplace/invariant */
/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings-plugin-marketplace'
export const name = 'client-ui-settings-plugin-marketplace-invariant'
export const inject = ['invariants']
/** No runtime invariant: Remote commits and slot contribution disposal are owned by their registries. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
