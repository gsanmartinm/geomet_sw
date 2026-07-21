# GeoMet V1 — Software de Geometalurgia

GeoMet es un visualizador 3D de datos geomineros que corre 100% en el navegador: modelos de bloques, sondajes, muestras metalúrgicas y superficies DXF, todo en una sola pantalla, sin instalar nada y sin subir datos a ningún servidor.

Está construido en JavaScript, HTML y CSS puro (sin frameworks ni paso de compilación) usando [Three.js](https://threejs.org/) para el render 3D. Cualquiera con el link puede abrirlo y empezar a cargar sus propios archivos.

> 🔗 **Demo en vivo:** https://gsanmartinm.github.io/geomet_sw/

## ¿Qué hace?

- Visualiza **modelos de bloques** como nube de puntos o cajas sólidas instanciadas, coloreados por cualquier atributo numérico o categórico (leyes, litología, etc.).
- Visualiza **sondajes (drillholes)** como cilindros coloreados por atributo de ensayo (assay).
- Visualiza **muestras metalúrgicas** como puntos, coloreadas por atributo.
- Importa y visualiza **superficies y geometrías DXF** (topografía, diseños de mina, sólidos), con control de color y transparencia en vivo, por capa.
- Permite **vistas de sección y planta** (Planta, Sección N-S, Sección E-O) con una ventana de espesor configurable de forma independiente para Bloques, Sondajes/Muestras y Superficies DXF — las superficies DXF se recortan (clip) a esa ventana, mostrando el borde/curva de nivel donde la superficie cruza el corte.
- **Variables calculadas**: crea atributos nuevos en base a los ya cargados (ej. `CUS/CUT`) con un editor de fórmulas por texto/chips, independiente por capa (Bloques, Sondajes, Muestras) y encadenable entre sí.
- Filtros por atributo (numéricos y categóricos), independientes por tipo de capa.
- Paletas de color predefinidas (Rainbow, Viridis, Magma, Coolwarm) o una **paleta personalizable** (colores mín/máx a elección) por capa, además de **colores editables por categoría** para atributos categóricos (litología, tipo de sondaje, etc.).
- Leyendas arrastrables con **on/off independiente por capa**, grilla de referencia configurable (espaciado, transparencia, tamaño de números) con cotas/coordenadas en vistas ortogonales, brújula y gizmo de ejes X/Y/Z.
- **Eliminación de capas** cargadas (no solo ocultarlas): libera los datos y la memoria de esa capa por completo.
- **Pestaña Vistas**: bloquea la cámara en una proyección ortográfica (sin distorsión, como un plano técnico) alineada al corte activo, con etiquetas de texto configurables (variable, color, tamaño) por capa, anotaciones opcionales (archivos de origen, filtros aplicados, cota/sección, leyenda de variables) y exportación a **PNG** lista para imprimir o compartir. Las configuraciones de vista se pueden guardar y reaplicar dentro de la misma sesión.
- Plantillas de mapeo de columnas guardables, para no tener que remapear archivos con el mismo formato cada vez.

## Tipos de archivo soportados

| Capa | Formato | Notas |
|---|---|---|
| Modelo de Bloques | `.csv` / `.txt` | Mapeo configurable de columnas (X, Y, Z, tamaños, atributos numéricos/categóricos). |
| Sondajes (Drillholes) | `.csv` / `.txt` (Collar, Survey, Assay, y Geología opcional — archivos separados) | Formato clásico de base de datos de sondajes. |
| Muestras Metalúrgicas | `.csv` / `.txt` | Mapeo configurable de columnas, igual que Bloques. |
| Superficies / Geometrías DXF | `.dxf` | Soporta entidades `3DFACE`, `LINE`, `LWPOLYLINE` y `POLYLINE`. Probado con archivos de hasta ~650 MB (lectura y parseo en un Web Worker, por trozos, sin cargar el archivo completo en memoria). |

Todos los archivos se procesan **localmente en el navegador** — nada se sube a un servidor. Los datos no quedan guardados dentro del repositorio (ver carpeta `data/`, excluida vía `.gitignore`): cada usuario carga sus propios archivos desde el importador de la app.

## Uso principal

GeoMet está pensado como una herramienta rápida de revisión y control de calidad geominero: cargar un modelo de bloques o una base de sondajes y explorar leyes/litología en 3D, cruzar visualmente con topografía o diseños DXF, cortar secciones y plantas para inspeccionar un nivel o perfil específico, filtrar por atributo para aislar zonas de interés, y exportar esa vista como un plano o sección en PNG con sus etiquetas y anotaciones — todo sin depender de software CAD/GIS pesado ni licencias de terceros.

## Cómo usarlo

**Opción 1 — Online:** abrir el link de GitHub Pages de arriba y cargar tus archivos desde los botones de importación.

**Opción 2 — Local:** clonar el repositorio y abrirlo con cualquier servidor estático (no funciona con `file://` directo, por las restricciones de CORS de los Web Workers/módulos). En Windows, se incluye `start_server.ps1` para levantar un servidor local rápido.

No requiere `npm install`, build ni backend: es HTML/CSS/JS servido tal cual.

## Limitaciones

- Corre enteramente en el navegador: el límite real de tamaño de archivo/cantidad de datos depende de la memoria disponible en la pestaña (RAM del equipo del usuario), no de un servidor.
- No hay persistencia ni sincronización entre usuarios: cada sesión es local a esa pestaña del navegador; para compartir una vista hay que compartir los archivos de origen.
- Requiere un navegador moderno con soporte de WebGL y Web Workers (Chrome, Edge, Firefox recientes).
- Asume la convención geominera X = Este, Y = Norte, Z = Elevación/RL.
- No incluye autenticación ni control de acceso — cualquiera con el link de GitHub Pages puede usarlo y cargar sus propios archivos.
- El importador de Bloques/Sondajes/Muestras trabaja con CSV/TXT; no lee Excel (`.xlsx`) directamente (hay que exportarlo a CSV primero).

## Estructura del proyecto

```
index.html          Estructura de la app y controles de UI
index.css           Estilos
js/app.js           Orquestador principal (eventos de UI, estado, filtros, Vistas/exportación)
js/scene.js         Escena Three.js: cámaras (perspectiva y ortográfica de Modo Vista), render de capas, secciones, etiquetas, ejes
js/importer.js       Modal de importación, mapeo de columnas, plantillas
js/worker-parser.js  Web Worker: parseo de CSV/DXF fuera del hilo principal
js/dxf-parser.js     Parser DXF (streaming, corre dentro del Worker)
js/octree.js         Índice espacial para filtrado rápido por sección
js/formula-eval.js   Parser/evaluador de fórmulas para Variables Calculadas
js/presets.js        Paletas de color y presets
start_server.ps1     Script para levantar un servidor local en Windows
```

## Licencia

Este proyecto es de código abierto bajo licencia **MIT** (ver [`LICENSE`](./LICENSE)): cualquiera puede usarlo, copiarlo, modificarlo y redistribuirlo libremente, incluso para fines comerciales.

La única condición es mantener siempre el crédito al creador original, **Gerardo San Martín**, en cualquier copia, versión modificada o despliegue derivado de este software.
