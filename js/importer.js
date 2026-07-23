/**
 * GeoMet V1 — Módulo Coordinador del Importador Configurable
 * Administra los pasos del modal de importación, lectura previa de CSV, mapeo de columnas y plantillas.
 */

class GeometImporter {
  constructor() {
    this.activeType = null; // 'drillholes', 'blocks', 'dxf', 'samples'
    this.currentStep = 1;   // 1 o 2

    // Archivos cargados temporalmente en el modal
    this.modalFiles = {
      collar: null,
      survey: null,
      assays: null,
      geology: null,
      blocks: null,
      samples: null,
      dxf: null
    };

    // Encabezados detectados de los archivos cargados
    this.detectedHeaders = {
      collar: [],
      survey: [],
      assays: [],
      geology: [],
      blocks: [],
      samples: []
    };

    // Vista previa de filas
    this.previews = {
      collar: [],
      survey: [],
      assays: [],
      geology: [],
      blocks: [],
      samples: []
    };

    this.initEventListeners();
  }

  initEventListeners() {
    // Escuchar selección de archivo genérico
    const fileInput = document.getElementById('csv-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.handleFileSelection(file, this.activeType);
      });
    }

    // Escuchar archivos específicos para Sondajes
    ['collar', 'survey', 'assays', 'geology'].forEach(subType => {
      const el = document.getElementById(`csv-${subType}`);
      if (el) {
        el.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) this.handleFileSelection(file, `drillholes_${subType}`);
        });
      }
    });

    // Drag and Drop & Click to Select
    const dropArea = document.getElementById('file-drop-area');
    if (dropArea) {
      dropArea.addEventListener('click', () => {
        if (fileInput) fileInput.click();
      });
      dropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropArea.classList.add('drag-over');
      });
      dropArea.addEventListener('dragleave', () => {
        dropArea.classList.remove('drag-over');
      });
      dropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dropArea.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) {
          if (this.activeType === 'drillholes') {
            app.logConsole('error', 'Para sondajes, por favor use los selectores individuales de archivos.');
          } else {
            fileInput.files = e.dataTransfer.files;
            this.handleFileSelection(file, this.activeType);
          }
        }
      });
    }

    // Guardar plantilla
    const btnSaveTmpl = document.getElementById('btn-save-template');
    if (btnSaveTmpl) {
      btnSaveTmpl.addEventListener('click', () => this.saveCurrentMappingAsTemplate());
    }

    // Cargar plantilla cambio
    const selectTmpl = document.getElementById('select-template');
    if (selectTmpl) {
      selectTmpl.addEventListener('change', (e) => this.applyTemplate(e.target.value));
    }
  }

  openImportModal(type) {
    this.activeType = type;
    this.currentStep = 1;
    
    const modal = document.getElementById('import-modal');
    modal.classList.remove('hidden');
    
    // Ajustar UI según tipo
    document.getElementById('modal-title').innerText = `Importar ${this.getFriendlyTypeName(type)}`;
    
    const genFileGroup = document.getElementById('file-drop-area').parentElement;
    const dhMultiGroup = document.getElementById('drillholes-multi-files');
    const startRowGroup = document.getElementById('import-start-row').parentElement.parentElement;
    
    if (type === 'drillholes') {
      genFileGroup.classList.add('hidden');
      dhMultiGroup.classList.remove('hidden');
      startRowGroup.classList.remove('hidden');
    } else if (type === 'dxf') {
      genFileGroup.classList.remove('hidden');
      dhMultiGroup.classList.add('hidden');
      startRowGroup.classList.add('hidden'); // DXF no necesita filas
      document.getElementById('lbl-file-input').innerText = "Seleccionar Archivo DXF";
      document.getElementById('csv-file-input').accept = ".dxf";
      document.getElementById('drop-msg-text').innerText = "Arrastra tu archivo DXF aquí o haz clic para buscar";
    } else if (type === 'samples') {
      genFileGroup.classList.remove('hidden');
      dhMultiGroup.classList.add('hidden');
      startRowGroup.classList.remove('hidden');
      document.getElementById('lbl-file-input').innerText = "Seleccionar Archivo CSV de Muestras Metalúrgicas";
      document.getElementById('csv-file-input').accept = ".csv,.txt";
      document.getElementById('drop-msg-text').innerText = "Arrastra tu archivo CSV aquí o haz clic para buscar";
    } else { // blocks
      genFileGroup.classList.remove('hidden');
      dhMultiGroup.classList.add('hidden');
      startRowGroup.classList.remove('hidden');
      document.getElementById('lbl-file-input').innerText = "Seleccionar Archivo CSV/ASC de Bloques";
      document.getElementById('csv-file-input').accept = ".csv,.txt,.asc";
      document.getElementById('drop-msg-text').innerText = "Arrastre su archivo CSV o ASC aquí o haga clic para buscar";
    }

    this.updateModalButtons();
  }

  closeImportModal() {
    document.getElementById('import-modal').classList.add('hidden');
    // Limpiar campos de archivo
    document.getElementById('csv-file-input').value = "";
    ['collar', 'survey', 'assays', 'geology'].forEach(st => {
      const el = document.getElementById(`csv-${st}`);
      if (el) el.value = "";
    });
    
    this.modalFiles = { collar: null, survey: null, assays: null, geology: null, blocks: null, samples: null, dxf: null };
  }

  getFriendlyTypeName(type) {
    if (type === 'drillholes') return 'Base de Sondajes';
    if (type === 'blocks') return 'Modelo de Bloques';
    if (type === 'dxf') return 'Geometría DXF';
    if (type === 'samples') return 'Muestras Metalúrgicas';
    return '';
  }

  handleFileSelection(file, subType) {
    app.logConsole('info', `Archivo seleccionado: ${file.name} (${(file.size/1024).toFixed(1)} KB)`);
    
    if (subType === 'dxf') {
      this.modalFiles.dxf = file;
      return;
    }

    const targetKey = subType.includes('_') ? subType.split('_')[1] : subType;
    this.modalFiles[targetKey] = file;

    // Leer encabezados y filas de vista previa
    const startRow = parseInt(document.getElementById('import-start-row').value) || 2;
    const headerRow = startRow - 1 > 0 ? startRow - 1 : 1;
    
    const reader = new FileReader();
    // Leemos solo los primeros 50KB
    const blobSlice = file.slice(0, 50000);
    
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      
      // Headers
      const headerLine = lines[headerRow - 1] || "";
      const separator = this.detectSeparator(headerLine);
      const headers = this.parseCSVLine(headerLine, separator);
      this.detectedHeaders[targetKey] = headers;
      
      // Preview Rows
      const previewRows = [];
      const startIdx = Math.max(0, startRow - 1);
      for (let idx = startIdx; idx < startIdx + 5 && idx < lines.length; idx++) {
        previewRows.push(this.parseCSVLine(lines[idx], separator));
      }
      this.previews[targetKey] = previewRows;
      
      app.logConsole('success', `Headers detectados en ${file.name}: [${headers.slice(0, 5).join(', ')}...]`);
    };
    reader.readAsText(blobSlice);
  }

  detectSeparator(line) {
    if (!line) return ',';
    let commas = 0, semicolons = 0, tabs = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' || c === "'") inQuotes = !inQuotes;
      else if (!inQuotes) {
        if (c === ',') commas++;
        else if (c === ';') semicolons++;
        else if (c === '\t') tabs++;
      }
    }
    if (semicolons > commas && semicolons > tabs) return ';';
    if (tabs > commas && tabs > semicolons) return '\t';
    if (commas === 0 && semicolons === 0 && tabs === 0) {
      // Sin delimitadores clásicos: común en archivos .asc de modelos de
      // bloques (Datamine/Vulcan/Surpac), que suelen venir separados por
      // uno o más espacios en blanco con ancho variable. Si la línea trae
      // más de un "token" separado por espacios, se asume delimitador ' '.
      const tokens = line.trim().split(/\s+/);
      if (tokens.length > 1) return ' ';
    }
    return ',';
  }

  parseCSVLine(line, separator = ',') {
    // Delimitador por espacios: ancho variable, sin soporte de comillas
    // (los .asc de modelos de bloques casi nunca traen campos entrecomillados).
    if (separator === ' ') {
      return line.trim().split(/\s+/);
    }

    const result = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === separator && !inQuotes) {
        result.push(cur.trim());
        cur = "";
      } else {
        cur += char;
      }
    }
    result.push(cur.trim());
    return result;
  }

  updateModalButtons() {
    const step1 = document.getElementById('step-file-selection');
    const step2 = document.getElementById('step-column-mapping');
    const btnBack = document.getElementById('btn-modal-back');
    const btnNext = document.getElementById('btn-modal-next');

    if (this.currentStep === 1) {
      step1.classList.remove('hidden');
      step2.classList.add('hidden');
      btnBack.disabled = true;
      btnNext.innerText = this.activeType === 'dxf' ? 'Importar' : 'Siguiente';
    } else {
      step1.classList.add('hidden');
      step2.classList.remove('hidden');
      btnBack.disabled = false;
      btnNext.innerText = 'Importar';
    }
  }

  modalNext() {
    if (this.currentStep === 1) {
      // Validar archivos seleccionados antes de pasar a la siguiente pantalla
      if (this.activeType === 'dxf') {
        if (!this.modalFiles.dxf) {
          alert('Por favor seleccione un archivo DXF.');
          return;
        }
        this.runDXFImport();
        return;
      }

      if (this.activeType === 'blocks') {
        if (!this.modalFiles.blocks) {
          alert('Por favor seleccione el archivo CSV del modelo de bloques.');
          return;
        }
      }

      if (this.activeType === 'samples') {
        if (!this.modalFiles.samples) {
          alert('Por favor seleccione el archivo CSV de muestras metalúrgicas.');
          return;
        }
      }

      if (this.activeType === 'drillholes') {
        if (!this.modalFiles.collar) {
          alert('Por favor seleccione al menos el archivo de Collares.');
          return;
        }
      }

      // Pasar a paso 2: Mapeo de Columnas
      this.currentStep = 2;
      this.generateMappingUI();
      this.loadTemplateList();
      this.updateModalButtons();
    } else {
      // Procesar importación final
      this.runFinalImport();
    }
  }

  modalBack() {
    if (this.currentStep === 2) {
      this.currentStep = 1;
      this.updateModalButtons();
    }
  }

  // ==========================================
  // GENERADOR DINÁMICO DE MAPEOS
  // ==========================================
  generateMappingUI() {
    const tbody = document.getElementById('mapping-rows');
    tbody.innerHTML = "";

    // El filtro previo a la carga es exclusivo del importador de Modelo de
    // Bloques; se oculta y limpia por defecto y solo se rearma más abajo
    // si activeType === 'blocks'.
    const prefilterSection = document.getElementById('block-prefilter-section');
    prefilterSection.classList.add('hidden');
    document.getElementById('block-prefilter-rows').innerHTML = '';

    if (this.activeType === 'blocks') {
      const headers = this.detectedHeaders.blocks;
      
      // Campos requeridos del sistema
      const fields = [
        { key: 'x', label: 'Centroide X (Este)', required: true },
        { key: 'y', label: 'Centroide Y (Norte)', required: true },
        { key: 'z', label: 'Centroide Z (Elevación)', required: true },
        { key: 'dx', label: 'Dimensión DX', required: false },
        { key: 'dy', label: 'Dimensión DY', required: false },
        { key: 'dz', label: 'Dimensión DZ', required: false }
      ];
      
      fields.forEach(f => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><strong>${f.label}</strong></td>
          <td>${f.required ? '<span style="color:var(--accent-red)">★</span>' : 'Opcional'}</td>
          <td>
            <select class="form-control mapping-select" data-field="${f.key}">
              <option value="-1">(No mapeado / Usar Default)</option>
              ${headers.map((h, idx) => `<option value="${idx}" ${this.guessHeader(f.key, h) ? 'selected' : ''}>${h}</option>`).join('')}
            </select>
          </td>
          <td><span class="badge badge-empty">Numérico</span></td>
        `;
        tbody.appendChild(row);
      });

      // Añadir fila especial para atributos adicionales del modelo de bloques (Cu%, Litología, etc.)
      const attrRow = document.createElement('tr');
      attrRow.className = 'attr-header-row';
      attrRow.innerHTML = `
        <td colspan="4" style="background-color:rgba(0,0,0,0.15); font-weight:bold; color:var(--accent-cyan)">
          Atributos Adicionales a Importar (Leyes, Litologías, Categorías)
        </td>
      `;
      tbody.appendChild(attrRow);

      headers.forEach((h, idx) => {
        // Todas las columnas inician desmarcadas: el usuario elige explícitamente
        // cuáles atributos importar (no siempre se usan todas las disponibles).
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><label><input type="checkbox" class="attr-import-chk" data-index="${idx}" data-name="${h}"> ${h}</label></td>
          <td>Opcional</td>
          <td><em>Mapeado a Atributo</em></td>
          <td>
            <select class="form-control-sm attr-type-select" data-index="${idx}">
              <option value="number" ${h.toLowerCase().includes('lit') || h.toLowerCase().includes('alt') ? '' : 'selected'}>Numérico (Float32)</option>
              <option value="category" ${h.toLowerCase().includes('lit') || h.toLowerCase().includes('alt') ? 'selected' : ''}>Categórico (Lookup)</option>
            </select>
          </td>
        `;
        tbody.appendChild(row);
      });

      this.initPrefilterSection(headers);
      this.generatePreviewTable('blocks');

    } else if (this.activeType === 'drillholes') {
      // Para sondajes, estructuramos el mapeo por tabla (Collar, Survey, Assays)
      this.generateDrillholeTableMapping(tbody);
    } else if (this.activeType === 'samples') {
      this.generateSamplesMapping(tbody);
    }
  }

  /**
   * Mapeo de columnas para Muestras Metalúrgicas: se posicionan por HoleID +
   * Desde/Hasta (interpolando sobre la traza del sondaje ya cargado) o, si
   * el CSV ya trae columnas de centroide, directamente por Centroide X/Y/Z
   * (sin necesitar que los sondajes estén cargados). Basta con mapear una de
   * las dos formas — el usuario puede mapear ambas si el CSV las trae todas,
   * en cuyo caso se prioriza el centroide directo por fila.
   */
  generateSamplesMapping(tbody) {
    const headers = this.detectedHeaders.samples;

    const fields = [
      { key: 'holeId', label: 'HoleID (Identificador Sondaje)', required: true },
      { key: 'from', label: 'Desde (From) — para interpolar sobre la traza', required: false },
      { key: 'to', label: 'Hasta (To) — para interpolar sobre la traza', required: false },
      { key: 'midx', label: 'Centroide X (si el CSV ya lo trae)', required: false },
      { key: 'midy', label: 'Centroide Y (si el CSV ya lo trae)', required: false },
      { key: 'midz', label: 'Centroide Z (si el CSV ya lo trae)', required: false }
    ];

    fields.forEach(f => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${f.label}</strong></td>
        <td>${f.required ? '<span style="color:var(--accent-red)">★</span>' : 'Opcional'}</td>
        <td>
          <select class="form-control mapping-select" data-field="${f.key}">
            <option value="-1">(No mapeado)</option>
            ${headers.map((h, idx) => `<option value="${idx}" ${this.guessHeader(f.key, h) ? 'selected' : ''}>${h}</option>`).join('')}
          </select>
        </td>
        <td><span class="badge badge-empty">Texto/Numérico</span></td>
      `;
      tbody.appendChild(row);
    });

    const noteRow = document.createElement('tr');
    noteRow.innerHTML = `
      <td colspan="4" style="background-color:rgba(0,0,0,0.1); font-size:0.75rem; color:var(--text-muted)">
        Mapea Desde/Hasta, Centroide X/Y/Z, o ambos. Si una fila trae centroide válido se usa directo; si no, se interpola sobre la traza del sondaje (requiere tener los Sondajes ya cargados). Las filas sin ninguna de las dos formas disponibles se omiten con aviso en la consola.
      </td>
    `;
    tbody.appendChild(noteRow);

    // Atributos adicionales a importar (leyes metalúrgicas, categorías, etc.)
    const attrRow = document.createElement('tr');
    attrRow.className = 'attr-header-row';
    attrRow.innerHTML = `
      <td colspan="4" style="background-color:rgba(0,0,0,0.15); font-weight:bold; color:var(--accent-cyan)">
        Atributos a Importar (Leyes Metalúrgicas, Categorías)
      </td>
    `;
    tbody.appendChild(attrRow);

    headers.forEach((h, idx) => {
      const looksCategoric = /lith|litol|alt|tipo|class|code|flag|zona|dominio|unit|rock|mineral/i.test(h);
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><label><input type="checkbox" class="sample-import-chk" data-index="${idx}" data-name="${h}"> ${h}</label></td>
        <td>Opcional</td>
        <td><em>Mapeado a Atributo</em></td>
        <td>
          <select class="form-control-sm sample-type-select" data-index="${idx}">
            <option value="number" ${!looksCategoric ? 'selected' : ''}>Numérico (Float32)</option>
            <option value="category" ${looksCategoric ? 'selected' : ''}>Categórico (Lookup)</option>
          </select>
        </td>
      `;
      tbody.appendChild(row);
    });

    this.generatePreviewTable('samples');
  }

  generateDrillholeTableMapping(tbody) {
    const fields = [
      { table: 'collar', key: 'holeId', label: 'Collar — HoleID (Identificador)', required: true },
      { table: 'collar', key: 'x', label: 'Collar — Coord X (Este)', required: true },
      { table: 'collar', key: 'y', label: 'Collar — Coord Y (Norte)', required: true },
      { table: 'collar', key: 'z', label: 'Collar — Coord Z (Elevación)', required: true },
      
      { table: 'survey', key: 'holeId', label: 'Survey — HoleID', required: false },
      { table: 'survey', key: 'depth', label: 'Survey — Profundidad (Depth)', required: false },
      { table: 'survey', key: 'azimuth', label: 'Survey — Azimuth', required: false },
      { table: 'survey', key: 'dip', label: 'Survey — Inclinación (Dip)', required: false },
      
      { table: 'assays', key: 'holeId', label: 'Assays — HoleID', required: false },
      { table: 'assays', key: 'from', label: 'Assays — Desde (From)', required: false },
      { table: 'assays', key: 'to', label: 'Assays — Hasta (To)', required: false }
    ];

    fields.forEach(f => {
      const headers = this.detectedHeaders[f.table] || [];
      const hasFile = !!this.modalFiles[f.table];
      
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong style="${!hasFile ? 'opacity:0.4' : ''}">${f.label}</strong></td>
        <td>${f.required ? '<span style="color:var(--accent-red)">★</span>' : 'Opcional'}</td>
        <td>
          <select class="form-control mapping-select" data-table="${f.table}" data-field="${f.key}" ${!hasFile ? 'disabled' : ''}>
            <option value="-1">${hasFile ? '(No mapeado)' : '(Sin Archivo CSV)'}</option>
            ${headers.map((h, idx) => `<option value="${idx}" ${this.guessHeader(f.key, h) ? 'selected' : ''}>${h}</option>`).join('')}
          </select>
        </td>
        <td><span class="badge badge-empty">Texto/Numérico</span></td>
      `;
      tbody.appendChild(row);
    });

    // Agregar sección de Leyes de Ensayos (Assays) a importar
    if (this.modalFiles.assays) {
      const assaysHeaders = this.detectedHeaders.assays;
      const assayRow = document.createElement('tr');
      assayRow.innerHTML = `
        <td colspan="4" style="background-color:rgba(0,0,0,0.15); font-weight:bold; color:var(--accent-cyan)">
          Leyes y Atributos de Ensayos a Colorear/Filtrar
        </td>
      `;
      tbody.appendChild(assayRow);

      assaysHeaders.forEach((h, idx) => {
        // Heurística: si el nombre parece categórico, preseleccionar el tipo de dato
        // (pero la casilla de importación siempre inicia desmarcada: el usuario elige).
        const looksCategoric = /lith|litol|alt|tipo|class|code|flag|zona|dominio|unit|rock|mineral/i.test(h);
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><label><input type="checkbox" class="assay-import-chk" data-index="${idx}" data-name="${h}"> ${h}</label></td>
          <td>Opcional</td>
          <td><em>Mapeado a Ensayo</em></td>
          <td>
            <select class="form-control-sm assay-type-select" data-index="${idx}">
              <option value="number" ${!looksCategoric ? 'selected' : ''}>Numérico</option>
              <option value="category" ${looksCategoric ? 'selected' : ''}>Categórico</option>
            </select>
          </td>
        `;
        tbody.appendChild(row);
      });
    }

    this.generatePreviewTable('collar'); // Vista previa de collar por defecto
  }

  generatePreviewTable(targetKey) {
    const table = document.getElementById('table-preview');
    table.innerHTML = "";
    
    const headers = this.detectedHeaders[targetKey] || [];
    const rows = this.previews[targetKey] || [];
    
    if (headers.length === 0) return;
    
    // Header
    const trHead = document.createElement('tr');
    trHead.innerHTML = headers.map(h => `<th>${h}</th>`).join('');
    table.appendChild(trHead);
    
    // Rows
    rows.forEach(r => {
      const trRow = document.createElement('tr');
      trRow.innerHTML = r.map(cell => `<td>${cell}</td>`).join('');
      table.appendChild(trRow);
    });
  }

  // ==========================================
  // FILTRO PREVIO A LA CARGA (solo Modelo de Bloques)
  // ==========================================
  /**
   * Muestra la sección de filtro previo y la deja lista con una primera
   * condición vacía. Se llama cada vez que se genera el mapeo de un archivo
   * de Modelo de Bloques (headers ya detectados en ese momento).
   */
  initPrefilterSection(headers) {
    const section = document.getElementById('block-prefilter-section');
    section.classList.remove('hidden');

    this._prefilterHeaders = headers;
    document.getElementById('block-prefilter-rows').innerHTML = '';
    this.addPrefilterRow();

    // Reemplazamos el botón por un clon para no acumular listeners si el
    // usuario reabre el modal o vuelve a mapear el mismo archivo varias veces.
    const btnAdd = document.getElementById('btn-add-prefilter-row');
    const freshBtn = btnAdd.cloneNode(true);
    btnAdd.parentNode.replaceChild(freshBtn, btnAdd);
    freshBtn.addEventListener('click', () => this.addPrefilterRow());
  }

  /** Agrega una fila de condición (columna/operador/valor) al filtro previo. */
  addPrefilterRow() {
    const rowsContainer = document.getElementById('block-prefilter-rows');
    const headers = this._prefilterHeaders || [];

    const row = document.createElement('div');
    row.className = 'prefilter-row';
    row.innerHTML = `
      <select class="form-control-sm prefilter-col-select">
        ${headers.map((h, idx) => `<option value="${idx}">${h}</option>`).join('')}
      </select>
      <select class="form-control-sm prefilter-op-select">
        <option value=">">&gt;</option>
        <option value=">=">&gt;=</option>
        <option value="<">&lt;</option>
        <option value="<=">&lt;=</option>
        <option value="=">=</option>
        <option value="!=">&ne;</option>
      </select>
      <input type="text" class="form-control-sm prefilter-val-input" placeholder="Valor (ej. 0.2)">
      <button type="button" class="btn-remove-prefilter-row" title="Quitar condición">&times;</button>
    `;
    row.querySelector('.btn-remove-prefilter-row').addEventListener('click', () => row.remove());
    rowsContainer.appendChild(row);
  }

  /**
   * Recolecta las condiciones de filtro previo definidas por el usuario.
   * Las filas con el valor vacío se ignoran silenciosamente (no bloquean el
   * import ni descartan filas).
   */
  collectPrefilters() {
    const rows = document.querySelectorAll('#block-prefilter-rows .prefilter-row');
    const filters = [];
    rows.forEach(row => {
      const colSelect = row.querySelector('.prefilter-col-select');
      const opSelect = row.querySelector('.prefilter-op-select');
      const valInput = row.querySelector('.prefilter-val-input');
      if (!colSelect || !colSelect.options.length) return;

      const rawVal = valInput.value.trim();
      if (rawVal === '') return;

      filters.push({
        index: parseInt(colSelect.value),
        name: colSelect.options[colSelect.selectedIndex].text,
        operator: opSelect.value,
        value: rawVal
      });
    });
    return filters;
  }

  guessHeader(field, header) {
    if (!header || !field) return false;
    const h = header.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    const f = field.toString().toLowerCase();
    
    if (f === 'holeid') return h === 'holeid' || h === 'hole' || h === 'id' || h === 'sondaje';
    if (f === 'x') return h === 'x' || h === 'east' || h === 'este' || h === 'eastings';
    if (f === 'y') return h === 'y' || h === 'north' || h === 'norte' || h === 'northings';
    if (f === 'z') return h === 'z' || h === 'elevation' || h === 'elevacion' || h === 'cota' || h === 'rl';
    if (f === 'depth') return h === 'depth' || h === 'depthto' || h === 'largo' || h === 'at' || h === 'profundidad';
    if (f === 'azimuth') return h === 'azimuth' || h === 'az' || h === 'azimut';
    if (f === 'dip') return h === 'dip' || h === 'inc' || h === 'inclinacion';
    if (f === 'from') return h === 'from' || h === 'desde' || h === 'fromdepth';
    if (f === 'to') return h === 'to' || h === 'hasta' || h === 'todepth';
    if (f === 'dx') return h === 'dx' || h === 'sizex' || h === 'anchox';
    if (f === 'dy') return h === 'dy' || h === 'sizey' || h === 'anchoy';
    if (f === 'dz') return h === 'dz' || h === 'sizez' || h === 'altoz';
    if (f === 'midx') return h === 'midx' || h === 'mx' || h === 'centroidex' || h === 'xmid';
    if (f === 'midy') return h === 'midy' || h === 'my' || h === 'centroidey' || h === 'ymid';
    if (f === 'midz') return h === 'midz' || h === 'mz' || h === 'centroidez' || h === 'zmid';

    return false;
  }

  // ==========================================
  // TEMPLATES
  // ==========================================
  loadTemplateList() {
    const select = document.getElementById('select-template');
    select.innerHTML = '<option value="default">Detección Automática</option>';
    
    const templates = PresetManager.getTemplates(this.activeType);
    for (const key in templates) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.innerText = templates[key].name;
      select.appendChild(opt);
    }
  }

  applyTemplate(templateKey) {
    if (templateKey === 'default') {
      this.generateMappingUI();
      return;
    }
    
    const templates = PresetManager.getTemplates(this.activeType);
    const tmpl = templates[templateKey];
    
    if (!tmpl) return;
    
    const mappings = tmpl.mappings;
    
    // Seleccionar en selects
    const selects = document.querySelectorAll('.mapping-select');
    selects.forEach(sel => {
      const field = sel.dataset.field;
      const table = sel.dataset.table;
      
      const mapVal = table ? mappings[`${table}_${field}`] : mappings[field];
      if (mapVal !== undefined && mapVal !== null) {
        // mapVal es el nombre de la columna (ej. "HoleID") o su índice
        let foundVal = "-1";
        for (let idx = 0; idx < sel.options.length; idx++) {
          const opt = sel.options[idx];
          if (opt.text === mapVal || opt.value === mapVal.toString()) {
            foundVal = opt.value;
            break;
          }
        }
        sel.value = foundVal;
      }
    });

    app.logConsole('success', `Plantilla '${tmpl.name}' aplicada.`);
  }

  saveCurrentMappingAsTemplate() {
    const name = prompt("Nombre de la nueva plantilla:");
    if (!name) return;
    
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const mappings = {};
    
    const selects = document.querySelectorAll('.mapping-select');
    selects.forEach(sel => {
      const field = sel.dataset.field;
      const table = sel.dataset.table;
      
      const selectedOpt = sel.options[sel.selectedIndex];
      const val = selectedOpt ? selectedOpt.text : "-1";
      
      if (table) {
        mappings[`${table}_${field}`] = val;
      } else {
        mappings[field] = val;
      }
    });

    PresetManager.saveTemplate(this.activeType, key, name, mappings);
    this.loadTemplateList();
    document.getElementById('select-template').value = `user_${key}`;
    
    app.logConsole('success', `Plantilla '${name}' guardada correctamente.`);
  }

  // ==========================================
  // EJECUCIÓN DE IMPORTACIONES
  // ==========================================
  runDXFImport() {
    const file = this.modalFiles.dxf;
    app.logConsole('info', `Iniciando parsing de DXF: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`);
    this.closeImportModal();

    // El parseo se delega al Web Worker (igual que Bloques/Sondajes/Muestras):
    // para archivos DXF grandes (cientos de MB), leerlos completos en el hilo
    // principal con FileReader.readAsText podía superar el largo máximo de
    // string soportado por el motor JS, haciendo que la lectura fallara en
    // silencio (0 capas, sin ningún error) en vez de lanzar una excepción.
    // El worker lee el archivo en trozos pequeños (ver parseDxf() en
    // worker-parser.js), evitando ese límite sin importar el tamaño del DXF,
    // y además libera al hilo principal/UI durante el parseo.
    app.runWorkerParser('parse_dxf', { file });
  }

  runFinalImport() {
    const startRow = parseInt(document.getElementById('import-start-row').value) || 2;
    
    if (this.activeType === 'blocks') {
      const xCol = parseInt(document.querySelector('[data-field="x"]').value);
      const yCol = parseInt(document.querySelector('[data-field="y"]').value);
      const zCol = parseInt(document.querySelector('[data-field="z"]').value);
      
      if (xCol === -1 || yCol === -1 || zCol === -1) {
        alert("Las coordenadas X, Y, Z son requeridas para posicionar los bloques.");
        return;
      }
      
      const dxCol = parseInt(document.querySelector('[data-field="dx"]').value);
      const dyCol = parseInt(document.querySelector('[data-field="dy"]').value);
      const dzCol = parseInt(document.querySelector('[data-field="dz"]').value);
      
      // Obtener atributos a importar
      const attributes = [];
      const chks = document.querySelectorAll('.attr-import-chk:checked');
      chks.forEach(chk => {
        const index = parseInt(chk.dataset.index);
        const name = chk.dataset.name;
        const typeSelect = document.querySelector(`.attr-type-select[data-index="${index}"]`);
        attributes.push({
          index,
          name,
          type: typeSelect ? typeSelect.value : 'number'
        });
      });

      // Filtro previo a la carga: filas que no cumplan TODAS las condiciones
      // se descartan antes de reservar memoria (ver parseBlocks() en
      // worker-parser.js), para reducir el uso de RAM en archivos grandes.
      const prefilters = this.collectPrefilters();

      const payload = {
        file: this.modalFiles.blocks,
        mappings: {
          x: xCol, y: yCol, z: zCol,
          dx: dxCol, dy: dyCol, dz: dzCol,
          attributes,
          prefilters
        },
        options: {
          startRow,
          defaultDX: 10,
          defaultDY: 10,
          defaultDZ: 10
        }
      };

      this.closeImportModal();
      
      // Levantar Web Worker
      app.runWorkerParser('parse_blocks', payload);

    } else if (this.activeType === 'drillholes') {
      // Obtener mapeos
      const collarHoleId = parseInt(document.querySelector('[data-table="collar"][data-field="holeId"]').value);
      const collarX = parseInt(document.querySelector('[data-table="collar"][data-field="x"]').value);
      const collarY = parseInt(document.querySelector('[data-table="collar"][data-field="y"]').value);
      const collarZ = parseInt(document.querySelector('[data-table="collar"][data-field="z"]').value);
      
      if (collarHoleId === -1 || collarX === -1 || collarY === -1 || collarZ === -1) {
        alert("Campos de collar (HoleID, X, Y, Z) son requeridos.");
        return;
      }

      const surveyHoleId = parseInt(document.querySelector('[data-table="survey"][data-field="holeId"]').value);
      const surveyDepth = parseInt(document.querySelector('[data-table="survey"][data-field="depth"]').value);
      const surveyAzimuth = parseInt(document.querySelector('[data-table="survey"][data-field="azimuth"]').value);
      const surveyDip = parseInt(document.querySelector('[data-table="survey"][data-field="dip"]').value);

      const assaysHoleId = parseInt(document.querySelector('[data-table="assays"][data-field="holeId"]').value);
      const assaysFrom = parseInt(document.querySelector('[data-table="assays"][data-field="from"]').value);
      const assaysTo = parseInt(document.querySelector('[data-table="assays"][data-field="to"]').value);
      
      const assayValueCols = [];
      const chks = document.querySelectorAll('.assay-import-chk:checked');
      chks.forEach(chk => {
        const idx = chk.dataset.index;
        const typeSelect = document.querySelector(`.assay-type-select[data-index="${idx}"]`);
        assayValueCols.push({
          index: parseInt(idx),
          name: chk.dataset.name,
          type: typeSelect ? typeSelect.value : 'number'
        });
      });

      const payload = {
        files: {
          collar: this.modalFiles.collar,
          survey: this.modalFiles.survey,
          assays: this.modalFiles.assays,
          geology: this.modalFiles.geology
        },
        mappings: {
          collar: { holeId: collarHoleId, x: collarX, y: collarY, z: collarZ },
          survey: { holeId: surveyHoleId, depth: surveyDepth, azimuth: surveyAzimuth, dip: surveyDip },
          assays: { holeId: assaysHoleId, from: assaysFrom, to: assaysTo, valueCols: assayValueCols }
        },
        options: {
          startRow
        }
      };

      this.closeImportModal();
      app.runWorkerParser('parse_drillholes', payload);

    } else if (this.activeType === 'samples') {
      const holeIdCol = parseInt(document.querySelector('[data-field="holeId"]').value);
      const fromCol = parseInt(document.querySelector('[data-field="from"]').value);
      const toCol = parseInt(document.querySelector('[data-field="to"]').value);
      const midxCol = parseInt(document.querySelector('[data-field="midx"]').value);
      const midyCol = parseInt(document.querySelector('[data-field="midy"]').value);
      const midzCol = parseInt(document.querySelector('[data-field="midz"]').value);

      if (holeIdCol === -1) {
        alert("El HoleID es requerido para posicionar las muestras.");
        return;
      }

      const hasFromTo = fromCol !== -1 && toCol !== -1;
      const hasCentroid = midxCol !== -1 && midyCol !== -1 && midzCol !== -1;
      if (!hasFromTo && !hasCentroid) {
        alert("Mapee Desde/Hasta (para interpolar sobre la traza del sondaje) o el Centroide X/Y/Z.");
        return;
      }

      // Las muestras interpoladas por Desde/Hasta necesitan la traza 3D ya
      // desurveyada del sondaje. Como el Web Worker se ejecuta en un hilo
      // aparte y no comparte memoria con la app, se le envían las trazas ya
      // calculadas (si hay sondajes cargados) dentro del mismo payload.
      const traces = (app.drillholeData && app.drillholeData.traces) ? app.drillholeData.traces : {};

      const attributes = [];
      const chks = document.querySelectorAll('.sample-import-chk:checked');
      chks.forEach(chk => {
        const index = parseInt(chk.dataset.index);
        const name = chk.dataset.name;
        const typeSelect = document.querySelector(`.sample-type-select[data-index="${index}"]`);
        attributes.push({
          index,
          name,
          type: typeSelect ? typeSelect.value : 'number'
        });
      });

      const payload = {
        file: this.modalFiles.samples,
        mappings: {
          holeId: holeIdCol,
          from: fromCol, to: toCol,
          midx: midxCol, midy: midyCol, midz: midzCol,
          attributes
        },
        options: { startRow },
        traces
      };

      this.closeImportModal();
      app.runWorkerParser('parse_samples', payload);
    }
  }
}
