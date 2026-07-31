/**
 * Responsabilité : comptes Claude Code isolés par CLAUDE_CONFIG_DIR (H-53) et
 * instantanés de quota par compte (H-54).
 *
 * Sans le compte par mission, impossible d'attribuer une consommation ni de
 * savoir quoi redispatcher ailleurs quand un compte sature.
 */

import type { Database } from 'bun:sqlite';
import { fenetreEncoreSaturante } from '../../shared/saturation-compte.ts';
import { executer } from './journal.ts';
import { versCompte, versQuota, type LigneCompte, type LigneQuota } from './lignes.ts';
import type { Compte, CreationCompte, Quota, RelevéQuota } from './types.ts';

export class DepotComptes {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /** Upsert : le config_dir est l'identité physique, l'id l'identité logique. */
  public enregistrer(creation: CreationCompte, maintenant: number = Date.now()): Compte {
    return executer(
      'comptes.enregistrer',
      () => {
        this.db
          .query(
            `INSERT INTO compte
               (id, config_dir, email, organisation, type_abonnement, fournisseur_api, actif, cree_a, maj_a)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               config_dir = excluded.config_dir,
               email = COALESCE(excluded.email, compte.email),
               organisation = COALESCE(excluded.organisation, compte.organisation),
               type_abonnement = COALESCE(excluded.type_abonnement, compte.type_abonnement),
               fournisseur_api = COALESCE(excluded.fournisseur_api, compte.fournisseur_api),
               actif = excluded.actif,
               maj_a = excluded.maj_a`,
          )
          .run(
            creation.id,
            creation.configDir,
            creation.email ?? null,
            creation.organisation ?? null,
            creation.typeAbonnement ?? null,
            creation.fournisseurApi ?? null,
            (creation.actif ?? true) ? 1 : 0,
            maintenant,
            maintenant,
          );
        const compte = this.lire(creation.id);
        if (!compte) throw new Error(`compte « ${creation.id} » introuvable après écriture`);
        return compte;
      },
      { id: creation.id },
    );
  }

  public lire(id: string): Compte | null {
    return executer(
      'comptes.lire',
      () => {
        const ligne = this.db
          .query<LigneCompte, [string]>('SELECT * FROM compte WHERE id = ?')
          .get(id);
        return ligne ? versCompte(ligne) : null;
      },
      { id },
    );
  }

  public lister(): readonly Compte[] {
    return executer('comptes.lister', () => {
      const lignes = this.db.query<LigneCompte, []>('SELECT * FROM compte ORDER BY id').all();
      return lignes.map(versCompte);
    });
  }

  /**
   * Enregistre un relevé de quota (SDKRateLimitEvent ou méthode `usage`).
   * Dernier-gagne par (compte, fenêtre). `utilisation` est optionnel côté SDK :
   * ne pas écraser une valeur connue par un `undefined`.
   */
  /**
   * Renseigne l'identité mesurée d'un compte (email, abonnement). `☠` Seule la
   * SONDE connaît ces valeurs : l'interface les affichait en dur (« Max ») sur
   * des comptes réellement « Claude Pro » (23/07). N'écrase jamais avec du vide —
   * une sonde en échec ne doit pas effacer ce qu'on savait.
   */
  public majIdentiteMesuree(id: string, email: string | null, typeAbonnement: string | null, maintenant: number = Date.now()): void {
    executer(
      'comptes.majIdentiteMesuree',
      () => {
        this.db
          .query('UPDATE compte SET email = COALESCE(?, email), type_abonnement = COALESCE(?, type_abonnement), maj_a = ? WHERE id = ?')
          .run(email, typeAbonnement, maintenant, id);
      },
      { id },
    );
  }

  public releverQuota(releve: RelevéQuota): Quota {
    return executer(
      'comptes.releverQuota',
      () => {
        const observeA = releve.observeA ?? Date.now();
        this.db
          .query(
            `INSERT INTO quota_compte
               (compte_id, type_fenetre, statut, reset_a, utilisation,
                statut_overage, utilise_overage, seuil_depasse, observe_a)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(compte_id, type_fenetre) DO UPDATE SET
               statut = excluded.statut,
               reset_a = COALESCE(excluded.reset_a, quota_compte.reset_a),
               utilisation = COALESCE(excluded.utilisation, quota_compte.utilisation),
               statut_overage = COALESCE(excluded.statut_overage, quota_compte.statut_overage),
               utilise_overage = COALESCE(excluded.utilise_overage, quota_compte.utilise_overage),
               seuil_depasse = COALESCE(excluded.seuil_depasse, quota_compte.seuil_depasse),
               observe_a = excluded.observe_a`,
          )
          .run(
            releve.compteId,
            releve.typeFenetre,
            releve.statut,
            releve.resetA ?? null,
            releve.utilisation ?? null,
            releve.statutOverage ?? null,
            booleenOuNull(releve.utiliseOverage),
            releve.seuilDepasse ?? null,
            observeA,
          );
        const quota = this.lireQuota(releve.compteId, releve.typeFenetre);
        if (!quota) throw new Error('quota introuvable après écriture');
        return quota;
      },
      { compteId: releve.compteId, typeFenetre: releve.typeFenetre },
    );
  }

  public lireQuota(compteId: string, typeFenetre: string): Quota | null {
    return executer(
      'comptes.lireQuota',
      () => {
        const ligne = this.db
          .query<LigneQuota, [string, string]>(
            'SELECT * FROM quota_compte WHERE compte_id = ? AND type_fenetre = ?',
          )
          .get(compteId, typeFenetre);
        return ligne ? versQuota(ligne) : null;
      },
      { compteId, typeFenetre },
    );
  }

  public listerQuotas(compteId: string): readonly Quota[] {
    return executer(
      'comptes.listerQuotas',
      () => {
        const lignes = this.db
          .query<LigneQuota, [string]>(
            'SELECT * FROM quota_compte WHERE compte_id = ? ORDER BY type_fenetre',
          )
          .all(compteId);
        return lignes.map(versQuota);
      },
      { compteId },
    );
  }

  /**
   * Comptes actifs dont aucune fenêtre ne sature ENCORE — alimente la rotation
   * de H-53.
   *
   * `☠` Le filtre était en SQL (`NOT EXISTS … statut = 'rejected'`) et ignorait
   * `reset_a` : un `rejected` relevé une fois écartait le compte à vie tant que
   * la sonde ne le contredisait pas. Le tri se fait maintenant en TypeScript pour
   * que la règle vive dans `fenetreEncoreSaturante` et nulle part ailleurs — une
   * règle métier dupliquée entre SQL et TS diverge exactement comme
   * `MOTIFS_SATURATION` l'a fait. Le coût est nul : on compte les comptes sur
   * les doigts d'une main.
   */
  public listerDisponibles(maintenant: number = Date.now()): readonly Compte[] {
    return executer('comptes.listerDisponibles', () => {
      const lignes = this.db
        .query<LigneCompte, []>('SELECT * FROM compte WHERE actif = 1 ORDER BY id')
        .all();
      return lignes
        .map(versCompte)
        .filter((c) => !this.listerQuotas(c.id).some((q) => fenetreEncoreSaturante(q, maintenant)));
    });
  }

  /**
   * Mémorise le jeton d'accès OAuth relevé sur le PC. `☠` C'est ce qui permet au
   * Pi de continuer à mesurer les quotas PC ÉTEINT — sans lui, les jauges se
   * figeaient à la dernière valeur connue dès l'extinction du PC.
   *
   * `☠` Jeton d'ACCÈS uniquement. Le refresh token n'entre jamais dans cette
   * table : il est tournant, le faire tourner hors du CLI casserait le compte.
   */
  public poserJeton(compteId: string, jetonAcces: string, expireA: number, maintenant: number = Date.now()): void {
    executer(
      'comptes.poserJeton',
      () => {
        this.db
          .query(
            `INSERT INTO jeton_compte (compte_id, jeton_acces, expire_a, releve_a)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(compte_id) DO UPDATE SET
               jeton_acces = excluded.jeton_acces,
               expire_a = excluded.expire_a,
               releve_a = excluded.releve_a`,
          )
          .run(compteId, jetonAcces, expireA, maintenant);
      },
      { compteId },
    );
  }

  /**
   * Jetons connus, expirés COMPRIS : c'est l'appelant qui décide quoi en faire.
   * Les filtrer ici priverait l'écran de la raison pour laquelle une jauge ne
   * bouge plus — « jeton expiré » n'est pas la même chose que « aucun compte ».
   */
  public listerJetons(): readonly { readonly compteId: string; readonly jetonAcces: string; readonly expireA: number }[] {
    return executer('comptes.listerJetons', () => {
      const lignes = this.db
        .query<{ compte_id: string; jeton_acces: string; expire_a: number }, []>(
          'SELECT compte_id, jeton_acces, expire_a FROM jeton_compte ORDER BY compte_id',
        )
        .all();
      return lignes.map((l) => ({ compteId: l.compte_id, jetonAcces: l.jeton_acces, expireA: l.expire_a }));
    });
  }
}

function booleenOuNull(valeur: boolean | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null;
  return valeur ? 1 : 0;
}
