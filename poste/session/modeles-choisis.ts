// Responsabilité : le modèle choisi par Remote Control sur une conversation tenue ailleurs (Claude Desktop,
// terminal), gardé par le poste dans son dossier de données. Il survit au redémarrage du poste et s'ajoute aux
// sources datées du modèle réel (transcript, fiche Desktop) : le plus récent gagne. Une conversation = une entrée.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { type ModeleDate, plusRecent } from '../../commun/modele-date.ts';

const SCHEMA_CHOIX = z.record(z.string(), z.object({ modele: z.string(), le: z.string().nullable() }));

export class ModelesChoisis {
  private readonly modeles = new Map<string, ModeleDate>();

  constructor(
    private readonly fichier: string,
    private readonly journal: Logger,
  ) {
    this.lire();
  }

  /** Le modèle choisi pour une conversation, ou null. */
  pour(conversation: string): ModeleDate | null {
    return this.modeles.get(conversation) ?? null;
  }

  /** Relit le fichier (fusion : le plus récent par conversation gagne) ; un fichier illisible n'ajoute rien. */
  lire(): void {
    const brut = this.charger();
    for (const [conversation, choix] of Object.entries(brut)) this.retenir(conversation, choix);
  }

  /** Garde le choix (s'il est plus récent que celui déjà gardé) et l'écrit sur disque. */
  ecrire(conversation: string, choix: ModeleDate): void {
    if (!this.retenir(conversation, choix)) return;
    this.sauver();
  }

  private retenir(conversation: string, choix: ModeleDate): boolean {
    const deja = this.modeles.get(conversation);
    if (deja && plusRecent(deja, choix) === deja) return false;
    this.modeles.set(conversation, choix);
    return true;
  }

  private sauver(): void {
    try {
      mkdirSync(dirname(this.fichier), { recursive: true });
      const contenu = JSON.stringify(Object.fromEntries(this.modeles));
      writeFileSync(`${this.fichier}.tmp`, contenu);
      renameSync(`${this.fichier}.tmp`, this.fichier);
    } catch (erreur) {
      this.journal.error({ err: erreur, fichier: this.fichier }, 'modèles choisis non écrits');
    }
  }

  private charger(): Record<string, ModeleDate> {
    if (!existsSync(this.fichier)) return {};
    try {
      const lu = SCHEMA_CHOIX.safeParse(JSON.parse(readFileSync(this.fichier, 'utf8')));
      if (lu.success) return lu.data;
      this.journal.warn({ fichier: this.fichier }, 'modèles choisis : format inattendu, ignoré');
    } catch (erreur) {
      this.journal.warn({ err: erreur, fichier: this.fichier }, 'modèles choisis : fichier illisible, ignoré');
    }
    return {};
  }
}
