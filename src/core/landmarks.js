import * as THREE from 'three';

// Import attribute'u Node'un JSON modül kuralı için gerekiyor; çekirdek
// modülleri tarayıcı dışında da (test amaçlı) çalıştırabilmek istiyoruz.
import template from '../templates/humanoid.json' with { type: 'json' };

export const humanoidTemplate = template;

// Kullanıcının sırayla işaretleyeceği landmark'lar. Sağ taraf listede yok,
// çünkü sol taraftan aynalanıyor; kullanıcı isterse sonradan düzeltebilir.
export const guidedLandmarks = template.landmarks.filter((entry) => entry.side !== 'right');

const landmarkById = new Map(template.landmarks.map((entry) => [entry.id, entry]));

/**
 * Landmark deposu.
 *
 * Konumlar normalize edilmiş dünya uzayında tutuluyor (model yüksekliği 1,
 * taban y=0). Export sırasında loader'ın denormalizeMatrix'i ile orijinal
 * ölçeğe dönülecek.
 *
 * Aynalama: sol taraf işaretlendiğinde karşılığı X ekseninde aynalanıp
 * "otomatik" olarak işaretleniyor. Kullanıcı sağ tarafa elle tıklarsa o
 * landmark "manuel" oluyor ve bir daha aynalama tarafından ezilmiyor.
 */
export function createLandmarkStore() {
  const positions = new Map();
  const autoPlaced = new Set();
  const listeners = new Set();

  let mirrorEnabled = true;

  function notify() {
    for (const listener of listeners) listener(store);
  }

  function setInternal(id, position, isAuto) {
    positions.set(id, position.clone());
    if (isAuto) autoPlaced.add(id);
    else autoPlaced.delete(id);
  }

  const store = {
    get mirrorEnabled() {
      return mirrorEnabled;
    },

    setMirrorEnabled(value) {
      mirrorEnabled = value;
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** @param {string} id @param {THREE.Vector3} position */
    set(id, position) {
      const entry = landmarkById.get(id);
      if (!entry) throw new Error(`Bilinmeyen landmark: ${id}`);

      setInternal(id, position, false);

      // Sol tarafın aynası, sadece karşı taraf boşsa ya da otomatik yerleştirilmişse.
      const mirrorId = entry.mirror;
      if (mirrorEnabled && mirrorId && (!positions.has(mirrorId) || autoPlaced.has(mirrorId))) {
        const mirrored = position.clone();
        mirrored.x *= -1;
        setInternal(mirrorId, mirrored, true);
      }

      notify();
    },

    get(id) {
      return positions.get(id) ?? null;
    },

    has(id) {
      return positions.has(id);
    },

    isAuto(id) {
      return autoPlaced.has(id);
    },

    clear(id) {
      positions.delete(id);
      autoPlaced.delete(id);

      // Sol taraf silinince otomatik aynası da anlamını yitiriyor.
      const entry = landmarkById.get(id);
      if (entry?.mirror && autoPlaced.has(entry.mirror)) {
        positions.delete(entry.mirror);
        autoPlaced.delete(entry.mirror);
      }

      notify();
    },

    clearAll() {
      positions.clear();
      autoPlaced.clear();
      notify();
    },

    /** Sıradaki boş landmark; rehberli akış bunu takip ediyor. */
    nextMissingId(fromId = null) {
      const startIndex = fromId
        ? guidedLandmarks.findIndex((entry) => entry.id === fromId) + 1
        : 0;

      for (let i = startIndex; i < guidedLandmarks.length; i += 1) {
        if (!positions.has(guidedLandmarks[i].id)) return guidedLandmarks[i].id;
      }
      // Baştan tara: kullanıcı araya atlamış olabilir.
      for (const entry of guidedLandmarks) {
        if (!positions.has(entry.id)) return entry.id;
      }
      return null;
    },

    /** İskelet için gereken tüm landmark'lar var mı? */
    get missingIds() {
      return template.landmarks
        .filter((entry) => !positions.has(entry.id))
        .map((entry) => entry.id);
    },

    get placedCount() {
      return positions.size;
    },

    entries() {
      return template.landmarks.map((entry) => ({
        ...entry,
        position: positions.get(entry.id) ?? null,
        auto: autoPlaced.has(entry.id),
      }));
    },

    /** Aşama 4/5'te kemik konumları için ham map. */
    toMap() {
      return new Map(positions);
    },

    toJSON(modelHash) {
      const result = {};
      for (const entry of template.landmarks) {
        const position = positions.get(entry.id);
        if (!position) continue;
        result[entry.id] = {
          x: round(position.x),
          y: round(position.y),
          z: round(position.z),
        };
      }

      return {
        version: 1,
        modelHash: modelHash ?? null,
        // Konumlar normalize uzayda; hangi uzayda olduğunu dosyaya yazıyoruz ki
        // ileride ham koordinat kaydetmeye geçersek eski dosyalar ayırt edilsin.
        space: 'normalized',
        template: template.name,
        landmarks: result,
      };
    },

    /**
     * JSON'dan yükler. Yüklenen her landmark manuel sayılır; kullanıcı bilerek
     * kaydetmiş, aynalama bunları ezmemeli.
     */
    fromJSON(json) {
      if (!json || typeof json !== 'object' || !json.landmarks) {
        throw new Error('Geçersiz landmark dosyası.');
      }

      positions.clear();
      autoPlaced.clear();

      const unknown = [];
      for (const [id, value] of Object.entries(json.landmarks)) {
        if (!landmarkById.has(id)) {
          unknown.push(id);
          continue;
        }
        positions.set(id, new THREE.Vector3(value.x, value.y, value.z));
      }

      notify();
      return { loaded: positions.size, unknown };
    },
  };

  return store;
}

export function getLandmarkDefinition(id) {
  return landmarkById.get(id) ?? null;
}

function round(value) {
  return Number(value.toFixed(5));
}
