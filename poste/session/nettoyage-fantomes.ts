// Responsabilité : retirer de sessions.json les fiches fantômes créées par le défaut de rembobinage (avant le correctif).
// Usage : bun run poste/session/nettoyage-fantomes.ts <dossier-donnees-poste> [--appliquer]
// Sans --appliquer : liste seulement. Avec : sauvegarde sessions.json puis réécrit sans les fantômes. Poste arrêté requis.
import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fantomes } from './identifiants-fiche.ts';
import { PersistanceSessions, SessionPersistee } from './persistance.ts';
import { z } from 'zod';

const FichiersSessions = z.array(SessionPersistee);

function lireSessions(dossier: string): SessionPersistee[] {
  const fichier = join(dossier, 'sessions.json');
  const brut: unknown = JSON.parse(readFileSync(fichier, 'utf8'));
  const r = FichiersSessions.safeParse(brut);
  if (!r.success) throw new Error(`sessions.json illisible, rien modifié : ${r.error.message}`);
  return r.data;
}

// Renvoie les fantômes trouvés (listés) ; réécrit sessions.json sans eux seulement si `appliquer`.
export function nettoyer(dossier: string, appliquer: boolean): SessionPersistee[] {
  const toutes = lireSessions(dossier);
  const retires = fantomes(toutes);
  const ids = new Set(retires.map((f) => f.resume.id));
  for (const f of retires) {
    console.log(`fantome : id=${f.resume.id} claude=${f.resume.claudeSessionId ?? '-'} nom=${f.resume.titre} cwd=${f.resume.cwd}`);
  }
  console.log(`sessions : ${toutes.length}, fantômes : ${retires.length}, ${appliquer ? 'retirés' : 'rien modifié (sans --appliquer)'}`);
  if (!appliquer || retires.length === 0) return retires;
  copyFileSync(join(dossier, 'sessions.json'), join(dossier, 'sessions.json.avant-fantomes'));
  new PersistanceSessions(dossier).ecrire(toutes.filter((s) => !ids.has(s.resume.id)));
  return retires;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const dossier = argv.find((a) => !a.startsWith('--'));
  if (!dossier) throw new Error('usage : nettoyage-fantomes.ts <dossier-donnees-poste> [--appliquer]');
  nettoyer(dossier, argv.includes('--appliquer'));
}
