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

describe('validateTrack: pistas de la canción', () => {
  const song = (extra: object) => ({ ...base(), song: { bpm: 100, beatsPerBar: 3, designSpeed: 25, startOffset: 40, ...extra } });

  it('convierte las notas de una pista vieja en la pista principal', () => {
    const notes = [{ pitch: 64, beat: 0, duration: 1 }];
    const t = validateTrack(song({ notes }));
    expect(t.song.tracks).toHaveLength(1);
    expect(t.song.tracks[0]).toMatchObject({ instrument: 'marimba', notes, repeats: [], main: true });
    expect(t.song).not.toHaveProperty('notes');
    expect(t.song.bpm).toBe(100);
  });

  it('deja exactamente una pista principal', () => {
    const tr = (id: string, main?: boolean) => ({ id, name: id, instrument: 'synth:bass', notes: [], repeats: [], main });
    expect(validateTrack(song({ tracks: [tr('a'), tr('b')] })).song.tracks.map((t) => !!t.main)).toEqual([true, false]);
    expect(validateTrack(song({ tracks: [tr('a', true), tr('b', true)] })).song.tracks.map((t) => !!t.main)).toEqual([true, false]);
    expect(validateTrack(song({ tracks: [null, tr('a'), tr('b', true)] })).song.tracks.map((t) => !!t.main)).toEqual([false, true]);
  });

  it('conserva un instrumento desconocido', () => {
    const t = validateTrack(song({ tracks: [{ id: 'x', name: 'X', instrument: 'gm:999', notes: [], repeats: [] }] }));
    expect(t.song.tracks[0].instrument).toBe('gm:999');
  });

  it('descarta repeticiones inválidas o superpuestas', () => {
    const repeats = [
      { start: 8, end: 12, times: 2 },
      { start: 0, end: 4, times: 3 },
      { start: 2, end: 6, times: 2 }, // se superpone con [0, 4)
      { start: 16, end: 16, times: 2 }, // vacía
      { start: 20, end: 24, times: 1 }, // no repite
      { start: 24, end: 28 },
    ];
    const t = validateTrack(song({ tracks: [{ id: 'd', name: 'D', instrument: 'drums:kit', notes: [], repeats }] }));
    expect(t.song.tracks[0].repeats).toEqual([
      { start: 0, end: 4, times: 3 },
      { start: 8, end: 12, times: 2 },
    ]);
  });

  it('descarta notas mal formadas', () => {
    const t = validateTrack(song({ notes: [{ pitch: 60, beat: 0, duration: 1 }, { pitch: 60 }, null] }));
    expect(t.song.tracks[0].notes).toEqual([{ pitch: 60, beat: 0, duration: 1 }]);
  });
});
