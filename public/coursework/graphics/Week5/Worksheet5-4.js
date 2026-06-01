"use strict";

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
    arrayStride: 9 * 4,
    attributes: [
      { shaderLocation: 0, offset: 0,     format: "float32x3" },
      { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
      { shaderLocation: 2, offset: 6 * 4, format: "float32x3" },
    ]
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

  const status = document.getElementById("status");
  const obj = await readOBJFile("teapot.obj", 1.0, false);
  const mesh = uploadMesh(device, obj);
  status.textContent = `Teapot loaded: ${obj.vertices.length / 4} vertices, ${mesh.indexCount / 3} triangles`;

  const Mst = mat4(
    vec4(1, 0, 0,   0),
    vec4(0, 1, 0,   0),
    vec4(0, 0, 0.5, 0.5),
    vec4(0, 0, 0,   1)
  );
  const P = mult(Mst, perspective(45.0, canvas.width / canvas.height, 0.1, 100.0));
  const M = mult(scalem(0.5, 0.5, 0.5), translate(-0.22, -1.58, 0.0));
  const radius = 5.0;
  const lightDir = [1.0, 1.0, 1.0];

  const params = { kd: 0.8, ks: 0.4, s: 32, Le: 1.0, La: 0.2 };

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

  function draw(seconds) {
    const a = 0.25 * seconds;
    const eye = vec3(radius * Math.sin(a), 2.0, radius * Math.cos(a));
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
        clearValue: { r: 0.91, g: 0.93, b: 1.0, a: 1.0 }
      }],
      depthStencilAttachment: {
        view: depthTex.createView(),
        depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1.0
      }
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, mesh.vertexBuffer);
    pass.setIndexBuffer(mesh.indexBuffer, "uint32");
    pass.drawIndexed(mesh.indexCount);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function frame(timestamp) {
    draw(timestamp * 0.001);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function uploadMesh(device, obj) {
  const n = obj.vertices.length / 4;
  const vertexData = new Float32Array(n * 9);
  for (let i = 0; i < n; ++i) {
    vertexData[i*9+0] = obj.vertices[i*4+0];
    vertexData[i*9+1] = obj.vertices[i*4+1];
    vertexData[i*9+2] = obj.vertices[i*4+2];
    vertexData[i*9+3] = obj.normals[i*4+0];
    vertexData[i*9+4] = obj.normals[i*4+1];
    vertexData[i*9+5] = obj.normals[i*4+2];
    vertexData[i*9+6] = obj.colors[i*4+0];
    vertexData[i*9+7] = obj.colors[i*4+1];
    vertexData[i*9+8] = obj.colors[i*4+2];
  }

  const indices = stripMaterialIndices(obj.indices);

  const vertexBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexData);

  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  return { vertexBuffer, indexBuffer, indexCount: indices.length };
}

function stripMaterialIndices(indices) {
  const triangles = indices.length / 4;
  const out = new Uint32Array(triangles * 3);
  for (let t = 0; t < triangles; ++t) {
    out[t*3+0] = indices[t*4+0];
    out[t*3+1] = indices[t*4+1];
    out[t*3+2] = indices[t*4+2];
  }
  return out;
}
