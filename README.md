# F1 Symphony

Juego de manejo 3D en el navegador (física arcade estilo Trackmania) donde la pista
es una partitura: cada marcador que tocás suena, y el objetivo es tocar la melodía
con precisión rítmica.

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + build de producción
npm test           # tests (puntaje)
```

## Controles

| Tecla | Acción |
|---|---|
| W / ↑ | Acelerar |
| S / ↓ | Frenar / reversa |
| A D / ← → | Girar (en el aire: rotar) |
| Espacio | Freno de mano / derrape |
| R | Volver al punto de partida |
| M | Activar o desactivar el metrónomo |
| T | Panel de ajuste del manejo |
| Esc | Volver al menú o al editor |

## Editor

Pestaña **Pista**: elegí un tramo y hacé click en la grilla para colocarlo (el
cursor salta a la salida del tramo, así se puede seguir encadenando con Enter).
Q/E rotan, R/F suben y bajan de nivel, Shift+click o X borran, y Ctrl+Z deshace.
El botón derecho rota la cámara (con Shift la desplaza).

Pestaña **Música**: tempo, compás, velocidad de diseño y piano roll. Los
marcadores se ubican solos sobre la pista según la melodía.

Pestaña **Decoración**: estética de la pista y sus assets decorativos (p. ej. palmeras
en Día). Se colocan en la grilla igual que los tramos; son solo visuales, sin física,
y se pueden poner sobre la pista.

## Documentación

- [Diseño](docs/DESIGN.md)
- [Exportar el modelo del auto](docs/CAR_MODEL.md)
- [Assets de decoración](docs/DECOR_ASSETS.md)
