// Essai en LECTURE SEULE du spectateur claude.ai : sessions Remote Control du compte par défaut (~/.claude), puis
// historique traduit de la première session active. Aucun POST, aucun jeton affiché ni journalisé.
import pino from 'pino';
import { listerSessions } from '../poste/distant/client-claude-ai.ts';
import { SessionDistante } from '../poste/distant/session-distante.ts';
import type { Evenement, ResumeSession } from '../commun/session.ts';

const journal = pino({ level: 'warn' });
const COMPTE_PAR_DEFAUT = null;

const liste = await listerSessions(COMPTE_PAR_DEFAUT, journal);
if (!liste.ok) {
  console.log(`liste refusée : HTTP ${liste.statut} (${liste.probleme})`);
  process.exit(1);
}
const actives = liste.donnees.filter((s) => s.bridge && s.active);
console.log(`sessions listées : ${liste.donnees.length} ; Remote Control actives : ${actives.length}`);
for (const s of actives) {
  console.log(
    `- ${s.titre ?? '(sans titre)'} | travail=${s.travail ?? '?'} | connexion=${s.connectee ? 'connectée' : 'déconnectée'}`,
  );
}

const premiere = actives[0];
if (!premiere) process.exit(0);
const evenements: Evenement[] = [];
const resumes: ResumeSession[] = [];
const sortie = {
  evenement: (_id: string, evt: Evenement) => void evenements.push(evt),
  historique: (_id: string, evts: { evt: Evenement }[]) => void evenements.push(...evts.map((h) => h.evt)),
  resume: (r: ResumeSession) => void resumes.push(r),
};
const session = new SessionDistante(
  {
    contexte: { machine: 'essai', compte: 'defaut', fenetreContexte: 1_000_000 },
    configDir: COMPTE_PAR_DEFAUT,
    journal,
    sortie,
  },
  premiere,
);
const r = await session.charger();
if (!r.ok) {
  console.log(`historique refusé : HTTP ${r.statut} (${r.probleme})`);
  process.exit(1);
}
const parType = new Map<string, number>();
for (const e of evenements) parType.set(e.type, (parType.get(e.type) ?? 0) + 1);
console.log(`historique de « ${premiere.titre ?? '(sans titre)'} » : ${evenements.length} événements traduits`);
for (const [type, n] of parType) console.log(`  ${type} : ${n}`);
