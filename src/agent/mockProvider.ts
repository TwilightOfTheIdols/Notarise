import type { AgentProvider, AgentTurnHandlers, AgentTurnInput } from './types'

// A stand-in backend so the UI is fully interactive before the real
// Claude Agent SDK / Codex sidecar is wired in. It streams a canned reply and
// raises one permission request mid-turn to exercise the approval flow.

const stream = (text: string, onDelta: (chunk: string) => void, signal: { cancelled: boolean }) => {
  const words = text.split(' ')
  return new Promise<void>((resolve) => {
    let index = 0
    const tick = () => {
      if (signal.cancelled) {
        resolve()
        return
      }
      if (index >= words.length) {
        resolve()
        return
      }
      onDelta((index === 0 ? '' : ' ') + words[index])
      index += 1
      window.setTimeout(tick, 45)
    }
    tick()
  })
}

export const mockProvider: AgentProvider = {
  id: 'claude-code',
  label: 'Mock agent',
  sendTurn(input: AgentTurnInput, handlers: AgentTurnHandlers) {
    const signal = { cancelled: false }

    const run = async () => {
      const scopeNote = input.settings.mode === 'scoped'
        ? 'Working inside Notarise only.'
        : 'Working across the linked project.'

      const { cell, activeLayerTitle } = input.context
      const contextLine = cell
        ? `I can see the selected cell in ${cell.layerTitle}` +
          (cell.todos.length > 0
            ? ` with ${cell.todos.filter((todo) => !todo.checked).length} open TODO(s): ${cell.todos
                .filter((todo) => !todo.checked)
                .map((todo) => `"${todo.text}"`)
                .join(', ')}.`
            : ' (no TODOs).')
        : `No cell is selected, so I'm looking at ${activeLayerTitle}.`

      await stream(`${scopeNote} ${contextLine} On it: "${input.text}".`, handlers.onAssistantDelta, signal)
      if (signal.cancelled) return

      const decision = await handlers.onPermissionRequest({
        tool: input.settings.mode === 'scoped' ? 'write_cell' : 'bash',
        title: input.settings.mode === 'scoped' ? 'Edit cell' : 'Run command',
        detail: input.settings.mode === 'scoped' ? 'Update the selected cell' : 'pytest -q',
      })
      if (signal.cancelled) return

      if (decision === 'allow') {
        handlers.onActivity(input.settings.mode === 'scoped' ? 'Editing a cell' : 'Running a command')
        await new Promise((resolve) => window.setTimeout(resolve, 900))
      }
      if (signal.cancelled) return
      handlers.onActivity(null)

      const followUp = decision === 'allow'
        ? ' Approved — done. (This is a mock; the real agent will do the work here.)'
        : ' Skipped that step since it was denied.'
      await stream(followUp, handlers.onAssistantDelta, signal)
      if (signal.cancelled) return

      handlers.onDone()
    }

    run().catch((error) => handlers.onError(error instanceof Error ? error.message : String(error)))

    return {
      cancel: () => {
        signal.cancelled = true
      },
    }
  },
}
