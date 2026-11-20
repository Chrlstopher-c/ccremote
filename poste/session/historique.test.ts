import { describe, expect, test } from 'bun:test';
import pino from 'pino';
import type { Stockage } from '../presentation/stockage.ts';
import type { Evenement } from '../../commun/session.ts';
import { evenementsDuTranscript, lireHistorique, stockeurImages } from './historique.ts';

const journal = pino({ enabled: false });
const PNG = 'iVBORw0KGgo=';
const DEBUT = Date.parse('2026-11-01T10:00:00.000Z');

interface Fabrique {
  readonly lignes: string[];
  readonly chaine: { messages: number; textes: number; images: number; outils: number; resultats: number };
}

// Transcript synthétique : chaque tour = message de Chris, réponse (texte + outil + résultat), et un sous-agent
// (lignes isSidechain) ; une branche abandonnée (rembobinage) est écrite au milieu et ne doit pas remonter.
function fabriquer(tours: number): Fabrique {
  const lignes: string[] = [];
  const chaine = { messages: 0, textes: 0, images: 0, outils: 0, resultats: 0 };
  let parent: string | null = null;
  let t = DEBUT;
  const horo = (): string => new Date((t += 1000)).toISOString();
  const pousser = (objet: Record<string, unknown>): void => {
    lignes.push(JSON.stringify(objet));
  };
  const lien = (uuid: string): Record<string, unknown> => ({
    uuid,
    parentUuid: parent,
    timestamp: horo(),
    sessionId: 'sess',
  });
  for (let i = 0; i < tours; i += 1) {
    const idUser = `u-${i}`;
    const avecImage = i % 7 === 3;
    const contenu = avecImage
      ? [
          { type: 'text', text: `Regarde ${i}` },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
        ]
      : `Question ${i}`;
    pousser({ type: 'user', ...lien(idUser), message: { role: 'user', content: contenu } });
    // Ligne hors conversation (journal de requêtes) portant une image : jamais présentée dans le fil.
    pousser({ type: 'api-request-blob', ...lien(`blob-${i}`), message: { content: avecImage ? [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }] : [] } });
    parent = idUser;
    chaine.messages += 1;
    if (avecImage) chaine.images += 1;
    if (i === 10) {
      // Branche abandonnée : une réponse qui ne mène pas à la fin de la conversation.
      pousser({ type: 'assistant', ...lien('abandon-1'), parentUuid: 'u-5', message: { content: [{ type: 'text', text: 'Piste jetée' }] } });
    }
    const idOutil = `toolu_${i}`;
    pousser({ type: 'assistant', ...lien(`a-${i}-1`), message: { content: [{ type: 'text', text: `Je regarde ${i}` }] } });
    parent = `a-${i}-1`;
    chaine.textes += 1;
    pousser({
      type: 'assistant',
      ...lien(`a-${i}-2`),
      message: { content: [{ type: 'tool_use', id: idOutil, name: 'Bash', input: { command: `ls ${i}` } }] },
    });
    parent = `a-${i}-2`;
    chaine.outils += 1;
    pousser({ type: 'assistant', isSidechain: true, ...lien(`s-${i}`), message: { content: [{ type: 'text', text: 'sous-agent' }] } });
    pousser({
      type: 'user',
      ...lien(`r-${i}`),
      message: { content: [{ type: 'tool_result', tool_use_id: idOutil, content: 'ok' }] },
    });
    parent = `r-${i}`;
    chaine.resultats += 1;
    pousser({ type: 'assistant', ...lien(`a-${i}-3`), message: { content: [{ type: 'text', text: `Fait ${i}` }] } });
    parent = `a-${i}-3`;
    chaine.textes += 1;
  }
  return { lignes, chaine };
}

function fauxStockage(): { stockage: Stockage; ecrits: string[] } {
  const ecrits: string[] = [];
  const stockage = {
    existe: (_session: string, id: string) => ecrits.includes(id),
    ecrire: (_session: string, id: string) => {
      ecrits.push(id);
    },
  };
  // Seules ces deux méthodes servent à l'historique : le reste du stockage n'est pas exercé.
  return { stockage: stockage as unknown as Stockage, ecrits };
}

const compter = (evts: readonly Evenement[], type: Evenement['type']): number =>
  evts.filter((e) => e.type === type).length;

describe('historique du transcript : fil complet, branche active, sans sous-agents', () => {
  const { lignes, chaine } = fabriquer(120);
  const contenu = lignes.join('\n');

  test('transcript long (plus de 300 lignes) reconstruit entièrement', () => {
    expect(lignes.length).toBeGreaterThan(300);
    const evts = evenementsDuTranscript(contenu).map((e) => e.evt);
    expect(compter(evts, 'message')).toBe(chaine.messages);
    expect(compter(evts, 'texte')).toBe(chaine.textes);
    expect(compter(evts, 'outil')).toBe(chaine.outils);
    expect(compter(evts, 'resultat_outil')).toBe(chaine.resultats);
  });

  test('la branche abandonnée et les sous-agents ne remontent pas', () => {
    const evts = evenementsDuTranscript(contenu).map((e) => e.evt);
    expect(evts.some((e) => e.type === 'texte' && e.texte === 'Piste jetée')).toBe(false);
    expect(evts.some((e) => 'agent' in e && e.agent !== undefined)).toBe(false);
    expect(evts.some((e) => e.type === 'texte' && e.texte === 'sous-agent')).toBe(false);
  });

  test('ordre du transcript, horodatage d’origine, aucun doublon d’uuid', () => {
    const evts = evenementsDuTranscript(contenu);
    const uuids = evts.flatMap((e) => (e.evt.type === 'message' || e.evt.type === 'texte' ? [e.evt.uuid] : []));
    expect(new Set(uuids).size).toBe(uuids.length);
    expect(uuids[0]).toBe('u-0');
    const ts = evts.map((e) => e.ts);
    expect([...ts].sort()).toEqual(ts);
    expect(evts[0]?.ts).toBe(new Date(DEBUT + 1000).toISOString());
  });

  test('une ligne tronquée (écriture en cours) est ignorée, le reste reste lisible', () => {
    const evts = evenementsDuTranscript(`${contenu}\n{"type":"user","message":{"content":"coup`);
    expect(compter(evts.map((e) => e.evt), 'message')).toBe(chaine.messages);
  });

  test('images : stockées par la session, émises à leur place, origine utilisateur', () => {
    const { stockage, ecrits } = fauxStockage();
    const stocker = stockeurImages(stockage, 'sess', journal);
    const evts = evenementsDuTranscript(contenu, stocker).map((e) => e.evt);
    const images = evts.filter((e): e is Extract<Evenement, { type: 'image' }> => e.type === 'image');
    expect(images.length).toBe(chaine.images);
    // Identifiant tiré du contenu : toutes les images du transcript ont les mêmes octets, un seul fichier écrit.
    expect(ecrits.length).toBe(1);
    expect(images.every((i) => i.origine === 'utilisateur' && i.mime === 'image/png')).toBe(true);
  });

  test('transcript absent : historique vide, pas d’exception', () => {
    expect(lireHistorique('/chemin/inexistant/x.jsonl', journal)).toEqual([]);
  });
});
