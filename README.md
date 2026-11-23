# Software-Termo

Una alternativa moderna, web y de código abierto a EES (Engineering Equation Solver) para estudiantes e ingenieros.

- **Resuelve ecuaciones en cualquier orden.** Escribe el sistema como en el cuaderno; el programa ordena las ecuaciones, separa los bloques acoplados y los resuelve con Newton amortiguado (con respaldo por búsqueda de raíz).
- **Propiedades termodinámicas** de agua/vapor, aire, refrigerantes (R134a, R410A, R22, R32, R1234yf, amoníaco, CO₂…) y aire húmedo, calculadas con [CoolProp](http://www.coolprop.org/) en WebAssembly.
- **Chequeo de unidades.** Escribe `100 [kPa]`, `25 [C]`, `9.81 [m/s^2]`; todo se pasa a SI, se deducen las unidades de cada variable y se marcan las ecuaciones inconsistentes y los números sin unidades.
- **Tablas paramétricas y gráficas**, con exportación a CSV y PNG.
- Funciona en el navegador sin servidor: los cálculos corren en un Web Worker, así que la página nunca se congela.

## Úsalo en línea

https://ianbv1820.github.io/Software-Termo/ (se publica solo con cada cambio en `main`).

## Ejemplo

```
"Ciclo Rankine ideal"
P1 = 10 [kPa]
h1 = enthalpy(Water, P=P1, x=0)
v1 = volume(Water, P=P1, x=0)
P2 = 8 [MPa]
h2 = h1 + v1*(P2 - P1)
T3 = 480 [C]
h3 = enthalpy(Water, T=T3, P=P2)
s3 = entropy(Water, T=T3, P=P2)
h4 = enthalpy(Water, P=P1, s=s3)
eta = ((h3 - h4) - (h2 - h1))/(h3 - h2)
```

La pestaña **Ayuda** dentro de la app tiene la referencia completa de funciones, fluidos y unidades.

## Desarrollo

Requiere Node 20 o superior.

```bash
npm install
npm run dev        # servidor de desarrollo en http://localhost:5173
npm test           # pruebas del motor (solver, unidades, propiedades, ejemplos)
npm run build      # build estático en dist/
```

### Estructura

```
src/engine/   motor sin dependencias de UI (se puede usar desde Node o el navegador)
  parser.ts      lenguaje de ecuaciones estilo EES
  units.ts       unidades y dimensiones
  model.ts       compilación de ecuaciones + chequeo de unidades
  solver.ts      análisis estructural, bloques y Newton
  table.ts       tablas paramétricas
  properties.ts  funciones de propiedades sobre CoolProp
src/worker/   Web Worker que carga CoolProp y ejecuta el motor
src/ui/       interfaz en React (CodeMirror para el editor, Chart.js para gráficas)
tests/        pruebas con Vitest
```

## Versión de escritorio (siguiente paso)

El build es un sitio estático con rutas relativas (`base: './'`), así que se puede empaquetar tal cual con [Tauri](https://tauri.app/) (recomendado: instaladores pequeños para Windows, macOS y Linux):

```bash
npm install -D @tauri-apps/cli
npx tauri init      # frontendDist: ../dist, devUrl: http://localhost:5173
npx tauri build
```

Necesita Rust instalado. Electron también funciona apuntando a `dist/index.html`.

## Licencia

MIT. Las propiedades termodinámicas vienen de CoolProp (MIT), Bell et al., *Ind. Eng. Chem. Res.* 2014.
