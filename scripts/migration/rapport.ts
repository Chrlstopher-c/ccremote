// Responsabilité : le compte rendu chiffré d'une migration de fiches (ajouts, mises à jour, ignorés) et son affichage.

export interface Compte {
  readonly lus: number;
  readonly ajoutes: number;
  readonly misesAJour: number;
  readonly ignores: number;
}

export interface Rapport {
  readonly simulation: boolean;
  readonly cible: string;
  readonly machineLocale: string;
  readonly sessions: Compte;
  readonly evenements: Compte;
  readonly artefacts: number;
  readonly environnements: Compte;
  readonly machinesSsh: Compte & { readonly retirees: number };
}

export function compte(lus: number, ajoutes: number, misesAJour: number): Compte {
  return { lus, ajoutes, misesAJour, ignores: lus - ajoutes - misesAJour };
}

const fr = (n: number): string => n.toLocaleString('fr-FR');

function ligne(nom: string, c: Compte): string {
  const morceaux = [`${fr(c.lus)} lus`, `${fr(c.ajoutes)} ajoutés`, `${fr(c.misesAJour)} mis à jour`];
  return `${nom.padEnd(16)}${[...morceaux, `${fr(c.ignores)} ignorés`].join(' · ')}`;
}

export function formaterRapport(r: Rapport): string[] {
  const mode = r.simulation ? ' (simulation, aucune écriture dans la cible)' : '';
  const artefacts = `${'artefacts'.padEnd(16)}${fr(r.artefacts)} événements d'artefact dans le fil`;
  return [
    `migrer-fiches${mode} : ${r.cible}`,
    `machine locale retirée des machines SSH : ${r.machineLocale}`,
    ligne('sessions', r.sessions),
    ligne('événements', r.evenements),
    `${artefacts} (fichiers restés sur leur machine)`,
    ligne('environnements', r.environnements),
    `${ligne('machines SSH', r.machinesSsh)} · ${fr(r.machinesSsh.retirees)} retirée(s)`,
  ];
}
