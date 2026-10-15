import { useEffect, useRef } from 'react';

const VERT = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
out vec4 outColor;

// Altura de la tela: ondas que viajan en diagonal.
float height(vec2 p, float t) {
  return sin(p.x * 1.6 + p.y * 0.6 - t * 1.8) * 0.55
       + sin(p.x * 0.9 - p.y * 1.3 - t * 1.3) * 0.35
       + sin(p.x * 2.7 + p.y * 1.9 - t * 2.6) * 0.12;
}

// Onda cuadrada suavizada por píxel (evita el aliasing en los bordes).
float square(float x) {
  float tri = abs(fract(x) - 0.5) - 0.25;
  return clamp(tri / fwidth(x), -1.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y * 4.0;
  float h = height(p, uTime);
  const float e = 0.01;
  vec2 g = vec2(height(p + vec2(e, 0.0), uTime) - h, height(p + vec2(0.0, e), uTime) - h) / e;

  // Los pliegues desplazan la textura.
  vec2 q = p + g * 0.12 + vec2(0.0, h * 0.25);
  float c = cos(-0.35), s = sin(-0.35);
  q = mat2(c, -s, s, c) * q * 1.6;
  float checker = 0.5 + 0.5 * square(q.x) * square(q.y);

  // Luz difusa según la normal de la tela + sombreado por altura.
  vec3 n = normalize(vec3(-g * 0.35, 1.0));
  vec3 l = normalize(vec3(-0.4, 0.5, 0.75));
  float shade = (0.45 + 0.65 * max(dot(n, l), 0.0)) * mix(0.75, 1.1, h * 0.5 + 0.5);

  // Teñido con la paleta de la UI: oscuro = --bg, claro = gris azulado.
  vec3 dark = vec3(0.067, 0.078, 0.102);
  vec3 light = vec3(0.56, 0.61, 0.70);
  vec3 col = mix(dark, light, checker) * shade;

  // Viñeta para que el centro (la lista) se lea mejor.
  vec2 d = uv - 0.5;
  col *= 0.8 - 0.6 * dot(d, d);
  outColor = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
  return sh;
}

/** Bandera a cuadros ondulando, de fondo. Sin WebGL2 queda el fondo CSS. */
export function CheckeredFlagBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext('webgl2', { antialias: false, alpha: false });
    if (!canvas || !gl) return;

    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    } catch (e) {
      console.error(e);
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');

    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;
    const frame = () => {
      const dpr = Math.min(devicePixelRatio, 1.5);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, still ? 1.5 : (performance.now() - start) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      // No usar loseContext(): StrictMode remonta el efecto sobre el mismo canvas.
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, []);

  return <canvas ref={ref} className="flag-bg" aria-hidden />;
}
