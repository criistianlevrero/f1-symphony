import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game/Game';
import type { MusicRun } from '../music/MusicRun';
import { JUDGEMENTS, type RunResult } from '../music/scoring';
import { formatTime } from './Hud';

const W = 560;
const H = 96;

/**
 * Metrónomo de dos barras: arriba el tempo original, abajo el del jugador
 * (según su posición en la pista). Cada barra es un compás que se recorre de
 * izquierda a derecha; el primer tiempo tiene la marca larga.
 */
function drawMetronome(ctx: CanvasRenderingContext2D, music: MusicRun, speed: number) {
  const { originalBeat, playerBeat, beatsPerBar, bpm, designSpeed } = music.hud;
  ctx.clearRect(0, 0, W, H);
  const labelW = 118;
  const barX = labelW;
  const barW = W - labelW - 12;
  const rows = [
    { beat: originalBeat, label: `Original`, sub: `${bpm} BPM`, color: '#f2f2f2' },
    { beat: playerBeat, label: 'Vos', sub: `${Math.round((bpm * speed) / designSpeed)} BPM`, color: '#e03a3a' },
  ];
  rows.forEach((row, r) => {
    const y = 14 + r * 42;
    const h = 26;
    ctx.fillStyle = 'rgba(10,12,16,0.55)';
    ctx.beginPath();
    ctx.roundRect(barX, y, barW, h, 6);
    ctx.fill();

    const inBar = ((row.beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const x = barX + (inBar / beatsPerBar) * barW;
    const counting = row.beat < 0;
    ctx.fillStyle = counting ? 'rgba(255,255,255,0.08)' : r === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(224,58,58,0.28)';
    ctx.beginPath();
    ctx.roundRect(barX, y, Math.max(0, x - barX), h, 6);
    ctx.fill();

    // Marcas de beat: la primera larga, el resto cortas.
    for (let b = 0; b < beatsPerBar; b++) {
      const bx = barX + (b / beatsPerBar) * barW + (b === 0 ? 3 : 0);
      const th = b === 0 ? h : h * 0.45;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(bx - 1, y + (h - th) / 2, b === 0 ? 3 : 2, th);
    }
    ctx.fillStyle = row.color;
    ctx.fillRect(x - 2, y - 4, 4, h + 8);

    ctx.textBaseline = 'middle';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillStyle = row.color;
    ctx.fillText(row.label, 6, y + 8);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(counting ? `entrada ${Math.ceil(-row.beat)}` : `${row.sub} · c.${Math.floor(row.beat / beatsPerBar) + 1}`, 6, y + 22);
  });
}

export function MusicHud({ game, music, onExit }: { game: Game; music: MusicRun; onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const judgeRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    let raf = 0;
    let lastJudgeAt = -1;
    let finished = false;
    const tick = () => {
      const t = game.telemetry;
      const speed = Math.abs(t.speedKmh) / 3.6;
      drawMetronome(ctx, music, speed);

      const hud = music.hud;
      if (scoreRef.current) {
        scoreRef.current.innerHTML = `<b>${hud.score}</b> pts<br><small>Combo ×${hud.combo} · ${hud.resolved}/${hud.total}</small>`;
      }
      if (speedRef.current) {
        const target = hud.designSpeed * 3.6;
        const diff = (Math.abs(t.speedKmh) - target) / target;
        speedRef.current.textContent = `Sugerida ${Math.round(target)} km/h`;
        speedRef.current.dataset.state = Math.abs(diff) < 0.05 ? 'ok' : diff < 0 ? 'low' : 'high';
      }
      const last = hud.last;
      if (judgeRef.current && last && last.at !== lastJudgeAt) {
        lastJudgeAt = last.at;
        const el = judgeRef.current;
        el.textContent = JUDGEMENTS[last.judgement].label;
        el.style.color = JUDGEMENTS[last.judgement].color;
        el.classList.remove('pop');
        void el.offsetWidth; // reinicia la animación
        el.classList.add('pop');
      }
      const isFinished = t.state === 'finished';
      if (isFinished !== finished) {
        finished = isFinished;
        setResult(isFinished ? music.result() : null);
        if (!isFinished && judgeRef.current) judgeRef.current.classList.remove('pop');
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game, music]);

  return (
    <>
      <canvas ref={canvasRef} className="metronome" style={{ width: W, height: H }} />
      <div ref={speedRef} className="hud-suggested" />
      <div ref={scoreRef} className="hud-score" />
      <div ref={judgeRef} className="hud-judgement" />
      {result && <Results result={result} time={game.telemetry.raceTime} bpm={music.hud.bpm} onExit={onExit} />}
    </>
  );
}

function Results({ result, time, bpm, onExit }: { result: RunResult; time: number; bpm: number; onExit: () => void }) {
  const playerBpm = Math.round(bpm / result.tempoFactor);
  const tempoDiff = Math.round((1 / result.tempoFactor - 1) * 100);
  return (
    <div className="results">
      <div className="grade">{result.grade}</div>
      <div className="results-score">{result.score.toLocaleString()} pts</div>
      <dl>
        <dt>Precisión rítmica</dt>
        <dd>{Math.round(result.accuracy * 100)}%</dd>
        <dt>Tu tempo</dt>
        <dd>
          {playerBpm} BPM ({tempoDiff >= 0 ? '+' : ''}
          {tempoDiff}%)
        </dd>
        <dt>Bonus por tempo</dt>
        <dd>+{Math.round(result.tempoBonus * 100)}%</dd>
        <dt>Combo máximo</dt>
        <dd>{result.maxCombo}</dd>
        <dt>Tiempo</dt>
        <dd>{formatTime(time)}</dd>
      </dl>
      <div className="results-counts">
        {(Object.keys(JUDGEMENTS) as (keyof typeof JUDGEMENTS)[]).map((j) => (
          <span key={j} style={{ color: JUDGEMENTS[j].color }}>
            {JUDGEMENTS[j].label.replace(/[¡!]/g, '')}: {result.counts[j]}
          </span>
        ))}
      </div>
      <div className="panel-row center">
        <span className="hint-text">
          <kbd>R</kbd> reintentar
        </span>
        <button className="btn" onClick={onExit}>
          Volver
        </button>
      </div>
    </div>
  );
}
