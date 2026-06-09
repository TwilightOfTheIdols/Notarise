import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

export function useWorkspaceSize(ref: RefObject<HTMLElement | null>) {
  const [workspaceSize, setWorkspaceSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const workspace = ref.current

    if (!workspace) {
      return
    }

    const updateWorkspaceSize = () => {
      const rect = workspace.getBoundingClientRect()
      setWorkspaceSize({
        width: rect.width,
        height: rect.height,
      })
    }

    updateWorkspaceSize()

    const observer = new ResizeObserver(updateWorkspaceSize)
    observer.observe(workspace)

    return () => {
      observer.disconnect()
    }
  }, [ref])

  return workspaceSize
}
