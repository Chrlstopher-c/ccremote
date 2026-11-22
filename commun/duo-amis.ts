// Responsabilité : les contrats de la liste d'amis du mode duo — identifiant d'un emplacement, état d'un ami vu par les
// clients, corps de la suspension. Aucune logique : elle est dans relais/duo/amis*.ts.
import { z } from 'zod';
import { EtatDuo } from './duo.ts';

/** Emplacement du premier ami : le duo d'avant (lien direct, base du relais). */
export const ID_AMI_PRINCIPAL = 'principal';
/** Identifiant d'un ami ajouté : 12 caractères hexadécimaux, son dossier porte ce nom. */
export const IDENTIFIANT_AMI_AJOUTE = /^[a-f0-9]{12}$/;

export const IdAmi = z.string().regex(/^(principal|[a-f0-9]{12})$/);
export type IdAmi = z.infer<typeof IdAmi>;

export const AmiDuo = z.object({
  id: IdAmi,
  nom: z.string().nullable(),
  utilisateur: z.string().nullable(),
  etat: EtatDuo.shape.etat,
  suspendu: z.boolean(),
  transport: z.enum(['direct', 'aiguilleur']).nullable(),
  appairage: z.boolean(),
});
export type AmiDuo = z.infer<typeof AmiDuo>;

export const CorpsSuspendre = z.object({ suspendu: z.boolean() });
export type CorpsSuspendre = z.infer<typeof CorpsSuspendre>;
