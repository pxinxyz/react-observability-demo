import { useEffect, useState } from 'react'

/**
 * Debounce a rapidly-changing value.
 *
 * Used by the log and span filters: typing in the search box should not
 * re-filter a 400-span buffer on every keystroke.
 */
export function useDebounce<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
