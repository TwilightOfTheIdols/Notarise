import { memo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { JSONContent } from '@tiptap/react'

type StaticTextContentProps = {
  content: JSONContent
}

const getNodeFontSizeStyle = (node: JSONContent): CSSProperties | undefined => {
  const fontSize = Number(node.attrs?.fontSize)

  return Number.isFinite(fontSize) && fontSize > 0
    ? { fontSize }
    : undefined
}

const renderMarks = (node: JSONContent, content: ReactNode): ReactNode => {
  return (node.marks ?? []).reduce<ReactNode>((markedContent, mark) => {
    if (mark.type === 'fontSize' && mark.attrs?.size) {
      return <span style={{ fontSize: `${mark.attrs.size}px` }}>{markedContent}</span>
    }

    if (mark.type === 'bold') {
      return <strong>{markedContent}</strong>
    }

    if (mark.type === 'italic') {
      return <em>{markedContent}</em>
    }

    if (mark.type === 'strike') {
      return <s>{markedContent}</s>
    }

    if (mark.type === 'code') {
      return <code>{markedContent}</code>
    }

    return markedContent
  }, content)
}

const renderChildren = (node: JSONContent): ReactNode => {
  return node.content?.map((child, index) => renderNode(child, index)) ?? null
}

// Empty block nodes (e.g. a blank line) have no line box and collapse to zero
// height. The live editor keeps them visible with a trailing break, so mirror
// that here to preserve blank lines in the static/drag render.
const renderBlockChildren = (node: JSONContent): ReactNode => {
  const hasContent = Array.isArray(node.content) && node.content.length > 0
  return hasContent ? renderChildren(node) : <br />
}

const renderNode = (node: JSONContent, key: number | string): ReactNode => {
  if (node.type === 'text') {
    return <span key={key}>{renderMarks(node, node.text ?? '')}</span>
  }

  if (node.type === 'hardBreak') {
    return <br key={key} />
  }

  if (node.type === 'paragraph') {
    return (
      <p key={key} style={getNodeFontSizeStyle(node)}>
        {renderBlockChildren(node)}
      </p>
    )
  }

  if (node.type === 'heading') {
    const level = Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 3)
    const Tag = `h${level}` as 'h1' | 'h2' | 'h3'

    return (
      <Tag key={key} style={getNodeFontSizeStyle(node)}>
        {renderBlockChildren(node)}
      </Tag>
    )
  }

  if (node.type === 'image') {
    const src = typeof node.attrs?.src === 'string' ? node.attrs.src : undefined
    const width = Number(node.attrs?.width)
    const height = Number(node.attrs?.height)
    const imageStyle = {
      width: Number.isFinite(width) && width > 0 ? `${width}px` : undefined,
      height: Number.isFinite(height) && height > 0 ? `${height}px` : undefined,
    } satisfies CSSProperties

    if (!src) {
      return null
    }

    return (
      <img
        key={key}
        src={src}
        alt={typeof node.attrs?.alt === 'string' ? node.attrs.alt : ''}
        title={typeof node.attrs?.title === 'string' ? node.attrs.title : undefined}
        style={imageStyle}
      />
    )
  }

  if (node.type === 'taskList') {
    return (
      <ul key={key} data-type="taskList" style={getNodeFontSizeStyle(node)}>
        {renderChildren(node)}
      </ul>
    )
  }

  if (node.type === 'taskItem') {
    const checked = node.attrs?.checked === true

    return (
      <li key={key} data-type="taskItem" data-checked={checked ? 'true' : 'false'} style={getNodeFontSizeStyle(node)}>
        <label>
          <input type="checkbox" checked={checked} readOnly tabIndex={-1} />
          <span />
        </label>
        <div>{renderChildren(node)}</div>
      </li>
    )
  }

  if (node.type === 'bulletList') {
    return (
      <ul key={key} style={getNodeFontSizeStyle(node)}>
        {renderChildren(node)}
      </ul>
    )
  }

  if (node.type === 'orderedList') {
    return (
      <ol key={key} start={Number(node.attrs?.start) || undefined} style={getNodeFontSizeStyle(node)}>
        {renderChildren(node)}
      </ol>
    )
  }

  if (node.type === 'listItem') {
    return (
      <li key={key} style={getNodeFontSizeStyle(node)}>
        {renderChildren(node)}
      </li>
    )
  }

  if (node.type === 'blockquote') {
    return <blockquote key={key}>{renderChildren(node)}</blockquote>
  }

  if (node.type === 'horizontalRule') {
    return <hr key={key} />
  }

  if (node.type === 'codeBlock') {
    return (
      <pre key={key}>
        <code>{renderChildren(node)}</code>
      </pre>
    )
  }

  return <span key={key}>{renderChildren(node)}</span>
}

export const StaticTextContent = memo(function StaticTextContent({ content }: StaticTextContentProps) {
  return (
    <div className="text-editor static-text-editor" aria-hidden="true">
      {renderChildren(content)}
    </div>
  )
})
