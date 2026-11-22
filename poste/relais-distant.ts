// Responsabilité : lire la configuration du relais distant d'un poste seul (moteur embarqué relié au réseau central).
// Sans les deux variables, le moteur garde son relais local ; avec une seule, la configuration est refusée.

export const VARIABLE_RELAIS_DISTANT = 'LANTERNE_RELAIS_DISTANT';
export const VARIABLE_JETON_DISTANT = 'LANTERNE_RELAIS_DISTANT_JETON';

export interface RelaisDistant {
  readonly url: string;
  readonly jeton: string;
}

type Env = Readonly<Record<string, string | undefined>>;

export function lireRelaisDistant(env: Env): RelaisDistant | null {
  const url = env[VARIABLE_RELAIS_DISTANT]?.trim() ?? '';
  const jeton = env[VARIABLE_JETON_DISTANT]?.trim() ?? '';
  if (!url && !jeton) return null;
  if (!url) throw new Error(`${VARIABLE_RELAIS_DISTANT} absent alors que ${VARIABLE_JETON_DISTANT} est posé`);
  if (!jeton) throw new Error(`${VARIABLE_JETON_DISTANT} absent alors que ${VARIABLE_RELAIS_DISTANT} est posé`);
  if (!/^wss?:\/\//.test(url)) throw new Error(`${VARIABLE_RELAIS_DISTANT} doit commencer par ws:// ou wss://`);
  return { url, jeton };
}
