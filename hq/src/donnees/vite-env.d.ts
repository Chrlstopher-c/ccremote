// Responsabilité : typer import.meta.env pour la lecture de la configuration de la source (sans charger vite/client).
interface ImportMeta {
  readonly env: Readonly<Record<string, string | undefined>>;
}

// import.meta.glob de Vite (chargement des panneaux à la demande), sans charger vite/client.
interface ImportMeta {
  glob<T>(motif: string): Record<string, () => Promise<T>>;
}
