/**
 * GeoMet V1 — Entry point de la app de escritorio (Electron).
 *
 * IMPORTANTE: este archivo NO duplica la app — carga los MISMOS
 * index.html / index.css / js/*.js que usa la versión web (ver loadFile()
 * más abajo, apunta al index.html de la raíz del repo). No existe una copia
 * paralela del código: cualquier cambio futuro a la app web se empaqueta
 * automáticamente la próxima vez que se genere el instalador (ver
 * README-DESKTOP.md). La versión web (GitHub Pages) sigue funcionando
 * exactamente igual, sin tocar nada — este archivo y package.json son
 * simplemente archivos adicionales que GitHub Pages ignora al servir el sitio.
 *
 * Qué gana la versión de escritorio frente a abrir la misma URL en un
 * navegador normal:
 *
 * 1. RAM: no comparte proceso/memoria con otras pestañas del navegador ni
 *    queda sujeto a que Chrome descarte la pestaña en segundo plano para
 *    ahorrar memoria. Además se sube el límite de heap de V8
 *    (--max-old-space-size) según la RAM total del equipo (ver
 *    getSuggestedHeapMB() abajo) — el límite por defecto de V8 puede
 *    quedarse corto en equipos con harta RAM disponible, justo el
 *    escenario de "import de modelo de bloques de 2GB+" que motivó esto.
 *
 * 2. GPU: se fuerza aceleración por hardware y se ignora la lista negra de
 *    GPUs de Chromium (--ignore-gpu-blocklist / --enable-gpu-rasterization),
 *    para evitar que Electron caiga a renderizado por software en equipos
 *    con tarjetas gráficas menos comunes o antiguas que Chromium no
 *    reconoce automáticamente — común en notebooks corporativos.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');

/**
 * Sugiere un límite de heap de V8 (en MB) proporcional a la RAM total del
 * equipo, en vez de un valor fijo — así un equipo con 64GB realmente puede
 * usar mucho más que uno con 8GB. Se usa el 60% de la RAM total como techo
 * razonable (deja margen para el sistema operativo, Chromium/GPU process,
 * y otros programas abiertos), con un piso de 2048MB (no tiene sentido
 * bajar del default de V8) y un techo de 16384MB (16GB ya es más que
 * suficiente incluso para los modelos de bloques más grandes que maneja
 * la app hoy; subir esto más allá empieza a tener retornos decrecientes).
 */
function getSuggestedHeapMB() {
  const totalMB = os.totalmem() / (1024 * 1024);
  const suggested = Math.floor(totalMB * 0.6);
  return Math.max(2048, Math.min(suggested, 16384));
}

// Estos flags deben fijarse ANTES de app.whenReady().
app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${getSuggestedHeapMB()}`);
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0a0f18', // mismo tono que scene.js en tema oscuro — evita flash blanco al abrir
    autoHideMenuBar: true, // sin barra de menú File/Edit/View — no aporta nada en esta app
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // Descomentar para depurar con DevTools abiertas por defecto:
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    // Comportamiento estándar de macOS (reabrir ventana al hacer clic en el
    // dock); inofensivo dejarlo aunque el target principal sea Windows.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
