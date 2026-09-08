<p align="center">
  <img src="docs/banner.svg" alt="Rig Tool — a browser-based rigging and region labelling tool" width="100%">
</p>

<p align="center">
  <em>Turns a GLB that knows nothing into a GLB that knows what it is.</em>
</p>

---

## What is this for?

A GLB that comes out of Meshy or Tripo — or off your own modelling desk — is a
**bare surface**. There are no bones inside it, and nothing records which
triangles are the scarf and which are the hand. Drop it into a Three.js scene
and all you have is a pile of vertices: you can't move the character, you can't
say "make that scarf flutter in the wind", and you can't tell an AI assistant
working on the scene what lives where in the model.

Rig Tool fills that gap. You open the model in the browser, click a few points
to show where the joints are, and the tool builds the skeleton, computes how
much each vertex is bound to each bone, and hands you three files:

| File | What it's for |
| --- | --- |
| `model.rigged.glb` | The boned, skinned model. Loads as a `SkinnedMesh` in Three.js and deforms when you rotate the bones. |
| `model.rig.json` | Raw data: landmarks, regions, vertex index lists. **Can be loaded back into the tool** so you pick up where you left off. |
| `model.context.md` | A summary a human or an assistant can read: bone tree, coordinates, labelled parts, sample code. |

That last file is the real idea behind the project: when you hand the model to
an assistant, a document goes with it saying "`LeftForeArm` is here, the part
called `Atkı` is made of these vertices and is bound to the `Spine` bone".

---

## Pipeline

<p align="center">
  <img src="docs/pipeline.svg" alt="Load → Landmarks → Skeleton → Weights → Regions → Export" width="100%">
</p>

---

## Quick start

Node 20+ required.

```bash
git clone <repo-url>
cd rig-tool
npm install
npm run dev
```

Drag a `.glb` file onto the page that opens. That's it — no server, no account,
no upload; the model never leaves your browser.

```bash
npm run build     # static output into dist/
npm run preview   # serve the build locally
```

> **Developer shortcut:** when testing the same model over and over, open it
> with `?model=boy.glb&landmarks=boy.landmarks.json` — that skips the
> drag-and-drop step and loads the landmarks along with it.

---

## Usage

### 1 · Load

Drag in the GLB. The model is **normalized to 1 unit tall** (Meshy output
arrives at any scale, and camera and threshold values need to stay fixed). The
normalization matrix is kept, so you can reapply it on export.

Loading also builds the adjacency graph; the console prints vertex count, island
count and average neighbour count. Duplicate vertices at the same position (UV
seams) are merged with an epsilon tolerance — without that merge, distance
walked along the surface stops dead at the seam.

### 2 · Place landmarks

Pick a joint in the panel, then click that spot on the model. There are
**20 landmarks**: hips, waist, chest, neck, head, and — for both sides —
clavicle / shoulder / elbow / wrist and hip / knee / ankle.

- With **symmetry** on, every point you place on the left is mirrored to the
  right — half the work.
- With **estimate joint centre** on, what's taken is not the surface point you
  clicked but the centre inside the limb. An elbow isn't on the skin, it's in
  the middle of the arm.
- Each landmark carries a hint describing where it belongs.
- Validation runs live: if the spine order is wrong, if a bone is near zero
  length, or if the facing direction looks reversed, the panel warns you.

`Save JSON` writes the landmarks to disk, `Load JSON` brings them back.

### 3 · Skeleton

Once the landmarks are complete, a **20-bone** hierarchy is built automatically:

```
Hips
├── Spine ── Spine1 ─┬── Neck ── Head ── HeadTop
│                    ├── LeftShoulder  ── LeftArm  ── LeftForeArm  ── LeftHand
│                    └── RightShoulder ── RightArm ── RightForeArm ── RightHand
├── LeftUpLeg  ── LeftLeg  ── LeftFoot
└── RightUpLeg ── RightLeg ── RightFoot
```

The names follow the common humanoid convention; no prefixes, no finger bones.
On chibi and stylized models, finger bones do nothing but wreck the weight
computation.

### 4 · Compute weights

This is where it's decided how much each vertex is influenced by which bone.
There are two methods; you can compute both and compare them side by side in the
panel.

<p align="center">
  <img src="docs/geodesic.svg" alt="Euclidean distance compared with geodesic distance" width="100%">
</p>

**Naive (Euclidean)** — straight-line distance through the air. It's kept for
reference: to see how wrong it gets, and to measure how much the geodesic method
fixes. Because the arm hangs close to the torso, chest vertices pick up weight
from the arm bone; raise the arm and the chest comes up with it.

**Geodesic (surface)** — distance is measured by walking across the mesh
surface. Your hand may be 3 cm from your thigh through the air, but walking the
surface the road between them is the whole length of the arm; weight doesn't
leak. On top of that, **bone thickness** can be taken into account: distance is
measured from the surface of the limb rather than from the bone axis, so a thin
arm can't pull the wall of a thick torso towards itself.

Adjustable parameters:

| Parameter | Range | Default | Effect |
| --- | --- | --- | --- |
| distance exponent (`p`) | 1 – 8 | 4 | The higher it goes, the more the nearest bone dominates and the harder the transitions get. |
| smoothing | 0 – 5 | 1 | Files down weight differences between neighbouring vertices, softening the creases at joints. |
| bone thickness | on / off | on | Measures distance from the surface of the limb rather than from the bone axis. |

The results section tells you in numbers whether it went well: duration, average
number of influencing bones, **idle bones** (bones that command no vertex at
all) and **leak ratio** (the share of torso vertices taking weight from arm
bones). Above 5% leak, the panel turns into a warning.

### 5 · Inspect — heatmap and test poses

A weight algorithm can't be developed without visual feedback, so the diagnostic
tools aren't a separate add-on, they're part of the flow:

- **Heatmap** — pick a bone and see its weight on every vertex as colour. With
  `LeftArm` selected, the arm should be red and the chest blue.
- **Rotate bone** — turn a single bone live with the X/Y/Z sliders and catch the
  leak while it's moving.
- **Test poses** — ready-made poses: raise an arm, bend a leg, return to bind
  pose.
- **Inspect vertex** — click the model to list the bones influencing that vertex
  and their weight values.

### 6 · Label regions

However good automatic weights get, leakage remains on parts like a scarf, a
cape or hair: these parts sit against a limb in space but really belong to the
torso. Region mode is for fixing that by hand.

You click the model, the selection spreads across the surface and stops on one
of two conditions: when it exceeds the **spread distance** limit, or when the
angle against the neighbouring face passes the **edge angle** threshold (a sharp
edge is a natural border). For harder parts you can click point by point around
the outline and hit `Close the loop and fill`, and you can invert the selection.

You name the selection and save it — ready-made names like `Atkı` (scarf),
`Pelerin` (cape) and `Sol El` (left hand) are in the list. A saved region can be
pinned to a single bone or blended with it at a given ratio.

Regions aren't only there to fix weights — they're also there to **name the
part**. Once "this is the scarf" has been extracted, it travels along in
`rig.json` and pays off in everything that comes after: per-part materials,
textures, animation constraints.

### 7 · Export

Download the three files in one go or one at a time. With `Restore original
scale` on, the model goes back to the scale of the source GLB; with it off, it
stays 1 unit tall.

> The browser may block files that come down back to back. The first time, say
> yes to the "allow multiple downloads" prompt; if one doesn't arrive, download
> it on its own from above.

---

## The output: what does `context.md` look like?

```markdown
## Kemikler

| kemik      | konum (x, y, z)       |
| ---        | ---                   |
| `Hips`     | -0.079, 0.627, -0.005 |
| `LeftArm`  |  0.097, 1.117, -0.004 |
| ...

## Etiketlenmiş parçalar

| parça  | vertex | merkez (x, y, z)    | boyut (g × y × d)     | bağlı kemik   |
| ---    | ---    | ---                 | ---                   | ---           |
| Atkı   | 195    | 0.326, 0.625, 0.221 | 0.524 × 0.501 × 0.278 | `Spine` (%80) |
| Sol El | 331    | 0.296, 0.541, 0.003 | 0.145 × 0.274 × 0.223 | `LeftHand`    |
```

Alongside it come the facing direction, the model height, an example of reaching
a bone, and usage notes such as "use `rotation` to turn a bone, `position`
breaks the bind pose". The coordinates are in **exactly the same space** as the
exported GLB: all three files are produced from a single export mesh.

> The interface and the generated `context.md` are in Turkish; bone names follow
> the English humanoid convention.

On the Three.js side:

```js
const bone = model.getObjectByName('LeftArm');
bone.rotation.z = Math.PI / 4;

const region = rig.regions.find((r) => r.name === 'Atkı');
// region.vertices -> indices into geometry.attributes.position
```

---

## Project structure

```
src/
├── core/                 pure logic, knows nothing about the DOM
│   ├── loader.js         GLB loading, scale normalization
│   ├── adjacency.js      adjacency graph, duplicate vertex merging
│   ├── landmarks.js      landmark store and symmetry
│   ├── skeleton.js       bone hierarchy from landmarks
│   ├── geodesic.js       shortest distance across the surface (Dijkstra)
│   ├── weights.js        naive and geodesic weight computation
│   ├── regions.js        flood fill selection, path finding, weight override
│   ├── pose.js           test poses
│   ├── validate.js       landmark consistency checks
│   └── exporter.js       GLB + rig.json + context.md generation
├── ui/                   panel sections and controllers
├── templates/
│   └── humanoid.json     landmark and bone schema
└── main.js               wiring only
```

The single production dependency is **Three.js**. Dijkstra, flood fill and the
adjacency graph are hand-written — not worth carrying a library for this.

---

## Known limits

- **Works with a single mesh.** If the GLB holds more than one mesh, the one
  with the most vertices is picked and the rest are left out. Merge multi-part
  models into one mesh first.
- **No finger bones.** On stylized models they do more harm than good.
- **Up to ~50k vertices** the main thread is comfortable. Above that, weight
  computation keeps you waiting noticeably; moving it to a Web Worker is a job
  for after the measurement.
- **Disconnected islands** (detached hair, accessories) can't be reached by
  distance walked along the surface; those islands are bound to the nearest
  bone. The console reports how many islands it found.
- **Animation is not this tool's job.** The tool gets the model ready for
  animation; you write the animation in the project that uses the model.

---

## License

[MIT](LICENSE)
