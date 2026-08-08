/**
 * Responsabilité : « Le protocole » — les trois conditions avec leur pastille, le mandat
 * mot pour mot, chaque bloc de leçons non nul bordé de la couleur de sa condition, puis
 * répétitions et critère de succès.
 */

import type { Condition, FichierMesures } from '../../experience/contrat.ts';
import { couleurCondition, echapper, libelleCondition, pastilleCondition, section } from '../utils.ts';

function carteCondition(condition: Condition, bloc: string | null): string {
  const contenuBloc = bloc === null
    ? '<p class="valeur-non-mesuree">mandat nu — aucun bloc ajouté</p>'
    : `<div class="bloc-lecon" style="border-left: 3px solid ${couleurCondition(condition)}">` +
      `${echapper(bloc)}</div>`;
  return `<div class="condition-carte">
    <p class="condition-nom">${pastilleCondition(condition)}${echapper(condition)} — ${libelleCondition(condition)}</p>
    ${contenuBloc}
  </div>`;
}

export function rendreProtocole(m: FichierMesures): string {
  const cartes = m.protocole.conditions.map((c) => carteCondition(c, m.protocole.blocsLecons[c])).join('\n');
  const contenu = `${cartes}
    <p><strong>Mandat mot pour mot</strong> (commun aux trois conditions, seul le bloc de leçons varie) :</p>
    <div class="bloc-mandat">${echapper(m.protocole.mandatMotPourMot)}</div>
    <p><strong>Répétitions par condition :</strong> ${m.protocole.repetitionsParCondition}</p>
    <p><strong>Critère de succès.</strong> ${echapper(m.protocole.critereSucces)}</p>`;
  return section('05', 'Le protocole', contenu, true);
}
