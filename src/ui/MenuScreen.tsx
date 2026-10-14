import { useRef, useState } from 'react';
import { deleteTrack, importTrackFile, listTracks, loadTrack, newId, newTrack, saveTrack } from '../track/storage';
import type { TrackData } from '../track/types';

interface Props {
  onPlay: (track: TrackData) => void;
  onEdit: (track: TrackData) => void;
}

export function MenuScreen({ onPlay, onEdit }: Props) {
  const [tracks, setTracks] = useState(listTracks);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => setTracks(listTracks());

  const open = (id: string, action: (t: TrackData) => void) => {
    const t = loadTrack(id);
    if (t) action(t);
    else setError('No se pudo cargar la pista');
  };

  const duplicate = (id: string) => {
    const t = loadTrack(id);
    if (!t) return;
    saveTrack({ ...t, id: newId(), name: `${t.name} (copia)` });
    refresh();
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      await importTrackFile(file);
      setError('');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="screen menu">
      <div className="menu-card">
        <h1>
          F1 <span>Symphony</span>
        </h1>
        <div className="panel-row">
          <button className="btn primary" onClick={() => onEdit(newTrack())}>
            + Nueva pista
          </button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            Importar…
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
        </div>
        {error && <div className="hint">{error}</div>}
        <ul className="track-list">
          {tracks.map((t) => (
            <li key={t.id}>
              <div className="track-name">
                {t.name}
                <small>{t.builtin ? 'Incluida' : new Date(t.updatedAt).toLocaleString()}</small>
              </div>
              <button className="btn primary" onClick={() => open(t.id, onPlay)}>
                Jugar
              </button>
              <button className="btn" onClick={() => open(t.id, onEdit)}>
                Editar
              </button>
              <button className="btn ghost" onClick={() => duplicate(t.id)}>
                Duplicar
              </button>
              {!t.builtin && (
                <button
                  className="btn ghost danger"
                  onClick={() => {
                    if (confirm(`¿Borrar «${t.name}»?`)) {
                      deleteTrack(t.id);
                      refresh();
                    }
                  }}
                >
                  Borrar
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
