import { useState, useEffect, type DependencyList } from 'react'

/**
 * Runs `fetcher` on mount (and when `deps` change), managing isLoading + loadError state.
 * Cancels stale responses on cleanup.
 */
export function usePageLoad(
  fetcher: () => Promise<void>,
  deps: DependencyList,
  errorMessage = 'Impossibile caricare i dati. Controlla la connessione e riprova.',
): { isLoading: boolean; loadError: string | null } {
  const [isLoading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    fetcher()
      .catch(() => { if (!cancelled) setLoadError(errorMessage) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { isLoading, loadError }
}
