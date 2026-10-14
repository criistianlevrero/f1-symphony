import { useEffect, useRef, useState } from 'react';
import { Game } from './game/Game';
import { createTuningPanel } from './game/TuningPanel';
import { Hud } from './ui/Hud';
import { demoTrack } from './track/demo';

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let instance: Game | null = null;
    let disposePanel: (() => void) | null = null;

    Game.create(containerRef.current!, demoTrack())
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
  }, []);

  return (
    <div className="app">
      <div ref={containerRef} className="viewport" />
      {game && <Hud game={game} />}
      {!game && !error && <div className="overlay">Cargando…</div>}
      {error && <div className="overlay error">{error}</div>}
    </div>
  );
}
