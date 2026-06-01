"use strict";

const SUBDIV_LEVEL = 5;

window.onload = () => { main(); };

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas  = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const module = device.createShaderModule({ code: document.getElementById("wgsl").text });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module, entryPoint: "main_vs",
      buffers: [{
        arrayStride: 3 * 4,
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }]
      }]
    },
    fragment: { module, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
  });

  const sphere = buildSphere(SUBDIV_LEVEL);
  const vertexBuffer = device.createBuffer({
    size: sphere.positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(vertexBuffer, 0, sphere.positions);

  const indexBuffer = device.createBuffer({
    size: sphere.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(indexBuffer, 0, sphere.indices);

  const uniformBuffer = device.createBuffer({
    size: sizeof['mat4'],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });

  const earth = await loadTexture(device, "earth.jpg");
  const sampler = device.createSampler({
    addressModeU: "repeat",
    addressModeV: "clamp-to-edge",
    minFilter: "linear",
    magFilter: "linear",
    mipmapFilter: "linear",
    lodMaxClamp: earth.maxLod
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: earth.texture.createView() }
    ]
  });

  const depthTexture = device.createTexture({
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
  const projection = mult(Mst, perspective(45.0, canvas.width / canvas.height, 0.1, 100.0));

  const orbit = { yaw: 0.0, pitch: radians(-10), radius: 6.0 };
  setupDrag(canvas, orbit);

  function draw(seconds) {
    const yaw = orbit.yaw + radians(12.0) * seconds;
    const eye = vec3(
      orbit.radius * Math.cos(orbit.pitch) * Math.sin(yaw),
      orbit.radius * Math.sin(orbit.pitch),
      orbit.radius * Math.cos(orbit.pitch) * Math.cos(yaw)
    );
    const view = lookAt(eye, vec3(0, 0, 0), vec3(0, 1, 0));
    device.queue.writeBuffer(uniformBuffer, 0, flatten(mult(projection, view)));

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear", storeOp: "store",
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1.0
      }
    });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.setBindGroup(0, bindGroup);
    pass.drawIndexed(sphere.indexCount);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function frame(timestamp) {
    draw(timestamp * 0.001);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

async function loadTexture(device, url) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });

  const mipLevelCount = numMipLevels(img.width, img.height);
  const texture = device.createTexture({
    size: [img.width, img.height, 1],
    format: "rgba8unorm",
    mipLevelCount,
    usage: GPUTextureUsage.TEXTURE_BINDING |
           GPUTextureUsage.COPY_DST |
           GPUTextureUsage.RENDER_ATTACHMENT
  });
  device.queue.copyExternalImageToTexture(
    { source: img },
    { texture },
    { width: img.width, height: img.height }
  );
  generateMipmap(device, texture);

  return { texture, maxLod: mipLevelCount - 1 };
}

function setupDrag(canvas, orbit) {
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    orbit.yaw += (e.clientX - lastX) * 0.005;
    orbit.pitch += (e.clientY - lastY) * 0.005;
    orbit.pitch = Math.max(-radians(85), Math.min(radians(85), orbit.pitch));
    lastX = e.clientX; lastY = e.clientY;
  });
  canvas.addEventListener("pointerup", () => { dragging = false; });
}

function buildSphere(level) {
  let mesh = createBaseTetrahedron();
  for (let i = 0; i < level; ++i) mesh = subdivide(mesh);

  const positions = new Float32Array(mesh.positions.length * 3);
  for (let i = 0; i < mesh.positions.length; ++i) {
    positions[i*3+0] = mesh.positions[i][0];
    positions[i*3+1] = mesh.positions[i][1];
    positions[i*3+2] = mesh.positions[i][2];
  }
  const indices = new Uint32Array(mesh.faces.length * 3);
  for (let i = 0; i < mesh.faces.length; ++i) {
    indices[i*3+0] = mesh.faces[i][0];
    indices[i*3+1] = mesh.faces[i][1];
    indices[i*3+2] = mesh.faces[i][2];
  }
  return { positions, indices, indexCount: indices.length };
}

function createBaseTetrahedron() {
  const r2 = Math.sqrt(2.0), r6 = Math.sqrt(6.0);
  const positions = [
    [0, 0, 1],
    [0, 2 * r2 / 3, -1 / 3],
    [-r6 / 3, -r2 / 3, -1 / 3],
    [r6 / 3, -r2 / 3, -1 / 3],
  ];
  const faces = [[0, 1, 2], [0, 3, 1], [1, 3, 2], [0, 2, 3]];
  return { positions, faces };
}

function subdivide(mesh) {
  const positions = mesh.positions.map((p) => p.slice());
  const faces = [];
  const midCache = new Map();

  function midpoint(a, b) {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    let idx = midCache.get(key);
    if (idx === undefined) {
      const pa = positions[a], pb = positions[b];
      idx = positions.length;
      positions.push(normalizeVec([pa[0] + pb[0], pa[1] + pb[1], pa[2] + pb[2]]));
      midCache.set(key, idx);
    }
    return idx;
  }

  for (const [a, b, c] of mesh.faces) {
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    faces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  return { positions, faces };
}

function normalizeVec(v) {
  const inv = 1 / Math.hypot(v[0], v[1], v[2]);
  return [v[0] * inv, v[1] * inv, v[2] * inv];
}
