# Cómo exportar el auto desde Blender

## Formato: glTF binario (`.glb`)

`File → Export → glTF 2.0`, con **Format: glTF Binary (.glb)**.

### Antes de exportar

1. **Escala real en metros.** El auto actual mide ~5 m de largo y ~2 m de ancho.
   Aplicá las transformaciones: `Ctrl+A → All Transforms`.
2. **Frente del auto hacia -Y de Blender** (o sea, mirando a la cámara en la vista
   frontal, numpad 1). Si apunta hacia otro lado no pasa nada: avisame y lo
   corrijo con una rotación en el código.
3. **Ruedas como objetos separados**, con el origen en el centro de cada rueda y
   estos nombres:
   - `wheel_FL` (delantera izquierda), `wheel_FR`, `wheel_RL`, `wheel_RR`
4. **Carrocería** en uno o varios objetos con cualquier nombre (ej. `body`). Su
   origen idealmente en el centro del auto, a la altura del eje de las ruedas.
5. Materiales con **Principled BSDF** (color, roughness, metallic). Si hay texturas,
   que queden empaquetadas en el `.glb`.

### Opciones del exportador

- Include: *Selected Objects* (o todo, si la escena tiene solo el auto)
- Transform: **+Y Up** activado
- Data → Mesh: *Apply Modifiers* activado
- Animation: desactivada
- Compression: no hace falta (si pesa más de 1 MB, podemos usar Draco)

### Dónde ponerlo

Subilo al repo en `public/models/car.glb`, o pasámelo y lo agrego yo. El collider
de física sigue siendo una caja: el modelo es solo visual. Las posiciones de las
ruedas del modelo se usan para ubicar las ruedas físicas.
