// ============ Dialogues — saisie et confirmation, à la charte de l'app ============
//
// ☠ `window.prompt` / `window.confirm` marchent, mais cassent la charte au pire
// moment : le seul instant où l'on demande une confirmation destructive est
// celui où l'on veut que l'utilisateur LISE. Une boîte système de Chrome au
// milieu d'une interface calquée sur Claude Code se lit comme un bug.
//
// Les deux fonctions rendent une promesse : `hInvite` → texte ou null,
// `hConfirmer` → booléen. Un seul nœud est créé, réutilisé, et retiré à la
// fermeture — rien ne s'accumule dans le DOM.

const H_DIALOGUE_ID = 'hDialogue';

function hFermerDialogue() {
  document.getElementById(H_DIALOGUE_ID)?.remove();
}

/**
 * Ouvre un dialogue et résout au choix de l'utilisateur.
 * `champ` non nul → une saisie ; sinon une simple confirmation.
 */
function hDialogue({ titre, texte, champ, valider, danger }) {
  return new Promise((resoudre) => {
    hFermerDialogue();
    const hote = document.createElement('div');
    hote.id = H_DIALOGUE_ID;
    hote.className = 'fixed inset-0 z-50 flex items-center justify-center modal-backdrop';
    const couleurTitre = danger ? 'var(--err)' : 'var(--ink)';
    const classeOk = danger ? 'btn-danger' : 'btn-primary';
    hote.innerHTML = `
      <div class="modal-in rounded-2xl border w-full max-w-sm mx-4 overflow-hidden"
           style="border-color: ${danger ? 'var(--err)' : 'var(--line)'}; background: var(--card);">
        <div class="px-6 pt-5 pb-4">
          <h3 class="serif text-[16px] font-medium mb-2" style="color: ${couleurTitre};">${hEchappe(titre)}</h3>
          ${texte ? `<p class="text-[12.5px] leading-relaxed" style="color: var(--ink-2);">${hEchappe(texte)}</p>` : ''}
          ${champ === undefined ? '' : `<input id="hDialogueChamp" class="w-full mt-3 rounded-lg border px-3 py-2 text-[13px]"
             style="border-color: var(--line); background: var(--bg); color: var(--ink);"
             value="${hEchappe(champ)}" autocomplete="off" spellcheck="false">`}
        </div>
        <div class="px-6 py-4 flex justify-end gap-2" style="background: var(--bg);">
          <button id="hDialogueAnnuler" class="btn-ghost rounded-lg px-4 py-2 text-[12.5px] font-medium">Annuler</button>
          <button id="hDialogueOk" class="${classeOk} rounded-lg px-4 py-2 text-[12.5px] font-medium">${hEchappe(valider)}</button>
        </div>
      </div>`;
    document.body.appendChild(hote);

    const saisie = document.getElementById('hDialogueChamp');
    const rendre = (valeur) => { hFermerDialogue(); resoudre(valeur); };
    const annule = () => rendre(champ === undefined ? false : null);
    const confirme = () => rendre(champ === undefined ? true : (saisie?.value.trim() || null));

    document.getElementById('hDialogueOk').addEventListener('click', confirme);
    document.getElementById('hDialogueAnnuler').addEventListener('click', annule);
    hote.addEventListener('mousedown', (e) => { if (e.target === hote) annule(); });
    hote.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') annule();
      // ☠ Entrée valide, mais SEULEMENT depuis le champ : sur une confirmation
      // destructive, une touche Entrée restée enfoncée déclencherait l'action.
      if (e.key === 'Enter' && saisie && e.target === saisie) confirme();
    });
    if (saisie) { saisie.focus(); saisie.select(); } else document.getElementById('hDialogueOk').focus();
  });
}

/** Demande un texte. Résout la valeur saisie, ou `null` si annulé ou vide. */
function hInvite(titre, valeurInitiale = '', valider = 'Renommer') {
  return hDialogue({ titre, champ: valeurInitiale, valider });
}

/** Demande une confirmation. Résout `true` seulement sur un accord explicite. */
function hConfirmer(titre, texte, valider = 'Supprimer') {
  return hDialogue({ titre, texte, valider, danger: true });
}

// ============ Choix de machine de travail (migration 22) ============
//
// ☠ Pourquoi un dialogue plutôt qu'un réglage global : la machine est fixée à la
// CRÉATION du fil et ne change plus ensuite (arbitré le 01/08 — une équipe ne
// doit pas changer de machine au milieu d'un chantier). Un réglage global se
// serait fatalement désynchronisé du fil en cours ; ici la question est posée
// une fois, au seul moment où la réponse a un effet.
//
// ☠ Une machine HORS LIGNE reste listée mais non sélectionnable. La masquer
// laisserait croire qu'elle n'existe pas ; l'offrir produirait un fil qu'aucun
// mandat ne pourrait servir.

/**
 * Demande sur quelle machine ouvrir un fil.
 * Résout : l'identifiant choisi · l'identifiant de l'unique machine en ligne
 * (aucune question posée) · `''` si aucune n'est en ligne · `null` si annulé.
 *
 * ☠ UNE SEULE MACHINE ⇒ toujours aucune question, mais son identifiant est
 * RENVOYÉ quand même. Renvoyer `''` laissait le fil sans machine en base, et le
 * routage tranchait « sans ambiguïté » tant que rien ne changeait — jusqu'à ce
 * que la seconde machine s'allume : à partir de cet instant, ce fil-là échouait
 * sur TOUTE opération (prod, 02/08). Le silence de l'interface ne doit pas se
 * traduire par une absence de décision en base.
 */
function hChoisirMachine(machines) {
  const enLigne = (machines || []).filter((m) => m.enLigne);
  if (enLigne.length === 0) return Promise.resolve('');
  // ☠ Un dialogue à un seul bouton n'est pas un choix, c'est un clic de plus.
  if (enLigne.length === 1) return Promise.resolve(enLigne[0].id);

  return new Promise((resoudre) => {
    hFermerDialogue();
    const hote = document.createElement('div');
    hote.id = H_DIALOGUE_ID;
    hote.className = 'fixed inset-0 z-50 flex items-center justify-center modal-backdrop';
    const lignes = (machines || []).map((m) => `
      <button class="h-machine-opt w-full text-left rounded-lg border px-3 py-2.5 mb-2 flex items-center gap-2.5"
              data-machine="${hEchappe(m.id)}" ${m.enLigne ? '' : 'disabled'}
              style="border-color: var(--line); background: var(--bg); color: var(--ink); ${m.enLigne ? '' : 'opacity:.45;cursor:not-allowed;'}">
        <span class="dot" style="background: ${m.enLigne ? 'var(--ok)' : 'var(--ink-3, #888)'};"></span>
        <span class="flex-1 text-[13px]">${hEchappe(m.id)}</span>
        <span class="text-[11px]" style="color: var(--ink-2);">${m.enLigne ? 'en ligne' : 'hors ligne'}</span>
      </button>`).join('');

    hote.innerHTML = `
      <div class="modal-in rounded-2xl border w-full max-w-sm mx-4 overflow-hidden"
           style="border-color: var(--line); background: var(--card);">
        <div class="px-6 pt-5 pb-4">
          <h3 class="serif text-[16px] font-medium mb-2" style="color: var(--ink);">Sur quelle machine ?</h3>
          <p class="text-[12.5px] leading-relaxed mb-3" style="color: var(--ink-2);">
            Les équipes de ce fil tourneront là-bas, sur les projets présents là-bas. Le choix est définitif pour ce fil.
          </p>
          ${lignes}
        </div>
        <div class="px-6 py-4 flex justify-end gap-2" style="background: var(--bg);">
          <button id="hDialogueAnnuler" class="btn-ghost rounded-lg px-4 py-2 text-[12.5px] font-medium">Annuler</button>
        </div>
      </div>`;
    document.body.appendChild(hote);

    const rendre = (valeur) => { hFermerDialogue(); resoudre(valeur); };
    hote.querySelectorAll('.h-machine-opt').forEach((b) => {
      if (b.disabled) return;
      b.addEventListener('click', () => rendre(b.dataset.machine));
    });
    document.getElementById('hDialogueAnnuler').addEventListener('click', () => rendre(null));
    hote.addEventListener('mousedown', (e) => { if (e.target === hote) rendre(null); });
    hote.addEventListener('keydown', (e) => { if (e.key === 'Escape') rendre(null); });
  });
}
