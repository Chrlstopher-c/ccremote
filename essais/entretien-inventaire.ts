// Responsabilité : essai en lecture sur la machine — l'inventaire des descendants d'une racine (PID passé en argument) et
// le décompte des chantiers réels, sans rien arrêter ni écrire hors d'un registre temporaire.
// Usage : bun essais/entretien-inventaire.ts <PID racine>
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creerJournal } from '../commun/journal.ts';
import { type StatutChantier } from '../commun/entretien.ts';
import { dossierChantiers, lireChantiers } from '../poste/entretien/chantiers.ts';
import { inventairePoste } from '../poste/entretien/inventaire.ts';

const journal = creerJournal('essai-entretien');
const racine = Number(process.argv[2]);
if (!Number.isInteger(racine) || racine < 2) throw new Error('PID racine attendu (entier ≥ 2)');

const registre = join(mkdtempSync(join(tmpdir(), 'essai-entretien-')), 'processus.json');
const processus = inventairePoste({
  racine,
  lancement: 'essai',
  fichierRegistre: registre,
  sessionDePid: () => null,
  journal,
});
console.log(JSON.stringify({ racine, processus }, null, 2));

const chantiers = lireChantiers(dossierChantiers(), journal);
const parStatut: Partial<Record<StatutChantier, number>> = {};
for (const c of chantiers) parStatut[c.statut] = (parStatut[c.statut] ?? 0) + 1;
console.log(JSON.stringify({ chantiers: chantiers.length, parStatut }));
