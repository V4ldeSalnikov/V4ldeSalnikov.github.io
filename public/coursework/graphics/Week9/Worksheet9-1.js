"use strict";

window.onload = () => { main(); };

const TEAPOT_SCALE = 0.25;
const TEAPOT_Z = -3.0;
const JUMP_MIN_Y = -1.0;
const JUMP_MAX_Y = 0.5;

const GROUND_VERTICES = new Float32Array([
  -2.0, -1.0, -1.0,  0.0, 0.0,
   2.0, -1.0, -1.0,  1.0, 0.0,
   2.0, -1.0, -5.0,  1.0, 1.0,
  -2.0, -1.0, -5.0,  0.0, 1.0,
]);
const GROUND_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas  = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const status = document.getElementById("status");
  const jump = toggleButton("toggle-jump", "Stop teapot", "Start teapot");

  const groundPipeline = createGroundPipeline(device, format);
  const teapotPipeline = createTeapotPipeline(device, format);

  const ground = setupGround(device, groundPipeline, await loadTexture(device, "xamp23.png"));
  const teapot = await setupTeapot(device, teapotPipeline, status);

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });

  const Mst = mat4(vec4(1,0,0,0), vec4(0,1,0,0), vec4(0,0,0.5,0.5), vec4(0,0,0,1));
  const projection = mult(Mst, perspective(45.0, canvas.width / canvas.height, 0.1, 100.0));
  const eye  = vec3(0.0, 1.1, 2.2);
  const view = lookAt(eye, vec3(0.0, -0.45, TEAPOT_Z), vec3(0, 1, 0));
  const viewProj = mult(projection, view);

  device.queue.writeBuffer(ground.uniformBuffer, 0, flatten(viewProj));

  let jumpTime = 0.0, lastTime = null;

  function frame(timestampMs) {
    const time = timestampMs * 0.001;
    if (lastTime === null) lastTime = time;
    if (jump.enabled) jumpTime += time - lastTime;
    lastTime = time;

    const model = teapotModel(jumpY(jumpTime));
    const light = lightPosition(time);

    const data = new Float32Array(40);
    data.set(flatten(mult(viewProj, model)), 0);
    data.set(flatten(model), 16);
    data.set(light, 32);
    data.set([eye[0], eye[1], eye[2], 1.0], 36);
    device.queue.writeBuffer(teapot.uniformBuffer, 0, data);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear", storeOp: "store",
        clearValue: { r: 0.39, g: 0.56, b: 0.88, a: 1.0 }
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1.0
      }
    });
    drawObject(pass, ground, "uint16");
    drawObject(pass, teapot, "uint32");
    pass.end();
    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function teapotModel(y) {
  return mult(translate(0.0, y, TEAPOT_Z), scalem(TEAPOT_SCALE, TEAPOT_SCALE, TEAPOT_SCALE));
}
function jumpY(t) {
  const mid = (JUMP_MIN_Y + JUMP_MAX_Y) * 0.5;
  const amp = (JUMP_MAX_Y - JUMP_MIN_Y) * 0.5;
  return mid - amp * Math.cos(t * 2.0);
}
function lightPosition(t) {
  return vec4(2.0 * Math.sin(t), 2.0, TEAPOT_Z + 2.0 * Math.cos(t), 1.0);
}

function createTeapotPipeline(device, format) {
  const module = device.createShaderModule({ code: document.getElementById("teapot-wgsl").text });
  return device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module, entryPoint: "main_vs",
      buffers: [{
        arrayStride: 9 * 4,
        attributes: [
          { shaderLocation: 0, offset: 0,     format: "float32x3" },
          { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
          { shaderLocation: 2, offset: 6 * 4, format: "float32x3" },
        ]
      }]
    },
    fragment: { module, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
  });
}
function createGroundPipeline(device, format) {
  const module = device.createShaderModule({ code: document.getElementById("ground-wgsl").text });
  return device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module, entryPoint: "main_vs",
      buffers: [{
        arrayStride: 5 * 4,
        attributes: [
          { shaderLocation: 0, offset: 0,     format: "float32x3" },
          { shaderLocation: 1, offset: 3 * 4, format: "float32x2" },
        ]
      }]
    },
    fragment: { module, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
  });
}

function setupGround(device, pipeline, texture) {
  const vertexBuffer = makeBuffer(device, GROUND_VERTICES, GPUBufferUsage.VERTEX);
  const indexBuffer  = makeBuffer(device, GROUND_INDICES, GPUBufferUsage.INDEX);
  const uniformBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({
    addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", minFilter: "linear", magFilter: "linear"
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texture.createView() }
    ]
  });
  return { pipeline, vertexBuffer, indexBuffer, indexCount: GROUND_INDICES.length, uniformBuffer, bindGroup };
}

async function setupTeapot(device, pipeline, status) {
  const mesh = await loadTeapot(device, "teapot/teapot.obj");
  const uniformBuffer = device.createBuffer({ size: 40 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });
  status.textContent = `Teapot: ${mesh.vertexCount} vertices, ${mesh.indexCount / 3} triangles`;
  return { pipeline, vertexBuffer: mesh.vertexBuffer, indexBuffer: mesh.indexBuffer, indexCount: mesh.indexCount, uniformBuffer, bindGroup };
}

function drawObject(pass, object, indexFormat) {
  pass.setPipeline(object.pipeline);
  pass.setVertexBuffer(0, object.vertexBuffer);
  pass.setIndexBuffer(object.indexBuffer, indexFormat);
  pass.setBindGroup(0, object.bindGroup);
  pass.drawIndexed(object.indexCount);
}

function toggleButton(id, onText, offText) {
  const button = document.getElementById(id);
  const state = { enabled: true };
  button.textContent = onText;
  button.onclick = () => {
    state.enabled = !state.enabled;
    button.textContent = state.enabled ? onText : offText;
  };
  return state;
}

function makeBuffer(device, data, usage) {
  const buffer = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

async function loadTexture(device, url) {
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
  const texture = device.createTexture({
    size: [img.width, img.height, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });
  device.queue.copyExternalImageToTexture({ source: img }, { texture }, { width: img.width, height: img.height });
  return texture;
}

async function loadTeapot(device, url) {
  const obj = await readOBJFile(url, 1.0, false);
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
  return {
    vertexBuffer: makeBuffer(device, vertexData, GPUBufferUsage.VERTEX),
    indexBuffer:  makeBuffer(device, indices, GPUBufferUsage.INDEX),
    indexCount: indices.length,
    vertexCount: n
  };
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
