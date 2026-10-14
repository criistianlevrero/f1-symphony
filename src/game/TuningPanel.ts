import GUI from 'lil-gui';
import type { Game } from './Game';
import { carTuning } from './tuning';

/** Panel de desarrollo para ajustar el manejo en vivo. Se muestra con la tecla T. */
export function createTuningPanel(game: Game) {
  const gui = new GUI({ title: 'Manejo (T)' });
  gui.hide();
  const t = carTuning;
  const wheels = () => game.carInstance.applyWheelTuning();

  const motor = gui.addFolder('Motor y freno');
  motor.add(t, 'engineForce', 1000, 15000, 100);
  motor.add(t, 'reverseForce', 500, 8000, 100);
  motor.add(t, 'brakeForce', 10, 300, 5);
  motor.add(t, 'topSpeed', 20, 120, 1).name('topSpeed (m/s)');

  const steer = gui.addFolder('Dirección');
  steer.add(t, 'steerMaxLowSpeed', 0.1, 1, 0.01);
  steer.add(t, 'steerMaxHighSpeed', 0.02, 0.5, 0.01);
  steer.add(t, 'steerRate', 0.5, 15, 0.1);

  const grip = gui.addFolder('Agarre');
  grip.add(t, 'frictionSlip', 0.5, 10, 0.1).onChange(wheels);
  grip.add(t, 'sideFrictionStiffness', 0.2, 4, 0.05).onChange(wheels);
  grip.add(t, 'driftSideFriction', 0.05, 2, 0.05);
  grip.add(t, 'downforce', 0, 5, 0.05);

  const susp = gui.addFolder('Suspensión').close();
  susp.add(t, 'suspensionRestLength', 0.1, 0.8, 0.01).onChange(wheels);
  susp.add(t, 'suspensionStiffness', 5, 200, 1).onChange(wheels);
  susp.add(t, 'suspensionCompression', 0.5, 20, 0.1).onChange(wheels);
  susp.add(t, 'suspensionRelaxation', 0.5, 20, 0.1).onChange(wheels);
  susp.add(t, 'maxSuspensionTravel', 0.05, 1, 0.01).onChange(wheels);

  const air = gui.addFolder('Aire y mundo').close();
  air.add(t, 'airControlTorque', 0, 6000, 50);
  air.add(t, 'angularDamping', 0, 5, 0.05).onChange(wheels);
  air.add(t, 'gravity', -40, -5, 0.5).onChange((g: number) => game.setGravity(g));

  gui.add({ copiar: () => navigator.clipboard?.writeText(JSON.stringify(t, null, 2)) }, 'copiar').name('Copiar valores (JSON)');

  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyT' && !e.repeat) gui.show(gui._hidden);
  };
  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('keydown', onKey);
    gui.destroy();
  };
}
