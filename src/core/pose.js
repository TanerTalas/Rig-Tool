/**
 * Test pozları.
 *
 * Weight problemlerinin neredeyse tamamı üç harekette ortaya çıkıyor: kolu
 * kaldırmak, dizi bükmek, gövdeyi döndürmek. Bind pose'da her rig doğru
 * görünür, hata ancak kemik döndürülünce görülebilir.
 *
 * Bind pose'da hiçbir kemiğin rotasyonu olmadığı için kemik yerel eksenleri
 * dünya eksenleriyle aynı: rotation.z dünya Z'si etrafında döndürüyor.
 */

const DEGREE = Math.PI / 180;

export const TEST_POSES = [
  {
    id: 'bind',
    label: 'Bind pose',
    rotations: {},
  },
  {
    id: 'raiseArms',
    label: 'Kolları kaldır',
    // Karakter +Z'ye bakıyor, solu +X. Sol kolu kaldırmak için +Z ekseninde
    // pozitif, sağ kol için negatif dönüş gerekiyor.
    rotations: {
      'LeftArm': { z: 60 * DEGREE },
      'RightArm': { z: -60 * DEGREE },
    },
  },
  {
    id: 'bendKnees',
    label: 'Dizleri bük',
    // Diz geriye bükülür; karakter +Z'ye baktığı için baldır -Z'ye gider.
    rotations: {
      'LeftLeg': { x: 70 * DEGREE },
      'RightLeg': { x: 70 * DEGREE },
    },
  },
  {
    id: 'twistSpine',
    label: 'Gövdeyi döndür',
    rotations: {
      'Spine1': { y: 45 * DEGREE },
      'Neck': { y: -20 * DEGREE },
    },
  },
];

export function getTestPose(id) {
  return TEST_POSES.find((pose) => pose.id === id) ?? TEST_POSES[0];
}

/**
 * Pozu uygular. Her çağrıda tüm kemikler önce bind rotasyonuna (identity)
 * dönüyor, böylece pozlar üst üste binmiyor.
 *
 * Sadece rotasyon veriliyor, kemik konumları hiç değişmiyor: konum değişirse
 * inverse bind matrix'ler geçersiz olur ve model kalıcı olarak bozulur.
 */
export function applyTestPose(skeleton, poseId) {
  const pose = getTestPose(poseId);
  const boneByName = new Map(skeleton.bones.map((bone) => [bone.name, bone]));

  for (const bone of skeleton.bones) {
    bone.rotation.set(0, 0, 0);
  }

  for (const [name, rotation] of Object.entries(pose.rotations)) {
    const bone = boneByName.get(name);
    if (!bone) continue;
    bone.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
  }

  rootBoneOf(skeleton).updateMatrixWorld(true);
  return pose;
}

/** Kemik zincirinin kökü: parent'ı kemik olmayan kemik. */
export function rootBoneOf(skeleton) {
  return skeleton.bones.find((bone) => !bone.parent?.isBone) ?? skeleton.bones[0];
}

/** Tek bir kemiği döndürür; Aşama 3'teki poz slider'ları bunu kullanacak. */
export function rotateBone(bone, axis, radians) {
  bone.rotation[axis] = radians;
  bone.updateMatrixWorld(true);
}

export { DEGREE };
