import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAccount } from '../lib/account'

interface Props {
  open: boolean
  onClose: () => void
}

type Tab = 'signin' | 'register'

export function AccountDialog({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const account = useAccount()
  const [tab, setTab] = useState<Tab>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      setPassword('')
      setError('')
      setConfirmDelete(false)
      setDeletePassword('')
      d.showModal()
    } else if (!open && d.open) d.close()
  }, [open])

  const run = async (fn: () => Promise<void>, closeAfter = true) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      setPassword('')
      if (closeAfter) onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    run(() => (tab === 'signin' ? account.signIn(username, password) : account.register(username, password)))
  }

  const signedIn = account.status === 'signed-in' && account.user
  const deviceCount = account.favorites.length + account.recent.length

  return (
    <dialog ref={ref} className="settings account" onClose={onClose}>
      {signedIn ? (
        <div className="account-body">
          <h2>Your account</h2>
          <div className="account-id">
            <span className="avatar" aria-hidden>
              {account.user!.username[0].toUpperCase()}
            </span>
            <div>
              <strong>{account.user!.username}</strong>
              <small className="muted">
                {account.favorites.length} favourite{account.favorites.length === 1 ? '' : 's'} ·{' '}
                {account.recent.length} recently watched
              </small>
            </div>
          </div>
          <p className={`muted small sync ${account.sync}`} role="status">
            {account.sync === 'error'
              ? account.syncError
              : account.sync === 'saving'
                ? 'Saving…'
                : 'Your favourites and recently watched channels are saved to this account, so they follow you to any browser you sign in on.'}
          </p>

          {confirmDelete ? (
            <form
              className="field danger-zone"
              onSubmit={e => {
                e.preventDefault()
                run(() => account.deleteAccount(deletePassword))
              }}
            >
              <span>Delete account</span>
              <small className="muted">
                This permanently deletes the account and its saved channels. Enter your password to confirm.
              </small>
              <input
                id="delete-password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={deletePassword}
                onChange={e => setDeletePassword(e.target.value)}
                required
              />
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="actions">
                <button type="button" className="btn ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Keep account
                </button>
                <button type="submit" className="btn danger" disabled={busy || !deletePassword}>
                  {busy ? 'Deleting…' : 'Delete account'}
                </button>
              </div>
            </form>
          ) : (
            <>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="actions spread">
                <button type="button" className="link danger-link" onClick={() => setConfirmDelete(true)}>
                  Delete account…
                </button>
                <span className="actions">
                  <button type="button" className="btn ghost" onClick={onClose}>
                    Close
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => run(account.signOut)}>
                    {busy ? 'Signing out…' : 'Sign out'}
                  </button>
                </span>
              </div>
            </>
          )}
        </div>
      ) : (
        <form onSubmit={submit}>
          <h2>{tab === 'signin' ? 'Sign in' : 'Create an account'}</h2>
          <nav className="tabs account-tabs" aria-label="Account">
            <button type="button" className={`tab ${tab === 'signin' ? 'active' : ''}`} onClick={() => setTab('signin')}>
              Sign in
            </button>
            <button
              type="button"
              className={`tab ${tab === 'register' ? 'active' : ''}`}
              onClick={() => setTab('register')}
            >
              Create account
            </button>
          </nav>

          <label className="field">
            <span>Username</span>
            <input
              id="account-username"
              className="input"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
            />
            {tab === 'register' && (
              <small className="muted">3–32 characters: letters, numbers, dots, dashes or underscores.</small>
            )}
          </label>
          <label className="field">
            <span>Password</span>
            <input
              id="account-password"
              className="input"
              type="password"
              autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
              minLength={tab === 'register' ? 8 : undefined}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            {tab === 'register' && <small className="muted">At least 8 characters.</small>}
          </label>

          {deviceCount > 0 && (
            <p className="muted small">
              The {account.favorites.length} favourite{account.favorites.length === 1 ? '' : 's'} and{' '}
              {account.recent.length} recently watched channel{account.recent.length === 1 ? '' : 's'} in this browser
              will be added to your account.
            </p>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'One moment…' : tab === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}

/** The account button in the top bar. */
export function AccountButton({ onClick }: { onClick: () => void }) {
  const { status, user, sync } = useAccount()
  if (status === 'loading') return <span className="account-btn placeholder" aria-hidden />
  return (
    <button
      className={`btn ghost account-btn ${sync === 'error' ? 'has-error' : ''}`}
      onClick={onClick}
      aria-label={user ? `Account: ${user.username}` : 'Sign in'}
    >
      {user ? (
        <>
          <span className="avatar small" aria-hidden>
            {user.username[0].toUpperCase()}
          </span>
          <span className="settings-label">{user.username}</span>
        </>
      ) : (
        <>
          <span aria-hidden>👤</span>
          <span className="settings-label">Sign in</span>
        </>
      )}
    </button>
  )
}
