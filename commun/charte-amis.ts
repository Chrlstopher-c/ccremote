// Responsabilité : les droits qu'un chef accorde aux amis du duo, machine par machine — ce qu'une machine permet à un
// ami (vérifié par la machine visée) et l'édition de ces droits (charte non signée). Fonctions pures.
import { type Charte, type Edition, droitRequis, estChef, membreDe, type RequeteDroit } from './charte.ts';
import { AUCUN_DROIT, type AmiCharte, type Droits, ID_MEMBRE } from './charte-droits.ts';

/** Droits d'un ami du duo sur une machine : fermés sans charte, sans ami, ou pour une machine non listée. */
export function droitsAmiSur(charte: Charte | null, ami: string, machine: string): Droits {
  const droits = charte?.amis?.find((a) => a.ami === ami)?.machines[machine];
  return droits ? { ...droits } : { ...AUCUN_DROIT };
}

/** Vrai si la machine visée (celle qui reçoit la requête) accorde à l'ami du duo ce que la requête exige. */
export function autoriseAmi(charte: Charte | null, ami: string, machine: string, requete: RequeteDroit): boolean {
  return droitsAmiSur(charte, ami, machine)[droitRequis(requete)];
}

/** Règle les droits d'un ami du duo sur une machine du réseau (chef seulement) ; rend une charte non signée. */
export function regleDroitsAmi(
  c: Charte,
  auteur: string,
  ami: string,
  machine: string,
  droits: Droits,
  le: string,
): Edition {
  if (!estChef(c, auteur)) return { ok: false, raison: 'auteur non chef' };
  if (!ID_MEMBRE.safeParse(ami).success) return { ok: false, raison: "identifiant d'ami invalide" };
  const cible = membreDe(c, machine);
  if (cible === null || cible.invite !== undefined || cible.sorte === 'telephone') {
    return { ok: false, raison: 'machine non permise' };
  }
  const actuel = c.amis?.find((a) => a.ami === ami);
  const entree: AmiCharte = { ami, machines: { ...actuel?.machines, [machine]: { ...droits } } };
  const autres = (c.amis ?? []).filter((a) => a.ami !== ami);
  return { ok: true, charte: { ...c, version: c.version + 1, par: auteur, le, amis: [...autres, entree] } };
}
