import * as THREE from 'three';

// Marker yarıçapı, model 1 birim yüksekliğe normalize edildiği için sabit
// kalabiliyor: modelin yüzde birine denk geliyor.
const MARKER_RADIUS = 0.01;
const MARKER_COLOR = 0x4da3ff;

// Tıklama ile sürükleme ayrımı: fare basıldıktan sonra bu eşikten fazla
// hareket ettiyse OrbitControls kullanılıyordur, pick sayılmaz.
const DRAG_THRESHOLD_PX = 4;

/**
 * Mesh üzerine raycast ile tıklama ve tıklanan noktaya marker koyma.
 *
 * Aşama 1'de landmark yerleştirme bu katmanın üstüne kurulacak; şimdilik
 * amaç raycast'in doğru noktayı bulduğunu gözle doğrulamak.
 */
export function createPicker({ renderer, camera, scene, onPick }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const markerGroup = new THREE.Group();
  markerGroup.name = 'markers';
  scene.add(markerGroup);

  const markerGeometry = new THREE.SphereGeometry(MARKER_RADIUS, 16, 12);
  const markerMaterial = new THREE.MeshBasicMaterial({
    color: MARKER_COLOR,
    depthTest: false,
  });

  let target = null;
  let pointerDown = null;

  const element = renderer.domElement;

  element.addEventListener('pointerdown', (event) => {
    pointerDown = { x: event.clientX, y: event.clientY, button: event.button };
  });

  element.addEventListener('pointerup', (event) => {
    if (!pointerDown || pointerDown.button !== 0 || event.button !== 0) {
      pointerDown = null;
      return;
    }

    const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    pointerDown = null;
    if (moved > DRAG_THRESHOLD_PX) return;

    const hit = raycast(event);
    if (hit) handlePick(hit);
  });

  function raycast(event) {
    if (!target) return null;

    const rect = element.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const [hit] = raycaster.intersectObject(target, false);
    return hit ?? null;
  }

  function handlePick(hit) {
    addMarker(hit.point);

    // Aşama 0'ın teşhis çıktısı: raycast'in ne döndürdüğünü görmek istiyoruz.
    const info = {
      point: hit.point.clone(),
      faceIndex: hit.faceIndex,
      face: hit.face,
      uv: hit.uv ? hit.uv.clone() : null,
      distance: hit.distance,
      nearestVertexIndex: nearestVertexOfFace(hit),
    };

    onPick?.(info);
  }

  function addMarker(point) {
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.position.copy(point);
    marker.renderOrder = 999;
    markerGroup.add(marker);
    return marker;
  }

  /** Vurulan üçgenin köşelerinden tıklama noktasına en yakın olanı. */
  function nearestVertexOfFace(hit) {
    if (!hit.face || !target) return null;

    const position = target.geometry.getAttribute('position');
    const candidates = [hit.face.a, hit.face.b, hit.face.c];
    const vertex = new THREE.Vector3();

    let best = null;
    let bestDistance = Infinity;

    for (const candidate of candidates) {
      vertex.fromBufferAttribute(position, candidate);
      const distance = vertex.distanceTo(hit.point);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }

    return best;
  }

  return {
    setTarget(mesh) {
      target = mesh;
    },
    clearMarkers() {
      markerGroup.clear();
    },
    get markerCount() {
      return markerGroup.children.length;
    },
  };
}
