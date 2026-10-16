import { BUSES } from '../music/effects';
import { getInstrument, INSTRUMENTS, resolveParams, type ParamDef, type ParamValue, type ParamValues } from '../music/instruments';
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

/** Un control de parámetro: deslizador (o lista), con su valor y doble click para el preset. */
export function ParamControl({ def: p, value: v, modified, onChange }: { def: ParamDef; value: ParamValue; modified: boolean; onChange: (v: ParamValue) => void }) {
  return (
    <label className={`field param ${modified ? 'modified' : ''}`}>
      <span className="param-head">
        {p.label}
        {!p.options && <span className="param-value">{format(p, v as number)}</span>}
      </span>
      {p.options ? (
        <select value={v as string} onChange={(e) => onChange(e.target.value)}>
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
          onChange={(e) => onChange(fromSlider(p, +e.target.value))}
          onDoubleClick={() => onChange(p.default)}
          title="Doble click: valor del preset"
        />
      )}
    </label>
  );
}

/** Devuelve los valores cambiados con `p` en `v`, guardando solo lo que difiere del preset. */
export function withParam(values: ParamValues | undefined, p: ParamDef, v: ParamValue): ParamValues | undefined {
  const out = { ...values };
  if (v === p.default) delete out[p.id];
  else out[p.id] = v;
  return Object.keys(out).length ? out : undefined;
}

const SEND_DEFS: ParamDef[] = BUSES.map((b) => ({ id: b.id, label: b.sendLabel, group: 'Efectos', default: 0, min: 0, max: 1, step: 0.01 }));

/** Columna a la derecha del piano roll: instrumento de la pista, volumen y parámetros. */
export function InstrumentPanel({ track, onChange }: Props) {
  const info = getInstrument(track.instrument);
  const known = INSTRUMENTS.some((i) => i.id === track.instrument);
  const values = resolveParams(info.params, track.params);
  const exposed = info.params.filter((p) => info.exposed.includes(p.id));
  const groups = [...new Set(exposed.map((p) => p.group))];
  const changed = Object.keys(track.params ?? {}).length > 0;

  const setParam = (p: ParamDef, v: ParamValue) => onChange({ ...track, params: withParam(track.params, p, v) });
  const sends = track.sends ?? [0, 0];
  const setSend = (i: number, v: number) => {
    const next: [number, number] = [sends[0], sends[1]];
    next[i] = v;
    onChange({ ...track, sends: next[0] || next[1] ? next : undefined });
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
            .map((p) => (
              <ParamControl key={p.id} def={p} value={values[p.id]} modified={track.params?.[p.id] !== undefined} onChange={(v) => setParam(p, v)} />
            ))}
        </fieldset>
      ))}

      <fieldset className="param-group">
        <legend>Efectos</legend>
        {SEND_DEFS.map((p, i) => (
          <ParamControl key={p.id} def={p} value={sends[i]} modified={sends[i] > 0} onChange={(v) => setSend(i, v as number)} />
        ))}
      </fieldset>

      <button className="btn ghost" disabled={!changed} onClick={() => onChange({ ...track, params: undefined })}>
        Restablecer preset
      </button>
    </aside>
  );
}
