import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'

type TodoToggleRow = {
  kind: 'paragraph' | 'taskItem'
  topIndex: number
  taskIndex: number | null
}

type TodoToggleReplacement = {
  from: number
  to: number
  content: Fragment | ProseMirrorNode
}

function doesRangeTouchNode(from: number, to: number, start: number, end: number) {
  if (from === to) {
    return from >= start && from <= end
  }

  return start < to && end > from
}

function createTaskItemFromParagraph(
  taskItemType: ProseMirrorNode['type'],
  paragraphNode: ProseMirrorNode,
) {
  return taskItemType.create(
    {
      checked: false,
      fontSize: paragraphNode.attrs.fontSize ?? null,
    },
    paragraphNode.type.create(paragraphNode.attrs, paragraphNode.content, paragraphNode.marks),
  )
}

function createParagraphsFromTaskItem(paragraphType: ProseMirrorNode['type'], taskItemNode: ProseMirrorNode) {
  const paragraphs: ProseMirrorNode[] = []

  taskItemNode.forEach((child) => {
    if (child.type === paragraphType) {
      paragraphs.push(paragraphType.create(child.attrs, child.content, child.marks))
    }
  })

  return paragraphs.length > 0 ? paragraphs : [paragraphType.create()]
}

export function toggleTodoRows(editor: Editor) {
  const { state, view } = editor
  const { doc, schema, selection } = state
  const taskListType = schema.nodes.taskList
  const taskItemType = schema.nodes.taskItem
  const paragraphType = schema.nodes.paragraph

  if (!taskListType || !taskItemType || !paragraphType) {
    return false
  }

  const rows: TodoToggleRow[] = []
  const taskSelectionsByTopIndex = new Map<number, Set<number>>()
  const paragraphSelectionsByTopIndex = new Set<number>()

  doc.forEach((topNode, topOffset, topIndex) => {
    const topStart = topOffset
    const topEnd = topStart + topNode.nodeSize

    if (topNode.type === paragraphType && doesRangeTouchNode(selection.from, selection.to, topStart, topEnd)) {
      rows.push({
        kind: 'paragraph',
        topIndex,
        taskIndex: null,
      })
      paragraphSelectionsByTopIndex.add(topIndex)
      return
    }

    if (topNode.type !== taskListType) {
      return
    }

    topNode.forEach((taskItemNode, taskOffset, taskIndex) => {
      if (taskItemNode.type !== taskItemType) {
        return
      }

      const taskStart = topStart + 1 + taskOffset
      const taskEnd = taskStart + taskItemNode.nodeSize

      if (!doesRangeTouchNode(selection.from, selection.to, taskStart, taskEnd)) {
        return
      }

      rows.push({
        kind: 'taskItem',
        topIndex,
        taskIndex,
      })

      const selectedTasks = taskSelectionsByTopIndex.get(topIndex) ?? new Set<number>()
      selectedTasks.add(taskIndex)
      taskSelectionsByTopIndex.set(topIndex, selectedTasks)
    })
  })

  if (rows.length === 0) {
    return false
  }

  const shouldTurnOff = rows.every((row) => row.kind === 'taskItem')
  const replacements: TodoToggleReplacement[] = []

  doc.forEach((topNode, topOffset, topIndex) => {
    const topStart = topOffset
    const topEnd = topStart + topNode.nodeSize

    if (!shouldTurnOff && paragraphSelectionsByTopIndex.has(topIndex) && topNode.type === paragraphType) {
      const taskItem = createTaskItemFromParagraph(taskItemType, topNode)
      replacements.push({
        from: topStart,
        to: topEnd,
        content: taskListType.create(null, taskItem),
      })
      return
    }

    const selectedTaskIndexes = taskSelectionsByTopIndex.get(topIndex)

    if (!shouldTurnOff || !selectedTaskIndexes || topNode.type !== taskListType) {
      return
    }

    const replacementNodes: ProseMirrorNode[] = []
    let pendingTaskItems: ProseMirrorNode[] = []

    const flushTaskItems = () => {
      if (pendingTaskItems.length === 0) {
        return
      }

      replacementNodes.push(taskListType.create(topNode.attrs, pendingTaskItems))
      pendingTaskItems = []
    }

    topNode.forEach((taskItemNode, _taskOffset, taskIndex) => {
      if (!selectedTaskIndexes.has(taskIndex)) {
        pendingTaskItems.push(taskItemNode)
        return
      }

      flushTaskItems()
      replacementNodes.push(...createParagraphsFromTaskItem(paragraphType, taskItemNode))
    })

    flushTaskItems()
    replacements.push({
      from: topStart,
      to: topEnd,
      content: Fragment.fromArray(replacementNodes),
    })
  })

  let transaction = state.tr

  replacements
    .sort((left, right) => right.from - left.from)
    .forEach((replacement) => {
      transaction = transaction.replaceWith(replacement.from, replacement.to, replacement.content)
    })

  if (!transaction.docChanged) {
    return false
  }

  const mappedSelection = Math.max(0, Math.min(transaction.mapping.map(selection.from, -1), transaction.doc.content.size))

  view.dispatch(
    transaction
      .setSelection(TextSelection.near(transaction.doc.resolve(mappedSelection)))
      .scrollIntoView(),
  )
  editor.commands.focus()
  return true
}
