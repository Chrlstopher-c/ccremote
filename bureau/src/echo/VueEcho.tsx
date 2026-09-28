// Responsabilité : le mode Echo — l'orbe au centre qui réagit à la voix, les cadres qu'Echo affiche à côté, les
// réglages (micro, voix, empreinte) et, à la demande, la discussion écrite.
import { AnimatePresence } from 'motion/react';
import { type ReactNode, useState } from 'react';
import { BarreEcho } from './BarreEcho.tsx';
import { Cadres } from './cadres/Cadres.tsx';
import { Discussion } from './Discussion.tsx';
import { Enrolement } from './Enrolement.tsx';
import { Orbe } from './Orbe.tsx';
import { SousTitres } from './SousTitres.tsx';
import { useEcho } from './useEcho.ts';

const SCENE = 'flex shrink-0 flex-col items-center justify-center';

type Echo = ReturnType<typeof useEcho>;

/** L'orbe et, dessous, soit l'enregistrement de la voix en cours, soit les sous-titres. */
function Scene({ echo, compacte }: { readonly echo: Echo; readonly compacte: boolean }): ReactNode {
  const enrolement = echo.voix?.enrolement;
  return (
    <div className={`${SCENE} ${compacte ? 'w-[300px] border-r border-filet' : 'flex-1'}`}>
      <div className={compacte ? 'size-[240px]' : 'size-[min(56vh,480px)]'}>
        <Orbe niveaux={echo.niveaux} occupe={echo.occupe} />
      </div>
      {enrolement ? (
        <Enrolement duree={enrolement.duree} cible={enrolement.cible} annuler={() => echo.commanderVoix('annuler')} />
      ) : (
        <SousTitres entendu={echo.entendu} dit={echo.enCours.texte} />
      )}
    </div>
  );
}

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
        voix={echo.voix}
        commanderVoix={echo.commanderVoix}
        usage={echo.usage}
      />
      <div className="flex min-h-0 flex-1">
        <div className={`flex min-h-0 min-w-0 flex-1 ${avecCadres ? 'flex-row' : 'flex-col'}`}>
          <Scene echo={echo} compacte={avecCadres} />
          {avecCadres && <Cadres cadres={echo.cadres} retirer={echo.retirer} />}
        </div>
        <AnimatePresence>
          {discussion && <Discussion historique={echo.historique} envoyer={echo.envoyer} />}
        </AnimatePresence>
      </div>
    </section>
  );
}
