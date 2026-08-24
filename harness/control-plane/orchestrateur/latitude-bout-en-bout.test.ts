/**
 * Banc de bout en bout — la latitude survit-elle VRAIMENT de la création au
 * briefing du lead (chantier 3, mandat opérateur 24/08, migration 33) ?
 *
 * `☠` Ce que ce test refuse de faire : vérifier qu'une fonction transmet bien
 * son argument. C'est exactement la preuve que les deux équipes précédentes ont
 * chacune produite, séparément, pendant que la chaîne restait coupée entre
 * elles — deux tests verts, un champ toujours vide en production. Ce banc
 * enchaîne les VRAIES fonctions de production, dans l'ordre réel :
 *
 *   1. `construireCreationProposition` (composition/pi/assembler-control-plane.ts)
 *      — la même traduction mandat → objet de création que la fermeture
 *      `enregistrer` du serveur de contrôle appelle en production.
 *   2. `registre.propositions.creer` — écriture SQL réelle (migration 33).
 *   3. `registre.propositions.lire` — lecture SQL réelle, une requête SEPARÉE,
 *      jamais l'objet gardé en mémoire par l'étape 2.
 *   4. `dispatcherMandat` (control-plane/orchestrateur/dispatch-mandat.ts) —
 *      le même chemin qu'emprunte `dispatcherMandatAutorise` en production
 *      (assembler-control-plane.ts) une fois l'opérateur ayant cliqué, jusqu'à
 *      `composerMandatSysteme` qui produit le `systemPrompt` réel du worker.
 *
 * Le texte capturé par le `demarreur` factice ICI est, mot pour mot, ce qui
 * partirait sur la session du chef d'équipe en production.
 */

import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { ouvrirRegistre, type Registre } from '../registre/index.ts';
import { dispatcherMandat, type DependancesDispatch } from './dispatch-mandat.ts';
import { construireCreationProposition } from '../../composition/pi/assembler-control-plane.ts';

const LATITUDE =
  'Si tu croises une dépendance nginx cassée en explorant le daemon, corrige-la — ' +
  'le périmètre reste src-tauri/ uniquement.';

describe('latitude — chaîne réelle de la création au briefing du lead', () => {
  test('☠ une latitude créée survit à l’écriture, la relecture ET la composition du briefing', async () => {
    const registre: Registre = ouvrirRegistre({ chemin: ':memory:' });
    try {
      registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/compte-a' });
      const conversation = registre.conversations.creer({ id: randomUUID(), titre: 'fil de test' });

      // 1. CRÉATION — la traduction mandat → dépôt réellement utilisée par la
      //    fermeture `enregistrer` de l'assembleur (jamais une copie du mapping).
      const creation = construireCreationProposition(conversation.id, {
        projet: '/mnt/projects/vela',
        objectif: 'réparer le démarrage du daemon',
        critereArret: 'le daemon démarre et le test d’intégration passe',
        perimetre: 'src-tauri/ uniquement',
        acces: 'ecriture',
        budgetMaxUsd: 5,
        latitude: LATITUDE,
      });

      // 2. ENREGISTREMENT — écriture SQL réelle (colonne `latitude`, migration 33).
      const enregistree = registre.propositions.creer(creation);
      expect(enregistree.latitude).toBe(LATITUDE);

      // 3. RELECTURE — requête SQL SEPARÉE, pas l'objet retourné par l'écriture.
      //    C'est le maillon qui manquait : sans la colonne ni le mapping de
      //    lecture, cette étape rendrait `null` même si l'écriture avait réussi.
      const relue = registre.propositions.lire(enregistree.id);
      expect(relue).not.toBeNull();
      expect(relue?.latitude).toBe(LATITUDE);

      // 4. DISPATCH RÉEL — même fonction qu'appelle `dispatcherMandatAutorise`
      //    en production une fois le clic d'autorisation reçu.
      let mandatTransmisAuLead = '';
      const deps: DependancesDispatch = {
        registre,
        demarreur: {
          demarrer: async (demande) => {
            mandatTransmisAuLead = demande.parametres.mandate;
            return { detail: 'équipe démarrée' };
          },
        },
        repertoireProjets: '/mnt/projects',
      };
      // `☠` `relue!` et non `enregistree` : la preuve doit partir de ce que la
      // base rend, pas de ce que l'écriture a gardé en mémoire — sinon un bug de
      // lecture resterait invisible à ce banc.
      await dispatcherMandat(relue!, deps);

      // 5. LA PREUVE : le texte RÉELLEMENT transmis au chef d'équipe porte la
      //    latitude, mot pour mot — pas une transmission de fonction à fonction,
      //    le prompt final tel que le lead le lira.
      expect(mandatTransmisAuLead).toContain(LATITUDE);
      expect(mandatTransmisAuLead).toContain('Latitude (choses adjacentes');
    } finally {
      registre.fermer();
    }
  });

  test('☠ contre-épreuve — aucune latitude accordée ⇒ aucune ligne « Latitude » dans le briefing', async () => {
    const registre: Registre = ouvrirRegistre({ chemin: ':memory:' });
    try {
      registre.comptes.enregistrer({ id: 'compte-a', configDir: '/tmp/compte-a' });
      const conversation = registre.conversations.creer({ id: randomUUID(), titre: 'fil de test' });

      const creation = construireCreationProposition(conversation.id, {
        projet: '/mnt/projects/vela',
        objectif: 'réparer le démarrage du daemon',
        critereArret: 'le daemon démarre',
        perimetre: 'src-tauri/ uniquement',
        acces: 'ecriture',
        budgetMaxUsd: 5,
        // latitude absente — même contrat que `creer_equipe` sans le paramètre.
      });

      const enregistree = registre.propositions.creer(creation);
      const relue = registre.propositions.lire(enregistree.id);
      expect(relue?.latitude).toBeNull();

      let mandatTransmisAuLead = '';
      const deps: DependancesDispatch = {
        registre,
        demarreur: {
          demarrer: async (demande) => {
            mandatTransmisAuLead = demande.parametres.mandate;
            return { detail: 'équipe démarrée' };
          },
        },
        repertoireProjets: '/mnt/projects',
      };
      await dispatcherMandat(relue!, deps);

      // `☠` Décidé en migration : rien à lire n'est pas une ligne « aucune » —
      // une phrase inutile répétée sur la quasi-totalité des dispatchs, comme le
      // documente `dispatch-mandat.ts` (`ligneLatitude`).
      expect(mandatTransmisAuLead).not.toContain('Latitude (choses adjacentes');
    } finally {
      registre.fermer();
    }
  });
});
