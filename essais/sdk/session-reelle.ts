// Essai réel unique de SessionSdk : une session dans /tmp/claude-1000/essai-sdk, un message, une requête modèle.
// Affiche les événements reçus du fil puis ferme la session.
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { creerJournal } from '../../commun/journal.ts';
import type { Evenement, ResumeSession } from '../../commun/session.ts';
import type { SessionPersistee } from '../../poste/session/persistance.ts';
import { SessionSdk, trouverClaude } from '../../poste/session/session-sdk.ts';

const DOSSIER = '/tmp/claude-1000/essai-sdk';
const ID = randomUUID();
const DELAI_MS = 150_000;

mkdirSync(DOSSIER, { recursive: true });
console.log(`id de session : ${ID}`);

const resume: ResumeSession = {
  id: ID,
  machine: 'tour',
  projet: { machine: 'tour', chemin: DOSSIER, nom: 'essai-sdk' },
  cwd: DOSSIER,
  titre: 'Essai SDK',
  objectif: null,
  modele: 'claude-haiku-5-5',
  compte: 'principal',
  autonomie: false,
  statut: 'fermee',
  contexte: { tokens: 0, max: 1_000_000 },
  etapes: 0,
  compactions: 0,
  claudeSessionId: ID,
  tmux: null,
  attachee: false,
  pilotee: true,
  creeLe: new Date().toISOString(),
  majLe: new Date().toISOString(),
};
const persistance: SessionPersistee = { resume, consignes: null, configDir: null, transcript: null, position: 0 };
const evenements: Evenement[] = [];

const session = new SessionSdk(persistance, {
  journal: creerJournal('essai-sdk'),
  sortie: {
    evenement: (_id, evt) => {
      evenements.push(evt);
      console.log(`evenement ${JSON.stringify(evt).slice(0, 300)}`);
    },
    resume: (r) => console.log(`statut ${r.statut}`),
  },
  executable: trouverClaude(),
});

const erreur = await session.lancer('Réponds juste OK');
console.log(`lancement : ${erreur ?? 'ok'}`);
const fin = Date.now() + DELAI_MS;
while (!['attente', 'erreur', 'fermee'].includes(session.resume.statut) && Date.now() < fin) {
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`statut final avant fermeture : ${session.resume.statut}`);
console.log(`fermeture : ${(await session.fermer()) ?? 'ok'}`);
process.exit(0);
