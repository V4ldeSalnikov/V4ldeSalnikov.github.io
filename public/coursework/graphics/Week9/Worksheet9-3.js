"use strict";

window.onload = () => { main(); };

const TEAPOT_SCALE = 0.25;
const TEAPOT_Z = -3.0;
const JUMP_MIN_Y = -1.0;
const JUMP_MAX_Y = 0.5;
const SHADOW_MAP_SIZE = 1024;
const SHADOW_MAP_FORMAT = "rgba32float";

const GROUND_VERTICES = new Float32Array([
  -2.0, -1.0, -1.0,  0.0, 0.0,
   2.0, -1.0, -1.0,  1.0, 0.0,
   2.0, -1.0, -5.0,  1.0, 1.0,
  -2.0, -1.0, -5.0,  0.0, 1.0,
]);
const GROUND_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);

const Mst = mat4(vec4(1,0,0,0), vec4(0,1,0,0), vec4(0,0,0.5,0.5), vec4(0,0,0,1));

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas  = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const status = document.getElementById("status");
  const jump  = toggleButton("toggle-jump",  "Stop teapot", "Start teapot");
  const light = toggleButton("toggle-light", "Stop light",  "Start light");
  const map   = toggleButton("toggle-map",   "Hide map",    "Show map", false);

  const shadowMap = createShadowMap(device);
  const pipelines = createPipelines(device, format);

  const ground = setupGround(device, pipelines, shadowMap, await loadTexture(device, "xamp23.png"));
  const teapot = await setupTeapot(device, pipelines, shadowMap, status);
  const debug  = device.createBindGroup({
    layout: pipelines.debug.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: shadowMap.colorTexture.createView() }]
  });

  const canvasDepth = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });

  const projection = mult(Mst, perspective(45.0, canvas.width / canvas.height, 0.1, 100.0));
  const eye  = vec3(0.0, 1.1, 2.2);
  const view = lookAt(eye, vec3(0.0, -0.45, TEAPOT_Z), vec3(0, 1, 0));
  const viewProj = mult(projection, view);

  let jumpTime = 0.0, lightTime = 0.0, lastTime = null;

  function frame(timestampMs) {
    const time = timestampMs * 0.001;
    if (lastTime === null) lastTime = time;
    const dt = time - lastTime;
    lastTime = time;
    if (jump.enabled)  jumpTime  += dt;
    if (light.enabled) lightTime += dt;

    const model = teapotModel(jumpY(jumpTime));
    const lightPos = lightPosition(lightTime);
    const lightViewProj = lightViewProjMatrix(lightPos);

    device.queue.writeBuffer(ground.depthUniform, 0, flatten(lightViewProj));
    device.queue.writeBuffer(teapot.depthUniform, 0, flatten(mult(lightViewProj, model)));

    const groundData = new Float32Array(40);
    groundData.set(flatten(viewProj), 0);
    groundData.set(flatten(lightViewProj), 16);
    groundData.set(lightPos, 32);
    device.queue.writeBuffer(ground.uniformBuffer, 0, groundData);

    const teapotData = new Float32Array(56);
    teapotData.set(flatten(mult(viewProj, model)), 0);
    teapotData.set(flatten(model), 16);
    teapotData.set(flatten(lightViewProj), 32);
    teapotData.set(lightPos, 48);
    teapotData.set([eye[0], eye[1], eye[2], 1.0], 52);
    device.queue.writeBuffer(teapot.uniformBuffer, 0, teapotData);

    const encoder = device.createCommandEncoder();

    const shadowPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: shadowMap.colorTexture.createView(),
        loadOp: "clear", storeOp: "store",
        clearValue: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 }
      }],
      depthStencilAttachment: {
        view: shadowMap.depthTexture.createView(),
        depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1.0
      }
    });
    drawDepth(shadowPass, ground, "uint16");
    drawDepth(shadowPass, teapot, "uint32");
    shadowPass.end();

    const cameraPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear", storeOp: "store",
        clearValue: { r: 0.39, g: 0.56, b: 0.88, a: 1.0 }
      }],
      depthStencilAttachment: {
        view: canvasDepth.createView(),
        depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1.0
      }
    });
    if (map.enabled) {
      cameraPass.setPipeline(pipelines.debug);
      cameraPass.setBindGroup(0, debug);
      cameraPass.draw(6);
    } else {
      drawCamera(cameraPass, ground, "uint16");
      drawCamera(cameraPass, teapot, "uint32");
    }
    cameraPass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function lightViewProjMatrix(lightPos) {
  const Vl = lookAt(vec3(lightPos[0], lightPos[1], lightPos[2]), vec3(0.0, -0.35, TEAPOT_Z), vec3(0, 1, 0));
  const Pl = mult(Mst, perspective(95.0, 1.0, 0.1, 8.0));
  return mult(Pl, Vl);
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

function createShadowMap(device) {
  return {
    colorTexture: device.createTexture({
      size: [SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, 1],
      format: SHADOW_MAP_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    }),
    depthTexture: device.createTexture({
      size: [SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, 1],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    })
  };
}

function createPipelines(device, format) {
  const depthModule  = device.createShaderModule({ code: document.getElementById("depth-wgsl").text });
  const teapotModule = device.createShaderModule({ code: document.getElementById("teapot-wgsl").text });
  const groundModule = device.createShaderModule({ code: document.getElementById("ground-wgsl").text });
  const debugModule  = device.createShaderModule({ code: document.getElementById("debug-wgsl").text });

  const depthPipeline = (stride) => device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: depthModule, entryPoint: "main_vs_depth",
      buffers: [{ arrayStride: stride, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }]
    },
    fragment: { module: depthModule, entryPoint: "main_fs_depth", targets: [{ format: SHADOW_MAP_FORMAT }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
  });

  return {
    depthGround: depthPipeline(5 * 4),
    depthTeapot: depthPipeline(9 * 4),
    ground: device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: groundModule, entryPoint: "main_vs",
        buffers: [{
          arrayStride: 5 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0,     format: "float32x3" },
            { shaderLocation: 1, offset: 3 * 4, format: "float32x2" },
          ]
        }]
      },
      fragment: { module: groundModule, entryPoint: "main_fs", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
    }),
    teapot: device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: teapotModule, entryPoint: "main_vs",
        buffers: [{
          arrayStride: 9 * 4,
          attributes: [
            { shaderLocation: 0, offset: 0,     format: "float32x3" },
            { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
            { shaderLocation: 2, offset: 6 * 4, format: "float32x3" },
          ]
        }]
      },
      fragment: { module: teapotModule, entryPoint: "main_fs", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
    }),
    debug: device.createRenderPipeline({
      layout: "auto",
      vertex:   { module: debugModule, entryPoint: "main_vs" },
      fragment: { module: debugModule, entryPoint: "main_fs", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "always" }
    })
  };
}

function setupGround(device, pipelines, shadowMap, texture) {
  const vertexBuffer = makeBuffer(device, GROUND_VERTICES, GPUBufferUsage.VERTEX);
  const indexBuffer  = makeBuffer(device, GROUND_INDICES, GPUBufferUsage.INDEX);
  const uniformBuffer = device.createBuffer({ size: 40 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const depthUniform  = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({
    addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", minFilter: "linear", magFilter: "linear"
  });
  const bindGroup = device.createBindGroup({
    layout: pipelines.ground.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: texture.createView() },
      { binding: 3, resource: shadowMap.colorTexture.createView() }
    ]
  });
  const depthBindGroup = device.createBindGroup({
    layout: pipelines.depthGround.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: depthUniform } }]
  });
  return {
    pipeline: pipelines.ground, depthPipeline: pipelines.depthGround,
    vertexBuffer, indexBuffer, indexCount: GROUND_INDICES.length,
    uniformBuffer, depthUniform, bindGroup, depthBindGroup
  };
}

async function setupTeapot(device, pipelines, shadowMap, status) {
  const mesh = await loadTeapot(device, "teapot/teapot.obj");
  const uniformBuffer = device.createBuffer({ size: 56 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const depthUniform  = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bindGroup = device.createBindGroup({
    layout: pipelines.teapot.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: shadowMap.colorTexture.createView() }
    ]
  });
  const depthBindGroup = device.createBindGroup({
    layout: pipelines.depthTeapot.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: depthUniform } }]
  });
  status.textContent = `Teapot: ${mesh.vertexCount} vertices, ${mesh.indexCount / 3} triangles`;
  return {
    pipeline: pipelines.teapot, depthPipeline: pipelines.depthTeapot,
    vertexBuffer: mesh.vertexBuffer, indexBuffer: mesh.indexBuffer, indexCount: mesh.indexCount,
    uniformBuffer, depthUniform, bindGroup, depthBindGroup
  };
}

function drawDepth(pass, object, indexFormat) {
  pass.setPipeline(object.depthPipeline);
  pass.setVertexBuffer(0, object.vertexBuffer);
  pass.setIndexBuffer(object.indexBuffer, indexFormat);
  pass.setBindGroup(0, object.depthBindGroup);
  pass.drawIndexed(object.indexCount);
}
function drawCamera(pass, object, indexFormat) {
  pass.setPipeline(object.pipeline);
  pass.setVertexBuffer(0, object.vertexBuffer);
  pass.setIndexBuffer(object.indexBuffer, indexFormat);
  pass.setBindGroup(0, object.bindGroup);
  pass.drawIndexed(object.indexCount);
}

function toggleButton(id, onText, offText, initial = true) {
  const button = document.getElementById(id);
  const state = { enabled: initial };
  button.textContent = state.enabled ? onText : offText;
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
