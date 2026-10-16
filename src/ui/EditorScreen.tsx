import { useEffect, useRef, useState } from 'react';
import { Editor, type EditorCursor } from '../editor/Editor';
import { PIECE_ORDER, PIECES } from '../track/pieces';
import { exportTrackFile, saveTrack } from '../track/storage';
import { isThemeId, THEME_ORDER, THEMES } from '../track/themes';
import type { PieceType, Song, TrackData } from '../track/types';
import { availableBeats, mainTrack, songLengthBeats, unroll } from '../music/song';
import { BUSES } from '../music/effects';
import { resolveParams } from '../music/instruments';
import { ParamControl, withParam } from './InstrumentPanel';
import { PianoRoll } from './PianoRoll';
import { PieceIcon } from './PieceIcon';

/** Campo numérico que confirma el valor al salir del campo o con Enter (sin pelear con el tipeo). */
function NumberField({ value, min, max, onCommit }: { value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    const clamped = Number.isFinite(v) && text.trim() !== '' ? Math.max(min, Math.min(max, v)) : value;
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

const ROT_LABEL = ['→ Este', '↓ Sur', '← Oeste', '↑ Norte'];

interface Props {
  track: TrackData;
  dirty: boolean;
  onChange: (track: TrackData, dirty: boolean) => void;
  onPlay: () => void;
  onExit: () => void;
}

export function EditorScreen({ track, dirty, onChange, onPlay, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const trackRef = useRef(track);
  trackRef.current = track;
  const [type, setType] = useState<PieceType>('straight');
  const [cursor, setCursor] = useState<EditorCursor | null>(null);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'track' | 'music' | 'decor'>('track');
  const [pathLength, setPathLength] = useState(0);
  const [noteLength, setNoteLength] = useState(1);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);

  useEffect(() => {
    const editor = new Editor(containerRef.current!, trackRef.current.pieces, trackRef.current.theme, {
      onChange: (pieces) => onChange({ ...trackRef.current, pieces }, true),
      onCursor: setCursor,
      onPathLength: setPathLength,
    });
    editor.setSong(trackRef.current.song);
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // El editor se crea una sola vez por montaje; los cambios fluyen por onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => editorRef.current?.setPieceType(type), [type]);
  useEffect(() => editorRef.current?.setSong(track.song), [track.song]);
  useEffect(() => editorRef.current?.setTheme(track.theme), [track.theme]);
  useEffect(() => {
    if (editorRef.current) editorRef.current.inputEnabled = tab === 'track';
  }, [tab]);

  const setSong = (patch: Partial<Song>) => onChange({ ...track, song: { ...track.song, ...patch } }, true);
  const song = track.song;
  const main = mainTrack(song);
  const current = song.tracks.find((t) => t.id === selectedTrackId) ?? main;
  const beatsFit = availableBeats(song, pathLength);
  const songBeats = songLengthBeats(song);
  const outside = unroll(main).filter((n) => n.beat > beatsFit).length;

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 2500);
    return () => clearTimeout(t);
  }, [message]);

  const save = () => {
    const saved = saveTrack(track);
    onChange(saved, false);
    setMessage('Pista guardada');
  };

  const hasStart = track.pieces.some((p) => p.type === 'start');
  const hasFinish = track.pieces.some((p) => p.type === 'finish');

  return (
    <div className="screen editor">
      <div ref={containerRef} className="viewport" />
      <aside className="panel">
        <div className="panel-row">
          <button className="btn ghost" onClick={onExit}>
            ← Menú
          </button>
          <button className="btn primary" onClick={onPlay} disabled={!hasStart}>
            ▶ Probar
          </button>
        </div>
        <input
          className="name-input"
          value={track.name}
          onChange={(e) => onChange({ ...track, name: e.target.value }, true)}
          aria-label="Nombre de la pista"
        />
        <div className="panel-row">
          <button className="btn" onClick={save}>
            {dirty ? 'Guardar *' : 'Guardado'}
          </button>
          <button className="btn ghost" onClick={() => exportTrackFile(track)}>
            Exportar
          </button>
        </div>
        {message && <div className="toast">{message}</div>}
        {!hasFinish && <div className="hint">Falta la llegada: agregá un tramo «Llegada» al final del recorrido.</div>}

        <div className="tabs">
          <button className={tab === 'track' ? 'active' : ''} onClick={() => setTab('track')}>
            Pista
          </button>
          <button className={tab === 'music' ? 'active' : ''} onClick={() => setTab('music')}>
            Música ({main.notes.length})
          </button>
          <button className={tab === 'decor' ? 'active' : ''} onClick={() => setTab('decor')}>
            Decoración
          </button>
        </div>

        {tab === 'decor' ? (
          <>
            <label className="field">
              Estética
              <select value={track.theme} onChange={(e) => onChange({ ...track, theme: e.target.value }, true)}>
                {THEME_ORDER.map((id) => (
                  <option key={id} value={id}>
                    {THEMES[id].label}
                  </option>
                ))}
                {!isThemeId(track.theme) && <option value={track.theme}>{track.theme} (no disponible, se ve como Día)</option>}
              </select>
              <small>Cada estética guarda su propia decoración: al cambiar de estética, la de las otras se conserva.</small>
            </label>
          </>
        ) : tab === 'track' ? (
          <>
            <h3>Tramos</h3>
            <div className="palette">
              {PIECE_ORDER.map((t) => (
                <button key={t} className={`piece ${t === type ? 'selected' : ''}`} onClick={() => setType(t)} title={PIECES[t].label}>
                  <PieceIcon type={t} />
                  <span>{PIECES[t].label}</span>
                </button>
              ))}
            </div>

            <div className="panel-row">
              <button className="btn ghost" onClick={() => editorRef.current?.undo()}>
                Deshacer
              </button>
              <button className="btn ghost" onClick={() => editorRef.current?.redo()}>
                Rehacer
              </button>
              <button className="btn ghost" onClick={() => confirm('¿Borrar todos los tramos?') && editorRef.current?.clear()}>
                Vaciar
              </button>
            </div>

          </>
        ) : (
          <>
            <label className="field">
              Tempo (BPM)
              <NumberField value={song.bpm} min={40} max={240} onCommit={(bpm) => setSong({ bpm })} />
            </label>
            <label className="field">
              Compás
              <select value={song.beatsPerBar} onChange={(e) => setSong({ beatsPerBar: +e.target.value })}>
                {[2, 3, 4, 5, 6, 7].map((b) => (
                  <option key={b} value={b}>
                    {b}/4
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Velocidad de diseño (km/h)
              <NumberField value={Math.round(song.designSpeed * 3.6)} min={30} max={260} onCommit={(v) => setSong({ designSpeed: v / 3.6 })} />
              <small>La velocidad a la que la melodía suena al tempo original.</small>
            </label>
            <label className="field">
              Inicio de la melodía (m)
              <NumberField value={Math.round(song.startOffset)} min={0} max={400} onCommit={(startOffset) => setSong({ startOffset })} />
              <small>Distancia desde la largada hasta el primer beat, para tomar velocidad.</small>
            </label>
            <label className="field">
              Duración de nota nueva
              <select value={noteLength} onChange={(e) => setNoteLength(+e.target.value)}>
                <option value={0.25}>Semicorchea</option>
                <option value={0.5}>Corchea</option>
                <option value={1}>Negra</option>
                <option value={2}>Blanca</option>
                <option value={4}>Redonda</option>
              </select>
            </label>
            <h3>Efectos de la canción</h3>
            {BUSES.map((bus) => {
              const values = resolveParams(bus.params, song.effects?.[bus.id]);
              return (
                <fieldset key={bus.id} className="param-group song-effects">
                  <legend>{bus.name}</legend>
                  {bus.params.map((p) => (
                    <ParamControl
                      key={p.id}
                      def={p}
                      value={values[p.id]}
                      modified={song.effects?.[bus.id]?.[p.id] !== undefined}
                      onChange={(v) => {
                        const effects = { ...song.effects, [bus.id]: withParam(song.effects?.[bus.id], p, v) };
                        if (!effects[bus.id]) delete effects[bus.id];
                        setSong({ effects: Object.keys(effects).length ? effects : undefined });
                      }}
                    />
                  ))}
                </fieldset>
              );
            })}
            <div className="info">
              En la pista entran <b>{Math.floor(beatsFit)}</b> beats ({(beatsFit / song.beatsPerBar).toFixed(1)} compases). La canción dura{' '}
              <b>{songBeats}</b> beats.
              {outside > 0 && <div className="hint">{outside} nota(s) quedan fuera de la pista: alargala, subí la velocidad o bajá el tempo.</div>}
            </div>
            <button
              className="btn ghost danger"
              disabled={!current.notes.length && !current.repeats.length}
              onClick={() =>
                confirm(`¿Vaciar la pista «${current.name}»?`) &&
                setSong({ tracks: song.tracks.map((t) => (t === current ? { ...t, notes: [], repeats: [] } : t)) })
              }
            >
              Vaciar pista «{current.name}»
            </button>
          </>
        )}

        {cursor && (
          <div className="cursor-info">
            Cursor: ({cursor.cell[0]}, {cursor.cell[2]}) · nivel {cursor.cell[1]} · {ROT_LABEL[cursor.rot]}
          </div>
        )}
        <dl className="keys">
          <dt>Click</dt>
          <dd>colocar tramo</dd>
          <dt>Shift+click / X</dt>
          <dd>borrar tramo</dd>
          <dt>Q / E</dt>
          <dd>rotar</dd>
          <dt>R / F</dt>
          <dd>subir / bajar nivel</dd>
          <dt>WASD / flechas</dt>
          <dd>mover cursor</dd>
          <dt>Enter</dt>
          <dd>colocar en el cursor</dd>
          <dt>Botón der.</dt>
          <dd>rotar cámara (Shift: desplazar)</dd>
          <dt>Rueda</dt>
          <dd>zoom · C encuadrar</dd>
          <dt>Ctrl+Z / Ctrl+Y</dt>
          <dd>deshacer / rehacer</dd>
        </dl>
      </aside>
      {tab === 'music' && (
        <PianoRoll
          song={song}
          selectedTrack={current}
          onSelectTrack={setSelectedTrackId}
          onTracksChange={(tracks) => setSong({ tracks })}
          availableBeats={beatsFit}
          noteLength={noteLength}
        />
      )}
    </div>
  );
}
