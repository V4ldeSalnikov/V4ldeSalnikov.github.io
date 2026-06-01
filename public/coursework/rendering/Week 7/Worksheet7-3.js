"use strict";

const FRAME_AT = 26;
const PROGRESSIVE_AT = 27;
const BACKGROUND_AT = 28;

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
  const progressiveToggle = document.getElementById("progressive-toggle");
  const blueBackgroundToggle = document.getElementById("blue-background-toggle");
  const renderButton = document.getElementById("render-button");

  const obj = await readOBJFile("../Week5/CornellBoxWithBlocks.obj", 1.0, false);
  const faceCount = obj.indices.length / 4;
  const lightCount = obj.light_indices.length;

  tree_objects = [];
  root = null;
  const buffers = {};
  build_bsp_tree(obj, device, buffers);

  const materialData = new Float32Array(obj.materials.length * 8);
  obj.materials.forEach((mat, i) => {
    const e = mat.emission, c = mat.color;
    materialData.set([e.r, e.g, e.b, 0.0, c.r, c.g, c.b, 0.0], i * 8);
  });
  const materialBuffer = device.createBuffer({ size: materialData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(materialBuffer, 0, materialData);

  const lightIndices = new Uint32Array(obj.light_indices);
  const lightIndexBuffer = device.createBuffer({ size: lightIndices.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(lightIndexBuffer, 0, lightIndices);

  const camera = { eye: [277.0, 275.0, -570.0], center: [277.0, 275.0, 0.0], up: [0.0, 1.0, 0.0], camConst: 1.0 };
  const aspect  = canvas.width / canvas.height;
  const forward = normalize(subtract(camera.center, camera.eye));
  const right   = normalize(cross(forward, camera.up));
  const up      = cross(right, forward);

  const uniforms = new Float32Array([
    ...camera.eye, 0.0,
    ...right,      0.0,
    ...up,         0.0,
    ...forward,    0.0,
    aspect, camera.camConst, faceCount, lightCount,
    0.0, 0.0, 0.0, 0.0,
    canvas.width, canvas.height, 0.0, 1.0,
    0.0, 0.0, 0.0, 1.0,
  ]);
  const uniformBuffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const renderSrc = device.createTexture({
    size: [canvas.width, canvas.height], format: "rgba32float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const renderDst = device.createTexture({
    size: [canvas.width, canvas.height], format: "rgba32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });

  const wgsl = device.createShaderModule({ code: document.getElementById("raytracing-wgsl").text });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex:   { module: wgsl, entryPoint: "vs_main" },
    fragment: { module: wgsl, entryPoint: "fs_main", targets: [{ format: canvasFormat }, { format: "rgba32float" }] },
    primitive: { topology: "triangle-strip" },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: buffers.attribs } },
      { binding: 2, resource: { buffer: buffers.indices } },
      { binding: 3, resource: { buffer: materialBuffer } },
      { binding: 4, resource: { buffer: lightIndexBuffer } },
      { binding: 5, resource: { buffer: buffers.aabb } },
      { binding: 6, resource: { buffer: buffers.treeIds } },
      { binding: 7, resource: { buffer: buffers.bspTree } },
      { binding: 8, resource: { buffer: buffers.bspPlanes } },
      { binding: 9, resource: renderDst.createView() },
    ],
  });

  const timingHelper = new TimingHelper(device);
  let frameNumber = 0;

  function draw() {
    uniforms[FRAME_AT] = frameNumber;
    uniforms[PROGRESSIVE_AT] = progressiveToggle.checked ? 1.0 : 0.0;
    const bg = blueBackgroundToggle.checked ? [0.1, 0.3, 0.6] : [0.0, 0.0, 0.0];
    uniforms[BACKGROUND_AT] = bg[0]; uniforms[BACKGROUND_AT + 1] = bg[1]; uniforms[BACKGROUND_AT + 2] = bg[2];
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

  progressiveToggle.addEventListener("change", () => { if (progressiveToggle.checked) { draw(); } });
  blueBackgroundToggle.addEventListener("change", reset);
  renderButton.addEventListener("click", reset);

  draw();
}
