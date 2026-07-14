/**
 * GeoMet V1 — Módulo de Visualización 3D (Three.js)
 * Administra el canvas de WebGL, la cámara, luces, renderizado instanciado y culling.
 */

class GeometScene {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    
    // 1. Inicializar Core de Three.js
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f18); // Color HSL oscuro
    
    // Cámara Perspectiva por defecto
    this.camera = new THREE.PerspectiveCamera(45, this.width / this.height, 0.1, 50000);
    this.camera.position.set(100, 100, 150);
    // Los datos geomineros usan convención Z-up (X=Este, Y=Norte, Z=Elevación/RL).
    // Three.js asume Y-up por defecto, así que forzamos el eje vertical de la
    // cámara/OrbitControls a Z. Sin esto, los sondajes (que varían principalmente
    // en Z) se veían "acostados" hacia la profundidad de la escena en vez de
    // apuntar hacia abajo.
    this.camera.up.set(0, 0, 1);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antiAlias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Habilita el soporte de "local clipping planes" (por-material) de Three.js.
    // Se usa para recortar las superficies DXF a la vista de sección/planta
    // activa — ver updateDxfSectionClip(). Sin esto, asignar
    // material.clippingPlanes no tiene ningún efecto visual.
    this.renderer.localClippingEnabled = true;
    
    // Orbit Controls
    this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI; // Permitir rotación completa
    
    // Límites de distancia de orbit para evitar perder el modelo
    this.controls.minDistance = 1;
    this.controls.maxDistance = 200000;
    
    // 2. Luces
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);
    
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight1.position.set(1, 1, 1).normalize();
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-1, -1, -1).normalize();
    this.scene.add(dirLight2);
    
    // 3. Ayudas Visuales
    // Nota: la grilla azul genérica (THREE.GridHelper) se eliminó — la regla
    // de ejes verde con valores (ver _updateAxisRuler) cumple ahora ese rol
    // de referencia espacial, de forma más útil (con cotas/coordenadas).

    // Gizmo de ejes (X/Y/Z) en miniatura, fijo en una esquina del visor —
    // igual que en software CAD/BIM. Antes había un AxesHelper grande
    // ubicado en el centro de los datos (se recreaba en focusOnBounds()),
    // lo que lo hacía estorboso y de tamaño variable según el zoom. Ahora
    // vive en su propia mini-escena/cámara ortográfica y se renderiza en un
    // recorte (scissor) de tamaño fijo en píxeles sobre el canvas principal
    // (ver _renderAxisGizmo(), llamado desde animate()); solo copia la
    // ORIENTACIÓN de la cámara principal — nunca su posición ni el bounds
    // de los datos — así queda siempre del mismo tamaño diminuto sin
    // importar cuánto se haga zoom o dónde estén los datos.
    this.axisGizmoScene = new THREE.Scene();
    // Mismo tono oscuro que el fondo del visor principal: al tener
    // background propio, render() limpia color+profundidad de su recorte
    // automáticamente, así el gizmo no queda "manchado" con lo que haya
    // detrás en la escena principal.
    this.axisGizmoScene.background = new THREE.Color(0x0a0f18);
    this.axisGizmoCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
    this.axisGizmoCamera.position.set(0, 0, 3);
    this.axisGizmoHelper = new THREE.AxesHelper(1);
    this.axisGizmoScene.add(this.axisGizmoHelper);
    this.axisGizmoSizePx = 84;   // tamaño del recorte cuadrado, en píxeles CSS
    this.axisGizmoMarginPx = 14; // separación desde el borde del visor

    // Indicadores de dirección (N, E, Z)
    this._dataBounds = null; // Guarda los últimos bounds para reset

    // Regla de ejes con valores de referencia: grilla verde sutil + etiquetas
    // numéricas, visible solo en vistas ortogonales exactas (Planta/Perfil N/
    // Perfil E), para poder leer cotas Z y coordenadas X/Y al revisar
    // secciones y plantas. Ver _updateAxisRuler().
    //
    // Las líneas se dibujan como divs HTML/CSS superpuestos al canvas (igual
    // mecanismo que las etiquetas numéricas), no como geometría 3D de
    // Three.js: WebGL solo garantiza 1px de ancho real para líneas y ese
    // ancho puede volverse invisible según GPU/navegador/densidad de
    // píxeles, además de quedar sujeto a z-fighting/oclusión por profundidad
    // cuando el dataset cubre buena parte de la pantalla. Un overlay CSS es
    // 100% confiable independientemente de esos factores.
    this.axisRulerContainer = document.getElementById('axis-ruler-container');
    this._axisRulerLabels = [];   // etiquetas numéricas: {div, point, edge}
    this._axisRulerLines = [];    // líneas de la grilla: {div, point, edge}
    this._axisRulerCacheKey = null;
    this._axisRulerLoggedOnce = false;
    this._axisRulerDiagLogged = false;
    this._lastAxisRulerError = null;

    // Parámetros editables desde el panel "Grilla de Referencia" (Filtros & Secciones):
    // espaciado en metros (null = automático), transparencia y tamaño de los números.
    this.axisGridStepOverride = null;
    this.axisGridOpacity = 0.45;
    this.axisGridLabelSize = 0.68; // rem

    // 4. Objetos y Grupos de Datos
    this.blockMesh = null;       // InstancedMesh o Points de bloques
    this.drillholeMesh = null;   // InstancedMesh de cilindros
    this.sampleMesh = null;      // THREE.Points de muestras metalúrgicas
    this.dxfMeshes = {};         // layerName -> THREE.Mesh / Line

    this.drillholesGroup = new THREE.Group();
    this.dxfGroup = new THREE.Group();
    this.scene.add(this.drillholesGroup);
    this.scene.add(this.dxfGroup);

    // Datos cargados en memoria listos para render
    this.blockData = null;       // Datos directos desde el Worker
    this.drillholeData = null;   // { collars, traces, intervals } desde el Worker
    this.samplesData = null;     // { count, positions, attributes, ... } desde el Worker

    // Estado de coloreado y filtros
    this.activeAttribute = "";
    this.colorPaletteName = "rainbow";
    this.renderMode = "points";  // 'points' o 'cubes'
    this.blockSizeFactor = 1.0;
    this.blockOpacity = 1.0;
    this.drillholeThickness = 5.0;
    this.samplePointSize = 6.0;  // px (tamaño fijo en pantalla, no se atenúa con la distancia)
    // Estilo POR CAPA de las superficies DXF: cada capa (layerName -> {color,
    // opacity}) mantiene su propio color/opacidad en vez de compartir un único
    // valor global — así se pueden distinguir visualmente varias superficies
    // cargadas a la vez (ej. topografía vs. diseño de mina). Ver
    // addDxfLayer() (que inicializa la entrada la primera vez que aparece un
    // nombre de capa) y updateDxfLayerStyle() (que la edita en vivo).
    this.dxfLayerStyles = {};
    this.defaultDxfColor = 0x475569;   // Gris azulado mineral, color inicial de cualquier capa nueva
    this.defaultDxfOpacity = 0.7;
    this._dxfClipPlanes = [];    // clipping planes activos (ver updateDxfSectionClip)

    // Raycasting & Tooltips
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.tooltip = document.getElementById('three-tooltip');
    
    // Listener de tamaño de ventana
    window.addEventListener('resize', () => this.onWindowResize());
    
    // Evento de mousemove para Tooltip
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    
    // Iniciar bucle de animación
    this.clock = new THREE.Clock();
    this.fpsLastTime = 0;
    this.fpsFrames = 0;
    this.animate();
  }

  onWindowResize() {
    this.width = this.canvas.parentElement.clientWidth;
    this.height = this.canvas.parentElement.clientHeight;
    
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    
    this.renderer.setSize(this.width, this.height);
  }

  // Actualiza el widget de brújula HTML en tiempo real
  _updateCompass() {
    const needle = document.getElementById('compass-needle');
    const label = document.getElementById('compass-view-label');
    if (!needle) return;
    
    // Vector de la cámara al target. En los datos geomineros X=Este, Y=Norte,
    // Z=Elevación, por lo que el plano horizontal real es XY (no XZ).
    const camPos = this.camera.position;
    const tgt = this.controls.target;

    const dx = camPos.x - tgt.x;   // Componente Este-Oeste
    const dyN = camPos.y - tgt.y;  // Componente Norte-Sur
    const dz = camPos.z - tgt.z;   // Componente vertical (elevación)

    // El ángulo 0° = mirando al Norte (cámara al sur del target)
    const azimuth = Math.atan2(dx, dyN) * (180 / Math.PI); // grados

    // La aguja roja apunta a donde está el Norte real en la escena
    needle.style.transform = `translate(-50%, -50%) rotate(${azimuth}deg)`;

    // Actualizar label de vista.
    // Importante: el label tiene text-transform:uppercase en el CSS, y
    // element.innerText (a diferencia de textContent) devuelve el texto ya
    // transformado visualmente por el navegador — o sea que aunque aquí se
    // asigne 'Planta', volver a leer label.innerText después entrega
    // "PLANTA". Por eso _updateAxisRuler() guarda y usa this._viewMode (el
    // string original, sin pasar por el DOM) en vez de releer el label.
    if (label) {
      const horizDist = Math.sqrt(dx*dx + dyN*dyN);
      const elevation = Math.atan2(dz, horizDist) * (180 / Math.PI);

      let mode;
      if (elevation > 70) {
        mode = 'Planta';
      } else if (Math.abs(dyN) > Math.abs(dx) * 2 && dyN > 0) {
        mode = 'Perfil N';
      } else if (Math.abs(dyN) > Math.abs(dx) * 2 && dyN < 0) {
        mode = 'Perfil S';
      } else if (Math.abs(dx) > Math.abs(dyN) * 2 && dx > 0) {
        mode = 'Perfil E';
      } else if (Math.abs(dx) > Math.abs(dyN) * 2 && dx < 0) {
        mode = 'Perfil O';
      } else {
        mode = 'Vista 3D';
      }
      label.innerText = mode;
      this._viewMode = mode;
    }
  }

  // ==========================================
  // REGLA DE EJES CON VALORES (grilla de referencia)
  // ==========================================
  /**
   * Calcula un paso "redondo" (1, 2 ó 5 × potencia de 10) para las marcas de
   * la regla, apuntando a un número razonable de divisiones visibles.
   */
  _niceStep(range, targetTicks = 6) {
    if (!isFinite(range) || range <= 0) return 1;
    const roughStep = range / targetTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const norm = roughStep / mag;
    let niceNorm;
    if (norm < 1.5) niceNorm = 1;
    else if (norm < 3) niceNorm = 2;
    else if (norm < 7) niceNorm = 5;
    else niceNorm = 10;
    return niceNorm * mag;
  }

  /**
   * Genera la lista de valores de marca dentro de [min, max]. Usa el espaciado
   * manual definido en el panel "Grilla de Referencia" (axisGridStepOverride)
   * si está configurado; si no, calcula un paso "redondo" automático.
   */
  _computeTicks(min, max) {
    const range = max - min;
    const step = (this.axisGridStepOverride && this.axisGridStepOverride > 0)
      ? this.axisGridStepOverride
      : this._niceStep(range);
    const ticks = [];
    if (step <= 0) return ticks;
    const start = Math.ceil(min / step) * step;
    for (let v = start; v <= max + step * 1e-6; v += step) {
      ticks.push(Math.round(v * 1000) / 1000);
    }
    return ticks;
  }

  _formatTickValue(v) {
    return Math.round(v).toLocaleString();
  }

  /**
   * Determina si la vista actual es una vista ortogonal exacta y, de serlo,
   * (re)construye la grilla + etiquetas correspondientes. Se llama en cada
   * frame de animate(); internamente evita reconstruir geometría si nada
   * relevante cambió (solo reproyecta las etiquetas existentes).
   */
  _updateAxisRuler() {
    if (!this.axisRulerContainer) {
      if (!this._axisRulerDiagLogged && typeof app !== 'undefined' && app.logConsole) {
        app.logConsole('error', 'Grilla de referencia: no se encontró el contenedor #axis-ruler-container en el HTML.');
        this._axisRulerDiagLogged = true;
      }
      return;
    }

    // Usar el modo guardado por _updateCompass() (this._viewMode), NO releer
    // el label del DOM: el CSS de esa etiqueta tiene text-transform:uppercase
    // y label.innerText refleja el texto ya transformado ("PLANTA" en vez de
    // "Planta"), lo que rompía silenciosamente todas las comparaciones de abajo.
    const mode = this._viewMode || null;

    let axisConfig = null;
    if (mode === 'Planta') {
      axisConfig = { horizAxis: 'x', vertAxis: 'y' };
    } else if (mode === 'Perfil N' || mode === 'Perfil S') {
      axisConfig = { horizAxis: 'x', vertAxis: 'z' };
    } else if (mode === 'Perfil E' || mode === 'Perfil O') {
      axisConfig = { horizAxis: 'y', vertAxis: 'z' };
    }

    const bounds = this._dataBounds;
    if (!axisConfig || !bounds) {
      if (!this._axisRulerDiagLogged && bounds && typeof app !== 'undefined' && app.logConsole) {
        // Hay bounds pero el modo de vista no calzó con ninguna vista ortogonal
        // exacta esperada — útil para detectar un mismatch de texto (mayúsculas,
        // espacios, etc.) entre _updateCompass() y esta función.
        app.logConsole('info', `Grilla de referencia: vista actual "${mode}" no es una vista ortogonal exacta reconocida (se esperaba "Planta", "Perfil N/S" o "Perfil E/O").`);
        this._axisRulerDiagLogged = true;
      }
      if (this._axisRulerCacheKey !== null) this._clearAxisRuler();
      return;
    }

    // Eje "de profundidad" (el que no se muestra en la regla, perpendicular
    // a la pantalla).
    const depthAxis = (axisConfig.horizAxis !== 'x' && axisConfig.vertAxis !== 'x') ? 'x'
      : (axisConfig.horizAxis !== 'y' && axisConfig.vertAxis !== 'y') ? 'y' : 'z';

    // Ubicar el plano de la grilla en profundidad. Como la cámara es de
    // perspectiva (no ortográfica), un punto proyectado en pantalla se
    // desplaza distinto según su profundidad al mover/hacer zoom con la
    // cámara (paralaje). Si el plano de la grilla queda lejos de donde
    // realmente está la data visible, la grilla "se desliza" respecto al
    // modelo al desplazarse o hacer zoom en Planta/Perfil. Por eso se ubica
    // en la posición de corte activa (si hay una sección coincidente con
    // este eje) o, si no, en el punto medio de los datos — lo más cerca
    // posible de lo que realmente se está mirando, para minimizar ese
    // desfase visual en vez de forzarla a un extremo lejano fijo.
    const chkSection = document.getElementById('chk-section-active');
    const sectionActive = !!(chkSection && chkSection.checked);
    const sectionTypeEl = document.getElementById('select-section-type');
    const sectionType = sectionTypeEl ? sectionTypeEl.value : null;
    const sectionPosEl = document.getElementById('range-section-pos');
    const sectionCoord = sectionPosEl ? parseFloat(sectionPosEl.value) : NaN;

    const matchesSectionAxis = (depthAxis === 'z' && sectionType === 'horizontal') ||
      (depthAxis === 'x' && sectionType === 'vertical-n') ||
      (depthAxis === 'y' && sectionType === 'vertical-e');

    const depthMin = bounds['min' + depthAxis.toUpperCase()];
    const depthMax = bounds['max' + depthAxis.toUpperCase()];
    const depthCoord = (sectionActive && matchesSectionAxis && !isNaN(sectionCoord))
      ? sectionCoord
      : (depthMin + depthMax) / 2;

    // Incluir el espaciado manual en la cache key: si el usuario lo cambia
    // desde el panel, esto por sí solo fuerza la reconstrucción de la grilla.
    const cacheKey = `${mode}|${bounds.minX}|${bounds.maxX}|${bounds.minY}|${bounds.maxY}|${bounds.minZ}|${bounds.maxZ}|${depthCoord}|${this.axisGridStepOverride}`;
    if (this._axisRulerCacheKey !== cacheKey) {
      this._rebuildAxisRuler(axisConfig, depthAxis, bounds, depthCoord);
      this._axisRulerCacheKey = cacheKey;
    }

    // Transparencia y tamaño de números se aplican en vivo, sin necesidad de
    // reconstruir las líneas/etiquetas.
    this._axisRulerLines.forEach(item => { item.div.style.opacity = this.axisGridOpacity; });
    if (this.axisRulerContainer) {
      this.axisRulerContainer.style.setProperty('--axis-ruler-font-size', `${this.axisGridLabelSize}rem`);
    }

    this._projectAxisRulerLabels();
    this._projectAxisRulerLines();
  }

  /**
   * Reconstruye los divs de líneas de la grilla y de etiquetas numéricas
   * para la combinación actual de ejes / bounds / coordenada de profundidad.
   */
  _rebuildAxisRuler(axisConfig, depthAxis, bounds, depthCoord) {
    this._clearAxisRuler();

    const { horizAxis, vertAxis } = axisConfig;
    const minOf = (axis) => bounds['min' + axis.toUpperCase()];
    const maxOf = (axis) => bounds['max' + axis.toUpperCase()];

    const horizMin0 = minOf(horizAxis), horizMax0 = maxOf(horizAxis);
    const vertMin0 = minOf(vertAxis), vertMax0 = maxOf(vertAxis);

    // Extender la grilla más allá de los límites reales de los datos para que
    // luzca como un fondo completo del visor (no recortado justo en el borde
    // del modelo), similar a una lámina/telón cuadriculado detrás de todo.
    const horizPad = Math.max(horizMax0 - horizMin0, 1) * 0.3;
    const vertPad = Math.max(vertMax0 - vertMin0, 1) * 0.3;
    const horizMin = horizMin0 - horizPad, horizMax = horizMax0 + horizPad;
    const vertMin = vertMin0 - vertPad, vertMax = vertMax0 + vertPad;

    const horizTicks = this._computeTicks(horizMin, horizMax);
    const vertTicks = this._computeTicks(vertMin, vertMax);

    const toXYZ = (vals) => [
      vals.x !== undefined ? vals.x : 0,
      vals.y !== undefined ? vals.y : 0,
      vals.z !== undefined ? vals.z : 0
    ];

    // Determinar, según la orientación real de la cámara en este momento,
    // qué extremo de cada eje cae visualmente a la izquierda / abajo en
    // pantalla, para anclar ahí las etiquetas correspondientes.
    const project2D = (vals) => {
      const p = new THREE.Vector3(...toXYZ(vals));
      p.project(this.camera);
      return p;
    };
    const midHoriz = (horizMin + horizMax) / 2;
    const midVert = (vertMin + vertMax) / 2;
    const pHorizMin = project2D({ [horizAxis]: horizMin, [vertAxis]: midVert, [depthAxis]: depthCoord });
    const pHorizMax = project2D({ [horizAxis]: horizMax, [vertAxis]: midVert, [depthAxis]: depthCoord });
    const leftHorizValue = pHorizMin.x <= pHorizMax.x ? horizMin : horizMax;

    const pVertMin = project2D({ [vertAxis]: vertMin, [horizAxis]: midHoriz, [depthAxis]: depthCoord });
    const pVertMax = project2D({ [vertAxis]: vertMax, [horizAxis]: midHoriz, [depthAxis]: depthCoord });
    const bottomVertValue = pVertMin.y <= pVertMax.y ? vertMin : vertMax;

    // Construir las líneas de la grilla como divs HTML/CSS (ver nota en el
    // constructor sobre por qué no se usa geometría WebGL para esto). Cada
    // línea guarda sus dos extremos en coordenadas de mundo; en cada frame
    // (_projectAxisRulerLines) se proyectan ambos puntos a pantalla y se
    // dibuja un div de 1px rotado/escalado para unirlos — así funciona
    // correctamente incluso si la cámara no queda perfectamente alineada.
    horizTicks.forEach(v => {
      const div = document.createElement('div');
      div.className = 'axis-ruler-grid-line';
      div.style.opacity = this.axisGridOpacity;
      this.axisRulerContainer.appendChild(div);
      const pointA = new THREE.Vector3(...toXYZ({ [horizAxis]: v, [vertAxis]: vertMin, [depthAxis]: depthCoord }));
      const pointB = new THREE.Vector3(...toXYZ({ [horizAxis]: v, [vertAxis]: vertMax, [depthAxis]: depthCoord }));
      this._axisRulerLines.push({ div, pointA, pointB });
    });
    vertTicks.forEach(v => {
      const div = document.createElement('div');
      div.className = 'axis-ruler-grid-line';
      div.style.opacity = this.axisGridOpacity;
      this.axisRulerContainer.appendChild(div);
      const pointA = new THREE.Vector3(...toXYZ({ [vertAxis]: v, [horizAxis]: horizMin, [depthAxis]: depthCoord }));
      const pointB = new THREE.Vector3(...toXYZ({ [vertAxis]: v, [horizAxis]: horizMax, [depthAxis]: depthCoord }));
      this._axisRulerLines.push({ div, pointA, pointB });
    });

    if (!this._axisRulerLoggedOnce && typeof app !== 'undefined' && app.logConsole) {
      app.logConsole('info', `Grilla de referencia construida (${axisConfig.horizAxis.toUpperCase()}/${axisConfig.vertAxis.toUpperCase()}): ${horizTicks.length + vertTicks.length} líneas.`);
      this._axisRulerLoggedOnce = true;
    }

    // Construir etiquetas HTML: ticks horizontales -> margen inferior,
    // ticks verticales -> margen izquierdo.
    horizTicks.forEach(v => {
      const div = document.createElement('div');
      div.className = 'axis-ruler-label axis-ruler-label-bottom';
      div.innerText = this._formatTickValue(v);
      this.axisRulerContainer.appendChild(div);
      const point = new THREE.Vector3(...toXYZ({ [horizAxis]: v, [vertAxis]: bottomVertValue, [depthAxis]: depthCoord }));
      this._axisRulerLabels.push({ div, point, edge: 'bottom' });
    });
    vertTicks.forEach(v => {
      const div = document.createElement('div');
      div.className = 'axis-ruler-label axis-ruler-label-left';
      div.innerText = this._formatTickValue(v);
      this.axisRulerContainer.appendChild(div);
      const point = new THREE.Vector3(...toXYZ({ [vertAxis]: v, [horizAxis]: leftHorizValue, [depthAxis]: depthCoord }));
      this._axisRulerLabels.push({ div, point, edge: 'left' });
    });
  }

  /**
   * Reproyecta cada etiqueta existente a coordenadas de pantalla (se llama
   * en cada frame, ya que el usuario puede seguir haciendo zoom/pan).
   */
  _projectAxisRulerLabels() {
    if (!this._axisRulerLabels.length) return;
    const rect = this.renderer.domElement.getBoundingClientRect();

    this._axisRulerLabels.forEach(item => {
      const p = item.point.clone().project(this.camera);

      // Detrás de la cámara: ocultar
      if (p.z > 1) {
        item.div.style.display = 'none';
        return;
      }

      if (item.edge === 'bottom') {
        const screenX = (p.x * 0.5 + 0.5) * rect.width;
        if (screenX < -60 || screenX > rect.width + 60) {
          item.div.style.display = 'none';
          return;
        }
        item.div.style.display = '';
        item.div.style.left = `${screenX}px`;
      } else {
        const screenY = (1 - (p.y * 0.5 + 0.5)) * rect.height;
        if (screenY < -20 || screenY > rect.height + 20) {
          item.div.style.display = 'none';
          return;
        }
        item.div.style.display = '';
        item.div.style.top = `${screenY}px`;
      }
    });
  }

  /**
   * Reproyecta cada línea de la grilla (divs HTML) a coordenadas de pantalla.
   * Cada línea se dibuja uniendo sus dos extremos proyectados con un div de
   * 1px rotado y escalado — funciona para cualquier orientación de cámara,
   * no solo para líneas perfectamente horizontales/verticales.
   */
  _projectAxisRulerLines() {
    if (!this._axisRulerLines.length) return;
    const rect = this.renderer.domElement.getBoundingClientRect();

    this._axisRulerLines.forEach(item => {
      const pa = item.pointA.clone().project(this.camera);
      const pb = item.pointB.clone().project(this.camera);

      // Si cualquiera de los extremos queda detrás de la cámara, ocultar
      // (evita segmentos deformados por la proyección).
      if (pa.z > 1 || pb.z > 1) {
        item.div.style.display = 'none';
        return;
      }

      const ax = (pa.x * 0.5 + 0.5) * rect.width;
      const ay = (1 - (pa.y * 0.5 + 0.5)) * rect.height;
      const bx = (pb.x * 0.5 + 0.5) * rect.width;
      const by = (1 - (pb.y * 0.5 + 0.5)) * rect.height;

      const dx = bx - ax;
      const dy = by - ay;
      const length = Math.sqrt(dx * dx + dy * dy);

      if (!isFinite(length) || length < 0.5) {
        item.div.style.display = 'none';
        return;
      }

      const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

      item.div.style.display = '';
      item.div.style.left = `${ax}px`;
      item.div.style.top = `${ay}px`;
      item.div.style.width = `${length}px`;
      item.div.style.transform = `rotate(${angleDeg}deg)`;
    });
  }

  /**
   * Elimina las líneas y etiquetas HTML de la regla de ejes.
   */
  _clearAxisRuler() {
    if (this.axisRulerContainer) this.axisRulerContainer.innerHTML = '';
    this._axisRulerLabels = [];
    this._axisRulerLines = [];
    this._axisRulerCacheKey = null;
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    
    // Actualizar controles con damping
    this.controls.update();

    // Actualizar brújula — proyectar la dirección horizontal de la cámara
    this._updateCompass();

    // Actualizar regla de ejes (grilla verde + valores) si la vista actual
    // es una vista ortogonal exacta (Planta / Perfil N / Perfil E).
    // Envuelto en try/catch: si algo falla aquí, antes se perdía en
    // silencio (la grilla simplemente no aparecía, sin ninguna pista visible
    // en la consola de la app). Ahora el error se reporta en la Consola de
    // Importación (solo una vez por mensaje distinto, para no inundarla
    // ejecutándose 60 veces por segundo).
    try {
      this._updateAxisRuler();
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (this._lastAxisRulerError !== msg) {
        this._lastAxisRulerError = msg;
        if (typeof app !== 'undefined' && app.logConsole) {
          app.logConsole('error', `Grilla de referencia: error interno — ${msg}`);
        }
        console.error('Error en _updateAxisRuler:', err);
      }
    }

    // Render
    this.renderer.render(this.scene, this.camera);

    // Gizmo de ejes X/Y/Z en miniatura, en la esquina del visor (ver
    // constructor para el porqué de este diseño en vez del AxesHelper
    // grande que antes se dibujaba centrado en los datos).
    try {
      this._renderAxisGizmo();
    } catch (err) {
      console.error('Error en _renderAxisGizmo:', err);
    }

    // Medir FPS
    this.fpsFrames++;
    const time = performance.now();
    if (time >= this.fpsLastTime + 1000) {
      const fps = Math.round((this.fpsFrames * 1000) / (time - this.fpsLastTime));
      document.getElementById('fps-val').innerText = fps;
      this.fpsFrames = 0;
      this.fpsLastTime = time;
    }
  }

  // ==========================================
  // CONFIGURACIÓN DE VISTAS CÁMARA
  // ==========================================
  // Guarda y obtiene los bounds unificados de bloques + sondajes cargados
  setDataBounds(bounds) {
    this._dataBounds = bounds;
  }

  getDataBounds() {
    return this._dataBounds;
  }

  resetCamera() {
    if (this._dataBounds) {
      this.focusOnBounds(this._dataBounds);
    } else {
      this.camera.position.set(150, 150, 200);
      this.camera.up.set(0, 0, 1);
      this.controls.target.set(0, 0, 0);
      this.camera.lookAt(0, 0, 0);
    }
  }

  setView(viewType) {
    const b = this._dataBounds;
    let target = new THREE.Vector3(0, 0, 0);
    let dist = 500;

    if (b) {
      // Centro del bounding box de todos los datos
      target.set((b.minX + b.maxX)/2, (b.minY + b.maxY)/2, (b.minZ + b.maxZ)/2);
      const dx = b.maxX - b.minX;
      const dy = b.maxY - b.minY;
      const dz = b.maxZ - b.minZ;
      dist = Math.max(dx, dy, dz) * 1.5;
    }

    // Calcular la posición de la cámara manteniendo el target correcto.
    // Convención de datos: X=Este, Y=Norte, Z=Elevación (eje vertical real).
    // 'top'   = mirando hacia abajo (vista en planta)  → cámara sobre el centro (arriba en Z)
    // 'front' = mirando hacia el Norte (perfil EW)     → cámara al sur del centro
    // 'side'  = mirando hacia el Este (perfil NS)      → cámara al oeste del centro
    if (viewType === 'top') {
      this.camera.position.set(target.x, target.y, target.z + dist);
      this.camera.up.set(0, 1, 0);
    } else if (viewType === 'front') {
      this.camera.position.set(target.x, target.y - dist, target.z);
      this.camera.up.set(0, 0, 1);
    } else if (viewType === 'side') {
      this.camera.position.set(target.x - dist, target.y, target.z);
      this.camera.up.set(0, 0, 1);
    }

    this.controls.target.copy(target);
    this.camera.lookAt(target);
    this.controls.update();
  }

  focusOnBounds(bounds) {
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    
    const dx = bounds.maxX - bounds.minX;
    const dy = bounds.maxY - bounds.minY;
    const dz = bounds.maxZ - bounds.minZ;
    const maxDim = Math.max(dx, dy, dz, 100); // mínimo 100m de tamaño
    
    // Posicionar la cámara en perspectiva isométrica desde el noreste.
    // Z es la elevación real de los datos, así que el desplazamiento "hacia
    // arriba" de la vista isométrica debe aplicarse sobre Z, no sobre Y.
    this.camera.position.set(
      cx + maxDim * 0.8,
      cy + maxDim * 0.8,
      cz + maxDim * 0.6
    );
    this.controls.target.set(cx, cy, cz);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(cx, cy, cz);
    this.controls.update();
    
    // Ajustar near/far para coordenadas reales de proyectos mineros
    // (ej. coordenadas UTM de 300000+)
    this.camera.near = maxDim * 0.001;
    this.camera.far = maxDim * 50;
    this.camera.updateProjectionMatrix();

    // Nota: los ejes X/Y/Z ya no se dibujan en la escena de datos (antes se
    // recreaban aquí, centrados en cx/cy/cz con tamaño proporcional a
    // maxDim). Ahora viven en el gizmo fijo de la esquina — ver
    // this.axisGizmoScene/_renderAxisGizmo() — que no depende del bounds
    // enfocado ni del zoom.
  }

  /**
   * Dibuja el gizmo de ejes X/Y/Z en miniatura, en un recorte (scissor) de
   * tamaño fijo en píxeles sobre la esquina inferior izquierda del canvas
   * principal. Se llama en cada frame desde animate(), después del render
   * de la escena de datos. Solo copia la ORIENTACIÓN de la cámara principal
   * (no su posición ni distancia real), para que el gizmo indique siempre
   * hacia dónde mira la vista actual sin cambiar nunca de tamaño ni
   * depender de dónde estén los datos o cuánto zoom haya.
   */
  _renderAxisGizmo() {
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(1, 1, 1);
    dir.normalize().multiplyScalar(3);
    this.axisGizmoCamera.position.copy(dir);
    this.axisGizmoCamera.up.copy(this.camera.up);
    this.axisGizmoCamera.lookAt(0, 0, 0);

    const size = this.axisGizmoSizePx;
    const margin = this.axisGizmoMarginPx;

    // Esquina inferior izquierda del visor (WebGL mide el viewport desde
    // abajo hacia arriba) — queda libre de la brújula (arriba) y de las
    // leyendas arrastrables (por defecto ancladas abajo a la derecha).
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(margin, margin, size, size);
    this.renderer.setViewport(margin, margin, size, size);
    this.renderer.render(this.axisGizmoScene, this.axisGizmoCamera);

    // Restablecer viewport/scissor completos: si no, el próximo frame de la
    // escena principal quedaría recortado a este cuadrito.
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.width, this.height);
  }

  // ==========================================
  // PALETAS DE COLOR DE LEYES Y CATEGORÍAS
  // ==========================================
  getColorForValue(val, min, max, paletteName) {
    if (val === null || val === undefined || isNaN(val) || val === -999.0) {
      return new THREE.Color(0x4b5563); // Gris para nulos
    }
    
    let t = (val - min) / (max - min);
    if (isNaN(t)) t = 0.5;
    t = Math.max(0, Math.min(1, t)); // clamp
    
    // Diferentes esquemas de color
    if (paletteName === 'viridis') {
      // Viridis: purpura -> verde -> amarillo
      const r = 0.2678 + 0.6278 * t - 0.8956 * t*t;
      const g = 0.0049 + 1.4883 * t - 0.4932 * t*t;
      const b = 0.3294 + 0.5606 * t + 0.11 * t*t;
      return new THREE.Color(r, g, b);
    } else if (paletteName === 'magma') {
      // Magma: negro -> violeta -> naranja -> amarillo
      const r = Math.pow(t, 2) * 0.95 + 0.05;
      const g = Math.pow(t, 2.5) * 0.8 + 0.02;
      const b = 0.1 + t * 0.9 - t*t * 0.5;
      return new THREE.Color(r, g, b);
    } else if (paletteName === 'coolwarm') {
      // Coolwarm: Azul -> Blanco -> Rojo
      if (t < 0.5) {
        const u = t * 2;
        return new THREE.Color(u, u, 1);
      } else {
        const u = (1 - t) * 2;
        return new THREE.Color(1, u, u);
      }
    } else {
      // Rainbow por defecto (Azul -> Verde -> Amarillo -> Rojo)
      const h = (1.0 - t) * 240; // 240 es azul, 0 es rojo
      return new THREE.Color(`hsl(${h}, 90%, 50%)`);
    }
  }

  getDiscreteColor(classId) {
    const colors = [
      0x06b6d4, // cian
      0xf59e0b, // ambar
      0xec4899, // rosa
      0x10b981, // verde esmeralda
      0x8b5cf6, // violeta
      0x3b82f6, // azul
      0xef4444, // rojo
      0x14b8a6, // verde azulado
      0xf97316, // naranja
      0x6366f1  // indigo
    ];
    return new THREE.Color(colors[classId % colors.length]);
  }

  // ==========================================
  // RENDER DE MODELO DE BLOQUES
  // ==========================================
  updateBlockRender(blockData, activeAttribute, paletteName, renderMode, sizeFactor, customMin = null, customMax = null, opacity = 1.0) {
    this.blockData = blockData;
    this.activeAttribute = activeAttribute;
    this.colorPaletteName = paletteName;
    this.renderMode = renderMode;
    this.blockSizeFactor = sizeFactor;
    this.blockOpacity = opacity;

    // Limpiar anterior
    if (this.blockMesh) {
      this.scene.remove(this.blockMesh);
      if (this.blockMesh.geometry) this.blockMesh.geometry.dispose();
      if (Array.isArray(this.blockMesh.material)) {
        this.blockMesh.material.forEach(m => m.dispose());
      } else if (this.blockMesh.material) {
        this.blockMesh.material.dispose();
      }
      this.blockMesh = null;
    }
    
    if (!blockData || blockData.count === 0) return;
    
    // Obtener bloques filtrados (si hay filtros activos)
    const indicesToRender = this.getFilteredBlockIndices();
    const activeCount = indicesToRender.length;
    
    if (activeCount === 0) {
      this.updateLegend('blocks', null);
      return;
    }
    
    // Validar el modo de renderizado seguro por volumen
    let mode = renderMode;
    if (mode === 'cubes' && activeCount > 500000) {
      console.warn("Demasiados bloques visibles para cajas sólidas. Cambiando temporalmente a modo Puntos.");
      app.ui.logConsole('warn', `Sistemas: El modo Cajas Sólidas se desactivó para evitar latencia (bloques visibles: ${activeCount.toLocaleString()}). Visualizando como Puntos.`);
      mode = 'points';
    }
    
    // Obtener metadatos del atributo activo
    const attrMeta = blockData.attributeMetadata.find(a => a.name === activeAttribute);
    let isCategorical = false;
    let minVal = 0, maxVal = 1;
    let lookupTable = [];
    
    if (attrMeta) {
      isCategorical = attrMeta.type === 'category';
      if (isCategorical) {
        lookupTable = blockData.categoryLookups[activeAttribute] || [];
      } else {
        // Mínimo
        if (customMin !== null && !isNaN(customMin)) {
          minVal = customMin;
        } else {
          const buf = blockData.attributes[activeAttribute];
          let min = Infinity;
          for (let i = 0; i < buf.length; i++) {
            const val = buf[i];
            if (val !== -999.0 && val < min) min = val;
          }
          minVal = min === Infinity ? 0 : min;
        }
        // Máximo
        if (customMax !== null && !isNaN(customMax)) {
          maxVal = customMax;
        } else {
          const buf = blockData.attributes[activeAttribute];
          let max = -Infinity;
          for (let i = 0; i < buf.length; i++) {
            const val = buf[i];
            if (val !== -999.0 && val > max) max = val;
          }
          maxVal = max === -Infinity ? 1 : max;
        }
      }
    }
    
    // Actualizar leyenda
    this.updateLegend('blocks', attrMeta, minVal, maxVal, lookupTable, paletteName);

    const positions = blockData.positions;
    const sizes = blockData.sizes;
    const attrBuffer = activeAttribute ? blockData.attributes[activeAttribute] : null;
    
    if (mode === 'points') {
      // 1. RENDER COMO NUBE DE PUNTOS (THREE.Points)
      const geom = new THREE.BufferGeometry();
      
      const pointPositions = new Float32Array(activeCount * 3);
      const pointColors = new Float32Array(activeCount * 3);
      
      for (let i = 0; i < activeCount; i++) {
        const idx = indicesToRender[i];
        const idx3 = idx * 3;
        
        pointPositions[i * 3] = positions[idx3];
        pointPositions[i * 3 + 1] = positions[idx3 + 1];
        pointPositions[i * 3 + 2] = positions[idx3 + 2];
        
        // Color
        let col = new THREE.Color(0x3b82f6); // color base azul
        if (attrBuffer) {
          const val = attrBuffer[idx];
          if (isCategorical) {
            col = this.getDiscreteColor(val);
          } else {
            col = this.getColorForValue(val, minVal, maxVal, paletteName);
          }
        }
        
        pointColors[i * 3] = col.r;
        pointColors[i * 3 + 1] = col.g;
        pointColors[i * 3 + 2] = col.b;
      }
      
      geom.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
      geom.setAttribute('color', new THREE.BufferAttribute(pointColors, 3));
      
      // Tamaño del punto según el promedio del tamaño de los bloques
      const avgSize = (sizes[0] || 10) * sizeFactor;
      const pointMat = new THREE.PointsMaterial({
        size: avgSize,
        vertexColors: true,
        sizeAttenuation: true, // Se reduce el tamaño con la distancia
        transparent: opacity < 1,
        opacity: opacity
      });
      
      this.blockMesh = new THREE.Points(geom, pointMat);
      this.scene.add(this.blockMesh);
      
    } else {
      // 2. RENDER COMO CUBOS SÓLIDOS INSTANCIADOS (THREE.InstancedMesh)
      // Usar geometría de caja base de 1x1x1
      const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
      const boxMaterial = new THREE.MeshLambertMaterial({
        roughness: 0.4,
        metalness: 0.1,
        transparent: opacity < 1,
        opacity: opacity
      });
      
      this.blockMesh = new THREE.InstancedMesh(boxGeometry, boxMaterial, activeCount);
      
      const dummy = new THREE.Object3D();
      const col = new THREE.Color();
      
      for (let i = 0; i < activeCount; i++) {
        const idx = indicesToRender[i];
        const idx3 = idx * 3;
        
        // Configurar matriz de transformación
        dummy.position.set(positions[idx3], positions[idx3 + 1], positions[idx3 + 2]);
        dummy.scale.set(
          sizes[idx3] * sizeFactor,
          sizes[idx3 + 1] * sizeFactor,
          sizes[idx3 + 2] * sizeFactor
        );
        dummy.updateMatrix();
        this.blockMesh.setMatrixAt(i, dummy.matrix);
        
        // Colorear
        let c = new THREE.Color(0x1e3a8a);
        if (attrBuffer) {
          const val = attrBuffer[idx];
          if (isCategorical) {
            c = this.getDiscreteColor(val);
          } else {
            c = this.getColorForValue(val, minVal, maxVal, paletteName);
          }
        }
        this.blockMesh.setColorAt(i, c);
      }
      
      this.blockMesh.instanceMatrix.needsUpdate = true;
      if (this.blockMesh.instanceColor) {
        this.blockMesh.instanceColor.needsUpdate = true;
      }
      
      // Guardar mapeo de los índices instanciados a los índices reales del bloque
      // Útil para el Raycasting
      this.blockMesh.userData = {
        realIndices: indicesToRender
      };
      
      this.scene.add(this.blockMesh);
    }
  }

  /**
   * Ejecuta filtros en base a los criterios activos y el octree
   */
  getFilteredBlockIndices() {
    if (!this.blockData) return [];
    
    // Si hay una sección de corte activa, usamos el índice espacial
    const sectionActive = document.getElementById('chk-section-active').checked;
    let blockIndices = [];
    
    if (sectionActive && app.spatialIndex) {
      const type = document.getElementById('select-section-type').value;
      const coord = parseFloat(document.getElementById('range-section-pos').value);
      const thickness = parseFloat(document.getElementById('range-section-thickness-blocks').value);

      // El índice espacial (grilla uniforme) solo hace un filtro grueso por
      // celda: si el tamaño de celda en ese eje es mayor que el espesor
      // solicitado (ej. celdas de ~32 m con un espesor pedido de ±1 m), devuelve
      // TODOS los bloques de esa celda, no solo los que caen realmente dentro
      // de la ventana. Por eso se agrega un filtro exacto por la posición real
      // del centroide, igual que ya se hace para los intervalos de sondaje.
      const queryResult = app.spatialIndex.querySection(type, coord, thickness);
      const candidateIndices = queryResult.blockIndices;

      const minVal = coord - thickness;
      const maxVal = coord + thickness;
      const positions = this.blockData.positions;
      blockIndices = candidateIndices.filter(idx => {
        const idx3 = idx * 3;
        let coordVal;
        if (type === 'vertical-n') {
          coordVal = positions[idx3];       // Eje X
        } else if (type === 'vertical-e') {
          coordVal = positions[idx3 + 1];   // Eje Y
        } else {
          coordVal = positions[idx3 + 2];   // Eje Z (Planta)
        }
        return coordVal >= minVal && coordVal <= maxVal;
      });
    } else {
      // Si no hay corte espacial, partimos con todos los bloques
      blockIndices = new Array(this.blockData.count);
      for (let i = 0; i < this.blockData.count; i++) {
        blockIndices[i] = i;
      }
    }
    
    // Aplicar filtros por atributos adicionales
    const activeFilters = app.filters || [];
    if (activeFilters.length === 0) {
      return blockIndices;
    }
    
    // Filtrado lógico lineal en base a la lista espacial reducida
    const filtered = [];
    const attrData = this.blockData.attributes;
    
    for (let i = 0; i < blockIndices.length; i++) {
      const idx = blockIndices[i];
      let passes = true;
      
      for (const filter of activeFilters) {
        const val = attrData[filter.attribute][idx];
        if (filter.type === 'number') {
          if (val === -999.0 || val < filter.min || val > filter.max) {
            passes = false;
            break;
          }
        } else if (filter.type === 'category') {
          if (!filter.values.includes(val)) {
            passes = false;
            break;
          }
        }
      }
      
      if (passes) {
        filtered.push(idx);
      }
    }
    
    return filtered;
  }

  // ==========================================
  // RENDER DE SONDAJES
  // ==========================================
  updateDrillholeRender(drillholeData, activeAttribute, paletteName, thickness, customMin = null, customMax = null) {
    this.drillholeData = drillholeData;
    this.drillholeThickness = thickness;
    
    // Limpiar anterior
    while (this.drillholesGroup.children.length > 0) {
      const child = this.drillholesGroup.children[0];
      this.drillholesGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    
    if (!drillholeData || !drillholeData.intervals || drillholeData.intervals.length === 0) {
      this.updateLegend('drillholes', null);
      return;
    }

    // Filtrar intervalos según corte espacial (sección)
    const sectionActive = document.getElementById('chk-section-active').checked;
    let intervalsToRender = drillholeData.intervals;
    
    if (sectionActive) {
      const type = document.getElementById('select-section-type').value;
      const coord = parseFloat(document.getElementById('range-section-pos').value);
      const thicknessVal = parseFloat(document.getElementById('range-section-thickness-drillholes').value);

      const minVal = coord - thicknessVal;
      const maxVal = coord + thicknessVal;
      
      intervalsToRender = drillholeData.intervals.filter(interval => {
        // Un intervalo pasa si su centroide aproximado cae en el plano
        const midZ = (interval.startPos[2] + interval.endPos[2]) / 2;
        const midY = (interval.startPos[1] + interval.endPos[1]) / 2;
        const midX = (interval.startPos[0] + interval.endPos[0]) / 2;
        
        if (type === 'vertical-n') {
          return midX >= minVal && midX <= maxVal;
        } else if (type === 'vertical-e') {
          return midY >= minVal && midY <= maxVal;
        } else {
          return midZ >= minVal && midZ <= maxVal;
        }
      });
    }

    // Aplicar filtros por atributo de ensayo (AND entre todos los filtros activos de Sondajes)
    const activeDhFilters = app.dhFilters || [];
    if (activeDhFilters.length > 0) {
      intervalsToRender = intervalsToRender.filter(interval => {
        for (const filter of activeDhFilters) {
          const val = interval.values ? interval.values[filter.attribute] : undefined;
          if (filter.type === 'number') {
            if (val === undefined || val === null || isNaN(val) || val < filter.min || val > filter.max) {
              return false;
            }
          } else if (filter.type === 'category') {
            if (val === undefined || val === null || !filter.values.includes(val)) {
              return false;
            }
          }
        }
        return true;
      });
    }

    if (intervalsToRender.length === 0) {
      this.updateLegend('drillholes', null);
      return;
    }

    // Buscar límites de coloreado
    let minVal = 0, maxVal = 1;
    let isCategorical = false;
    let lookupTable = [];
    
    // Determinar tipo del atributo usando la metadata del worker
    let hasAttribute = false;
    
    if (activeAttribute) {
      // Buscar en la metadata de assays
      const meta = drillholeData.assayMetadata
        ? drillholeData.assayMetadata.find(m => m.name === activeAttribute)
        : null;
      
      if (meta) {
        hasAttribute = true;
        isCategorical = (meta.type === 'category');
      } else {
        // Fallback: auto-detectar por tipo de valor en el primer intervalo
        for (const interval of intervalsToRender) {
          if (interval.values && interval.values[activeAttribute] !== undefined) {
            const val = interval.values[activeAttribute];
            hasAttribute = true;
            isCategorical = (typeof val === 'string');
            break;
          }
        }
      }
      
      if (hasAttribute) {
        if (isCategorical) {
          // Usar lookup del worker si existe, o construir uno local
          if (drillholeData.assayCategoryLookups && drillholeData.assayCategoryLookups[activeAttribute]) {
            lookupTable = drillholeData.assayCategoryLookups[activeAttribute];
          } else {
            const categories = new Set();
            for (const interval of intervalsToRender) {
              const val = interval.values ? interval.values[activeAttribute] : undefined;
              if (val !== undefined && val !== '') categories.add(val);
            }
            lookupTable = Array.from(categories);
          }
        } else {
          // Mínimo
          if (customMin !== null && !isNaN(customMin)) {
            minVal = customMin;
          } else {
            let min = Infinity;
            for (const interval of intervalsToRender) {
              const val = interval.values ? interval.values[activeAttribute] : undefined;
              if (val !== undefined && val !== null && !isNaN(val)) {
                if (val < min) min = val;
              }
            }
            minVal = min === Infinity ? 0 : min;
          }
          // Máximo
          if (customMax !== null && !isNaN(customMax)) {
            maxVal = customMax;
          } else {
            let max = -Infinity;
            for (const interval of intervalsToRender) {
              const val = interval.values ? interval.values[activeAttribute] : undefined;
              if (val !== undefined && val !== null && !isNaN(val)) {
                if (val > max) max = val;
              }
            }
            maxVal = max === -Infinity ? 1 : max;
          }
        }
      }
    }

    // Dibujar cada intervalo como un cilindro instanciado
    // Geometría base: Cilindro apuntando en el eje Y
    const cylGeom = new THREE.CylinderGeometry(0.5, 0.5, 1.0, 6);
    const cylMat = new THREE.MeshLambertMaterial({
      roughness: 0.3
    });
    
    const instCylinderMesh = new THREE.InstancedMesh(cylGeom, cylMat, intervalsToRender.length);
    const dummy = new THREE.Object3D();
    const upVector = new THREE.Vector3(0, 1, 0);
    
    for (let i = 0; i < intervalsToRender.length; i++) {
      const interval = intervalsToRender[i];
      const p1 = new THREE.Vector3(...interval.startPos);
      const p2 = new THREE.Vector3(...interval.endPos);
      
      // Vector dirección
      const dir = new THREE.Vector3().subVectors(p2, p1);
      const len = dir.length();
      
      if (len <= 0) continue;
      
      const midPoint = new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5);
      dir.normalize();
      
      // Rotar cilindro de (0,1,0) a dir
      const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, dir);
      
      // Configurar dummy
      dummy.position.copy(midPoint);
      dummy.quaternion.copy(quaternion);
      // Espesor visual del cilindro
      dummy.scale.set(thickness * 0.25, len, thickness * 0.25);
      dummy.updateMatrix();
      
      instCylinderMesh.setMatrixAt(i, dummy.matrix);
      
      // Colorear
      let c = new THREE.Color(0xd1d5db); // gris por defecto
      if (hasAttribute && interval.values) {
        const val = interval.values[activeAttribute];
        if (val !== undefined && val !== null) {
          if (isCategorical) {
            const catId = lookupTable.indexOf(val);
            c = this.getDiscreteColor(catId);
          } else {
            c = this.getColorForValue(val, minVal, maxVal, paletteName);
          }
        }
      }
      instCylinderMesh.setColorAt(i, c);
    }
    
    instCylinderMesh.instanceMatrix.needsUpdate = true;
    if (instCylinderMesh.instanceColor) {
      instCylinderMesh.instanceColor.needsUpdate = true;
    }
    
    instCylinderMesh.userData = {
      intervals: intervalsToRender,
      activeAttribute,
      isCategorical
    };
    
    this.drillholesGroup.add(instCylinderMesh);
    
    // Actualizar leyenda
    if (hasAttribute) {
      const attrMeta = { name: activeAttribute, type: isCategorical ? 'category' : 'number' };
      this.updateLegend('drillholes', attrMeta, minVal, maxVal, lookupTable, paletteName);
    } else {
      this.updateLegend('drillholes', null);
    }
  }

  // ==========================================
  // RENDER DE MUESTRAS METALÚRGICAS
  // ==========================================
  /**
   * Renderiza las muestras metalúrgicas como una nube de puntos pequeños
   * (mismo enfoque liviano que el modo "Puntos" del modelo de bloques), con
   * tamaño fijo en píxeles (sizeAttenuation:false) para que sigan siendo
   * visibles como marcadores discretos sin importar el zoom, y así distinguirse
   * visualmente tanto del modelo de bloques como de las trazas de sondaje.
   */
  updateSamplesRender(samplesData, activeAttribute, paletteName, pointSizePx, customMin = null, customMax = null) {
    this.samplesData = samplesData;
    if (pointSizePx) this.samplePointSize = pointSizePx;

    // Limpiar anterior
    if (this.sampleMesh) {
      this.scene.remove(this.sampleMesh);
      if (this.sampleMesh.geometry) this.sampleMesh.geometry.dispose();
      if (this.sampleMesh.material) this.sampleMesh.material.dispose();
      this.sampleMesh = null;
    }

    if (!samplesData || samplesData.count === 0) {
      this.updateLegend('samples', null);
      return;
    }

    const indicesToRender = this.getFilteredSampleIndices();
    const activeCount = indicesToRender.length;

    if (activeCount === 0) {
      this.updateLegend('samples', null);
      return;
    }

    const attrMeta = samplesData.attributeMetadata.find(a => a.name === activeAttribute);
    let isCategorical = false;
    let minVal = 0, maxVal = 1;
    let lookupTable = [];

    if (attrMeta) {
      isCategorical = attrMeta.type === 'category';
      if (isCategorical) {
        lookupTable = samplesData.categoryLookups[activeAttribute] || [];
      } else {
        const buf = samplesData.attributes[activeAttribute];
        if (customMin !== null && !isNaN(customMin)) {
          minVal = customMin;
        } else {
          let min = Infinity;
          for (let i = 0; i < buf.length; i++) {
            const val = buf[i];
            if (val !== -999.0 && val < min) min = val;
          }
          minVal = min === Infinity ? 0 : min;
        }
        if (customMax !== null && !isNaN(customMax)) {
          maxVal = customMax;
        } else {
          let max = -Infinity;
          for (let i = 0; i < buf.length; i++) {
            const val = buf[i];
            if (val !== -999.0 && val > max) max = val;
          }
          maxVal = max === -Infinity ? 1 : max;
        }
      }
    }

    // Actualizar leyenda
    this.updateLegend('samples', attrMeta, minVal, maxVal, lookupTable, paletteName);

    const positions = samplesData.positions;
    const attrBuffer = activeAttribute ? samplesData.attributes[activeAttribute] : null;

    const geom = new THREE.BufferGeometry();
    const pointPositions = new Float32Array(activeCount * 3);
    const pointColors = new Float32Array(activeCount * 3);

    for (let i = 0; i < activeCount; i++) {
      const idx = indicesToRender[i];
      const idx3 = idx * 3;

      pointPositions[i * 3] = positions[idx3];
      pointPositions[i * 3 + 1] = positions[idx3 + 1];
      pointPositions[i * 3 + 2] = positions[idx3 + 2];

      // Color base ámbar (distinto del azul de Bloques y de los colores por
      // ley de Sondajes) para que las muestras sean reconocibles a simple
      // vista incluso sin atributo de coloreo seleccionado.
      let col = new THREE.Color(0xf59e0b);
      if (attrBuffer) {
        const val = attrBuffer[idx];
        col = isCategorical ? this.getDiscreteColor(val) : this.getColorForValue(val, minVal, maxVal, paletteName);
      }

      pointColors[i * 3] = col.r;
      pointColors[i * 3 + 1] = col.g;
      pointColors[i * 3 + 2] = col.b;
    }

    geom.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(pointColors, 3));

    const pointMat = new THREE.PointsMaterial({
      size: this.samplePointSize,
      vertexColors: true,
      sizeAttenuation: false // Puntos pequeños de tamaño constante en pantalla
    });

    this.sampleMesh = new THREE.Points(geom, pointMat);
    this.scene.add(this.sampleMesh);
  }

  /**
   * Filtra las muestras visibles según la sección de corte activa (usando el
   * mismo espesor de ventana que Sondajes, ver "Espesor Ventana — Sondajes /
   * Muestras" en el panel de Filtros & Secciones) y los filtros de atributo
   * propios de esta capa (app.sampleFilters). No usa el índice espacial
   * (Octree) de Bloques: se filtra linealmente, suficiente para los
   * volúmenes típicos de una base de muestras.
   */
  getFilteredSampleIndices() {
    if (!this.samplesData) return [];

    const sectionActive = document.getElementById('chk-section-active').checked;
    const positions = this.samplesData.positions;
    let sampleIndices;

    if (sectionActive) {
      const type = document.getElementById('select-section-type').value;
      const coord = parseFloat(document.getElementById('range-section-pos').value);
      const thicknessEl = document.getElementById('range-section-thickness-drillholes');
      const thickness = thicknessEl ? parseFloat(thicknessEl.value) : 10;
      const minVal = coord - thickness;
      const maxVal = coord + thickness;

      sampleIndices = [];
      for (let i = 0; i < this.samplesData.count; i++) {
        const idx3 = i * 3;
        let coordVal;
        if (type === 'vertical-n') coordVal = positions[idx3];       // Eje X
        else if (type === 'vertical-e') coordVal = positions[idx3 + 1]; // Eje Y
        else coordVal = positions[idx3 + 2];                         // Eje Z (Planta)
        if (coordVal >= minVal && coordVal <= maxVal) sampleIndices.push(i);
      }
    } else {
      sampleIndices = new Array(this.samplesData.count);
      for (let i = 0; i < this.samplesData.count; i++) sampleIndices[i] = i;
    }

    const activeFilters = (typeof app !== 'undefined' && app.sampleFilters) ? app.sampleFilters : [];
    if (activeFilters.length === 0) return sampleIndices;

    const filtered = [];
    const attrData = this.samplesData.attributes;
    for (let i = 0; i < sampleIndices.length; i++) {
      const idx = sampleIndices[i];
      let passes = true;
      for (const filter of activeFilters) {
        const val = attrData[filter.attribute][idx];
        if (filter.type === 'number') {
          if (val === -999.0 || val < filter.min || val > filter.max) { passes = false; break; }
        } else if (filter.type === 'category') {
          if (!filter.values.includes(val)) { passes = false; break; }
        }
      }
      if (passes) filtered.push(idx);
    }
    return filtered;
  }

  // ==========================================
  // RENDER DE GEOMETRÍAS DXF
  // ==========================================
  addDxfLayer(layerName, dxfData) {
    // Eliminar si ya existe
    this.removeDxfLayer(layerName);

    // Estilo propio de esta capa (color/opacidad independientes del resto de
    // superficies DXF cargadas). Si el nombre de capa ya tenía un estilo
    // asignado antes en esta sesión (ej. se reimportó el mismo archivo), se
    // conserva en vez de resetear a los valores por defecto.
    if (!this.dxfLayerStyles[layerName]) {
      this.dxfLayerStyles[layerName] = { color: this.defaultDxfColor, opacity: this.defaultDxfOpacity };
    }
    const style = this.dxfLayerStyles[layerName];

    const layerGroup = new THREE.Group();
    layerGroup.name = `dxf_${layerName}`;

    // 1. Renderizar Caras (Triángulos de superficies/TIN)
    if (dxfData.triangles && dxfData.triangles.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(dxfData.triangles, 3));
      geom.computeVertexNormals();

      // Material de topografía semi-translúcido con iluminación. Color y
      // opacidad salen del estilo propio de esta capa (this.dxfLayerStyles[layerName],
      // editable desde el panel Visualización > Superficies DXF, seleccionando
      // esta capa en el combo "Capa DXF") en vez de quedar fijos, para que
      // updateDxfLayerStyle() pueda ajustarlos en vivo sin reconstruir la
      // geometría.
      const meshMat = new THREE.MeshLambertMaterial({
        color: style.color,
        side: THREE.DoubleSide,
        transparent: style.opacity < 1,
        opacity: style.opacity,
        wireframe: false
      });
      
      const mesh = new THREE.Mesh(geom, meshMat);
      layerGroup.add(mesh);
      
      // Añadir líneas de wireframe del TIN para contexto visual premium
      const wireframeGeom = new THREE.WireframeGeometry(geom);
      const wireframeMat = new THREE.LineBasicMaterial({
        color: 0x334155,
        transparent: true,
        opacity: 0.3
      });
      const wireframe = new THREE.LineSegments(wireframeGeom, wireframeMat);
      layerGroup.add(wireframe);
    }
    
    // 2. Renderizar Líneas y Polilíneas
    if (dxfData.lines && dxfData.lines.length > 0) {
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x06b6d4, // cian brillante para contornos
        linewidth: 2 // no soportado en todos los navegadores, pero define base
      });
      
      dxfData.lines.forEach(lineCoords => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(lineCoords, 3));
        const line = new THREE.Line(geom, lineMat);
        layerGroup.add(line);
      });
    }
    
    // Aplicar el recorte de sección/planta actualmente activo (si lo hay) a
    // esta capa recién creada, para que quede consistente con capas ya
    // cargadas si el usuario importa un nuevo DXF mientras una sección ya
    // está activa (ver updateDxfSectionClip()).
    layerGroup.children.forEach(child => {
      if (child.material) child.material.clippingPlanes = this._dxfClipPlanes;
    });

    this.dxfGroup.add(layerGroup);
    this.dxfMeshes[layerName] = layerGroup;

    // Focar cámara si es la primera capa
    if (Object.keys(this.dxfMeshes).length === 1 && dxfData.triangles && dxfData.triangles.length > 0) {
      // Calcular límites rápidos
      let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity, minZ=Infinity, maxZ=-Infinity;
      for (let j=0; j<dxfData.triangles.length; j+=3) {
        const x = dxfData.triangles[j];
        const y = dxfData.triangles[j+1];
        const z = dxfData.triangles[j+2];
        if (x<minX) minX=x; if (x>maxX) maxX=x;
        if (y<minY) minY=y; if (y>maxY) maxY=y;
        if (z<minZ) minZ=z; if (z>maxZ) maxZ=z;
      }
      this.focusOnBounds({ minX, maxX, minY, maxY, minZ, maxZ });
    }
  }

  /**
   * Actualiza el color y/o la opacidad de UNA capa DXF puntual (identificada
   * por layerName), no de todas — a diferencia de la versión anterior de este
   * método, que aplicaba un único color/opacidad global a cada superficie
   * cargada. `changes` es un objeto parcial ({ color? , opacity? }): solo se
   * sobreescribe lo que venga definido, así el color picker y el slider de
   * opacidad del panel Visualización > Superficies DXF pueden dispararse por
   * separado sin pisarse entre sí.
   *
   * Al igual que antes, esto solo muta el material del mesh de caras ya
   * existente (sin reconstruir geometría). El wireframe de contorno y las
   * polilíneas/contornos DXF (LINE/LWPOLYLINE, en cian) mantienen su propio
   * color fijo — el control de color solo afecta el relleno de la superficie.
   */
  updateDxfLayerStyle(layerName, changes) {
    if (!this.dxfLayerStyles[layerName]) return;
    Object.assign(this.dxfLayerStyles[layerName], changes);
    const style = this.dxfLayerStyles[layerName];

    const layerGroup = this.dxfMeshes[layerName];
    if (!layerGroup) return; // Estilo guardado pero la capa no está cargada ahora mismo

    const colorObj = new THREE.Color(style.color);
    layerGroup.children.forEach(child => {
      if (child.isMesh && child.material) {
        child.material.color.copy(colorObj);
        child.material.opacity = style.opacity;
        child.material.transparent = style.opacity < 1;
        child.material.needsUpdate = true;
      }
    });
  }

  /**
   * Recorta (clip) las superficies DXF a la misma vista de Sección/Planta
   * activa para Bloques/Sondajes/Muestras (panel Filtros & Secciones), usando
   * los "clipping planes" nativos de Three.js en vez de filtrar índices o
   * reconstruir geometría: al estar en Planta, por ejemplo, solo debe verse
   * la porción de la superficie cuya cota Z cae dentro del espesor de ventana
   * configurado para DXF — lo que en la práctica dibuja el "borde"/curva de
   * nivel donde la superficie cruza esa franja, tal como se ve un corte real
   * de topografía. Mismo mapeo de eje que el resto de las capas:
   * 'horizontal' (Planta) -> Z, 'vertical-n' (Sección N-S) -> X,
   * 'vertical-e' (Sección E-O) -> Y.
   *
   * Se llama cada vez que cambia algo del corte (activo/inactivo, tipo,
   * posición o espesor DXF) y también aplica el resultado a cualquier capa
   * DXF que se cargue después (ver el bloque en addDxfLayer() que lee
   * this._dxfClipPlanes).
   */
  updateDxfSectionClip() {
    const chkSection = document.getElementById('chk-section-active');
    const sectionActive = !!(chkSection && chkSection.checked);

    let planes = [];
    if (sectionActive) {
      const type = document.getElementById('select-section-type').value;
      const coord = parseFloat(document.getElementById('range-section-pos').value);
      const thicknessEl = document.getElementById('range-section-thickness-dxf');
      const thickness = thicknessEl ? parseFloat(thicknessEl.value) : 5;

      if (!isNaN(coord) && !isNaN(thickness)) {
        let axisNormal;
        if (type === 'vertical-n') axisNormal = new THREE.Vector3(1, 0, 0);       // Eje X
        else if (type === 'vertical-e') axisNormal = new THREE.Vector3(0, 1, 0);  // Eje Y
        else axisNormal = new THREE.Vector3(0, 0, 1);                            // Eje Z (Planta)

        // Dos planos formando una "rebanada" (slab): normal apuntando hacia
        // valores crecientes mantiene coord >= min; su inverso mantiene
        // coord <= max. Por defecto Three.js clippea la UNIÓN de las zonas
        // negativas de todos los planos (clipIntersection=false), o sea que
        // un punto sobrevive solo si está del lado positivo de AMBOS planos —
        // exactamente la intersección [min, max] que se busca.
        const planeMin = new THREE.Plane(axisNormal.clone(), -(coord - thickness));
        const planeMax = new THREE.Plane(axisNormal.clone().negate(), (coord + thickness));
        planes = [planeMin, planeMax];
      }
    }

    this._dxfClipPlanes = planes;
    for (const layerName in this.dxfMeshes) {
      this.dxfMeshes[layerName].children.forEach(child => {
        if (child.material) {
          child.material.clippingPlanes = planes;
          child.material.needsUpdate = true;
        }
      });
    }
  }

  removeDxfLayer(layerName) {
    const mesh = this.dxfMeshes[layerName];
    if (mesh) {
      this.dxfGroup.remove(mesh);
      mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      delete this.dxfMeshes[layerName];
    }
  }

  toggleLayerVisibility(layerName, visible) {
    const mesh = this.dxfMeshes[layerName];
    if (mesh) {
      mesh.visible = visible;
    }
  }

  // ==========================================
  // RAYCASTING Y TOOLTIPS
  // ==========================================
  onMouseMove(event) {
    // Calcular coordenadas normalizadas
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    this.raycaster.setFromCamera(this.mouse, this.camera);
    
    // Raycast a bloques (InstancedMesh) o sondajes
    const targets = [];
    if (this.blockMesh && this.blockMesh.visible && this.renderMode === 'cubes') {
      targets.push(this.blockMesh);
    }
    
    this.drillholesGroup.children.forEach(c => {
      if (c.visible) targets.push(c);
    });
    
    const intersects = this.raycaster.intersectObjects(targets);
    
    if (intersects.length > 0) {
      const intersect = intersects[0];
      const object = intersect.object;
      
      // Mostrar tooltip
      // El tooltip se posiciona (position:absolute) respecto a #viewport-container,
      // no respecto a la ventana completa. Como clientX/clientY son coordenadas de
      // ventana, había que restar el offset del contenedor (rect, ya calculado arriba
      // para el raycasting) para que el tooltip apareciera junto al cursor real y no
      // desplazado por el ancho del sidebar / alto del header.
      this.tooltip.classList.remove('hidden');
      this.tooltip.style.left = `${event.clientX - rect.left}px`;
      this.tooltip.style.top = `${event.clientY - rect.top}px`;
      
      if (object === this.blockMesh) {
        // Bloque detectado
        const instanceId = intersect.instanceId;
        const realIdx = object.userData.realIndices[instanceId];
        
        const pos3 = realIdx * 3;
        const x = this.blockData.positions[pos3];
        const y = this.blockData.positions[pos3 + 1];
        const z = this.blockData.positions[pos3 + 2];
        
        let attrHtml = "";
        this.blockData.attributeMetadata.forEach(attr => {
          const val = this.blockData.attributes[attr.name][realIdx];
          let displayVal = val;
          if (attr.type === 'category') {
            displayVal = this.blockData.categoryLookups[attr.name][val] || 'N/A';
          } else {
            displayVal = val === -999.0 ? 'N/A' : val.toFixed(3);
          }
          attrHtml += `<br><span>${attr.name}:</span> <strong>${displayVal}</strong>`;
        });
        
        this.tooltip.innerHTML = `
          <strong>Bloque #${realIdx.toLocaleString()}</strong>
          <br><span>Coord X:</span> <strong>${x.toFixed(1)}</strong>
          <br><span>Coord Y:</span> <strong>${y.toFixed(1)}</strong>
          <br><span>Coord Z:</span> <strong>${z.toFixed(1)}</strong>
          ${attrHtml}
        `;
      } else {
        // Segmento de sondaje detectado
        const instanceId = intersect.instanceId;
        const interval = object.userData.intervals[instanceId];
        const attrName = object.userData.activeAttribute;
        
        let attrVal = "N/A";
        if (attrName && interval.values) {
          const val = interval.values[attrName];
          attrVal = val !== undefined && val !== null ? val : "N/A";
        }
        
        this.tooltip.innerHTML = `
          <strong>Sondaje: ${interval.holeId}</strong>
          <br><span>Desde:</span> <strong>${interval.from.toFixed(1)} m</strong>
          <br><span>Hasta:</span> <strong>${interval.to.toFixed(1)} m</strong>
          <br><span>Largo:</span> <strong>${(interval.to - interval.from).toFixed(1)} m</strong>
          ${attrName ? `<br><span>${attrName}:</span> <strong>${attrVal}</strong>` : ''}
        `;
      }
    } else {
      this.tooltip.classList.add('hidden');
    }
  }

  // ==========================================
  // LEYENDA
  // ==========================================
  /**
   * Actualiza la leyenda de una capa específica.
   * @param {string} target 'blocks' o 'drillholes' — cada capa tiene su propia tarjeta de leyenda
   *   para poder mostrar atributos, paletas y rangos distintos de forma independiente.
   * @param {Object|null} attrMeta {name, type} del atributo activo, o null para ocultar la leyenda
   * @param {number} minVal Valor mínimo del rango (solo numérico)
   * @param {number} maxVal Valor máximo del rango (solo numérico)
   * @param {Array} lookupTable Lista de nombres de categoría (solo categórico)
   * @param {string} paletteName Nombre de la paleta activa para esta capa
   */
  updateLegend(target, attrMeta, minVal, maxVal, lookupTable, paletteName) {
    // Los tres targets ('blocks', 'drillholes', 'samples') coinciden
    // exactamente con el sufijo de los IDs del DOM (legend-blocks,
    // legend-drillholes, legend-samples), así que no hace falta remapear.
    const suffix = target;
    const legendEl = document.getElementById(`legend-${suffix}`);
    if (!legendEl) return;

    if (!attrMeta) {
      legendEl.classList.add('hidden');
      return;
    }

    legendEl.classList.remove('hidden');
    document.getElementById(`legend-attribute-name-${suffix}`).innerText = attrMeta.name;

    const container = document.getElementById(`legend-colors-container-${suffix}`);
    container.innerHTML = "";

    if (attrMeta.type === 'category') {
      // Leyenda discreta
      lookupTable.forEach((catName, id) => {
        const col = this.getDiscreteColor(id);
        const hex = `#${col.getHexString()}`;

        const row = document.createElement('div');
        row.className = 'legend-row';
        row.innerHTML = `
          <div class="legend-color-box" style="background-color: ${hex};"></div>
          <span>${catName}</span>
        `;
        container.appendChild(row);
      });
    } else {
      // Leyenda de gradiente continuo (5 tramos)
      const palette = paletteName || this.colorPaletteName;
      const steps = 5;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const val = minVal + t * (maxVal - minVal);
        const col = this.getColorForValue(val, minVal, maxVal, palette);
        const hex = `#${col.getHexString()}`;

        const row = document.createElement('div');
        row.className = 'legend-row';
        row.innerHTML = `
          <div class="legend-color-box" style="background-color: ${hex};"></div>
          <span>${val.toFixed(2)}</span>
        `;
        container.appendChild(row);
      }
    }
  }

  toggleLegend(target) {
    const legendEl = document.getElementById(`legend-${target}`);
    if (legendEl) legendEl.classList.toggle('hidden');
  }
}
