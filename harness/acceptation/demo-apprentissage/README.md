# Démonstration de l'apprentissage

Prouver qu'une leçon réinjectée dans le mandat d'une équipe change ce qu'elle fait,
mesurablement, sur un piège reproductible — et que le retrait de la leçon fait revenir
le tâtonnement.

Le raisonnement, le choix du piège et ce que l'expérience ne prouve pas :
`Upgrade/apprentissage/PROTOCOLE-DEMONSTRATION.md`.
La forme du fichier de mesures : `CONTRAT-MESURES.md`.

## Lancer

```
# produire des mesures réelles (lance de vraies sessions du SDK)
REPETITIONS=5 bun run experience/protocole.ts

# rendre la page (n'ouvre rien d'autre que le fichier de mesures)
bun run page/generer-page.ts mesures.json demonstration.html
```

Variables : `REPETITIONS`, `MODELE`, `COMPTE`, `CONDITIONS`, `SORTIE`, `PLAFOND_MS`,
`BUDGET_USD`.

`☠` `BUDGET_USD` borne chaque cobaye. Trop bas, il coupe une exécution en cours et la
mesure devient « jamais réussi » pour une raison qui n'est pas le piège — 0,35 est un
plancher raisonnable sur ce projet.

## Ce qu'il y a ici

| | |
|---|---|
| `experience/protocole.ts` | orchestre les exécutions, écrit `mesures.json` |
| `experience/projet-piege.ts` | le projet jetable et son piège |
| `experience/mandat.ts` | le mandat mot pour mot, les blocs de leçons, les limites |
| `experience/extraction-jsonl.ts` | toutes les mesures, depuis les transcripts réels |
| `experience/verification.ts` | le vérificateur externe, hors de portée de l'agent |
| `experience/contrat.ts` | la forme du fichier de mesures |
| `page/` | le générateur ; il n'écrit aucun chiffre |
| `demonstration.html` | la page, ouvrable d'un double-clic |
