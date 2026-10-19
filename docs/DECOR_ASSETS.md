# Assets de decoración

La decoración son modelos `.glb` que se ubican en la grilla del editor (pestaña
**Decoración**). Son **solo visuales**: no tienen física, el auto los atraviesa y se
pueden poner encima de la pista. Cada estética tiene su propia lista de assets.

Ejemplo actual: la palmera de la estética **Día** (`public/models/palmera.glb`, fuente
en `original assets/palmera.blend`).

## Exportar desde Blender

`File → Export → glTF 2.0`, con **Format: glTF Binary (.glb)**.

1. **Escala real en metros.** Una celda de la grilla mide 16 × 16 m y un nivel 4 m de
   alto (`CELL` y `LEVEL` en `src/track/pieces.ts`). La palmera mide ~8 m.
2. **Origen en la base del objeto**, en el piso. El origen es el punto que cae sobre la
   intersección de la grilla donde está el cursor; lo que quede debajo de él queda
   enterrado.
3. **Frente hacia +X de Blender.** Con rotación 0 el modelo queda como en Blender; Q/E
   en el editor lo giran de a 90°. Para assets simétricos (como la palmera) da igual.
4. Aplicá las transformaciones si el objeto raíz tiene escala o rotación raras
   (`Ctrl+A → All Transforms`). Los objetos hijos pueden tener transformaciones propias.
5. Materiales con **Principled BSDF**. Si hay texturas, que queden empaquetadas en el
   `.glb`.
6. **Liviano.** Cada instancia se dibuja por separado (una llamada de dibujo por malla y
   material), así que conviene pocas mallas y pocos materiales, y pocos miles de
   vértices. La palmera tiene 2 mallas y ~2.200 vértices.

Opciones del exportador: *+Y Up* activado, *Apply Modifiers* activado, animación
desactivada.

## Agregarlo al juego

1. Guardá el `.glb` en `public/models/` y la fuente `.blend` en `original assets/`.
2. Sumalo al `decor` de la estética en `src/track/themes.ts`:

   ```ts
   decor: [
     { id: 'palmera', label: 'Palmera', url: 'models/palmera.glb' },
     { id: 'globo', label: 'Globo', url: 'models/globo.glb' },
   ],
   ```

   - `id` es lo que se guarda en la pista: **no lo cambies** una vez usado, o las pistas
     guardadas pierden esa decoración (se conserva en el archivo, pero no se dibuja).
   - `label` es el nombre en la paleta del editor.
   - `url` es relativa a `public/`.

No hace falta tocar nada más: el editor y el juego cargan los modelos de la estética
(`src/track/decor.ts`) y los dibujan con sombra. Si un `.glb` no carga, se omite con
un aviso en la consola y el resto de la escena sigue funcionando.
