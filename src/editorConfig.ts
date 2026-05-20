import Image from '@tiptap/extension-image'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import StarterKit from '@tiptap/starter-kit'
import { FontSizeMark, RowFontSize } from './fontSizeMark'

export function createEditorExtensions({ imageResize }: { imageResize: boolean }) {
  return [
    StarterKit,
    Image.extend({
      selectable: false,
    }).configure({
      allowBase64: true,
      resize: imageResize
        ? {
            enabled: true,
            directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
            minWidth: 48,
            minHeight: 48,
            alwaysPreserveAspectRatio: true,
          }
        : {
            enabled: false,
          },
    }),
    TaskList,
    TaskItem.configure({
      nested: false,
    }),
    FontSizeMark,
    RowFontSize,
  ]
}
