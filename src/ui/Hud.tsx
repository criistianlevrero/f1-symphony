import { useEffect, useRef } from 'react';
import type { Game } from '../game/Game';

/**
 * HUD que se actualiza por requestAnimationFrame escribiendo directo al DOM,
 * sin re-renders de React por frame.
 */
export function Hud({ game }: { game: Game }) {
  const speedRef = useRef<HTMLSpanElement>(null);
  const fpsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = game.telemetry;
      if (speedRef.current) speedRef.current.textContent = String(Math.round(Math.abs(t.speedKmh)));
      if (fpsRef.current) fpsRef.current.textContent = `${t.fps} fps`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game]);

  return (
    <>
      <div className="hud-speed">
        <span ref={speedRef}>0</span>
        <small>km/h</small>
      </div>
      <div className="hud-fps" ref={fpsRef} />
      <div className="hud-help">
        W/↑ acelerar · S/↓ frenar/reversa · A/D girar · Espacio derrape · R reiniciar · T panel de manejo
      </div>
    </>
  );
}
