// After a deploy, a tab opened earlier still asks for the old build's files, which no longer exist ("Failed to fetch
// dynamically imported module"). Reloading picks up the new build. Guarded so a real outage can't cause a reload loop.

const KEY = 'pnx-stale-reload'

export function isStaleBuildError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg)
}

/** Reload once for a stale build; returns false (so the caller shows the error) if we already tried in the last minute. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false // no storage: don't risk a loop
  }
  window.location.reload()
  return true
}

/** Vite fires this when a lazily loaded page's files are missing. */
export function listenForStaleBuild() {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault()
  })
}
