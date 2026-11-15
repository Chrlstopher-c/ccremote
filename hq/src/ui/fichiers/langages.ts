// Responsabilité : choisir la coloration syntaxique CodeMirror d'un fichier selon son extension.
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import type { Extension } from '@codemirror/state';

const PAR_EXTENSION: Readonly<Record<string, () => Extension>> = {
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  json: () => json(),
  md: () => markdown(),
  markdown: () => markdown(),
  py: () => python(),
  css: () => css(),
  html: () => html(),
  htm: () => html(),
  sh: () => StreamLanguage.define(shell),
  bash: () => StreamLanguage.define(shell),
  zsh: () => StreamLanguage.define(shell),
  yaml: () => yaml(),
  yml: () => yaml(),
};

export function langageDe(nom: string): Extension {
  const point = nom.lastIndexOf('.');
  const extension = point > 0 ? nom.slice(point + 1).toLowerCase() : '';
  return PAR_EXTENSION[extension]?.() ?? [];
}
