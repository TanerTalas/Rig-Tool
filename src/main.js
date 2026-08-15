import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { loadGLB } from './core/loader.js';
import { buildAdjacency } from './core/adjacency.js';
import { readJSONFile } from './core/annotations.js';
import { createPicker } from './ui/picker.js';
import { createPanel } from './ui/panel.js';
import { registerModelSections } from './ui/modelPanel.js';
import { registerLandmarkSections } from './ui/landmarkPanel.js';
import { createLandmarkView } from './ui/landmarkView.js';
import { createLandmarkController } from './ui/landmarkController.js';
import { registerWeightSections } from './ui/weightPanel.js';
import { createWeightController } from './ui/weightController.js';
import { registerDebugSections } from './ui/debugPanel.js';
import { createDebugController } from './ui/debugController.js';
import { createDebugView } from './ui/debugView.js';

// Model 1 birim yüksekliğe normalize edildiği için kamera ve grid ölçüleri
// sabit kalabiliyor.
const MODEL_HEIGHT = 1;

const canvas = document.getElementById('viewport');
const dropzone = document.getElementById('dropzone');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14161a);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, MODEL_HEIGHT * 0.6, MODEL_HEIGHT * 2.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, MODEL_HEIGHT * 0.5, 0);

setupEnvironment();

// Panel bölümleri güncel state'i okuyabilsin diye paylaşılan tek bir nesne.
const state = { model: null, stats: null };

const panel = createPanel(document.getElementById('panel'));
const landmarkView = createLandmarkView({ scene, camera, renderer });

// Ham (skinlenmemiş) mesh her zaman saklanıyor: weight hesabı bundan
// yeniden üretiliyor ve iskelet değişince sahne buna geri dönüyor.
let baseMesh = null;
let currentMesh = null;

const landmarks = createLandmarkController({
  view: landmarkView,
  onRefresh: () => panel.refresh(),
  onSkeletonChange: () => weights?.invalidate(),
});

const debugView = createDebugView();

const weights = createWeightController({
  landmarks,
  getBaseMesh: () => baseMesh,
  setSceneMesh: (mesh) => setSceneMesh(mesh),
  onRefresh: () => panel.refresh(),
  onWeightsChanged: () => debug?.onWeightsChanged(),
});

const debug = createDebugController({
  view: debugView,
  landmarks,
  weights,
  onRefresh: () => panel.refresh(),
});

registerModelSections(panel, state);
registerLandmarkSections(panel, landmarks);
registerWeightSections(panel, weights);
registerDebugSections(panel, debug);
panel.refresh();

const picker = createPicker({
  renderer,
  camera,
  // Tıklama önceliği: yerleştirilecek bir landmark varsa o kazanır, yoksa
  // skinlenmiş modelde vertex incelemesine düşer.
  onPick: (hit) => {
    if (landmarks.activeId) {
      landmarks.handlePick(hit);
    } else if (debug.isAvailable) {
      debug.handlePick(hit);
    }
  },
});

// Geliştirme modunda sahneyi konsoldan incelemek için dışarı aç.
if (import.meta.env.DEV) {
  window.__rig = {
    scene,
    camera,
    landmarks,
    weights,
    debug,
    get mesh() {
      return currentMesh;
    },
    get baseMesh() {
      return baseMesh;
    },
  };
}

setupDragAndDrop();
loadFromQuery();
window.addEventListener('resize', onResize);
renderer.setAnimationLoop(render);

/**
 * Geliştirme kolaylığı: ?model=boy.glb&landmarks=boy.landmarks.json ile
 * sürükle-bırak yapmadan yükler. Aynı modeli defalarca test ederken
 * her seferinde dosya sürüklemek zaman kaybı.
 */
async function loadFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const modelPath = params.get('model');
  if (!modelPath) return;

  try {
    const model = await fetchAsFile(modelPath);
    await handleFile(model);

    const landmarkPath = params.get('landmarks');
    if (landmarkPath) {
      landmarks.applyJSON(await (await fetch(`/${landmarkPath}`)).json());
    }
  } catch (error) {
    console.error('[loader] URL üzerinden yükleme başarısız:', error);
  }
}

async function fetchAsFile(path) {
  const response = await fetch(`/${path}`);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return new File([await response.blob()], path.split('/').pop());
}

/* -------------------------------------------------------------------- sahne */

function setupEnvironment() {
  const grid = new THREE.GridHelper(4, 16, 0x3a4150, 0x252a33);
  grid.material.transparent = true;
  grid.material.opacity = 0.6;
  scene.add(grid);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 3, 2.5);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xa8c4ff, 0.8);
  fill.position.set(-2.5, 1.5, -2);
  scene.add(fill);
}

function render() {
  controls.update();
  landmarkView.update();
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* -------------------------------------------------------------- model akışı */

async function handleFile(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.json')) {
    await handleAnnotationFile(file);
    return;
  }

  if (!name.endsWith('.glb')) {
    console.warn('[loader] Sadece .glb ve .json dosyaları destekleniyor:', file.name);
    return;
  }

  try {
    const loaded = await loadGLB(file);
    setModel(loaded);
  } catch (error) {
    console.error('[loader] GLB yüklenemedi:', error);
  }
}

async function handleAnnotationFile(file) {
  if (!state.model) {
    console.warn('[landmark] Önce bir GLB yükle.');
    return;
  }

  try {
    landmarks.applyJSON(await readJSONFile(file));
  } catch (error) {
    console.error('[landmark] JSON okunamadı:', error);
  }
}

/** Sahnedeki modeli değiştirir: ham mesh <-> SkinnedMesh geçişi buradan. */
function setSceneMesh(mesh) {
  if (currentMesh === mesh) return;

  if (currentMesh) scene.remove(currentMesh);
  currentMesh = mesh;
  scene.add(currentMesh);
  picker.setTarget(currentMesh);
  debugView.setMesh(currentMesh);
}

function setModel(loaded) {
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh = null;
  }
  if (baseMesh && baseMesh !== loaded.mesh) {
    baseMesh.geometry.dispose();
  }

  baseMesh = loaded.mesh;
  weights.reset();
  setSceneMesh(baseMesh);

  state.model = loaded;
  state.stats = null;

  dropzone.classList.add('dropzone--hidden');
  landmarks.setModel(loaded);
  frameModel(currentMesh);

  console.log('[loader] yüklendi:', {
    file: loaded.fileName,
    meshCount: loaded.meshCount,
    modelHash: loaded.modelHash,
    normalizeScale: Number(loaded.normalizeMatrix.getMaxScaleOnAxis().toFixed(5)),
  });

  analyzeMesh(currentMesh);
}

/** Komşuluk grafiğini kurar ve teşhis istatistiklerini basar. */
function analyzeMesh(mesh) {
  const started = performance.now();
  const graph = buildAdjacency(mesh.geometry);
  const elapsed = performance.now() - started;

  mesh.userData.adjacency = graph;
  state.stats = graph.stats;
  panel.refresh();

  console.log('[adjacency] mesh istatistikleri:', {
    ...graph.stats,
    avgNeighbors: Number(graph.stats.avgNeighbors.toFixed(2)),
    largestIslandRatio: Number(graph.stats.largestIslandRatio.toFixed(4)),
    buildMs: Number(elapsed.toFixed(1)),
  });

  if (graph.stats.islandCount > 1) {
    console.warn(
      `[adjacency] Mesh ${graph.stats.islandCount} bağlantısız adaya bölünmüş. ` +
        'Geodezik mesafe adalar arasında yürüyemez; bu adalar için ada bazlı ' +
        'en yakın kemik ataması gerekecek.',
    );
  }

  if (graph.stats.isolatedCount > 0) {
    console.warn(`[adjacency] ${graph.stats.isolatedCount} vertex hiçbir üçgene bağlı değil.`);
  }
}

/** Kamerayı modelin bounding box'ına göre konumlandırır. */
function frameModel(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const distance = (Math.max(size.x, size.y, size.z) * 1.6) /
    Math.tan((camera.fov * Math.PI) / 360);

  controls.target.copy(center);
  camera.position.set(center.x, center.y + size.y * 0.1, center.z + distance);
  camera.near = distance / 100;
  camera.far = distance * 20;
  camera.updateProjectionMatrix();
  controls.update();
}

/* ---------------------------------------------------------------- drag-drop */

function setupDragAndDrop() {
  let dragDepth = 0;

  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    dropzone.classList.add('dropzone--active');
  });

  window.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  window.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropzone.classList.remove('dropzone--active');
  });

  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropzone.classList.remove('dropzone--active');

    const file = event.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
}
