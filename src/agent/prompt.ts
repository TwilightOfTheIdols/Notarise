import type { AgentTurnInput } from './types'

// Assemble the prompt that's actually handed to the CLI: a short framing, the
// auto-attached Notarise context, then the user's message.
export const buildPrompt = (input: AgentTurnInput): string => {
  const { context, text, settings } = input
  const lines: string[] = []

  lines.push(
    'You are an assistant embedded in Notarise, a spatial layered note-taking app. ' +
      'The user is working in it right now and has attached the context below.',
  )
  if (settings.mode === 'scoped') {
    lines.push('Stay within the attached Notarise content unless the user explicitly asks you to go further.')
  }

  if (context.cell) {
    lines.push('')
    lines.push(`# Selected cell — layer "${context.cell.layerTitle}"`)
    lines.push(context.cell.text.trim() || '(the cell is empty)')
    if (context.cell.todos.length > 0) {
      lines.push('')
      lines.push('## TODOs in this cell')
      context.cell.todos.forEach((todo) => {
        lines.push(`- [${todo.checked ? 'x' : ' '}] ${todo.text}`)
      })
    }
  } else {
    lines.push('')
    lines.push(`The user is viewing layer "${context.activeLayerTitle}" with no cell selected.`)
  }

  lines.push('')
  lines.push('# Request')
  lines.push(text)

  return lines.join('\n')
}
