import * as THREE from 'three';

// Tıklama ile sürükleme ayrımı: fare basıldıktan sonra bu eşikten fazla
// hareket ettiyse OrbitControls kullanılıyordur, pick sayılmaz.
const DRAG_THRESHOLD_PX = 4;

// İki ayrı yüzey kesişimi sayılması için gereken minimum mesafe farkı.
// Aynı üçgen kenarına denk gelen çift kesişimleri eler.
const SURFACE_EPSILON = 1e-4;

/**
 * Mesh üzerine raycast.
 *
 * İki nokta birden üretiyor:
 * - surfacePoint: ışının çarptığı ilk yüzey noktası
 * - centerPoint : ilk iki yüzey kesişiminin orta noktası, yani uzvun içindeki
 *   yaklaşık merkez
 *
 * İkincisi landmark için önemli: dirsek, diz, omuz gibi eklemler mesh'in
 * yüzeyinde değil içinde. Kullanıcı kolun dışına tıklıyor ama kemik kolun
 * ortasından geçmeli. Material DoubleSide olduğu için ışın uzvu delip
 * çıkıyor ve arka yüzeyi de yakalayabiliyoruz.
 */
export function createPicker({ renderer, camera, onPick }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const element = renderer.domElement;

  let target = null;
  let pointerDown = null;
  let enabled = true;

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
    if (moved > DRAG_THRESHOLD_PX || !enabled) return;

    const hit = pick(event);
    if (hit) onPick?.(hit);
  });

  function pick(event) {
    if (!target) return null;

    const rect = element.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(target, false);
    if (!hits.length) return null;

    const front = hits[0];
    const back = hits.find((hit) => hit.distance > front.distance + SURFACE_EPSILON) ?? null;

    const surfacePoint = front.point.clone();
    const centerPoint = back
      ? surfacePoint.clone().add(back.point).multiplyScalar(0.5)
      : surfacePoint.clone();

    return {
      surfacePoint,
      centerPoint,
      // Uzvun ışın boyunca kalınlığı; landmark'ın ne kadar içeri kaydığını
      // gösteriyor, şüpheli tıklamaları ayıklamaya yarıyor.
      thickness: back ? back.distance - front.distance : 0,
      hitCount: hits.length,
      faceIndex: front.faceIndex,
      face: front.face,
      uv: front.uv ? front.uv.clone() : null,
      nearestVertexIndex: nearestVertexOfFace(front),
    };
  }

  /** Vurulan üçgenin köşelerinden tıklama noktasına en yakın olanı. */
  function nearestVertexOfFace(hit) {
    if (!hit.face || !target) return null;

    const position = target.geometry.getAttribute('position');
    const vertex = new THREE.Vector3();

    let best = null;
    let bestDistance = Infinity;

    for (const candidate of [hit.face.a, hit.face.b, hit.face.c]) {
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
    setEnabled(value) {
      enabled = value;
    },
  };
}
