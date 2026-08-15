import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

import { buildSkeleton } from './skeleton.js';
import { regionCentroid } from './regions.js';

/**
 * Export (Aşama 6).
 *
 * Projenin ürünü üç dosya:
 *  - <model>.rigged.glb : skinned model, orijinal ölçeğinde
 *  - <model>.rig.json   : landmark + kemik + bölge tanımları, araca geri yüklenebilir
 *  - <model>.context.md : modelde ne nerede, bir asistana doğrudan verilebilir
 *
 * Ölçek: model yüklenirken 1 birim yüksekliğe normalize edilmişti. Export'ta
 * sadece ÖLÇEK geri veriliyor, kaynak dosyanın konumu değil: model X/Z'de
 * ortalanmış ve tabanı y=0'da duruyor. Kaynak GLB'de model orijinin etrafına
 * yayılmış olabiliyor (bu örnekte kalça y=-0.33'te kalıyordu) ve o hali başka
 * bir sahnede kullanmayı zorlaştırıyor.
 *
 * İskelet, ölçeklenmiş landmark konumlarından YENİDEN kuruluyor. Mevcut
 * iskeleti ölçeklemek yerine yeniden kurmak, inverse bind matrix'lerin doğru
 * uzayda hesaplanmasını garanti ediyor — bind pose hataları hep bu noktada
 * çıkıyor.
 */

/**
 * @param {object} params
 * @param {THREE.Mesh} params.baseMesh skinlenmemiş ham mesh
 * @param {object} params.weights skinIndices/skinWeights
 * @param {Map<string, THREE.Vector3>} params.landmarks normalize uzayda
 * @param {THREE.Matrix4} params.normalizeMatrix yüklemede uygulanan matris
 * @param {boolean} [params.originalScale] false ise 1 birim boyunda kalır
 */
export function buildExportMesh({
  baseMesh,
  weights,
  landmarks,
  normalizeMatrix,
  originalScale = true,
}) {
  // Sadece ölçek geri veriliyor; taban y=0 ve X/Z merkez korunuyor.
  const factor = originalScale ? 1 / normalizeMatrix.getMaxScaleOnAxis() : 1;
  const matrix = new THREE.Matrix4().makeScale(factor, factor, factor);

  const geometry = baseMesh.geometry.clone();
  geometry.applyMatrix4(matrix);

  // Heatmap ve bölge renkleri sahne içi teşhis araçları; export edilirse
  // COLOR_0 olarak gider ve modeli boyar.
  geometry.deleteAttribute('color');

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(weights.skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights.skinWeights, 4));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const scaled = new Map();
  for (const [id, position] of landmarks) {
    scaled.set(id, position.clone().applyMatrix4(matrix));
  }

  const rig = buildSkeleton(scaled);

  const material = Array.isArray(baseMesh.material)
    ? baseMesh.material[0].clone()
    : baseMesh.material.clone();
  material.wireframe = false;
  material.transparent = false;
  material.opacity = 1;
  material.vertexColors = false;

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = baseMesh.name || 'model';
  mesh.add(rig.root);
  mesh.updateMatrixWorld(true);
  // bindMatrix açıkça veriliyor: tek argümanlı bind() inverse'leri yeniden
  // hesaplayıp o anki duruşu bind pose sanıyor.
  mesh.bind(rig.skeleton, mesh.matrixWorld);

  return { mesh, rig, landmarks: scaled, matrix };
}

/** GLB ikili verisi üretir. */
export function exportGLB(object) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      object,
      (result) => resolve(result),
      (error) => reject(error),
      { binary: true, onlyVisible: false },
    );
  });
}

/**
 * Araca geri yüklenebilir ham veri.
 * Landmark'lar normalize uzayda saklanıyor (araç o uzayda çalışıyor),
 * bölgeler orijinal vertex index'leriyle.
 */
export function buildRigJSON({ model, landmarkStore, regionStore, graph, skeleton, stats }) {
  return {
    version: 1,
    tool: 'rig-tool',
    model: {
      file: model.fileName,
      hash: model.modelHash,
      vertexCount: stats?.vertexCount ?? null,
      // Normalize uzaydan orijinal ölçeğe dönüş matrisi; koordinatları
      // orijinal GLB uzayına çevirmek isteyen için.
      denormalizeMatrix: model.denormalizeMatrix.elements.slice(),
    },
    space: 'normalized',
    landmarks: landmarkStore.toJSON(model.modelHash).landmarks,
    bones: skeleton
      ? skeleton.bones.map((bone) => ({
          name: bone.name,
          parent: bone.parent?.isBone ? bone.parent.name : null,
          position: worldPositionOf(bone),
        }))
      : [],
    regions: regionStore.toJSON(model.modelHash, graph).regions,
  };
}

/**
 * Asistana verilecek özet.
 *
 * Vertex index listesi bilerek yok: bu dosya okunabilir kalmalı. Konum, boyut
 * ve hangi kemiğin sürdüğü bilgisi "modelde ne nerede" sorusunu cevaplamaya
 * yetiyor; ham veri rig.json'da duruyor.
 */
export function buildContextMarkdown({ model, skeleton, regions, graph, stats, exportedScale }) {
  const lines = [];
  const scale = exportedScale;

  lines.push(`# ${model.fileName} — model bağlamı`);
  lines.push('');
  lines.push('Bu dosya, riglenmiş GLB ile birlikte gelir ve modelde neyin nerede');
  lines.push('olduğunu anlatır. Koordinatlar export edilen GLB ile aynı uzayda.');
  lines.push('');

  lines.push('## Model');
  lines.push('');
  lines.push(`- Kaynak dosya: \`${model.fileName}\``);
  lines.push(`- Vertex sayısı: ${stats?.vertexCount ?? '?'}`);
  lines.push(`- Model yüksekliği: ${scale.height.toFixed(3)} birim`);
  lines.push("- Konum: X/Z'de ortalanmış, tabanı y=0'da");
  lines.push(`- Bakış yönü: ${scale.facing > 0 ? '+Z' : '-Z'} (karakterin solu ${scale.facing > 0 ? '+X' : '-X'})`);
  lines.push('');

  if (skeleton) {
    lines.push('## Kemikler');
    lines.push('');
    lines.push('Hiyerarşi ve bind pose konumları:');
    lines.push('');
    lines.push('```');
    for (const line of boneTree(skeleton)) lines.push(line);
    lines.push('```');
    lines.push('');
    lines.push('| kemik | konum (x, y, z) |');
    lines.push('| --- | --- |');
    for (const bone of skeleton.bones) {
      const p = worldPositionOf(bone);
      lines.push(`| \`${bone.name}\` | ${p.map((v) => v.toFixed(3)).join(', ')} |`);
    }
    lines.push('');
    lines.push('Three.js\'te bir kemiğe erişim:');
    lines.push('');
    lines.push('```js');
    lines.push("const bone = model.getObjectByName('LeftArm');");
    lines.push('bone.rotation.z = Math.PI / 4;');
    lines.push('```');
    lines.push('');
  }

  if (regions?.length) {
    lines.push('## Etiketlenmiş parçalar');
    lines.push('');
    lines.push('| parça | vertex | merkez (x, y, z) | boyut (g × y × d) | bağlı kemik |');
    lines.push('| --- | --- | --- | --- | --- |');

    for (const region of regions) {
      const box = regionBounds(region, graph, scale.matrix);
      const centroid = regionCentroid(region, graph).applyMatrix4(scale.matrix);
      const size = new THREE.Vector3();
      box.getSize(size);

      lines.push(
        `| ${region.name} | ${region.vertices.length} | ` +
          `${centroid.toArray().map((v) => v.toFixed(3)).join(', ')} | ` +
          `${size.toArray().map((v) => v.toFixed(3)).join(' × ')} | ` +
          `${region.boundBone ? `\`${region.boundBone}\`${region.strength < 1 ? ` (%${Math.round(region.strength * 100)})` : ''}` : '—'} |`,
      );
    }

    lines.push('');
    lines.push('Parçaların vertex index listeleri `rig.json` içinde. Bir parçayı');
    lines.push('kodda seçmek için:');
    lines.push('');
    lines.push('```js');
    lines.push("const region = rig.regions.find((r) => r.name === 'Atkı');");
    lines.push('// region.vertices -> geometry.attributes.position içindeki index\'ler');
    lines.push('```');
    lines.push('');
  } else {
    lines.push('## Etiketlenmiş parçalar');
    lines.push('');
    lines.push('Henüz parça etiketlenmemiş.');
    lines.push('');
  }

  lines.push('## Notlar');
  lines.push('');
  lines.push('- Model skinned: `SkinnedMesh` olarak yükleniyor, kemikler döndürülünce deforme oluyor.');
  lines.push('- Kemik isimleri yaygın humanoid konvansiyonu, önek yok, parmak kemiği yok.');
  lines.push('- Bir kemiği döndürmek için `rotation` kullan; `position` değiştirmek bind pose\'u bozar.');

  return lines.join('\n');
}

/* ------------------------------------------------------------------ helpers */

function worldPositionOf(bone) {
  const position = new THREE.Vector3();
  bone.getWorldPosition(position);
  return position.toArray().map((value) => Number(value.toFixed(5)));
}

function boneTree(skeleton) {
  const root = skeleton.bones.find((bone) => !bone.parent?.isBone) ?? skeleton.bones[0];
  const lines = [];

  const walk = (bone, depth) => {
    lines.push(`${'  '.repeat(depth)}${bone.name}`);
    for (const child of bone.children) {
      if (child.isBone) walk(child, depth + 1);
    }
  };

  walk(root, 0);
  return lines;
}

function regionBounds(region, graph, matrix) {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();

  for (const welded of region.vertices) {
    point.set(
      graph.positions[welded * 3],
      graph.positions[welded * 3 + 1],
      graph.positions[welded * 3 + 2],
    );
    box.expandByPoint(point.applyMatrix4(matrix));
  }

  return box;
}
