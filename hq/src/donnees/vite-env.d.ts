// Responsabilité : typer import.meta.env pour la lecture de la configuration de la source (sans charger vite/client).
interface ImportMeta {
  readonly env: Readonly<Record<string, string | undefined>>;
}
