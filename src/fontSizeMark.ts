import { Extension, Mark, mergeAttributes } from '@tiptap/core'

export const FontSizeMark = Mark.create({
  name: 'fontSize',

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (element) => element.style.fontSize?.replace('px', '') ?? null,
        renderHTML: (attributes) => {
          if (!attributes.size) {
            return {}
          }

          return {
            style: `font-size: ${attributes.size}px`,
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[style*="font-size"]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0]
  },
})

export const RowFontSize = Extension.create({
  name: 'rowFontSize',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'listItem', 'orderedList', 'bulletList', 'taskItem', 'taskList'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize?.replace('px', '') ?? null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {}
              }

              return {
                style: `font-size: ${attributes.fontSize}px`,
              }
            },
          },
        },
      },
    ]
  },
})
