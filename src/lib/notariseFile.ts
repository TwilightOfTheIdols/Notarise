import type { NotariseDocument } from '../store'

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

export const parseNotariseDocument = (text: string): NotariseDocument => {
  const parsed: unknown = JSON.parse(text)

  if (!isRecord(parsed)) {
    throw new Error('This does not look like a valid Notarise document.')
  }

  if (parsed.version === 1 && Array.isArray(parsed.boxes)) {
    return parsed as NotariseDocument
  }

  if (
    parsed.version === 2 &&
    parsed.kind === 'notarise.virtual-file-bundle' &&
    isRecord(parsed.files)
  ) {
    return parsed as NotariseDocument
  }

  throw new Error('This does not look like a valid Notarise document.')
}

export const withUpdatedAt = (document: NotariseDocument): NotariseDocument => {
  return {
    ...document,
    updatedAt: Date.now(),
  }
}

export const readTextFile = (file: File) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Could not read this file.'))
    })
    reader.addEventListener('error', () => reject(new Error('Could not read this file.')))
    reader.readAsText(file)
  })
}
