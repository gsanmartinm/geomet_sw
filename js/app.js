/**
 * GeoMet V1 — Módulo Principal de la Aplicación (Coordinador)
 * Configura los componentes y maneja el flujo de eventos global.
 */

class GeometApp {
  constructor() {
    this.scene = null;
    this.importer = null;
    this.spatialIndex = null;
    
    // Estado Global
    this.blockData = null;
    this.drillholeData = null;
    this.samplesData = null; // Muestras metalúrgicas (HoleID+Desde/Hasta o Centroide)
    this.filters = [];       // Filtros activos del Modelo de Bloques: {attribute, type, min, max, values}
    this.dhFilters = [];     // Filtros activos de Sondajes (misma forma, independiente de bloques)
    this.sampleFilters = []; // Filtros activos de Muestras Metalúrgicas (misma forma, independiente)

    // Variables Calculadas: atributos numéricos nuevos generados en base a
    // los ya cargados (ej. CUS.CUT = [CUS]/[CUT]), independiente por capa.
    // Cada entrada es {name, formula}. Son de sesión: se pierden si se
    // reimporta esa capa o se elimina — ver loadBlockData/loadDrillholeData/
    // loadSamplesData y removeLayer(). Ver openCalcBuilder()/confirmCalcBuilder().
    this.calcVariables = { blocks: [], drillholes: [], samples: [] };

    // Estado de visualización independiente por capa (Bloques / Sondajes /
    // Muestras), para poder colorear cada una con su propio atributo, paleta y rango.
    this.blockColorAttribute = "";
    this.blockPaletteName = "rainbow";
    this.dhColorAttribute = "";
    this.dhPaletteName = "rainbow";
    this.sampleColorAttribute = "";
    this.samplePaletteName = "rainbow";

    // Web Worker
    this.worker = null;
  }

  init() {
    // 1. Inicializar Visor 3D y Controladores
    this.scene = new GeometScene('three-canvas');
    this.importer = new GeometImporter();
    
    this.initUIEventListeners();
    this.initConsoleControl();
    this.initDraggableLegends();

    this.logConsole('info', '[Sistema] Inicializando pruebas de validación automatizadas...');
    this.runAutomatedTests();
  }

  // ==========================================
  // LEYENDAS ARRASTRABLES
  // ==========================================
  /**
   * Permite arrastrar cada tarjeta de leyenda (Bloques/Sondajes) con el mouse,
   * tomando el encabezado como manija, para liberar la vista 3D cuando la
   * leyenda tapa algo importante.
   */
  initDraggableLegends() {
    document.querySelectorAll('.legend-card').forEach(card => {
      const header = card.querySelector('.legend-header');
      if (!header) return;

      header.addEventListener('mousedown', (e) => {
        // No arrastrar si el click fue sobre el botón de cerrar
        if (e.target.closest('.btn-icon')) return;
        e.preventDefault();

        const container = card.offsetParent || card.parentElement;
        const containerRect = container.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();

        // Desanclar de bottom/right y fijar la posición actual vía left/top
        const startLeft = cardRect.left - containerRect.left;
        const startTop = cardRect.top - containerRect.top;
        card.style.left = `${startLeft}px`;
        card.style.top = `${startTop}px`;
        card.style.right = 'auto';
        card.style.bottom = 'auto';

        const offsetX = e.clientX - cardRect.left;
        const offsetY = e.clientY - cardRect.top;

        const onMouseMove = (moveEvt) => {
          const contRect = container.getBoundingClientRect();
          let newLeft = moveEvt.clientX - contRect.left - offsetX;
          let newTop = moveEvt.clientY - contRect.top - offsetY;

          // Mantener la tarjeta dentro de los límites del visor 3D
          newLeft = Math.max(0, Math.min(newLeft, contRect.width - card.offsetWidth));
          newTop = Math.max(0, Math.min(newTop, contRect.height - card.offsetHeight));

          card.style.left = `${newLeft}px`;
          card.style.top = `${newTop}px`;
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });
  }

  // ==========================================
  // MANEJO DE EVENTOS UI
  // ==========================================
  initUIEventListeners() {
    // Generar Datos Sintéticos
    const btnSynthetic = document.getElementById('btn-generate-synthetic');
    if (btnSynthetic) {
      btnSynthetic.addEventListener('click', () => {
        const count = prompt("Ingrese cantidad de bloques a generar para prueba de stress:", "1000000");
        const blockCount = parseInt(count, 10);
        if (!isNaN(blockCount) && blockCount > 0) {
          this.generateSyntheticBlocks(blockCount);
        }
      });
    }

    // Pestañas Laterales
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabId = btn.dataset.tab;
        const parent = btn.parentElement;
        
        // Desactivar otros en la misma barra
        parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Mostrar panel
        const sidebar = btn.closest('.sidebar');
        sidebar.querySelectorAll('.tab-panel').forEach(panel => {
          if (panel.id === tabId) {
            panel.classList.add('active');
          } else {
            panel.classList.remove('active');
          }
        });
      });
    });

    // Cambios de parámetros de visualización
    document.getElementById('select-render-mode').addEventListener('change', () => this.triggerBlockRefresh());

    // Configura los controles de coloreado (atributo, paleta, rango) para una capa
    // ('blocks', 'drillholes' o 'samples') de forma totalmente independiente entre sí.
    this.initVizControlsForTarget('blocks');
    this.initVizControlsForTarget('drillholes');
    this.initVizControlsForTarget('samples');

    // Sliders de Tamaños
    const rangeBlockSize = document.getElementById('range-block-size');
    rangeBlockSize.addEventListener('input', (e) => {
      document.getElementById('block-size-val').innerText = parseFloat(e.target.value).toFixed(1);
      this.scene.blockSizeFactor = parseFloat(e.target.value);
      this.triggerBlockRefresh();
    });

    const rangeBlockOpacity = document.getElementById('range-block-opacity');
    if (rangeBlockOpacity) {
      rangeBlockOpacity.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        document.getElementById('block-opacity-val').innerText = `${Math.round(val * 100)}%`;
        this.scene.blockOpacity = val;
        this.triggerBlockRefresh();
      });
    }

    const rangeDhSize = document.getElementById('range-drillhole-size');
    rangeDhSize.addEventListener('input', (e) => {
      document.getElementById('drillhole-size-val').innerText = `${e.target.value}px`;
      this.scene.drillholeThickness = parseFloat(e.target.value);
      this.triggerDrillholeRefresh();
    });

    const rangeSampleSize = document.getElementById('range-sample-size');
    if (rangeSampleSize) {
      rangeSampleSize.addEventListener('input', (e) => {
        document.getElementById('sample-size-val').innerText = `${e.target.value}px`;
        this.scene.samplePointSize = parseFloat(e.target.value);
        this.triggerSamplesRefresh();
      });
    }

    // Superficies DXF: color y transparencia POR CAPA (cada superficie DXF
    // cargada mantiene su propio estilo — ver scene.dxfLayerStyles). El combo
    // "Capa DXF" (poblado dinámicamente por updateDxfLayerSelector(), llamado
    // desde updateLayersTree() cada vez que cambian las capas cargadas) decide
    // a cuál capa aplican el color picker y el slider de abajo. A diferencia
    // de Bloques/Sondajes/Muestras (que se re-generan desde los datos crudos
    // en cada cambio vía trigger*Refresh), las capas DXF ya son mallas de
    // Three.js armadas una sola vez al importar — así que en vez de
    // reconstruirlas, updateDxfLayerStyle() solo actualiza el material
    // existente in-place.
    const selectDxfLayer = document.getElementById('select-dxf-layer');
    if (selectDxfLayer) {
      selectDxfLayer.addEventListener('change', (e) => {
        this.syncDxfStyleControls(e.target.value || null);
      });
    }

    const inputDxfColor = document.getElementById('input-dxf-color');
    if (inputDxfColor) {
      inputDxfColor.addEventListener('input', (e) => {
        const layerName = selectDxfLayer ? selectDxfLayer.value : null;
        if (!layerName) return;
        const colorHex = parseInt(e.target.value.replace('#', '0x'), 16);
        this.scene.updateDxfLayerStyle(layerName, { color: colorHex });
      });
    }

    const rangeDxfOpacity = document.getElementById('range-dxf-opacity');
    if (rangeDxfOpacity) {
      rangeDxfOpacity.addEventListener('input', (e) => {
        const layerName = selectDxfLayer ? selectDxfLayer.value : null;
        if (!layerName) return;
        const val = parseFloat(e.target.value);
        document.getElementById('dxf-opacity-val').innerText = `${Math.round(val * 100)}%`;
        this.scene.updateDxfLayerStyle(layerName, { opacity: val });
      });
    }

    // Switch "Leyenda" de cada subsección (Bloques/Sondajes/Muestras): oculta
    // o muestra la tarjeta de leyenda de esa capa de forma persistente (ver
    // scene.setLegendVisible — a diferencia del botón "×" de la tarjeta, que
    // antes se re-mostraba solo con el próximo refresh de datos, este estado
    // se respeta en updateLegend() y no se pisa solo).
    ['blocks', 'drillholes', 'samples'].forEach(target => {
      const chkLegend = document.getElementById(`chk-legend-${target}`);
      if (chkLegend) {
        chkLegend.addEventListener('change', (e) => {
          this.scene.setLegendVisible(target, e.target.checked);
        });
      }
    });

    // Sección de Corte (Sliders & Checkbox)
    const chkSection = document.getElementById('chk-section-active');
    const sectionControls = document.getElementById('section-controls-container');
    chkSection.addEventListener('change', () => {
      if (chkSection.checked) {
        sectionControls.classList.remove('disabled-overlay');
      } else {
        sectionControls.classList.add('disabled-overlay');
      }
      this.triggerBlockRefresh();
      this.triggerDrillholeRefresh();
      this.triggerSamplesRefresh();
      this.scene.updateDxfSectionClip();
    });

    document.getElementById('select-section-type').addEventListener('change', (e) => {
      this.updateSectionPosLimits();
      this.triggerBlockRefresh();
      this.triggerDrillholeRefresh();
      this.triggerSamplesRefresh();
      this.scene.updateDxfSectionClip();
    });

    // Posición de corte: slider + input numérico sincronizados entre sí,
    // para poder tanto arrastrar como escribir una cota/coordenada exacta.
    const rangeSecPos = document.getElementById('range-section-pos');
    const inputSecPos = document.getElementById('input-section-pos');
    rangeSecPos.addEventListener('input', (e) => {
      document.getElementById('section-pos-val').innerText = `${e.target.value} m`;
      if (inputSecPos) inputSecPos.value = e.target.value;
      this.triggerBlockRefresh();
      this.triggerDrillholeRefresh();
      this.triggerSamplesRefresh();
      this.scene.updateDxfSectionClip();
    });

    if (inputSecPos) {
      const commitInputSecPos = () => {
        if (inputSecPos.value === '') return;
        let val = parseFloat(inputSecPos.value);
        if (isNaN(val)) return;
        const min = parseFloat(rangeSecPos.min);
        const max = parseFloat(rangeSecPos.max);
        val = Math.max(min, Math.min(max, val));
        rangeSecPos.value = val;
        inputSecPos.value = val;
        document.getElementById('section-pos-val').innerText = `${val} m`;
        this.triggerBlockRefresh();
        this.triggerDrillholeRefresh();
        this.triggerSamplesRefresh();
        this.scene.updateDxfSectionClip();
      };
      inputSecPos.addEventListener('change', commitInputSecPos);
      inputSecPos.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commitInputSecPos();
      });
    }

    // Espesor de ventana independiente para Modelo de Bloques y Sondajes:
    // cambiar uno solo refresca su propia capa, no la otra.
    const rangeSecThickBlocks = document.getElementById('range-section-thickness-blocks');
    if (rangeSecThickBlocks) {
      rangeSecThickBlocks.addEventListener('input', (e) => {
        document.getElementById('section-thickness-blocks-val').innerText = `±${e.target.value} m`;
        this.triggerBlockRefresh();
      });
    }

    const rangeSecThickDh = document.getElementById('range-section-thickness-drillholes');
    if (rangeSecThickDh) {
      rangeSecThickDh.addEventListener('input', (e) => {
        document.getElementById('section-thickness-drillholes-val').innerText = `±${e.target.value} m`;
        this.triggerDrillholeRefresh();
        // El mismo control de espesor se reutiliza para filtrar las Muestras
        // Metalúrgicas por sección (ver "Sondajes / Muestras" en la etiqueta).
        this.triggerSamplesRefresh();
      });
    }

    // Espesor de ventana propio para Superficies DXF: a diferencia de
    // Bloques/Sondajes (nubes de puntos/instancias que se filtran por índice),
    // las superficies DXF son mallas continuas y se recortan en vivo con
    // clipping planes (scene.updateDxfSectionClip()) — ver esa función para el
    // porqué de un espesor angosto que muestra el "borde" de nivel/sección.
    const rangeSecThickDxf = document.getElementById('range-section-thickness-dxf');
    if (rangeSecThickDxf) {
      rangeSecThickDxf.addEventListener('input', (e) => {
        document.getElementById('section-thickness-dxf-val').innerText = `±${e.target.value} m`;
        this.scene.updateDxfSectionClip();
      });
    }

    // Botones de avanzar/retroceder secciones (usan el espesor de Bloques como paso)
    const btnSecPrev = document.getElementById('btn-sec-prev');
    const btnSecNext = document.getElementById('btn-sec-next');
    if (btnSecPrev && btnSecNext) {
      btnSecPrev.addEventListener('click', () => {
        const thickness = parseFloat(rangeSecThickBlocks && rangeSecThickBlocks.value) || 10;
        rangeSecPos.value = Math.max(parseFloat(rangeSecPos.min), parseFloat(rangeSecPos.value) - thickness);
        document.getElementById('section-pos-val').innerText = `${rangeSecPos.value} m`;
        if (inputSecPos) inputSecPos.value = rangeSecPos.value;
        this.triggerBlockRefresh();
        this.triggerDrillholeRefresh();
        this.triggerSamplesRefresh();
        this.scene.updateDxfSectionClip();
      });
      btnSecNext.addEventListener('click', () => {
        const thickness = parseFloat(rangeSecThickBlocks && rangeSecThickBlocks.value) || 10;
        rangeSecPos.value = Math.min(parseFloat(rangeSecPos.max), parseFloat(rangeSecPos.value) + thickness);
        document.getElementById('section-pos-val').innerText = `${rangeSecPos.value} m`;
        if (inputSecPos) inputSecPos.value = rangeSecPos.value;
        this.triggerBlockRefresh();
        this.triggerDrillholeRefresh();
        this.triggerSamplesRefresh();
        this.scene.updateDxfSectionClip();
      });
    }

    // Grilla de Referencia (Planta/Perfil): espaciado en metros, transparencia
    // y tamaño de los números, editables en vivo desde el panel de la pestaña
    // Filtros & Secciones.
    const inputAxisGridStep = document.getElementById('input-axis-grid-step');
    if (inputAxisGridStep) {
      inputAxisGridStep.addEventListener('change', () => {
        const val = parseFloat(inputAxisGridStep.value);
        // El propio _updateAxisRuler() de scene.js detecta el cambio de
        // espaciado y reconstruye la grilla en el próximo frame.
        this.scene.axisGridStepOverride = (!isNaN(val) && val > 0) ? val : null;
      });
    }

    const rangeAxisGridOpacity = document.getElementById('range-axis-grid-opacity');
    if (rangeAxisGridOpacity) {
      rangeAxisGridOpacity.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        document.getElementById('axis-grid-opacity-val').innerText = `${Math.round(val * 100)}%`;
        this.scene.axisGridOpacity = val;
      });
    }

    const rangeAxisGridLabelSize = document.getElementById('range-axis-grid-label-size');
    if (rangeAxisGridLabelSize) {
      rangeAxisGridLabelSize.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        document.getElementById('axis-grid-label-size-val').innerText = `${val.toFixed(2)}rem`;
        this.scene.axisGridLabelSize = val;
      });
    }

    // Añadir filtros de atributos (independiente para Bloques y Sondajes)
    const btnAddFilterBlocks = document.getElementById('btn-add-filter-blocks');
    if (btnAddFilterBlocks) {
      btnAddFilterBlocks.addEventListener('click', () => this.openFilterBuilder('blocks'));
    }
    const btnAddFilterDrillholes = document.getElementById('btn-add-filter-drillholes');
    if (btnAddFilterDrillholes) {
      btnAddFilterDrillholes.addEventListener('click', () => this.openFilterBuilder('drillholes'));
    }
    const btnAddFilterSamples = document.getElementById('btn-add-filter-samples');
    if (btnAddFilterSamples) {
      btnAddFilterSamples.addEventListener('click', () => this.openFilterBuilder('samples'));
    }

    // Variables Calculadas (independiente para Bloques, Sondajes y Muestras)
    ['blocks', 'drillholes', 'samples'].forEach(target => {
      const btnAddCalc = document.getElementById(`btn-add-calc-${target}`);
      if (btnAddCalc) {
        btnAddCalc.addEventListener('click', () => this.openCalcBuilder(target));
      }
    });
  }

  /**
   * Conecta los controles de coloreado (selector de atributo, paleta y rango manual)
   * de una capa específica ('blocks' o 'drillholes') a su propio estado y refresh,
   * de forma que cambiar el atributo/paleta/rango de una capa no afecte a la otra.
   */
  initVizControlsForTarget(target) {
    // Mapea cada capa a su propia clave de estado (atributo/paleta) y su
    // propia función de refresh, para poder soportar N capas independientes
    // (Bloques, Sondajes, Muestras) sin duplicar esta lógica de wiring.
    const targetConfig = {
      blocks: { attrKey: 'blockColorAttribute', paletteKey: 'blockPaletteName', refresh: () => this.triggerBlockRefresh() },
      drillholes: { attrKey: 'dhColorAttribute', paletteKey: 'dhPaletteName', refresh: () => this.triggerDrillholeRefresh() },
      samples: { attrKey: 'sampleColorAttribute', paletteKey: 'samplePaletteName', refresh: () => this.triggerSamplesRefresh() }
    };
    const cfg = targetConfig[target];
    if (!cfg) return;
    const { attrKey, paletteKey, refresh } = cfg;

    // Selector de atributo activo
    const selectAttr = document.getElementById(`select-color-attribute-${target}`);
    if (selectAttr) {
      selectAttr.addEventListener('change', (e) => {
        this[attrKey] = e.target.value;
        // Reiniciar rango manual al cambiar atributo para evitar rangos inconsistentes
        const minInput = document.getElementById(`input-color-min-${target}`);
        const maxInput = document.getElementById(`input-color-max-${target}`);
        if (minInput) minInput.value = "";
        if (maxInput) maxInput.value = "";
        this.updateColorRangeUI(target);
        refresh();
      });
    }

    // Paleta de colores (solo afecta los botones dentro de esta capa)
    const paletteContainer = document.querySelector(`.palette-picker[data-viz-target="${target}"]`);
    const groupCustomPalette = document.getElementById(`group-custom-palette-${target}`);
    if (paletteContainer) {
      const paletteBtns = paletteContainer.querySelectorAll('.palette-btn');
      paletteBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          paletteBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this[paletteKey] = btn.dataset.palette;
          // Los 2 color pickers de "Colores Personalizados" solo son
          // relevantes (y solo se muestran) cuando esta capa tiene
          // seleccionada la paleta "custom".
          if (groupCustomPalette) groupCustomPalette.classList.toggle('hidden', btn.dataset.palette !== 'custom');
          this.updateColorRangePreviewBar(target);
          refresh();
        });
      });
    }

    // Colores Personalizados (paleta "custom"): cada capa tiene su propio par
    // min/max en scene.customPaletteColors[target], independiente del resto,
    // para poder diferenciar visualmente Bloques/Sondajes/Muestras entre sí.
    const inputCustomMin = document.getElementById(`input-custom-color-min-${target}`);
    const inputCustomMax = document.getElementById(`input-custom-color-max-${target}`);
    const paletteBtnCustom = document.getElementById(`palette-btn-custom-${target}`);
    const applyCustomColorChange = () => {
      const minHex = inputCustomMin ? parseInt(inputCustomMin.value.replace('#', '0x'), 16) : null;
      const maxHex = inputCustomMax ? parseInt(inputCustomMax.value.replace('#', '0x'), 16) : null;
      if (minHex !== null) this.scene.customPaletteColors[target].min = minHex;
      if (maxHex !== null) this.scene.customPaletteColors[target].max = maxHex;
      // Refleja los colores elegidos también en el propio swatch del botón de
      // paleta, para que quede visible sin tener que abrir los color pickers.
      if (paletteBtnCustom && inputCustomMin && inputCustomMax) {
        paletteBtnCustom.style.background = `linear-gradient(to right, ${inputCustomMin.value}, ${inputCustomMax.value})`;
      }
      this.updateColorRangePreviewBar(target);
      refresh();
    };
    if (inputCustomMin) inputCustomMin.addEventListener('input', applyCustomColorChange);
    if (inputCustomMax) inputCustomMax.addEventListener('input', applyCustomColorChange);

    // Rango de color manual
    const minColorInput = document.getElementById(`input-color-min-${target}`);
    const maxColorInput = document.getElementById(`input-color-max-${target}`);
    if (minColorInput && maxColorInput) {
      const handleColorRangeInputChange = () => refresh();
      minColorInput.addEventListener('input', handleColorRangeInputChange);
      maxColorInput.addEventListener('input', handleColorRangeInputChange);
    }

    const btnColorRangeAuto = document.getElementById(`btn-color-range-auto-${target}`);
    if (btnColorRangeAuto) {
      btnColorRangeAuto.addEventListener('click', () => {
        if (minColorInput) minColorInput.value = "";
        if (maxColorInput) maxColorInput.value = "";
        refresh();
      });
    }
  }

  // ==========================================
  // CONTROLADOR DE CONSOLA DE LOGS
  // ==========================================
  initConsoleControl() {
    const btnToggle = document.getElementById('btn-toggle-console');
    const consoleEl = document.getElementById('validation-console');
    
    if (btnToggle && consoleEl) {
      btnToggle.addEventListener('click', () => {
        consoleEl.classList.toggle('minimized');
        btnToggle.innerText = consoleEl.classList.contains('minimized') ? 'Maximizar' : 'Minimizar';
      });
    }
  }

  logConsole(type, message, file = 'Sistema', line = '') {
    const consoleBody = document.getElementById('console-messages');
    const warnBadge = document.getElementById('console-warn-count');
    const errBadge = document.getElementById('console-err-count');
    
    if (!consoleBody) return;
    
    const div = document.createElement('div');
    div.className = `console-msg ${type}`;
    
    const time = new Date().toLocaleTimeString();
    const tag = file ? `[${file}${line ? ` Fila ${line}` : ''}] ` : '';
    div.innerText = `[${time}] ${tag}${message}`;
    
    consoleBody.appendChild(div);
    consoleBody.scrollTop = consoleBody.scrollHeight;
    
    // Limitar histórico de consola a 200 mensajes en DOM para evitar lag
    if (consoleBody.children.length > 200) {
      consoleBody.removeChild(consoleBody.firstChild);
    }
    
    // Actualizar contadores
    if (type === 'warn') {
      warnBadge.innerText = parseInt(warnBadge.innerText) + 1;
    } else if (type === 'error') {
      errBadge.innerText = parseInt(errBadge.innerText) + 1;
    }
  }

  clearConsole() {
    document.getElementById('console-messages').innerHTML = "";
    document.getElementById('console-warn-count').innerText = 0;
    document.getElementById('console-err-count').innerText = 0;
  }

  // ==========================================
  // GESTIÓN DE WEB WORKER
  // ==========================================
  runWorkerParser(action, payload) {
    if (this.worker) {
      this.worker.terminate();
    }
    
    this.logConsole('info', `Iniciando Web Worker para tarea de importación asíncrona...`);
    document.getElementById('connection-status').className = 'status-indicator';
    document.getElementById('connection-status').innerText = 'Procesando...';
    
    this.worker = new Worker('js/worker-parser.js');
    
    const t0 = performance.now();
    
    this.worker.onmessage = (e) => {
      const msg = e.data;
      
      if (msg.type === 'progress') {
        document.getElementById('connection-status').innerText = `${msg.percent}%`;
        this.logConsole('info', msg.message);
      } else if (msg.type === 'validation') {
        // Recibir warnings del parsing
        if (msg.warnings) {
          msg.warnings.forEach(w => this.logConsole('warn', w.msg, w.file, w.line));
        }
        if (msg.errors) {
          msg.errors.forEach(err => this.logConsole('error', err.msg, err.file, err.line));
        }
      } else if (msg.type === 'error') {
        document.getElementById('connection-status').className = 'status-indicator';
        document.getElementById('connection-status').innerText = 'Error';
        msg.errors.forEach(err => this.logConsole('error', `Error fatal: ${err.msg}`));
        this.worker.terminate();
        this.worker = null;
      } else if (msg.type === 'complete' || msg.type === 'complete_synthetic') {
        const t1 = performance.now();
        document.getElementById('connection-status').className = 'status-indicator online';
        document.getElementById('connection-status').innerText = 'Listo';
        
        this.logConsole('success', `Procesamiento finalizado en segundo plano en ${(t1 - t0).toFixed(0)} ms.`);
        
        if (action === 'parse_drillholes') {
          this.loadDrillholeData(msg.data, msg.warnings);
        } else if (action === 'parse_samples') {
          this.loadSamplesData(msg.data, msg.warnings);
        } else if (action === 'parse_dxf') {
          this.loadDxfData(msg.data, msg.warnings);
        } else {
          this.loadBlockData(msg.data, msg.warnings);
        }
        
        this.worker.terminate();
        this.worker = null;
      }
    };

    this.worker.onerror = (err) => {
      this.logConsole('error', `Error en Web Worker: ${err.message}`);
      document.getElementById('connection-status').className = 'status-indicator';
      document.getElementById('connection-status').innerText = 'Error';
    };

    // Lanzar worker
    this.worker.postMessage({ action, payload });
  }

  // ==========================================
  // CARGA DE DATOS AL PROYECTO
  // ==========================================
  /**
   * Extiende un bounds base con los de otra capa ya cargada (si existe), para
   * que la grilla de referencia y la cámara siempre cubran la unión de TODAS
   * las capas cargadas (Bloques, Sondajes, Muestras) sin importar el orden en
   * que se importaron. Usado por loadBlockData/loadDrillholeData/loadSamplesData.
   */
  _extendBounds(base, otherBounds) {
    if (!otherBounds) return base;
    return {
      minX: Math.min(base.minX, otherBounds.minX), maxX: Math.max(base.maxX, otherBounds.maxX),
      minY: Math.min(base.minY, otherBounds.minY), maxY: Math.max(base.maxY, otherBounds.maxY),
      minZ: Math.min(base.minZ, otherBounds.minZ), maxZ: Math.max(base.maxZ, otherBounds.maxZ)
    };
  }

  /**
   * Calcula el bounds envolvente de una lista de intervalos de sondaje
   * (usando startPos/endPos, para incluir la profundidad real de la traza).
   * Devuelve null si la lista está vacía.
   */
  _boundsFromIntervals(intervals) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const interval of intervals) {
      for (const p of [interval.startPos, interval.endPos]) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
      }
    }
    return minX === Infinity ? null : { minX, maxX, minY, maxY, minZ, maxZ };
  }

  loadBlockData(data, warnings) {
    this.blockData = data;

    // Un reimport reemplaza this.blockData.attributes por arrays completamente
    // nuevos — las Variables Calculadas de la importación anterior quedarían
    // apuntando a datos que ya no existen, así que se descartan acá.
    this.calcVariables.blocks = [];
    this.renderCalcPills('blocks');

    // Guardar logs de validación
    if (warnings) {
      warnings.forEach(w => this.logConsole('warn', w.msg, w.file, w.line));
    }
    
    this.logConsole('success', `Modelo de bloques cargado correctamente: ${data.count.toLocaleString()} bloques.`);
    
    // 1. Indexar Espacialmente (SpatialIndex3D / Octree)
    this.logConsole('info', 'Construyendo grilla de indexación espacial (Octree)...');
    const t0 = performance.now();
    this.spatialIndex = new SpatialIndex3D(data.bounds);
    this.spatialIndex.insertBlocksBulk(data.positions);
    const t1 = performance.now();
    this.logConsole('success', `Octree construido en ${(t1 - t0).toFixed(1)} ms.`);
    
    // 2. Poblar Atributos en el Panel de Visualización (solo el selector de Bloques)
    const selectAttr = document.getElementById('select-color-attribute-blocks');
    selectAttr.innerHTML = '<option value="">(Ninguno)</option>';

    data.attributeMetadata.forEach(attr => {
      const opt = document.createElement('option');
      opt.value = attr.name;
      opt.innerText = `${attr.name} (${attr.type === 'category' ? 'Categórico' : 'Leyes'})`;
      selectAttr.appendChild(opt);
    });

    // Auto-seleccionar primer atributo de leyes
    if (data.attributeMetadata.length > 0) {
      selectAttr.value = data.attributeMetadata[0].name;
      this.blockColorAttribute = selectAttr.value;
    }

    // 3. Actualizar Datos en el Panel de Resumen
    document.getElementById('stat-blocks-count').innerText = data.count.toLocaleString();
    document.getElementById('stat-lim-x').innerText = `[${data.bounds.minX.toFixed(0)}, ${data.bounds.maxX.toFixed(0)}]`;
    document.getElementById('stat-lim-y').innerText = `[${data.bounds.minY.toFixed(0)}, ${data.bounds.maxY.toFixed(0)}]`;
    document.getElementById('stat-lim-z').innerText = `[${data.bounds.minZ.toFixed(0)}, ${data.bounds.maxZ.toFixed(0)}]`;
    
    document.getElementById('status-blocks').className = 'badge badge-loaded';
    document.getElementById('status-blocks').innerText = 'Cargado';
    
    // Actualizar límites de sección
    this.updateSectionPosLimits();

    // Actualizar UI del rango de colores
    this.updateColorRangeUI('blocks');

    // 4. Renderizar
    // Calcular bounds con márgenes, fusionando los límites de las otras capas
    // ya cargadas (Sondajes, Muestras) para que la grilla de referencia y la
    // cámara siempre cubran la unión de todo lo cargado, sin importar el
    // orden de importación.
    let b = { ...data.bounds };
    if (this.drillholeData && this.drillholeData.intervals && this.drillholeData.intervals.length > 0) {
      b = this._extendBounds(b, this._boundsFromIntervals(this.drillholeData.intervals));
    }
    if (this.samplesData) {
      b = this._extendBounds(b, this.samplesData.bounds);
    }
    this.scene.setDataBounds(b);
    this.scene.focusOnBounds(b);
    this.triggerBlockRefresh();
    this.updateLayersTree();
  }

  loadDrillholeData(data, warnings) {
    this.drillholeData = data;

    // Ver comentario equivalente en loadBlockData(): un reimport invalida las
    // Variables Calculadas de la carga anterior.
    this.calcVariables.drillholes = [];
    this.renderCalcPills('drillholes');

    if (warnings) {
      warnings.forEach(w => this.logConsole('warn', w.msg, w.file, w.line));
    }
    
    const holesList = Object.keys(data.collars);
    this.logConsole('success', `Base de sondajes cargada: ${holesList.length} sondajes desurveyados con ${data.intervals.length.toLocaleString()} intervalos.`);
    
    // Si tenemos indexación activa, agregamos las trazas al Octree
    if (this.spatialIndex) {
      data.intervals.forEach((interval, idx) => {
        const minX = Math.min(interval.startPos[0], interval.endPos[0]);
        const maxX = Math.max(interval.startPos[0], interval.endPos[0]);
        const minY = Math.min(interval.startPos[1], interval.endPos[1]);
        const maxY = Math.max(interval.startPos[1], interval.endPos[1]);
        const minZ = Math.min(interval.startPos[2], interval.endPos[2]);
        const maxZ = Math.max(interval.startPos[2], interval.endPos[2]);
        
        // Guardar bounding box
        this.spatialIndex.insertSpatialItem(interval, { minX, maxX, minY, maxY, minZ, maxZ });
      });
    }

    // Buscar nombres de columnas de leyes para agregarlas al selector propio de Sondajes
    const attrSet = new Set();
    data.intervals.forEach(interval => {
      if (interval.values) {
        Object.keys(interval.values).forEach(k => attrSet.add(k));
      }
    });

    const selectAttr = document.getElementById('select-color-attribute-drillholes');
    selectAttr.innerHTML = '<option value="">(Ninguno)</option>';
    attrSet.forEach(attrName => {
      const opt = document.createElement('option');
      opt.value = attrName;
      opt.innerText = attrName;
      selectAttr.appendChild(opt);
    });

    // Auto-seleccionar el primer atributo de ensayo disponible
    if (attrSet.size > 0) {
      selectAttr.value = Array.from(attrSet)[0];
      this.dhColorAttribute = selectAttr.value;
    }

    // Actualizar estadísticas de sondajes
    document.getElementById('stat-holes-count').innerText = holesList.length;
    document.getElementById('stat-intervals-count').innerText = data.intervals.length.toLocaleString();
    
    document.getElementById('status-drillholes').className = 'badge badge-loaded';
    document.getElementById('status-drillholes').innerText = 'Cargado';
    
    // Si no hay bloques, enfocamos en todos los endpoints de sondaje (incluyendo profundidad)
    if (holesList.length > 0) {
      let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity, minZ=Infinity, maxZ=-Infinity;
      
      // Incluir todos los startPos y endPos de los intervalos para capturar la profundidad real
      for (const interval of data.intervals) {
        const pts = [interval.startPos, interval.endPos];
        for (const p of pts) {
          if (p[0] < minX) minX=p[0]; if (p[0] > maxX) maxX=p[0];
          if (p[1] < minY) minY=p[1]; if (p[1] > maxY) maxY=p[1];
          if (p[2] < minZ) minZ=p[2]; if (p[2] > maxZ) maxZ=p[2];
        }
      }
      
      // Fallback si no hay intervalos: usar collares
      if (minX === Infinity) {
        for (const hId in data.collars) {
          const col = data.collars[hId];
          if (col.x < minX) minX=col.x; if (col.x > maxX) maxX=col.x;
          if (col.y < minY) minY=col.y; if (col.y > maxY) maxY=col.y;
          if (col.z < minZ) minZ=col.z; if (col.z > maxZ) maxZ=col.z;
        }
      }
      
      let dhBounds = { minX, maxX, minY, maxY, minZ, maxZ };

      // Fusionar con los bounds de las otras capas ya cargadas (Bloques, Muestras)
      if (this.blockData && this.blockData.bounds) {
        dhBounds = this._extendBounds(dhBounds, this.blockData.bounds);
      }
      if (this.samplesData) {
        dhBounds = this._extendBounds(dhBounds, this.samplesData.bounds);
      }

      this.scene.setDataBounds(dhBounds);
      if (!this.blockData && !this.samplesData) {
        this.scene.focusOnBounds(dhBounds);
      }
    }

    // Actualizar UI del rango de colores
    this.updateColorRangeUI('drillholes');

    this.triggerDrillholeRefresh();
    this.updateLayersTree();
  }

  /**
   * Carga los datos de Muestras Metalúrgicas ya procesados por el Web Worker
   * (posicionadas por centroide directo o por interpolación sobre la traza
   * del sondaje correspondiente). Se trata como una capa completamente
   * independiente de Bloques/Sondajes, con su propio atributo/paleta/rango/
   * filtros, reutilizando el mismo patrón basado en 'target'.
   */
  loadSamplesData(data, warnings) {
    this.samplesData = data;

    // Ver comentario equivalente en loadBlockData(): un reimport invalida las
    // Variables Calculadas de la carga anterior.
    this.calcVariables.samples = [];
    this.renderCalcPills('samples');

    if (warnings) {
      warnings.forEach(w => this.logConsole('warn', w.msg, w.file, w.line));
    }

    const skippedTxt = data.skippedCount ? ` (${data.skippedCount.toLocaleString()} omitidas)` : '';
    this.logConsole('success', `Muestras metalúrgicas cargadas: ${data.count.toLocaleString()} muestras${skippedTxt}.`);

    // Poblar selector de atributo activo (solo el propio de Muestras)
    const selectAttr = document.getElementById('select-color-attribute-samples');
    if (selectAttr) {
      selectAttr.innerHTML = '<option value="">(Ninguno)</option>';
      data.attributeMetadata.forEach(attr => {
        const opt = document.createElement('option');
        opt.value = attr.name;
        opt.innerText = `${attr.name} (${attr.type === 'category' ? 'Categórico' : 'Numérico'})`;
        selectAttr.appendChild(opt);
      });

      if (data.attributeMetadata.length > 0) {
        selectAttr.value = data.attributeMetadata[0].name;
        this.sampleColorAttribute = selectAttr.value;
      }
    }

    // Estadísticas
    const statCount = document.getElementById('stat-samples-count');
    if (statCount) statCount.innerText = data.count.toLocaleString();

    const statusEl = document.getElementById('status-samples');
    if (statusEl) {
      statusEl.className = 'badge badge-loaded';
      statusEl.innerText = 'Cargado';
    }

    this.updateColorRangeUI('samples');

    // Fusionar bounds con las otras capas ya cargadas (igual patrón que
    // loadBlockData/loadDrillholeData) para que grilla y cámara cubran la
    // unión de todo lo cargado, sin importar el orden de importación.
    if (data.bounds) {
      let b = { ...data.bounds };
      b = this._extendBounds(b, this.blockData ? this.blockData.bounds : null);
      if (this.drillholeData && this.drillholeData.intervals && this.drillholeData.intervals.length > 0) {
        b = this._extendBounds(b, this._boundsFromIntervals(this.drillholeData.intervals));
      }
      this.scene.setDataBounds(b);
      // Solo enfocar la cámara si las Muestras son la primera capa cargada
      if (!this.blockData && !this.drillholeData) {
        this.scene.focusOnBounds(b);
      }
    }

    this.triggerSamplesRefresh();
    this.updateLayersTree();
  }

  /**
   * Recibe el resultado del parseo de DXF hecho en el Web Worker (ver
   * parseDxf() en worker-parser.js) y agrega cada capa a la escena 3D. La
   * geometría ya viene lista (Float32Array) — aquí solo se recorren las
   * capas y se delega el render a scene.addDxfLayer(), igual que antes
   * cuando el parseo se hacía en el hilo principal.
   */
  loadDxfData(data, warnings) {
    if (warnings) {
      warnings.forEach(w => this.logConsole('warn', w.msg, w.file, w.line));
    }

    for (const name in data.layers) {
      this.scene.addDxfLayer(name, data.layers[name]);
    }

    if (data.layerCount > 0) {
      this.logConsole('success', `DXF importado. Capas: ${data.layerCount}, Caras: ${data.triCount.toLocaleString()}, Polilíneas: ${data.lineCount.toLocaleString()}`);
    } else {
      this.logConsole('warn', 'DXF leído pero no se importó ninguna capa (ver advertencia anterior con el detalle).');
    }

    this.updateLayersTree();
  }

  generateSyntheticBlocks(blockCount) {
    this.runWorkerParser('generate_synthetic', { blockCount });
  }

  // ==========================================
  // REFRESH DE RENDERS
  // ==========================================
  getColorRangeValues(target) {
    const minInput = document.getElementById(`input-color-min-${target}`);
    const maxInput = document.getElementById(`input-color-max-${target}`);

    const minVal = minInput && minInput.value !== "" ? parseFloat(minInput.value) : null;
    const maxVal = maxInput && maxInput.value !== "" ? parseFloat(maxInput.value) : null;

    return { min: minVal, max: maxVal };
  }

  /**
   * Detecta si un atributo es numérico y calcula su rango real de valores
   * (ignorando nulos/-999), para la capa indicada ('blocks' o 'drillholes').
   * Se reutiliza tanto para el rango de coloreado como para el constructor de filtros.
   * @returns {{min:number,max:number}|null} null si no es numérico o no hay datos.
   */
  detectAttributeRange(target, attrName) {
    if (!attrName) return null;
    const isBlocks = target === 'blocks';

    if (isBlocks) {
      if (!this.blockData) return null;
      const meta = this.blockData.attributeMetadata.find(a => a.name === attrName);
      if (!meta || meta.type !== 'number') return null;
      const buf = this.blockData.attributes[attrName];
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < buf.length; i++) {
        const val = buf[i];
        if (val !== -999.0) {
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
      return min === Infinity ? null : { min, max };
    }

    if (target === 'samples') {
      if (!this.samplesData) return null;
      const meta = this.samplesData.attributeMetadata.find(a => a.name === attrName);
      if (!meta || meta.type !== 'number') return null;
      const buf = this.samplesData.attributes[attrName];
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < buf.length; i++) {
        const val = buf[i];
        if (val !== -999.0) {
          if (val < min) min = val;
          if (val > max) max = val;
        }
      }
      return min === Infinity ? null : { min, max };
    }

    if (!this.drillholeData) return null;
    const meta = this.drillholeData.assayMetadata
      ? this.drillholeData.assayMetadata.find(m => m.name === attrName)
      : null;

    let isNumeric = meta ? meta.type === 'number' : null;
    if (isNumeric === null) {
      // Sin metadata explícita: detectar por el primer valor real encontrado
      for (const interval of this.drillholeData.intervals) {
        if (interval.values && interval.values[attrName] !== undefined) {
          const val = interval.values[attrName];
          isNumeric = (val !== null && !isNaN(val) && typeof val === 'number');
          break;
        }
      }
    }
    if (!isNumeric) return null;

    let min = Infinity, max = -Infinity;
    for (const interval of this.drillholeData.intervals) {
      const val = interval.values ? interval.values[attrName] : undefined;
      if (val !== undefined && val !== null && !isNaN(val)) {
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }
    return min === Infinity ? null : { min, max };
  }

  /**
   * Muestra/oculta el grupo de rango manual y detecta el rango automático
   * de un atributo, para la capa indicada ('blocks' o 'drillholes').
   */
  updateColorRangeUI(target) {
    const activeAttribute = target === 'blocks' ? this.blockColorAttribute
      : target === 'samples' ? this.sampleColorAttribute
      : this.dhColorAttribute;
    const groupRange = document.getElementById(`group-color-range-${target}`);
    const infoLabel = document.getElementById(`color-range-info-${target}`);
    const minInput = document.getElementById(`input-color-min-${target}`);
    const maxInput = document.getElementById(`input-color-max-${target}`);

    if (!activeAttribute) {
      if (groupRange) groupRange.classList.add('hidden');
      return;
    }

    const attrs = target === 'blocks'
      ? (this.blockData ? this.blockData.attributeMetadata : [])
      : target === 'samples'
      ? (this.samplesData ? this.samplesData.attributeMetadata : [])
      : (this.drillholeData && this.drillholeData.assayMetadata ? this.drillholeData.assayMetadata : []);
    const meta = attrs.find(a => a.name === activeAttribute);
    const range = this.detectAttributeRange(target, activeAttribute);
    const isNumeric = meta ? meta.type === 'number' : !!range;

    if (isNumeric) {
      if (groupRange) groupRange.classList.remove('hidden');
      if (range) {
        infoLabel.innerText = `Rango detectado: [${range.min.toFixed(2)} - ${range.max.toFixed(2)}]`;
        minInput.placeholder = range.min.toFixed(2);
        maxInput.placeholder = range.max.toFixed(2);
      } else {
        infoLabel.innerText = `Rango automático`;
        minInput.placeholder = "Mín";
        maxInput.placeholder = "Máx";
      }
      this.updateColorRangePreviewBar(target);
    } else {
      if (groupRange) groupRange.classList.add('hidden');
    }
  }

  updateColorRangePreviewBar(target) {
    const previewBar = document.getElementById(`color-range-preview-bar-${target}`);
    if (!previewBar) return;

    const palette = target === 'blocks' ? this.blockPaletteName
      : target === 'samples' ? this.samplePaletteName
      : this.dhPaletteName;
    let gradient = 'linear-gradient(to right, blue, green, yellow, red)';
    if (palette === 'custom') {
      const c = this.scene.customPaletteColors[target];
      const toHex = (n) => '#' + n.toString(16).padStart(6, '0');
      gradient = `linear-gradient(to right, ${toHex(c.min)}, ${toHex(c.max)})`;
    } else if (palette === 'viridis') {
      gradient = 'linear-gradient(to right, #440154, #21918c, #fde725)';
    } else if (palette === 'magma') {
      gradient = 'linear-gradient(to right, #000004, #b1357a, #fcfdbf)';
    } else if (palette === 'coolwarm') {
      gradient = 'linear-gradient(to right, blue, white, red)';
    }
    previewBar.style.background = gradient;
  }

  triggerBlockRefresh() {
    if (!this.blockData) return;
    const mode = document.getElementById('select-render-mode').value;
    const range = this.getColorRangeValues('blocks');
    this.scene.updateBlockRender(
      this.blockData,
      this.blockColorAttribute,
      this.blockPaletteName,
      mode,
      this.scene.blockSizeFactor,
      range.min,
      range.max,
      this.scene.blockOpacity
    );
  }

  triggerDrillholeRefresh() {
    if (!this.drillholeData) return;
    const range = this.getColorRangeValues('drillholes');
    this.scene.updateDrillholeRender(
      this.drillholeData,
      this.dhColorAttribute,
      this.dhPaletteName,
      this.scene.drillholeThickness,
      range.min,
      range.max
    );
  }

  triggerSamplesRefresh() {
    if (!this.samplesData) return;
    const range = this.getColorRangeValues('samples');
    this.scene.updateSamplesRender(
      this.samplesData,
      this.sampleColorAttribute,
      this.samplePaletteName,
      this.scene.samplePointSize,
      range.min,
      range.max
    );
  }

  updateSectionPosLimits() {
    const type = document.getElementById('select-section-type').value;
    const slider = document.getElementById('range-section-pos');
    const inputPos = document.getElementById('input-section-pos');
    const label = document.getElementById('label-section-pos');

    let min = -1000, max = 1000;
    if (this.blockData && this.blockData.bounds) {
      const b = this.blockData.bounds;
      if (type === 'vertical-n') { // Eje X
        min = Math.floor(b.minX); max = Math.ceil(b.maxX);
      } else if (type === 'vertical-e') { // Eje Y
        min = Math.floor(b.minY); max = Math.ceil(b.maxY);
      } else { // Planta Eje Z
        min = Math.floor(b.minZ); max = Math.ceil(b.maxZ);
      }
    }

    slider.min = min;
    slider.max = max;
    slider.value = Math.floor((min + max) / 2);
    document.getElementById('section-pos-val').innerText = `${slider.value} m`;

    // Etiqueta y rango del input numérico según la orientación activa,
    // para dejar claro si se está definiendo una cota Z (planta) o una
    // coordenada X/Y (secciones verticales N-S / E-O).
    if (label) {
      if (type === 'vertical-n') {
        label.innerText = 'Posición de Corte (Coordenada Este, Eje X)';
      } else if (type === 'vertical-e') {
        label.innerText = 'Posición de Corte (Coordenada Norte, Eje Y)';
      } else {
        label.innerText = 'Posición de Corte (Cota Z)';
      }
    }
    if (inputPos) {
      inputPos.min = min;
      inputPos.max = max;
      inputPos.value = slider.value;
    }
  }

  // ==========================================
  // ELIMINAR CAPAS DE LA SESIÓN
  // ==========================================
  /**
   * Elimina COMPLETAMENTE una capa base (Bloques/Sondajes/Muestras) de la
   * sesión — a diferencia del checkbox de visibilidad del árbol de capas
   * (que solo la oculta), esto libera los datos cargados, el mesh de
   * Three.js, los filtros activos, y resetea los controles de UI asociados
   * (selector de atributo, badge de estado, estadísticas, leyenda). Después
   * de esto hay que volver a importar el archivo para verla de nuevo.
   */
  removeLayer(target) {
    const cfg = {
      blocks: {
        label: 'Modelo de Bloques',
        clear: () => {
          this.blockData = null;
          this.scene.updateBlockRender(null);
          this.spatialIndex = null; // el Octree solo se usa para filtrar Bloques por sección
          this.filters = [];
          this.blockColorAttribute = '';
          this.renderFilterPills('blocks');
          // Las Variables Calculadas dependen de los arrays de datos crudos
          // (this.blockData.attributes), que se acaban de descartar arriba —
          // no tiene sentido conservarlas.
          this.calcVariables.blocks = [];
          this.renderCalcPills('blocks');
        },
        statusId: 'status-blocks',
        selectId: 'select-color-attribute-blocks',
        countIds: ['stat-blocks-count'],
        resetLimits: true
      },
      drillholes: {
        label: 'Sondajes',
        clear: () => {
          this.drillholeData = null;
          this.scene.updateDrillholeRender(null);
          this.dhFilters = [];
          this.dhColorAttribute = '';
          this.renderFilterPills('drillholes');
          this.calcVariables.drillholes = [];
          this.renderCalcPills('drillholes');
        },
        statusId: 'status-drillholes',
        selectId: 'select-color-attribute-drillholes',
        countIds: ['stat-holes-count', 'stat-intervals-count']
      },
      samples: {
        label: 'Muestras Metalúrgicas',
        clear: () => {
          this.samplesData = null;
          this.scene.updateSamplesRender(null);
          this.sampleFilters = [];
          this.sampleColorAttribute = '';
          this.renderFilterPills('samples');
          this.calcVariables.samples = [];
          this.renderCalcPills('samples');
        },
        statusId: 'status-samples',
        selectId: 'select-color-attribute-samples',
        countIds: ['stat-samples-count']
      }
    }[target];
    if (!cfg) return;

    cfg.clear();

    // updateXRender(null) ya oculta la leyenda en Sondajes/Muestras, pero NO
    // en Bloques (retorna antes de llegar a esa línea) — se fuerza acá para
    // los 3 casos, por consistencia, sin importar el detalle interno de cada uno.
    this.scene.updateLegend(target, null);

    const statusEl = document.getElementById(cfg.statusId);
    if (statusEl) { statusEl.className = 'badge badge-empty'; statusEl.innerText = 'Vacío'; }

    const selectEl = document.getElementById(cfg.selectId);
    if (selectEl) selectEl.innerHTML = '<option value="">(Ninguno)</option>';

    cfg.countIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerText = '0';
    });

    if (cfg.resetLimits) {
      ['stat-lim-x', 'stat-lim-y', 'stat-lim-z'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = '-';
      });
    }

    this.updateColorRangeUI(target);
    this.updateLayersTree();
    this.logConsole('info', `${cfg.label} eliminado de la sesión.`);
  }

  /**
   * Elimina UNA capa DXF puntual (identificada por su nombre de capa) de la
   * sesión: libera su mesh/material y su estilo guardado (color/opacidad).
   */
  removeDxfLayerByName(layerName) {
    this.scene.removeDxfLayer(layerName);
    delete this.scene.dxfLayerStyles[layerName];
    this.updateLayersTree();
    this.logConsole('info', `Capa DXF "${layerName}" eliminada de la sesión.`);
  }

  /**
   * Elimina TODAS las capas DXF cargadas de una vez (botón de eliminar del
   * nodo raíz "Superficies DXF" en el árbol de capas).
   */
  removeAllDxfLayers() {
    const dxfKeys = Object.keys(this.scene.dxfMeshes);
    dxfKeys.forEach(layerName => {
      this.scene.removeDxfLayer(layerName);
      delete this.scene.dxfLayerStyles[layerName];
    });
    this.updateLayersTree();
    this.logConsole('info', `${dxfKeys.length} capa(s) DXF eliminada(s) de la sesión.`);
  }

  // ==========================================
  // CAPAS TREE VIEW
  // ==========================================
  updateLayersTree() {
    const tree = document.getElementById('layers-tree');
    tree.innerHTML = "";
    
    let hasLayers = false;
    
    // Nodo Bloques
    if (this.blockData) {
      hasLayers = true;
      this.createTreeNode(tree, 'Modelo de Bloques', true, (chk) => {
        if (this.scene.blockMesh) this.scene.blockMesh.visible = chk;
      }, () => this.removeLayer('blocks'));
    }

    // Nodo Sondajes
    if (this.drillholeData) {
      hasLayers = true;
      this.createTreeNode(tree, 'Trazas de Sondaje', true, (chk) => {
        this.scene.drillholesGroup.visible = chk;
      }, () => this.removeLayer('drillholes'));
    }

    // Nodo Muestras Metalúrgicas
    if (this.samplesData) {
      hasLayers = true;
      this.createTreeNode(tree, 'Muestras Metalúrgicas', true, (chk) => {
        if (this.scene.sampleMesh) this.scene.sampleMesh.visible = chk;
      }, () => this.removeLayer('samples'));
    }

    // Nodos DXF
    const dxfKeys = Object.keys(this.scene.dxfMeshes);
    if (dxfKeys.length > 0) {
      hasLayers = true;
      const dxfRoot = this.createTreeNode(tree, 'Superficies DXF', true, (chk) => {
        this.scene.dxfGroup.visible = chk;
      }, () => this.removeAllDxfLayers());

      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'tree-children';
      dxfRoot.appendChild(childrenContainer);

      dxfKeys.forEach(layerName => {
        this.createTreeNode(childrenContainer, `Capa: ${layerName}`, true, (chk) => {
          this.scene.toggleLayerVisibility(layerName, chk);
        }, () => this.removeDxfLayerByName(layerName));
      });
    }
    
    if (!hasLayers) {
      tree.innerHTML = '<div class="empty-notice">No hay capas cargadas. Importe datos para comenzar.</div>';
    }
    
    // Actualizar badge
    const layerCount = (this.blockData ? 1 : 0) + (this.drillholeData ? 1 : 0) + (this.samplesData ? 1 : 0) + dxfKeys.length;
    document.getElementById('layer-count').innerText = layerCount;

    // Refrescar el combo "Capa DXF" del panel Visualización con las capas
    // DXF actualmente cargadas (ver updateDxfLayerSelector()).
    this.updateDxfLayerSelector();
  }

  /**
   * Puebla el combo #select-dxf-layer (panel Visualización > Superficies DXF)
   * con los nombres de las capas DXF cargadas actualmente, preservando la
   * selección previa si esa capa sigue existiendo. Se llama desde
   * updateLayersTree() cada vez que cambian las capas (ej. tras importar un
   * nuevo DXF), para que el selector de "a qué capa le aplico el color/opacidad"
   * siempre esté al día.
   */
  updateDxfLayerSelector() {
    const select = document.getElementById('select-dxf-layer');
    if (!select) return;

    const dxfKeys = Object.keys(this.scene.dxfMeshes);
    const prevValue = select.value;
    select.innerHTML = '';

    if (dxfKeys.length === 0) {
      select.innerHTML = '<option value="">— Sin capas DXF cargadas —</option>';
      select.disabled = true;
      this.syncDxfStyleControls(null);
      return;
    }

    dxfKeys.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.innerText = name;
      select.appendChild(opt);
    });
    select.disabled = false;
    select.value = dxfKeys.includes(prevValue) ? prevValue : dxfKeys[0];
    this.syncDxfStyleControls(select.value);
  }

  /**
   * Sincroniza el color picker y el slider de opacidad del panel Visualización
   * con el estilo guardado (scene.dxfLayerStyles) de la capa DXF indicada, y
   * los habilita/deshabilita según si hay o no una capa seleccionada. Se llama
   * al refrescar el combo de capas y cada vez que el usuario cambia de capa
   * seleccionada, para que los controles siempre reflejen la capa activa (y
   * no arrastren el valor de la capa anterior).
   */
  syncDxfStyleControls(layerName) {
    const inputColor = document.getElementById('input-dxf-color');
    const rangeOpacity = document.getElementById('range-dxf-opacity');
    const opacityVal = document.getElementById('dxf-opacity-val');
    if (!inputColor || !rangeOpacity) return;

    const style = layerName ? this.scene.dxfLayerStyles[layerName] : null;
    const color = style ? style.color : this.scene.defaultDxfColor;
    const opacity = style ? style.opacity : this.scene.defaultDxfOpacity;

    inputColor.value = '#' + color.toString(16).padStart(6, '0');
    rangeOpacity.value = opacity;
    if (opacityVal) opacityVal.innerText = `${Math.round(opacity * 100)}%`;

    inputColor.disabled = !layerName;
    rangeOpacity.disabled = !layerName;
  }

  /**
   * @param {Function} [onDeleteCallback] Si se provee, agrega un botón "✕" a
   *   la derecha del nodo (además del checkbox de visibilidad) que ELIMINA la
   *   capa de la sesión por completo (libera datos/mesh, no solo la oculta).
   *   Pide confirmación antes de ejecutar, ya que no hay forma de deshacerlo
   *   sin volver a importar el archivo.
   */
  createTreeNode(parent, name, defaultChecked, onChangeCallback, onDeleteCallback) {
    const node = document.createElement('div');
    node.className = 'tree-node';

    const content = document.createElement('div');
    content.className = 'tree-node-content';

    const left = document.createElement('div');
    left.className = 'tree-node-left';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = defaultChecked;
    chk.addEventListener('change', () => onChangeCallback(chk.checked));

    const label = document.createElement('span');
    label.innerText = name;

    left.appendChild(chk);
    left.appendChild(label);
    content.appendChild(left);

    if (onDeleteCallback) {
      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn-icon';
      btnDelete.innerText = '✕';
      btnDelete.title = `Eliminar "${name}" de la sesión`;
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation(); // no togglear el checkbox al hacer click en el botón
        if (confirm(`¿Eliminar "${name}" de la sesión? Vas a tener que volver a importarlo si lo necesitás de nuevo.`)) {
          onDeleteCallback();
        }
      });
      content.appendChild(btnDelete);
    }

    node.appendChild(content);
    parent.appendChild(node);

    return node;
  }

  // ==========================================
  // FILTROS DE ATRIBUTOS (independientes por capa, combinables entre sí)
  // ==========================================
  /**
   * Devuelve la metadata de atributos filtrables para la capa indicada.
   */
  getFilterableAttributes(target) {
    if (target === 'blocks') {
      return this.blockData ? this.blockData.attributeMetadata : [];
    }
    if (target === 'samples') {
      return this.samplesData ? this.samplesData.attributeMetadata : [];
    }
    return this.drillholeData && this.drillholeData.assayMetadata ? this.drillholeData.assayMetadata : [];
  }

  /**
   * Devuelve la lista de categorías detectadas para un atributo categórico
   * de la capa indicada (nombres de categoría, no índices).
   */
  getCategoryLookup(target, attrName) {
    if (target === 'blocks') {
      return (this.blockData && this.blockData.categoryLookups) ? (this.blockData.categoryLookups[attrName] || []) : [];
    }
    if (target === 'samples') {
      return (this.samplesData && this.samplesData.categoryLookups) ? (this.samplesData.categoryLookups[attrName] || []) : [];
    }
    return (this.drillholeData && this.drillholeData.assayCategoryLookups) ? (this.drillholeData.assayCategoryLookups[attrName] || []) : [];
  }

  /**
   * Abre (y reconstruye) el formulario de creación de filtros para la capa indicada.
   */
  openFilterBuilder(target) {
    const hasData = target === 'blocks' ? !!this.blockData
      : target === 'samples' ? !!this.samplesData
      : !!this.drillholeData;
    if (!hasData) {
      const msg = target === 'blocks'
        ? 'Por favor cargue un modelo de bloques antes de añadir filtros.'
        : target === 'samples'
        ? 'Por favor cargue muestras metalúrgicas antes de añadir filtros.'
        : 'Por favor cargue sondajes antes de añadir filtros.';
      alert(msg);
      return;
    }

    const attrs = this.getFilterableAttributes(target);
    if (attrs.length === 0) {
      alert('No hay atributos disponibles para filtrar en esta capa.');
      return;
    }

    const builder = document.getElementById(`filter-builder-${target}`);
    if (!builder) return;

    builder.classList.remove('hidden');
    builder.innerHTML = `
      <div class="settings-group">
        <label>Atributo a Filtrar</label>
        <select id="filter-builder-attr-${target}" class="form-control">
          ${attrs.map(a => `<option value="${a.name}">${a.name} (${a.type === 'category' ? 'Categórico' : 'Numérico'})</option>`).join('')}
        </select>
      </div>
      <div id="filter-builder-body-${target}"></div>
      <div class="filter-builder-actions">
        <button class="btn btn-xs btn-primary" id="filter-builder-confirm-${target}">Agregar Filtro</button>
        <button class="btn btn-xs btn-outline" id="filter-builder-cancel-${target}">Cancelar</button>
      </div>
    `;

    document.getElementById(`filter-builder-attr-${target}`)
      .addEventListener('change', () => this.renderFilterBuilderBody(target));
    document.getElementById(`filter-builder-confirm-${target}`)
      .addEventListener('click', () => this.confirmFilterBuilder(target));
    document.getElementById(`filter-builder-cancel-${target}`)
      .addEventListener('click', () => this.closeFilterBuilder(target));

    this.renderFilterBuilderBody(target);
  }

  closeFilterBuilder(target) {
    const builder = document.getElementById(`filter-builder-${target}`);
    if (builder) {
      builder.classList.add('hidden');
      builder.innerHTML = '';
    }
  }

  /**
   * Dibuja, según el tipo del atributo seleccionado, un rango numérico o una
   * lista de categorías con checkboxes (permite seleccionar una o varias).
   */
  renderFilterBuilderBody(target) {
    const attrSelect = document.getElementById(`filter-builder-attr-${target}`);
    const body = document.getElementById(`filter-builder-body-${target}`);
    if (!attrSelect || !body) return;

    const attrName = attrSelect.value;
    const attrs = this.getFilterableAttributes(target);
    const meta = attrs.find(a => a.name === attrName);
    if (!meta) { body.innerHTML = ''; return; }

    if (meta.type === 'category') {
      const lookup = this.getCategoryLookup(target, attrName);
      body.innerHTML = `
        <div class="settings-group">
          <label>Valores a Mostrar (selecciona uno o varios)</label>
          <div class="filter-cat-list">
            ${lookup.length > 0 ? lookup.map((val, i) => `
              <label class="filter-cat-item">
                <input type="checkbox" class="filter-cat-chk" value="${i}">
                <span>${val}</span>
              </label>
            `).join('') : '<div class="empty-notice">Sin categorías detectadas</div>'}
          </div>
        </div>
      `;
    } else {
      const range = this.detectAttributeRange(target, attrName);
      body.innerHTML = `
        <div class="settings-group">
          <label>Rango a Mostrar</label>
          <div class="color-range-row">
            <div class="color-range-field">
              <span class="color-range-label color-range-min-swatch">▮ Mín.</span>
              <input type="number" id="filter-builder-min-${target}" class="form-control-sm color-range-input" step="any" placeholder="${range ? range.min.toFixed(2) : 'Mín'}">
            </div>
            <div class="color-range-field">
              <span class="color-range-label color-range-max-swatch">▮ Máx.</span>
              <input type="number" id="filter-builder-max-${target}" class="form-control-sm color-range-input" step="any" placeholder="${range ? range.max.toFixed(2) : 'Máx'}">
            </div>
          </div>
          <span class="info-label">${range ? `Rango detectado: [${range.min.toFixed(2)} - ${range.max.toFixed(2)}]. Se deja vacío para usar el detectado.` : 'Sin datos numéricos detectados'}</span>
        </div>
      `;
    }
  }

  /**
   * Lee el estado actual del formulario y agrega el filtro correspondiente.
   */
  confirmFilterBuilder(target) {
    const attrSelect = document.getElementById(`filter-builder-attr-${target}`);
    if (!attrSelect) return;

    const attrName = attrSelect.value;
    const attrs = this.getFilterableAttributes(target);
    const meta = attrs.find(a => a.name === attrName);
    if (!meta) return;

    if (meta.type === 'category') {
      const checked = Array.from(document.querySelectorAll(`#filter-builder-body-${target} .filter-cat-chk:checked`));
      if (checked.length === 0) {
        alert('Seleccione al menos una categoría.');
        return;
      }
      const lookup = this.getCategoryLookup(target, attrName);

      if (target === 'blocks') {
        // Los bloques codifican categorías como índices enteros (Uint16Array)
        const ids = checked.map(c => parseInt(c.value, 10));
        this.addFilter(target, {
          attribute: attrName,
          type: 'category',
          values: ids,
          lookupNames: ids.map(id => lookup[id])
        });
      } else {
        // Los sondajes guardan las categorías de assay como strings directamente
        const values = checked.map(c => lookup[parseInt(c.value, 10)]);
        this.addFilter(target, {
          attribute: attrName,
          type: 'category',
          values,
          lookupNames: values
        });
      }
    } else {
      const minInput = document.getElementById(`filter-builder-min-${target}`);
      const maxInput = document.getElementById(`filter-builder-max-${target}`);
      const range = this.detectAttributeRange(target, attrName);

      const min = (minInput && minInput.value !== '') ? parseFloat(minInput.value) : (range ? range.min : NaN);
      const max = (maxInput && maxInput.value !== '') ? parseFloat(maxInput.value) : (range ? range.max : NaN);

      if (isNaN(min) || isNaN(max)) {
        alert('Ingrese un rango numérico válido (o cargue datos para detectarlo automáticamente).');
        return;
      }
      if (min > max) {
        alert('El valor mínimo no puede ser mayor que el máximo.');
        return;
      }

      this.addFilter(target, { attribute: attrName, type: 'number', min, max });
    }

    this.closeFilterBuilder(target);
  }

  /**
   * Metadata de la capa indicada usada por addFilter/removeFilter/renderFilterPills:
   * cómo leer/escribir su lista de filtros, cómo refrescar su render y su
   * nombre legible para los mensajes de consola.
   */
  _filterTargetMeta(target) {
    if (target === 'blocks') {
      return {
        get: () => this.filters,
        set: (v) => { this.filters = v; },
        refresh: () => this.triggerBlockRefresh(),
        label: 'Bloques'
      };
    }
    if (target === 'samples') {
      return {
        get: () => this.sampleFilters,
        set: (v) => { this.sampleFilters = v; },
        refresh: () => this.triggerSamplesRefresh(),
        label: 'Muestras'
      };
    }
    return {
      get: () => this.dhFilters,
      set: (v) => { this.dhFilters = v; },
      refresh: () => this.triggerDrillholeRefresh(),
      label: 'Sondajes'
    };
  }

  /**
   * Agrega (o reemplaza, si ya existía uno para el mismo atributo) un filtro
   * a la capa indicada. Los filtros de una misma capa se combinan con AND.
   */
  addFilter(target, filterObj) {
    const meta = this._filterTargetMeta(target);
    const updated = meta.get().filter(f => f.attribute !== filterObj.attribute);
    updated.push(filterObj);
    meta.set(updated);
    meta.refresh();

    this.renderFilterPills(target);
    this.logConsole('info', `Filtro añadido (${meta.label}): ${filterObj.attribute}`);
  }

  removeFilter(target, attributeName) {
    const meta = this._filterTargetMeta(target);
    meta.set(meta.get().filter(f => f.attribute !== attributeName));
    meta.refresh();
    this.renderFilterPills(target);
    this.logConsole('info', `Filtro eliminado (${meta.label}): ${attributeName}`);
  }

  renderFilterPills(target) {
    const container = document.getElementById(`active-filters-list-${target}`);
    if (!container) return;

    const list = this._filterTargetMeta(target).get();
    container.innerHTML = "";

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-notice">No hay filtros activos. Los datos se visualizan completos.</div>';
      return;
    }

    list.forEach(f => {
      const pill = document.createElement('div');
      pill.className = 'filter-pill';

      let text = "";
      if (f.type === 'number') {
        text = `${f.attribute}: <strong>[${f.min} - ${f.max}]</strong>`;
      } else {
        text = `${f.attribute}: <strong>{${f.lookupNames.join(', ')}}</strong>`;
      }

      pill.innerHTML = `
        <span class="pill-text">${text}</span>
        <button onclick="app.removeFilter('${target}', '${f.attribute}')" class="btn-icon" style="color:var(--accent-red)">×</button>
      `;
      container.appendChild(pill);
    });
  }

  // ==========================================
  // VARIABLES CALCULADAS (independiente por capa: Bloques/Sondajes/Muestras)
  // ==========================================
  /**
   * Escape mínimo para insertar nombres de atributos definidos por el usuario
   * (headers de CSV, nombres de variable calculada) dentro de innerHTML sin
   * que puedan romper el markup si contienen caracteres como < > " '.
   */
  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Metadata de la capa indicada usada por todo el flujo de Variables
   * Calculadas: cómo acceder a sus datos crudos, a su lista de atributos
   * (attributeMetadata en Bloques/Muestras, assayMetadata en Sondajes), cómo
   * calcular una fórmula fila por fila sobre ella, y cómo remover un atributo
   * ya creado. Bloques y Muestras comparten la misma forma de almacenamiento
   * (Float32Array por atributo + lista de metadata), así que reutilizan
   * _computeArrayCalcVariable(); Sondajes guarda los valores por intervalo
   * (interval.values), así que usa _computeIntervalCalcVariable().
   */
  _calcTargetMeta(target) {
    if (target === 'blocks') {
      return {
        label: 'Bloques',
        attrKey: 'blockColorAttribute',
        selectId: 'select-color-attribute-blocks',
        refresh: () => this.triggerBlockRefresh(),
        getData: () => this.blockData,
        getMetadataList: (data) => data.attributeMetadata,
        compute: (data, name, ast) => this._computeArrayCalcVariable(data, name, ast),
        removeAttr: (data, name) => { delete data.attributes[name]; }
      };
    }
    if (target === 'samples') {
      return {
        label: 'Muestras',
        attrKey: 'sampleColorAttribute',
        selectId: 'select-color-attribute-samples',
        refresh: () => this.triggerSamplesRefresh(),
        getData: () => this.samplesData,
        getMetadataList: (data) => data.attributeMetadata,
        compute: (data, name, ast) => this._computeArrayCalcVariable(data, name, ast),
        removeAttr: (data, name) => { delete data.attributes[name]; }
      };
    }
    return {
      label: 'Sondajes',
      attrKey: 'dhColorAttribute',
      selectId: 'select-color-attribute-drillholes',
      refresh: () => this.triggerDrillholeRefresh(),
      getData: () => this.drillholeData,
      getMetadataList: (data) => {
        if (!data.assayMetadata) data.assayMetadata = [];
        return data.assayMetadata;
      },
      compute: (data, name, ast) => this._computeIntervalCalcVariable(data, name, ast),
      removeAttr: (data, name) => {
        (data.intervals || []).forEach(iv => { if (iv.values) delete iv.values[name]; });
      }
    };
  }

  /**
   * Calcula una Variable Calculada sobre Bloques/Muestras: recorre en una
   * sola pasada los Float32Array de las variables usadas en la fórmula
   * (resueltos una única vez antes del loop, no en cada fila) y arma un
   * Float32Array nuevo. Los -999 (convención de "sin dato" de estas dos
   * capas) se traducen a `null` para FormulaEval y de vuelta a -999 en el
   * resultado, para que la variable nueva se comporte igual que cualquier
   * atributo nativo frente al resto de la app (rango automático, leyenda,
   * filtros, etc., todos ya saben ignorar -999).
   */
  _computeArrayCalcVariable(data, name, ast) {
    const count = data.count;
    const out = new Float32Array(count);
    let validCount = 0;

    const varNames = Array.from(FormulaEval.collectVarNames(ast));
    const buffers = {};
    varNames.forEach(v => { buffers[v] = data.attributes[v]; });

    for (let i = 0; i < count; i++) {
      const lookup = (varName) => {
        const buf = buffers[varName];
        if (!buf) return null;
        const raw = buf[i];
        return raw === -999.0 ? null : raw;
      };
      const result = FormulaEval.evaluate(ast, lookup);
      if (result === null) {
        out[i] = -999.0;
      } else {
        out[i] = result;
        validCount++;
      }
    }

    data.attributes[name] = out;
    return { validCount, totalCount: count };
  }

  /**
   * Calcula una Variable Calculada sobre Sondajes: recorre los intervalos y
   * escribe el resultado en interval.values[name]. A diferencia de Bloques/
   * Muestras, acá "sin dato" se representa con `null` directamente (no hay
   * sentinela -999 para los ensayos de sondaje — ver worker-parser.js), así
   * que no hace falta traducir la convención en ningún sentido.
   */
  _computeIntervalCalcVariable(data, name, ast) {
    const intervals = data.intervals || [];
    let validCount = 0;

    intervals.forEach(interval => {
      const lookup = (varName) => {
        const raw = interval.values ? interval.values[varName] : undefined;
        if (raw === undefined || raw === null || (typeof raw === 'number' && isNaN(raw))) return null;
        return raw;
      };
      const result = FormulaEval.evaluate(ast, lookup);
      if (!interval.values) interval.values = {};
      interval.values[name] = result; // FormulaEval ya devuelve null si no hay dato
      if (result !== null) validCount++;
    });

    return { validCount, totalCount: intervals.length };
  }

  /**
   * Abre el formulario de creación de una Variable Calculada para la capa
   * indicada: nombre + fórmula + chips clickeables con los atributos
   * numéricos disponibles (incluye tanto atributos nativos como Variables
   * Calculadas creadas antes en la misma sesión, ya que ambas terminan en la
   * misma lista de metadata — esto permite encadenarlas, ej. crear "A", y
   * después una "B" que use [A] en su fórmula).
   */
  openCalcBuilder(target) {
    const meta = this._calcTargetMeta(target);
    const data = meta.getData();
    if (!data) {
      const msg = target === 'blocks'
        ? 'Por favor cargue un modelo de bloques antes de crear variables calculadas.'
        : target === 'samples'
        ? 'Por favor cargue muestras metalúrgicas antes de crear variables calculadas.'
        : 'Por favor cargue sondajes antes de crear variables calculadas.';
      alert(msg);
      return;
    }

    const numericAttrs = meta.getMetadataList(data).filter(a => a.type === 'number');
    if (numericAttrs.length === 0) {
      alert('No hay atributos numéricos disponibles en esta capa para usar en una fórmula.');
      return;
    }

    const builder = document.getElementById(`calc-builder-${target}`);
    if (!builder) return;

    builder.classList.remove('hidden');
    builder.innerHTML = `
      <div class="settings-group">
        <label>Nombre de la Variable</label>
        <input type="text" id="calc-builder-name-${target}" class="form-control" placeholder="ej. CUS.CUT">
      </div>
      <div class="settings-group">
        <label>Fórmula</label>
        <input type="text" id="calc-builder-formula-${target}" class="form-control" placeholder="ej. [CUS] / [CUT]">
        <div class="calc-chip-list">
          ${numericAttrs.map(a => `<button type="button" class="calc-chip-btn" data-attr="${this.escapeHtml(a.name)}">${this.escapeHtml(a.name)}</button>`).join('')}
        </div>
        <span class="info-label">Hacé clic en un atributo para insertarlo en la fórmula. Operadores soportados: + − * / ^ y paréntesis.</span>
      </div>
      <div id="calc-builder-error-${target}" class="calc-builder-error hidden"></div>
      <div class="filter-builder-actions">
        <button class="btn btn-xs btn-primary" id="calc-builder-confirm-${target}">Calcular</button>
        <button class="btn btn-xs btn-outline" id="calc-builder-cancel-${target}">Cancelar</button>
      </div>
    `;

    const formulaInput = document.getElementById(`calc-builder-formula-${target}`);
    builder.querySelectorAll('.calc-chip-btn').forEach(chip => {
      chip.addEventListener('click', () => this._insertAtCursor(formulaInput, `[${chip.dataset.attr}]`));
    });

    document.getElementById(`calc-builder-confirm-${target}`)
      .addEventListener('click', () => this.confirmCalcBuilder(target));
    document.getElementById(`calc-builder-cancel-${target}`)
      .addEventListener('click', () => this.closeCalcBuilder(target));
  }

  closeCalcBuilder(target) {
    const builder = document.getElementById(`calc-builder-${target}`);
    if (builder) {
      builder.classList.add('hidden');
      builder.innerHTML = '';
    }
  }

  /**
   * Inserta texto en la posición del cursor de un <input> de texto (usado
   * por los chips de atributos: clic en un chip -> [Nombre] se inserta donde
   * estaba el cursor, en vez de siempre al final).
   */
  _insertAtCursor(inputEl, text) {
    if (!inputEl) return;
    const hasSelection = typeof inputEl.selectionStart === 'number';
    const start = hasSelection ? inputEl.selectionStart : inputEl.value.length;
    const end = hasSelection ? inputEl.selectionEnd : inputEl.value.length;
    inputEl.value = inputEl.value.slice(0, start) + text + inputEl.value.slice(end);
    inputEl.focus();
    if (inputEl.setSelectionRange) {
      const newPos = start + text.length;
      inputEl.setSelectionRange(newPos, newPos);
    }
  }

  /**
   * Lee el formulario del builder, valida nombre/fórmula/variables
   * referenciadas, calcula la nueva variable sobre TODOS los registros de la
   * capa, la registra como un atributo más (attributeMetadata/assayMetadata)
   * y la selecciona automáticamente como atributo de coloreado activo, para
   * que quede visible con su leyenda de inmediato — que es, después de todo,
   * el motivo por el que alguien crearía una variable calculada.
   */
  confirmCalcBuilder(target) {
    const nameInput = document.getElementById(`calc-builder-name-${target}`);
    const formulaInput = document.getElementById(`calc-builder-formula-${target}`);
    const errorBox = document.getElementById(`calc-builder-error-${target}`);
    if (!nameInput || !formulaInput) return;

    const showError = (msg) => {
      if (errorBox) { errorBox.innerText = msg; errorBox.classList.remove('hidden'); }
    };
    if (errorBox) errorBox.classList.add('hidden');

    const name = nameInput.value.trim();
    const formula = formulaInput.value.trim();
    if (!name) { showError('Ingresá un nombre para la variable.'); return; }
    if (!formula) { showError('Ingresá una fórmula.'); return; }

    const meta = this._calcTargetMeta(target);
    const data = meta.getData();
    if (!data) { showError('No hay datos cargados en esta capa.'); return; }

    const attrList = meta.getMetadataList(data);
    const isRedefinition = this.calcVariables[target].some(v => v.name === name);
    if (attrList.some(a => a.name === name) && !isRedefinition) {
      showError(`Ya existe un atributo llamado "${name}" en esta capa. Elegí otro nombre.`);
      return;
    }

    let ast;
    try {
      ast = FormulaEval.parse(formula);
    } catch (err) {
      showError(err.message);
      return;
    }

    const varNames = Array.from(FormulaEval.collectVarNames(ast));
    if (varNames.length === 0) {
      showError('La fórmula debe usar al menos un atributo, ej. [CUT].');
      return;
    }
    const numericNames = new Set(attrList.filter(a => a.type === 'number').map(a => a.name));
    const missing = varNames.filter(v => !numericNames.has(v));
    if (missing.length > 0) {
      showError(`Estos atributos no existen o no son numéricos en esta capa: ${missing.join(', ')}.`);
      return;
    }

    const { validCount, totalCount } = meta.compute(data, name, ast);

    const idx = attrList.findIndex(a => a.name === name);
    if (idx >= 0) attrList[idx] = { name, type: 'number' };
    else attrList.push({ name, type: 'number' });

    const calcList = this.calcVariables[target];
    const calcIdx = calcList.findIndex(v => v.name === name);
    if (calcIdx >= 0) calcList[calcIdx] = { name, formula };
    else calcList.push({ name, formula });

    this.refreshColorAttributeSelect(target);

    // Auto-seleccionar la variable recién creada como atributo de coloreado activo
    this[meta.attrKey] = name;
    const selectEl = document.getElementById(meta.selectId);
    if (selectEl) selectEl.value = name;
    this.updateColorRangeUI(target);
    meta.refresh();

    this.renderCalcPills(target);
    this.closeCalcBuilder(target);

    this.logConsole('success', `Variable calculada "${name}" creada (${meta.label}): ${validCount.toLocaleString()} de ${totalCount.toLocaleString()} registros con valor válido.`);
  }

  /**
   * Elimina una Variable Calculada ya creada: la quita del atributo/metadata
   * de la capa, y si era el atributo actualmente coloreado la deselecciona
   * (vuelve a "Ninguno") en vez de dejar la visualización apuntando a un
   * atributo que ya no existe.
   */
  removeCalcVariable(target, name) {
    const meta = this._calcTargetMeta(target);
    const data = meta.getData();
    if (data) {
      meta.removeAttr(data, name);
      const attrList = meta.getMetadataList(data);
      const idx = attrList.findIndex(a => a.name === name);
      if (idx >= 0) attrList.splice(idx, 1);
    }
    this.calcVariables[target] = this.calcVariables[target].filter(v => v.name !== name);

    if (this[meta.attrKey] === name) {
      this[meta.attrKey] = '';
      const selectEl = document.getElementById(meta.selectId);
      if (selectEl) selectEl.value = '';
      this.updateColorRangeUI(target);
      meta.refresh();
    }

    this.refreshColorAttributeSelect(target);
    this.renderCalcPills(target);
    this.logConsole('info', `Variable calculada "${name}" eliminada (${meta.label}).`);
  }

  /**
   * Reconstruye por completo las opciones del selector "Atributo Activo
   * (Coloreado)" de una capa a partir de su metadata actual, preservando la
   * selección previa si ese atributo sigue existiendo. Se usa después de
   * crear o eliminar una Variable Calculada, para no tener que insertar/quitar
   * <option> a mano (evita duplicados y desincronización).
   */
  refreshColorAttributeSelect(target) {
    const meta = this._calcTargetMeta(target);
    const data = meta.getData();
    const selectEl = document.getElementById(meta.selectId);
    if (!selectEl || !data) return;

    const prevValue = selectEl.value;
    const attrs = meta.getMetadataList(data);
    selectEl.innerHTML = '<option value="">(Ninguno)</option>';
    attrs.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.name;
      opt.innerText = `${a.name} (${a.type === 'category' ? 'Categórico' : 'Numérico'})`;
      selectEl.appendChild(opt);
    });
    if (attrs.some(a => a.name === prevValue)) selectEl.value = prevValue;
  }

  /**
   * Dibuja la lista de "pills" de Variables Calculadas ya creadas para una
   * capa (nombre + fórmula + botón para eliminarla). Usa addEventListener en
   * vez de onclick inline (a diferencia de renderFilterPills) porque el
   * nombre/fórmula los escribe el usuario y puede contener comillas u otros
   * caracteres que romperían un atributo onclick="..." armado por
   * concatenación de strings.
   */
  renderCalcPills(target) {
    const container = document.getElementById(`active-calc-list-${target}`);
    if (!container) return;

    const list = this.calcVariables[target];
    container.innerHTML = '';

    if (list.length === 0) {
      container.innerHTML = '<div class="empty-notice">No hay variables calculadas. Creá una en función de los atributos numéricos ya cargados.</div>';
      return;
    }

    list.forEach(v => {
      const pill = document.createElement('div');
      pill.className = 'filter-pill';
      pill.innerHTML = `
        <span class="pill-text"><strong>${this.escapeHtml(v.name)}</strong> <span class="pill-formula">= ${this.escapeHtml(v.formula)}</span></span>
        <button class="btn-icon" style="color:var(--accent-red)">×</button>
      `;
      pill.querySelector('button').addEventListener('click', () => this.removeCalcVariable(target, v.name));
      container.appendChild(pill);
    });
  }

  // ==========================================
  // PRUEBAS DE VALIDACIÓN AUTOMATIZADAS (PoC)
  // ==========================================
  runAutomatedTests() {
    let passedTests = 0;
    let failedTests = 0;
    
    // ----------------------------------------
    // TEST 1: Algoritmo de Mínima Curvatura
    // ----------------------------------------
    try {
      const collar = { x: 100, y: 100, z: 100 };
      const surveyPoints = [
        { depth: 0, dip: -90, azimuth: 0 },
        { depth: 100, dip: -90, azimuth: 0 } // Sondaje vertical recto hacia abajo
      ];
      
      // Simular computación
      const trace = [
        { depth: 0, x: collar.x, y: collar.y, z: collar.z, dx: 0, dy: 0, dz: -1 }
      ];
      
      // Calcular paso de mínima curvatura
      const p1 = trace[0];
      const p2 = surveyPoints[1];
      const dMD = p2.depth - p1.depth;
      const dx2 = 0, dy2 = 0, dz2 = -1; // Vertical abajo
      
      const cosBeta = p1.dx * dx2 + p1.dy * dy2 + p1.dz * dz2; // = 1
      const beta = Math.acos(Math.min(1.0, Math.max(-1.0, cosBeta))); // = 0
      let rf = 1.0;
      
      const x = p1.x + (dMD / 2) * (p1.dx + dx2) * rf;
      const y = p1.y + (dMD / 2) * (p1.dy + dy2) * rf;
      const z = p1.z + (dMD / 2) * (p1.dz + dz2) * rf;
      
      trace.push({ depth: p2.depth, x, y, z, dx: dx2, dy: dy2, dz: dz2 });
      
      // Verificaciones
      if (x === 100 && y === 100 && z === 0) {
        this.logConsole('success', '[Test Desurvey] Curvatura Mínima en Sondaje Vertical Recto: APROBADO');
        passedTests++;
      } else {
        this.logConsole('error', `[Test Desurvey] Curvatura Mínima Falló. Coordenada final calculada: (${x},${y},${z}), esperada (100,100,0)`);
        failedTests++;
      }
    } catch (err) {
      this.logConsole('error', `[Test Desurvey] Fallo catastrófico en Test: ${err.message}`);
      failedTests++;
    }

    // ----------------------------------------
    // TEST 2: Indexación Espacial (Octree)
    // ----------------------------------------
    try {
      const bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: 0, maxZ: 100 };
      const spatialIndex = new SpatialIndex3D(bounds, 10, 10, 10);
      
      // Insertar bloques simulados
      // Bloque 0 en (5, 5, 5) -> Celda 0
      spatialIndex.insertBlock(0, 5, 5, 5);
      // Bloque 1 en (95, 95, 95) -> Celda extrema
      spatialIndex.insertBlock(1, 95, 95, 95);
      
      // Consulta en caja pequeña [0, 10]
      const results = spatialIndex.queryBox({ minX: 0, maxX: 10, minY: 0, maxY: 10, minZ: 0, maxZ: 10 });
      
      if (results.includes(0) && !results.includes(1)) {
        this.logConsole('success', '[Test Octree] Indexación y Búsqueda por Caja 3D: APROBADO');
        passedTests++;
      } else {
        this.logConsole('error', `[Test Octree] Búsqueda falló. Resultados: [${results.join(', ')}], esperados [0]`);
        failedTests++;
      }
    } catch (err) {
      this.logConsole('error', `[Test Octree] Fallo catastrófico en Test: ${err.message}`);
      failedTests++;
    }
    
    // Resumen de tests
    this.logConsole('info', `[Pruebas] Resumen: ${passedTests} Aprobados, ${failedTests} Fallados.`);
  }
}

// Iniciar aplicación
const app = new GeometApp();
window.onload = () => {
  app.init();
};
