// Responsabilité : tests unitaires du téléphone chef (ports factices) — lecture de la charte par niveau (membre,
// chef), charte signée proposée puis demande tranchée, ordre vérifié et rejoué, demandes listées et refusées,
// rejeux des routes d'ajout et d'activité, routes inconnues.
import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import { ajouterMembre, type Charte, type CharteSignee, creerCharte, TOUS_DROITS } from '../../commun/charte.ts';
import { exporterIdentitePublique, genererIdentite, type Identite } from '../../commun/chiffrement/identite.ts';
import type { OrdreMachine } from '../../commun/ordre-machine.ts';
import { signerOrdre } from '../../commun/ordre-machine.ts';
import type { DemandeAppareil, MethodeApi, ServirAppareil } from './appareils.ts';
import { ChefAppareil, type PortChefAppareil } from './chef-appareil.ts';
import type { DemandeAppairage } from './demandes.ts';
import { echec, ok, type Resultat } from './resultat.ts';

const RESEAU = '111111111111';
const NOEUD = 'bbbbbbbbbbbb';
const CHEF = 'aaaaaaaaaaaa';
const MEMBRE = 'cccccccccccc';
const CIBLE = 'dddddddddddd';
const INCONNU = 'eeeeeeeeeeee';
const LE = new Date().toISOString();
const NONCE = 'e'.repeat(32);
const PREFIXE = '/api/reseau/telephone';
const SIGNATURE_FACTICE = 'A'.repeat(86);

interface Monde {
  readonly charte: Charte;
  readonly chef: Identite;
  readonly autre: Identite;
}

interface Options {
  readonly charte: Charte | null;
  readonly proposer?: Resultat<Charte>;
  readonly agir?: Resultat<null>;
  readonly demandes?: DemandeAppairage[];
  readonly sansRejeu?: boolean;
}

interface Trace {
  readonly proposes: CharteSignee[];
  readonly agis: string[];
  readonly decisions: [string, boolean][];
  readonly rejeux: string[];
}

async function monde(): Promise<Monde> {
  const chef = await genererIdentite();
  const autre = await genererIdentite();
  const base = creerCharte({
    reseau: RESEAU,
    nom: 'Test',
    moi: { id: CHEF, nom: 'téléphone', identite: exporterIdentitePublique(chef.publique) },
    le: LE,
  });
  const avec = ajouterMembre(
    base,
    CHEF,
    {
      id: MEMBRE,
      nom: 'autre',
      sorte: 'telephone',
      identite: exporterIdentitePublique(autre.publique),
      droits: TOUS_DROITS,
      compte: null,
    },
    LE,
  );
  if (!avec.ok) throw new Error(avec.raison);
  return { charte: avec.charte, chef, autre };
}

function port(o: Options, t: Trace): PortChefAppareil {
  const { charte } = o;
  const rejouer: ServirAppareil | undefined = o.sansRejeu
    ? undefined
    : async (d) => {
        t.rejeux.push(d.chemin);
        return { statut: 200, corps: '{"rejoue":true}' };
      };
  return {
    journal: pino({ enabled: false }),
    charte: () => charte,
    signee: () => null,
    moi: () => NOEUD,
    estChef: (membre) => charte?.chefs.includes(membre) ?? false,
    proposer: async (signee) => {
      t.proposes.push(signee);
      return o.proposer ?? echec(403, 'signature');
    },
    machinesReseau: async () => [],
    agir: async (membre, action) => {
      t.agis.push(`${membre}:${action}`);
      return o.agir ?? ok(null);
    },
    demandes: () => o.demandes ?? [],
    decider: (id, accord) => {
      t.decisions.push([id, accord]);
      return !['absente', 'inconnue'].includes(id);
    },
    rejouer,
  };
}

function trace(): Trace {
  return { proposes: [], agis: [], decisions: [], rejeux: [] };
}

function requete(methode: MethodeApi, chemin: string, corps?: unknown): DemandeAppareil {
  return { methode, chemin, corps: corps === undefined ? undefined : JSON.stringify(corps) };
}

async function ordreSigne(m: Monde, action: OrdreMachine['action'], par = CHEF): Promise<unknown> {
  const cle = par === CHEF ? m.chef : m.autre;
  const ordre: OrdreMachine = {
    format: 1,
    reseau: RESEAU,
    cible: CIBLE,
    action,
    par,
    le: new Date().toISOString(),
    nonce: NONCE,
  };
  return { ordre: await signerOrdre(ordre, cle.signaturePrivee) };
}

function servirAvec(o: Options, t: Trace, membre = CHEF): (d: DemandeAppareil) => ReturnType<ChefAppareil['servir']> {
  const chef = new ChefAppareil(port(o, t));
  return (d) => chef.servir(membre, d);
}

describe('lecture de la charte', () => {
  test('un membre lit la charte ; le chef est signalé ; un non-chef ne l’est pas', async () => {
    const m = await monde();
    const t = trace();
    const servir = servirAvec({ charte: m.charte }, t);
    const chef = await servir(requete('GET', `${PREFIXE}/charte`));
    expect(chef.statut).toBe(200);
    expect(JSON.parse(chef.corps)).toMatchObject({ noeud: NOEUD, appareil: CHEF, chef: true });
    const non = await servirAvec({ charte: m.charte }, t, MEMBRE)(requete('GET', `${PREFIXE}/charte`));
    expect(JSON.parse(non.corps)).toMatchObject({ appareil: MEMBRE, chef: false });
  });

  test('un appareil hors du réseau : 403 ; sans charte, la lecture rend null et le reste 409', async () => {
    const m = await monde();
    const t = trace();
    const hors = await servirAvec({ charte: m.charte }, t, INCONNU)(requete('GET', `${PREFIXE}/charte`));
    expect(hors.statut).toBe(403);
    const sans = servirAvec({ charte: null }, t);
    const lu = await sans(requete('GET', `${PREFIXE}/charte`));
    expect(JSON.parse(lu.corps)).toMatchObject({ charte: null, signee: null, chef: false });
    expect((await sans(requete('GET', `${PREFIXE}/machines`))).statut).toBe(409);
  });
});

describe('charte signée proposée', () => {
  test('un non-chef est refusé : 403, rien proposé', async () => {
    const m = await monde();
    const t = trace();
    const r = await servirAvec({ charte: m.charte }, t, MEMBRE)(
      requete('POST', `${PREFIXE}/charte`, { texte: JSON.stringify(m.charte), signature: SIGNATURE_FACTICE }),
    );
    expect(r.statut).toBe(403);
    expect(JSON.parse(r.corps)).toMatchObject({ erreur: 'réservé aux chefs du réseau' });
    expect(t.proposes).toEqual([]);
  });

  test('une charte dont le signataire n’est pas ce téléphone : 403', async () => {
    const m = await monde();
    const t = trace();
    const forgee = JSON.stringify({ ...m.charte, par: MEMBRE });
    const r = await servirAvec({ charte: m.charte }, t)(
      requete('POST', `${PREFIXE}/charte`, { texte: forgee, signature: SIGNATURE_FACTICE }),
    );
    expect(r.statut).toBe(403);
    expect(JSON.parse(r.corps)).toMatchObject({ erreur: 'signataire autre que cet appareil' });
    expect(t.proposes).toEqual([]);
  });

  test('proposée et acceptée : la demande liée est tranchée (acceptee, ou introuvable)', async () => {
    const m = await monde();
    const t = trace();
    const servir = servirAvec({ charte: m.charte, proposer: ok(m.charte) }, t);
    const corps = { texte: JSON.stringify(m.charte), signature: SIGNATURE_FACTICE, demande: 'existante' };
    const r = await servir(requete('POST', `${PREFIXE}/charte`, corps));
    expect(r.statut).toBe(200);
    expect(JSON.parse(r.corps)).toMatchObject({ chef: true, demande: 'acceptee' });
    const autre = await servir(requete('POST', `${PREFIXE}/charte`, { ...corps, demande: 'absente' }));
    expect(JSON.parse(autre.corps)).toMatchObject({ demande: 'introuvable' });
    expect(t.decisions).toEqual([
      ['existante', true],
      ['absente', true],
    ]);
  });

  test('refusée par le nœud : son statut et sa raison passent, aucune demande tranchée', async () => {
    const m = await monde();
    const t = trace();
    const refus = echec<Charte>(409, 'version ancienne');
    const r = await servirAvec({ charte: m.charte, proposer: refus }, t)(
      requete('POST', `${PREFIXE}/charte`, {
        texte: JSON.stringify(m.charte),
        signature: SIGNATURE_FACTICE,
        demande: 'existante',
      }),
    );
    expect(r.statut).toBe(409);
    expect(JSON.parse(r.corps)).toMatchObject({ erreur: 'version ancienne' });
    expect(t.decisions).toEqual([]);
  });
});

describe('ordre signé vers une machine', () => {
  test('un non-chef ne peut pas agir sur une machine : 403', async () => {
    const m = await monde();
    const t = trace();
    const r = await servirAvec({ charte: m.charte }, t, MEMBRE)(
      requete('POST', `${PREFIXE}/machines/${CIBLE}/action`, await ordreSigne(m, 'pause', MEMBRE)),
    );
    expect(r.statut).toBe(403);
    expect(t.agis).toEqual([]);
  });

  test('un ordre du chef pour la cible : agi ; le même ordre une seconde fois : refusé (rejoué)', async () => {
    const m = await monde();
    const t = trace();
    const servir = servirAvec({ charte: m.charte }, t);
    const corps = await ordreSigne(m, 'pause');
    expect((await servir(requete('POST', `${PREFIXE}/machines/${CIBLE}/action`, corps))).statut).toBe(200);
    expect(t.agis).toEqual([`${CIBLE}:pause`]);
    const rejoue = await servir(requete('POST', `${PREFIXE}/machines/${CIBLE}/action`, corps));
    expect(rejoue.statut).toBe(403);
    expect(JSON.parse(rejoue.corps)).toMatchObject({ erreur: 'ordre refusé : rejoue' });
    expect(t.agis).toHaveLength(1);
  });

  test('un ordre signé par un membre non chef : refusé par la vérification', async () => {
    const m = await monde();
    const t = trace();
    const r = await servirAvec({ charte: m.charte }, t)(
      requete('POST', `${PREFIXE}/machines/${CIBLE}/action`, await ordreSigne(m, 'arreter', MEMBRE)),
    );
    expect(JSON.parse(r.corps)).toMatchObject({ erreur: 'ordre refusé : non-chef' });
    expect(t.agis).toEqual([]);
  });
});

describe('demandes d’appairage', () => {
  const demande = (id: string, avecMembre: boolean): DemandeAppairage => ({
    id,
    ...(avecMembre ? { membre: 'ffffffffffff', identite: 'x'.repeat(86) } : {}),
    nom: 'Nouveau',
    empreinte: 'e1',
    empreinteLocale: 'e2',
    genre: 'appareil',
    le: LE,
  });

  test('listées seulement quand elles ont un membre et une identité ; refusées par id', async () => {
    const m = await monde();
    const t = trace();
    const demandes = [demande('avec', true), demande('sans', false)];
    const servir = servirAvec({ charte: m.charte, demandes }, t);
    const liste = await servir(requete('GET', `${PREFIXE}/demandes`));
    expect(JSON.parse(liste.corps).demandes.map((d: { id: string }) => d.id)).toEqual(['avec']);
    expect((await servir(requete('POST', `${PREFIXE}/demandes/avec/refuser`))).statut).toBe(200);
    expect(t.decisions).toEqual([['avec', false]]);
    expect((await servir(requete('POST', `${PREFIXE}/demandes/inconnue/refuser`))).statut).toBe(404);
  });

  test('un non-chef ne voit pas les demandes', async () => {
    const m = await monde();
    const r = await servirAvec({ charte: m.charte }, trace(), MEMBRE)(requete('GET', `${PREFIXE}/demandes`));
    expect(r.statut).toBe(403);
  });
});

describe('rejeux et routes inconnues', () => {
  test('un rejeu part vers la route locale, même corps et même query ; sans rejeu : 503', async () => {
    const m = await monde();
    const t = trace();
    const servir = servirAvec({ charte: m.charte }, t);
    const codes = await servir(requete('POST', `${PREFIXE}/codes`, { proprietaire: 'chris' }));
    expect(codes.statut).toBe(200);
    await servir(requete('GET', `${PREFIXE}/ajouts?x=1`));
    await servir(requete('POST', `${PREFIXE}/ajouts/tour/retour`, { ok: true }));
    await servir(requete('GET', `${PREFIXE}/invites/${MEMBRE}/activite`));
    expect(t.rejeux).toEqual([
      '/api/federation/codes',
      '/api/reseau/ajouts?x=1',
      '/api/reseau/ajouts/tour/retour',
      `/api/reseau/invites/${MEMBRE}/activite`,
    ]);
    const sans = await servirAvec({ charte: m.charte, sansRejeu: true }, t)(requete('POST', `${PREFIXE}/codes`, {}));
    expect(sans.statut).toBe(503);
  });

  test('une route inconnue du téléphone : 404', async () => {
    const m = await monde();
    const r = await servirAvec({ charte: m.charte }, trace())(requete('GET', `${PREFIXE}/inconnue`));
    expect(r.statut).toBe(404);
  });
});
