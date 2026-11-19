// Responsabilité : les gestes sur les artefacts d'une session — lister, renommer, dupliquer, supprimer, épingler — et
// l'enregistrement d'une version publiée. Chaque geste lit le registre, le modifie, puis l'écrit. Une erreur lève.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { estIdArtefact, nomAffiche } from '../../commun/presentation.ts';
import { type EntreeArtefact, type RegistreSession, ecrireRegistre, lireRegistre } from './registre.ts';
import type { Stockage } from './stockage.ts';

export interface VersionPoste {
  readonly version: number;
  readonly fichier: string;
  readonly publieLe: string;
}

/** Artefact tel que le relais le rend : `chemin` est la source si elle existe encore, sinon la copie stockée. */
export interface ArtefactPoste {
  readonly id: string;
  readonly session: string;
  readonly titre: string;
  readonly url: null;
  readonly publieLe: string;
  readonly epingle: boolean;
  readonly chemin: string;
  readonly versions: readonly VersionPoste[];
}

export interface VersionPubliee {
  readonly id: string;
  readonly titre: string;
  readonly version: number;
  readonly fichier: string;
  readonly source: string | null;
}

function identifiantValide(identifiant: string): string {
  if (!estIdArtefact(identifiant)) throw new Error(`identifiant d’artefact invalide : ${identifiant}`);
  return identifiant;
}

function entreeDe(registre: RegistreSession, identifiant: string): EntreeArtefact {
  const entree = registre[identifiantValide(identifiant)];
  if (!entree) throw new Error(`artefact inconnu : ${identifiant}`);
  return entree;
}

function derniereVersion(entree: EntreeArtefact): VersionPoste {
  const derniere = entree.versions[entree.versions.length - 1];
  if (!derniere) throw new Error('artefact sans version');
  return derniere;
}

function vue(stockage: Stockage, sessionId: string, identifiant: string, entree: EntreeArtefact): ArtefactPoste {
  const derniere = derniereVersion(entree);
  const stocke = join(stockage.dossier(sessionId), derniere.fichier);
  return {
    id: identifiant,
    session: sessionId,
    titre: entree.titre,
    url: null,
    publieLe: derniere.publieLe,
    epingle: entree.epingle,
    chemin: entree.source !== null && existsSync(entree.source) ? entree.source : stocke,
    versions: entree.versions.map((version) => ({ ...version })),
  };
}

export function listerArtefacts(stockage: Stockage, sessionId: string): ArtefactPoste[] {
  const registre = lireRegistre(stockage, sessionId);
  return Object.entries(registre)
    .map(([identifiant, entree]) => vue(stockage, sessionId, identifiant, entree))
    .sort((a, b) => b.publieLe.localeCompare(a.publieLe));
}

/** Change une entrée du registre, l'écrit, et rend l'artefact modifié. */
function modifier(
  stockage: Stockage,
  sessionId: string,
  identifiant: string,
  changement: (entree: EntreeArtefact) => EntreeArtefact,
): ArtefactPoste {
  const registre = lireRegistre(stockage, sessionId);
  const entree = changement(entreeDe(registre, identifiant));
  const nouveau = { ...registre, [identifiant]: entree };
  ecrireRegistre(stockage, sessionId, nouveau);
  return vue(stockage, sessionId, identifiant, entree);
}

export function renommerArtefact(
  stockage: Stockage,
  sessionId: string,
  identifiant: string,
  titre: string,
): ArtefactPoste {
  const propre = titre.trim();
  if (!propre) throw new Error('titre vide');
  return modifier(stockage, sessionId, identifiant, (entree) => ({ ...entree, titre: propre }));
}

export function epinglerArtefact(
  stockage: Stockage,
  sessionId: string,
  identifiant: string,
  epingle: boolean,
): ArtefactPoste {
  return modifier(stockage, sessionId, identifiant, (entree) => ({ ...entree, epingle }));
}

/** Copie la dernière version dans un nouvel artefact (version 1), titre « <titre> (copie) ». */
export function dupliquerArtefact(stockage: Stockage, sessionId: string, identifiant: string): ArtefactPoste {
  const registre = lireRegistre(stockage, sessionId);
  const source = entreeDe(registre, identifiant);
  const octets = readFileSync(join(stockage.dossier(sessionId), derniereVersion(source).fichier));
  const nouvelId = stockage.nouvelId();
  const titre = `${source.titre} (copie)`;
  const fichier = `${nouvelId}-v1`;
  stockage.ecrire(sessionId, fichier, octets, {
    nom: nomAffiche(`${titre.replace(/[\\/]/g, '-')}.html`),
    mime: 'text/html',
    taille: octets.length,
  });
  const copie: EntreeArtefact = {
    titre,
    epingle: false,
    source: null,
    versions: [{ version: 1, fichier, publieLe: new Date().toISOString() }],
  };
  ecrireRegistre(stockage, sessionId, { ...registre, [nouvelId]: copie });
  return vue(stockage, sessionId, nouvelId, copie);
}

/** Supprime toutes les versions (fichiers et métadonnées) et l'entrée du registre. */
export function supprimerArtefact(stockage: Stockage, sessionId: string, identifiant: string): void {
  const registre = lireRegistre(stockage, sessionId);
  const entree = entreeDe(registre, identifiant);
  const dossier = stockage.dossier(sessionId);
  for (const version of entree.versions) {
    rmSync(join(dossier, version.fichier), { force: true });
    rmSync(join(dossier, `${version.fichier}.json`), { force: true });
  }
  const restant: RegistreSession = { ...registre };
  delete restant[identifiant];
  ecrireRegistre(stockage, sessionId, restant);
}

/**
 * Inscrit une version tout juste écrite. `registre` est le registre lu AVANT l'écriture de cette version : sinon le
 * fichier neuf serait pris pour un artefact ancien et compté deux fois.
 */
export function enregistrerVersion(
  stockage: Stockage,
  sessionId: string,
  registre: RegistreSession,
  publiee: VersionPubliee,
): void {
  const version: VersionPoste = {
    version: publiee.version,
    fichier: publiee.fichier,
    publieLe: new Date().toISOString(),
  };
  const existante = registre[publiee.id];
  const entree: EntreeArtefact = existante
    ? { ...existante, source: publiee.source, versions: [...existante.versions, version] }
    : { titre: publiee.titre, epingle: false, source: publiee.source, versions: [version] };
  ecrireRegistre(stockage, sessionId, { ...registre, [publiee.id]: entree });
}
