import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type {
  PluginMarketplaceEntry,
  PluginMarketplaceEntryId,
  PluginMarketplaceMutationResult,
  PluginMarketplaceProgress,
  PluginMarketplaceSnapshot,
  PluginMarketplaceSource,
} from '@deepseek-ai/dsh-api-remotes/client'
import { IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PluginMarketplaceSettingsTab.module.css'

/** Registration-side Remote callbacks used by the marketplace. */
export interface PluginMarketplaceSettingsTabInjected {
  list: (source: PluginMarketplaceSource, query: string, page?: number) => Promise<PluginMarketplaceSnapshot>
  install: (source: PluginMarketplaceSource, id: PluginMarketplaceEntryId) => Promise<PluginMarketplaceMutationResult>
  remove: (source: PluginMarketplaceSource, id: PluginMarketplaceEntryId) => Promise<PluginMarketplaceMutationResult>
  progress: () => Promise<PluginMarketplaceProgress>
}

export type PluginMarketplaceSettingsTabProps = PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginMarketplace'> & InjectFace<PluginMarketplaceSettingsTabInjected>

type ViewState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; snapshot: PluginMarketplaceSnapshot }
interface BusyState { id: PluginMarketplaceEntryId; operation: 'install' | 'remove' }

const idleProgress: PluginMarketplaceProgress = {
  status: 'idle', operation: null, stage: 'idle', percent: 0, packageName: null, detail: null,
}

const SOURCES: readonly PluginMarketplaceSource[] = ['dsh', 'github', 'dshplugin', 'dshmarket', 'dsh404']

/** Search and mutate Host-validated marketplace entries with paging and live progress. */
export function PluginMarketplaceSettingsTab({ install, list, progress, remove, t }: PluginMarketplaceSettingsTabProps): ReactNode {
  const [source, setSource] = useState<PluginMarketplaceSource>('dsh')
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [busy, setBusy] = useState<BusyState | null>(null)
  const [mutation, setMutation] = useState<PluginMarketplaceProgress>(idleProgress)
  const [notice, setNotice] = useState<'restart' | 'error' | null>(null)

  useEffect(() => {
    let current = true
    setState({ status: 'loading' })
    void Promise.resolve().then(() => list(source, query, page)).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [list, query, request, source, page])

  useEffect(() => {
    if (busy === null) return
    let current = true
    const timer = window.setInterval(() => {
      void progress().then((value) => { if (current) setMutation(value) }, () => {})
    }, 400)
    return () => { current = false; window.clearInterval(timer) }
  }, [busy, progress])

  const reload = (): void => { setRequest(value => value + 1) }
  const selectSource = (next: PluginMarketplaceSource): void => {
    setSource(next); setDraft(''); setQuery(''); setPage(1); setNotice(null)
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const next = draft.trim()
    setPage(1)
    setQuery(next)
    if (next === query) reload()
  }
  const mutate = async (entry: PluginMarketplaceEntry): Promise<void> => {
    const operation = entry.installed ? 'remove' : 'install'
    setBusy({ id: entry.id, operation }); setNotice(null)
    try {
      await (entry.installed ? remove(entry.source, entry.id) : install(entry.source, entry.id))
      setNotice('restart'); reload()
    } catch {
      setNotice('error')
    } finally {
      setBusy(null); setMutation(idleProgress)
    }
  }

  const snapshot = state.status === 'ready' ? state.snapshot : null

  return <div className={css.section} aria-busy={state.status === 'loading'}>
    <div className={css.toolbar}>
      <div className={css.sourceGroup} role="group" aria-label={t('source')}>
        {SOURCES.map(value => <button key={value} type="button" aria-pressed={source === value} onClick={() => { selectSource(value) }}>{t(value)}</button>)}
      </div>
      <form className={css.search} onSubmit={submit}>
        <IconSearchOutline16 aria-hidden="true" />
        <input type="search" value={draft} placeholder={t('search')} aria-label={t('search')} onChange={(event) => { setDraft(event.currentTarget.value) }} />
        <button type="submit">{t('submitSearch')}</button>
      </form>
      <button className={css.refresh} type="button" onClick={reload}>{t('refresh')}</button>
    </div>
    {notice === 'restart' ? <p className={css.notice} role="status">{t('restartRequired')}</p> : null}
    {notice === 'error' ? <p className={css.operationError} role="alert">{t('operationError')}</p> : null}
    {mutation.status === 'running' ? <div className={css.progress} role="status" aria-label={t('progress')}>
      <div className={css.progressTrack}><div className={css.progressFill} style={{ width: `${mutation.percent}%` }} /></div>
      <p>{t(mutation.stage === 'install' ? 'installing' : mutation.stage)} {mutation.percent}%</p>
      {mutation.packageName === null ? null : <code>{mutation.packageName}</code>}
      {mutation.detail === null ? null : <p className={css.progressDetail}>{mutation.detail}</p>}
    </div> : null}
    {state.status === 'loading' ? <p className={css.status}>{t('loading')}</p> : null}
    {state.status === 'error' ? <div className={css.failure}><p role="alert">{t('error')}</p><button type="button" onClick={reload}>{t('retry')}</button></div> : null}
    {snapshot !== null ? <div className={css.catalog}>
      <div className={css.heading}><h3>{t('results')}</h3><span>{snapshot.entries.length} / {snapshot.total}</span></div>
      {snapshot.entries.length === 0 ? <p className={css.status}>{t('empty')}</p> : <ul className={css.cards}>
        {snapshot.entries.map((entry) => {
          const pending = busy?.id === entry.id
          const pendingOperation = busy !== null && busy.id === entry.id ? busy.operation : undefined
          return <li className={css.card} key={entry.source + ':' + entry.id}>
            <div className={css.cardHeader}>
              <div className={css.identity}><strong>{entry.displayName}</strong><code>{entry.packageName}</code></div>
              <button className={entry.installed ? css.remove : css.install} type="button" disabled={busy !== null} onClick={() => { void mutate(entry) }}>
                {pending ? t(pendingOperation === 'install' ? 'installing' : 'removing') : t(entry.installed ? 'remove' : 'install')}
              </button>
            </div>
            <p className={css.description}>{entry.description}</p>
            <div className={css.meta}>
              {entry.installed ? <span data-kind="installed">{t('installed')}</span> : null}
              {entry.verified ? <span data-kind="verified">{t('verified')}</span> : null}
              {entry.version === null ? null : <span>{t('version')} {entry.version}</span>}
              <span>{t('stars')} {entry.stars}</span>
              <a href={entry.repositoryUrl} target="_blank" rel="noreferrer">{entry.id}</a>
            </div>
          </li>
        })}
      </ul>}
      <div className={css.pagination}>
        <button type="button" disabled={snapshot.page <= 1 || busy !== null} onClick={() => { setPage(value => Math.max(1, value - 1)) }}>{t('previousPage')}</button>
        <span>{t('page')} {snapshot.page} / {snapshot.pages}</span>
        <button type="button" disabled={snapshot.page >= snapshot.pages || busy !== null} onClick={() => { setPage(value => value + 1) }}>{t('nextPage')}</button>
      </div>
    </div> : null}
  </div>
}
