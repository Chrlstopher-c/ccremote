// Responsabilité : copier les fiches de sessions (colonnes et JSON de fiche) et leur fil d'événements vers la cible.
// Une fiche illisible est écartée avec son fil ; une fiche présente dans la cible ne reçoit que ses champs de fiche.
import type { Database } from 'bun:sqlite';
import type { Logger } from 'pino';
import { ResumeSession } from '../../commun/session.ts';
import { compte, type Compte } from './rapport.ts';

interface LigneSource {
  readonly id: string;
  readonly machine: string;
  readonly resume: string;
  readonly maj_le: string;
  readonly archivee: number;
  readonly epinglee: number;
  readonly non_lue: number;
}

interface LigneEvenement {
  readonly ts: string;
  readonly evt: string;
}

export interface BilanSessions {
  readonly sessions: Compte;
  readonly evenements: Compte;
  readonly artefacts: number;
}

export function copierSessions(source: Database, cible: Database, journal: Logger): BilanSessions {
  const lignes = source.query('SELECT * FROM sessions ORDER BY id').all() as LigneSource[];
  let ajoutees = 0;
  let misesAJour = 0;
  const evt = { lus: 0, ajoutes: 0, artefacts: 0 };
  for (const ligne of lignes) {
    const resume = ficheLisible(ligne, journal);
    if (resume === null) continue;
    const etat = copierFiche(cible, ligne, resume);
    if (etat === 'ajoutee') ajoutees++;
    if (etat === 'mise_a_jour') misesAJour++;
    const bilan = copierFil(source, cible, ligne.id);
    evt.lus += bilan.lus;
    evt.ajoutes += bilan.ajoutes;
    evt.artefacts += bilan.artefacts;
  }
  return {
    sessions: compte(lignes.length, ajoutees, misesAJour),
    evenements: compte(evt.lus, evt.ajoutes, 0),
    artefacts: evt.artefacts,
  };
}

// La fiche telle que le relais la lit : sans le dialogue éphémère s'il ne se lit plus (règle du registre).
function ficheLisible(ligne: LigneSource, journal: Logger): string | null {
  try {
    const objet: unknown = JSON.parse(ligne.resume);
    if (ResumeSession.safeParse(objet).success) return ligne.resume;
    const sansDialogue = ResumeSession.safeParse({ ...(objet as object), dialogue: null });
    if (sansDialogue.success) return ligne.resume;
    journal.warn({ session: ligne.id }, 'fiche illisible, session et fil écartés');
    return null;
  } catch (erreur) {
    journal.warn({ session: ligne.id, erreur: String(erreur) }, 'fiche non JSON, session et fil écartés');
    return null;
  }
}

type EtatFiche = 'ajoutee' | 'mise_a_jour' | 'ignoree';

function copierFiche(cible: Database, ligne: LigneSource, resume: string): EtatFiche {
  const existante = cible
    .query('SELECT machine, resume, archivee, epinglee, non_lue FROM sessions WHERE id = $id')
    .get({ id: ligne.id }) as Omit<LigneSource, 'id' | 'maj_le'> | null;
  const valeurs = {
    id: ligne.id,
    m: ligne.machine,
    r: resume,
    maj: ligne.maj_le,
    a: ligne.archivee,
    e: ligne.epinglee,
    n: ligne.non_lue,
  };
  if (existante === null) {
    cible
      .query(
        `INSERT INTO sessions (id, machine, resume, maj_le, archivee, epinglee, non_lue)
        VALUES ($id, $m, $r, $maj, $a, $e, $n)`,
      )
      .run(valeurs);
    return 'ajoutee';
  }
  if (memeFiche(existante, ligne, resume)) return 'ignoree';
  cible
    .query(
      `UPDATE sessions SET machine = $m, resume = $r, maj_le = $maj, archivee = $a, epinglee = $e, non_lue = $n
      WHERE id = $id`,
    )
    .run(valeurs);
  return 'mise_a_jour';
}

function memeFiche(existante: Omit<LigneSource, 'id' | 'maj_le'>, ligne: LigneSource, resume: string): boolean {
  return (
    existante.machine === ligne.machine &&
    existante.resume === resume &&
    existante.archivee === ligne.archivee &&
    existante.epinglee === ligne.epinglee &&
    existante.non_lue === ligne.non_lue
  );
}

interface BilanFil {
  readonly lus: number;
  readonly ajoutes: number;
  readonly artefacts: number;
}

// Un événement déjà présent (même horodatage, même contenu) n'est pas recopié : deuxième passage = rien d'ajouté.
// La comparaison compte les occurrences, pour qu'un doublon légitime du fil reste un doublon.
function copierFil(source: Database, cible: Database, sessionId: string): BilanFil {
  const presents = new Map<string, number>();
  for (const ligne of cible.query('SELECT ts, evt FROM evenements WHERE session_id = $id').all({ id: sessionId })) {
    const cle = cleEvenement(ligne as LigneEvenement);
    presents.set(cle, (presents.get(cle) ?? 0) + 1);
  }
  const insertion = cible.query('INSERT INTO evenements (session_id, ts, evt) VALUES ($id, $ts, $evt)');
  const lignes = source
    .query('SELECT ts, evt FROM evenements WHERE session_id = $id ORDER BY seq')
    .all({ id: sessionId }) as LigneEvenement[];
  let ajoutes = 0;
  let artefacts = 0;
  for (const ligne of lignes) {
    if (typeDe(ligne.evt) === 'artefact') artefacts++;
    const cle = cleEvenement(ligne);
    const restant = presents.get(cle) ?? 0;
    if (restant > 0) {
      presents.set(cle, restant - 1);
      continue;
    }
    insertion.run({ id: sessionId, ts: ligne.ts, evt: ligne.evt });
    ajoutes++;
  }
  return { lus: lignes.length, ajoutes, artefacts };
}

function cleEvenement(ligne: LigneEvenement): string {
  return `${ligne.ts}\u0000${ligne.evt}`;
}

function typeDe(evt: string): string | undefined {
  const objet = JSON.parse(evt) as { type?: unknown };
  return typeof objet.type === 'string' ? objet.type : undefined;
}
