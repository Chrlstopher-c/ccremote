/**
 * Responsabilité : « Les traces réelles » — la leçon mot pour mot, la preuve d'injection
 * dans le transcript suivant, puis deux colonnes de tâtonnement (`sans_lecon`) et de
 * trajet direct (`avec_lecon`). Tout texte vient du fichier de mesures et est échappé.
 */

import type { FichierMesures, LigneTrace, Traces } from '../../experience/contrat.ts';
import { couleurCondition, echapper, section } from '../utils.ts';

const AUCUNE_TRACE = '<p class="valeur-non-mesuree">aucune trace disponible dans le fichier de mesures</p>';

function rendreCitationLecon(lecon: string): string {
  return `<blockquote>${echapper(lecon)}</blockquote>`;
}

function rendreInjection(injection: Traces['injection']): string {
  if (injection === null) return AUCUNE_TRACE;
  return `<p class="trace-injection-chemin">${echapper(injection.transcript)} · ligne ${injection.ligneJsonl}</p>
    <pre>${echapper(injection.extrait)}</pre>`;
}

function rendreLigneTrace(ligne: LigneTrace, couleurResultat: string): string {
  if (ligne.role === 'outil') {
    return `<div class="ligne-trace"><span class="ligne-trace-outil">${echapper(ligne.outil)}</span> ` +
      `${echapper(ligne.texte)}</div>`;
  }
  if (ligne.role === 'resultat') {
    return `<div class="ligne-trace" style="color:${couleurResultat}">${echapper(ligne.texte)}</div>`;
  }
  return `<div class="ligne-trace" style="color:var(--texte-doux)">${echapper(ligne.texte)}</div>`;
}

function rendreColonne(
  titre: string,
  couleurBordure: string,
  bloc: { readonly transcript: string; readonly lignes: readonly LigneTrace[] } | null,
  couleurResultat: string,
): string {
  const corps = bloc === null
    ? AUCUNE_TRACE
    : `<p class="trace-injection-chemin">${echapper(bloc.transcript)}</p>` +
      bloc.lignes.map((l) => rendreLigneTrace(l, couleurResultat)).join('\n');
  return `<div class="colonne-trace" style="border-left-color:${couleurBordure}">
    <p class="colonne-trace-titre">${echapper(titre)}</p>
    ${corps}
  </div>`;
}

export function rendreTraces(m: FichierMesures): string {
  const { traces } = m;
  const couleurSansLecon = couleurCondition('sans_lecon');
  const couleurAvecLecon = couleurCondition('avec_lecon');
  const colonnes = `<div class="deux-colonnes">
    ${rendreColonne('sans_lecon — tâtonnement', couleurSansLecon, traces.tatonnement, couleurSansLecon)}
    ${rendreColonne('avec_lecon — trajet direct', couleurAvecLecon, traces.direct, 'var(--texte-doux)')}
  </div>`;
  const contenu = `<p><strong>La leçon, mot pour mot.</strong></p>
    ${rendreCitationLecon(traces.leconMotPourMot)}
    <p style="margin-top:32px"><strong>Son injection dans le contexte de l'équipe suivante.</strong></p>
    ${rendreInjection(traces.injection)}
    <div style="margin-top:32px">${colonnes}</div>`;
  return section('08', 'Les traces réelles', contenu, true);
}
