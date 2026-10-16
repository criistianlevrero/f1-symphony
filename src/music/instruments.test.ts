import { describe, expect, it } from 'vitest';
import { INSTRUMENTS, resolveParams, toOptions, type ParamDef } from './instruments';

const defs: ParamDef[] = [
  { id: 'envelope.attack', label: 'Attack', group: 'Envolvente', default: 0.01, min: 0, max: 2 },
  { id: 'envelope.release', label: 'Release', group: 'Envolvente', default: 0.3, min: 0, max: 4 },
  { id: 'oscillator.type', label: 'Forma', group: 'Oscilador', default: 'square', options: [] },
];

describe('parámetros de instrumentos', () => {
  it('resolveParams completa con el preset e ignora lo desconocido o de otro tipo', () => {
    expect(resolveParams(defs, { 'envelope.attack': 0.5, 'oscillator.type': 3, otro: 1 })).toEqual({
      'envelope.attack': 0.5,
      'envelope.release': 0.3,
      'oscillator.type': 'square',
    });
  });

  it('toOptions arma las opciones anidadas de Tone a partir de las rutas', () => {
    expect(toOptions({ 'envelope.attack': 0.5, 'envelope.release': 1, 'filter.Q': 2, harmonicity: 3 })).toEqual({
      envelope: { attack: 0.5, release: 1 },
      filter: { Q: 2 },
      harmonicity: 3,
    });
  });

  it('cada instrumento expone parámetros de su catálogo, con valores por defecto válidos', () => {
    for (const inst of INSTRUMENTS) {
      const ids = new Set(inst.params.map((p) => p.id));
      expect(inst.exposed.every((id) => ids.has(id)), inst.id).toBe(true);
      for (const p of inst.params) {
        if (p.options) expect(p.options.length ? p.options.some((o) => o.value === p.default) : true, `${inst.id} ${p.id}`).toBe(true);
        else expect((p.default as number) >= p.min! && (p.default as number) <= p.max!, `${inst.id} ${p.id}`).toBe(true);
      }
    }
  });
});
