import { assertValidNotariseDocument } from '../store'
import type { NotariseDocument } from '../store'

export const parseNotariseDocument = (text: string): NotariseDocument => {
  const parsed: unknown = JSON.parse(text)
  assertValidNotariseDocument(parsed)
  return parsed
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
