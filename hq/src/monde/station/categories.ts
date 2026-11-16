// Responsabilité : ranger un projet dans une catégorie de la station (un pont par catégorie), d'après son nom.
// Première liste tirée de conception/univers.md §9.3 ; plus tard, la décision de Chris stockée dans le relais primera.

export interface Categorie {
  id: string;
  nom: string;
  accent: number; // couleur d'accent du pont (bande lumineuse, plaques)
}

const AGENTS: Categorie = { id: 'agents', nom: 'Agents & poste', accent: 0x4fb08a };

export const CATEGORIES: readonly Categorie[] = [
  { id: 'clients', nom: 'Clients & business', accent: 0x4a8fd9 },
  AGENTS,
  { id: 'labos', nom: 'IA locale & labos', accent: 0x3fd0c0 },
  { id: 'apps', nom: 'Apps du bureau', accent: 0x8f8fb8 },
  { id: 'jeux', nom: 'Jeux & créa', accent: 0xa070d8 },
];

const MOTS: Readonly<Record<string, readonly string[]>> = {
  clients: ['stockiop', 'leadar', 'leadnexus', 'ploof', 'comptoir', 'echo-agency', 'lumen', 'linkedin', 'copywriting',
    'portfolio', 'apex', 'movix', 'insight', 'ariane', 'matheo'],
  agents: ['ccremote', 'quart', 'agent-hq', 'relais', 'hippocampe', 'semantic-memory', 'echo', 'atrium', 'bureau',
    'vault', 'pty-mcp', 'mcp', 'arcade', 'atelier', 'how-it-works', 'iris', 'duplex', 'pigment'],
  labos: ['agent-forge', 'echohub', 'accroche', 'scalpel', 'jev', 'doom', 'reflet', 'voix', 'dictee', 'whisper',
    'minimax', 'ace-step', 'epreuve', 'anamnese', 'mentor', 'agora'],
  apps: ['cordelle', 'plume', 'vela', 'browser', 'clarion', 'timbre', 'halcyon', 'kyty', 'disklens', 'vitrail', 'oomd',
    'saily', 'planche', 'mue', 'cadence', 'prisme', 'aegis', 'aurum', 'emploi'],
  jeux: ['roblox', 'rixe', 'horde', 'tellus', 'pression', 'tetris', 'tessera', 'voxelith', 'roque', 'chambre',
    'anime', 'kiroshi', 'lofi', 'oxygen', 'godot'],
};

/** Catégorie d'un projet : premier mot-clé reconnu dans son nom ; à défaut « Agents & poste » (le gros de l'usage). */
export function categorieDe(projet: string): Categorie {
  const nom = projet.toLowerCase();
  const id = Object.keys(MOTS).find((c) => MOTS[c]?.some((m) => nom.includes(m))) ?? 'agents';
  return CATEGORIES.find((c) => c.id === id) ?? AGENTS;
}
