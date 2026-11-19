// Responsabilité : les outils `machines` du serveur `lanterne` — lister, tester, ajouter, modifier, supprimer une machine
// configurée. Ils appellent l'API du relais ; modifier et supprimer attendent la confirmation de Chris (fenêtre de l'appli).
import type { Logger } from 'pino';
import type { Resultat } from './outils.ts';

export interface ApiMachinesOutils {
  readonly url: string;
  readonly jeton: string;
}

export const DELAI_CONFIRMATION_MS = 5 * 60_000;
const PAS_ATTENTE_S = 25;

interface Reponse {
  readonly ok: boolean;
  readonly statut: number;
  readonly corps: unknown;
}

async function appeler(api: ApiMachinesOutils, methode: string, chemin: string, corps?: unknown): Promise<Reponse> {
  const r = await fetch(`${api.url}${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${api.jeton}`, ...(corps ? { 'content-type': 'application/json' } : {}) },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  const texte = await r.text();
  let donnees: unknown = null;
  try {
    donnees = texte ? JSON.parse(texte) : null;
  } catch {
    donnees = texte;
  }
  return { ok: r.ok, statut: r.status, corps: donnees };
}

function messageErreur(r: Reponse): Resultat {
  const erreur = (r.corps as { erreur?: string } | null)?.erreur ?? `HTTP ${r.statut}`;
  return { texte: `Échec : ${erreur}`, erreur: true };
}

/** Demande l'accord de Chris par la fenêtre de l'appli ; sans réponse dans le délai, c'est un refus. */
export async function confirmer(api: ApiMachinesOutils, action: string, cible: string, resume: string): Promise<boolean> {
  const demande = await appeler(api, 'POST', '/api/confirmations', { action, cible, resume });
  if (!demande.ok) return false;
  const id = (demande.corps as { id: string }).id;
  const echeance = Date.now() + DELAI_CONFIRMATION_MS;
  while (Date.now() < echeance) {
    const r = await appeler(api, 'GET', `/api/confirmations/${id}/attendre?attendre=${PAS_ATTENTE_S}`);
    const statut = (r.corps as { statut?: string } | null)?.statut;
    if (statut === 'accordee') return true;
    if (statut && statut !== 'en_attente') return false;
  }
  return false;
}

const REFUS = (action: string): Resultat => ({
  texte: `Chris n'a pas confirmé « ${action} » : rien n'a été modifié.`,
  erreur: false,
});

export async function listerMachines(api: ApiMachinesOutils): Promise<Resultat> {
  const r = await appeler(api, 'GET', '/api/machines/config');
  if (!r.ok) return messageErreur(r);
  const machines = (r.corps as { machines: { id: string; hote: string; dossier: string; enLigne: boolean; posteInstalle: boolean }[] }).machines;
  const lignes = machines.map(
    (m) => `- ${m.id} : ${m.hote}, dossier ${m.dossier}, poste ${m.enLigne ? 'connecté' : m.posteInstalle ? 'hors ligne' : 'non installé'}`,
  );
  return { texte: lignes.length > 0 ? lignes.join('\n') : 'Aucune machine configurée.', erreur: false };
}

export async function testerMachine(api: ApiMachinesOutils, id: string): Promise<Resultat> {
  const r = await appeler(api, 'POST', `/api/machines/config/${encodeURIComponent(id)}/tester`);
  if (!r.ok) return messageErreur(r);
  const rapport = r.corps as Record<string, { ok: boolean; detail: string }>;
  const texte = Object.entries(rapport)
    .map(([nom, e]) => `${nom} : ${e.ok ? 'ok' : 'échec'} (${e.detail})`)
    .join('\n');
  return { texte, erreur: false };
}

export async function ajouterMachine(api: ApiMachinesOutils, machine: Record<string, unknown>): Promise<Resultat> {
  const r = await appeler(api, 'POST', '/api/machines/config', machine);
  return r.ok ? { texte: `Machine « ${String(machine['id'])} » ajoutée. Installer le poste pour qu'elle héberge des sessions.`, erreur: false } : messageErreur(r);
}

export async function modifierMachine(
  api: ApiMachinesOutils,
  id: string,
  modif: Record<string, unknown>,
  log: Logger,
): Promise<Resultat> {
  const resume = `Modifier la machine « ${id} » : ${JSON.stringify(modif)}`;
  if (!(await confirmer(api, 'modifier_machine', id, resume))) return REFUS('modifier_machine');
  const r = await appeler(api, 'PATCH', `/api/machines/config/${encodeURIComponent(id)}`, modif);
  log.info({ machine: id, ok: r.ok }, 'outil machines : modification');
  return r.ok ? { texte: `Machine « ${id} » modifiée.`, erreur: false } : messageErreur(r);
}

export async function supprimerMachine(api: ApiMachinesOutils, id: string, log: Logger): Promise<Resultat> {
  const resume = `Supprimer la configuration de la machine « ${id} ». Le poste distant, s'il existe, reste à arrêter à la main.`;
  if (!(await confirmer(api, 'supprimer_machine', id, resume))) return REFUS('supprimer_machine');
  const r = await appeler(api, 'DELETE', `/api/machines/config/${encodeURIComponent(id)}`);
  log.info({ machine: id, ok: r.ok }, 'outil machines : suppression');
  return r.ok ? { texte: `Machine « ${id} » supprimée.`, erreur: false } : messageErreur(r);
}
