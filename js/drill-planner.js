/**
 * GeoMet V1 — Planificador de Sondajes (Drill Planner)
 *
 * Estado y lógica de sondajes PROPUESTOS (de diseño, aún no perforados):
 * cálculo de la trayectoria recta desde collar + azimuth + dip + profundidad
 * final, numeración correlativa de HOLEID, y exportación a Excel (.xlsx) vía
 * SheetJS (cargado por CDN en index.html).
 *
 * Es estado de SESIÓN: vive en memoria mientras dure la pestaña del
 * navegador abierta, igual que calcVariables/filters/savedViews en
 * GeometApp — no persiste al recargar la página.
 *
 * Convención de azimuth/dip: idéntica a la que usa el importador de
 * sondajes reales (ver parseDrillholes() en worker-parser.js, algoritmo de
 * Mínima Curvatura): azimuth en grados, 0° = Norte, sentido horario; dip en
 * grados, NEGATIVO hacia abajo (dip = -90 es vertical). Mantener la misma
 * convención permite comparar o combinar sondajes propuestos con sondajes
 * reales sin tener que convertir signos.
 */
class DrillPlanner {
  constructor() {
    this.holes = [];   // [{holeId, collar:{x,y,z}, azimuth, dip, depth, endPoint:{x,y,z}, color, visible}]
    this.prefix = 'PROP';
    this.nextNumber = 1;
  }

  /** Punto final de una trayectoria recta (dip/azimuth constantes hasta la profundidad final). */
  static computeEndPoint(collar, azimuth, dip, depth) {
    const azRad = azimuth * Math.PI / 180;
    const dipRad = dip * Math.PI / 180;
    const dx = Math.cos(dipRad) * Math.sin(azRad);
    const dy = Math.cos(dipRad) * Math.cos(azRad);
    const dz = Math.sin(dipRad);
    return {
      x: collar.x + depth * dx,
      y: collar.y + depth * dy,
      z: collar.z + depth * dz,
    };
  }

  /** Siguiente HOLEID correlativo según el prefijo actual (sin consumirlo — para previsualizar en la UI). */
  peekNextHoleId() {
    return `${this.prefix}-${String(this.nextNumber).padStart(3, '0')}`;
  }

  /** Cambia el prefijo de numeración. No renumera los sondajes ya creados (conservan su HOLEID original). */
  setPrefix(prefix) {
    const clean = String(prefix || 'PROP').trim().toUpperCase().replace(/\s+/g, '_');
    this.prefix = clean || 'PROP';
  }

  /** Agrega un sondaje propuesto, asignándole el próximo HOLEID correlativo. Devuelve la entrada creada. */
  addHole({ collar, azimuth, dip, depth, color }) {
    const holeId = this.peekNextHoleId();
    this.nextNumber += 1;
    const endPoint = DrillPlanner.computeEndPoint(collar, azimuth, dip, depth);
    const hole = {
      holeId,
      collar: { x: collar.x, y: collar.y, z: collar.z },
      azimuth,
      dip,
      depth,
      endPoint,
      // Violeta (--accent-violet en index.css), reservado para elementos
      // de DISEÑO/PROPUESTA — deliberadamente distinto de --accent-amber
      // (usado para warnings en toda la app) para que un sondaje propuesto
      // nunca se lea como una alerta.
      color: color || '#a78bfa',
      visible: true,
    };
    this.holes.push(hole);
    return hole;
  }

  /** Actualiza un sondaje ya creado y recalcula su punto final. */
  updateHole(holeId, patch) {
    const hole = this.holes.find(h => h.holeId === holeId);
    if (!hole) return null;
    Object.assign(hole, patch);
    hole.endPoint = DrillPlanner.computeEndPoint(hole.collar, hole.azimuth, hole.dip, hole.depth);
    return hole;
  }

  removeHole(holeId) {
    this.holes = this.holes.filter(h => h.holeId !== holeId);
  }

  clear() {
    this.holes = [];
    this.nextNumber = 1;
  }

  /**
   * Arma una hoja de cálculo con una fila por sondaje propuesto (collar,
   * azimuth, dip, profundidad y el punto final ya calculado) y descarga el
   * archivo .xlsx. Requiere que la librería XLSX (SheetJS) esté cargada.
   */
  exportToExcel(filenamePrefix = 'GeoMet_Sondajes_Propuestos') {
    if (typeof XLSX === 'undefined') {
      throw new Error('La librería XLSX (SheetJS) no está disponible.');
    }
    const rows = this.holes.map(h => ({
      HOLEID: h.holeId,
      COLLAR_X: +h.collar.x.toFixed(3),
      COLLAR_Y: +h.collar.y.toFixed(3),
      COLLAR_Z: +h.collar.z.toFixed(3),
      AZIMUTH: +h.azimuth.toFixed(2),
      DIP: +h.dip.toFixed(2),
      DEPTH: +h.depth.toFixed(2),
      END_X: +h.endPoint.x.toFixed(3),
      END_Y: +h.endPoint.y.toFixed(3),
      END_Z: +h.endPoint.z.toFixed(3),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sondajes Propuestos');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    XLSX.writeFile(wb, `${filenamePrefix}_${ts}.xlsx`);
  }
}
