import type { ConfirmationRequest } from '../ConfirmationDialog'
import { createDocumentSnapshot, useDocumentStore } from '../store'
import type { NotariseDocument } from '../store'
import { parseNotariseDocument, readTextFile, withUpdatedAt } from '../lib/notariseFile'

type UseDocumentTransferDeps = {
  hydrateDocument: (document: NotariseDocument) => void
  setConfirmationRequest: (request: ConfirmationRequest | null) => void
  onBeforeImport: () => void
}

export function useDocumentTransfer({
  hydrateDocument,
  setConfirmationRequest,
  onBeforeImport,
}: UseDocumentTransferDeps) {
  const exportDocument = () => {
    const document = createDocumentSnapshot(useDocumentStore.getState())
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

    link.href = url
    link.download = `notarise-${stamp}.notarise`
    link.click()
    URL.revokeObjectURL(url)
  }

  const importDocument = async (file: File) => {
    const document = parseNotariseDocument(await readTextFile(file))

    setConfirmationRequest({
      title: 'Import document?',
      message: 'This replaces the current canvas with the selected file.',
      confirmLabel: 'Import',
      onConfirm: () => {
        onBeforeImport()
        hydrateDocument(withUpdatedAt(document))
      },
    })
  }

  return { exportDocument, importDocument }
}
