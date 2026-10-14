// Parámetros del manejo. Todo en unidades SI (metros, segundos, kg).
// Convención del chasis: +X adelante, +Y arriba, +Z derecha.
export const carTuning = {
  mass: 900,
  chassisHalfExtents: { x: 2.0, y: 0.22, z: 0.85 },
  centerOfMassY: -0.35,

  wheelRadius: 0.36,
  wheelBaseX: 1.45, // distancia del centro a cada eje
  wheelTrackZ: 0.9, // distancia del centro a cada rueda, lateral
  wheelMountY: -0.1,
  suspensionRestLength: 0.3,
  suspensionStiffness: 60,
  suspensionCompression: 6,
  suspensionRelaxation: 8,
  maxSuspensionTravel: 0.25,
  maxSuspensionForce: 100000,
  frictionSlip: 3.2,
  sideFrictionStiffness: 1.4,
  driftSideFriction: 0.45,

  engineForce: 5200,
  reverseForce: 2500,
  brakeForce: 90,
  topSpeed: 75, // m/s (~270 km/h)
  maxReverseSpeed: 15,

  steerMaxLowSpeed: 0.55, // radianes
  steerMaxHighSpeed: 0.09,
  steerRate: 5.0, // radianes/s hacia el objetivo

  downforce: 0.9, // N por (m/s)^2
  airControlTorque: 1400,
  angularDamping: 0.8,
  gravity: -20,
};

export type CarTuning = typeof carTuning;
