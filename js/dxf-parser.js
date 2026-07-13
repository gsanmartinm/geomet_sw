/**
 * GeoMet V1 — Módulo Parser de Archivos DXF
 * Diseñado para leer archivos DXF ASCII livianos y medianos (topografías y contornos de minas).
 * Soporta entidades 3DFACE, LINE, LWPOLYLINE y POLYLINE simple.
 */

class DxfParser {
  /**
   * Parsea el texto crudo de un archivo DXF y extrae capas y geometrías.
   * @param {string} text Contenido del archivo DXF
   * @returns {Object} Capas y sus geometrías agrupadas: { layers: { "Capa1": { triangles: [...], lines: [...] } } }
   */
  static parse(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim());
    const layers = {};
    
    // Helper para asegurar que una capa exista
    function getLayer(name) {
      const layerName = name || "0";
      if (!layers[layerName]) {
        layers[layerName] = {
          triangles: [], // Array plano de coordenadas [x,y,z, x,y,z, ...] para caras 3D
          lines: []      // Lista de arrays de coordenadas [x,y,z, x,y,z, ...] para polilíneas
        };
      }
      return layers[layerName];
    }

    let i = 0;
    const len = lines.length;
    
    while (i < len - 1) {
      const code = parseInt(lines[i], 10);
      const val = lines[i + 1];
      i += 2;
      
      if (code === 0 && val === 'SECTION') {
        // Encontrar sección de ENTITIES
        while (i < len - 1) {
          const sCode = parseInt(lines[i], 10);
          const sVal = lines[i + 1];
          i += 2;
          if (sCode === 0 && sVal === 'ENDSEC') {
            break;
          }
          if (sCode === 2 && sVal === 'ENTITIES') {
            // Parsear entidades dentro de la sección
            i = this._parseEntities(lines, i, getLayer);
            break;
          }
        }
      }
    }
    
    return layers;
  }

  /**
   * Parser interno de la sección de entidades
   */
  static _parseEntities(lines, startIndex, getLayer) {
    let i = startIndex;
    const len = lines.length;
    
    let currentEntity = null;
    let layerName = "0";
    
    // Contenedores temporales para propiedades de la entidad
    let tempPoints = [];
    let isClosed = false;
    let elevation = 0;
    
    while (i < len - 1) {
      const code = parseInt(lines[i], 10);
      const val = lines[i + 1];
      
      if (code === 0) {
        // Guardar entidad anterior
        if (currentEntity) {
          this._saveEntity(currentEntity, layerName, tempPoints, isClosed, elevation, getLayer);
        }
        
        if (val === 'ENDSEC') {
          i += 2;
          break; // Fin de la sección de entidades
        }
        
        // Iniciar nueva entidad
        currentEntity = val;
        layerName = "0";
        tempPoints = [];
        isClosed = false;
        elevation = 0;
        i += 2;
      } else {
        // Leer propiedades de la entidad activa
        if (code === 8) {
          layerName = val;
        } else if (currentEntity === '3DFACE') {
          // 3DFACE: 4 puntos (10,20,30 a 13,23,33)
          const ptIdx = Math.floor((code - 10) / 10);
          const coordIdx = (code % 10); // 0=x, 1=y, 2=z (pero en DXF son 10=x, 20=y, 30=z)
          
          if (code >= 10 && code <= 13) { // X
            if (!tempPoints[code - 10]) tempPoints[code - 10] = { x: 0, y: 0, z: 0 };
            tempPoints[code - 10].x = parseFloat(val);
          } else if (code >= 20 && code <= 23) { // Y
            if (!tempPoints[code - 20]) tempPoints[code - 20] = { x: 0, y: 0, z: 0 };
            tempPoints[code - 20].y = parseFloat(val);
          } else if (code >= 30 && code <= 33) { // Z
            if (!tempPoints[code - 30]) tempPoints[code - 30] = { x: 0, y: 0, z: 0 };
            tempPoints[code - 30].z = parseFloat(val);
          }
        } else if (currentEntity === 'LINE') {
          // LINE: 2 puntos (10,20,30 y 11,21,31)
          if (code === 10) { if (!tempPoints[0]) tempPoints[0] = {}; tempPoints[0].x = parseFloat(val); }
          else if (code === 20) { if (!tempPoints[0]) tempPoints[0] = {}; tempPoints[0].y = parseFloat(val); }
          else if (code === 30) { if (!tempPoints[0]) tempPoints[0] = {}; tempPoints[0].z = parseFloat(val); }
          else if (code === 11) { if (!tempPoints[1]) tempPoints[1] = {}; tempPoints[1].x = parseFloat(val); }
          else if (code === 21) { if (!tempPoints[1]) tempPoints[1] = {}; tempPoints[1].y = parseFloat(val); }
          else if (code === 31) { if (!tempPoints[1]) tempPoints[1] = {}; tempPoints[1].z = parseFloat(val); }
        } else if (currentEntity === 'LWPOLYLINE') {
          // LWPOLYLINE: vértices 2D con elevación constante
          if (code === 70) {
            isClosed = (parseInt(val, 10) & 1) === 1;
          } else if (code === 38) {
            elevation = parseFloat(val);
          } else if (code === 10) {
            tempPoints.push({ x: parseFloat(val), y: 0, z: 0 });
          } else if (code === 20) {
            if (tempPoints.length > 0) {
              tempPoints[tempPoints.length - 1].y = parseFloat(val);
            }
          }
        } else if (currentEntity === 'POLYLINE') {
          // POLYLINE es el inicio de una secuencia de VERTEX hasta SEQEND
          if (code === 70) {
            isClosed = (parseInt(val, 10) & 1) === 1;
          }
          
          // Entrar en modo lectura de vértices
          i += 2;
          const polylineLayer = layerName;
          const polylineClosed = isClosed;
          
          while (i < len - 1) {
            const vCode = parseInt(lines[i], 10);
            const vVal = lines[i + 1];
            i += 2;
            
            if (vCode === 0 && vVal === 'VERTEX') {
              const pt = { x: 0, y: 0, z: 0 };
              // Leer coordenadas del VERTEX
              while (i < len - 1) {
                const ptCode = parseInt(lines[i], 10);
                const ptVal = lines[i + 1];
                if (ptCode === 0) break; // Siguiente vértice o fin
                
                if (ptCode === 10) pt.x = parseFloat(ptVal);
                else if (ptCode === 20) pt.y = parseFloat(ptVal);
                else if (ptCode === 30) pt.z = parseFloat(ptVal);
                
                i += 2;
              }
              tempPoints.push(pt);
            } else if (vCode === 0 && vVal === 'SEQEND') {
              break;
            }
          }
          
          // Guardar POLYLINE recolectada
          this._saveEntity('POLYLINE', polylineLayer, tempPoints, polylineClosed, 0, getLayer);
          currentEntity = null; // ya se guardó
          continue;
        }
        
        i += 2;
      }
    }
    
    // Guardar última entidad si quedó huérfana
    if (currentEntity) {
      this._saveEntity(currentEntity, layerName, tempPoints, isClosed, elevation, getLayer);
    }
    
    return i;
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
