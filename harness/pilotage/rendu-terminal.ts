/**
 * Responsabilité : rendre lisible au terminal ce que le harness renvoie.
 *
 * `☠` Séparé du client par une raison précise : ce qui se lit ici doit pouvoir
 * changer sans toucher au chemin qui mesure. Un banc dont la mise en forme et la
 * mesure vivent dans la même fonction finit par « arrondir » ce qu'il affiche, et
 * un chiffre arrondi à l'affichage est un chiffre qu'on ne peut plus recouper.
 */

import type { EvenementFil, MissionParc } from './client-pilote.ts';

const LARGEUR_APERCU = 150;

/** Un événement de fil en une ligne — type, horodatage, aperçu. */
export function ligneEvenement(ev: EvenementFil): string {
  const heure = new Date(ev.at).toLocaleTimeString('fr-FR');
  const apercu = ev.contenu.replace(/\s+/g, ' ').trim().slice(0, LARGEUR_APERCU);
  const marque = ev.type === 'operateur' ? '›' : ev.type === 'texte' ? '‹' : '·';
  return `${marque} ${heure}  ${ev.type.padEnd(12)} ${apercu}`;
}

/**
 * `☠` Le texte du modèle sort ENTIER, jamais tronqué. C'est la seule sortie du
 * banc qu'on lit pour juger de la QUALITÉ d'une réponse — la tronquer reviendrait
 * à comparer des modèles sur leurs 150 premiers caractères.
 */
export function texteEntier(evenements: readonly EvenementFil[]): string {
  return evenements
    .filter((e) => e.type === 'texte')
    .map((e) => e.contenu)
    .join('\n');
}

export function tableauMissions(missions: readonly MissionParc[]): string {
  const lignes = missions.map(
    (m) =>
      `${m.id.slice(0, 8)}  ${String(m.state).padEnd(9)} ${fmtUsd(m.cost).padStart(8)}  ` +
      `${(m.model ?? '—').padEnd(18)} ${String(m.project).padEnd(14)} ${String(m.title).slice(0, 46)}`,
  );
  const total = missions.reduce((s, m) => s + (Number(m.cost) || 0), 0);
  return [
    `${'id'.padEnd(8)}  ${'état'.padEnd(9)} ${'coût'.padStart(8)}  ${'modèle'.padEnd(18)} ${'projet'.padEnd(14)} objectif`,
    ...lignes,
    `— ${missions.length} équipes, total ${fmtUsd(total)}`,
  ].join('\n');
}

export function fmtUsd(n: number): string {
  return `${(Number(n) || 0).toFixed(2)} $`;
}

/**
 * Ce que chaque tour a coûté, par appel d'outil et par texte rendu.
 * `☠` Compte les événements RÉELS du fil : la seule façon de savoir si un tour
 * a brûlé vingt appels d'outils pour trois lignes de réponse.
 */
export function profilTour(evenements: readonly EvenementFil[]): string {
  const parType = new Map<string, number>();
  for (const e of evenements) parType.set(e.type, (parType.get(e.type) ?? 0) + 1);
  const detail = [...parType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t}×${n}`)
    .join('  ');
  const outils = evenements.filter((e) => e.type === 'outil').map((e) => e.contenu.replace('mcp__ccremote-controle__', ''));
  return [`${evenements.length} évènements : ${detail}`, outils.length > 0 ? `outils : ${outils.join(', ')}` : ''].filter(Boolean).join('\n');
}
