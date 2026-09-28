// Responsabilité : l'assemblage de l'app — connexion, magasin, navigation entre les vues.
import { MotionConfig } from 'motion/react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { type Acces, ecrireAcces, lireAcces } from '../connexion/acces.ts';
import { EcranConnexion } from '../connexion/EcranConnexion.tsx';
import { VueNotifications } from '../notifications/VueNotifications.tsx';
import { VueParc } from '../parc/VueParc.tsx';
import { EspaceSessions } from '../sessions/EspaceSessions.tsx';
import { ClientRelais } from '../shared/api/client.ts';
import { FournisseurMagasin } from '../shared/etat/contexte.tsx';
import { Magasin } from '../shared/etat/magasin.ts';
import { notifierSysteme } from '../shared/natif.ts';
import { BarreLaterale, type Vue } from './BarreLaterale.tsx';

// Un magasin par accès, démarré tant que l'espace est monté ; les notifications importantes remontent au système.
function useMagasinActif(acces: Acces): Magasin {
  const magasin = useMemo(() => new Magasin(new ClientRelais(acces.base, acces.jeton)), [acces]);
  useEffect(() => {
    magasin.demarrer();
    const arret = magasin.ecouterNotifications((n) => {
      if (n.niveau !== 'info') void notifierSysteme(n.titre, n.texte);
    });
    return () => {
      arret();
      magasin.arreter();
    };
  }, [magasin]);
  return magasin;
}

function Espace({ acces, surDeconnexion }: { readonly acces: Acces; readonly surDeconnexion: () => void }): ReactNode {
  const magasin = useMagasinActif(acces);
  const [vue, setVue] = useState<Vue>('sessions');
  const [session, setSession] = useState<string | null>(null);
  const ouvrirSession = (id: string): void => {
    setSession(id);
    setVue('sessions');
  };

  return (
    <FournisseurMagasin magasin={magasin}>
      <div className="flex h-full">
        <BarreLaterale
          vue={vue}
          surVue={setVue}
          surDeconnexion={() => {
            void magasin.client.deconnecter().catch(() => undefined);
            surDeconnexion();
          }}
        />
        {vue === 'sessions' && <EspaceSessions choisie={session} surChoisir={setSession} />}
        {vue === 'parc' && <VueParc />}
        {vue === 'notifications' && <VueNotifications surOuvrirSession={ouvrirSession} />}
      </div>
    </FournisseurMagasin>
  );
}

export function App(): ReactNode {
  const [acces, setAcces] = useState<Acces | null>(lireAcces);
  const changer = (a: Acces | null): void => {
    if (a) localStorage.setItem('ccremote.base', a.base);
    ecrireAcces(a);
    setAcces(a);
  };
  return (
    <MotionConfig reducedMotion="user">
      {acces ? (
        <Espace key={acces.jeton} acces={acces} surDeconnexion={() => changer(null)} />
      ) : (
        <EcranConnexion surConnecte={changer} basePrecedente={localStorage.getItem('ccremote.base') ?? ''} />
      )}
    </MotionConfig>
  );
}
