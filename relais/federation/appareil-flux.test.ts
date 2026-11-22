// Responsabilité : ce qu'un appareil obtient du nœud par l'aiguilleur réel, au-delà de l'API — flux en direct (deltas
// regroupés, ordre gardé), images et fichiers binaires intacts dans les deux sens (morceaux), terminal d'une session
// du nœud, et révocation qui se dit « révoqué » à chaque retour.
import { expect, test } from 'bun:test';
import { ficheDe, attendre, monterAiguilleur } from './banc-federation.ts';
import { appairerAppareil, nouveauNoeud, TABLE_PAR_DEFAUT } from './banc-appareil.ts';
import { pngDeBruit } from './banc-png.ts';
import type { TableInterne } from './executeur.ts';
import type { ClientTerminal } from '../appareils/terminaux.ts';
import type { MessageClient } from '../../commun/api-clients.ts';

const attendreTout = (condition: () => boolean) => attendre(condition, 6000);

test('le flux du nœud arrive dans le canal : deltas regroupés, ordre du direct gardé', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await nouveauNoeud(monte);
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    expect(canal.envoyer({ t: 'diffusion_ouvrir' })).toBe(true);
    await attendreTout(() => appareil.acquitter.length > 0);
    noeud.diffusion.diffuser({ type: 'flux', sessionId: 's1', bloc: 'b', delta: 'Bon' });
    noeud.diffusion.diffuser({ type: 'flux', sessionId: 's1', bloc: 'b', delta: 'jour' });
    noeud.diffusion.diffuser({ type: 'session', session: ficheDe('s1', 'tour', 'Titre') });
    await attendreTout(() => appareil.diffusions.length >= 2);
    const [flux, session] = appareil.diffusions.map((texte) => JSON.parse(texte) as MessageClient);
    expect(flux).toEqual({ type: 'flux', sessionId: 's1', bloc: 'b', delta: 'Bonjour' });
    expect(session).toMatchObject({ type: 'session', session: { id: 's1' } });
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});

test('un appareil ne reçoit jamais les messages de fédération (instantané, confirmation) : son canal tient', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await nouveauNoeud(monte);
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    expect(canal.envoyer({ t: 'diffusion_ouvrir' })).toBe(true);
    await attendreTout(() => appareil.acquitter.length > 0);
    noeud.diffusion.diffuser({ type: 'session', session: ficheDe('s1', 'tour', 'Titre') });
    await attendreTout(() => appareil.diffusions.length >= 1);
    await Bun.sleep(600);
    expect(appareil.horsProtocole).toEqual([]);
    expect(canal.ouvert).toBe(true);
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});

test('un second abonnement du même canal est acquitté, sans doubler les événements', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await nouveauNoeud(monte);
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    expect(canal.envoyer({ t: 'diffusion_ouvrir' })).toBe(true);
    await attendreTout(() => appareil.acquitter.length > 0);
    expect(canal.envoyer({ t: 'diffusion_ouvrir' })).toBe(true);
    await attendreTout(() => appareil.acquitter.length > 1);
    noeud.diffusion.diffuser({ type: 'session', session: ficheDe('s1', 'tour', 'Titre') });
    await attendreTout(() => appareil.diffusions.length >= 1);
    await Bun.sleep(150);
    expect(appareil.diffusions).toHaveLength(1);
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});

test('une image PNG de quelques centaines de Ko arrive intacte, octet pour octet', async () => {
  const monte = monterAiguilleur();
  const png = pngDeBruit(400);
  const table: TableInterne = {
    ...TABLE_PAR_DEFAUT,
    '/api/sessions/:id/fichiers/:fichier': {
      GET: () => new Response(png, { headers: { 'content-type': 'image/png' } }),
    },
  };
  const { noeud, id } = await nouveauNoeud(monte, table);
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    const reponse = await appareil.appeler(canal, '/api/sessions/s1/fichiers/image.png');
    expect(reponse.statut).toBe(200);
    expect(reponse.codage).toBe('base64');
    expect(reponse.type).toBe('image/png');
    expect(Buffer.from(reponse.corps, 'base64').equals(Buffer.from(png))).toBe(true);
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});

test('un fichier envoyé par l’appareil arrive intact au nœud, en morceaux', async () => {
  const monte = monterAiguilleur();
  const png = pngDeBruit(300);
  const table: TableInterne = {
    ...TABLE_PAR_DEFAUT,
    '/api/televersement': {
      PUT: async (req) => {
        const octets = Buffer.from(await req.arrayBuffer());
        return Response.json({ base64: octets.toString('base64'), type: req.headers.get('content-type') });
      },
    },
  };
  const { noeud, id } = await nouveauNoeud(monte, table);
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    const ref = appareil.suivant();
    const reponse = appareil.attendreReponse(ref);
    appareil.envoyerGros(canal, {
      t: 'api',
      ref,
      methode: 'PUT',
      chemin: '/api/televersement',
      corps: Buffer.from(png).toString('base64'),
      codage: 'base64',
      type: 'image/png',
    });
    const recue = JSON.parse((await reponse).corps) as { base64: string; type: string };
    expect(recue.base64).toBe(Buffer.from(png).toString('base64'));
    expect(recue.type).toBe('image/png');
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});

test('le terminal d’une session du nœud passe par le canal : sortie et saisie dans les deux sens', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await nouveauNoeud(monte);
  noeud.federation.terminaux.brancher({
    ouvert: async (ws: ClientTerminal) => {
      ws.send(new TextEncoder().encode('$ '));
      return true;
    },
    recu: (ws: ClientTerminal, message: string | Buffer) => {
      if (typeof message !== 'string') ws.send(message);
    },
    ferme: () => undefined,
  });
  noeud.registre.enregistrerSession(ficheDe('s1', 'tour', 'Terminal'));
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    const ref = appareil.suivant();
    canal.envoyer({ t: 'terminal_ouvrir', ref, terminal: 't1', session: 's1', colonnes: 80, lignes: 24 });
    await attendreTout(() => appareil.reponsesTerminal.has(ref));
    expect(appareil.reponsesTerminal.get(ref)).toEqual({ ok: true, raison: undefined });
    const saisie = Buffer.from('ls -la\n').toString('base64');
    canal.envoyer({ t: 'terminal_entree', terminal: 't1', base64: saisie });
    await attendreTout(() => (appareil.sorties.get('t1') ?? []).includes(saisie));
    expect(appareil.sorties.get('t1')?.[0]).toBe(Buffer.from('$ ').toString('base64'));
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});

test('un appareil révoqué est refusé « révoqué » quand il revient, et non « inconnu »', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await nouveauNoeud(monte);
  try {
    const { appareil } = await appairerAppareil(monte, noeud, id);
    expect((await noeud.federation.revoquer(appareil.membre)).ok).toBe(true);
    await attendre(() => appareil.fermes.includes('ap-1'));
    appareil.ouvrir('lien-2', id, 'lien');
    await attendre(() => appareil.refusees.length > 0);
    expect(appareil.refusees).toEqual(['révoqué']);
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});

test('le terminal d’une machine du nœud passe par le canal ; un poste hors ligne se dit à l’appareil', async () => {
  const monte = monterAiguilleur();
  const { noeud, id } = await nouveauNoeud(monte);
  const sorties: string[] = [];
  noeud.federation.terminaux.brancher({
    ouvert: async (ws: ClientTerminal) => {
      if (ws.data.machine !== 'tour') {
        ws.send(JSON.stringify({ type: 'erreur', message: 'poste hors ligne' }));
        ws.close(4409, 'terminal refusé');
        return false;
      }
      ws.send(new TextEncoder().encode('$ '));
      return true;
    },
    recu: (ws: ClientTerminal, message: string | Buffer) => {
      if (typeof message !== 'string') ws.send(message);
    },
    ferme: (ws: ClientTerminal) => void sorties.push(ws.data.terminal),
  });
  try {
    const { appareil, canal } = await appairerAppareil(monte, noeud, id);
    const ouvrir = (ref: string, terminal: string, machine: string) =>
      canal.envoyer({ t: 'terminal_poste', ref, terminal, machine, cible: { type: 'shell' }, colonnes: 80, lignes: 24 });
    const ref = appareil.suivant();
    ouvrir(ref, '6f1d2c3e-0000-4000-8000-000000000001', 'tour');
    await attendreTout(() => appareil.reponsesTerminal.has(ref));
    expect(appareil.reponsesTerminal.get(ref)).toEqual({ ok: true, raison: undefined });
    const saisie = Buffer.from('pwd\n').toString('base64');
    canal.envoyer({ t: 'terminal_entree', terminal: '6f1d2c3e-0000-4000-8000-000000000001', base64: saisie });
    await attendreTout(() => (appareil.sorties.get('6f1d2c3e-0000-4000-8000-000000000001') ?? []).includes(saisie));
    canal.envoyer({ t: 'terminal_fermer', terminal: '6f1d2c3e-0000-4000-8000-000000000001' });
    await attendreTout(() => sorties.includes('6f1d2c3e-0000-4000-8000-000000000001'));

    const refHors = appareil.suivant();
    ouvrir(refHors, '6f1d2c3e-0000-4000-8000-000000000002', 'portable');
    await attendreTout(() => appareil.reponsesTerminal.has(refHors));
    expect(appareil.reponsesTerminal.get(refHors)).toEqual({ ok: false, raison: 'poste hors ligne' });
  } finally {
    noeud.federation.arreter();
    monte.serveur.stop(true);
  }
});
