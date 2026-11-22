// Responsabilité : type des fichiers texte importés tels quels (script distant embarqué dans le binaire compilé).
declare module '*.sh' {
  const texte: string;
  export default texte;
}
