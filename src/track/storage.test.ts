import { describe, expect, it } from 'vitest';
import { newTrack, validateTrack } from './storage';
import { getTheme, THEMES } from './themes';

const base = () => {
  const { theme: _theme, decorations: _decorations, ...rest } = newTrack();
  return rest;
};

describe('validateTrack: estética y decoración', () => {
  it('usa la estética de día si la pista no tiene una (pistas viejas)', () => {
    const t = validateTrack(base());
    expect(t.theme).toBe('day');
    expect(t.decorations).toEqual({});
  });

  it('conserva una estética desconocida, pero se dibuja como día', () => {
    const t = validateTrack({ ...base(), theme: 'volcan' });
    expect(t.theme).toBe('volcan');
    expect(getTheme(t.theme)).toBe(THEMES.day);
    expect(getTheme('toString')).toBe(THEMES.day);
  });

  it('conserva la decoración de todas las estéticas, no solo la activa', () => {
    const decorations = {
      day: [{ asset: 'globo', cell: [1, 0, 2], rot: 0 }],
      abyss: [{ asset: 'calamar', cell: [-3, 1, 4], rot: 2 }],
      volcan: [{ asset: 'asset-futuro', cell: [0, 0, 0], rot: 1 }],
    };
    const t = validateTrack({ ...base(), theme: 'abyss', decorations });
    expect(t.decorations).toEqual(decorations);
  });

  it('descarta solo los elementos mal formados', () => {
    const t = validateTrack({
      ...base(),
      decorations: {
        day: [{ asset: 'globo', cell: [1, 0, 2], rot: 0 }, { asset: 'globo', cell: [1, 0], rot: 0 }, { cell: [0, 0, 0], rot: 0 }, null],
        abyss: 'no es una lista',
      },
    });
    expect(t.decorations).toEqual({ day: [{ asset: 'globo', cell: [1, 0, 2], rot: 0 }] });
  });
});
