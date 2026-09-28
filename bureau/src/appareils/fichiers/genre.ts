// Responsabilité : ce qu'on fait d'un fichier selon son nom — l'afficher (image, vidéo, son, PDF), l'éditer (texte,
// code, script) ou seulement le télécharger. Même grille que l'explorateur de Vela.
export type Apercu = 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'texte' | 'binaire';

const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'heic']);
const VIDEOS = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v', 'ogv']);
const SONS = new Set(['mp3', 'flac', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'opus']);
const TEXTES = new Set(
  [
    'txt log csv tsv py pyi js jsx ts tsx mjs cjs json jsonc jsonl rs toml yaml yml xml html htm css scss ' +
    'less sh bash zsh fish conf ini env cfg c h cpp hpp go rb php java kt swift sql lua vim lock service ' +
    'timer desktop gitignore dockerfile plist svelte vue',
  ].join('').split(' '),
);
const NOMS_TEXTE = new Set(['Makefile', 'Dockerfile', 'LICENSE', 'README', 'Caddyfile', 'Procfile', 'crontab']);

export function extension(nom: string): string {
  const i = nom.lastIndexOf('.');
  return i > 0 ? nom.slice(i + 1).toLowerCase() : nom.startsWith('.') ? nom.slice(1).toLowerCase() : '';
}

export function apercuDe(nom: string): Apercu {
  const ext = extension(nom);
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'pdf') return 'pdf';
  if (IMAGES.has(ext)) return 'image';
  if (VIDEOS.has(ext)) return 'video';
  if (SONS.has(ext)) return 'audio';
  if (TEXTES.has(ext) || NOMS_TEXTE.has(nom) || ext === '') return 'texte';
  return 'binaire';
}

export function estEditable(nom: string): boolean {
  return ['texte', 'markdown'].includes(apercuDe(nom));
}
