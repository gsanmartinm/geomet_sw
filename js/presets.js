/**
 * GeoMet V1 — Módulo de Presets y Plantillas (LocalStorage)
 * Gestiona plantillas de importación de CSV, configuraciones del visualizador y filtros.
 */

const PresetManager = {
  // Plantillas predeterminadas del sistema
  SYSTEM_TEMPLATES: {
    drillholes_standard: {
      name: "Sondajes Completo (Estándar)",
      mappings: {
        collar_holeId: "HoleID", collar_x: "X", collar_y: "Y", collar_z: "Z",
        survey_holeId: "HoleID", survey_depth: "Depth", survey_azimuth: "Azimuth", survey_dip: "Dip",
        assays_holeId: "HoleID", assays_from: "From", assays_to: "To"
      }
    },
    drillholes_collar: {
      name: "Sondajes Collar (Solo Collar)",
      mappings: { collar_holeId: "HoleID", collar_x: "X", collar_y: "Y", collar_z: "Z" }
    },
    drillholes_survey: {
      name: "Sondajes Survey (Solo Survey)",
      mappings: { survey_holeId: "HoleID", survey_depth: "Depth", survey_azimuth: "Azimuth", survey_dip: "Dip" }
    },
    drillholes_assays: {
      name: "Sondajes Ensayos (Solo Ensayos)",
      mappings: { assays_holeId: "HoleID", assays_from: "From", assays_to: "To" }
    },
    blocks_standard: {
      name: "Modelo de Bloques Centroides (Estándar)",
      mappings: { x: "X", y: "Y", z: "Z", dx: "DX", dy: "DY", dz: "DZ" }
    }
  },

  /**
   * Guarda una plantilla personalizada en localStorage
   */
  saveTemplate(type, key, name, mappings) {
    const storageKey = `geomet_tmpl_${type}`;
    const templates = this.getTemplates(type);
    templates[key] = { name, mappings };
    localStorage.setItem(storageKey, JSON.stringify(templates));
  },

  /**
   * Obtiene todas las plantillas para un tipo de dato, combinando las del sistema y las del usuario
   */
  getTemplates(type) {
    const storageKey = `geomet_tmpl_${type}`;
    const userTemplatesRaw = localStorage.getItem(storageKey);
    const userTemplates = userTemplatesRaw ? JSON.parse(userTemplatesRaw) : {};
    
    // Filtrar plantillas del sistema que coincidan con el prefijo
    const result = {};
    
    // Agregar del sistema
    for (const k in this.SYSTEM_TEMPLATES) {
      if (k.startsWith(type)) {
        result[k] = this.SYSTEM_TEMPLATES[k];
      }
    }
    
    // Combinar con las del usuario
    for (const k in userTemplates) {
      result[`user_${k}`] = userTemplates[k];
    }
    
    return result;
  },

  /**
   * Elimina una plantilla personalizada
   */
  deleteTemplate(type, key) {
    if (key.startsWith('system_')) return; // No borrar del sistema
    const userKey = key.replace('user_', '');
    const storageKey = `geomet_tmpl_${type}`;
    const templates = this.getTemplates(type);
    delete templates[userKey];
    localStorage.setItem(storageKey, JSON.stringify(templates));
  },

  /**
   * Guarda los filtros activos
   */
  saveFilterPreset(name, filters) {
    const presets = this.getFilterPresets();
    presets[name] = filters;
    localStorage.setItem('geomet_filter_presets', JSON.stringify(presets));
  },

  /**
   * Obtiene los presets de filtros guardados
   */
  getFilterPresets() {
    const raw = localStorage.getItem('geomet_filter_presets');
    return raw ? JSON.parse(raw) : {};
  }
};
