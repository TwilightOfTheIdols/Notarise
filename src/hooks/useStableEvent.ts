import { useCallback, useRef } from 'react'

export function useStableEvent<T extends (...args: any[]) => unknown>(handler: T): T {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  return useCallback(((...args: Parameters<T>) => handlerRef.current(...args)) as T, [])
}
