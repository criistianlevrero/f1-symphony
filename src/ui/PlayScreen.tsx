import { useEffect, useRef, useState } from 'react';
import { Game } from '../game/Game';
import { createTuningPanel } from '../game/TuningPanel';
import type { TrackData } from '../track/types';
import { Hud } from './Hud';

export function PlayScreen({ track, onExit, exitLabel }: { track: TrackData; onExit: () => void; exitLabel: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let instance: Game | null = null;
    let disposePanel: (() => void) | null = null;

    Game.create(containerRef.current!, track)
      .then((g) => {
        if (cancelled) return g.dispose();
        instance = g;
        disposePanel = createTuningPanel(g);
        g.start();
        setGame(g);
      })
      .catch((e: unknown) => setError(String(e)));

    return () => {
      cancelled = true;
      disposePanel?.();
      instance?.dispose();
    };
  }, [track]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  return (
    <div className="screen">
      <div ref={containerRef} className="viewport" />
      {game && <Hud game={game} />}
      {!game && !error && <div className="overlay">Cargando…</div>}
      {error && <div className="overlay error">{error}</div>}
      <button className="btn back-btn" onClick={onExit}>
        ← {exitLabel} <kbd>Esc</kbd>
      </button>
    </div>
  );
}
