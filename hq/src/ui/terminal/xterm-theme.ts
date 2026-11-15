// Responsabilité : l'apparence de xterm.js dans le poste cathodique — couleurs phosphore vert et police à chasse fixe
// lue dans la charte (--mono), pour que le terminal ressemble au reste du monde.
import type { ITheme } from '@xterm/xterm';

export const THEME_CRT: ITheme = {
  background: '#1a2a1c',
  foreground: '#8cf09a',
  cursor: '#c8ffd0',
  cursorAccent: '#1a2a1c',
  selectionBackground: '#3f6a46',
  black: '#10190f',
  red: '#ff7a7a',
  green: '#8cf09a',
  yellow: '#e8e07a',
  blue: '#7ac8d8',
  magenta: '#c8a0e8',
  cyan: '#8ae8d0',
  white: '#d8f0d8',
  brightBlack: '#4f7a55',
  brightRed: '#ffa0a0',
  brightGreen: '#b8ffc0',
  brightYellow: '#fff0a0',
  brightBlue: '#a0e0f0',
  brightMagenta: '#e0c0ff',
  brightCyan: '#b0fff0',
  brightWhite: '#f4fff4',
};

// Les invites zsh de Chris utilisent des icônes Nerd Font : polices installées sur ses machines en premier.
const NERD = "'JetBrainsMono Nerd Font Mono', 'JetBrainsMono NFM', 'Symbols Nerd Font Mono'";

export function policeMono(): string {
  const valeur = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();
  return `${NERD}, ${valeur || 'ui-monospace, monospace'}`;
}
