import { useCallback, useState } from 'react';
import type { TrackData } from './track/types';
import { EditorScreen } from './ui/EditorScreen';
import { MenuScreen } from './ui/MenuScreen';
import { PlayScreen } from './ui/PlayScreen';

type Screen =
  | { kind: 'menu' }
  | { kind: 'edit' }
  | { kind: 'play'; track: TrackData; from: 'menu' | 'edit' };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' });
  // Pista abierta en el editor: sobrevive a ir a "Probar" y volver.
  const [editing, setEditing] = useState<{ track: TrackData; dirty: boolean } | null>(null);

  const toMenu = useCallback(() => {
    if (editing?.dirty && !confirm('Hay cambios sin guardar. ¿Salir igual?')) return;
    setEditing(null);
    setScreen({ kind: 'menu' });
  }, [editing]);

  const exitPlay = useCallback(() => {
    setScreen((s) => (s.kind === 'play' && s.from === 'edit' ? { kind: 'edit' } : { kind: 'menu' }));
  }, []);

  switch (screen.kind) {
    case 'menu':
      return (
        <MenuScreen
          onPlay={(track) => setScreen({ kind: 'play', track, from: 'menu' })}
          onEdit={(track) => {
            setEditing({ track, dirty: false });
            setScreen({ kind: 'edit' });
          }}
        />
      );
    case 'edit':
      return editing ? (
        <EditorScreen
          track={editing.track}
          dirty={editing.dirty}
          onChange={(track, dirty) => setEditing({ track, dirty })}
          onPlay={() => setScreen({ kind: 'play', track: editing.track, from: 'edit' })}
          onExit={toMenu}
        />
      ) : null;
    case 'play':
      return (
        <PlayScreen track={screen.track} onExit={exitPlay} exitLabel={screen.from === 'edit' ? 'Editor' : 'Menú'} />
      );
  }
}
