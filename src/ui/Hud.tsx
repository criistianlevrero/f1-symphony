import { useEffect, useRef } from 'react';
import type { Game } from '../game/Game';
import { MusicHud } from './MusicHud';

export function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/**
 * HUD que se actualiza por requestAnimationFrame escribiendo directo al DOM,
 * sin re-renders de React por frame.
 */
export function Hud({ game, onExit }: { game: Game; onExit: () => void }) {
  const speedRef = useRef<HTMLSpanElement>(null);
  const fpsRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = game.telemetry;
      if (speedRef.current) speedRef.current.textContent = String(Math.round(Math.abs(t.speedKmh)));
      if (fpsRef.current) fpsRef.current.textContent = `${t.fps} fps`;
      if (timeRef.current) timeRef.current.textContent = formatTime(t.raceTime);
      if (bannerRef.current) {
        const finishedText = game.music ? '' : `¡Llegada! ${formatTime(t.raceTime)} · R para reintentar`;
        const text = t.state === 'finished' ? finishedText : t.state === 'ready' ? 'Acelerá para largar' : '';
        if (bannerRef.current.textContent !== text) bannerRef.current.textContent = text;
        bannerRef.current.style.display = text ? '' : 'none';
      }
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
      <div className="hud-time" ref={timeRef} />
      <div className="hud-banner" ref={bannerRef} />
      <div className="hud-fps" ref={fpsRef} />
      {game.music && <MusicHud game={game} music={game.music} onExit={onExit} />}
      <div className="hud-help">
        W/↑ acelerar · S/↓ frenar/reversa · A/D girar · Espacio derrape · R reiniciar · M metrónomo · T panel de manejo
      </div>
    </>
  );
}
