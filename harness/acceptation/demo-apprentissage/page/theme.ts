/**
 * Responsabilité : la charte visuelle — variables CSS et feuille de style complète, en
 * une seule constante exportée, inline dans le document produit. Aucune police externe,
 * aucun import, aucune image : tout tient dans ce fichier.
 */

export const FEUILLE_DE_STYLE = `
:root {
  --fond: #0A0A0B;
  --surface: #121214;
  --surface-haute: #17171A;
  --bord: #232326;
  --texte: #E9E6E1;
  --texte-doux: #9C9791;
  --texte-faible: #6B6762;
  --sans-lecon: #C2703F;
  --avec-lecon: #4E9CB9;
  --hors-sujet: #6E6A66;
  --serif: Iowan Old Style, "Palatino Linotype", Palatino, Charter, Georgia, "Times New Roman", serif;
  --mono: ui-monospace, "SF Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--fond);
  color: var(--texte);
}

body {
  font-family: var(--serif);
  font-size: 17px;
  line-height: 1.65;
}

.bandeau-factice {
  position: sticky;
  top: 0;
  z-index: 10;
  width: 100%;
  background: #3A1D14;
  border-bottom: 2px solid #C2703F;
  color: #F0C9B4;
  padding: 18px 24px;
}

.bandeau-factice-interieur { max-width: 1000px; margin: 0 auto; }

.bandeau-factice-titre {
  font-family: var(--mono);
  font-weight: 700;
  letter-spacing: 0.02em;
  margin: 0 0 6px 0;
}

.bandeau-factice-raison { margin: 0; font-family: var(--mono); font-size: 14px; }

.section { padding: 48px 24px; }
.section:first-of-type { padding-top: 64px; }

.bloc-prose { max-width: 68ch; margin: 0 auto; }
.bloc-large { max-width: 1000px; margin: 0 auto; }

.titre-section {
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 28px 0;
}

.numero-section {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--texte-faible);
  margin-right: 10px;
}

h1 { font-family: var(--serif); font-size: 34px; font-weight: 600; margin: 0 0 16px 0; }

.these { color: var(--texte-doux); font-size: 19px; margin: 0 0 24px 0; }

.provenance {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--texte-faible);
  border-top: 1px solid var(--bord);
  padding-top: 16px;
}

p { margin: 0 0 16px 0; }

table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: 13px;
}

th, td {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--bord);
  vertical-align: top;
}

th { color: var(--texte-faible); font-weight: 500; }

.pastille {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-right: 6px;
}

blockquote {
  margin: 0;
  padding: 12px 20px;
  border-left: 3px solid var(--avec-lecon);
  color: var(--texte-doux);
  font-family: var(--serif);
  font-style: italic;
}

pre {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--texte);
  background: var(--surface);
  border: 1px solid var(--bord);
  border-radius: 2px;
  padding: 16px;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.bloc-mandat {
  font-family: var(--mono);
  font-size: 13px;
  background: var(--surface);
  border: 1px solid var(--bord);
  border-radius: 2px;
  padding: 16px;
  max-height: 320px;
  overflow-y: auto;
  white-space: pre-wrap;
}

.bloc-lecon {
  font-family: var(--mono);
  font-size: 13px;
  background: var(--surface);
  padding: 14px 16px;
  margin-top: 12px;
  white-space: pre-wrap;
}

.condition-carte {
  border: 1px solid var(--bord);
  border-radius: 2px;
  padding: 16px;
  margin-bottom: 16px;
  background: var(--surface);
}

.condition-nom { font-family: var(--mono); font-size: 14px; }

.graphique-titre { font-family: var(--serif); font-size: 17px; margin: 0 0 4px 0; }
.graphique-bloc { margin-bottom: 56px; }

.legende { display: flex; gap: 20px; font-family: var(--mono); font-size: 12px; color: var(--texte-doux);
  margin: 8px 0 16px 0; }
.legende-item { display: flex; align-items: center; }

svg text { font-family: var(--mono); }
.valeur-non-mesuree { color: var(--texte-faible); font-style: italic; }

.deux-colonnes { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
@media (max-width: 760px) {
  .deux-colonnes { grid-template-columns: 1fr; }
  h1 { font-size: 27px; }
}

.colonne-trace {
  border: 1px solid var(--bord);
  border-left-width: 3px;
  border-radius: 2px;
  padding: 16px;
  background: var(--surface);
}

.colonne-trace-titre { font-family: var(--mono); font-size: 13px; margin: 0 0 12px 0; color: var(--texte-doux); }

.ligne-trace { font-family: var(--mono); font-size: 13px; margin-bottom: 8px; }
.ligne-trace-outil { color: var(--texte); font-weight: 700; }

.trace-injection-chemin { font-family: var(--mono); font-size: 12px; color: var(--texte-faible); margin: 0 0 4px 0; }

ul.liste-limites { padding-left: 20px; }
ul.liste-limites li { margin-bottom: 14px; }

footer {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--texte-faible);
  border-top: 1px solid var(--bord);
  padding: 32px 24px 64px 24px;
  text-align: center;
}
`;
