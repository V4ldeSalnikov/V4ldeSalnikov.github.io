"use strict";

const FRAME_AT = 18;
const PROGRESSIVE_AT = 19;

window.onload = function () { main(); };

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const canTimestamp = adapter.features.has("timestamp-query");
  const device = await adapter.requestDevice({
    requiredFeatures: canTimestamp ? ["timestamp-query"] : [],
  });

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  const gpuTimeLabel = document.getElementById("gpu-time");
  const frameCountLabel = document.getElementById("frame-count");
  const sceneSelect = document.getElementById("scene-select");
  const shadingSelect = document.getElementById("shading-select");
  const progressiveToggle = document.getElementById("progressive-toggle");
  const renderButton = document.getElementById("render-button");

  const objects = {
    bunny:  { file: "../Week5/bunny.obj",  eye: [-0.02, 0.11, 0.6], center: [-0.02, 0.11, 0.0], camConst: 3.5 },
    teapot: { file: "../Week5/teapot.obj", eye: [0.15, 1.5, 10.0],  center: [0.15, 1.5, 0.0],   camConst: 1.8 },
  };
  const shadingModes = { base: 0, mirror: 1, diffuse: 2 };
  const baseColor = [0.82, 0.78, 0.70];

  const envTexture = await loadImageTexture(device, "../luxo_pxr_campus.jpg");
  const envSampler = device.createSampler({
    addressModeU: "repeat", addressModeV: "clamp-to-edge", magFilter: "linear", minFilter: "linear",
  });

  const wgsl = device.createShaderModule({ code: document.getElementById("raytracing-wgsl").text });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex:   { module: wgsl, entryPoint: "vs_main" },
    fragment: { module: wgsl, entryPoint: "fs_main", targets: [{ format: canvasFormat }, { format: "rgba32float" }] },
    primitive: { topology: "triangle-strip" },
  });

  const uniforms = new Float32Array(7 * 4);
  const uniformBuffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const renderSrc = device.createTexture({
    size: [canvas.width, canvas.height], format: "rgba32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const renderDst = device.createTexture({
    size: [canvas.width, canvas.height], format: "rgba32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  const timingHelper = new TimingHelper(device);
  let camera = objects.bunny;
  let faceCount = 0;
  let bindGroup = null;
  let frameNumber = 0;

  async function loadObject(name) {
    camera = objects[name];
    const obj = await readOBJFile(camera.file, 1.0, false);
    faceCount = obj.indices.length / 4;

    tree_objects = [];
    root = null;
    const buffers = {};
    build_bsp_tree(obj, device, buffers);

    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: buffers.attribs } },
        { binding: 2, resource: { buffer: buffers.indices } },
        { binding: 3, resource: { buffer: buffers.aabb } },
        { binding: 4, resource: { buffer: buffers.treeIds } },
        { binding: 5, resource: { buffer: buffers.bspTree } },
        { binding: 6, resource: { buffer: buffers.bspPlanes } },
        { binding: 7, resource: envTexture.createView() },
        { binding: 8, resource: envSampler },
        { binding: 9, resource: renderDst.createView() },
      ],
    });
    frameNumber = 0;
  }

  function draw() {
    if (!bindGroup) { return; }

    const forward = normalize(subtract(camera.center, camera.eye));
    const right   = normalize(cross(forward, [0.0, 1.0, 0.0]));
    const up      = cross(right, forward);
    uniforms.set([
      ...camera.eye, 0.0,
      ...right,      0.0,
      ...up,         0.0,
      ...forward,    0.0,
      canvas.width / canvas.height, camera.camConst, frameNumber, progressiveToggle.checked ? 1.0 : 0.0,
      shadingModes[shadingSelect.value], canvas.width, canvas.height, 0.0,
      ...baseColor,  0.0,
    ]);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);

    const encoder = device.createCommandEncoder();
    const pass = timingHelper.beginRenderPass(encoder, {
      colorAttachments: [
        { view: context.getCurrentTexture().createView(), loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store" },
        { view: renderSrc.createView(), loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store" },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4);
    pass.end();
    encoder.copyTextureToTexture({ texture: renderSrc }, { texture: renderDst }, [canvas.width, canvas.height]);
    device.queue.submit([encoder.finish()]);

    if (progressiveToggle.checked) { frameNumber += 1; }
    frameCountLabel.textContent = `Samples: ${frameNumber}${progressiveToggle.checked ? "" : " (paused)"}`;
    timingHelper.getResult().then(time => {
      gpuTimeLabel.textContent = canTimestamp ? `GPU frame: ${(time / 1000).toFixed(1)} us` : "GPU frame: timestamp-query unavailable";
    });

    if (progressiveToggle.checked) { requestAnimationFrame(draw); }
  }

  function reset() { frameNumber = 0; draw(); }
  async function switchObject() { await loadObject(sceneSelect.value); draw(); }

  sceneSelect.addEventListener("change", switchObject);
  shadingSelect.addEventListener("change", reset);
  progressiveToggle.addEventListener("change", () => { if (progressiveToggle.checked) { draw(); } });
  renderButton.addEventListener("click", reset);

  await loadObject("bunny");
  draw();
}

async function loadImageTexture(device, url) {
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
  const texture = device.createTexture({
    size: [img.naturalWidth, img.naturalHeight], format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: img }, { texture }, [img.naturalWidth, img.naturalHeight]);
  return texture;
}
