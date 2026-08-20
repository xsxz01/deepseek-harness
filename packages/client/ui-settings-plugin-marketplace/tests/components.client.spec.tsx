// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginMarketplaceEntryId, PluginMarketplaceMutationResult, PluginMarketplaceSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { PluginMarketplaceSettingsTab, type PluginMarketplaceSettingsTabInjected, type PluginMarketplaceSettingsTabProps } from '../src/client/PluginMarketplaceSettingsTab.tsx'
import { en, type PluginMarketplaceLocaleKey } from '../src/client/locales.ts'

const id = 'owner/plugin' as PluginMarketplaceEntryId
const t = ((key: PluginMarketplaceLocaleKey): string => en[key]) as PluginMarketplaceSettingsTabProps['t']
const entry = {
  id, source: 'dsh' as const, packageName: 'plugin-package', displayName: 'Plugin package', description: 'A useful plugin',
  repositoryUrl: 'https://github.com/owner/plugin', version: '1.0.0', stars: 12, verified: true, installed: false,
}
const snapshot = (installed = false): PluginMarketplaceSnapshot => ({ source: 'dsh', entries: [{ ...entry, installed }], total: 1, page: 1, pages: 1, restartRequired: false })
const mutation = { packageName: 'plugin-package', installed: true, restartRequired: true as const }
const idleProgress = { status: 'idle' as const, operation: null, stage: 'idle' as const, percent: 0, packageName: null, detail: null }

afterEach(cleanup)

function props(overrides: Partial<PluginMarketplaceSettingsTabInjected> = {}): PluginMarketplaceSettingsTabProps {
  return {
    t,
    list: vi.fn(async () => snapshot()),
    install: vi.fn(async () => mutation),
    remove: vi.fn(async () => ({ ...mutation, installed: false })),
    progress: vi.fn(async () => idleProgress),
    ...overrides,
  } as PluginMarketplaceSettingsTabProps
}

describe('PluginMarketplaceSettingsTab', () => {
  it('lists a source and refreshes installed state after installation', async () => {
    const list = vi.fn<PluginMarketplaceSettingsTabInjected['list']>()
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot(true))
    const install = vi.fn(async () => mutation)
    render(<PluginMarketplaceSettingsTab {...props({ list, install })} />)

    expect(screen.getByText(en.loading)).toBeTruthy()
    expect(await screen.findByText('Plugin package')).toBeTruthy()
    expect(screen.getByText(en.verified)).toBeTruthy()
    expect(screen.getByText('Version 1.0.0')).toBeTruthy()
    expect(screen.getByText('Stars 12')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.install }))

    await waitFor(() => { expect(install).toHaveBeenCalledWith('dsh', id) })
    expect(await screen.findByText(en.restartRequired)).toBeTruthy()
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(screen.getByRole('button', { name: en.remove })).toBeTruthy()
    expect(screen.getByText(en.installed)).toBeTruthy()
  })

  it('switches sources, submits searches, refreshes, and contains mutation errors', async () => {
    const list = vi.fn<PluginMarketplaceSettingsTabInjected['list']>(async source => ({ ...snapshot(true), source, entries: [{ ...entry, source, installed: true, verified: source === 'dsh', version: source === 'dsh' ? entry.version : null }] }))
    const removal = Promise.withResolvers<PluginMarketplaceMutationResult>()
    const remove = vi.fn<PluginMarketplaceSettingsTabInjected['remove']>(() => removal.promise)
    render(<PluginMarketplaceSettingsTab {...props({ list, remove })} />)
    await screen.findByText('Plugin package')

    fireEvent.click(screen.getByRole('button', { name: en.github }))
    await waitFor(() => { expect(list).toHaveBeenCalledWith('github', '', 1) })
    const search = screen.getByRole('searchbox', { name: en.search })
    fireEvent.change(search, { target: { value: '  tools  ' } })
    fireEvent.submit(search.closest('form')!)
    await waitFor(() => { expect(list).toHaveBeenCalledWith('github', 'tools', 1) })
    fireEvent.submit(search.closest('form')!)
    await waitFor(() => { expect(list.mock.calls.filter(call => call[1] === 'tools')).toHaveLength(2) })
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() => { expect(list.mock.calls.length).toBeGreaterThanOrEqual(4) })

    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    expect(await screen.findByRole('button', { name: en.removing })).toBeTruthy()
    removal.reject(new Error('private pnpm output'))
    expect((await screen.findByRole('alert')).textContent).toBe(en.operationError)
    expect(screen.queryByText('private pnpm output')).toBeNull()
  })

  it('retries listing failures into an empty catalog and ignores late settlement after unmount', async () => {
    const list = vi.fn<PluginMarketplaceSettingsTabInjected['list']>()
      .mockRejectedValueOnce(new Error('transport detail'))
      .mockResolvedValueOnce({ source: 'dsh', entries: [], total: 0, page: 1, pages: 1, restartRequired: false })
    const view = render(<PluginMarketplaceSettingsTab {...props({ list })} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByText(en.empty)).toBeTruthy()
    view.unmount()

    const deferred = Promise.withResolvers<PluginMarketplaceSnapshot>()
    const pending = render(<PluginMarketplaceSettingsTab {...props({ list: () => deferred.promise })} />)
    pending.unmount()
    await act(async () => { deferred.resolve(snapshot()) })
    const rejected = Promise.withResolvers<PluginMarketplaceSnapshot>()
    const rejectedView = render(<PluginMarketplaceSettingsTab {...props({ list: () => rejected.promise })} />)
    rejectedView.unmount()
    await act(async () => { rejected.reject(new Error('late')) })

    const sync = render(<PluginMarketplaceSettingsTab {...props({ list: () => { throw new Error('sync') } })} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.error)
    sync.unmount()
  })

  it('paginates through the catalog and disables paging while busy', async () => {
    const list = vi.fn<PluginMarketplaceSettingsTabInjected['list']>()
      .mockResolvedValueOnce({ ...snapshot(), page: 1, pages: 3 })
      .mockResolvedValueOnce({ ...snapshot(), page: 2, pages: 3 })
      .mockResolvedValueOnce({ ...snapshot(), page: 1, pages: 3 })
    render(<PluginMarketplaceSettingsTab {...props({ list })} />)
    await screen.findByText('Plugin package')

    const previous = screen.getByRole('button', { name: en.previousPage })
    const next = screen.getByRole('button', { name: en.nextPage })
    expect((previous as HTMLButtonElement).disabled).toBe(true)
    expect((next as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByText(en.page + ' 1 / 3')).toBeTruthy()

    fireEvent.click(next)
    await waitFor(() => { expect(list).toHaveBeenLastCalledWith('dsh', '', 2) })
    expect(screen.getByText(en.page + ' 2 / 3')).toBeTruthy()

    const back = screen.getByRole('button', { name: en.previousPage })
    fireEvent.click(back)
    await waitFor(() => { expect(list).toHaveBeenLastCalledWith('dsh', '', 1) })
    expect((screen.getByRole('button', { name: en.previousPage }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders the live mutation progress bar and hides it once idle', async () => {
    const progress = vi.fn<PluginMarketplaceSettingsTabInjected['progress']>()
      .mockResolvedValueOnce({ status: 'running', operation: 'install', stage: 'install', percent: 55, packageName: 'plugin-package', detail: 'Progress: added 5' })
    const install = vi.fn<PluginMarketplaceSettingsTabInjected['install']>()
    const deferred = Promise.withResolvers<PluginMarketplaceMutationResult>()
    install.mockReturnValue(deferred.promise)
    render(<PluginMarketplaceSettingsTab {...props({ progress, install })} />)
    await screen.findByText('Plugin package')

    fireEvent.click(screen.getByRole('button', { name: en.install }))
    const status = await screen.findByRole('status', { name: en.progress })
    expect(within(status).getByText(en.installing + ' 55%')).toBeTruthy()
    expect(within(status).getByText('plugin-package')).toBeTruthy()
    expect(within(status).getByText('Progress: added 5')).toBeTruthy()
    expect((screen.getByRole('button', { name: en.installing }) as HTMLButtonElement).disabled).toBe(true)

    await act(async () => { deferred.resolve(mutation) })
    await waitFor(() => { expect(screen.queryByRole('status', { name: en.progress })).toBeNull() })
    expect(screen.getByText(en.restartRequired)).toBeTruthy()
  })
})
