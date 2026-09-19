// Bridges Lexical's editor state (used only inside WodEditor.jsx, while a coach is actively
// typing) and the plain `{ lines: [{ type, segments }] }` shape wod.js and every read-only view
// work with — see wod.js for why that shape exists instead of storing Lexical's own JSON.
import { createElement } from 'react'
import {
  $applyNodeReplacement, $createParagraphNode, $createTextNode, $getRoot, $isLineBreakNode, $isTextNode,
  DecoratorNode, ParagraphNode, TextNode,
} from 'lexical'

// An exercise "chip" dropped inline in the text. Extends TextNode (not a full DecoratorNode —
// we don't need a live gif while typing, just a name to look right and read back out) with
// mode 'token': Lexical then treats it as one atomic unit for the cursor and backspace, so it
// can't be partially edited or split, only inserted and deleted whole.
export class ExerciseMentionNode extends TextNode {
  constructor(exerciseId, label, key) {
    super(label, key)
    this.__exerciseId = exerciseId
    this.setMode('token')
  }
  static getType() { return 'exercise-mention' }
  static clone(node) { return new ExerciseMentionNode(node.__exerciseId, node.__text, node.__key) }
  createDOM(config) {
    const dom = super.createDOM(config)
    dom.className = 'wod-chip'
    return dom
  }
  static importJSON(serialized) {
    return $applyNodeReplacement(new ExerciseMentionNode(serialized.exerciseId, serialized.label)).setFormat(serialized.format)
  }
  exportJSON() {
    return { ...super.exportJSON(), type: 'exercise-mention', exerciseId: this.__exerciseId, label: this.__text, version: 1 }
  }
  getExerciseId() { return this.__exerciseId }
}

export const $isExerciseMentionNode = node => node instanceof ExerciseMentionNode

export function $createExerciseMentionNode(exerciseId, label) {
  return $applyNodeReplacement(new ExerciseMentionNode(exerciseId, label))
}

// A line that renders as something other than a plain row — the +Título (bold, centered,
// "ACTIVACIÓN"), +Subtítulo (smaller, left-aligned, quieter — "EMOM 14 min") and +Notas
// (italic aside — "Avanzados: van añadiendo peso…") toolbar buttons. Everything else stays a
// stock ParagraphNode (what Enter creates), read back as the default 'text' type below — a
// coach typing normally never has to think about this at all.
const WOD_LINE_VARIANTS = ['title', 'subtitle', 'note']

export class WodLineNode extends ParagraphNode {
  constructor(variant = 'text', key) {
    super(key)
    this.__variant = variant
  }
  static getType() { return 'wod-line' }
  static clone(node) { return new WodLineNode(node.__variant, node.__key) }
  createDOM(config) {
    const dom = super.createDOM(config)
    if (WOD_LINE_VARIANTS.includes(this.__variant)) dom.classList.add('wod-' + this.__variant)
    return dom
  }
  updateDOM(prevNode, dom, config) {
    const changed = super.updateDOM(prevNode, dom, config)
    for (const v of WOD_LINE_VARIANTS) dom.classList.toggle('wod-' + v, this.__variant === v)
    return changed
  }
  static importJSON(serialized) {
    return $applyNodeReplacement(new WodLineNode(serialized.variant))
  }
  exportJSON() {
    return { ...super.exportJSON(), type: 'wod-line', variant: this.__variant, version: 1 }
  }
  getVariant() { return this.__variant }
}

export const $isWodLineNode = node => node instanceof WodLineNode

export function $createWodLineNode(variant = 'text') {
  return $applyNodeReplacement(new WodLineNode(variant))
}

// A rule between sections — the +Separador button. Root-level and non-editable (nothing to
// type inside a line drawn as a rule), so it's its own DecoratorNode rather than a paragraph
// variant like WodLineNode.
export class DividerNode extends DecoratorNode {
  static getType() { return 'wod-divider' }
  static clone(node) { return new DividerNode(node.__key) }
  createDOM() {
    const div = document.createElement('div')
    div.className = 'wod-divider-wrap'
    return div
  }
  updateDOM() { return false }
  static importJSON() { return $applyNodeReplacement(new DividerNode()) }
  exportJSON() { return { type: 'wod-divider', version: 1 } }
  decorate() { return createElement('hr', { className: 'wod-divider' }) }
  // A block on its own line, not an inline decorator sitting inside a paragraph's text flow —
  // without this Lexical auto-wraps it in a generated paragraph to satisfy "root only holds
  // block children", which breaks the one-root-child-per-line assumption $wodFromEditorState
  // relies on to tell a divider apart from a line of text.
  isInline() { return false }
}

export const $isDividerNode = node => node instanceof DividerNode

export function $createDividerNode() {
  return $applyNodeReplacement(new DividerNode())
}

export const WOD_EDITOR_NODES = [ExerciseMentionNode, WodLineNode, DividerNode]

// One ParagraphNode (or WodLineNode) per line, one DividerNode per rule — Enter starts a new
// paragraph, which is what lets the "ruled editor" look (index.css's .wod-editable) stripe/rule
// each line with plain CSS instead of guessing where text wrapped. A LineBreakNode (Shift+Enter,
// rare) still starts a new line in the data even though it stays inside one paragraph —
// correctness of the split matters more here than that one edge case also getting its own DOM
// row to style.
export function $wodFromEditorState() {
  const lines = []
  const root = $getRoot()
  for (const node of root.getChildren()) {
    if ($isDividerNode(node)) { lines.push({ type: 'divider', segments: [] }); continue }
    const variant = $isWodLineNode(node) ? node.getVariant() : 'text'
    const type = WOD_LINE_VARIANTS.includes(variant) ? variant : 'text'
    let current = { type, segments: [] }
    for (const child of node.getChildren()) {
      if ($isLineBreakNode(child)) { lines.push(current); current = { type, segments: [] }; continue }
      if ($isExerciseMentionNode(child)) {
        current.segments.push({ t: 'ex', id: child.getExerciseId(), label: child.getTextContent() })
      } else if ($isTextNode(child)) {
        const v = child.getTextContent()
        if (v) current.segments.push({ t: 'text', v })
      }
    }
    lines.push(current)
  }
  return { lines }
}

export function $populateEditorFromWod(wod) {
  const root = $getRoot()
  root.clear()
  const lines = wod?.lines?.length ? wod.lines : [{ type: 'text', segments: [] }]
  for (const line of lines) {
    if (line.type === 'divider') { root.append($createDividerNode()); continue }
    const paragraph = WOD_LINE_VARIANTS.includes(line.type) ? $createWodLineNode(line.type) : $createParagraphNode()
    for (const seg of line.segments || []) {
      paragraph.append(seg.t === 'ex' ? $createExerciseMentionNode(seg.id, seg.label) : $createTextNode(seg.v))
    }
    root.append(paragraph)
  }
  // A trailing divider with nothing after it leaves no editable row to place the cursor in.
  if ($isDividerNode(root.getLastChild())) root.append($createParagraphNode())
}
