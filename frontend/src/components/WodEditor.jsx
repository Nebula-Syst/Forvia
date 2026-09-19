import { useCallback, useEffect, useMemo } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $createParagraphNode, $createTextNode, $getSelection, $isParagraphNode, $isRangeSelection } from 'lexical'
import {
  WOD_EDITOR_NODES, $createDividerNode, $createExerciseMentionNode, $createWodLineNode,
  $isDividerNode, $populateEditorFromWod, $wodFromEditorState,
} from '../lib/wodLexical.js'
import { t, nameFor } from '../lib/i18n.js'
import { exercisePicker } from '../sheets.jsx'
import { Button } from './ui.jsx'

// Loads `value` into the editor once on mount — WodEditor is deliberately uncontrolled after
// that (like every other rich-text wrapper); the parent forces a reload by changing `resetKey`,
// which remounts the whole LexicalComposer (see WodEditor below).
function InitialContentPlugin({ value }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => { editor.update(() => $populateEditorFromWod(value)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function Toolbar() {
  const [editor] = useLexicalComposerContext()
  // If the cursor's current line is already blank, the insert takes it over instead of
  // leaving that blank line stranded above the new one — e.g. +Divider then +Título right
  // after shouldn't leave an empty ruled row sitting between the rule and the heading.
  const insertHeading = (variant, placeholderText) => editor.update(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel)) return
    const line = sel.anchor.getNode().getTopLevelElementOrThrow()
    const heading = $createWodLineNode(variant)
    const placeholder = $createTextNode(placeholderText)
    heading.append(placeholder)
    if ($isParagraphNode(line) && line.getTextContent() === '') line.replace(heading)
    else line.insertAfter(heading)
    placeholder.select(0, placeholder.getTextContentSize())
  })
  const insertTitle = () => insertHeading('title', t('New title'))
  const insertSubtitle = () => insertHeading('subtitle', t('New subtitle'))
  const insertNote = () => insertHeading('note', t('New note'))
  const insertDivider = () => editor.update(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel)) return
    const line = sel.anchor.getNode().getTopLevelElementOrThrow()
    const divider = $createDividerNode()
    if ($isParagraphNode(line) && line.getTextContent() === '') line.replace(divider)
    else line.insertAfter(divider)
    let next = divider.getNextSibling()
    if (!next || $isDividerNode(next)) { next = $createParagraphNode(); divider.insertAfter(next) }
    next.selectStart()
  })
  const insertExercise = () => {
    const picker = exercisePicker(ex => {
      editor.update(() => {
        const sel = $getSelection()
        if (!$isRangeSelection(sel)) return
        const mention = $createExerciseMentionNode(ex.id, nameFor(ex))
        const space = $createTextNode(' ')
        sel.insertNodes([mention, space])
        space.select(1, 1)
      })
      picker.close()
    })
  }
  return (
    <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
      <Button variant="tinted" size="xs" icon="plus" onClick={insertTitle}>{t('Title')}</Button>
      <Button variant="tinted" size="xs" icon="plus" onClick={insertSubtitle}>{t('Subtitle')}</Button>
      <Button variant="tinted" size="xs" icon="plus" onClick={insertNote}>{t('Notes')}</Button>
      <Button variant="tinted" size="xs" icon="plus" onClick={insertDivider}>{t('Divider')}</Button>
      <Button variant="tinted" size="xs" icon="plus" onClick={insertExercise}>{t('Exercise')}</Button>
    </div>
  )
}

// Free text, exactly like a real whiteboard — a WOD's own notation (an EMOM minute with
// several movements in it, a rep ladder shared across two exercises, "3 sets by feel") varies
// too much to force into a structured sets/reps form. +Título/+Subtítulo/+Notas/+Separador are
// just display hints on a line (bold+centered heading, a smaller quiet heading, an italic
// aside, or a plain rule) — a coach can still just type plain lines and never touch them.
// +Exercise is a mention-style insert: it drops a real exercise in as an atomic chip anywhere
// in the text — including twice in the same line ("M1: Power Clean + Push Jerk") — which a
// whole-line link never could.
export default function WodEditor({ value, onChange, resetKey }) {
  const initialConfig = useMemo(() => ({
    namespace: 'wod-editor',
    nodes: WOD_EDITOR_NODES,
    onError: e => { throw e },
  }), [])
  const handleChange = useCallback(editorState => {
    editorState.read(() => onChange($wodFromEditorState()))
  }, [onChange])

  return (
    <LexicalComposer key={resetKey} initialConfig={initialConfig}>
      <Toolbar />
      <div className="wod-editor-shell">
        <RichTextPlugin
          contentEditable={<ContentEditable className="field wod-editable" aria-label={t('WOD')} />}
          placeholder={<div className="wod-placeholder">{t('Write the WOD here, just like on the whiteboard…')}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <OnChangePlugin onChange={handleChange} />
      <InitialContentPlugin value={value} />
    </LexicalComposer>
  )
}
