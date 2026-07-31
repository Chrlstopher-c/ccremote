import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ouvrirRegistre, type Registre } from '../../control-plane/registre/index.ts';
import { choisirCompteDisponible, emailDuConfigDir } from './choix-compte-orchestrateur.ts';

let registre: Registre;
let racine: string;

async function configDir(nom: string, email: string | null): Promise<string> {
  const dir = join(racine, nom);
  await mkdir(dir, { recursive: true });
  if (email !== null) {
    await writeFile(join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: email } }));
  }
  return dir;
}

function declarerCompte(id: string, email: string, sature: boolean): void {
  registre.comptes.enregistrer({ id, configDir: `/pc/${id}`, email });
  registre.comptes.releverQuota({
    compteId: id,
    typeFenetre: 'seven_day',
    statut: sature ? 'rejected' : 'allowed',
    utilisation: sature ? 100 : 42,
  });
}

beforeEach(async () => {
  registre = ouvrirRegistre({ chemin: ':memory:' });
  racine = await mkdtemp(join(tmpdir(), 'ccremote-orch-'));
});

afterEach(async () => {
  registre.fermer();
  await rm(racine, { recursive: true, force: true });
});

describe('choix du compte orchestrateur — sur quota MESURÉ', () => {
  test('☠ le compte saturé est SAUTÉ au démarrage — avant, on repartait toujours sur le premier', async () => {
    const a = await configDir('a', 'a@exemple.fr');
    const b = await configDir('b', 'b@exemple.fr');
    declarerCompte('compte-a', 'a@exemple.fr', true);
    declarerCompte('compte-b', 'b@exemple.fr', false);
    expect(choisirCompteDisponible([a, b], registre)).toBe(1);
  });

  test('aucun compte saturé : on garde le premier, aucun effet de bord', async () => {
    const a = await configDir('a', 'a@exemple.fr');
    const b = await configDir('b', 'b@exemple.fr');
    declarerCompte('compte-a', 'a@exemple.fr', false);
    declarerCompte('compte-b', 'b@exemple.fr', false);
    expect(choisirCompteDisponible([a, b], registre)).toBe(0);
  });

  test('☠ un compte INCONNU du registre n’est jamais écarté — inconnu ≠ saturé', async () => {
    const a = await configDir('a', 'inconnu@exemple.fr');
    expect(choisirCompteDisponible([a], registre)).toBe(0);
  });

  test('☠ un `.claude.json` illisible n’écarte pas non plus — on ne punit pas une ignorance', async () => {
    const a = await configDir('a', null);
    declarerCompte('compte-a', 'a@exemple.fr', true);
    expect(choisirCompteDisponible([a], registre)).toBe(0);
  });

  test('tous saturés : rend le point de départ, le mur sera annoncé plutôt que masqué', async () => {
    const a = await configDir('a', 'a@exemple.fr');
    const b = await configDir('b', 'b@exemple.fr');
    declarerCompte('compte-a', 'a@exemple.fr', true);
    declarerCompte('compte-b', 'b@exemple.fr', true);
    expect(choisirCompteDisponible([a, b], registre)).toBe(0);
  });

  test('l’email est lu là où le CLI l’écrit', async () => {
    const a = await configDir('a', 'chris@exemple.fr');
    expect(emailDuConfigDir(a)).toBe('chris@exemple.fr');
    expect(emailDuConfigDir(join(racine, 'inexistant'))).toBeNull();
  });
});

describe('☠ une saturation périmée ne condamne plus le compte (vécu 26→31/07)', () => {
  const MAINTENANT = 1_700_000_000_000;

  function declarerAvecReset(id: string, email: string, resetA: number): void {
    registre.comptes.enregistrer({ id, configDir: `/pc/${id}`, email });
    registre.comptes.releverQuota({
      compteId: id,
      typeFenetre: 'seven_day',
      statut: 'rejected',
      utilisation: 100,
      resetA,
    });
  }

  test('fenêtre finie il y a cinq jours : l’orchestrateur redémarre sur le compte A', async () => {
    const a = await configDir('a', 'a@exemple.fr');
    const b = await configDir('b', 'b@exemple.fr');
    declarerAvecReset('compte-a', 'a@exemple.fr', MAINTENANT - 5 * 86_400_000);
    declarerCompte('compte-b', 'b@exemple.fr', false);
    expect(choisirCompteDisponible([a, b], registre, 0, MAINTENANT)).toBe(0);
  });

  test('fenêtre encore ouverte : le compte reste sauté', async () => {
    const a = await configDir('a', 'a@exemple.fr');
    const b = await configDir('b', 'b@exemple.fr');
    declarerAvecReset('compte-a', 'a@exemple.fr', MAINTENANT + 3_600_000);
    declarerCompte('compte-b', 'b@exemple.fr', false);
    expect(choisirCompteDisponible([a, b], registre, 0, MAINTENANT)).toBe(1);
  });
});
