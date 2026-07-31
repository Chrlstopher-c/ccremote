// ============ Rendu markdown — ce que les leads écrivent réellement ============
//
// ☠ Sans ça, un rapport arrivait à l'écran en markdown BRUT : « ## 7. Ouvert »,
// des `**` autour des mots, et surtout des tableaux de mesures rendus en lignes
// de pipes. C'est la forme sous laquelle un lead rend son travail — la seule
// chose qu'on vient lire à la fin d'une mission était donc la moins lisible.
//
// ☠ Aucune dépendance, et c'est une contrainte, pas un choix de style : la page
// est servie par le Pi derrière un tunnel, un CDN ne serait ni souverain ni
// disponible hors ligne.

function hMdEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * ☠ Le code inline sort SANS fond ni bordure. Dans un corps en serif, encadrer
 * chaque terme technique fabrique des pavés qui hachent la ligne et cassent la
 * césure — mesuré à l'écran le 01/08. Seule la police change.
 */
function hMdInline(s) {
  return hMdEscape(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}

function hMdTable(lignes, i) {
  const cellules = (r) => r.split('|').slice(1, -1).map((c) => c.trim());
  const entete = cellules(lignes[i]);
  let j = i + 2;
  const corps = [];
  while (j < lignes.length && /^\|/.test(lignes[j])) corps.push(cellules(lignes[j++]));
  // Le conteneur défile seul : une table large ne doit jamais faire défiler la page.
  const html = `<div class="md-tw"><table><thead><tr>${entete.map((h) => `<th>${hMdInline(h)}</th>`).join('')}` +
    `</tr></thead><tbody>${corps.map((r) => `<tr>${r.map((c) => `<td>${hMdInline(c)}</td>`).join('')}</tr>`).join('')}` +
    '</tbody></table></div>';
  return { html, suivant: j };
}

function hMdListe(lignes, i) {
  const ordonnee = /^\s*\d+\./.test(lignes[i]);
  const items = [];
  let j = i;
  while (j < lignes.length) {
    const m = lignes[j].match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (!m) break;
    items.push(m[1]);
    j += 1;
  }
  const balise = ordonnee ? 'ol' : 'ul';
  return { html: `<${balise}>${items.map((t) => `<li>${hMdInline(t)}</li>`).join('')}</${balise}>`, suivant: j };
}

/** Rend un markdown en HTML sûr : tout passe par `hMdEscape` avant balisage. */
function hMarkdown(source) {
  const lignes = String(source || '').replace(/\r/g, '').split('\n');
  const sortie = [];
  const paragraphe = [];
  let i = 0;
  const vider = () => {
    if (paragraphe.length) {
      sortie.push(`<p>${hMdInline(paragraphe.join(' '))}</p>`);
      paragraphe.length = 0;
    }
  };
  while (i < lignes.length) {
    const l = lignes[i];
    if (/^```/.test(l)) {
      vider();
      const bloc = [];
      i += 1;
      while (i < lignes.length && !/^```/.test(lignes[i])) bloc.push(lignes[i++]);
      i += 1;
      sortie.push(`<pre><code>${hMdEscape(bloc.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\|/.test(l) && /^\|[\s:—-]+\|/.test(lignes[i + 1] || '')) {
      vider();
      const t = hMdTable(lignes, i);
      sortie.push(t.html);
      i = t.suivant;
      continue;
    }
    const titre = l.match(/^(#{1,4})\s+(.*)$/);
    if (titre) {
      vider();
      sortie.push(`<h${titre[1].length}>${hMdInline(titre[2])}</h${titre[1].length}>`);
      i += 1;
      continue;
    }
    if (/^---+$/.test(l)) {
      vider();
      sortie.push('<hr>');
      i += 1;
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(l)) {
      vider();
      const li = hMdListe(lignes, i);
      sortie.push(li.html);
      i = li.suivant;
      continue;
    }
    if (!l.trim()) {
      vider();
      i += 1;
      continue;
    }
    paragraphe.push(l);
    i += 1;
  }
  vider();
  return sortie.join('');
}
