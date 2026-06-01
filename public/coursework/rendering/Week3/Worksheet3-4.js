"use strict";

const BASE_TEXTURE_SCALE = 0.2;
const MIN_SUBDIV = 1;
const MAX_SUBDIV = 10;

const TEXTURING_AT    = 18;
const NUMSAMPLES_AT   = 19;
const PLANE_SHADER_AT = 39;
const SCALE_AT        = 76;
const REPEAT_AT       = 77;
const LINEAR_AT       = 78;
const GAMMA_AT        = 79;

window.onload = function () { main(); };

async function main() {
  const canvas = document.getElementById("my-canvas");
  const textureToggle = document.getElementById("toggle-texture");
  const planeShaderSelect = document.getElementById("plane-shader");
  const addressSelect = document.getElementById("address-mode");
  const filterSelect = document.getElementById("filter-mode");
  const scaleSlider = document.getElementById("scale-divisor");
  const scaleLabel = document.getElementById("scale-label");
  const gammaSlider = document.getElementById("gamma");
  const gammaLabel = document.getElementById("gamma-label");
  const subdivInc = document.getElementById("subdiv-inc");
  const subdivDec = document.getElementById("subdiv-dec");
  const subdivLabel = document.getElementById("subdiv-label");

  let subdivs = MIN_SUBDIV;

  const camera = { eye: [2.0, 1.5, 2.0], center: [0.0, 0.5, 0.0], up: [0.0, 1.0, 0.0], camConst: 1.0 };
  const plane = {
    point: [0.0, 0.0, 0.0], tangent: [-1.0, 0.0, 0.0], binormal: [0.0, 0.0, 1.0], normal: [0.0, 1.0, 0.0],
    base: [0.1, 0.7, 0.0],
  };
  const sphere = { center: [0.0, 0.5, 0.0], radius: 0.3, base: [0.0, 0.0, 0.0] };
  const triangle = { v0: [-0.2, 0.1, 0.9], v1: [0.2, 0.1, 0.9], v2: [-0.2, 0.1, -0.1], base: [0.4, 0.3, 0.2] };
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
    aspect, camera.camConst, 0.0, 0.0,

    ...plane.point,    0.0,
    ...plane.tangent,  0.0,
    ...plane.binormal, 0.0,
    ...plane.normal,   0.0,
    ...plane.base,     0.0,

    ...sphere.center,  sphere.radius,
    ...sphere.base,    0.0,

    ...triangle.v0,    0.0,
    ...triangle.v1,    0.0,
    ...triangle.v2,    0.0,
    ...triangle.base,  0.0,

    ...background,      1.0,
    ...light.position,  0.0,
    ...light.intensity, 0.0,

    0.0, 0.0, 0.0, 0.0,
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
    uniforms[TEXTURING_AT]    = textureToggle.checked ? 1.0 : 0.0;
    uniforms[NUMSAMPLES_AT]   = subdivs * subdivs;
    uniforms[PLANE_SHADER_AT] = Number(planeShaderSelect.value);
    uniforms[SCALE_AT]        = BASE_TEXTURE_SCALE / Number(scaleSlider.value);
    uniforms[REPEAT_AT]       = Number(addressSelect.value);
    uniforms[LINEAR_AT]       = Number(filterSelect.value);
    uniforms[GAMMA_AT]        = Number(gammaSlider.value);
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
  planeShaderSelect.addEventListener("change", render);
  addressSelect.addEventListener("change", render);
  filterSelect.addEventListener("change", render);
  scaleSlider.addEventListener("input", () => { scaleLabel.textContent = `×${scaleSlider.value}`; render(); });
  gammaSlider.addEventListener("input", () => { gammaLabel.textContent = Number(gammaSlider.value).toFixed(1); render(); });

  setSubdivs(subdivs);
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
