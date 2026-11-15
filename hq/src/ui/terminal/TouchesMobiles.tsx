// Responsabilité : la rangée de touches absentes du clavier d'un téléphone (Tab, Ctrl+C, Échap, flèches) sous le
// terminal ; masquée sur grand écran.
const TOUCHES: readonly { readonly libelle: string; readonly sequence: string; readonly titre: string }[] = [
  { libelle: 'Tab', sequence: '\t', titre: 'Tabulation' },
  { libelle: '^C', sequence: '\u0003', titre: 'Ctrl+C : interrompre' },
  { libelle: 'Éch', sequence: '\u001b', titre: 'Échap' },
  { libelle: '↑', sequence: '\u001b[A', titre: 'Commande précédente' },
  { libelle: '↓', sequence: '\u001b[B', titre: 'Commande suivante' },
  { libelle: '←', sequence: '\u001b[D', titre: 'Gauche' },
  { libelle: '→', sequence: '\u001b[C', titre: 'Droite' },
];

export function TouchesMobiles(p: { readonly envoyer: (texte: string) => void; readonly focus: () => void }) {
  return (
    <div className="crt-touches" role="toolbar" aria-label="Touches spéciales">
      {TOUCHES.map((t) => (
        <button
          key={t.libelle}
          className="bouton-pixel"
          title={t.titre}
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            p.envoyer(t.sequence);
            p.focus();
          }}
        >
          {t.libelle}
        </button>
      ))}
    </div>
  );
}
