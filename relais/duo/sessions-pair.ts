// Responsabilité : « session sur le compte de l'autre ». Le pair demande l'ouverture d'une session chez nous, dans un
// dossier que nous lui ouvrons ; elle tourne chez nous, partagée en écriture avec lui. Et la liste de ces dossiers.
import type { DossierPair, MessageLien } from '../../commun/duo.ts';
import {
  conclure,
  type Contexte,
  DELAI_REPONSE_PAIR_MS,
  requeteAuPair,
  type Requete,
  verdictDuPair,
} from './contexte.ts';
import { dossierAutorise } from './droits.ts';
import { bilan, identifiantSession, type OuvertureChezProprietaire } from './pont-sessions.ts';
import { echec, ok, type Resultat, STATUT_REFUS_DUO } from './resultat.ts';

type LigneOuvrir = Extract<MessageLien, { type: 'ouvrir_session' }>;

export async function recevoirOuverture(c: Contexte, nom: string, m: LigneOuvrir): Promise<void> {
  const requete: Requete = { nom, ref: m.ref, action: 'ouvrir_session', cible: `${m.machine}:${m.chemin}` };
  if (!(await accordeOuverture(c, nom, m))) {
    return conclure(c, requete, {
      ok: false,
      raison: `refusé par ${c.nomLocal()}`,
      detail: 'refusé : ouverture non permise (droits ou pas d’accord de Chris)',
    });
  }
  const r = await bilan(await c.sessions.ouvrir(demandeOuverture(m)));
  if (!r.ok) return conclure(c, requete, { ok: false, raison: r.raison });
  const id = identifiantSession(r.valeur);
  if (!id) return conclure(c, requete, { ok: false, raison: 'session ouverte sans identifiant' });
  c.partagerOuverte(id);
  conclure(c, requete, { ok: true, detail: `ouverte : ${id}`, session: id });
}

// `jamais` refuse ; `toujours` ouvre sans demande dans un dossier autorisé ; dans tous les autres cas, Chris tranche.
async function accordeOuverture(c: Contexte, nom: string, m: LigneOuvrir): Promise<boolean> {
  const droits = c.droits.lire();
  if (droits.ouvrirSession === 'jamais') return false;
  if (droits.ouvrirSession === 'toujours' && dossierAutorise(droits.dossiersOuverts, m.machine, m.chemin)) return true;
  return c.demandes.demander('ouvrir_session', nom, `${m.machine} · ${m.chemin}`);
}

// Session ouverte chez nous comme une session locale, en mode « par défaut » : Claude y redemande les permissions.
function demandeOuverture(m: LigneOuvrir): OuvertureChezProprietaire {
  return {
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

export function dossiersOfferts(c: Contexte): DossierPair[] {
  const machines = c.registre.machines();
  return c.droits.lire().dossiersOuverts.map((d) => ({
    machine: d.machine,
    chemin: d.chemin,
    nomMachine: machines.find((f) => f.id === d.machine)?.description || d.machine,
  }));
}

export function recevoirDossiers(c: Contexte, ref: string): void {
  c.envoyer({ type: 'dossiers_reponse', ref, dossiers: dossiersOfferts(c) });
}

export async function ouvrirChezPair(
  c: Contexte,
  demande: { machine: string; chemin: string; message: string; modele?: string },
): Promise<Resultat<string | null>> {
  const r = await requeteAuPair(
    c,
    (ref) => ({ type: 'ouvrir_session', ref, ...demande }),
    c.delaiDemandeMs + DELAI_REPONSE_PAIR_MS,
  );
  return verdictDuPair(r);
}

export async function dossiersDuPair(c: Contexte): Promise<Resultat<DossierPair[]>> {
  const r = await requeteAuPair(c, (ref) => ({ type: 'dossiers', ref }), DELAI_REPONSE_PAIR_MS);
  if (!r.ok) return r;
  return r.valeur.type === 'dossiers_reponse' ? ok(r.valeur.dossiers) : echec(STATUT_REFUS_DUO, 'réponse inattendue');
}
