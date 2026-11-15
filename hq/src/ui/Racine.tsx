// Responsabilité : la racine de l'interface par-dessus le monde — le HUD toujours visible et le panneau ouvert
// (écran d'agent, terminal, fichiers, réunion, nouvelle session).
import { lazy, Suspense, useSyncExternalStore, type ComponentType } from 'react';

import { ecouterPanneau, panneauCourant, type Panneau } from './bus';
import { EcranAgent } from './agent/EcranAgent';
import { Hud } from './hud/Hud';

// Panneaux chargés à la demande ; un panneau absent du build n'empêche pas le reste de l'app de démarrer.
type Module = { default: ComponentType<Record<string, unknown>> };
const MODULES = import.meta.glob<Module>('./{terminal,fichiers,reunion,nouvelle}/*.tsx');

function charger(chemin: string): ComponentType<Record<string, unknown>> {
  return lazy(async () => {
    const m = MODULES[chemin];
    if (m) return m();
    return { default: () => <div className="interactif panneau-absent">Panneau indisponible : {chemin}</div> };
  });
}

const EcranTerminal = charger('./terminal/EcranTerminal.tsx');
const EcranFichiers = charger('./fichiers/EcranFichiers.tsx');
const SalleReunion = charger('./reunion/SalleReunion.tsx');
const NouvelleSession = charger('./nouvelle/NouvelleSession.tsx');

function Contenu(p: { panneau: Panneau }) {
  const x = p.panneau;
  switch (x.type) {
    case 'agent':
      return <EcranAgent key={x.sessionId} sessionId={x.sessionId} />;
    case 'terminal':
      return <EcranTerminal machine={x.machine} cwd={x.cwd} titre={x.titre} />;
    case 'fichiers':
      return <EcranFichiers machine={x.machine} chemin={x.chemin} sessionId={x.sessionId} />;
    case 'reunion':
      return <SalleReunion />;
    case 'nouvelle':
      return <NouvelleSession />;
  }
}

export function Racine() {
  const panneau = useSyncExternalStore(ecouterPanneau, panneauCourant);
  return (
    <>
      <Hud />
      {panneau ? (
        <Suspense fallback={null}>
          <Contenu panneau={panneau} />
        </Suspense>
      ) : null}
    </>
  );
}
