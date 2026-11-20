// Responsabilité : le nom lisible d'un modèle pour la fiche (`modeleNom`) et l'écran de Lanterne.
// Le `displayName` du SDK (« Default (recommended) ») est de l'anglais : jamais affiché. On nomme l'identifiant
// réellement en usage, comme Lanterne le fait (`nom_modele`) : « claude-haiku-5-5 » → « Haiku 5.5 ».

export interface ModeleSdk {
  readonly value: string;
  readonly resolvedModel?: string;
  readonly displayName: string;
}

const DEFAUT_POSTE = 'défaut';
const DEFAUT_SDK = 'default';

/** Nom lisible d'un identifiant de modèle (même règle que Lanterne : claude- retiré, mots capitalisés, chiffres joints par des points). */
export function nomLisibleModele(identifiant: string): string {
  const sansDate = identifiant.replace(/-([0-9]{8})$/, '');
  const base = sansDate.startsWith('claude-') ? sansDate.slice('claude-'.length) : sansDate;
  const mots: string[] = [];
  for (const morceau of base.split('-').filter((m) => m !== '')) {
    const chiffres = /^[0-9]+$/.test(morceau);
    const dernier = mots.length > 0 ? mots[mots.length - 1] : undefined;
    if (chiffres && dernier !== undefined && /^[0-9.]+$/.test(dernier)) {
      mots[mots.length - 1] = `${dernier}.${morceau}`;
    } else {
      mots.push(chiffres ? morceau : morceau.charAt(0).toUpperCase() + morceau.slice(1));
    }
  }
  return mots.length > 0 ? mots.join(' ') : identifiant;
}

/** Identifiant effectif : le modèle voulu, ou, pour « défaut », le modèle que le compte résout aujourd'hui. */
export function modeleEffectif(voulu: string, modeles: readonly ModeleSdk[] | undefined): string | null {
  if (voulu !== DEFAUT_POSTE) return voulu;
  return modeles?.find((m) => m.value === DEFAUT_SDK)?.resolvedModel ?? null;
}

/** Nom affiché pour la fiche, ou null (Lanterne dérive alors de l'identifiant). Un modèle hors liste du SDK n'a pas de nom. */
export function nomAffiche(voulu: string, modeles: readonly ModeleSdk[] | undefined): string | null {
  const identifiant = modeleEffectif(voulu, modeles);
  if (identifiant === null) return null;
  const connu =
    voulu === DEFAUT_POSTE ||
    (modeles ?? []).some((m) => m.value !== DEFAUT_SDK && (m.value === identifiant || m.resolvedModel === identifiant));
  return connu ? nomLisibleModele(identifiant) : null;
}
