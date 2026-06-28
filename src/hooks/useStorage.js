import { useState, useCallback } from 'react'

/**
 * useState that persists to localStorage.
 * Value is JSON-serialized on write and deserialized on read.
 */
export function useStorage(key, defaultValue) {
  const [value, setValueState] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw !== null ? JSON.parse(raw) : defaultValue
    } catch {
      return defaultValue
    }
  })

  const setValue = useCallback((newValue) => {
    setValueState((prev) => {
      const next = typeof newValue === 'function' ? newValue(prev) : newValue
      try {
        if (next === null || next === undefined) {
          localStorage.removeItem(key)
        } else {
          localStorage.setItem(key, JSON.stringify(next))
        }
      } catch (err) {
        console.error('useStorage write error:', err)
      }
      return next
    })
  }, [key])

  return [value, setValue]
}
