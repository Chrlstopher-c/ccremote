// Responsabilité : lire et écrire le frontmatter YAML simple (clés `nom: valeur`) des fichiers Markdown de Claude
// (styles de sortie, compétences). Volontairement minimal : pas de listes, pas de blocs.
export function lireFrontmatter(texte: string): Record<string, string> {
  if (!texte.startsWith('---')) return {};
  const fin = texte.indexOf('\n---', 3);
  if (fin < 0) return {};
  const champs: Record<string, string> = {};
  let cle: string | null = null;
  for (const ligne of texte.slice(3, fin).split('\n')) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(ligne.trim());
    if (m?.[1] !== undefined && !/^\s/.test(ligne)) {
      cle = m[1];
      champs[cle] = valeurYaml(m[2] ?? '');
    } else if (cle !== null && /^\s+\S/.test(ligne)) {
      // Valeur sur plusieurs lignes (`>` ou `|`, ou suite indentée) : rejointe en une ligne.
      champs[cle] = [champs[cle], ligne.trim()].filter((x) => x && x !== '>' && x !== '|').join(' ');
    }
  }
  return champs;
}

export function ecrireFrontmatter(champs: Record<string, string>, corps: string): string {
  const lignes = Object.entries(champs).map(([cle, valeur]) => `${cle}: ${JSON.stringify(valeur)}`);
  return `---\n${lignes.join('\n')}\n---\n\n${corps.trimEnd()}\n`;
}

function valeurYaml(brut: string): string {
  const t = brut.trim();
  if (t.startsWith('"')) {
    try {
      return String(JSON.parse(t));
    } catch {
      return t.slice(1, t.endsWith('"') ? -1 : undefined);
    }
  }
  return t.replace(/^'(.*)'$/, '$1');
}
