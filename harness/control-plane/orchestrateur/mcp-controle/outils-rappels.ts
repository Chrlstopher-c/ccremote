/**
 * Responsabilité : groupe « rappels » de la surface d'outils — l'orchestrateur
 * agit sur le temps.
 *
 * `☠` TOUS ces outils sont bornés à LA conversation appelante. Le serveur de
 * contrôle est construit par fil, et `conversationId` vient de cette closure, pas
 * d'un paramètre du modèle : il ne peut donc pas viser le rappel d'un autre fil,
 * même en devinant son identifiant. C'est ce qui rend l'isolation réelle plutôt
 * que déclarative.
 *
 * ☠ Aucune fonction ici ne laisse fuir d'exception (contrat A.2.4).
 */

import { randomUUID } from 'node:crypto';
import type { Rappel, Registre } from '../../registre/index.ts';
import { validerRappel, type DemandeRappel } from '../../rappels/index.ts';
import { applique, echecInattendu, refuse } from './contrat.ts';
import { mcpControleLogger as journal } from './logger.ts';
import type { ContratRetour } from './types.ts';

const SANS_FIL = 'cette session n’est rattachée à aucune conversation : les rappels y sont impossibles';

function horodate(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Une ligne lisible d'un coup d'œil — l'orchestrateur en lit plusieurs à la fois. */
function resumer(r: Rappel, maintenant: number): string {
  const dans = Math.round((r.prochaineA - maintenant) / 60_000);
  const cadence = r.periodeMs === null ? 'unique' : `toutes les ${Math.round(r.periodeMs / 60_000)} min`;
  const etat =
    r.etat === 'actif'
      ? `prochain tir dans ${dans} min (${horodate(r.prochaineA)})`
      : r.etat === 'en_pause'
        ? 'EN PAUSE'
        : 'terminé';
  const erreur = r.derniereErreur === null ? '' : ` · dernier incident : ${r.derniereErreur}`;
  return `${r.id} · « ${r.libelle} » · ${cadence} · ${etat} · ${r.declenchements} tir(s)${erreur}`;
}

export function programmerRappel(
  registre: Registre,
  conversationId: string | null,
  demande: DemandeRappel,
): ContratRetour {
  const intention = `programmer le rappel « ${demande.libelle} »`;
  try {
    if (conversationId === null) return refuse(intention, SANS_FIL);
    const verdict = validerRappel(demande, registre.rappels.compterActifs(conversationId));
    // `☠` Refus AVANT toute écriture, et message qui nomme la borne : un modèle
    // se corrige à partir d'une valeur acceptable, jamais d'un échec nu.
    if (!verdict.ok) return refuse(intention, verdict.raison);

    const r = registre.rappels.creer({
      id: randomUUID(),
      conversationId,
      libelle: demande.libelle.trim(),
      consigne: demande.consigne.trim(),
      prochaineA: verdict.prochaineA,
      periodeMs: verdict.periodeMs,
      maxDeclenchements: demande.maxDeclenchements ?? null,
    });
    return applique(intention, `rappel posé — ${resumer(r, Date.now())}`, r.id);
  } catch (erreur) {
    journal.error({ err: erreur, libelle: demande.libelle }, 'programmerRappel en échec');
    return echecInattendu(intention, erreur);
  }
}

export function listerRappels(registre: Registre, conversationId: string | null): ContratRetour {
  const intention = 'lister mes rappels';
  try {
    if (conversationId === null) return refuse(intention, SANS_FIL);
    const rappels = registre.rappels.duFil(conversationId);
    if (rappels.length === 0) return applique(intention, 'aucun rappel sur cette conversation.');
    const maintenant = Date.now();
    return applique(intention, rappels.map((r) => resumer(r, maintenant)).join('\n'));
  } catch (erreur) {
    journal.error({ err: erreur }, 'listerRappels en échec');
    return echecInattendu(intention, erreur);
  }
}

/**
 * `☠` Les quatre mutations partagent la même forme : elles rendent `false` quand
 * la cible n'existe pas, appartient à un autre fil, ou n'est pas dans un état
 * compatible. On le DIT au modèle plutôt que de rendre un succès muet — sinon il
 * croit avoir mis en pause un rappel qui continue de tirer.
 */
function muter(
  intention: string,
  action: () => boolean,
  succes: string,
  echec: string,
): ContratRetour {
  try {
    return action() ? applique(intention, succes) : refuse(intention, echec);
  } catch (erreur) {
    journal.error({ err: erreur, intention }, 'mutation de rappel en échec');
    return echecInattendu(intention, erreur);
  }
}

export function mettreRappelEnPause(registre: Registre, conversationId: string | null, id: string): ContratRetour {
  const intention = `mettre le rappel ${id} en pause`;
  if (conversationId === null) return refuse(intention, SANS_FIL);
  return muter(
    intention,
    () => registre.rappels.mettreEnPause(id, conversationId),
    'rappel en pause — il ne tirera plus jusqu’à ce que tu le reprennes ; sa consigne et son historique sont conservés',
    'rappel introuvable dans cette conversation, ou déjà en pause / terminé',
  );
}

export function reprendreRappel(registre: Registre, conversationId: string | null, id: string): ContratRetour {
  const intention = `reprendre le rappel ${id}`;
  if (conversationId === null) return refuse(intention, SANS_FIL);
  return muter(
    intention,
    () => registre.rappels.reprendre(id, conversationId),
    'rappel repris — le cycle repart de maintenant, pas de rattrapage des tirs manqués',
    'rappel introuvable dans cette conversation, ou pas en pause (un rappel terminé ne se reprend jamais)',
  );
}

export function modifierRappel(
  registre: Registre,
  conversationId: string | null,
  id: string,
  champs: { readonly libelle?: string; readonly consigne?: string; readonly periodeMinutes?: number | null },
): ContratRetour {
  const intention = `modifier le rappel ${id}`;
  if (conversationId === null) return refuse(intention, SANS_FIL);

  // `☠` La période repasse par la MÊME validation qu'à la création : sans ça,
  // une modification serait la porte dérobée qui laisse poser un rappel toutes
  // les dix secondes — la borne ne vaut que si tous les chemins la traversent.
  let periodeMs: number | null | undefined;
  if (champs.periodeMinutes !== undefined) {
    const verdict = validerRappel(
      { libelle: champs.libelle ?? 'x', consigne: champs.consigne ?? 'x', periodeMinutes: champs.periodeMinutes },
      0,
    );
    if (!verdict.ok) return refuse(intention, verdict.raison);
    periodeMs = verdict.periodeMs;
  }

  return muter(
    intention,
    () =>
      registre.rappels.modifier(id, conversationId, {
        ...(champs.libelle !== undefined ? { libelle: champs.libelle } : {}),
        ...(champs.consigne !== undefined ? { consigne: champs.consigne } : {}),
        ...(periodeMs !== undefined ? { periodeMs } : {}),
      }),
    'rappel modifié — le compteur de tirs et la prochaine échéance sont conservés',
    'rappel introuvable dans cette conversation, ou déjà terminé',
  );
}

export function supprimerRappel(registre: Registre, conversationId: string | null, id: string): ContratRetour {
  const intention = `supprimer le rappel ${id}`;
  if (conversationId === null) return refuse(intention, SANS_FIL);
  return muter(
    intention,
    () => registre.rappels.supprimer(id, conversationId),
    'rappel supprimé définitivement',
    'rappel introuvable dans cette conversation',
  );
}
