// Responsabilité : suivre les sous-agents d'une session — chacun a son transcript dans `<session>/subagents/`,
// rattaché par son `.meta.json` à l'appel d'outil qui l'a lancé : le fil montre ce que fait chaque agent.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Evenement } from '../../commun/session.ts';
import { LecteurTranscript } from './transcript.ts';
import { traduire } from './traduction.ts';

export class SuiviSousAgents {
  private readonly dossier: string;
  private readonly suivis = new Map<string, { lecteur: LecteurTranscript; agent: string }>();

  constructor(transcriptPrincipal: string) {
    this.dossier = join(transcriptPrincipal.replace(/\.jsonl$/, ''), 'subagents');
  }

  lire(): Evenement[] {
    if (!existsSync(this.dossier)) return [];
    for (const f of readdirSync(this.dossier)) if (f.endsWith('.jsonl') && !this.suivis.has(f)) this.suivre(f);
    const evts: Evenement[] = [];
    for (const { lecteur, agent } of this.suivis.values()) for (const l of lecteur.lire()) evts.push(...traduire(l, agent));
    return evts;
  }

  private suivre(fichier: string): void {
    const meta = join(this.dossier, fichier.replace(/\.jsonl$/, '.meta.json'));
    let agent = fichier.replace(/^agent-|\.jsonl$/g, '');
    try {
      const m = JSON.parse(readFileSync(meta, 'utf8')) as { toolUseId?: unknown };
      if (typeof m.toolUseId === 'string') agent = m.toolUseId;
    } catch {
      // meta pas encore écrit : l'agent reste identifié par son propre id, rattaché plus tard par le client si besoin
    }
    this.suivis.set(fichier, { lecteur: new LecteurTranscript(join(this.dossier, fichier)), agent });
  }
}
