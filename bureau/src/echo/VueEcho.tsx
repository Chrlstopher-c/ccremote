// Responsabilité : le mode Echo — l'orbe au centre qui réagit à la voix, les cadres qu'Echo affiche à côté, les
// réglages (micro, voix) et, à la demande, la discussion écrite.
import { AnimatePresence } from 'motion/react';
import { type ReactNode, useState } from 'react';
import { BarreEcho } from './BarreEcho.tsx';
import { Cadres } from './cadres/Cadres.tsx';
import { Discussion } from './Discussion.tsx';
import { Orbe } from './Orbe.tsx';
import { SousTitres } from './SousTitres.tsx';
import { useEcho } from './useEcho.ts';

const SCENE = 'flex shrink-0 flex-col items-center justify-center';

export function VueEcho(): ReactNode {
  const echo = useEcho();
  const [discussion, setDiscussion] = useState(false);
  const avecCadres = echo.cadres.length > 0;
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-fond">
      <BarreEcho
        dispo={echo.dispo}
        occupe={echo.occupe}
        reglages={echo.reglages}
        discussion={discussion}
        regler={echo.regler}
        basculerDiscussion={() => setDiscussion((d) => !d)}
        interrompre={echo.interrompre}
      />
      <div className="flex min-h-0 flex-1">
        <div className={`flex min-h-0 min-w-0 flex-1 ${avecCadres ? 'flex-row' : 'flex-col'}`}>
          <div className={`${SCENE} ${avecCadres ? 'w-[300px] border-r border-filet' : 'flex-1'}`}>
            <div className={avecCadres ? 'size-[240px]' : 'size-[min(56vh,480px)]'}>
              <Orbe niveaux={echo.niveaux} occupe={echo.occupe} />
            </div>
            <SousTitres entendu={echo.entendu} dit={echo.enCours.texte} />
          </div>
          {avecCadres && <Cadres cadres={echo.cadres} retirer={echo.retirer} />}
        </div>
        <AnimatePresence>
          {discussion && <Discussion historique={echo.historique} envoyer={echo.envoyer} />}
        </AnimatePresence>
      </div>
    </section>
  );
}
