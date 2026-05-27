import type { Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { FONT_SIZE_STEPS, MAX_FONT_SIZE, MIN_FONT_SIZE } from './constants'

export type FontSizeSegment = {
  from: number
  to: number
  size: number
  rowPos: number
  rowFrom: number
  rowTo: number
  rowAttrs: Record<string, unknown>
  containerItemPos: number | null
  containerItemAttrs: Record<string, unknown> | null
}

type ImageResizeDirection = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export function clampFontSize(value: number): number {
  return Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, value)))
}

export function clampIndex(index: number, values: readonly unknown[]): number {
  return Math.min(values.length - 1, Math.max(0, index))
}

export function getNearestFontStepIndex(value: number): number {
  const clampedValue = clampFontSize(value)
  return FONT_SIZE_STEPS.reduce((nearestIndex, size, index) => {
    const nearestDistance = Math.abs(FONT_SIZE_STEPS[nearestIndex] - clampedValue)
    const distance = Math.abs(size - clampedValue)
    return distance < nearestDistance ? index : nearestIndex
  })
}

export function getMinShrinkStepIndex(referenceSize: number, segments: FontSizeSegment[]): number {
  if (segments.length === 0) {
    return 0
  }

  const minIndex = FONT_SIZE_STEPS.findIndex((size) => {
    const scale = size / referenceSize
    return scale >= 1 || segments.every((segment) => segment.size * scale >= MIN_FONT_SIZE)
  })

  return minIndex >= 0 ? minIndex : getNearestFontStepIndex(referenceSize)
}

export function getMaxGrowStepIndex(referenceSize: number, segments: FontSizeSegment[]): number {
  if (segments.length === 0) {
    return FONT_SIZE_STEPS.length - 1
  }

  const maxIndex = FONT_SIZE_STEPS.findLastIndex((size) => {
    const scale = size / referenceSize
    return scale <= 1 || segments.every((segment) => segment.size * scale <= MAX_FONT_SIZE)
  })

  return maxIndex >= 0 ? maxIndex : getNearestFontStepIndex(referenceSize)
}

export function getWeightedSegmentFontSize(segments: FontSizeSegment[], fallbackSize: number): number {
  if (segments.length === 0) {
    return fallbackSize
  }

  const weighted = segments.reduce(
    (total, segment) => {
      const length = Math.max(1, segment.to - segment.from)
      return {
        size: total.size + segment.size * length,
        length: total.length + length,
      }
    },
    { size: 0, length: 0 },
  )

  return weighted.length > 0 ? weighted.size / weighted.length : fallbackSize
}

export function captureSelectedRowFontSegments(editor: Editor, fallbackSize: number): FontSizeSegment[] {
  const { from, to, empty } = editor.state.selection

  if (empty) {
    return []
  }

  const rowRanges: Array<{ from: number; to: number }> = []
  const rangeKeys = new Set<string>()

  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) {
      return
    }

    const rowFrom = pos + 1
    const rowTo = pos + node.nodeSize - 1

    if (rowFrom >= rowTo) {
      return false
    }

    const key = `${rowFrom}:${rowTo}`

    if (!rangeKeys.has(key)) {
      rangeKeys.add(key)
      rowRanges.push({ from: rowFrom, to: rowTo })
    }

    return false
  })

  return rowRanges.flatMap((range) => captureFontSegments(editor, range.from, range.to, fallbackSize))
}

export function captureDocumentFontSegments(editor: Editor, fallbackSize: number): FontSizeSegment[] {
  return captureFontSegments(editor, 0, editor.state.doc.content.size, fallbackSize)
}

function captureFontSegments(
  editor: Editor,
  from: number,
  to: number,
  fallbackSize: number,
): FontSizeSegment[] {
  const segments: FontSizeSegment[] = []

  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) {
      return
    }

    const rowFrom = pos + 1
    const rowTo = pos + node.nodeSize - 1
    const rowSize = getRowFontSize(node.attrs, fallbackSize)
    const containerItemContext = getContainerItemContext(editor.state.doc, pos)

    node.descendants((child, offset) => {
      if (!child.isText || child.nodeSize === 0) {
        return
      }

      const childFrom = rowFrom + offset
      const childTo = childFrom + child.nodeSize
      const segmentFrom = Math.max(from, childFrom)
      const segmentTo = Math.min(to, childTo)

      if (segmentFrom >= segmentTo) {
        return
      }

      segments.push({
        from: segmentFrom,
        to: segmentTo,
        size: getNodeFontSize(child.marks, rowSize),
        rowPos: pos,
        rowFrom,
        rowTo,
        rowAttrs: node.attrs,
        containerItemPos: containerItemContext?.pos ?? null,
        containerItemAttrs: containerItemContext?.attrs ?? null,
      })
    })

    return false
  })

  return segments
}

function getNodeFontSize(marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[], fallbackSize: number) {
  const fontSizeMark = marks.find((mark) => mark.type.name === 'fontSize')
  const size = Number(fontSizeMark?.attrs.size)
  return Number.isFinite(size) && size > 0 ? size : fallbackSize
}

function getRowFontSize(attrs: Record<string, unknown>, fallbackSize: number) {
  const size = Number(attrs.fontSize)
  return Number.isFinite(size) && size > 0 ? size : fallbackSize
}

function getFirstTextFontSize(node: Editor['state']['doc'], fallbackSize: number) {
  let size = fallbackSize

  node.descendants((child) => {
    if (!child.isText) {
      return true
    }

    size = getNodeFontSize(child.marks, fallbackSize)
    return false
  })

  return size
}

function getContainerItemContext(doc: Editor['state']['doc'], textBlockPos: number) {
  const resolvePos = Math.min(textBlockPos + 1, doc.content.size)
  const $pos = doc.resolve(resolvePos)

  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)

    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      return {
        pos: $pos.before(depth),
        attrs: node.attrs,
      }
    }
  }

  return null
}

function getActiveFontSize(state: Editor['state'], fallbackSize: number): number {
  const markType = state.schema.marks.fontSize

  if (!markType) {
    return fallbackSize
  }

  const storedSize = getNodeFontSize(state.storedMarks ?? [], fallbackSize)

  if (storedSize !== fallbackSize) {
    return storedSize
  }

  const activeSize = getNodeFontSize(state.selection.$from.marks(), fallbackSize)

  if (activeSize !== fallbackSize) {
    return activeSize
  }

  for (let depth = state.selection.$from.depth; depth > 0; depth -= 1) {
    const node = state.selection.$from.node(depth)

    if (node.isTextblock) {
      const rowSize = getRowFontSize(node.attrs, fallbackSize)

      if (rowSize !== fallbackSize) {
        return rowSize
      }
    }
  }

  const beforeSize = getNodeFontSize(state.selection.$from.nodeBefore?.marks ?? [], fallbackSize)

  if (beforeSize !== fallbackSize) {
    return beforeSize
  }

  return getNodeFontSize(state.selection.$from.nodeAfter?.marks ?? [], fallbackSize)
}

export function preserveFontSizeAfterEnter(view: Editor['view'], fallbackSize: number) {
  const size = getActiveFontSize(view.state, fallbackSize)

  window.requestAnimationFrame(() => {
    const markType = view.state.schema.marks.fontSize

    if (!markType) {
      return
    }

    const currentMarks = view.state.storedMarks ?? view.state.selection.$from.marks()
    const marks = [
      ...currentMarks.filter((mark) => mark.type.name !== 'fontSize'),
      markType.create({ size }),
    ]

    let transaction = view.state.tr.setStoredMarks(marks)
    const fontSizedNodeTypes = new Set(['paragraph', 'heading', 'listItem', 'orderedList', 'bulletList', 'taskItem', 'taskList'])

    for (let depth = view.state.selection.$from.depth; depth > 0; depth -= 1) {
      const node = view.state.selection.$from.node(depth)

      if (fontSizedNodeTypes.has(node.type.name)) {
        const rowPos = view.state.selection.$from.before(depth)
        transaction = transaction.setNodeMarkup(rowPos, undefined, {
          ...node.attrs,
          fontSize: size,
        })
      }
    }

    view.dispatch(transaction)
  })
}

export function preserveLeadingTabsAfterEnter(view: Editor['view']) {
  const { selection } = view.state

  if (!selection.empty) {
    return
  }

  const { $from } = selection
  let textBlockDepth = -1

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)

    if (node.type.name === 'taskItem' || node.type.name === 'listItem') {
      return
    }

    if (textBlockDepth === -1 && node.isTextblock) {
      textBlockDepth = depth
    }
  }

  if (textBlockDepth === -1) {
    return
  }

  const textBlock = $from.node(textBlockDepth)
  const leadingTabs = textBlock.textContent.match(/^\t+/)?.[0] ?? ''

  if (!leadingTabs) {
    return
  }

  window.requestAnimationFrame(() => {
    if (!view.state.selection.empty) {
      return
    }

    view.dispatch(view.state.tr.insertText(leadingTabs).scrollIntoView())
  })
}

function isBlankTextBlock(node: Editor['state']['doc']) {
  let isBlank = true

  node.descendants((child) => {
    if (child.isText) {
      if (!/^[\s\u00a0]*$/.test(child.text ?? '')) {
        isBlank = false
        return false
      }

      return true
    }

    if (child.type.name === 'hardBreak') {
      return true
    }

    isBlank = false
    return false
  })

  return isBlank
}

function getTaskSelectionContext(state: Editor['state']) {
  const { selection } = state

  if (!selection.empty) {
    return null
  }

  const { $from } = selection
  let textBlockDepth = -1
  let taskItemDepth = -1
  let taskListDepth = -1

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)

    if (textBlockDepth === -1 && node.isTextblock) {
      textBlockDepth = depth
    }

    if (taskItemDepth === -1 && node.type.name === 'taskItem') {
      taskItemDepth = depth
    }

    if (taskListDepth === -1 && node.type.name === 'taskList') {
      taskListDepth = depth
    }
  }

  if (textBlockDepth === -1 || taskItemDepth === -1 || taskListDepth === -1) {
    return null
  }

  return {
    $from,
    textBlockDepth,
    taskItemDepth,
    taskListDepth,
    textBlock: $from.node(textBlockDepth),
    taskItem: $from.node(taskItemDepth),
  }
}

function isNestedTaskItem(context: NonNullable<ReturnType<typeof getTaskSelectionContext>>) {
  return context.taskListDepth > 1 && context.$from.node(context.taskListDepth - 1).type.name === 'taskItem'
}

function isBlankTaskRow(context: NonNullable<ReturnType<typeof getTaskSelectionContext>>) {
  return context.taskItem.childCount === 1 && isBlankTextBlock(context.textBlock)
}

export function handleTaskNestingKey(editor: Editor, event: KeyboardEvent) {
  if (event.key !== 'Tab' && event.key !== 'Backspace') {
    return false
  }

  const context = getTaskSelectionContext(editor.state)

  if (!context) {
    return false
  }

  const { $from, textBlockDepth } = context
  const isAtTextBlockStart = $from.pos === $from.start(textBlockDepth)

  if (event.key === 'Tab') {
    if (event.shiftKey) {
      event.preventDefault()
      editor.commands.liftListItem('taskItem')
      return true
    }

    if (!isBlankTaskRow(context)) {
      return false
    }

    event.preventDefault()
    editor.commands.sinkListItem('taskItem')
    return true
  }

  if (
    event.key === 'Backspace' &&
    isAtTextBlockStart &&
    isNestedTaskItem(context) &&
    isBlankTaskRow(context)
  ) {
    const didLift = editor.commands.liftListItem('taskItem')

    if (didLift) {
      event.preventDefault()
    }

    return didLift
  }

  return false
}

function getListSelectionContext(state: Editor['state']) {
  const { selection } = state

  if (!selection.empty) {
    return null
  }

  const { $from } = selection
  let textBlockDepth = -1
  let listItemDepth = -1
  let listDepth = -1

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)

    if (textBlockDepth === -1 && node.isTextblock) {
      textBlockDepth = depth
    }

    if (listItemDepth === -1 && node.type.name === 'listItem') {
      listItemDepth = depth
    }

    if (listDepth === -1 && (node.type.name === 'orderedList' || node.type.name === 'bulletList')) {
      listDepth = depth
    }
  }

  if (textBlockDepth === -1 || listItemDepth === -1 || listDepth === -1) {
    return null
  }

  return {
    $from,
    textBlockDepth,
    listItemDepth,
    listDepth,
    textBlock: $from.node(textBlockDepth),
    listItem: $from.node(listItemDepth),
    list: $from.node(listDepth),
  }
}

function deleteBlankListRowOnDeleteKey(view: Editor['view'], fallbackSize: number) {
  const { state } = view
  const context = getListSelectionContext(state)

  if (!context) {
    return false
  }

  const { $from, listItemDepth, listDepth, textBlock, list } = context

  if (!isBlankTextBlock(textBlock)) {
    return false
  }

  const listItemPos = $from.before(listItemDepth)
  const listItemEnd = listItemPos + $from.node(listItemDepth).nodeSize
  const listPos = $from.before(listDepth)
  const listEnd = listPos + list.nodeSize

  if (list.childCount <= 1) {
    const paragraphType = state.schema.nodes.paragraph

    if (!paragraphType) {
      return false
    }

    const size = getActiveFontSize(state, fallbackSize)
    let transaction = state.tr.replaceWith(listPos, listEnd, paragraphType.create({ fontSize: size }))
    const selectionPos = Math.min(listPos + 1, transaction.doc.content.size)
    transaction = transaction
      .setSelection(TextSelection.near(transaction.doc.resolve(selectionPos)))
      .scrollIntoView()

    view.dispatch(transaction)
    return true
  }

  let transaction = state.tr.delete(listItemPos, listItemEnd)
  const selectionPos = Math.min(listItemPos, transaction.doc.content.size)
  transaction = transaction
    .setSelection(TextSelection.near(transaction.doc.resolve(selectionPos), -1))
    .scrollIntoView()

  view.dispatch(transaction)
  return true
}

function deleteSingleCharacterListRowText(view: Editor['view'], event: KeyboardEvent) {
  const context = getListSelectionContext(view.state)

  if (!context || context.textBlock.textContent.length !== 1) {
    return false
  }

  const { $from, textBlockDepth } = context
  const isAtTextBlockStart = $from.pos === $from.start(textBlockDepth)
  const isAtTextBlockEnd = $from.pos === $from.end(textBlockDepth)
  let from: number | null = null
  let to: number | null = null

  if (event.key === 'Backspace' && isAtTextBlockEnd) {
    from = $from.pos - 1
    to = $from.pos
  }

  if (event.key === 'Delete' && isAtTextBlockStart) {
    from = $from.pos
    to = $from.pos + 1
  }

  if (from === null || to === null) {
    return false
  }

  const transaction = view.state.tr.delete(from, to).scrollIntoView()
  view.dispatch(transaction)
  event.preventDefault()
  return true
}

export function handleListDeletionKey(view: Editor['view'], event: KeyboardEvent, fallbackSize: number) {
  if (event.key !== 'Backspace' && event.key !== 'Delete') {
    return false
  }

  if (deleteSingleCharacterListRowText(view, event)) {
    return true
  }

  if (deleteBlankListRowOnDeleteKey(view, fallbackSize)) {
    event.preventDefault()
    return true
  }

  const context = getListSelectionContext(view.state)

  if (!context) {
    return false
  }

  const { $from, textBlockDepth } = context
  const isAtTextBlockStart = $from.pos === $from.start(textBlockDepth)
  const isAtTextBlockEnd = $from.pos === $from.end(textBlockDepth)

  if (event.key === 'Backspace' && isAtTextBlockStart) {
    event.preventDefault()
    return true
  }

  if (event.key === 'Delete' && isAtTextBlockEnd) {
    event.preventDefault()
    return true
  }

  return false
}

export function applyScaledFontSegments(editor: Editor, segments: FontSizeSegment[], scale: number) {
  const markType = editor.schema.marks.fontSize

  if (!markType) {
    return
  }

  const transaction = editor.state.tr
  const rowGroups = new Map<number, {
    attrs: Record<string, unknown>
    from: number
    to: number
    containerItemPos: number | null
    containerItemAttrs: Record<string, unknown> | null
    weightedSize: number
    length: number
  }>()

  segments.forEach((segment) => {
    const length = Math.max(1, segment.to - segment.from)
    const rowGroup = rowGroups.get(segment.rowPos)

    if (rowGroup) {
      rowGroup.weightedSize += segment.size * length
      rowGroup.length += length
      rowGroup.containerItemPos = segment.containerItemPos ?? rowGroup.containerItemPos
      rowGroup.containerItemAttrs = segment.containerItemAttrs ?? rowGroup.containerItemAttrs
      return
    }

    rowGroups.set(segment.rowPos, {
      attrs: segment.rowAttrs,
      from: segment.rowFrom,
      to: segment.rowTo,
      containerItemPos: segment.containerItemPos,
      containerItemAttrs: segment.containerItemAttrs,
      weightedSize: segment.size * length,
      length,
    })
  })

  rowGroups.forEach((row, rowPos) => {
    const baseSize = row.length > 0 ? row.weightedSize / row.length : MIN_FONT_SIZE
    const size = clampFontSize(baseSize * scale)
    transaction.setNodeMarkup(rowPos, undefined, {
      ...row.attrs,
      fontSize: size,
    })

    if (row.containerItemPos !== null && row.containerItemAttrs) {
      transaction.setNodeMarkup(row.containerItemPos, undefined, {
        ...row.containerItemAttrs,
        fontSize: size,
      })
    }

    transaction.removeMark(row.from, row.to, markType)
    transaction.addMark(row.from, row.to, markType.create({ size }))
  })

  transaction.setMeta('addToHistory', false)
  editor.view.dispatch(transaction)
}

export function normalizeTaskItemFontSizes(editor: Editor, fallbackSize: number) {
  let transaction = editor.state.tr
  let didChange = false

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'taskItem') {
      return true
    }

    const paragraph = node.firstChild
    const paragraphSize = paragraph
      ? getRowFontSize(paragraph.attrs, getFirstTextFontSize(paragraph, fallbackSize))
      : fallbackSize
    const currentSize = getRowFontSize(node.attrs, fallbackSize)

    if (currentSize !== paragraphSize) {
      transaction = transaction.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        fontSize: paragraphSize,
      })
      didChange = true
    }

    return true
  })

  if (!didChange) {
    return
  }

  transaction.setMeta('addToHistory', false)
  transaction.setMeta('preventUpdate', true)
  editor.view.dispatch(transaction)
}

function isImageResizeDirection(value: string | undefined): value is ImageResizeDirection {
  return value === 'top-left' || value === 'top-right' || value === 'bottom-left' || value === 'bottom-right'
}

function getImageNodePosition(editor: Editor, image: HTMLImageElement): number | null {
  const src = image.getAttribute('src')
  let fallbackPosition: number | null = null

  editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'image' && (!src || node.attrs.src === src)) {
      fallbackPosition = position
      return false
    }

    return true
  })

  return fallbackPosition
}

function calculateZoomCorrectedImageSize(
  direction: ImageResizeDirection,
  startWidth: number,
  startHeight: number,
  deltaX: number,
) {
  const nextWidth = Math.max(48, startWidth + (direction.includes('left') ? -deltaX : deltaX))
  const aspectRatio = startWidth > 0 && startHeight > 0 ? startWidth / startHeight : 1

  return {
    width: nextWidth,
    height: Math.max(48, nextWidth / aspectRatio),
  }
}

export function startImageResizeCorrection(event: MouseEvent, editor: Editor, viewportZoom: number) {
  const handle = (event.target as HTMLElement | null)?.closest('[data-resize-handle]') as HTMLElement | null
  const direction = handle?.dataset.resizeHandle

  if (!handle || !isImageResizeDirection(direction) || viewportZoom === 1) {
    return
  }

  const image = handle.closest('[data-resize-wrapper]')?.querySelector('img')

  if (!image) {
    return
  }

  const startX = event.clientX
  const startWidth = image.offsetWidth
  const startHeight = image.offsetHeight
  const src = image.getAttribute('src')

  const correctSize = (clientX: number) => {
    const deltaX = (clientX - startX) / viewportZoom
    const nextSize = calculateZoomCorrectedImageSize(direction, startWidth, startHeight, deltaX)

    image.style.width = `${nextSize.width}px`
    image.style.height = `${nextSize.height}px`

    return nextSize
  }

  const handleMouseMove = (moveEvent: MouseEvent) => {
    correctSize(moveEvent.clientX)
  }

  const handleMouseUp = (upEvent: MouseEvent) => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)

    const nextSize = correctSize(upEvent.clientX)
    const position = getImageNodePosition(editor, image)

    if (position === null) {
      return
    }

    const node = editor.state.doc.nodeAt(position)

    if (node?.type.name !== 'image' || (src && node.attrs.src !== src)) {
      return
    }

    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, {
        ...node.attrs,
        width: Math.round(nextSize.width),
        height: Math.round(nextSize.height),
      }),
    )
  }

  window.setTimeout(() => {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, 0)
}
