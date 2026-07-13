/**
 * GeoMet V1 — Módulo Parser de Archivos DXF
 * Diseñado para leer archivos DXF ASCII livianos y medianos (topografías y contornos de minas).
 * Soporta entidades 3DFACE, LINE, LWPOLYLINE y POLYLINE simple.
 */

class DxfParser {
  /**
   * Crea un parser incremental ("streaming"): se le van entregando pares
   * código/valor uno a la vez con feedPair(code, val), en el mismo orden en
   * que aparecen en el archivo, y al final se llama finish(). Nunca necesita
   * tener el archivo completo (ni siquiera todas sus líneas) en memoria a la
   * vez — el llamador solo necesita ir leyendo el archivo en trozos (chunks)
   * e ir alimentando los pares a medida que los va separando.
   *
   * Por qué existe esto: la primera versión de este parser recibía el
   * archivo completo como un string (o, en una segunda versión, como un
   * array con TODAS sus líneas ya separadas). Para archivos DXF de cientos
   * de MB con millones de entidades, ese array de líneas por sí solo puede
   * ocupar varios GB de memoria (decenas de millones de objetos string
   * simultáneos), lo que hacía que el navegador terminara la pestaña por
   * falta de memoria al importar un DXF de 650MB. Procesando un par a la vez
   * y descartándolo de inmediato, lo único que queda en memoria es el trozo
   * de texto que se está leyendo en ese momento (unos pocos MB) más la
   * geometría ya decodificada (triangles/lines), que es mucho más liviana
   * que el texto crudo del archivo.
   *
   * Ver parseDxf() en worker-parser.js para el lector en trozos que alimenta
   * esta clase.
   */
  static createStreamParser() {
    return new DxfStreamState();
  }

  /**
   * Envoltorio de conveniencia sobre createStreamParser(), para cuando ya se
   * cuenta con TODAS las líneas del archivo en memoria (archivos chicos,
   * pruebas). Para archivos grandes, usar createStreamParser() directamente
   * y alimentarlo desde una lectura en trozos (ver worker-parser.js).
   * @param {string[]} lines Líneas del archivo DXF, ya separadas y trimeadas
   * @returns {Object} Capas y sus geometrías agrupadas: { "Capa1": { triangles: [...], lines: [...] } }
   */
  static parse(lines) {
    const state = new DxfStreamState();
    const len = lines.length;
    for (let i = 0; i + 1 < len; i += 2) {
      state.feedPair(parseInt(lines[i], 10), lines[i + 1]);
    }
    state.finish();
    return state.layers;
  }

  /**
   * Guarda las coordenadas de la entidad procesada en la estructura de capas de Three.js
   */
  static _saveEntity(type, layerName, pts, isClosed, elevation, getLayer) {
    const layer = getLayer(layerName);

    if (type === '3DFACE' && pts.length >= 3) {
      // Filtrar puntos vacíos
      const validPts = pts.filter(p => p !== undefined);
      if (validPts.length < 3) return;

      const p0 = validPts[0];
      const p1 = validPts[1];
      const p2 = validPts[2];
      const p3 = validPts[3];

      // Triángulo 1: p0, p1, p2
      layer.triangles.push(p0.x, p0.y, p0.z);
      layer.triangles.push(p1.x, p1.y, p1.z);
      layer.triangles.push(p2.x, p2.y, p2.z);

      // Si hay un 4to punto y no es idéntico al 3ro, es un cuadrilátero -> dividir en 2 triángulos
      if (p3 && (p3.x !== p2.x || p3.y !== p2.y || p3.z !== p2.z)) {
        // Triángulo 2: p0, p2, p3
        layer.triangles.push(p0.x, p0.y, p0.z);
        layer.triangles.push(p2.x, p2.y, p2.z);
        layer.triangles.push(p3.x, p3.y, p3.z);
      }
    } else if (type === 'LINE' && pts.length >= 2) {
      const p0 = pts[0];
      const p1 = pts[1];
      if (p0 && p1) {
        layer.lines.push(new Float32Array([p0.x, p0.y, p0.z, p1.x, p1.y, p1.z]));
      }
    } else if ((type === 'LWPOLYLINE' || type === 'POLYLINE') && pts.length >= 2) {
      const lineCoords = [];
      for (let j = 0; j < pts.length; j++) {
        const pt = pts[j];
        const z = (type === 'LWPOLYLINE') ? elevation : pt.z;
        lineCoords.push(pt.x, pt.y, z);
      }

      if (isClosed) {
        lineCoords.push(pts[0].x, pts[0].y, (type === 'LWPOLYLINE') ? elevation : pts[0].z);
      }

      layer.lines.push(new Float32Array(lineCoords));
    }
  }
}

/**
 * Estado interno del parser incremental. Es la reescritura, como máquina de
 * estados explícita, de la misma lógica que antes vivía en dos while-loops
 * anidados (uno para SECTION/ENTITIES, otro para las entidades en sí, con un
 * tercer sub-loop anidado para los vértices de POLYLINE clásico). El
 * comportamiento es idéntico — no se cambió ninguna regla de parseo, solo la
 * forma de recorrer el archivo (par a par en vez de con índices sobre un
 * array completo), para poder alimentarla desde una lectura en trozos.
 */
class DxfStreamState {
  constructor() {
    this.layers = {};
    // Closure reutilizada para no crear una función nueva en cada llamada a
    // _saveEntity (esto puede ejecutarse millones de veces en un DXF grande).
    this._getLayerFn = (name) => this._getLayer(name);

    // Nivel superior: buscando "0 SECTION", o ya dentro de una sección
    // buscando "2 ENTITIES" (para entrar) o "0 ENDSEC" (para salir).
    this.topMode = 'SEEK_SECTION'; // 'SEEK_SECTION' | 'IN_SECTION'
    this.inEntities = false;

    // Nivel de entidad (válido mientras inEntities === true)
    this.currentEntity = null;
    this.layerName = "0";
    this.tempPoints = [];
    this.isClosed = false;
    this.elevation = 0;

    // Sub-nivel para POLYLINE clásico (secuencia de VERTEX ... SEQEND)
    this.polylineMode = null; // null | 'SEEK_VERTEX_OR_SEQEND' | 'IN_VERTEX'
    this.polylineLayer = "0";
    this.polylineClosed = false;
    this.curVertexPt = null;
  }

  _getLayer(name) {
    const layerName = name || "0";
    if (!this.layers[layerName]) {
      this.layers[layerName] = {
        triangles: [], // Array plano de coordenadas [x,y,z, x,y,z, ...] para caras 3D
        lines: []      // Lista de arrays de coordenadas [x,y,z, x,y,z, ...] para polilíneas
      };
    }
    return this.layers[layerName];
  }

  _saveCurrentEntity() {
    if (this.currentEntity) {
      DxfParser._saveEntity(this.currentEntity, this.layerName, this.tempPoints, this.isClosed, this.elevation, this._getLayerFn);
    }
  }

  _startNewEntity(val) {
    this.currentEntity = val;
    this.layerName = "0";
    this.tempPoints = [];
    this.isClosed = false;
    this.elevation = 0;
  }

  /**
   * Procesa un par (código de grupo, valor) del archivo DXF, en el mismo
   * orden en que aparecen. Debe llamarse exactamente una vez por cada par,
   * en orden — no admite "volver atrás".
   */
  feedPair(code, val) {
    // --- Nivel superior: fuera de una sección ENTITIES ---
    if (!this.inEntities) {
      if (this.topMode === 'SEEK_SECTION') {
        if (code === 0 && val === 'SECTION') {
          this.topMode = 'IN_SECTION';
        }
        return;
      }
      // topMode === 'IN_SECTION': buscando ENTITIES o el fin de esta sección
      if (code === 0 && val === 'ENDSEC') {
        this.topMode = 'SEEK_SECTION';
      } else if (code === 2 && val === 'ENTITIES') {
        this.inEntities = true;
        this.currentEntity = null;
      }
      return;
    }

    // --- Dentro de ENTITIES: sub-modo de lectura de vértices de POLYLINE ---
    if (this.polylineMode === 'IN_VERTEX') {
      if (code === 0) {
        // Este par en realidad le corresponde al nivel de "buscando VERTEX o
        // SEQEND" (mismo comportamiento que el "peek" del parser original:
        // el código 0 nunca pertenece a las coordenadas del vértice actual).
        this.tempPoints.push(this.curVertexPt);
        this.curVertexPt = null;
        this.polylineMode = 'SEEK_VERTEX_OR_SEQEND';
        this._feedVertexScanPair(code, val);
        return;
      }
      if (code === 10) this.curVertexPt.x = parseFloat(val);
      else if (code === 20) this.curVertexPt.y = parseFloat(val);
      else if (code === 30) this.curVertexPt.z = parseFloat(val);
      return;
    }

    if (this.polylineMode === 'SEEK_VERTEX_OR_SEQEND') {
      this._feedVertexScanPair(code, val);
      return;
    }

    // --- Nivel de entidad normal ---
    if (code === 0) {
      this._saveCurrentEntity();

      if (val === 'ENDSEC') {
        this.currentEntity = null;
        this.inEntities = false;
        this.topMode = 'SEEK_SECTION';
        return;
      }

      this._startNewEntity(val);
      return;
    }

    if (code === 8) {
      this.layerName = val;
      return;
    }

    const ce = this.currentEntity;
    const pts = this.tempPoints;

    if (ce === '3DFACE') {
      // 3DFACE: 4 puntos (10,20,30 a 13,23,33)
      if (code >= 10 && code <= 13) { // X
        if (!pts[code - 10]) pts[code - 10] = { x: 0, y: 0, z: 0 };
        pts[code - 10].x = parseFloat(val);
      } else if (code >= 20 && code <= 23) { // Y
        if (!pts[code - 20]) pts[code - 20] = { x: 0, y: 0, z: 0 };
        pts[code - 20].y = parseFloat(val);
      } else if (code >= 30 && code <= 33) { // Z
        if (!pts[code - 30]) pts[code - 30] = { x: 0, y: 0, z: 0 };
        pts[code - 30].z = parseFloat(val);
      }
    } else if (ce === 'LINE') {
      // LINE: 2 puntos (10,20,30 y 11,21,31)
      if (code === 10) { if (!pts[0]) pts[0] = {}; pts[0].x = parseFloat(val); }
      else if (code === 20) { if (!pts[0]) pts[0] = {}; pts[0].y = parseFloat(val); }
      else if (code === 30) { if (!pts[0]) pts[0] = {}; pts[0].z = parseFloat(val); }
      else if (code === 11) { if (!pts[1]) pts[1] = {}; pts[1].x = parseFloat(val); }
      else if (code === 21) { if (!pts[1]) pts[1] = {}; pts[1].y = parseFloat(val); }
      else if (code === 31) { if (!pts[1]) pts[1] = {}; pts[1].z = parseFloat(val); }
    } else if (ce === 'LWPOLYLINE') {
      // LWPOLYLINE: vértices 2D con elevación constante
      if (code === 70) {
        this.isClosed = (parseInt(val, 10) & 1) === 1;
      } else if (code === 38) {
        this.elevation = parseFloat(val);
      } else if (code === 10) {
        pts.push({ x: parseFloat(val), y: 0, z: 0 });
      } else if (code === 20) {
        if (pts.length > 0) {
          pts[pts.length - 1].y = parseFloat(val);
        }
      }
    } else if (ce === 'POLYLINE') {
      // POLYLINE clásico: el resto de sus vértices vienen como entidades
      // VERTEX independientes hasta un SEQEND. Cualquier propiedad de la
      // entidad POLYLINE misma (aparte de la capa, código 8, ya manejada
      // arriba) dispara el paso a modo "buscando VERTEX/SEQEND" — replica
      // el comportamiento original del parser previo a esta reescritura.
      if (code === 70) {
        this.isClosed = (parseInt(val, 10) & 1) === 1;
      }

      this.polylineLayer = this.layerName;
      this.polylineClosed = this.isClosed;
      this.polylineMode = 'SEEK_VERTEX_OR_SEQEND';
    }
    // Otros tipos de entidad no soportados: se ignoran sus propiedades.
  }

  _feedVertexScanPair(vCode, vVal) {
    if (vCode === 0 && vVal === 'VERTEX') {
      this.curVertexPt = { x: 0, y: 0, z: 0 };
      this.polylineMode = 'IN_VERTEX';
    } else if (vCode === 0 && vVal === 'SEQEND') {
      DxfParser._saveEntity('POLYLINE', this.polylineLayer, this.tempPoints, this.polylineClosed, 0, this._getLayerFn);
      this.currentEntity = null;
      this.tempPoints = [];
      this.polylineMode = null;
    }
    // Cualquier otro par mientras se busca VERTEX/SEQEND: se ignora.
  }

  /**
   * Se llama una sola vez, después de haber alimentado todos los pares del
   * archivo. Guarda cualquier entidad que haya quedado pendiente (por
   * ejemplo, si el archivo terminó truncado sin ENDSEC) en vez de perderla
   * en silencio — mismo comportamiento del parser previo a esta reescritura.
   */
  finish() {
    if (this.polylineMode === 'IN_VERTEX' && this.curVertexPt) {
      this.tempPoints.push(this.curVertexPt);
    }
    if (this.currentEntity) {
      DxfParser._saveEntity(this.currentEntity, this.layerName, this.tempPoints, this.isClosed, this.elevation, this._getLayerFn);
    }
  }
}

if (typeof module !== 'undefined') module.exports = { DxfParser };
