import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { loadGLB } from './core/loader.js';
import { buildAdjacency } from './core/adjacency.js';
import { createPicker } from './ui/picker.js';
import { createPanel } from './ui/panel.js';

// Model 1 birim yüksekliğe normalize edildiği için kamera ve grid ölçüleri
// sabit kalabiliyor.
const MODEL_HEIGHT = 1;

const canvas = document.getElementById('viewport');
const dropzone = document.getElementById('dropzone');
const panel = createPanel(document.getElementById('panel'));

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

const picker = createPicker({
  renderer,
  camera,
  scene,
  onPick: (hit) => {
    panel.addPick(hit);
    console.log('[pick]', {
      point: hit.point.toArray().map((value) => Number(value.toFixed(4))),
      faceIndex: hit.faceIndex,
      faceVertices: hit.face ? [hit.face.a, hit.face.b, hit.face.c] : null,
      nearestVertexIndex: hit.nearestVertexIndex,
      uv: hit.uv ? hit.uv.toArray().map((value) => Number(value.toFixed(4))) : null,
    });
  },
});

panel.onClearMarkers(() => picker.clearMarkers());

let currentMesh = null;

setupDragAndDrop();
window.addEventListener('resize', onResize);
renderer.setAnimationLoop(render);

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
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* -------------------------------------------------------------- model akışı */

async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.glb')) {
    console.warn('[loader] Sadece .glb dosyaları destekleniyor:', file.name);
    return;
  }

  try {
    const loaded = await loadGLB(file);
    setModel(loaded);
  } catch (error) {
    console.error('[loader] GLB yüklenemedi:', error);
  }
}

function setModel(loaded) {
  if (currentMesh) {
    scene.remove(currentMesh);
    currentMesh.geometry.dispose();
    currentMesh = null;
  }

  currentMesh = loaded.mesh;
  scene.add(currentMesh);
  picker.setTarget(currentMesh);
  picker.clearMarkers();

  dropzone.classList.add('dropzone--hidden');
  panel.setModel(loaded);
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
  panel.setStats(graph.stats);

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
    console.table(
      [...graph.islandSizes]
        .map((size, island) => ({ island, size, ratio: size / graph.stats.weldedCount }))
        .sort((a, b) => b.size - a.size)
        .slice(0, 10),
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
