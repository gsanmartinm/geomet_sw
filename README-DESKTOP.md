# GeoMet — App de Escritorio (Windows)

Este es un envoltorio [Electron](https://www.electronjs.org/) de la misma app web de GeoMet (`index.html`, `index.css`, `js/*.js`). No es una copia del código: carga exactamente los mismos archivos, así que cualquier mejora futura a la versión web se empaqueta automáticamente la próxima vez que generes el instalador. **La versión web (GitHub Pages) sigue funcionando exactamente igual** — `package.json` y `electron-main.js` son archivos adicionales que no afectan el sitio.

## Qué gana la versión de escritorio

- **RAM**: no compite por memoria con otras pestañas del navegador ni queda sujeta a que Chrome la descarte en segundo plano. Además, `electron-main.js` sube automáticamente el límite de heap de V8 según la RAM total del equipo (60% de la RAM, entre 2GB y 16GB) — útil para modelos de bloques muy grandes.
- **GPU**: fuerza aceleración por hardware e ignora la lista negra de GPUs de Chromium, para evitar que caiga a renderizado por software en notebooks con tarjetas gráficas menos comunes.

## Requisitos

- [Node.js LTS](https://nodejs.org/) instalado (incluye `npm`). Solo se necesita para generar el instalador, **no** lo necesitan las personas que van a usar la app final.

## Cómo generar el instalador (PowerShell)

```powershell
cd "G:\Shared drives\04 Biblioteca\05_SW_Geomet"
npm install
npm run dist
```

Esto descarga Electron y `electron-builder` (solo la primera vez) y genera el instalador en `dist-desktop\GeoMet Setup 1.0.7.exe`. Ese `.exe` es el que se comparte/instala en cualquier PC con Windows — no requiere Node.js ni nada adicional.

## Probar sin generar instalador (modo desarrollo)

```powershell
cd "G:\Shared drives\04 Biblioteca\05_SW_Geomet"
npm install
npm start
```

Abre la app en una ventana de Electron directamente, sin empaquetar nada — útil para probar rápido antes de generar el instalador final.

## Actualizar la app instalada

Como los datos se cargan desde archivos incluidos en el instalador (no desde internet), cuando yo suba mejoras a la app hay que repetir `npm run dist` y volver a instalar el `.exe` generado (como actualizar cualquier programa de Windows). No hay auto-actualización configurada todavía.

## Ícono personalizado (opcional)

Por ahora el instalador usa el ícono por defecto de Electron. Para usar el ícono de GeoMet (`favicon.svg`):

1. Convertí `favicon.svg` a un archivo `.ico` (multi-resolución, 256x256 recomendado) — por ejemplo con [icoconvert.com](https://icoconvert.com) o ImageMagick.
2. Guardalo como `build\icon.ico` en la raíz del repo.
3. Agregá esta línea dentro de `"win": { ... }` en `package.json`:
   ```json
   "icon": "build/icon.ico"
   ```
4. Volvé a correr `npm run dist`.
