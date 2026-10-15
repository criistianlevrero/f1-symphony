/**
 * Estéticas de pista: cielo, luces, piso y colores de la calzada. Son solo visuales:
 * ninguna estética cambia la forma de los tramos ni la física.
 */
export type ThemeId = 'day' | 'abyss';

export interface RoadPalette {
  road: number;
  curbA: number;
  curbB: number;
  side: number;
  bottom: number;
  /** Pilares de los arcos de largada y llegada. */
  pillar: number;
}

export interface Theme {
  id: ThemeId;
  label: string;
  sky: number;
  fog: { color: number; near: number; far: number };
  hemi: { sky: number; ground: number; intensity: number };
  sun: { color: number; intensity: number; position: [number, number, number]; shadows: boolean };
  floor: number;
  grid: { center: number; lines: number };
  road: RoadPalette;
  /** Brillo propio de los cordones (0 = sin brillo). */
  curbGlow: number;
}

export const THEMES: Record<ThemeId, Theme> = {
  day: {
    id: 'day',
    label: 'Día',
    sky: 0x9cc7e8,
    fog: { color: 0x9cc7e8, near: 300, far: 1100 },
    hemi: { sky: 0xdfefff, ground: 0x404858, intensity: 1.1 },
    sun: { color: 0xffffff, intensity: 2.2, position: [60, 120, 40], shadows: true },
    floor: 0x55705a,
    grid: { center: 0x2f3d33, lines: 0x3e5244 },
    road: { road: 0x2c3038, curbA: 0xe03a3a, curbB: 0xf2f2f2, side: 0x6c7689, bottom: 0x4a5163, pillar: 0x20242c },
    curbGlow: 0,
  },
  abyss: {
    id: 'abyss',
    label: 'Abismo',
    sky: 0x02060f,
    fog: { color: 0x02060f, near: 60, far: 650 },
    hemi: { sky: 0x1a3a6a, ground: 0x000000, intensity: 0.7 },
    sun: { color: 0x6a8cff, intensity: 0.6, position: [-40, 120, 30], shadows: false },
    floor: 0x030a14,
    grid: { center: 0x1e6a8a, lines: 0x0c2a3a },
    road: { road: 0x0a0e18, curbA: 0x00e5ff, curbB: 0xff2bd6, side: 0x141a2e, bottom: 0x080b14, pillar: 0x0a0e18 },
    curbGlow: 1.2,
  },
};

export const THEME_ORDER: ThemeId[] = ['day', 'abyss'];

export const DEFAULT_THEME: ThemeId = 'day';

export function isThemeId(id: string): id is ThemeId {
  return Object.hasOwn(THEMES, id);
}

/** Estética a usar para dibujar. Si el id no existe (p. ej. de una versión más nueva), usa la de día. */
export function getTheme(id: string): Theme {
  return isThemeId(id) ? THEMES[id] : THEMES[DEFAULT_THEME];
}
