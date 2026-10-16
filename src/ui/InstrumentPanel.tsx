import { getInstrument, INSTRUMENTS, resolveParams, type ParamDef, type ParamValue } from '../music/instruments';
import type { SongTrack } from '../track/types';

interface Props {
  track: SongTrack;
  onChange: (track: SongTrack) => void;
}

/** Los tiempos y frecuencias se ajustan mejor en escala logarítmica. */
const isLog = (p: ParamDef) => (p.unit === 's' || p.unit === 'Hz') && (p.min ?? 0) > 0;
const SLIDER_STEPS = 1000;

function toSlider(p: ParamDef, v: number) {
  const min = p.min!;
  const max = p.max!;
  return isLog(p) ? (Math.log(v / min) / Math.log(max / min)) * SLIDER_STEPS : ((v - min) / (max - min)) * SLIDER_STEPS;
}

function fromSlider(p: ParamDef, s: number) {
  const min = p.min!;
  const max = p.max!;
  const raw = isLog(p) ? min * Math.pow(max / min, s / SLIDER_STEPS) : min + (s / SLIDER_STEPS) * (max - min);
  const step = p.step ?? 0.01;
  return Math.min(max, Math.max(min, Math.round(raw / step) * step));
}

function format(p: ParamDef, v: number) {
  const digits = (p.step ?? 0.01) >= 1 ? 0 : (p.step ?? 0.01) >= 0.1 ? 1 : (p.step ?? 0.01) >= 0.01 ? 2 : 3;
  return `${v.toFixed(digits)}${p.unit ? ` ${p.unit}` : ''}`;
}

/** Columna a la derecha del piano roll: instrumento de la pista, volumen y parámetros. */
export function InstrumentPanel({ track, onChange }: Props) {
  const info = getInstrument(track.instrument);
  const known = INSTRUMENTS.some((i) => i.id === track.instrument);
  const values = resolveParams(info.params, track.params);
  const exposed = info.params.filter((p) => info.exposed.includes(p.id));
  const groups = [...new Set(exposed.map((p) => p.group))];
  const changed = Object.keys(track.params ?? {}).length > 0;

  /** Guarda solo lo que difiere del preset. */
  const setParam = (p: ParamDef, v: ParamValue) => {
    const params = { ...track.params };
    if (v === p.default) delete params[p.id];
    else params[p.id] = v;
    onChange({ ...track, params: Object.keys(params).length ? params : undefined });
  };

  return (
    <aside className="instrument-panel">
      <label className="field">
        Instrumento
        <select
          value={track.instrument}
          // Los parámetros son de cada instrumento: al cambiarlo se vuelve al preset.
          onChange={(e) => onChange({ ...track, instrument: e.target.value, params: undefined })}
        >
          {INSTRUMENTS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
          {!known && <option value={track.instrument}>{track.instrument} (no disponible)</option>}
        </select>
      </label>
      <label className="field">
        <span className="param-head">
          Volumen <span className="param-value">{Math.round((track.volume ?? 1) * 100)} %</span>
        </span>
        <input type="range" min={0} max={1.5} step={0.05} value={track.volume ?? 1} onChange={(e) => onChange({ ...track, volume: +e.target.value })} />
      </label>

      {groups.map((group) => (
        <fieldset key={group} className="param-group">
          <legend>{group}</legend>
          {exposed
            .filter((p) => p.group === group)
            .map((p) => {
              const v = values[p.id];
              const modified = track.params?.[p.id] !== undefined;
              return (
                <label key={p.id} className={`field param ${modified ? 'modified' : ''}`}>
                  <span className="param-head">
                    {p.label}
                    {!p.options && <span className="param-value">{format(p, v as number)}</span>}
                  </span>
                  {p.options ? (
                    <select value={v as string} onChange={(e) => setParam(p, e.target.value)}>
                      {p.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="range"
                      min={0}
                      max={SLIDER_STEPS}
                      step={1}
                      value={toSlider(p, v as number)}
                      onChange={(e) => setParam(p, fromSlider(p, +e.target.value))}
                      onDoubleClick={() => setParam(p, p.default)}
                      title="Doble click: valor del preset"
                    />
                  )}
                </label>
              );
            })}
        </fieldset>
      ))}

      <button className="btn ghost" disabled={!changed} onClick={() => onChange({ ...track, params: undefined })}>
        Restablecer preset
      </button>
    </aside>
  );
}
