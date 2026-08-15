import * as THREE from 'three';

import { humanoidTemplate } from './landmarks.js';

/**
 * Landmark'lardan Three.js kemik hiyerarşisi ve Skeleton üretir.
 *
 * Kritik nokta: landmark'lar dünya koordinatında toplanıyor ama
 * `bone.position` parent'a GÖRE offset. Bu yüzden her kemiğin konumundan
 * parent'ının dünya konumu çıkarılıyor. Bind pose'da hiçbir kemiğin
 * rotasyonu olmadığı için parent'ın dünya konumu = parent'ın landmark'ı.
 *
 * `new THREE.Skeleton(bones)` constructor'ı inverse bind matrix'leri mevcut
 * dünya matrislerinden hesaplıyor. Bu yüzden Skeleton kurulmadan önce
 * hiyerarşinin matrisleri güncellenmiş, poz verilmemiş olmalı — yanlış
 * sırada model export edildiğinde bükülmüş görünür.
 *
 * @param {Map<string, THREE.Vector3>} landmarkPositions
 * @param {object} [template]
 * @returns {{ root: THREE.Bone, bones: THREE.Bone[], skeleton: THREE.Skeleton, boneByName: Map<string, THREE.Bone> }}
 */
export function buildSkeleton(landmarkPositions, template = humanoidTemplate) {
  const missing = template.bones
    .filter((definition) => !landmarkPositions.has(definition.landmark))
    .map((definition) => definition.landmark);

  if (missing.length) {
    throw new Error(`Eksik landmark: ${missing.join(', ')}`);
  }

  const boneByName = new Map();
  const bones = [];
  let root = null;

  for (const definition of template.bones) {
    const bone = new THREE.Bone();
    bone.name = definition.name;

    const world = landmarkPositions.get(definition.landmark);

    if (definition.parent) {
      const parent = boneByName.get(definition.parent);
      if (!parent) {
        throw new Error(`${definition.name} kemiğinin parent'ı tanımlı değil: ${definition.parent}`);
      }
      const parentWorld = landmarkPositions.get(parentLandmarkOf(template, definition.parent));
      bone.position.copy(world).sub(parentWorld);
      parent.add(bone);
    } else {
      bone.position.copy(world);
      root = bone;
    }

    // Landmark bağlantısını sakla: UI'da kemik seçilince hangi landmark'tan
    // geldiğini göstermek ve yeniden hesaplamak için gerekiyor.
    bone.userData.landmark = definition.landmark;

    boneByName.set(definition.name, bone);
    bones.push(bone);
  }

  // Skeleton kurulmadan önce dünya matrisleri güncel olmalı.
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);

  return { root, bones, skeleton, boneByName };
}

/**
 * Kemik uzunlukları ve segmentleri. Aşama 2'deki naif weight hesabı
 * "vertex'ten kemik segmentine mesafe" istiyor; segment = kemikten parent'ına
 * çizilen doğru parçası.
 */
export function getBoneSegments(bones) {
  const segments = [];
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();

  for (const bone of bones) {
    if (!bone.parent?.isBone) continue;

    bone.getWorldPosition(end);
    bone.parent.getWorldPosition(start);

    segments.push({
      bone,
      name: bone.name,
      start: start.clone(),
      end: end.clone(),
      length: start.distanceTo(end),
    });
  }

  return segments;
}

function parentLandmarkOf(template, boneName) {
  const definition = template.bones.find((entry) => entry.name === boneName);
  return definition?.landmark ?? null;
}
