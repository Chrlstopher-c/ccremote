// ============ Rendu des artefacts (bloc du fil) ============
//
// Un artefact est un contenu que l'orchestrateur produit lui-même — script
// shell/Python/Lua ou page HTML — affiché comme un bloc du fil, pas noyé dans
// une bulle de texte : code lisible, bouton de téléchargement, et pour le HTML
// une bascule code / rendu. Consommé par `hBlocNode` (harness-orchestrateur.js)
// sur `ev.type === 'artefact'`, avec la pièce servie par le Pi (`ev.pieces[0]`).
//
// ☠ LE RENDU HTML EST DU CONTENU PRODUIT PAR UN MODÈLE — IL N'EST PAS FIABLE.
// Il tourne dans un `<iframe sandbox="allow-scripts">`, SANS `allow-same-origin` :
// posé via `srcdoc`, sans cet attribut, le document reçoit une origine OPAQUE —
// aucun accès à `document.cookie` ni au `localStorage` de cette page, aucun
// accès au document parent (pas de `postMessage` accordé, pas de navigation du
// haut). `allow-scripts` seul permet à l'artefact de s'exécuter ; il ne peut
// pas lire la session de Chris.

const HA_TYPES = {
  'text/html': 'HTML',
  'text/x-sh': 'Shell',
  'text/x-python': 'Python',
  'text/x-lua': 'Lua',
};

function haTaille(octets) {
  if (octets >= 1024 * 1024) return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
  return `${Math.max(1, Math.round(octets / 1024))} Ko`;
}

/** Un seul fetch par artefact — la vue code et la vue rendu partagent le même texte. */
const haCache = new Map();
function haTexte(url) {
  if (haCache.has(url)) return haCache.get(url);
  const promesse = fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  });
  haCache.set(url, promesse);
  promesse.catch(() => haCache.delete(url));
  return promesse;
}

function haBrancherOnglets(carte, corpsCode, cadre) {
  const onglets = carte.querySelectorAll('.ac-tab');
  onglets.forEach((bouton) => {
    bouton.addEventListener('click', () => {
      onglets.forEach((b) => b.classList.remove('active'));
      bouton.classList.add('active');
      const rendu = bouton.dataset.vue === 'rendu';
      corpsCode.hidden = rendu;
      if (cadre) cadre.hidden = !rendu;
    });
  });
}

/** Carte d'un artefact dans le fil. `piece` vient de l'API : { nom, type, taille, url }. */
function haCarte(piece) {
  const carte = document.createElement('div');
  carte.className = 'artefact-card';
  if (!piece || !piece.url) {
    carte.innerHTML = `<div class="ac-head"><span class="ac-badge">Artefact</span><span class="ac-nom">indisponible — fichier introuvable sur le Pi</span></div>`;
    return carte;
  }
  const estHtml = piece.type === 'text/html';
  const libelle = HA_TYPES[piece.type] || piece.type;

  carte.innerHTML = `
    <div class="ac-head">
      <span class="ac-badge">${libelle}</span>
      <span class="ac-nom" title="${piece.nom}">${piece.nom}</span>
      <span class="ac-taille">${haTaille(piece.taille)}</span>
      <div class="ac-actions">
        ${estHtml
          ? '<button type="button" class="ac-tab active" data-vue="code">Code</button>' +
            '<button type="button" class="ac-tab" data-vue="rendu">Rendu</button>'
          : ''}
        <a class="ac-dl" href="${piece.url}" download="${piece.nom}" title="Télécharger">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/>
            <path d="M5 21h14"/></svg>
        </a>
      </div>
    </div>
    <div class="ac-body">
      <pre class="ac-code"><code>Chargement…</code></pre>
      ${estHtml ? '<iframe class="ac-frame" sandbox="allow-scripts" hidden></iframe>' : ''}
    </div>`;

  const code = carte.querySelector('.ac-code > code');
  const corpsCode = carte.querySelector('.ac-code');
  const cadre = carte.querySelector('.ac-frame');

  haTexte(piece.url)
    .then((texte) => {
      code.textContent = texte;
      // ☠ `srcdoc`, jamais `src` pointé sur l'URL servie : `srcdoc` donne une
      // origine opaque MÊME quand le contenu vient du même serveur — `src`
      // laisserait planer l'ambiguïté d'une origine héritée selon le navigateur.
      if (cadre) cadre.srcdoc = texte;
    })
    .catch(() => { code.textContent = 'contenu introuvable sur le Pi.'; });

  if (estHtml) haBrancherOnglets(carte, corpsCode, cadre);
  return carte;
}

window.HArtefacts = { carte: haCarte };
