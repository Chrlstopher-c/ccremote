// ============ Pièces jointes du composeur orchestrateur ============
//
// Trois gestes, une seule file d'attente : le trombone, le COLLAGE (⌘/Ctrl+V
// d'une capture) et le glisser-déposer. Le collage est le geste réel — on prend
// une capture et on la colle ; passer par un sélecteur de fichiers pour ça est
// une friction qu'on ne subit nulle part ailleurs.
//
// ☠ CE MODULE N'EST PAS L'AUTORITÉ SUR CE QUI EST ACCEPTÉ. Les plafonds et les
// types ci-dessous sont un MIROIR de `control-plane/pieces-jointes/` — ils
// existent pour refuser tout de suite, avant de faire monter 20 Mo pour rien, et
// pour l'affichage. Le refus qui fait foi vient du serveur, et son message est
// montré tel quel : il nomme les types et les plafonds. Si les deux divergent un
// jour, c'est le serveur qui a raison et l'écran le dira.
//
// ☠ Les octets ne partent PAS avec la bulle optimiste : le message affiché tout
// de suite montre des vignettes locales (objectURL), et les vraies pièces
// arrivent au prochain sondage avec leur URL servie par le Pi. Confondre les
// deux ferait tenir en mémoire la totalité des captures d'un fil.

const HP_TYPES = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'application/pdf': 'PDF',
  'text/plain': 'texte',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
  'application/json': 'JSON',
};
const HP_MAX_FICHIERS = 6;
const HP_MAX_OCTETS = 10 * 1024 * 1024;
const HP_MAX_TOTAL = 25 * 1024 * 1024;

const hPieces = {
  /** File d'attente du prochain message : { id, nom, type, taille, base64, apercu } */
  file: [],
  surChangement: null,
  compteur: 0,
};

function hpTaille(octets) {
  if (octets >= 1024 * 1024) return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
  return `${Math.max(1, Math.round(octets / 1024))} Ko`;
}

function hpEstImage(type) {
  return typeof type === 'string' && type.startsWith('image/') && HP_TYPES[type] !== undefined;
}

/** Message de refus — dit le nom du fichier ET la règle, jamais « fichier invalide ». */
function hpRefus(fichier, motif) {
  return `« ${fichier.name || 'fichier'} » ${motif}`;
}

function hpVerifier(fichier) {
  if (HP_TYPES[fichier.type] === undefined) {
    return hpRefus(fichier, `de type ${fichier.type || 'inconnu'} — acceptés : ${Object.values(HP_TYPES).join(', ')}`);
  }
  if (fichier.size > HP_MAX_OCTETS) {
    return hpRefus(fichier, `fait ${hpTaille(fichier.size)} — plafond 10 Mo par fichier`);
  }
  if (hPieces.file.length >= HP_MAX_FICHIERS) return `déjà ${HP_MAX_FICHIERS} pièces jointes — plafond par message`;
  const total = hPieces.file.reduce((s, p) => s + p.taille, 0) + fichier.size;
  if (total > HP_MAX_TOTAL) return hpRefus(fichier, 'dépasse le plafond de 25 Mo pour un message');
  return null;
}

/** Lit un fichier en base64 nu (sans l'en-tête `data:`) — ce que l'API attend. */
function hpEnBase64(fichier) {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => rejeter(new Error('lecture du fichier impossible'));
    lecteur.onload = () => {
      const brut = String(lecteur.result || '');
      const virgule = brut.indexOf(',');
      resoudre(virgule === -1 ? brut : brut.slice(virgule + 1));
    };
    lecteur.readAsDataURL(fichier);
  });
}

/**
 * Ajoute des fichiers à la file. Rend la liste des refus — l'appelant les
 * AFFICHE : un fichier silencieusement ignoré se lit comme un fichier joint.
 */
async function hpAjouter(fichiers) {
  const refus = [];
  for (const fichier of fichiers) {
    const motif = hpVerifier(fichier);
    if (motif !== null) { refus.push(motif); continue; }
    try {
      const base64 = await hpEnBase64(fichier);
      hPieces.compteur += 1;
      hPieces.file.push({
        id: `p${hPieces.compteur}`,
        // Le presse-papier ne nomme pas ce qu'il donne : sans ça, toutes les
        // captures d'un fil s'appelleraient « image.png ».
        nom: fichier.name || `capture-${Date.now()}.${(fichier.type.split('/')[1] || 'png')}`,
        type: fichier.type,
        taille: fichier.size,
        base64,
        apercu: hpEstImage(fichier.type) ? URL.createObjectURL(fichier) : null,
      });
    } catch (e) {
      refus.push(hpRefus(fichier, `illisible (${e.message})`));
    }
  }
  hpRendreFile();
  hPieces.surChangement?.();
  return refus;
}

function hpRetirer(id) {
  const piece = hPieces.file.find((p) => p.id === id);
  if (piece?.apercu) URL.revokeObjectURL(piece.apercu);
  hPieces.file = hPieces.file.filter((p) => p.id !== id);
  hpRendreFile();
  hPieces.surChangement?.();
}

/**
 * Vide la file après un envoi réussi. ☠ Les objectURL sont révoqués : sinon la
 * mémoire du navigateur garde chaque capture du fil.
 */
function hpVider() {
  for (const piece of hPieces.file) if (piece.apercu) URL.revokeObjectURL(piece.apercu);
  hPieces.file = [];
  hpRendreFile();
  hPieces.surChangement?.();
}

/** Ce qui part à l'API — jamais l'objectURL, qui n'a de sens que dans cet onglet. */
function hpPourEnvoi() {
  return hPieces.file.map((p) => ({ nom: p.nom, type: p.type, donneesBase64: p.base64 }));
}

function hpVignette({ nom, type, taille, apercu, url }, surRetrait) {
  const noeud = document.createElement('div');
  noeud.className = 'pj-vignette';
  noeud.title = `${nom} — ${HP_TYPES[type] || type}, ${hpTaille(taille)}`;
  const source = apercu || url;
  if (hpEstImage(type) && source) {
    const img = document.createElement('img');
    img.src = source;
    img.alt = nom;
    noeud.appendChild(img);
  } else {
    const doc = document.createElement('span');
    doc.className = 'pj-doc';
    doc.textContent = (HP_TYPES[type] || 'fichier').slice(0, 8);
    noeud.appendChild(doc);
  }
  const legende = document.createElement('span');
  legende.className = 'pj-nom';
  legende.textContent = nom;
  noeud.appendChild(legende);
  if (surRetrait) {
    const croix = document.createElement('button');
    croix.className = 'pj-x';
    croix.type = 'button';
    croix.title = 'Retirer';
    croix.textContent = '×';
    croix.addEventListener('click', surRetrait);
    noeud.appendChild(croix);
  }
  return noeud;
}

function hpRendreFile() {
  const hote = document.getElementById('hPiecesFile');
  if (!hote) return;
  hote.innerHTML = '';
  hote.style.display = hPieces.file.length === 0 ? 'none' : 'flex';
  for (const piece of hPieces.file) {
    hote.appendChild(hpVignette(piece, () => hpRetirer(piece.id)));
  }
}

/**
 * Rend les pièces d'un message déjà envoyé (bulle du fil). `pieces` vient de
 * l'API : chacune porte son `url`, servie par le Pi derrière la session.
 */
function hpRendrePieces(pieces) {
  if (!Array.isArray(pieces) || pieces.length === 0) return null;
  const bloc = document.createElement('div');
  bloc.className = 'pj-jointes';
  for (const piece of pieces) {
    const vignette = hpVignette(piece, null);
    if (piece.url) {
      vignette.classList.add('cliquable');
      vignette.addEventListener('click', () => window.open(piece.url, '_blank', 'noopener'));
    }
    bloc.appendChild(vignette);
  }
  return bloc;
}

/**
 * Branche les trois entrées sur le composeur.
 *
 * ☠ Le `paste` n'appelle `preventDefault` QUE s'il a pris des fichiers : sinon
 * il casserait le collage de texte, qui est l'usage majoritaire du même raccourci.
 */
function hpBrancher({ zoneSaisie, coque, bouton, input, surChangement, surRefus }) {
  hPieces.surChangement = surChangement || null;
  const signaler = (refus) => { if (refus.length > 0) surRefus?.(refus); };

  bouton?.addEventListener('click', () => input?.click());
  input?.addEventListener('change', async () => {
    signaler(await hpAjouter([...(input.files || [])]));
    // Sans ça, re-choisir le MÊME fichier ne déclencherait aucun `change`.
    input.value = '';
  });

  zoneSaisie?.addEventListener('paste', async (e) => {
    const fichiers = [...(e.clipboardData?.items || [])]
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter(Boolean);
    if (fichiers.length === 0) return;
    e.preventDefault();
    signaler(await hpAjouter(fichiers));
  });

  if (coque) {
    const survol = (actif) => (e) => {
      e.preventDefault();
      coque.classList.toggle('pj-survol', actif);
    };
    coque.addEventListener('dragover', survol(true));
    coque.addEventListener('dragleave', survol(false));
    coque.addEventListener('drop', async (e) => {
      e.preventDefault();
      coque.classList.remove('pj-survol');
      signaler(await hpAjouter([...(e.dataTransfer?.files || [])]));
    });
  }
}

window.HPieces = {
  brancher: hpBrancher,
  ajouter: hpAjouter,
  vider: hpVider,
  pourEnvoi: hpPourEnvoi,
  rendrePieces: hpRendrePieces,
  file: () => hPieces.file,
  taille: hpTaille,
};
