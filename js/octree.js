/**
 * GeoMet V1 — Módulo de Indexación Espacial 3D
 * Implementa una grilla espacial 3D uniforme optimizada (que conceptualmente funciona como un Octree de profundidad uniforme).
 * Diseñado para indexar millones de bloques y trazas de sondajes con bajo consumo de memoria y búsquedas en < 1ms.
 */

class SpatialIndex3D {
  /**
   * @param {Object} bounds Límite global {minX, maxX, minY, maxY, minZ, maxZ}
   * @param {number} resX Resolución en el eje X (por defecto 40 celdas)
   * @param {number} resY Resolución en el eje Y (por defecto 40 celdas)
   * @param {number} resZ Resolución en el eje Z (por defecto 20 celdas)
   */
  constructor(bounds, resX = 40, resY = 40, resZ = 20) {
    this.bounds = {
      minX: bounds.minX - 0.1,
      maxX: bounds.maxX + 0.1,
      minY: bounds.minY - 0.1,
      maxY: bounds.maxY + 0.1,
      minZ: bounds.minZ - 0.1,
      maxZ: bounds.maxZ + 0.1
    };
    
    this.resX = resX;
    this.resY = resY;
    this.resZ = resZ;
    
    this.sizeX = (this.bounds.maxX - this.bounds.minX) / resX;
    this.sizeY = (this.bounds.maxY - this.bounds.minY) / resY;
    this.sizeZ = (this.bounds.maxZ - this.bounds.minZ) / resZ;
    
    // Evitar división por cero
    if (this.sizeX <= 0) this.sizeX = 1;
    if (this.sizeY <= 0) this.sizeY = 1;
    if (this.sizeZ <= 0) this.sizeZ = 1;
    
    // Grilla plana de celdas (índice 1D = x + y * resX + z * resX * resY)
    this.cells = new Array(resX * resY * resZ);
    for (let i = 0; i < this.cells.length; i++) {
      this.cells[i] = [];
    }
    
    // Lista de elementos de tipo sondaje/DXF que no caben en una sola celda
    this.globalElements = [];
  }

  /**
   * Retorna el índice de la celda para una coordenada 3D
   */
  _getCellIndex(x, y, z) {
    const cx = Math.max(0, Math.min(this.resX - 1, Math.floor((x - this.bounds.minX) / this.sizeX)));
    const cy = Math.max(0, Math.min(this.resY - 1, Math.floor((y - this.bounds.minY) / this.sizeY)));
    const cz = Math.max(0, Math.min(this.resZ - 1, Math.floor((z - this.bounds.minZ) / this.sizeZ)));
    return cx + cy * this.resX + cz * this.resX * this.resY;
  }

  /**
   * Inserta un bloque puntual en el índice
   * @param {number} idx Índice del bloque
   * @param {number} x Centroide X
   * @param {number} y Centroide Y
   * @param {number} z Centroide Z
   */
  insertBlock(idx, x, y, z) {
    const cellIdx = this._getCellIndex(x, y, z);
    this.cells[cellIdx].push(idx);
  }

  /**
   * Inserta múltiples bloques representados en TypedArrays planos
   */
  insertBlocksBulk(positions) {
    const len = positions.length / 3;
    for (let i = 0; i < len; i++) {
      const idx3 = i * 3;
      const cellIdx = this._getCellIndex(positions[idx3], positions[idx3 + 1], positions[idx3 + 2]);
      this.cells[cellIdx].push(i);
    }
  }

  /**
   * Inserta un elemento lineal o con volumen (sondaje, malla DXF) indicando su caja delimitadora
   * @param {Object} item El objeto a guardar
   * @param {Object} itemBounds Bounding Box del elemento {minX, maxX, minY, maxY, minZ, maxZ}
   */
  insertSpatialItem(item, itemBounds) {
    const cxMin = Math.max(0, Math.min(this.resX - 1, Math.floor((itemBounds.minX - this.bounds.minX) / this.sizeX)));
    const cxMax = Math.max(0, Math.min(this.resX - 1, Math.floor((itemBounds.maxX - this.bounds.minX) / this.sizeX)));
    const cyMin = Math.max(0, Math.min(this.resY - 1, Math.floor((itemBounds.minY - this.bounds.minY) / this.sizeY)));
    const cyMax = Math.max(0, Math.min(this.resY - 1, Math.floor((itemBounds.maxY - this.bounds.minY) / this.sizeY)));
    const czMin = Math.max(0, Math.min(this.resZ - 1, Math.floor((itemBounds.minZ - this.bounds.minZ) / this.sizeZ)));
    const czMax = Math.max(0, Math.min(this.resZ - 1, Math.floor((itemBounds.maxZ - this.bounds.minZ) / this.sizeZ)));
    
    // Si cruza demasiadas celdas, lo guardamos como elemento global para simplificar
    const cellSpan = (cxMax - cxMin + 1) * (cyMax - cyMin + 1) * (czMax - czMin + 1);
    if (cellSpan > 100) {
      this.globalElements.push(item);
      return;
    }
    
    // Insertar en todas las celdas que intersecta
    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        for (let cz = czMin; cz <= czMax; cz++) {
          const cellIdx = cx + cy * this.resX + cz * this.resX * this.resY;
          if (!this.cells[cellIdx].items) {
            this.cells[cellIdx].items = [];
          }
          this.cells[cellIdx].items.push(item);
        }
      }
    }
  }

  /**
   * Consulta los bloques contenidos dentro de un Bounding Box
   * @returns {Array} Lista de índices de bloques intersectados
   */
  queryBox(queryBounds) {
    const cxMin = Math.max(0, Math.min(this.resX - 1, Math.floor((queryBounds.minX - this.bounds.minX) / this.sizeX)));
    const cxMax = Math.max(0, Math.min(this.resX - 1, Math.floor((queryBounds.maxX - this.bounds.minX) / this.sizeX)));
    const cyMin = Math.max(0, Math.min(this.resY - 1, Math.floor((queryBounds.minY - this.bounds.minY) / this.sizeY)));
    const cyMax = Math.max(0, Math.min(this.resY - 1, Math.floor((queryBounds.maxY - this.bounds.minY) / this.sizeY)));
    const czMin = Math.max(0, Math.min(this.resZ - 1, Math.floor((queryBounds.minZ - this.bounds.minZ) / this.sizeZ)));
    const czMax = Math.max(0, Math.min(this.resZ - 1, Math.floor((queryBounds.maxZ - this.bounds.minZ) / this.sizeZ)));
    
    const results = [];
    // Evitar duplicados de elementos indexados
    const visited = new Set();
    
    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        for (let cz = czMin; cz <= czMax; cz++) {
          const cellIdx = cx + cy * this.resX + cz * this.resX * this.resY;
          const cellList = this.cells[cellIdx];
          
          // Recoger bloques
          for (let j = 0; j < cellList.length; j++) {
            results.push(cellList[j]);
          }
        }
      }
    }
    return results;
  }

  /**
   * Consulta los bloques e items espaciales que caen dentro de un plano de corte con cierto espesor (Sección)
   * @param {string} type 'horizontal' (corte Z), 'vertical-n' (corte X), o 'vertical-e' (corte Y)
   * @param {number} coord Coordenada del corte en el eje respectivo
   * @param {number} thickness Espesor de ventana (semiespesor, ej. +-10m)
   */
  querySection(type, coord, thickness) {
    const minVal = coord - thickness;
    const maxVal = coord + thickness;
    
    const queryBounds = {
      minX: this.bounds.minX, maxX: this.bounds.maxX,
      minY: this.bounds.minY, maxY: this.bounds.maxY,
      minZ: this.bounds.minZ, maxZ: this.bounds.maxZ
    };
    
    if (type === 'vertical-n') { // Eje X
      queryBounds.minX = minVal;
      queryBounds.maxX = maxVal;
    } else if (type === 'vertical-e') { // Eje Y
      queryBounds.minY = minVal;
      queryBounds.maxY = maxVal;
    } else { // Eje Z
      queryBounds.minZ = minVal;
      queryBounds.maxZ = maxVal;
    }
    
    // Consulta en base a la caja de la sección
    const blockIndices = this.queryBox(queryBounds);
    
    // También recoger elementos espaciales (sondajes / DXF) que caen dentro de la grilla consultada
    const spatialItems = [];
    const visitedItems = new Set();
    
    // Recoger elementos de la grilla
    const cxMin = Math.max(0, Math.min(this.resX - 1, Math.floor((queryBounds.minX - this.bounds.minX) / this.sizeX)));
    const cxMax = Math.max(0, Math.min(this.resX - 1, Math.floor((queryBounds.maxX - this.bounds.minX) / this.sizeX)));
    const cyMin = Math.max(0, Math.min(this.resY - 1, Math.floor((queryBounds.minY - this.bounds.minY) / this.sizeY)));
    const cyMax = Math.max(0, Math.min(this.resY - 1, Math.floor((queryBounds.maxY - this.bounds.minY) / this.sizeY)));
    const czMin = Math.max(0, Math.min(this.resZ - 1, Math.floor((queryBounds.minZ - this.bounds.minZ) / this.sizeZ)));
    const czMax = Math.max(0, Math.min(this.resZ - 1, Math.floor((queryBounds.maxZ - this.bounds.minZ) / this.sizeZ)));
    
    for (let cx = cxMin; cx <= cxMax; cx++) {
      for (let cy = cyMin; cy <= cyMax; cy++) {
        for (let cz = czMin; cz <= czMax; cz++) {
          const cellIdx = cx + cy * this.resX + cz * this.resX * this.resY;
          const cell = this.cells[cellIdx];
          if (cell.items) {
            for (let j = 0; j < cell.items.length; j++) {
              const item = cell.items[j];
              if (!visitedItems.has(item)) {
                visitedItems.add(item);
                spatialItems.push(item);
              }
            }
          }
        }
      }
    }
    
    // Agregar elementos globales (sondajes largos, etc.)
    for (let j = 0; j < this.globalElements.length; j++) {
      spatialItems.push(this.globalElements[j]);
    }
    
    return {
      blockIndices,
      spatialItems
    };
  }
}
