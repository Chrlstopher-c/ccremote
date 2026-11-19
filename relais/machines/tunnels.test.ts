import { describe, expect, test } from 'bun:test';
import { argumentsTunnel, attenteRelance, type CibleTunnel, phraseSsh, Tunnels, type ProcessusTunnel } from './tunnels.ts';

const CONNEXION = { hote: 'machine.exemple.test', port: 2222, utilisateur: 'utilisateur', cle: '/k/cle' };
const PI: CibleTunnel = { id: 'pi', connexion: CONNEXION, portDistant: 47322 };

interface FauxProcessus extends ProcessusTunnel {
  terminer(code: number, erreurs?: string): void;
  arrete: boolean;
}

/** Un lanceur qui ne lance rien : chaque processus est un faux, terminé à la demande du test. */
function fauxLanceur() {
  const lances: { args: string[]; processus: FauxProcessus }[] = [];
  let pid = 100;
  const lanceur = (args: string[]): ProcessusTunnel => {
    let fin: (code: number) => void = () => undefined;
    let fausses: (texte: string) => void = () => undefined;
    const sortie = new Promise<number>((r) => (fin = r));
    const erreurs = new Promise<string>((r) => (fausses = r));
    const processus: FauxProcessus = {
      pid: pid++,
      sortie,
      erreurs,
      arrete: false,
      arreter() {
        this.arrete = true;
        fin(-15);
      },
      terminer(code, texte = '') {
        fausses(texte);
        fin(code);
      },
    };
    lances.push({ args, processus });
    return processus;
  };
  return { lanceur, lances };
}

function planificateurFaux() {
  const attentes: { fonction: () => void; ms: number; annulee: boolean }[] = [];
  return {
    attentes,
    planificateur: {
      planifier: (fonction: () => void, ms: number) => {
        const a = { fonction, ms, annulee: false };
        attentes.push(a);
        return a;
      },
      annuler: (minuterie: unknown) => {
        (minuterie as { annulee: boolean }).annulee = true;
      },
    },
  };
}

const attendreTick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function montage(cibles: CibleTunnel[] = [PI]) {
  const { lanceur, lances } = fauxLanceur();
  const { attentes, planificateur } = planificateurFaux();
  let courant = cibles;
  let t = 0;
  const changements: string[] = [];
  const tunnels = new Tunnels({
    cibles: () => courant,
    portPostes: 8721,
    surChangement: (id) => changements.push(id),
    lanceur,
    planificateur,
    maintenant: () => t,
  });
  return {
    tunnels,
    lances,
    attentes,
    changements,
    avancerTemps: (ms: number) => (t += ms),
    poser: (nouvelles: CibleTunnel[]) => (courant = nouvelles),
  };
}

describe('arguments du tunnel', () => {
  test('options du contrat, mapping -R loopback, connexion de la fiche en dernier', () => {
    const args = argumentsTunnel(CONNEXION, 47322, 8721);
    expect(args[0]).toBe('-N');
    expect(args).toContain('ExitOnForwardFailure=yes');
    expect(args).toContain('ServerAliveInterval=10');
    expect(args).toContain('ServerAliveCountMax=2');
    expect(args).toContain('ControlMaster=no');
    expect(args).toContain('ControlPath=none');
    expect(args[args.indexOf('-R') + 1]).toBe('127.0.0.1:47322:127.0.0.1:8721');
    expect(args[args.indexOf('-i') + 1]).toBe('/k/cle');
    expect(args[args.indexOf('-p') + 1]).toBe('2222');
    expect(args.at(-1)).toBe('utilisateur@machine.exemple.test');
  });

  test('attente croissante plafonnée à 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(attenteRelance)).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});

describe('phrase lisible du détail d’accès', () => {
  test('chaque cause connue devient une phrase, sans hôte, adresse, port ni utilisateur', () => {
    expect(phraseSsh('ssh: connect to host 192.0.2.20 port 2222: Connection refused')).toBe('connexion refusée');
    expect(phraseSsh('ssh: connect to host h.exemple.test port 22: Connection timed out')).toBe('délai dépassé');
    expect(phraseSsh('utilisateur@h.exemple.test: Permission denied (publickey).')).toBe('authentification refusée');
    expect(phraseSsh("Error: remote port forwarding failed for listen port 47322")).toBe('port distant déjà pris');
    expect(phraseSsh('ssh: Could not resolve hostname h.exemple.test: Name or service not known')).toBe('hôte inconnu');
    expect(phraseSsh('')).toBe('tunnel coupé');
  });
});

describe('gestionnaire de tunnels', () => {
  test('synchroniser crée un tunnel par machine installée, et l’état le dit', async () => {
    const m = montage();
    m.tunnels.synchroniser();
    expect(m.lances).toHaveLength(1);
    expect(m.lances[0]?.args).toContain('127.0.0.1:47322:127.0.0.1:8721');
    expect(m.tunnels.etat('pi')).toEqual({ ouvert: true, detail: null });
    expect(m.changements).toEqual(['pi']);
    m.tunnels.arreterTout();
  });

  test('ssh qui tombe : état fermé, message de ssh, relance avec attente croissante', async () => {
    const m = montage();
    m.tunnels.synchroniser();
    m.lances[0]?.processus.terminer(255, 'ssh: connect to host x port 2222: Connection refused\n');
    await attendreTick();
    expect(m.tunnels.etat('pi')).toEqual({ ouvert: false, detail: 'connexion refusée — relance dans 2 s' });
    expect(m.attentes.at(-1)?.ms).toBe(2000);
    m.attentes.at(-1)?.fonction();
    expect(m.lances).toHaveLength(2);
    m.lances[1]?.processus.terminer(255);
    await attendreTick();
    expect(m.attentes.at(-1)?.ms).toBe(4000);
    expect(m.tunnels.etat('pi').detail).toBe('tunnel coupé — relance dans 4 s');
  });

  test('une vie stable remet l’attente au minimum', async () => {
    const m = montage();
    m.tunnels.synchroniser();
    m.lances[0]?.processus.terminer(255);
    await attendreTick();
    m.attentes.at(-1)?.fonction();
    m.lances[1]?.processus.terminer(255);
    await attendreTick();
    expect(m.attentes.at(-1)?.ms).toBe(4000);
    m.attentes.at(-1)?.fonction();
    m.avancerTemps(60_000);
    m.lances[2]?.processus.terminer(255);
    await attendreTick();
    expect(m.attentes.at(-1)?.ms).toBe(2000);
  });

  test('changement de port : l’ancien ssh part, le nouveau démarre ; sans changement, rien ne bouge', () => {
    const m = montage();
    m.tunnels.synchroniser();
    m.tunnels.synchroniser();
    expect(m.lances).toHaveLength(1);
    m.poser([{ ...PI, portDistant: 47400 }]);
    m.tunnels.synchroniser();
    expect(m.lances[0]?.processus.arrete).toBe(true);
    expect(m.lances).toHaveLength(2);
    expect(m.lances[1]?.args).toContain('127.0.0.1:47400:127.0.0.1:8721');
  });

  test('machine retirée : tunnel arrêté, plus de relance', async () => {
    const m = montage();
    m.tunnels.synchroniser();
    m.poser([]);
    m.tunnels.synchroniser();
    expect(m.lances[0]?.processus.arrete).toBe(true);
    expect(m.tunnels.etat('pi').detail).toBe('tunnel non démarré');
    expect(m.attentes).toHaveLength(0);
  });

  test('arrêt du relais : tous les ssh partent, les relances en attente sont annulées', async () => {
    const m = montage([PI, { ...PI, id: 'tour', portDistant: 47500 }]);
    m.tunnels.synchroniser();
    m.lances[0]?.processus.terminer(255);
    await attendreTick();
    m.tunnels.arreterTout();
    expect(m.lances[1]?.processus.arrete).toBe(true);
    expect(m.attentes[0]?.annulee).toBe(true);
  });
});
