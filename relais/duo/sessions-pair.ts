// Responsabilité : « session sur le compte de l'autre ». Le pair demande l'ouverture d'une session chez nous, dans un
// dossier que nous lui ouvrons ; elle tourne chez nous, partagée en écriture avec lui. Et la liste de ces dossiers.
import { type DossierPair, droitsSurMachine, type MessageLien } from '../../commun/duo.ts';
import {
  annoncerAttente,
  conclure,
  type Contexte,
  DELAI_REPONSE_PAIR_MS,
  type Engagement,
  raisonDeRefus,
  requeteAuPair,
  requeteAvecAccord,
  type Requete,
} from './contexte.ts';
import type { Reponse } from './demandes.ts';
import { dossierAutorise } from './droits.ts';
import { bilan, identifiantSession, type OuvertureChezProprietaire } from './pont-sessions.ts';
import { echec, ok, type Resultat, STATUT_REFUS_DUO } from './resultat.ts';

type LigneOuvrir = Extract<MessageLien, { type: 'ouvrir_session' }>;

export async function recevoirOuverture(c: Contexte, nom: string, m: LigneOuvrir): Promise<void> {
  const requete: Requete = { nom, ref: m.ref, action: 'ouvrir_session', cible: `${m.machine}:${m.chemin}` };
  const reponse = await accordeOuverture(c, nom, m);
  if (!reponse.accord) {
    return conclure(c, requete, {
      ok: false,
      raison: raisonDeRefus(c, reponse),
      detail: reponse.expiree
        ? 'délai dépassé sans réponse'
        : 'refusé : ouverture non permise (droits ou pas d’accord de Chris)',
    });
  }
  const r = await bilan(await c.sessions.ouvrir(demandeOuverture(m, nom)));
  if (!r.ok) return conclure(c, requete, { ok: false, raison: r.raison });
  const id = identifiantSession(r.valeur);
  if (!id) return conclure(c, requete, { ok: false, raison: 'session ouverte sans identifiant' });
  c.partagerOuverte(id);
  conclure(c, requete, { ok: true, detail: `ouverte : ${id}`, session: id });
}

// Machine sans « lancer » : refus avant tout. `jamais` refuse ; `toujours` ouvre sans demande dans un dossier
// autorisé ; dans tous les autres cas, Chris tranche.
async function accordeOuverture(c: Contexte, nom: string, m: LigneOuvrir): Promise<Reponse> {
  const droits = c.droits.lire();
  if (!droitsSurMachine(droits, m.machine).lancer) return { accord: false };
  if (droits.ouvrirSession === 'jamais') return { accord: false };
  if (droits.ouvrirSession === 'toujours' && dossierAutorise(droits.dossiersOuverts, m.machine, m.chemin)) {
    return { accord: true };
  }
  return c.demandes.demander('ouvrir_session', nom, `${m.machine} · ${m.chemin}`, undefined, undefined, (d) =>
    annoncerAttente(c, m.ref, d),
  );
}

// Session ouverte chez nous comme une session locale, en mode « par défaut » : Claude y redemande les permissions.
function demandeOuverture(m: LigneOuvrir, auteur: string): OuvertureChezProprietaire {
  return {
    auteur,
    machine: m.machine,
    projet: { machine: m.machine, chemin: m.chemin, nom: nomDossier(m.chemin) },
    message: m.message,
    ...(m.modele ? { modele: m.modele } : {}),
    autonomie: false,
    mode: 'default',
  };
}

function nomDossier(chemin: string): string {
  return chemin.split('/').filter(Boolean).pop() ?? chemin;
}

// Description par défaut de la machine locale (voir integre/donnees.ts).
const DESCRIPTION_LOCALE_PAR_DEFAUT = 'Cet ordinateur';

// Nom d'une machine du propriétaire tel que le pair le voit : « Cet ordinateur » devient « Ordinateur de <nom
// affiché du propriétaire> », vu de chez le pair ; sinon la description, à défaut l'identifiant.
export function nomMachinePourPair(description: string | undefined, identifiant: string, nomLocal: string): string {
  if (description === DESCRIPTION_LOCALE_PAR_DEFAUT) return `Ordinateur de ${nomLocal}`;
  return description || identifiant;
}

export function dossiersOfferts(c: Contexte): DossierPair[] {
  const machines = c.registre.machines();
  const droits = c.droits.lire();
  return droits.dossiersOuverts
    .filter((d) => droitsSurMachine(droits, d.machine).lancer)
    .map((d) => ({
      machine: d.machine,
      chemin: d.chemin,
      nomMachine: nomMachinePourPair(machines.find((f) => f.id === d.machine)?.description, d.machine, c.nomLocal()),
    }));
}

export function recevoirDossiers(c: Contexte, ref: string): void {
  c.envoyer({ type: 'dossiers_reponse', ref, dossiers: dossiersOfferts(c) });
}

/** Demandeur : ouvre une session chez le pair. Rend `en_attente` si Chris doit trancher chez lui, sinon la session. */
export function ouvrirChezPair(
  c: Contexte,
  demande: { machine: string; chemin: string; message: string; modele?: string },
): Promise<Resultat<Engagement>> {
  return requeteAvecAccord(
    c,
    (ref) => ({ type: 'ouvrir_session', ref, ...demande }),
    c.delaiDemandeMs + DELAI_REPONSE_PAIR_MS,
  );
}

export async function dossiersDuPair(c: Contexte): Promise<Resultat<DossierPair[]>> {
  const r = await requeteAuPair(c, (ref) => ({ type: 'dossiers', ref }), DELAI_REPONSE_PAIR_MS);
  if (!r.ok) return r;
  return r.valeur.type === 'dossiers_reponse' ? ok(r.valeur.dossiers) : echec(STATUT_REFUS_DUO, 'réponse inattendue');
}
