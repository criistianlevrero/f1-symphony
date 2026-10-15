import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Theme } from '../track/themes';

export interface RenderPipeline {
  render: () => void;
  /** Tamaño en píxeles CSS, igual que `renderer.setSize`. */
  setSize: (width: number, height: number) => void;
  dispose: () => void;
}

/**
 * Cómo se dibuja la escena según la estética. Sin bloom se usa el render directo (sin
 * costo extra); con bloom, un composer con resplandor. Crearlo después de fijar el
 * pixel ratio del renderer, que el composer toma al construirse.
 */
export function createRenderPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  theme: Theme,
): RenderPipeline {
  const bloom = theme.bloom;
  if (!bloom) return { render: () => renderer.render(scene, camera), setSize: () => {}, dispose: () => {} };

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // Con MSAA: los render targets del composer no heredan el antialias del canvas.
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(size, bloom.strength, bloom.radius, bloom.threshold);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  return {
    render: () => composer.render(),
    setSize: (w, h) => composer.setSize(w, h),
    dispose: () => {
      bloomPass.dispose();
      composer.dispose();
    },
  };
}
