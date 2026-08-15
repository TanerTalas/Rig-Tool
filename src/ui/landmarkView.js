import * as THREE from 'three';

// Marker'lar dünya biriminde değil, ekranda sabit büyüklükte çiziliyor:
// modele yakınlaşınca şişip görüşü kapatmasınlar diye her karede kamera
// mesafesine göre ölçekleniyorlar.
const MARKER_PIXEL_RADIUS = 4.5;
const ACTIVE_PIXEL_RADIUS = 6.5;

const COLOR_PLACED = 0x4da3ff;
const COLOR_AUTO = 0x8d95a6;
const COLOR_ACTIVE = 0xffc043;

const BONE_COLOR = 0x62e08a;

/**
 * Landmark marker'ları ve iskelet çizimi.
 * Her ikisi de depthTest kapalı çiziliyor: eklem ve kemikler modelin içinde
 * kalıyor, kapalı çizilirse hiçbiri görünmez.
 */
export function createLandmarkView({ scene, camera, renderer }) {
  const markerGroup = new THREE.Group();
  markerGroup.name = 'landmark-markers';
  markerGroup.renderOrder = 998;
  scene.add(markerGroup);

  // Yarıçapı 1 olan küre; gerçek boyut her karede scale ile veriliyor.
  const markerGeometry = new THREE.SphereGeometry(1, 16, 12);
  const materials = {
    placed: markerMaterial(COLOR_PLACED),
    auto: markerMaterial(COLOR_AUTO),
    active: markerMaterial(COLOR_ACTIVE),
  };

  const markers = new Map();

  let skeletonRoot = null;
  let skeletonHelper = null;
  let activeId = null;

  function markerMaterial(color) {
    return new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
  }

  /** @param {Array<{id: string, position: THREE.Vector3|null, auto: boolean}>} entries */
  function setLandmarks(entries) {
    const seen = new Set();

    for (const entry of entries) {
      if (!entry.position) continue;
      seen.add(entry.id);

      let marker = markers.get(entry.id);
      if (!marker) {
        marker = new THREE.Mesh(markerGeometry, materials.placed);
        marker.renderOrder = 998;
        markerGroup.add(marker);
        markers.set(entry.id, marker);
      }

      marker.position.copy(entry.position);
      marker.userData.auto = entry.auto;
      marker.material = entry.id === activeId
        ? materials.active
        : entry.auto ? materials.auto : materials.placed;
    }

    for (const [id, marker] of markers) {
      if (seen.has(id)) continue;
      markerGroup.remove(marker);
      markers.delete(id);
    }
  }

  function setActive(id) {
    activeId = id;
    for (const [markerId, marker] of markers) {
      marker.material = markerId === activeId
        ? materials.active
        : marker.userData.auto ? materials.auto : materials.placed;
    }
  }

  function setSkeleton(root) {
    clearSkeleton();
    if (!root) return;

    skeletonRoot = root;
    scene.add(root);

    skeletonHelper = new THREE.SkeletonHelper(root);
    skeletonHelper.material.depthTest = false;
    skeletonHelper.material.transparent = true;
    skeletonHelper.material.linewidth = 2;
    skeletonHelper.renderOrder = 997;
    // SkeletonHelper varsayılan olarak kemik başına renk üretiyor; tek renk
    // daha okunaklı, iskeletin nereye oturduğunu görmek istiyoruz.
    paintHelper(skeletonHelper, BONE_COLOR);
    scene.add(skeletonHelper);
  }

  function clearSkeleton() {
    if (skeletonHelper) {
      scene.remove(skeletonHelper);
      skeletonHelper.dispose();
      skeletonHelper = null;
    }
    if (skeletonRoot) {
      scene.remove(skeletonRoot);
      skeletonRoot = null;
    }
  }

  function setSkeletonVisible(visible) {
    if (skeletonHelper) skeletonHelper.visible = visible;
  }

  function setMarkersVisible(visible) {
    markerGroup.visible = visible;
  }

  /**
   * Marker'ları ekranda sabit piksel boyutunda tutar.
   * Perspektif kamerada bir pikselin dünya karşılığı mesafeyle doğru orantılı:
   * worldPerPixel = 2 * d * tan(fov/2) / viewportHeight
   */
  function update() {
    const height = renderer.domElement.clientHeight || 1;
    const tangent = Math.tan((camera.fov * Math.PI) / 360);

    for (const [id, marker] of markers) {
      const distance = camera.position.distanceTo(marker.position);
      const worldPerPixel = (2 * distance * tangent) / height;
      const pixels = id === activeId ? ACTIVE_PIXEL_RADIUS : MARKER_PIXEL_RADIUS;
      marker.scale.setScalar(worldPerPixel * pixels);
    }
  }

  function dispose() {
    clearSkeleton();
    markerGroup.clear();
    markers.clear();
  }

  return {
    setLandmarks,
    setActive,
    setSkeleton,
    clearSkeleton,
    setSkeletonVisible,
    setMarkersVisible,
    update,
    dispose,
  };
}

function paintHelper(helper, color) {
  const target = new THREE.Color(color);
  const colors = helper.geometry.getAttribute('color');
  for (let i = 0; i < colors.count; i += 1) {
    colors.setXYZ(i, target.r, target.g, target.b);
  }
  colors.needsUpdate = true;
}
