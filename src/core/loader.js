import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Modeli normalize ederken hedeflenen yükseklik (dünya birimi).
// Meshy çıktıları çok farklı ölçeklerde geliyor, hepsini aynı boya getiriyoruz.
const TARGET_HEIGHT = 1;

const loader = new GLTFLoader();

/**
 * GLB dosyasını okur, tek bir mesh'e indirger ve normalize eder.
 *
 * Normalizasyon geometry'nin içine "pişiriliyor": mesh'in dünya matrisi
 * vertex pozisyonlarına uygulanıyor, sonra model X/Z'de ortalanıp tabanı
 * y=0'a çekiliyor ve yüksekliği TARGET_HEIGHT'a ölçekleniyor. Böylece
 * mesh transform'u identity oluyor ve geometry koordinatı = dünya koordinatı.
 * Geodezik mesafe, raycast ve weight hesabı bu sayede tek uzayda çalışıyor.
 *
 * Export sırasında orijinal ölçeğe dönmek için normalizeMatrix saklanıyor.
 *
 * @param {File} file kullanıcının sürüklediği .glb dosyası
 * @returns {Promise<LoadedModel>}
 */
export async function loadGLB(file) {
  const buffer = await file.arrayBuffer();
  const modelHash = await hashBuffer(buffer);
  const gltf = await parseGLB(buffer);

  const source = pickLargestMesh(gltf.scene);
  if (!source) {
    throw new Error('GLB içinde mesh bulunamadı.');
  }

  const geometry = bakeWorldTransform(source);
  const normalizeMatrix = normalizeGeometry(geometry);

  const material = cloneMaterial(source.material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = source.name || 'model';

  return {
    mesh,
    modelHash,
    normalizeMatrix,
    // Export'ta orijinal uzaya dönmek için kullanılacak
    denormalizeMatrix: normalizeMatrix.clone().invert(),
    fileName: file.name,
    meshCount: countMeshes(gltf.scene),
  };
}

/** GLTFLoader.parse'ın promise sarmalayıcısı. */
function parseGLB(buffer) {
  return new Promise((resolve, reject) => {
    loader.parse(buffer, '', resolve, reject);
  });
}

/** Sahnedeki en çok vertex'e sahip mesh'i seçer. */
function pickLargestMesh(root) {
  let best = null;
  let bestCount = -1;

  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    const count = object.geometry.getAttribute('position')?.count ?? 0;
    if (count > bestCount) {
      best = object;
      bestCount = count;
    }
  });

  return best;
}

function countMeshes(root) {
  let count = 0;
  root.traverse((object) => {
    if (object.isMesh) count += 1;
  });
  return count;
}

/**
 * Mesh'in dünya matrisini geometry'ye uygular ve indexli hale getirir.
 * Index buffer komşuluk grafiği için şart.
 */
function bakeWorldTransform(source) {
  const geometry = source.geometry.clone();
  geometry.applyMatrix4(source.matrixWorld);

  if (!geometry.index) {
    // Indexsiz geometry'de her üçgen kendi vertex'lerini taşır; komşuluk
    // grafiği kurulamaz. Yapay bir index üretiyoruz, kaynaştırmayı
    // adjacency tarafındaki pozisyon anahtarı hallediyor.
    const count = geometry.getAttribute('position').count;
    const index = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) index[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
  }

  geometry.computeBoundingBox();
  if (!geometry.getAttribute('normal')) {
    geometry.computeVertexNormals();
  }

  return geometry;
}

/**
 * Geometry'yi yerinde normalize eder ve uygulanan matrisi döner.
 * X/Z ortalanır, taban y=0'a oturur, yükseklik TARGET_HEIGHT olur.
 */
function normalizeGeometry(geometry) {
  const box = geometry.boundingBox;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const height = size.y || size.length() || 1;
  const scale = TARGET_HEIGHT / height;

  // Önce modeli origine taşı (X/Z merkez, Y taban), sonra ölçekle.
  const translate = new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z);
  const scaleMatrix = new THREE.Matrix4().makeScale(scale, scale, scale);
  const normalizeMatrix = scaleMatrix.multiply(translate);

  geometry.applyMatrix4(normalizeMatrix);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return normalizeMatrix;
}

/** Orijinal texture korunuyor, sadece render ayarları sabitleniyor. */
function cloneMaterial(material) {
  const source = Array.isArray(material) ? material[0] : material;
  if (!source) return new THREE.MeshStandardMaterial({ color: 0xbfc4cc });

  const clone = source.clone();
  clone.side = THREE.DoubleSide;
  return clone;
}

/** Annotation dosyalarının yanlış modele yüklenmesini engelleyen model kimliği. */
async function hashBuffer(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}
