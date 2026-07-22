// Tests de l'observateur de compaction (A.1.4 point 3 / E.4.1, mission M-42).
// Critères couverts :
//  (b) compactions observées via les hooks ET SDKCompactBoundaryMessage
//  (c) le cœur de la mission : une compaction fréquente remonte en DÉFAUT,
//      jamais comme normalité — et une compaction manuelle (H-62) n'est
//      JAMAIS un défaut, quelle que soit sa fréquence.

import { describe, expect, test } from 'bun:test'
import { HorlogeSimulee } from '../test-harness/deterministe/horloge-simulee.ts'
import { ObservateurCompaction } from './observateur-compaction.ts'
import { SEUILS_PATHOLOGIE_PAR_DEFAUT } from './contrats.ts'

const MIN = 60_000

describe('ObservateurCompaction — (c) compaction pathologique vs normale', () => {
  test('la toute première compaction auto n\'est jamais un défaut (rien à comparer)', () => {
    const horloge = new HorlogeSimulee()
    const observateur = new ObservateurCompaction({ horloge })
    const evt = observateur.observerHook('auto')
    expect(evt.severite).toBe('normal')
    expect(evt.intervalleDepuisPrecedenteAutoMs).toBeNull()
  })

  test('deux compactions auto à 5 min d\'écart (< 15 min) ⇒ défaut', () => {
    const horloge = new HorlogeSimulee()
    const observateur = new ObservateurCompaction({ horloge })
    observateur.observerHook('auto')
    horloge.avancer(5 * MIN)
    const evt = observateur.observerHook('auto')
    expect(evt.severite).toBe('defaut')
    expect(evt.motif).toContain('fuite de contexte')
    expect(observateur.evenementsDefaut()).toHaveLength(1)
  })

  test('deux compactions auto à 20 min d\'écart (> 15 min, count < seuil) ⇒ normal', () => {
    const horloge = new HorlogeSimulee()
    const observateur = new ObservateurCompaction({ horloge })
    observateur.observerHook('auto')
    horloge.avancer(20 * MIN)
    const evt = observateur.observerHook('auto')
    expect(evt.severite).toBe('normal')
  })

  test('3 compactions auto en 60 min, chaque intervalle > 15 min individuellement ⇒ défaut par répétition', () => {
    const horloge = new HorlogeSimulee()
    const observateur = new ObservateurCompaction({ horloge })
    observateur.observerHook('auto') // t=0
    horloge.avancer(20 * MIN)
    const deuxieme = observateur.observerHook('auto') // t=20min, intervalle 20min > 15min
    expect(deuxieme.severite).toBe('normal')
    horloge.avancer(20 * MIN)
    const troisieme = observateur.observerHook('auto') // t=40min, intervalle 20min, mais 3e en 40min < fenetreMs
    expect(troisieme.severite).toBe('defaut')
    expect(troisieme.motif).toContain('fréquence anormale')
    expect(troisieme.compteAutoDansFenetre).toBe(3)
  })

  test('compaction manuelle jamais un défaut, même répétée rapidement', () => {
    const horloge = new HorlogeSimulee()
    const observateur = new ObservateurCompaction({ horloge })
    const premiere = observateur.observerHook('manual')
    horloge.avancer(1_000)
    const seconde = observateur.observerHook('manual')
    horloge.avancer(1_000)
    const troisieme = observateur.observerHook('manual')
    expect([premiere.severite, seconde.severite, troisieme.severite]).toEqual(['normal', 'normal', 'normal'])
    expect(observateur.evenementsDefaut()).toHaveLength(0)
  })

  test('une compaction manuelle intercalée ne pollue pas la fenêtre des auto', () => {
    const horloge = new HorlogeSimulee()
    const observateur = new ObservateurCompaction({ horloge })
    observateur.observerHook('auto')
    horloge.avancer(1_000)
    observateur.observerHook('manual')
    horloge.avancer(20 * MIN - 1_000)
    const evt = observateur.observerHook('auto')
    // Le manuel intercalé n'a pas compté : intervalle mesuré depuis la précédente AUTO (20 min), pas 1s.
    expect(evt.intervalleDepuisPrecedenteAutoMs).toBe(20 * MIN)
    expect(evt.severite).toBe('normal')
  })

  test('sort de la fenêtre glissante : la 4e compaction, longtemps après, ne compte plus les 3 premières', () => {
    const horloge = new HorlogeSimulee()
    const observateur = new ObservateurCompaction({ horloge })
    observateur.observerHook('auto')
    horloge.avancer(20 * MIN)
    observateur.observerHook('auto')
    horloge.avancer(20 * MIN)
    observateur.observerHook('auto') // défaut, 3 en 40 min
    horloge.avancer(SEUILS_PATHOLOGIE_PAR_DEFAUT.fenetreMs + 1) // sort complètement de la fenêtre
    const quatrieme = observateur.observerHook('auto')
    expect(quatrieme.severite).toBe('normal')
    expect(quatrieme.compteAutoDansFenetre).toBe(1)
  })
})

describe('ObservateurCompaction — (b) deux sources, un seul événement', () => {
  test('hook puis message dans la fenêtre de dédup ⇒ fusionnés en un seul événement', () => {
    const horloge = new HorlogeSimulee()
    const observateur = new ObservateurCompaction({ horloge })
    const viaHook = observateur.observerHook('auto', { pre: 150_000, post: 40_000 })
    horloge.avancer(1_000) // < dedupMs (5000)
    const viaMessage = observateur.observerMessage('auto', { pre: 150_000, post: 40_000 })
    expect(observateur.evenements()).toHaveLength(1)
    expect(viaMessage.origines).toEqual(['hook', 'message_flux'])
    expect(viaHook).not.toBe(viaMessage) // l'objet retourné au premier appel n'est pas muté rétroactivement
  })

  test('la fusion ne compte pas deux fois dans compteAutoDansFenetre', () => {
    const horloge = new HorlogeSimulee()
    const observateur = new ObservateurCompaction({ horloge })
    observateur.observerHook('auto')
    horloge.avancer(1_000)
    observateur.observerMessage('auto') // fusionné avec le précédent : toujours 1 compaction réelle
    horloge.avancer(20 * MIN)
    const troisieme = observateur.observerHook('auto')
    // Si la fusion avait compté double, on serait déjà à 3 dans la fenêtre ⇒ défaut. Ce n'est pas le cas.
    expect(troisieme.severite).toBe('normal')
    expect(troisieme.compteAutoDansFenetre).toBe(2)
  })

  test('deux signaux hors fenêtre de dédup ⇒ deux événements distincts, pas une fusion', () => {
    const horloge = new HorlogeSimulee()
    const observateur = new ObservateurCompaction({ horloge })
    observateur.observerHook('auto')
    horloge.avancer(SEUILS_PATHOLOGIE_PAR_DEFAUT.dedupMs + 1)
    observateur.observerMessage('auto')
    expect(observateur.evenements()).toHaveLength(2)
  })

  test('même origine deux fois de suite dans la fenêtre de dédup : deux vraies compactions, pas une fusion', () => {
    const horloge = new HorlogeSimulee()
    const observateur = new ObservateurCompaction({ horloge })
    observateur.observerHook('auto')
    horloge.avancer(1_000)
    observateur.observerHook('auto')
    expect(observateur.evenements()).toHaveLength(2)
  })
})
