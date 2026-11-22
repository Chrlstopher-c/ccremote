// Déroulé d'un ajout avec un faux SSH et une fausse fédération : empreintes comparées, accord de Chris exigé, reprise
// des épinglages ; empreintes différentes = demande refusée ; machine injoignable ; retour arrière.
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { ResumeSession } from '../../commun/session.ts';
import type { EtatFederation } from '../federation/etat-federation.ts';
import { ficheDe } from '../federation/banc-federation.ts';
import { ok } from '../federation/resultat.ts';
import type { ConnexionSsh, ResultatSsh } from '../machines/ssh.ts';
import { AjoutNoeud } from './ajout-noeud.ts';

const E_NOEUD = 'AAAA 0000 1111 2222 3333 4444 5555 6666 7777 8888 9999 AAAA BBBB CCCC DDDD EEEE';
const E_ICI = 'FFFF 0000 1111 2222 3333 4444 5555 6666 7777 8888 9999 AAAA BBBB CCCC DDDD EEEE';
const MEMBRE = 'abcdefabcdef';
const ICI = '0123456789ab';
const CONNEXION: ConnexionSsh = { hote: 'machine.exemple.test', port: 22, utilisateur: 'chris', cle: '/cle' };

interface Banc {
  readonly ajout: AjoutNoeud;
  readonly etat: { demandes: EtatFederation['demandes']; noeuds: EtatFederation['noeuds'] };
  readonly commandes: string[];
  readonly epinglees: string[];
  readonly decisions: [string, boolean][];
}

function sortieScript(empreinteDemande: string): string {
  return ['@etape verification', '@etape bascule', '@etape aiguilleur', `@membre ${MEMBRE}`, `@empreinte ${E_NOEUD}`,
    '@etape appairage', `@empreinte-pair ${empreinteDemande}`, '@fin'].join('\n');
}

function banc(options: { injoignable?: boolean; empreintePair?: string; distantes?: ResumeSession[] } = {}): Banc {
  const etat: Banc['etat'] = { demandes: [], noeuds: [] };
  const commandes: string[] = [];
  const epinglees: string[] = [];
  const decisions: [string, boolean][] = [];
  const resultat = (sortie: string, code = 0): ResultatSsh => ({ code, sortie, erreurs: '', delaiDepasse: false });
  const ajout = new AjoutNoeud({
    ssh: {
      executer: async (_c, commande, _entree, _delai, surLigne) => {
        commandes.push(commande.split('\n')[0] ?? '');
        if (options.injoignable) return resultat('', 255);
        if (commande.includes('aiguilleur.json')) return resultat('@neuf');
        if (commande.includes('gzip -dc')) return resultat('@sha a1b2c3d4e5f6');
        if (commande === 'bash -s') {
          const sortie = sortieScript(options.empreintePair ?? E_ICI);
          for (const l of sortie.split('\n')) surLigne?.(l);
          const empreinte = E_NOEUD;
          etat.demandes = [{ id: 'd1', membre: MEMBRE, nom: 'Tour', empreinte, empreinteLocale: E_ICI, genre: 'noeud',
            le: '' }];
          return resultat(sortie);
        }
        return resultat('');
      },
    },
    connexionDe: (m) => (m === 'tour' ? CONNEXION : null),
    federation: {
      etat: async () =>
        ({
          aiguilleur: { url: 'http://aiguilleur.exemple.test:8080', id: ICI, nom: 'Portable', proprietaire: 'chris',
            relie: true, motif: null },
          empreinteLocale: E_ICI,
          membres: [],
          appairages: [],
          ...etat,
        }) as EtatFederation, // essai : seuls les champs lus par l'ajout sont remplis
      decider: (id, accord) => {
        decisions.push([id, accord]);
        etat.demandes = [];
        const noeud = { id: MEMBRE, nom: 'Tour', empreinte: E_NOEUD, enLigne: true, liaisonOuverte: true };
        if (accord) etat.noeuds = [noeud];
        return true;
      },
      revoquer: (membre) => {
        etat.noeuds = etat.noeuds.filter((n) => n.id !== membre);
        return ok(null);
      },
      sessionsDe: () => options.distantes ?? [ficheDe('s-1', 'tour', 'Une'), ficheDe('s-2', 'tour', 'Deux')],
    },
    creerCode: async () => ok({ code: 'ABCD-EFGH' }),
    sources: () => ({ binaireGz: new Uint8Array([1]), codePoste: new Uint8Array([2]) }),
    sessionsLocales: () => [{ ...ficheDe('s-1', 'tour', 'Une'), epinglee: true }, ficheDe('s-2', 'tour', 'Deux')],
    epingler: async (id) => {
      epinglees.push(id);
      return true;
    },
    signaler: () => undefined,
    journal: pino({ level: 'silent' }),
    delais: { demandeMs: 2000, accordMs: 2000, lienMs: 2000, instantaneMs: 200, pasMs: 10 },
  });
  return { ajout, etat, commandes, epinglees, decisions };
}

async function jusqua(b: Banc, etat: string): Promise<void> {
  for (let i = 0; i < 300; i += 1) {
    if (b.ajout.liste()[0]?.etat === etat) return;
    await Bun.sleep(10);
  }
  throw new Error(`état ${etat} jamais atteint : ${JSON.stringify(b.ajout.liste()[0])}`);
}

describe('AjoutNoeud', () => {
  test('parcours complet : concordance, accord de Chris, lien, épinglage reporté', async () => {
    const b = banc();
    const r = await b.ajout.lancer({ machine: 'tour', nom: 'Tour' });
    expect(r.ok).toBe(true);
    await jusqua(b, 'accord_attendu');
    const vue = b.ajout.liste()[0]!;
    expect(vue.concordance).toBe('identique');
    expect(vue.empreinteSsh).toBe(E_NOEUD);
    expect(vue.empreinteDemande).toBe(E_NOEUD);
    expect(vue.bascule).toBe(true);
    expect(b.decisions).toEqual([]); // rien n'est accordé sans Chris
    expect(b.ajout.accepter('tour').ok).toBe(true);
    await jusqua(b, 'fini');
    expect(b.epinglees).toEqual(['s-1']);
    expect(b.ajout.liste()[0]?.reprise).toEqual({ retrouvees: 2, absentes: 0, epinglees: 1, archivees: 0 });
    expect(b.commandes).toContain('bash -s');
  });

  test('empreinte de cette machine altérée en route : demande refusée, échec', async () => {
    const b = banc({ empreintePair: E_NOEUD });
    await b.ajout.lancer({ machine: 'tour', nom: 'Tour' });
    await jusqua(b, 'echec');
    expect(b.ajout.liste()[0]?.concordance).toBe('differente');
    expect(b.decisions).toEqual([['d1', false]]);
    expect(b.ajout.accepter('tour').ok).toBe(false);
  });

  test('machine injoignable par SSH : échec lisible, rien d’autre', async () => {
    const b = banc({ injoignable: true });
    await b.ajout.lancer({ machine: 'tour', nom: 'Tour' });
    await jusqua(b, 'echec');
    expect(b.ajout.liste()[0]?.message).toBe('machine injoignable par SSH');
    expect(b.commandes).toHaveLength(1);
  });

  test('accès SSH inconnu : refusé avant tout', async () => {
    const r = await banc().ajout.lancer({ machine: 'vps', nom: 'VPS' });
    expect(r.ok).toBe(false);
  });

  test('retour arrière : script distant puis révocation', async () => {
    const b = banc();
    await b.ajout.lancer({ machine: 'tour', nom: 'Tour' });
    await jusqua(b, 'accord_attendu');
    b.ajout.accepter('tour');
    await jusqua(b, 'fini');
    expect((await b.ajout.retour('tour')).ok).toBe(true);
    expect(b.commandes.at(-1)).toContain('retour-arriere.sh');
    expect(b.etat.noeuds).toEqual([]);
    expect(b.ajout.liste()[0]?.etat).toBe('retire');
  });
});
