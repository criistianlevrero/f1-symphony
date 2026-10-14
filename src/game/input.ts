export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (freno / reversa)
  steer: number; // -1 (izq) .. 1 (der)
  handbrake: boolean;
  reset: boolean;
}

const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  reset: ['KeyR', 'Backspace'],
};

export class Keyboard {
  private pressed = new Set<string>();
  private resetQueued = false;

  private onDown = (e: KeyboardEvent) => {
    if (Object.values(KEYS).some((codes) => codes.includes(e.code))) e.preventDefault();
    if (KEYS.reset.includes(e.code) && !e.repeat) this.resetQueued = true;
    this.pressed.add(e.code);
  };
  private onUp = (e: KeyboardEvent) => this.pressed.delete(e.code);
  private onBlur = () => this.pressed.clear();

  constructor(private target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  private any(codes: string[]) {
    return codes.some((c) => this.pressed.has(c));
  }

  read(): DriveInput {
    const reset = this.resetQueued;
    this.resetQueued = false;
    return {
      throttle: this.any(KEYS.up) ? 1 : 0,
      brake: this.any(KEYS.down) ? 1 : 0,
      steer: (this.any(KEYS.right) ? 1 : 0) - (this.any(KEYS.left) ? 1 : 0),
      handbrake: this.any(KEYS.handbrake),
      reset,
    };
  }

  dispose() {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
