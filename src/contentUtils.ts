import type { JSONContent } from '@tiptap/react'

export function extractTextPreview(value: unknown): string {
  const text = getContentText(value)
  if (!text && hasImageContent(value)) {
    return 'Image box'
  }

  return text.length > 96 ? `${text.slice(0, 96).trim()}...` : text
}

export function getContentText(value: unknown): string {
  return collectText(value).replace(/\s+/g, ' ').trim()
}

export function isEmptyDocumentContent(value: unknown): boolean {
  return collectText(value).trim().length === 0 && !hasImageContent(value)
}

export function createImageDocumentContent(srcList: string[]): JSONContent {
  return {
    type: 'doc',
    content: srcList.flatMap((src) => [
      {
        type: 'image',
        attrs: {
          src,
        },
      },
      {
        type: 'paragraph',
      },
    ]),
  }
}

export function getImageFilesFromClipboard(event: ClipboardEvent): File[] {
  const itemFiles = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)

  if (itemFiles.length > 0) {
    return itemFiles
  }

  return [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'))
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Unable to read pasted image'))
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Unable to read pasted image')))
    reader.readAsDataURL(file)
  })
}

function hasImageContent(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }

  if ('type' in value && value.type === 'image') {
    return true
  }

  if (!('content' in value) || !Array.isArray(value.content)) {
    return false
  }

  return value.content.some(hasImageContent)
}

function collectText(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return ''
  }

  if ('text' in value && typeof value.text === 'string') {
    return value.text
  }

  if (!('content' in value) || !Array.isArray(value.content)) {
    return ''
  }

  return value.content.map(collectText).join(' ')
}
