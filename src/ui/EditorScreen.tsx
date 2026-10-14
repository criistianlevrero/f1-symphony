import { useEffect, useRef, useState } from 'react';
import { Editor, type EditorCursor } from '../editor/Editor';
import { PIECE_ORDER, PIECES } from '../track/pieces';
import { exportTrackFile, saveTrack } from '../track/storage';
import type { PieceType, TrackData } from '../track/types';
import { PieceIcon } from './PieceIcon';

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

  useEffect(() => {
    const editor = new Editor(containerRef.current!, trackRef.current.pieces, {
      onChange: (pieces) => onChange({ ...trackRef.current, pieces }, true),
      onCursor: setCursor,
    });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
    // El editor se crea una sola vez por montaje; los cambios fluyen por onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => editorRef.current?.setPieceType(type), [type]);

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
    </div>
  );
}
