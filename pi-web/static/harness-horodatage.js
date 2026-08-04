// ============ Horodatage et durées, partagés par les trois fils ============
//
// Un seul endroit pour « quand » et « combien de temps » : le chat de
// l'orchestrateur, le fil d'une équipe et le fil d'un sous-agent. Trois formats
// distincts auraient rendu deux vues incomparables — c'est précisément entre
// elles qu'on compare quand on cherche pourquoi un tour a duré.
//
// ☠ Les durées se calculent sur `at` (millisecondes epoch), JAMAIS sur `ts`
// (`HH:MM:SS`). Une soustraction d'heures murales donne −86 340 s au passage de
// minuit — et une équipe lancée le soir travaille des deux côtés.

/** Heure d'un instant, à la minute : c'est ce qu'on lit dans un fil. */
function hHeure(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Heure à la seconde — pour un fil dense où deux évènements partagent la minute. */
function hHeureSec(ms) {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Durée lisible. La précision suit l'ordre de grandeur : sous la minute, le
 * dixième de seconde compte ; au-delà de l'heure, la seconde ne veut plus rien
 * dire.
 */
function hDuree(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) {
    const s = ms / 1000;
    return s < 10 ? `${s.toFixed(1).replace('.', ',')} s` : `${Math.round(s)} s`;
  }
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  if (min < 60) {
    const s = totalSec % 60;
    return s === 0 ? `${min} min` : `${min} min ${s} s`;
  }
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, '0')}`;
}

/**
 * Le pied d'un message : l'heure, et la durée quand elle a un sens.
 *
 * ☠ `duree` ABSENTE ≠ durée nulle. Un message d'opérateur n'a pas de durée (il
 * est instantané), un tour encore en cours non plus — afficher « 0 s » dans ces
 * deux cas ferait croire à une réponse immédiate.
 */
function hPiedTemps(at, duree, prefixe) {
  const pied = document.createElement('div');
  pied.className = 'msg-pied mono';
  const morceaux = [];
  if (prefixe) morceaux.push(prefixe);
  const heure = hHeure(at);
  if (heure) {
    morceaux.push(heure);
    pied.title = new Date(at).toLocaleString('fr-FR');
  }
  const d = hDuree(duree);
  if (d) morceaux.push(d);
  if (morceaux.length === 0) return null;
  pied.textContent = morceaux.join(' · ');
  return pied;
}

/** Même pied, en HTML — les fils d'équipe se rendent par chaînes, pas par nœuds. */
function hPiedTempsHtml(at, duree, prefixe) {
  const morceaux = [];
  if (prefixe) morceaux.push(prefixe);
  const heure = hHeure(at);
  if (heure) morceaux.push(heure);
  const d = hDuree(duree);
  if (d) morceaux.push(d);
  if (morceaux.length === 0) return '';
  const titre = Number.isFinite(at) ? ` title="${new Date(at).toLocaleString('fr-FR')}"` : '';
  return `<div class="msg-pied mono"${titre}>${morceaux.join(' · ')}</div>`;
}

/**
 * Étendue d'un segment : début, fin, et durée écoulée entre les deux.
 *
 * ☠ Un segment d'UN seul évènement n'a pas de durée : son début est sa fin. On
 * rend `null` plutôt que `0`, pour que le pied n'affiche rien du tout.
 */
function hEtendue(items) {
  const instants = (items || []).map((e) => e.at).filter((v) => Number.isFinite(v));
  if (instants.length === 0) return { debut: null, fin: null, duree: null };
  const debut = Math.min(...instants);
  const fin = Math.max(...instants);
  return { debut, fin, duree: instants.length > 1 && fin > debut ? fin - debut : null };
}

window.HTemps = { heure: hHeure, heureSec: hHeureSec, duree: hDuree, pied: hPiedTemps, piedHtml: hPiedTempsHtml, etendue: hEtendue };
