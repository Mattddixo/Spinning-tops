import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';
import { lintSpecText } from '../spec-lint';

// CodeMirror injects its styles at runtime. In a normal document that means a
// <style> element, which Forge's CSP (no 'unsafe-inline') refuses. Inside a
// shadow root it uses constructable stylesheets instead, which CSP allows, so
// the editor lives in one. CSS custom properties still inherit through the
// shadow boundary, so the design tokens (and dark mode) carry over.

const theme = EditorView.theme({
  '&': {
    fontSize: '13px',
    color: 'var(--ds-text, #172b4d)',
    backgroundColor: 'var(--ds-background-input, #ffffff)',
    border: '1px solid var(--ds-border-input, #8590a2)',
    borderRadius: '3px',
  },
  '&.cm-focused': { outline: '2px solid var(--ds-border-focused, #388bff)', outlineOffset: '-1px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--ds-text, #172b4d)' },
  '.cm-cursor': { borderLeftColor: 'var(--ds-text, #172b4d)' },
  '.cm-gutters': {
    backgroundColor: 'var(--ds-surface-sunken, #f7f8f9)',
    color: 'var(--ds-text-subtlest, #626f86)',
    borderRight: '1px solid var(--ds-border, #091e4224)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--ds-background-neutral-subtle-hovered, #091e420f)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--ds-background-selected, #e9f2ff) !important',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--ds-surface-overlay, #ffffff)',
    color: 'var(--ds-text, #172b4d)',
    border: '1px solid var(--ds-border, #091e4224)',
  },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--ds-border-danger, #e2483d)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--ds-border-warning, #e56910)' },
  '.cm-panels': { backgroundColor: 'var(--ds-surface-sunken, #f7f8f9)', color: 'var(--ds-text, #172b4d)' },
});

const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--ds-text-accent-blue, #0055cc)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--ds-text-accent-green, #216e4e)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--ds-text-accent-purple, #5e4db2)' },
  { tag: [tags.keyword, tags.typeName, tags.labelName], color: 'var(--ds-text-accent-orange, #a54800)' },
  { tag: [tags.comment, tags.meta], color: 'var(--ds-text-subtlest, #626f86)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.separator, tags.bracket], color: 'var(--ds-text-subtle, #44546f)' },
]);

const looksLikeJson = (text: string) => /^\s*[{[]/.test(text);
const languageFor = (text: string) => (looksLikeJson(text) ? json() : yaml());

// Typing over a selection lets the browser replace it natively, and Chrome
// then adds inline style attributes to keep the deleted text's colours, which
// the CSP blocks (a console error, though CodeMirror redraws correctly). Apply
// those replacements through CodeMirror instead. IME composition is untouched.
const replaceSelectionOnType = EditorView.domEventHandlers({
  beforeinput(event, view) {
    if (event.inputType !== 'insertText' || !event.data || view.state.selection.ranges.every((r) => r.empty)) return false;
    event.preventDefault();
    view.dispatch(view.state.replaceSelection(event.data), { scrollIntoView: true, userEvent: 'input.type' });
    return true;
  },
});

const specLinter = linter((view): Diagnostic[] => lintSpecText(view.state.doc.toString()), { delay: 400 });

interface SpecEditorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Visible height, e.g. "320px" or "60vh". */
  height?: string;
  describedBy?: string;
}

export default function SpecEditor({ value, onChange, label, height = '320px', describedBy }: SpecEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const language = new Compartment();
    const view = new EditorView({
      root,
      parent: root,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          language.of(languageFor(value)),
          syntaxHighlighting(highlight),
          replaceSelectionOnType,
          specLinter,
          lintGutter(),
          theme,
          EditorView.theme({ '&': { height }, '.cm-scroller': { overflow: 'auto' } }),
          EditorView.contentAttributes.of({ 'aria-label': label, ...(describedBy ? { 'aria-describedby': describedBy } : {}) }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const text = update.state.doc.toString();
            // Switch between JSON and YAML highlighting as the content changes.
            const wantsJson = looksLikeJson(text);
            if (wantsJson !== looksLikeJson(update.startState.doc.toString())) {
              update.view.dispatch({ effects: language.reconfigure(languageFor(text)) });
            }
            onChangeRef.current(text);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
      root.replaceChildren();
    };
    // The editor is created once; later value changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, height, describedBy]);

  // Content replaced from outside (e.g. an attachment loaded into the editor).
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} className="sp-editor" data-testid="spec-editor" />;
}
