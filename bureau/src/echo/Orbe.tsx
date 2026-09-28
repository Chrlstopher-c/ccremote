// Responsabilité : l'orbe d'Echo — l'objet héros du mode Echo. Il respire au repos, s'ouvre en ondes quand Chris
// parle, se déforme au rythme de la voix d'Echo, tourne quand elle réfléchit. Lu à chaque image depuis `niveaux`
// (hors React) ; couleurs prises dans les jetons du thème.
import { type ReactNode, type RefObject, useEffect, useRef } from 'react';
import type { Niveaux } from './useEcho.ts';

export type Phase = 'repos' | 'ecoute' | 'reflexion' | 'parle';

const FRAIS_MS = 350; // un niveau plus vieux que ça : la source s'est tue
const HARMONIQUES = [
  { k: 3, w: 0.9, a: 1 },
  { k: 5, w: -1.3, a: 0.6 },
  { k: 7, w: 1.7, a: 0.35 },
];

interface Couleurs {
  accent: string;
  clair: string;
}

/** « #A774D4 » + opacité → rgba (le canvas de WebKitGTK ne garantit pas color-mix). */
function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return hex;
  const n = Number.parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

function lireCouleurs(el: HTMLElement): Couleurs {
  const s = getComputedStyle(el);
  const accent = s.getPropertyValue('--accent').trim() || '#A774D4';
  return { accent, clair: s.getPropertyValue('--accent-texte').trim() || '#D5B8F0' };
}

export function phaseDe(n: Niveaux, occupe: boolean, t: number): Phase {
  if (t - n.tVoix < FRAIS_MS) return 'parle';
  if (t - n.tMicro < FRAIS_MS) return 'ecoute';
  return occupe ? 'reflexion' : 'repos';
}

interface Anim {
  lisse: number;
  phase: Phase;
}

function niveauCible(n: Niveaux, phase: Phase, t: number): number {
  if (phase === 'parle') return n.voix;
  if (phase === 'ecoute') return n.micro;
  if (phase === 'reflexion') return 0.25;
  return 0.08 + 0.05 * Math.sin(t / 700); // respiration
}

function contour(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, amp: number, t: number): void {
  ctx.beginPath();
  for (let i = 0; i <= 96; i++) {
    const th = (i / 96) * Math.PI * 2;
    const d = HARMONIQUES.reduce((s, h) => s + h.a * Math.sin(h.k * th + (h.w * t) / 1000), 0);
    const rr = r * (1 + amp * d * 0.5);
    const x = cx + rr * Math.cos(th);
    const y = cy + rr * Math.sin(th);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function halo(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: Couleurs, l: number): void {
  const g = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * (1.9 + l * 0.9));
  g.addColorStop(0, alpha(c.accent, 0.3 + l * 0.3));
  g.addColorStop(1, alpha(c.accent, 0));
  ctx.fillStyle = g;
  ctx.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6);
}

function ondes(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  c: Couleurs,
  l: number,
  t: number,
): void {
  for (let i = 0; i < 3; i++) {
    const p = (((t / 1600 + i / 3) % 1) + 1) % 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1.05 + p * (0.8 + l)), 0, Math.PI * 2);
    ctx.strokeStyle = alpha(c.accent, (1 - p) * (0.35 + l * 0.5));
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function arcReflexion(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: Couleurs, t: number): void {
  const a = (t / 600) % (Math.PI * 2);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.22, a, a + Math.PI * 0.6);
  ctx.strokeStyle = c.clair;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function dessiner(ctx: CanvasRenderingContext2D, w: number, h: number, a: Anim, c: Couleurs, t: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.26 * (1 + a.lisse * 0.12);
  ctx.clearRect(0, 0, w, h);
  halo(ctx, cx, cy, r, c, a.lisse);
  if (a.phase === 'ecoute') ondes(ctx, cx, cy, r, c, a.lisse, t);
  if (a.phase === 'reflexion') arcReflexion(ctx, cx, cy, r, c, t);
  contour(ctx, cx, cy, r, 0.03 + a.lisse * (a.phase === 'parle' ? 0.22 : 0.1), t);
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r * 1.1);
  g.addColorStop(0, c.clair);
  g.addColorStop(1, c.accent);
  ctx.fillStyle = g;
  ctx.fill();
}

function useBoucle(
  toile: RefObject<HTMLCanvasElement | null>,
  niveaux: RefObject<Niveaux>,
  occupe: RefObject<boolean>,
): void {
  useEffect(() => {
    const el = toile.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let couleurs = lireCouleurs(el);
    let derniereLecture = 0;
    const a: Anim = { lisse: 0, phase: 'repos' };
    let image = 0;
    const tour = (t: number): void => {
      if (t - derniereLecture > 1000) [couleurs, derniereLecture] = [lireCouleurs(el), t];
      const dpr = devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = el;
      if (el.width !== w * dpr || el.height !== h * dpr) [el.width, el.height] = [w * dpr, h * dpr];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      a.phase = phaseDe(niveaux.current, occupe.current, t);
      const cible = niveauCible(niveaux.current, a.phase, t);
      a.lisse += (cible - a.lisse) * (cible > a.lisse ? 0.45 : 0.08); // attaque vive, retombée douce
      dessiner(ctx, w, h, a, couleurs, reduit ? 0 : t);
      image = requestAnimationFrame(tour);
    };
    image = requestAnimationFrame(tour);
    return () => cancelAnimationFrame(image);
  }, [toile, niveaux, occupe]);
}

export function Orbe({
  niveaux,
  occupe,
}: {
  readonly niveaux: RefObject<Niveaux>;
  readonly occupe: boolean;
}): ReactNode {
  const toile = useRef<HTMLCanvasElement>(null);
  const occ = useRef(occupe);
  occ.current = occupe;
  useBoucle(toile, niveaux, occ);
  return <canvas ref={toile} className="size-full" aria-label="Echo" role="img" />;
}
