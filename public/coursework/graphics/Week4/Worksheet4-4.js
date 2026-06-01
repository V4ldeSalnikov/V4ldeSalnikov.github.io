"use strict";

const MAX_LEVEL = 6;

window.onload = () => { main(); };

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas  = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const module = device.createShaderModule({ code: document.getElementById("wgsl").text });

  const vertexLayout = {
    arrayStride: sizeof['vec3'],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }]
  };

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex:   { module, entryPoint: "main_vs", buffers: [vertexLayout] },
    fragment: { module, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list", frontFace: "ccw", cullMode: "back" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
  });

  const uniformData   = new Float32Array(48);
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

  const depthTex = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });

  const Mst = mat4(
    vec4(1, 0, 0,   0),
    vec4(0, 1, 0,   0),
    vec4(0, 0, 0.5, 0.5),
    vec4(0, 0, 0,   1)
  );
  const P = mult(Mst, perspective(45.0, canvas.width / canvas.height, 0.1, 100.0));
  const M = mat4();
  const radius = 4.0;
  const lightDir = [0.0, 0.0, 1.0];

  const params = { kd: 0.8, ks: 0.4, s: 32, Le: 1.0, La: 0.2 };

  const meshCache = [createBaseTetrahedron()];
  let level = 0;
  let vertexBuffer, indexBuffer, indexCount;

  function setLevel(n) {
    level = n;
    for (let i = meshCache.length; i <= level; ++i) {
      meshCache[i] = subdivide(meshCache[i - 1]);
    }
    const { positions, indices } = meshToBuffers(meshCache[level]);

    vertexBuffer = device.createBuffer({
      size: positions.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(vertexBuffer, 0, positions);

    indexBuffer = device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(indexBuffer, 0, indices);
    indexCount = indices.length;

    label.textContent = `Subdivision Level: ${level}`;
    incBtn.disabled = level >= MAX_LEVEL;
    decBtn.disabled = level <= 0;
  }

  function draw(seconds) {
    if (!vertexBuffer) return;

    const a = 0.5 * seconds;
    const eye = vec3(radius * Math.sin(a), 0.0, radius * Math.cos(a));
    const V = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));

    uniformData.set(flatten(mult(P, mult(V, M))), 0);
    uniformData.set(flatten(M), 16);
    uniformData.set([eye[0], eye[1], eye[2], 1.0], 32);
    uniformData.set([lightDir[0], lightDir[1], lightDir[2], 0.0], 36);
    uniformData.set([params.kd, params.ks, params.s, 0.0], 40);
    uniformData.set([params.Le, params.La, 0.0, 0.0], 44);
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear", storeOp: "store",
        clearValue: { r: 0.9, g: 0.94, b: 1.0, a: 1.0 }
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1.0
      }
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.drawIndexed(indexCount);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function frame(timestamp) {
    draw(timestamp * 0.001);
    requestAnimationFrame(frame);
  }

  const label  = document.getElementById("subdiv-label");
  const incBtn = document.getElementById("subdiv-inc");
  const decBtn = document.getElementById("subdiv-dec");
  incBtn.addEventListener("click", () => { if (level < MAX_LEVEL) setLevel(level + 1); });
  decBtn.addEventListener("click", () => { if (level > 0)         setLevel(level - 1); });

  const sliders = [
    { id: "kd", fmt: (v) => v.toFixed(2) },
    { id: "ks", fmt: (v) => v.toFixed(2) },
    { id: "s",  fmt: (v) => Math.round(v).toString() },
    { id: "le", key: "Le", fmt: (v) => v.toFixed(2) },
    { id: "la", key: "La", fmt: (v) => v.toFixed(2) },
  ];
  for (const { id, key, fmt } of sliders) {
    const slider = document.getElementById(`${id}-slider`);
    const value  = document.getElementById(`${id}-value`);
    const k = key || id;
    slider.addEventListener("input", () => {
      params[k] = parseFloat(slider.value);
      value.textContent = fmt(params[k]);
    });
  }

  setLevel(0);
  requestAnimationFrame(frame);
}

function createBaseTetrahedron() {
  const r2 = Math.sqrt(2.0), r6 = Math.sqrt(6.0);
  const positions = [
    [0.0,        0.0,        1.0],
    [0.0,        2.0*r2/3.0, -1.0/3.0],
    [-r6/3.0,   -r2/3.0,     -1.0/3.0],
    [ r6/3.0,   -r2/3.0,     -1.0/3.0],
  ];
  const faces = [[0,1,2], [0,3,1], [1,3,2], [0,2,3]];
  return { positions, faces };
}

function subdivide(mesh) {
  const positions = mesh.positions.map((p) => p.slice());
  const faces = [];
  const midCache = new Map();

  function midpoint(i, j) {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`;
    if (midCache.has(key)) return midCache.get(key);
    const a = positions[i], b = positions[j];
    const idx = positions.length;
    positions.push(normalizeVec([a[0]+b[0], a[1]+b[1], a[2]+b[2]]));
    midCache.set(key, idx);
    return idx;
  }

  for (const [a, b, c] of mesh.faces) {
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    faces.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
  }
  return { positions, faces };
}

function meshToBuffers(mesh) {
  const positions = new Float32Array(mesh.positions.length * 3);
  mesh.positions.forEach((p, i) => { positions.set(p, i * 3); });
  const indices = new Uint32Array(mesh.faces.length * 3);
  mesh.faces.forEach((f, i) => { indices.set(f, i * 3); });
  return { positions, indices };
}

function normalizeVec(v) {
  const inv = 1 / Math.hypot(v[0], v[1], v[2]);
  return [v[0] * inv, v[1] * inv, v[2] * inv];
}
