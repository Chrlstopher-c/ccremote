import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emettreJetonPoste } from './jeton-poste.ts';

const RELAIS = 'ws://192.0.2.5:8721/poste';

function dossierNeuf(): string {
  return join(mkdtempSync(join(tmpdir(), 'jeton-poste-')), 'postes');
}

test('émet un secret neuf, écrit son fichier et le range dans la table du relais', () => {
  const dossier = dossierNeuf();
  const secrets = new Map<string, string>();
  const sortie = emettreJetonPoste({ dossier, machine: 'tour', relais: RELAIS, secrets, remplacer: false });
  const { secret, fichiers } = sortie;
  expect(secret).toMatch(/^[0-9a-f]{64}$/);
  expect(readFileSync(join(dossier, 'tour.secret'), 'utf8').trim()).toBe(secret);
  expect(secrets.get('tour')).toBe(secret);
  expect(fichiers.posteEnv).toContain(`CCREMOTE_SECRET_POSTE=${secret}`);
  expect(JSON.parse(fichiers.posteJson)).toMatchObject({ machine: 'tour', relais: RELAIS });
});

test('sans remplacer, un poste qui a déjà un secret est refusé et son secret ne bouge pas', () => {
  const dossier = dossierNeuf();
  const { secret } = emettreJetonPoste({
    dossier,
    machine: 'portable',
    relais: RELAIS,
    secrets: new Map(),
    remplacer: false,
  });
  expect(() =>
    emettreJetonPoste({ dossier, machine: 'portable', relais: RELAIS, secrets: new Map(), remplacer: false }),
  ).toThrow('déjà');
  expect(readFileSync(join(dossier, 'portable.secret'), 'utf8').trim()).toBe(secret);
});

test('remplacer donne un nouveau secret au poste connu : fichier et table mis à jour, l’ancien ne sert plus', () => {
  const dossier = dossierNeuf();
  const secrets = new Map<string, string>();
  const premier = emettreJetonPoste({ dossier, machine: 'pi', relais: RELAIS, secrets, remplacer: false }).secret;
  const second = emettreJetonPoste({ dossier, machine: 'pi', relais: RELAIS, secrets, remplacer: true }).secret;
  expect(second).not.toBe(premier);
  expect(secrets.get('pi')).toBe(second);
  expect(readFileSync(join(dossier, 'pi.secret'), 'utf8').trim()).toBe(second);
  expect(existsSync(join(dossier, 'pi.secret.tmp'))).toBe(false);
});

test('identifiant de poste ou adresse de relais invalides : rien n’est écrit', () => {
  const dossier = dossierNeuf();
  const secrets = new Map<string, string>();
  expect(() => emettreJetonPoste({ dossier, machine: 'Tour !', relais: RELAIS, secrets, remplacer: false })).toThrow();
  expect(() =>
    emettreJetonPoste({ dossier, machine: 'tour', relais: 'http://192.0.2.5:8721/poste', secrets, remplacer: false }),
  ).toThrow();
  expect(existsSync(join(dossier, 'tour.secret'))).toBe(false);
  expect(secrets.size).toBe(0);
});
