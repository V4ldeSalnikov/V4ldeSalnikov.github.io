"use strict";

const TEXTURING_AT  = 18;
const NUMSAMPLES_AT = 19;
const MIN_SUBDIV = 1;
const MAX_SUBDIV = 10;

window.onload = function () { main(); };

async function main() {
  const canvas = document.getElementById("my-canvas");
  const textureToggle = document.getElementById("toggle-texture");
  const subdivInc = document.getElementById("subdiv-inc");
  const subdivDec = document.getElementById("subdiv-dec");
  const subdivLabel = document.getElementById("subdiv-label");

  let subdivs = 1;

  const camera = { eye: [2.0, 1.5, 2.0], center: [0.0, 0.5, 0.0], up: [0.0, 1.0, 0.0], camConst: 1.0 };
  const plane = material({
    base: [0.1, 0.7, 0.0],
    point: [0.0, 0.0, 0.0], tangent: [-1.0, 0.0, 0.0], binormal: [0.0, 0.0, 1.0], normal: [0.0, 1.0, 0.0],
  });
  const sphere = material({ base: [0.0, 0.0, 0.0], center: [0.0, 0.5, 0.0], radius: 0.3 });
  const triangle = material({
    base: [0.4, 0.3, 0.2],
    v0: [-0.2, 0.1, 0.9], v1: [0.2, 0.1, 0.9], v2: [-0.2, 0.1, -0.1],
  });
  const light = { position: [0.0, 1.0, 0.0], intensity: [Math.PI, Math.PI, Math.PI] };
  const background = [0.1, 0.3, 0.6];

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  const aspect  = canvas.width / canvas.height;
  const forward = normalize(subtract(camera.center, camera.eye));
  const right   = normalize(cross(forward, camera.up));
  const up      = cross(right, forward);

  const uniforms = new Float32Array([
    ...camera.eye, 0.0,
    ...right,      0.0,
    ...up,         0.0,
    ...forward,    0.0,
    aspect, camera.camConst, textureToggle.checked ? 1.0 : 0.0, subdivs * subdivs,

    ...plane.point,    0.0,
    ...plane.tangent,  0.0,
    ...plane.binormal, 0.0,
    ...plane.normal,   0.0,
    ...plane.ambient,  0.0,
    ...plane.diffuse,  0.0,

    ...sphere.center,  sphere.radius,
    ...sphere.ambient, 0.0,
    ...sphere.diffuse, 0.0,

    ...triangle.v0,      0.0,
    ...triangle.v1,      0.0,
    ...triangle.v2,      0.0,
    ...triangle.ambient, 0.0,
    ...triangle.diffuse, 0.0,

    ...background,      1.0,
    ...light.position,  0.0,
    ...light.intensity, 0.0,
  ]);
  const uniformBuffer = device.createBuffer({
    size: uniforms.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const PIXEL_SIZE = 1.0 / canvas.height;
  const jitter = new Float32Array(MAX_SUBDIV * MAX_SUBDIV * 2);
  const jitterBuffer = device.createBuffer({
    size: jitter.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const wgsl = device.createShaderModule({ code: document.getElementById("raytracing-wgsl").text });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex:   { module: wgsl, entryPoint: "vs_main" },
    fragment: { module: wgsl, entryPoint: "fs_main", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-strip" },
  });
  const texture = await load_texture(device, "grass.jpg");
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: texture.createView() },
      { binding: 2, resource: { buffer: jitterBuffer } },
    ],
  });

  function render() {
    uniforms[TEXTURING_AT]  = textureToggle.checked ? 1.0 : 0.0;
    uniforms[NUMSAMPLES_AT] = subdivs * subdivs;
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store",
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function uploadJitters() {
    compute_jitters(jitter, PIXEL_SIZE, subdivs);
    device.queue.writeBuffer(jitterBuffer, 0, jitter);
  }

  function setSubdivs(level) {
    subdivs = Math.min(MAX_SUBDIV, Math.max(MIN_SUBDIV, level));
    const total = subdivs * subdivs;
    subdivLabel.textContent = `${subdivs} × ${subdivs} (${total} sample${total === 1 ? "" : "s"})`;
    subdivDec.disabled = subdivs === MIN_SUBDIV;
    subdivInc.disabled = subdivs === MAX_SUBDIV;
    uploadJitters();
    render();
  }

  subdivInc.addEventListener("click", () => setSubdivs(subdivs + 1));
  subdivDec.addEventListener("click", () => setSubdivs(subdivs - 1));
  textureToggle.addEventListener("change", render);

  setSubdivs(subdivs);
}

function material(obj) {
  obj.ambient = obj.base.map(c => 0.1 * c);
  obj.diffuse = obj.base.map(c => 0.9 * c);
  return obj;
}

function compute_jitters(jitter, pixelsize, subdivs) {
  const step = pixelsize / subdivs;
  if (subdivs < 2) {
    jitter[0] = 0.0;
    jitter[1] = 0.0;
    return;
  }
  for (let i = 0; i < subdivs; ++i) {
    for (let j = 0; j < subdivs; ++j) {
      const idx = (i * subdivs + j) * 2;
      jitter[idx]     = (Math.random() + j) * step - pixelsize * 0.5;
      jitter[idx + 1] = (Math.random() + i) * step - pixelsize * 0.5;
    }
  }
}

async function load_texture(device, filename) {
  const response = await fetch(filename);
  const blob = await response.blob();
  const img = await createImageBitmap(blob, { colorSpaceConversion: "none" });
  const texture = device.createTexture({
    size: [img.width, img.height, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture(
    { source: img, flipY: true },
    { texture },
    { width: img.width, height: img.height },
  );
  return texture;
}
