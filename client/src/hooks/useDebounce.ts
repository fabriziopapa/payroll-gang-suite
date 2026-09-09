// ============================================================
// PAYROLL GANG SUITE — useDebounce
// Ritarda l'aggiornamento di un valore di `delayMs` millisecondi.
// Usato per filtrare input testuali senza ricalcoli ad ogni keystroke.
// ============================================================

import { useState, useEffect } from 'react'

/**
 * Restituisce una copia di `value` che si aggiorna solo dopo che `value`
 * non cambia per almeno `delayMs` millisecondi.
 *
 * Il valore originale (non debounced) va usato per aggiornare il campo input
 * visivamente — quello debounced per operazioni costose (filter, search, useMemo).
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
