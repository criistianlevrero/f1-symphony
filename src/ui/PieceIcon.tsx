import { PIECES } from '../track/pieces';
import type { PieceType } from '../track/types';

/**
 * Ícono del tramo generado a partir de su línea central: vista de arriba para
 * curvas y rectas, de costado para subidas, bajadas y saltos.
 */
export function PieceIcon({ type, size = 44 }: { type: PieceType; size?: number }) {
  const def = PIECES[type];
  const side = def.exit === null || def.exit.offset[1] !== 0;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const s = def.sample(i / 24);
    pts.push(side ? [s.x, -s.y * 2] : [s.x, s.z]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const pad = 6;
  const k = (size - pad * 2) / span;
  const ox = pad + ((size - pad * 2) - (maxX - minX) * k) / 2;
  const oy = pad + ((size - pad * 2) - (maxY - minY) * k) / 2;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(ox + (p[0] - minX) * k).toFixed(1)},${(oy + (p[1] - minY) * k).toFixed(1)}`).join(' ');
  const color = type === 'start' ? '#2bb673' : type === 'finish' ? '#f2f2f2' : side ? '#f2a541' : '#7fb3ff';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={side ? 4 : 7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
