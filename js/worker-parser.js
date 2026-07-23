// Web Worker para parseo de CSV y algoritmos pesados (Curvatura Mínima, etc.)
// No tiene dependencias de módulos para poder correr de forma nativa en cualquier navegador.

// DxfParser vive en su propio archivo (compartido con el resto de la app);
// lo importamos aquí para poder parsear DXF dentro del worker (ver parseDxf()).
importScripts('dxf-parser.js');

self.onmessage = function(e) {
  const { action, payload } = e.data;

  if (action === 'parse_drillholes') {
    parseDrillholes(payload);
  } else if (action === 'parse_blocks') {
    parseBlocks(payload);
  } else if (action === 'parse_samples') {
    parseSamples(payload);
  } else if (action === 'parse_dxf') {
    parseDxf(payload);
  } else if (action === 'generate_synthetic') {
    generateSyntheticData(payload);
  }
};

// ==========================================
// GENERADOR DE DATOS GEOLÓGICOS SINTÉTICOS
// ==========================================
function generateSyntheticData(payload) {
  const blockCount = payload.blockCount || 1000000;
  postMessage({ type: 'progress', percent: 10, message: `Iniciando generación de ${blockCount.toLocaleString()} bloques sintéticos...` });
  
  const positions = new Float32Array(blockCount * 3);
  const sizes = new Float32Array(blockCount * 3);
  const cuBuffer = new Float32Array(blockCount);
  const litBuffer = new Uint16Array(blockCount);
  
  const categoryLookups = {
    "Litologia": ["Porfido", "Granito", "Dacita", "Grava"]
  };
  
  // Calcular dimensiones de grilla
  const size = Math.ceil(Math.pow(blockCount, 1/3));
  const Nx = size;
  const Ny = size;
  const Nz = Math.ceil(blockCount / (Nx * Ny));
  
  let minX = 0, maxX = Nx * 10;
  let minY = 0, maxY = Ny * 10;
  let minZ = 0, maxZ = Nz * 10;
  
  let idx = 0;
  for (let z = 0; z < Nz && idx < blockCount; z++) {
    for (let y = 0; y < Ny && idx < blockCount; y++) {
      for (let x = 0; x < Nx && idx < blockCount; x++) {
        const idx3 = idx * 3;
        
        // Centroides locales (grilla de 10m)
        positions[idx3] = x * 10.0 + 5.0;
        positions[idx3 + 1] = y * 10.0 + 5.0;
        positions[idx3 + 2] = z * 10.0 + 5.0;
        
        sizes[idx3] = 10.0;
        sizes[idx3 + 1] = 10.0;
        sizes[idx3 + 2] = 10.0;
        
        // Simular distribución de cobre (más alta en el centro)
        const dx = x - Nx/2;
        const dy = y - Ny/2;
        const dz = z - Nz/2;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) / (Nx/2);
        
        // Ley de cobre simulada
        const cuGrade = Math.max(0.01, (2.0 - dist * 1.6) + Math.random() * 0.4);
        cuBuffer[idx] = cuGrade;
        
        // Litología según profundidad y distancia al núcleo
        let litCode = 1; // Granito (caja)
        if (z > Nz - 4) {
          litCode = 3; // Grava estéril de recubrimiento
          cuBuffer[idx] = 0.01;
        } else if (dist < 0.25) {
          litCode = 0; // Núcleo Porfídico rico
          cuBuffer[idx] += 0.5;
        } else if (dist < 0.6) {
          litCode = 2; // Dacita intermedia
        }
        
        litBuffer[idx] = litCode;
        idx++;
      }
    }
    
    if (z % 5 === 0) {
      const pct = Math.floor(10 + (idx / blockCount) * 80);
      postMessage({ type: 'progress', percent: pct, message: `Generando bloque ${idx.toLocaleString()}...` });
    }
  }
  
  postMessage({ type: 'progress', percent: 95, message: 'Ensamblando buffers transferibles...' });
  
  const data = {
    count: idx,
    positions: positions.subarray(0, idx * 3),
    sizes: sizes.subarray(0, idx * 3),
    attributes: {
      "Ley_Cu": cuBuffer.subarray(0, idx),
      "Litologia": litBuffer.subarray(0, idx)
    },
    categoryLookups,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    attributeMetadata: [
      { name: "Ley_Cu", type: "number" },
      { name: "Litologia", type: "category" }
    ]
  };
  
  const transferables = [
    data.positions.buffer,
    data.sizes.buffer,
    data.attributes["Ley_Cu"].buffer,
    data.attributes["Litologia"].buffer
  ];
  
  postMessage({ type: 'progress', percent: 100, message: 'Datos sintéticos generados con éxito.' });
  postMessage({ type: 'complete_synthetic', data }, transferables);
}

// ==========================================
// PARSER DE CSV ULTRA-LEAN Y DE ALTO RENDIMIENTO
// ==========================================
function detectSeparator(line) {
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

function parseCSVLines(file, startRow, callback) {
  const reader = new FileReaderSync();
  const text = reader.readAsText(file);
  const len = text.length;
  let pos = 0;
  let lineIdx = 0;
  
  let separator = ',';
  let detected = false;
  
  // Función para parsear una línea CSV respetando comillas y delimitador dinámico
  function parseCSVLine(line, sep) {
    // Delimitador por espacios (típico de .asc de modelos de bloques): ancho
    // variable, sin soporte de comillas.
    if (sep === ' ') {
      return line.trim().split(/\s+/);
    }

    const result = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === sep && !inQuotes) {
        result.push(cur.trim());
        cur = "";
      } else {
        cur += char;
      }
    }
    result.push(cur.trim());
    return result;
  }

  while (pos < len) {
    let nextNewline = text.indexOf('\n', pos);
    if (nextNewline === -1) nextNewline = len;
    
    const line = text.substring(pos, nextNewline).trim();
    pos = nextNewline + 1;
    
    lineIdx++;
    if (lineIdx < startRow) continue;
    if (!line) continue;
    
    if (!detected) {
      separator = detectSeparator(line);
      detected = true;
    }
    
    const fields = parseCSVLine(line, separator);
    callback(fields, lineIdx);
  }
}

// Extrae los encabezados de un archivo CSV
function getCSVHeaders(file, headerRow) {
  const reader = new FileReaderSync();
  // Solo leemos los primeros 50KB para obtener los headers rápidamente
  const blobSlice = file.slice(0, 50000);
  const text = reader.readAsText(blobSlice);
  
  const lines = text.split(/\r?\n/);
  const headerLine = lines[headerRow - 1] || "";
  
  const separator = detectSeparator(headerLine);

  // Parseo rápido de la línea de headers usando el delimitador detectado
  if (separator === ' ') {
    return headerLine.trim().split(/\s+/);
  }

  const headers = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < headerLine.length; i++) {
    const char = headerLine[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === separator && !inQuotes) {
      headers.push(cur.trim());
      cur = "";
    } else {
      cur += char;
    }
  }
  headers.push(cur.trim());
  return headers;
}

// Helper para limpiar números con comas decimales (común en datasets en español)
function cleanNumericString(s) {
  if (typeof s !== 'string') return s;
  let str = s.trim();
  if (!str) return null;
  
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');
  
  if (hasComma && hasDot) {
    if (str.indexOf(',') < str.indexOf('.')) {
      // 1,234.56 -> 1234.56
      str = str.replace(/,/g, '');
    } else {
      // 1.234,56 -> 1234.56
      str = str.replace(/\./g, '').replace(',', '.');
    }
  } else if (hasComma) {
    // 0,15 -> 0.15
    str = str.replace(',', '.');
  }
  return str;
}

// Helper para convertir valor a tipo correspondiente
function parseValue(val, type) {
  if (val === undefined || val === null || val === '') return null;
  if (type === 'number') {
    const cleanStr = cleanNumericString(val);
    if (cleanStr === null) return null;
    const num = parseFloat(cleanStr);
    return isNaN(num) ? null : num;
  }
  return val.toString().trim(); // Text/Category
}

// ==========================================
// PROCESAMIENTO DE SONDAJES
// ==========================================
function parseDrillholes(payload) {
  const { files, mappings, options } = payload;
  const startRow = options.startRow || 2;
  const warnings = [];
  const errors = [];
  
  // 1. Cargar Collares
  postMessage({ type: 'progress', percent: 10, message: 'Parseando collares...' });
  const collars = {}; // HoleID -> {x, y, z}
  let collarCount = 0;
  
  if (files.collar) {
    try {
      parseCSVLines(files.collar, startRow, (fields, lineIdx) => {
        const holeId = fields[mappings.collar.holeId];
        const x = parseFloat(fields[mappings.collar.x]);
        const y = parseFloat(fields[mappings.collar.y]);
        const z = parseFloat(fields[mappings.collar.z]);
        
        if (!holeId) {
          warnings.push({ file: 'Collar', line: lineIdx, msg: 'Fila sin HoleID' });
          return;
        }
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          warnings.push({ file: 'Collar', line: lineIdx, msg: `Coordenadas inválidas para sondaje ${holeId}` });
          return;
        }
        collars[holeId] = { x, y, z, maxDepth: 0 };
        collarCount++;
      });
    } catch (err) {
      errors.push({ msg: `Error fatal leyendo Collar CSV: ${err.message}` });
      postMessage({ type: 'error', errors, warnings });
      return;
    }
  } else {
    errors.push({ msg: 'El archivo Collar es requerido para posicionar los sondajes.' });
    postMessage({ type: 'error', errors, warnings });
    return;
  }
  
  // 2. Cargar Surveys (Trayectorias)
  postMessage({ type: 'progress', percent: 30, message: 'Parseando trayectorias (Survey)...' });
  const surveys = {}; // HoleID -> [{depth, azimuth, dip}]
  let surveyCount = 0;
  
  if (files.survey) {
    try {
      parseCSVLines(files.survey, startRow, (fields, lineIdx) => {
        const holeId = fields[mappings.survey.holeId];
        const depth = parseFloat(fields[mappings.survey.depth]);
        const azimuth = parseFloat(fields[mappings.survey.azimuth]);
        const dip = parseFloat(fields[mappings.survey.dip]);
        
        if (!holeId) return;
        if (isNaN(depth) || isNaN(azimuth) || isNaN(dip)) {
          warnings.push({ file: 'Survey', line: lineIdx, msg: `Valores de survey inválidos para sondaje ${holeId}` });
          return;
        }
        
        if (!collars[holeId]) {
          warnings.push({ file: 'Survey', line: lineIdx, msg: `Medición de Survey para sondaje ${holeId} sin registro en Collar` });
        }
        
        if (!surveys[holeId]) surveys[holeId] = [];
        surveys[holeId].push({ depth, azimuth, dip });
        surveyCount++;
      });
    } catch (err) {
      errors.push({ msg: `Error fatal leyendo Survey CSV: ${err.message}` });
      postMessage({ type: 'error', errors, warnings });
      return;
    }
  }

  // 3. Realizar Desurvey (Mínima Curvatura)
  postMessage({ type: 'progress', percent: 50, message: 'Calculando trazas 3D (Curvatura Mínima)...' });
  const traces = {}; // HoleID -> array de puntos {depth, x, y, z, dx, dy, dz}
  
  for (const holeId in collars) {
    const collar = collars[holeId];
    const holeSurveys = surveys[holeId] || [];
    
    // Ordenar surveys por profundidad
    holeSurveys.sort((a, b) => a.depth - b.depth);
    
    // Si no hay survey en profundidad 0, inyectamos el inicial usando las orientaciones del primero
    // o asumiendo vertical hacia abajo (dip = -90, azimuth = 0) si no hay surveys.
    if (holeSurveys.length === 0 || holeSurveys[0].depth > 0) {
      const initDip = holeSurveys.length > 0 ? holeSurveys[0].dip : -90;
      const initAz = holeSurveys.length > 0 ? holeSurveys[0].azimuth : 0;
      holeSurveys.unshift({ depth: 0, azimuth: initAz, dip: initDip });
    }
    
    const trace = [];
    
    // Nodo inicial (profundidad 0) en la coordenada del collar
    const initRadDip = holeSurveys[0].dip * Math.PI / 180;
    const initRadAz = holeSurveys[0].azimuth * Math.PI / 180;
    const initDx = Math.cos(initRadDip) * Math.sin(initRadAz);
    const initDy = Math.cos(initRadDip) * Math.cos(initRadAz);
    const initDz = Math.sin(initRadDip);
    
    trace.push({
      depth: 0,
      x: collar.x,
      y: collar.y,
      z: collar.z,
      dip: holeSurveys[0].dip,
      azimuth: holeSurveys[0].azimuth,
      dx: initDx,
      dy: initDy,
      dz: initDz
    });
    
    // Calcular tramos mediante Curvatura Mínima
    for (let i = 1; i < holeSurveys.length; i++) {
      const p1 = trace[trace.length - 1];
      const p2 = holeSurveys[i];
      
      const dMD = p2.depth - p1.depth;
      if (dMD <= 0) {
        warnings.push({ file: 'Survey', msg: `Intervalo de profundidad duplicado o inverso en sondaje ${holeId} en depth ${p2.depth}` });
        continue;
      }
      
      const d2 = p2.dip * Math.PI / 180;
      const a2 = p2.azimuth * Math.PI / 180;
      
      const dx2 = Math.cos(d2) * Math.sin(a2);
      const dy2 = Math.cos(d2) * Math.cos(a2);
      const dz2 = Math.sin(d2);
      
      // Calcular ángulo beta (Dogleg severity)
      const cosBeta = Math.min(1.0, Math.max(-1.0, p1.dx * dx2 + p1.dy * dy2 + p1.dz * dz2));
      const beta = Math.acos(cosBeta);
      
      let rf = 1.0;
      if (beta > 1e-6) {
        rf = (2 / beta) * Math.tan(beta / 2);
      }
      
      const x = p1.x + (dMD / 2) * (p1.dx + dx2) * rf;
      const y = p1.y + (dMD / 2) * (p1.dy + dy2) * rf;
      const z = p1.z + (dMD / 2) * (p1.dz + dz2) * rf;
      
      trace.push({
        depth: p2.depth,
        x, y, z,
        dip: p2.dip,
        azimuth: p2.azimuth,
        dx: dx2,
        dy: dy2,
        dz: dz2
      });
    }
    
    traces[holeId] = trace;
    collar.maxDepth = trace[trace.length - 1].depth;
  }

  // Función de interpolación de posición a lo largo de la traza calculada
  function getPositionAtDepth(trace, depth) {
    if (trace.length === 0) return [0, 0, 0];
    if (depth <= 0) return [trace[0].x, trace[0].y, trace[0].z];
    
    const lastNode = trace[trace.length - 1];
    if (depth >= lastNode.depth) {
      // Extrapolar linealmente usando la dirección del último nodo
      const dMD = depth - lastNode.depth;
      return [
        lastNode.x + dMD * lastNode.dx,
        lastNode.y + dMD * lastNode.dy,
        lastNode.z + dMD * lastNode.dz
      ];
    }
    
    // Buscar el segmento que contiene depth
    let i = 0;
    while (i < trace.length - 1 && trace[i + 1].depth < depth) {
      i++;
    }
    
    const p1 = trace[i];
    const p2 = trace[i + 1];
    
    const dMD = p2.depth - p1.depth;
    if (dMD <= 0) return [p1.x, p1.y, p1.z];
    
    const t = (depth - p1.depth) / dMD;
    
    // Slerp de los vectores de dirección para cumplir con Curvatura Mínima
    const cosBeta = Math.min(1.0, Math.max(-1.0, p1.dx * p2.dx + p1.dy * p2.dy + p1.dz * p2.dz));
    const beta = Math.acos(cosBeta);
    
    let dx, dy, dz;
    let rf = 1.0;
    const targetBeta = beta * t;
    
    if (beta > 1e-6) {
      const sinBeta = Math.sin(beta);
      const f1 = Math.sin((1 - t) * beta) / sinBeta;
      const f2 = Math.sin(t * beta) / sinBeta;
      dx = f1 * p1.dx + f2 * p2.dx;
      dy = f1 * p1.dy + f2 * p2.dy;
      dz = f1 * p1.dz + f2 * p2.dz;
      
      if (targetBeta > 1e-6) {
        rf = (2 / targetBeta) * Math.tan(targetBeta / 2);
      }
    } else {
      dx = p1.dx;
      dy = p1.dy;
      dz = p1.dz;
    }
    
    const deltaD = depth - p1.depth;
    const x = p1.x + (deltaD / 2) * (p1.dx + dx) * rf;
    const y = p1.y + (deltaD / 2) * (p1.dy + dy) * rf;
    const z = p1.z + (deltaD / 2) * (p1.dz + dz) * rf;
    
    return [x, y, z];
  }

  // 4. Cargar Ensayos (Assays)
  postMessage({ type: 'progress', percent: 70, message: 'Procesando tramos de ensayos (Assays)...' });
  const intervals = [];
  const assayCols = mappings.assays.valueCols; // Array de {index, name, type}
  
  // Preparar lookups para columnas catégoricas de assays
  const assayCategoryLookups = {};
  assayCols.forEach(col => {
    if (col.type === 'category') {
      assayCategoryLookups[col.name] = [];
    }
  });
  
  if (files.assays) {
    try {
      const assayIntervalsCheck = {}; // HoleID -> [{from, to}] para chequear traslapes
      
      parseCSVLines(files.assays, startRow, (fields, lineIdx) => {
        const holeId = fields[mappings.assays.holeId];
        const from = parseFloat(fields[mappings.assays.from]);
        const to = parseFloat(fields[mappings.assays.to]);
        
        if (!holeId) return;
        if (isNaN(from) || isNaN(to) || from >= to || from < 0) {
          warnings.push({ file: 'Assays', line: lineIdx, msg: `Intervalo inválido [${from} - ${to}] en sondaje ${holeId}` });
          return;
        }
        
        const trace = traces[holeId];
        if (!trace) {
          warnings.push({ file: 'Assays', line: lineIdx, msg: `Sondaje ${holeId} en Assays no existe en Collar` });
          return;
        }
        
        // Validación de traslapes básicos
        if (!assayIntervalsCheck[holeId]) assayIntervalsCheck[holeId] = [];
        const checkList = assayIntervalsCheck[holeId];
        for (const item of checkList) {
          if (from < item.to && to > item.from) {
            warnings.push({ file: 'Assays', line: lineIdx, msg: `Intervalo traslapado [${from} - ${to}] con [${item.from} - ${item.to}] en sondaje ${holeId}` });
          }
        }
        checkList.push({ from, to });
        
        // Calcular posiciones 3D de inicio y fin
        const startPos = getPositionAtDepth(trace, from);
        const endPos = getPositionAtDepth(trace, to);
        
        // Extraer valores de ensayos respetando el tipo de cada columna
        const values = {};
        for (const col of assayCols) {
          const rawVal = fields[col.index];
          if (col.type === 'category') {
            // Guardar como string limpio
            const strVal = (rawVal !== undefined && rawVal !== null) ? rawVal.toString().trim() : '';
            values[col.name] = strVal;
            // Agregar al lookup si no existe
            const lookup = assayCategoryLookups[col.name];
            if (strVal && !lookup.includes(strVal)) {
              lookup.push(strVal);
            }
          } else {
            // Numérico: limpiar separadores decimales
            values[col.name] = parseValue(rawVal, 'number');
          }
        }
        
        intervals.push({
          holeId,
          from,
          to,
          startPos,
          endPos,
          values,
          type: 'assay'
        });
      });
    } catch (err) {
      errors.push({ msg: `Error fatal leyendo Assays CSV: ${err.message}` });
      postMessage({ type: 'error', errors, warnings });
      return;
    }
  }

  // 5. Cargar Geología si viene
  if (files.geology && mappings.geology) {
    postMessage({ type: 'progress', percent: 85, message: 'Procesando geología...' });
    try {
      const geoCols = mappings.geology.valueCols;
      parseCSVLines(files.geology, startRow, (fields, lineIdx) => {
        const holeId = fields[mappings.geology.holeId];
        const from = parseFloat(fields[mappings.geology.from]);
        const to = parseFloat(fields[mappings.geology.to]);
        
        if (!holeId || isNaN(from) || isNaN(to) || from >= to) return;
        
        const trace = traces[holeId];
        if (!trace) return;
        
        const startPos = getPositionAtDepth(trace, from);
        const endPos = getPositionAtDepth(trace, to);
        
        const values = {};
        for (const col of geoCols) {
          values[col.name] = fields[col.index] || '';
        }
        
        intervals.push({
          holeId,
          from,
          to,
          startPos,
          endPos,
          values,
          type: 'geology'
        });
      });
    } catch (err) {
      warnings.push({ file: 'Geology', msg: `No se pudo parsear el archivo de geología: ${err.message}` });
    }
  }

  postMessage({ type: 'progress', percent: 100, message: 'Procesamiento de sondajes finalizado.' });
  
  // Construir metadata de atributos de assays para el renderizador
  const assayMetadata = assayCols.map(col => ({
    name: col.name,
    type: col.type || 'number'
  }));
  
  // Enviamos los datos ordenados
  postMessage({
    type: 'complete',
    data: {
      collars,
      traces,
      intervals,
      assayMetadata,
      assayCategoryLookups,
      // Nombres de los archivos de origen (Collar/Survey/Assays/Geología),
      // para poder mostrarlos como anotación en las Vistas exportadas.
      sourceFileNames: {
        collar: files.collar ? files.collar.name : null,
        survey: files.survey ? files.survey.name : null,
        assays: files.assays ? files.assays.name : null,
        geology: files.geology ? files.geology.name : null
      }
    },
    warnings,
    errors
  });
}

// ==========================================
// PROCESAMIENTO DE MODELO DE BLOQUES
// ==========================================
// ==========================================
// FILTRO PREVIO A LA CARGA (Modelo de Bloques)
// ==========================================
/**
 * Evalúa una única condición de filtro previo contra el valor crudo de una
 * columna. Si ambos lados (campo y valor de referencia) son numéricos, se
 * compara numéricamente (caso típico: leyes como CUT > 0.2); si no, se
 * compara como texto normalizado (útil para litologías/categorías), donde
 * solo igualdad/desigualdad tienen sentido — los operadores de orden (>, >=,
 * <, <=) no descartan la fila en ese caso.
 */
function evaluatePrefilterCondition(rawField, operator, rawValue) {
  const fieldNum = parseFloat(cleanNumericString(rawField));
  const valNum = parseFloat(cleanNumericString(rawValue));
  const bothNumeric = !isNaN(fieldNum) && !isNaN(valNum);

  if (bothNumeric) {
    switch (operator) {
      case '>': return fieldNum > valNum;
      case '>=': return fieldNum >= valNum;
      case '<': return fieldNum < valNum;
      case '<=': return fieldNum <= valNum;
      case '=': return fieldNum === valNum;
      case '!=': return fieldNum !== valNum;
      default: return true;
    }
  }

  const fieldStr = (rawField === undefined || rawField === null ? '' : rawField).toString().trim().toLowerCase();
  const valStr = (rawValue === undefined || rawValue === null ? '' : rawValue).toString().trim().toLowerCase();
  switch (operator) {
    case '=': return fieldStr === valStr;
    case '!=': return fieldStr !== valStr;
    default: return true; // >,>=,<,<= no aplican a texto: no descarta la fila
  }
}

/** Devuelve true si la fila (array de campos crudos) cumple TODAS las condiciones del filtro previo. */
function rowPassesPrefilters(fields, prefilters) {
  if (!prefilters || prefilters.length === 0) return true;
  for (let i = 0; i < prefilters.length; i++) {
    const f = prefilters[i];
    if (!evaluatePrefilterCondition(fields[f.index], f.operator, f.value)) return false;
  }
  return true;
}

function parseBlocks(payload) {
  const { file, mappings, options } = payload;
  const startRow = options.startRow || 2;
  const warnings = [];
  const errors = [];
  
  postMessage({ type: 'progress', percent: 10, message: 'Preparando importación de modelo de bloques...' });

  const prefilters = mappings.prefilters || [];

  // Contar filas totales para dimensionar los arrays tipados. Si hay filtro
  // previo, se cuentan solo las filas que lo cumplen: así los TypedArrays se
  // reservan del tamaño exacto de lo que realmente se va a cargar, en vez
  // del tamaño del archivo completo — esto es lo que reduce el uso de RAM.
  let totalRows = 0;
  let totalRawRows = 0;
  try {
    parseCSVLines(file, startRow, (fields) => {
      totalRawRows++;
      if (rowPassesPrefilters(fields, prefilters)) totalRows++;
    });
  } catch (err) {
    errors.push({ msg: `Error leyendo el archivo para preconteo: ${err.message}` });
    postMessage({ type: 'error', errors, warnings });
    return;
  }

  if (totalRows === 0) {
    const msg = prefilters.length > 0
      ? 'Ninguna fila del archivo cumple las condiciones del filtro previo definido.'
      : 'El archivo de bloques no contiene registros de datos.';
    errors.push({ msg });
    postMessage({ type: 'error', errors, warnings });
    return;
  }

  if (prefilters.length > 0) {
    postMessage({ type: 'progress', percent: 15, message: `Filtro previo aplicado: ${totalRows.toLocaleString()} de ${totalRawRows.toLocaleString()} filas cumplen las condiciones (${prefilters.map(f => `${f.name} ${f.operator} ${f.value}`).join(' Y ')}).` });
  }

  postMessage({ type: 'progress', percent: 20, message: `Filas a cargar: ${totalRows.toLocaleString()}. Dimensionando memoria de GPU simulada...` });
  
  // Reservar memoria en arrays planos (TypedArrays)
  // Posiciones: X, Y, Z por cada bloque -> totalRows * 3
  const positions = new Float32Array(totalRows * 3);
  // Dimensiones: DX, DY, DZ por cada bloque -> totalRows * 3
  const sizes = new Float32Array(totalRows * 3);
  
  // Para los atributos adicionales de coloreo/filtro
  const attributeNames = mappings.attributes.map(a => a.name);
  const attributeTypes = mappings.attributes.map(a => a.type); // 'number' o 'category'
  
  const attributeBuffers = {};
  const categoryLookups = {}; // attrName -> array de strings ['LIT1', 'LIT2']
  
  mappings.attributes.forEach(attr => {
    if (attr.type === 'number') {
      attributeBuffers[attr.name] = new Float32Array(totalRows);
    } else {
      // Categóricos se guardan como enteros indexados (Uint16Array soporta hasta 65,535 categorías)
      attributeBuffers[attr.name] = new Uint16Array(totalRows);
      categoryLookups[attr.name] = [];
    }
  });

  // Límites globales
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  let blockIdx = 0;
  const globalDX = parseFloat(options.defaultDX) || 10;
  const globalDY = parseFloat(options.defaultDY) || 10;
  const globalDZ = parseFloat(options.defaultDZ) || 10;
  
  postMessage({ type: 'progress', percent: 30, message: 'Cargando y codificando modelo de bloques...' });
  
  try {
    parseCSVLines(file, startRow, (fields, lineIdx) => {
      if (!rowPassesPrefilters(fields, prefilters)) return;

      const x = parseFloat(cleanNumericString(fields[mappings.x]));
      const y = parseFloat(cleanNumericString(fields[mappings.y]));
      const z = parseFloat(cleanNumericString(fields[mappings.z]));
      
      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        if (blockIdx % 1000 === 0) {
          warnings.push({ file: 'Blocks', line: lineIdx, msg: 'Coordenadas del centroide inválidas' });
        }
        return;
      }
      
      // DX, DY, DZ (pueden venir mapeados en columna o usar default global)
      let dx = globalDX;
      let dy = globalDY;
      let dz = globalDZ;
      
      if (mappings.dx !== undefined && mappings.dx !== -1) dx = parseFloat(cleanNumericString(fields[mappings.dx])) || globalDX;
      if (mappings.dy !== undefined && mappings.dy !== -1) dy = parseFloat(cleanNumericString(fields[mappings.dy])) || globalDY;
      if (mappings.dz !== undefined && mappings.dz !== -1) dz = parseFloat(cleanNumericString(fields[mappings.dz])) || globalDZ;
      
      // Guardar en arrays planos de posiciones y dimensiones
      const idx3 = blockIdx * 3;
      positions[idx3] = x;
      positions[idx3 + 1] = y;
      positions[idx3 + 2] = z;
      
      sizes[idx3] = dx;
      sizes[idx3 + 1] = dy;
      sizes[idx3 + 2] = dz;
      
      // Actualizar límites globales
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      
      // Codificar atributos
      mappings.attributes.forEach((attr) => {
        const rawVal = fields[attr.index];
        const buf = attributeBuffers[attr.name];
        
        if (attr.type === 'number') {
          const val = parseFloat(rawVal);
          buf[blockIdx] = isNaN(val) ? -999.0 : val; // -999 indica valor nulo/ausente
        } else {
          // Categoría string -> mapear a ID numérico
          const strVal = (rawVal || 'N/A').trim();
          const lookup = categoryLookups[attr.name];
          let catId = lookup.indexOf(strVal);
          if (catId === -1) {
            catId = lookup.length;
            lookup.push(strVal);
          }
          buf[blockIdx] = catId;
        }
      });
      
      blockIdx++;
      
      // Reportar progreso cada 100k bloques
      if (blockIdx % 100000 === 0) {
        const percent = Math.floor(30 + (blockIdx / totalRows) * 60);
        postMessage({
          type: 'progress',
          percent: percent,
          message: `Codificando bloque ${blockIdx.toLocaleString()} de ${totalRows.toLocaleString()}...`
        });
      }
    });
  } catch (err) {
    errors.push({ msg: `Error fatal parseando Bloques: ${err.message}` });
    postMessage({ type: 'error', errors, warnings });
    return;
  }
  
  postMessage({ type: 'progress', percent: 95, message: 'Finalizando indexación y construyendo resultados...' });
  
  // Ajustar arrays si hubo filas descartadas por coordenadas inválidas
  let finalPositions = positions;
  let finalSizes = sizes;
  let finalAttributeBuffers = attributeBuffers;
  
  if (blockIdx < totalRows) {
    finalPositions = positions.subarray(0, blockIdx * 3);
    finalSizes = sizes.subarray(0, blockIdx * 3);
    mappings.attributes.forEach(attr => {
      finalAttributeBuffers[attr.name] = attributeBuffers[attr.name].subarray(0, blockIdx);
    });
  }
  
  // Estructura de transferencia
  const transferableList = [finalPositions.buffer, finalSizes.buffer];
  mappings.attributes.forEach(attr => {
    transferableList.push(finalAttributeBuffers[attr.name].buffer);
  });
  
  postMessage({
    type: 'complete',
    data: {
      count: blockIdx,
      positions: finalPositions,
      sizes: finalSizes,
      attributes: finalAttributeBuffers,
      categoryLookups,
      bounds: { minX, maxX, minY, maxY, minZ, maxZ },
      attributeMetadata: mappings.attributes,
      sourceFileName: file ? file.name : null
    },
    warnings,
    errors
  }, transferableList);
}

// ==========================================
// PROCESAMIENTO DE MUESTRAS METALÚRGICAS
// ==========================================
// Muestras identificadas por HoleID + Desde/Hasta (se interpola su posición
// sobre la traza 3D ya desurveyada del sondaje correspondiente, recibida
// desde el hilo principal en payload.traces) o, si el CSV ya trae columnas
// de centroide (midx, midy, midz), se usa esa posición directamente sin
// necesidad de interpolar ni de tener sondajes cargados.
//
// Función de interpolación de posición a lo largo de una traza — misma
// lógica de Curvatura Mínima (slerp de vectores de dirección) que la usada
// internamente en parseDrillholes(), extraída aquí como función de nivel
// superior para poder reutilizarla también desde parseSamples().
function getPositionAtDepth(trace, depth) {
  if (!trace || trace.length === 0) return null;
  if (depth <= 0) return [trace[0].x, trace[0].y, trace[0].z];

  const lastNode = trace[trace.length - 1];
  if (depth >= lastNode.depth) {
    const dMD = depth - lastNode.depth;
    return [
      lastNode.x + dMD * lastNode.dx,
      lastNode.y + dMD * lastNode.dy,
      lastNode.z + dMD * lastNode.dz
    ];
  }

  let i = 0;
  while (i < trace.length - 1 && trace[i + 1].depth < depth) {
    i++;
  }

  const p1 = trace[i];
  const p2 = trace[i + 1];

  const dMD = p2.depth - p1.depth;
  if (dMD <= 0) return [p1.x, p1.y, p1.z];

  const t = (depth - p1.depth) / dMD;

  const cosBeta = Math.min(1.0, Math.max(-1.0, p1.dx * p2.dx + p1.dy * p2.dy + p1.dz * p2.dz));
  const beta = Math.acos(cosBeta);

  let dx, dy, dz;
  let rf = 1.0;
  const targetBeta = beta * t;

  if (beta > 1e-6) {
    const sinBeta = Math.sin(beta);
    const f1 = Math.sin((1 - t) * beta) / sinBeta;
    const f2 = Math.sin(t * beta) / sinBeta;
    dx = f1 * p1.dx + f2 * p2.dx;
    dy = f1 * p1.dy + f2 * p2.dy;
    dz = f1 * p1.dz + f2 * p2.dz;

    if (targetBeta > 1e-6) {
      rf = (2 / targetBeta) * Math.tan(targetBeta / 2);
    }
  } else {
    dx = p1.dx;
    dy = p1.dy;
    dz = p1.dz;
  }

  const deltaD = depth - p1.depth;
  const x = p1.x + (deltaD / 2) * (p1.dx + dx) * rf;
  const y = p1.y + (deltaD / 2) * (p1.dy + dy) * rf;
  const z = p1.z + (deltaD / 2) * (p1.dz + dz) * rf;

  return [x, y, z];
}

function parseSamples(payload) {
  const { file, mappings, options, traces } = payload;
  const startRow = options.startRow || 2;
  const warnings = [];
  const errors = [];
  const hasTraces = traces && Object.keys(traces).length > 0;
  const hasCentroidCols = mappings.midx !== -1 && mappings.midy !== -1 && mappings.midz !== -1;
  const hasFromToCols = mappings.from !== -1 && mappings.to !== -1;

  if (!hasCentroidCols && !hasFromToCols) {
    errors.push({ msg: 'Debe mapear el Centroide (X/Y/Z) o el intervalo Desde/Hasta para posicionar las muestras.' });
    postMessage({ type: 'error', errors, warnings });
    return;
  }

  postMessage({ type: 'progress', percent: 10, message: 'Preparando importación de muestras metalúrgicas...' });

  const sampleCols = mappings.attributes; // Array de {index, name, type}
  const categoryLookups = {};
  sampleCols.forEach(col => {
    if (col.type === 'category') categoryLookups[col.name] = [];
  });

  const holeIds = [];
  const positionsArr = []; // [x,y,z, x,y,z, ...] como array normal (se convierte a Float32Array al final)
  const rawValues = []; // Array de objetos {name: valor} por muestra, mismo orden que holeIds

  let totalRows = 0;
  let skippedCount = 0;
  let usedCentroid = 0;
  let usedInterp = 0;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  postMessage({ type: 'progress', percent: 30, message: 'Leyendo y posicionando muestras...' });

  try {
    parseCSVLines(file, startRow, (fields, lineIdx) => {
      totalRows++;
      const holeId = fields[mappings.holeId];

      if (!holeId) {
        skippedCount++;
        if (skippedCount <= 30) {
          warnings.push({ file: 'Samples', line: lineIdx, msg: 'Fila sin HoleID, muestra omitida' });
        }
        return;
      }

      let pos = null;

      // 1. Preferir centroide directo si el CSV lo trae y los valores son válidos
      if (hasCentroidCols) {
        const mx = parseFloat(cleanNumericString(fields[mappings.midx]));
        const my = parseFloat(cleanNumericString(fields[mappings.midy]));
        const mz = parseFloat(cleanNumericString(fields[mappings.midz]));
        if (!isNaN(mx) && !isNaN(my) && !isNaN(mz)) {
          pos = [mx, my, mz];
          usedCentroid++;
        }
      }

      // 2. Si no hay centroide válido, interpolar sobre la traza del sondaje usando Desde/Hasta
      if (!pos && hasFromToCols) {
        const from = parseFloat(cleanNumericString(fields[mappings.from]));
        const to = parseFloat(cleanNumericString(fields[mappings.to]));

        if (isNaN(from) || isNaN(to) || from > to) {
          skippedCount++;
          if (skippedCount <= 30) {
            warnings.push({ file: 'Samples', line: lineIdx, msg: `Intervalo Desde/Hasta inválido en sondaje ${holeId}, muestra omitida` });
          }
          return;
        }

        const trace = hasTraces ? traces[holeId] : null;
        if (!trace) {
          skippedCount++;
          if (skippedCount <= 30) {
            warnings.push({ file: 'Samples', line: lineIdx, msg: `Sondaje ${holeId} no está cargado (o sin traza calculada); muestra omitida` });
          }
          return;
        }

        const midDepth = (from + to) / 2;
        pos = getPositionAtDepth(trace, midDepth);
        usedInterp++;
      }

      if (!pos) {
        skippedCount++;
        if (skippedCount <= 30) {
          warnings.push({ file: 'Samples', line: lineIdx, msg: `No fue posible posicionar la muestra del sondaje ${holeId} (sin centroide ni traza disponible), muestra omitida` });
        }
        return;
      }

      const [x, y, z] = pos;
      holeIds.push(holeId);
      positionsArr.push(x, y, z);

      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;

      const values = {};
      for (const col of sampleCols) {
        const rawVal = fields[col.index];
        if (col.type === 'category') {
          const strVal = (rawVal !== undefined && rawVal !== null) ? rawVal.toString().trim() : '';
          values[col.name] = strVal;
          const lookup = categoryLookups[col.name];
          if (strVal && !lookup.includes(strVal)) lookup.push(strVal);
        } else {
          values[col.name] = parseValue(rawVal, 'number');
        }
      }
      rawValues.push(values);

      if (holeIds.length % 20000 === 0) {
        postMessage({ type: 'progress', percent: 60, message: `Procesadas ${holeIds.length.toLocaleString()} muestras...` });
      }
    });
  } catch (err) {
    errors.push({ msg: `Error fatal leyendo CSV de Muestras: ${err.message}` });
    postMessage({ type: 'error', errors, warnings });
    return;
  }

  const count = holeIds.length;

  if (skippedCount > 0) {
    warnings.push({
      file: 'Samples',
      msg: `Resumen: ${skippedCount.toLocaleString()} de ${totalRows.toLocaleString()} muestras omitidas (sondaje no cargado, HoleID sin coincidencia, o datos de posición inválidos).`
    });
  }

  if (count === 0) {
    errors.push({ msg: 'Ninguna muestra pudo posicionarse. Revise que los sondajes referenciados estén cargados o que el CSV tenga columnas de centroide válidas.' });
    postMessage({ type: 'error', errors, warnings });
    return;
  }

  postMessage({ type: 'progress', percent: 85, message: 'Codificando atributos de muestras...' });

  // Construir arrays tipados finales
  const positions = new Float32Array(positionsArr);
  const attributeBuffers = {};
  sampleCols.forEach(col => {
    if (col.type === 'number') {
      attributeBuffers[col.name] = new Float32Array(count);
    } else {
      attributeBuffers[col.name] = new Uint16Array(count);
    }
  });

  for (let i = 0; i < count; i++) {
    const values = rawValues[i];
    for (const col of sampleCols) {
      const buf = attributeBuffers[col.name];
      if (col.type === 'number') {
        const val = values[col.name];
        buf[i] = (val === null || val === undefined || isNaN(val)) ? -999.0 : val;
      } else {
        const strVal = values[col.name] || 'N/A';
        const lookup = categoryLookups[col.name];
        let catId = lookup.indexOf(strVal);
        if (catId === -1) {
          catId = lookup.length;
          lookup.push(strVal);
        }
        buf[i] = catId;
      }
    }
  }

  const transferableList = [positions.buffer];
  sampleCols.forEach(col => transferableList.push(attributeBuffers[col.name].buffer));

  postMessage({ type: 'progress', percent: 100, message: `Muestras metalúrgicas procesadas: ${count.toLocaleString()} posicionadas (${usedCentroid.toLocaleString()} por centroide, ${usedInterp.toLocaleString()} interpoladas), ${skippedCount.toLocaleString()} omitidas.` });

  postMessage({
    type: 'complete',
    data: {
      count,
      positions,
      holeIds,
      attributes: attributeBuffers,
      categoryLookups,
      bounds: { minX, maxX, minY, maxY, minZ, maxZ },
      attributeMetadata: sampleCols,
      skippedCount,
      sourceFileName: file ? file.name : null
    },
    warnings,
    errors
  }, transferableList);
}

// ==========================================
// PROCESAMIENTO DE GEOMETRÍA DXF
// ==========================================
// Tamaño de cada trozo de lectura. Cualquier valor "chico" sirve (el archivo
// nunca se materializa completo en memoria como un solo string); 32MB es un
// buen equilibrio entre pocas vueltas de lectura y bajo uso de memoria pico.
const DXF_CHUNK_SIZE = 32 * 1024 * 1024;

/**
 * Lee un archivo DXF en trozos (chunks) de tamaño fijo y va alimentando cada
 * línea, a medida que se decodifica, directamente al parser incremental de
 * DxfParser (feedPair) — nunca se guarda un array con TODAS las líneas del
 * archivo en memoria.
 *
 * Esto reemplaza dos enfoques anteriores, ambos insuficientes para un DXF de
 * cientos de MB:
 *   1) FileReader.readAsText(file) completo + text.split('\n'): arma un
 *      único string con TODO el archivo, lo que puede superar el largo
 *      máximo de string que soportan los motores JS (V8/Chrome ronda los
 *      ~500MB-1GB) — la lectura fallaba en silencio (0 capas, sin error).
 *   2) Leer en trozos pero igual acumular TODAS las líneas ya separadas en
 *      un array antes de parsear: evita el límite de largo de string, pero
 *      para un DXF de 650MB con millones de entidades ese array puede tener
 *      decenas de millones de strings (varios GB en memoria), lo que hacía
 *      que la pestaña del navegador terminara por falta de memoria (el
 *      "Out of Memory" reportado).
 *
 * Con esta versión, lo único que hay en memoria en un momento dado es: el
 * trozo de texto actual (~32MB), un puñado de líneas sueltas del trozo, y la
 * geometría ya decodificada (triangles/lines), que es muchísimo más liviana
 * que el texto crudo — el uso de memoria ya no depende del tamaño del
 * archivo, solo de la cantidad de geometría real que contenga.
 *
 * Nota menor (igual que en la versión anterior): si un caracter multibyte
 * (no-ASCII) cae justo en el borde de un trozo, ese caracter puntual puede
 * decodificarse mal. Con ~20-30 cortes en un archivo de 650MB el riesgo de
 * que esto caiga justo sobre un dato relevante es despreciable.
 */
function readAndParseDxfChunked(file, state, onProgress) {
  const reader = new FileReaderSync();
  let leftover = '';
  // Línea de "código de grupo" pendiente de emparejar con su valor: como los
  // pares código/valor son siempre 2 líneas, un trozo puede terminar justo
  // después de una línea de código, dejando el valor para el próximo trozo.
  let pendingCode = null;
  let offset = 0;
  const total = file.size;

  function consumeLine(line) {
    if (pendingCode === null) {
      pendingCode = line;
    } else {
      state.feedPair(parseInt(pendingCode, 10), line);
      pendingCode = null;
    }
  }

  while (offset < total) {
    const end = Math.min(offset + DXF_CHUNK_SIZE, total);
    const blob = file.slice(offset, end);
    const chunkText = reader.readAsText(blob);

    const combined = leftover + chunkText;
    const parts = combined.split(/\r?\n/);
    // La última parte puede estar incompleta (el trozo no terminó justo en
    // un salto de línea); se guarda para unirla con el próximo trozo.
    leftover = parts.pop();

    for (let j = 0; j < parts.length; j++) {
      consumeLine(parts[j].trim());
    }

    offset = end;
    if (onProgress) onProgress(offset, total);
  }

  // Línea final (lo que quedó pendiente tras el último trozo)
  if (leftover.length > 0) {
    consumeLine(leftover.trim());
  }
  // Si queda un pendingCode sin su valor, el archivo terminó truncado a
  // mitad de un par — se ignora (no hay forma de completarlo).

  state.finish();
}

function parseDxf(payload) {
  const { file } = payload;
  const warnings = [];
  const errors = [];

  postMessage({ type: 'progress', percent: 2, message: `Leyendo ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB) en trozos...` });

  const state = DxfParser.createStreamParser();
  try {
    readAndParseDxfChunked(file, state, (offset, total) => {
      const pct = Math.floor(2 + (offset / total) * 88); // 2% -> 90%
      postMessage({ type: 'progress', percent: pct, message: `Leyendo e interpretando DXF: ${(offset / 1024 / 1024).toFixed(0)} MB de ${(total / 1024 / 1024).toFixed(0)} MB...` });
    });
  } catch (err) {
    errors.push({ msg: `Error al leer/parsear el archivo DXF: ${err.message}` });
    postMessage({ type: 'error', errors, warnings });
    return;
  }
  const rawLayers = state.layers;

  postMessage({ type: 'progress', percent: 92, message: 'Codificando geometría a buffers transferibles...' });

  // Convertir cada capa a Float32Array (las triangles salen de DxfParser como
  // array plano normal) y juntar todos los ArrayBuffers para transferencia
  // sin copia (zero-copy) de vuelta al hilo principal.
  const layers = {};
  const transferableList = [];
  let layerCount = 0, triCount = 0, lineCount = 0;

  for (const name in rawLayers) {
    const l = rawLayers[name];
    if (l.triangles.length === 0 && l.lines.length === 0) continue;

    const trianglesArr = new Float32Array(l.triangles);
    transferableList.push(trianglesArr.buffer);
    l.lines.forEach(lineBuf => transferableList.push(lineBuf.buffer));

    layers[name] = { triangles: trianglesArr, lines: l.lines, sourceFileName: file.name };
    layerCount++;
    triCount += trianglesArr.length / 9; // 3 vértices * 3 coords
    lineCount += l.lines.length;
  }

  if (layerCount === 0) {
    warnings.push({ msg: 'El DXF se leyó completo pero no se encontraron entidades soportadas (3DFACE, LINE, LWPOLYLINE o POLYLINE) dentro de una sección ENTITIES. Verifique que el archivo no dependa de BLOCKS/INSERT (aún no soportado) y que use estas entidades.' });
  }

  postMessage({ type: 'progress', percent: 100, message: 'DXF procesado.' });

  postMessage({
    type: 'complete',
    data: { layers, layerCount, triCount, lineCount },
    warnings,
    errors
  }, transferableList);
}
