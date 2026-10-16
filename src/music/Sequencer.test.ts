import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Song, SongNote, SongTrack } from '../track/types';
import { fixedClock, Sequencer, type SequencerDeps } from './Sequencer';

// 60 BPM: un beat por segundo, así beats y segundos coinciden.
const BPM = 60;

const note = (beat: number, pitch = 60, duration = 1): SongNote => ({ pitch, beat, duration });
const track = (id: string, notes: SongNote[], extra: Partial<SongTrack> = {}): SongTrack => ({
  id,
  name: id,
  instrument: 'marimba',
  notes,
  repeats: [],
  ...extra,
});
const song = (...tracks: SongTrack[]): Song => ({ bpm: BPM, beatsPerBar: 4, designSpeed: 30, startOffset: 0, tracks });

function setup() {
  let now = 0;
  const log: string[] = [];
  const created: string[] = [];
  // Se registran encendidos y apagados con el id del instrumento.
  const deps: SequencerDeps = {
    now: () => now,
    create(id) {
      created.push(id);
      return {
        instrument: {
          output: null as unknown as AudioNode,
          noteOn: (p, _v, t) => log.push(`${id} on ${p} @${t.toFixed(2)}`),
          noteOff: (p, t) => log.push(`${id} off ${p} @${t.toFixed(2)}`),
          allNotesOff: (t) => log.push(`${id} all-off @${t.toFixed(2)}`),
          set: (p) => log.push(`${id} set ${JSON.stringify(p)}`),
          dispose: () => log.push(`${id} dispose`),
        },
        setVolume: () => {},
        setSends: (s) => log.push(`${id} sends ${s.join(',')}`),
        dispose: () => log.push(`${id} out-dispose`),
      };
    },
  };
  const seq = new Sequencer(deps);
  /** Avanza el reloj y procesa una ventana. */
  const at = (t: number) => {
    now = t;
    seq.tick();
  };
  const notes = () => log.filter((l) => / (on|off) /.test(l));
  return { seq, log, notes, created, at, play: (fromBeat = 0) => seq.start(fixedClock(BPM, now, fromBeat), fromBeat) };
}

afterEach(() => vi.useRealTimers());

describe('Sequencer', () => {
  it('programa solo lo que entra en la ventana de lookahead', () => {
    vi.useFakeTimers();
    const { seq, notes, at, play } = setup();
    seq.setSong(song(track('a', [note(0), note(1), note(2)])));
    play();
    expect(notes()).toEqual(['marimba on 60 @0.00']);
    at(0.95);
    expect(notes()).toEqual(['marimba on 60 @0.00', 'marimba off 60 @1.00', 'marimba on 60 @1.00']);
  });

  it('a igual beat suelta la nota anterior antes de tocar la nueva', () => {
    vi.useFakeTimers();
    const { seq, notes, at, play } = setup();
    seq.setSong(song(track('a', [note(0, 60, 0.5), note(0.5, 60, 0.5)])));
    play();
    at(0.45);
    expect(notes().slice(1)).toEqual(['marimba off 60 @0.50', 'marimba on 60 @0.50']);
  });

  it('arranca desde un beat y no toca lo anterior', () => {
    vi.useFakeTimers();
    const { seq, notes, play } = setup();
    seq.setSong(song(track('a', [note(0), note(1), note(2)])));
    play(2);
    expect(notes()).toEqual(['marimba on 60 @0.00']);
  });

  it('toca las pistas desplegadas, cada una con su instrumento', () => {
    vi.useFakeTimers();
    const { seq, notes, created, at, play } = setup();
    seq.setSong(
      song(
        track('lead', [note(0, 72)], { instrument: 'synth:lead' }),
        track('drums', [note(0, 36, 0.25)], { instrument: 'drums:kit', repeats: [{ start: 0, end: 1, times: 3 }] }),
      ),
    );
    expect(created).toEqual(['synth:lead', 'drums:kit']);
    play();
    at(1);
    at(2);
    expect(notes().filter((l) => l.includes(' on '))).toEqual([
      'synth:lead on 72 @0.00',
      'drums:kit on 36 @0.00',
      'drums:kit on 36 @1.00',
      'drums:kit on 36 @2.00',
    ]);
  });

  it('stop suelta todo y deja de programar', () => {
    vi.useFakeTimers();
    const { seq, log, at, play } = setup();
    seq.setSong(song(track('a', [note(0), note(1)])));
    play();
    at(0.5);
    seq.stop();
    expect(log.at(-1)).toBe('marimba all-off @0.50');
    const before = log.length;
    at(2);
    expect(log.length).toBe(before);
    expect(seq.playing).toBe(false);
  });

  it('el beat no retrocede: si el reloj vuelve atrás no repite notas', () => {
    vi.useFakeTimers();
    const { seq, log, at, play } = setup();
    seq.setSong(song(track('a', [note(0), note(1)])));
    play();
    at(1);
    const before = log.length;
    at(0.2);
    expect(log.length).toBe(before);
  });

  it('al cambiar el instrumento de una pista lo reemplaza; si no, lo reusa', () => {
    const { seq, log, created } = setup();
    seq.setSong(song(track('a', [note(0)])));
    seq.setSong(song(track('a', [note(0), note(1)])));
    expect(created).toEqual(['marimba']);
    seq.setSong(song(track('a', [note(0)], { instrument: 'synth:pad' })));
    expect(created).toEqual(['marimba', 'synth:pad']);
    expect(log).toContain('marimba out-dispose');
  });

  it('al cambiar los parámetros de una pista los aplica en vivo, sin recrear el instrumento', () => {
    const { seq, log, created } = setup();
    seq.setSong(song(track('a', [note(0)])));
    seq.setSong(song(track('a', [note(0)], { params: { 'envelope.attack': 0.5 } })));
    seq.setSong(song(track('a', [note(0), note(1)], { params: { 'envelope.attack': 0.5 } })));
    expect(created).toEqual(['marimba']);
    expect(log.filter((l) => l.includes(' set '))).toEqual(['marimba set {"envelope.attack":0.5}']);
  });

  it('aplica los envíos a los buses de cada pista (seca si no tiene)', () => {
    const { seq, log } = setup();
    seq.setSong(song(track('a', [note(0)]), track('b', [note(0)], { instrument: 'synth:pad', sends: [0.5, 0.2] })));
    expect(log.filter((l) => l.includes(' sends '))).toEqual(['marimba sends 0,0', 'synth:pad sends 0.5,0.2']);
  });
});
