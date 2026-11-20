// Responsabilité : tests du service des tâches planifiées (P7) et de sa minuterie — fichier jetable, lanceur factice
// (aucune session réelle), horloge injectée. Aucune tâche réelle n'est créée ni exécutée.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import type { CorpsTache } from '../../commun/reste-lot2.ts';
import type { DemandeSession } from '../../commun/session.ts';
import type { Reponse } from '../session/gestionnaire.ts';
import { MinuterieTaches } from './minuterie-taches.ts';
import { ServiceTaches } from './taches-planifiees.ts';

const journal = pino({ level: 'silent' });
let dossier = '';
let fichier = '';
let horloge = new Date(2026, 10, 20, 8, 0);
let lances: DemandeSession[] = [];
let refuser: string | null = null;

const quotidienne: CorpsTache = {
  nom: 'Rapport du matin',
  dossier: '/projets/app',
  prompt: 'Fais le point',
  modele: 'sonnet',
  frequence: { type: 'quotidienne', heure: '09:00' },
};

async function ouvrirFactice(d: DemandeSession): Promise<Reponse> {
  lances.push(d);
  return refuser ? { ok: false, erreur: refuser } : { ok: true, donnees: { id: d.sessionId } };
}

function service(): ServiceTaches {
  return new ServiceTaches({
    fichier,
    machine: 'tour',
    description: 'la tour',
    racines: ['/projets'],
    ouvrir: ouvrirFactice,
    journal,
    maintenant: () => horloge,
  });
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'taches-'));
  fichier = join(dossier, 'taches-planifiees.json');
  horloge = new Date(2026, 10, 20, 8, 0);
  lances = [];
  refuser = null;
});

afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

describe('création et modification', () => {
  test('une tâche neuve est inactive, sans prochaine exécution, identifiant généré', () => {
    const r = service().enregistrer(undefined, quotidienne);
    expect(r.ok).toBe(true);
    const tache = (r.donnees as { tache: Record<string, unknown> }).tache;
    expect(tache['active']).toBe(false);
    expect(tache['prochaine']).toBeNull();
    expect(typeof tache['id']).toBe('string');
  });

  test('active à la création : prochaine exécution à 9 h, puis conservée à la modification sans `active`', () => {
    const s = service();
    s.enregistrer('t1', { ...quotidienne, active: true });
    const lue = s.lister().donnees as { taches: { id: string; prochaine: string; active: boolean }[] };
    expect(lue.taches[0]?.active).toBe(true);
    expect(lue.taches[0]?.prochaine).toBe(new Date(2026, 10, 20, 9, 0).toISOString());
    s.enregistrer('t1', { ...quotidienne, nom: 'Renommée' });
    const apres = s.lister().donnees as { taches: { nom: string; active: boolean }[] };
    expect(apres.taches[0]).toMatchObject({ nom: 'Renommée', active: true });
  });

  test('un fichier illisible est signalé, jamais écrasé', () => {
    writeFileSync(fichier, '{ pas du json');
    const r = service().enregistrer('t1', quotidienne);
    expect(r).toEqual({ ok: false, erreur: 'enregistrement impossible' });
    expect(readFileSync(fichier, 'utf8')).toBe('{ pas du json');
  });
});

describe('suppression', () => {
  test('tâche inconnue refusée, existante retirée du fichier', () => {
    const s = service();
    s.enregistrer('t1', quotidienne);
    expect(s.supprimer('absente')).toEqual({ ok: false, erreur: 'tâche inconnue' });
    expect(s.supprimer('t1').ok).toBe(true);
    expect(s.lister().donnees).toEqual({ taches: [] });
  });
});

describe('exécution', () => {
  test('une exécution crée une session neuve (dossier, prompt, modèle) et la note', async () => {
    const s = service();
    s.enregistrer('t1', quotidienne);
    const r = await s.executer('t1');
    expect(r.ok).toBe(true);
    const demande = lances[0];
    expect(demande?.projet).toEqual({ machine: 'tour', chemin: '/projets/app', nom: 'app' });
    expect(demande).toMatchObject({ message: 'Fais le point', titre: 'Rapport du matin', modele: 'sonnet' });
    const derniere = (r.donnees as { tache: { derniere: { etat: string; session: string } } }).tache.derniere;
    expect(derniere).toMatchObject({ etat: 'lancee', session: demande?.sessionId, erreur: null });
  });

  test('refus du lancement : exécution notée en échec, raison gardée', async () => {
    refuser = 'projet introuvable';
    const s = service();
    s.enregistrer('t1', quotidienne);
    expect(await s.executer('t1')).toEqual({ ok: false, erreur: 'projet introuvable' });
    const lue = s.lister().donnees as { taches: { derniere: unknown }[] };
    expect(lue.taches[0]?.derniere).toMatchObject({ etat: 'echec', session: null, erreur: 'projet introuvable' });
  });

  test('une tâche unique se désactive après son exécution', async () => {
    const s = service();
    s.enregistrer('u', { ...quotidienne, active: true, frequence: { type: 'unique', le: horloge.toISOString() } });
    await s.executer('u');
    const lue = s.lister().donnees as { taches: { active: boolean }[] };
    expect(lue.taches[0]?.active).toBe(false);
  });
});

describe('vérification par la minuterie', () => {
  test('une tâche due lance une seule session par jour', async () => {
    const s = service();
    s.enregistrer('t1', { ...quotidienne, active: true });
    horloge = new Date(2026, 10, 20, 9, 30);
    await s.verifier();
    await s.verifier();
    expect(lances.length).toBe(1);
    horloge = new Date(2026, 10, 21, 9, 30);
    await s.verifier();
    expect(lances.length).toBe(2);
  });

  test('une tâche inactive ou pas encore due ne lance rien', async () => {
    const s = service();
    s.enregistrer('t1', quotidienne);
    s.enregistrer('t2', { ...quotidienne, active: true });
    await s.verifier();
    expect(lances.length).toBe(0);
  });

  test('la minuterie appelle la vérification à chaque tour, sans chevauchement', async () => {
    let appels = 0;
    const minuterie = new MinuterieTaches({ verifier: async () => void (appels += 1) }, journal, 5);
    minuterie.demarrer();
    await new Promise((r) => setTimeout(r, 40));
    minuterie.arreter();
    const apresArret = appels;
    await new Promise((r) => setTimeout(r, 20));
    expect(appels).toBeGreaterThan(1);
    expect(appels).toBe(apresArret);
  });
});
