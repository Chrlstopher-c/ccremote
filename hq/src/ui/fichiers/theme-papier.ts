// Responsabilité : le thème CodeMirror « papier » de la bibliothèque — fond crème, encre brune, coloration douce et
// lisible, gouttière et sélection dans les tons bois de la charte.
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const apparence = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: '#fbf3dc', color: '#3b2a1a', fontSize: '13.5px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
    '.cm-content': { caretColor: '#3b2a1a', padding: '10px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid #3b2a1a' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#e8cf98' },
    '.cm-activeLine': { backgroundColor: 'rgba(154, 106, 62, 0.08)' },
    '.cm-gutters': { backgroundColor: '#f1e2bc', color: '#9a7a58', borderRight: '2px solid #ead7ac' },
    '.cm-activeLineGutter': { backgroundColor: '#ead7ac', color: '#6b4428' },
    '.cm-matchingBracket': { backgroundColor: '#f0d8a0', outline: '1px solid #c8a060' },
    '.cm-searchMatch': { backgroundColor: '#f6dc8c' },
    '.cm-panels': { backgroundColor: '#f1e2bc', color: '#3b2a1a' },
  },
  { dark: false },
);

const coloration = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#a0402c', fontWeight: '600' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#4f7a2a' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#8a4fa0' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#9a8466', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.namespace], color: '#2a6a8a' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#b0602a' },
  { tag: [t.propertyName, t.attributeName], color: '#6b4428' },
  { tag: [t.tagName, t.angleBracket], color: '#a0402c' },
  { tag: t.heading, color: '#6b2a1a', fontWeight: '700' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.link, t.url], color: '#2a6a8a', textDecoration: 'underline' },
  { tag: [t.meta, t.processingInstruction], color: '#7a6a4a' },
  { tag: t.invalid, color: '#c0303a' },
]);

export const THEME_PAPIER: Extension = [apparence, syntaxHighlighting(coloration)];
