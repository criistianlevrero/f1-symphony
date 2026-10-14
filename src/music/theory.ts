const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_ES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];

export const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
export const noteNameEs = (midi: number) => `${NAMES_ES[midi % 12]}${Math.floor(midi / 12) - 1}`;
export const isBlackKey = (midi: number) => NAMES[midi % 12].includes('#');
export const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Color de la nota según su clase (Do, Re…), en el círculo cromático. */
export const pitchHue = (midi: number) => ((midi % 12) * 7 % 12) / 12;
