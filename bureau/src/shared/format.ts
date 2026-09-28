// Responsabilité : mise en forme des nombres et des durées pour l'interface (français, espaces insécables).

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} k`;
  return String(n);
}

export function octets(n: number): string {
  const go = n / 1024 ** 3;
  return go >= 100 ? `${Math.round(go)} Go` : `${go.toFixed(1).replace('.', ',')} Go`;
}

export function depuis(iso: string, maintenant = Date.now()): string {
  const s = Math.max(0, Math.round((maintenant - Date.parse(iso)) / 1000));
  if (s < 45) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86_400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86_400)} j`;
}

export function duree(secondes: number): string {
  const j = Math.floor(secondes / 86_400);
  const h = Math.floor((secondes % 86_400) / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  if (j > 0) return `${j} j ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

export function heure(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Le temps restant jusqu'à une échéance (« dans 2 h 10 min »), ou « maintenant » si elle est passée. */
export function dans(iso: string, maintenant = Date.now()): string {
  const s = Math.round((Date.parse(iso) - maintenant) / 1000);
  return s <= 0 ? 'maintenant' : `dans ${duree(s)}`;
}
