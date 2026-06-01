"use strict";

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
  const renderButton = document.getElementById("render-button");

  const drawingInfo = await readOBJFile("../Week5/CornellBoxWithBlocks.obj", 1.0, false);
  const faceCount = drawingInfo.indices.length / 4;
  const lightCount = drawingInfo.light_indices.length;

  tree_objects = [];
  root = null;
  const buffers = {};
  build_bsp_tree(drawingInfo, device, buffers);

  const materialData = new Float32Array(drawingInfo.materials.length * 8);
  drawingInfo.materials.forEach((mat, i) => {
    const e = mat.emission, c = mat.color;
    materialData.set([e.r, e.g, e.b, 0.0, c.r, c.g, c.b, 0.0], i * 8);
  });
  const materialBuffer = device.createBuffer({
    size: materialData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(materialBuffer, 0, materialData);

  const lightIndices = new Uint32Array(drawingInfo.light_indices);
  const lightIndexBuffer = device.createBuffer({
    size: lightIndices.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(lightIndexBuffer, 0, lightIndices);

  const xe = [0.0, 0.0, 0.0];
  let n = 0;
  for (const f of drawingInfo.light_indices) {
    for (let k = 0; k < 3; k++) {
      const v = drawingInfo.indices[f * 4 + k];
      xe[0] += drawingInfo.attribs[v * 8 + 0];
      xe[1] += drawingInfo.attribs[v * 8 + 1];
      xe[2] += drawingInfo.attribs[v * 8 + 2];
      n++;
    }
  }
  xe[0] /= n; xe[1] /= n; xe[2] /= n;

  const camera = { eye: [277.0, 275.0, -570.0], center: [277.0, 275.0, 0.0], up: [0.0, 1.0, 0.0], camConst: 1.0 };
  const background = [0.0, 0.0, 0.0];

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
    ...xe,         0.0,
    ...background, 1.0,
  ]);
  const uniformBuffer = device.createBuffer({
    size: uniforms.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniforms);

  const wgsl = device.createShaderModule({ code: document.getElementById("raytracing-wgsl").text });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex:   { module: wgsl, entryPoint: "vs_main" },
    fragment: { module: wgsl, entryPoint: "fs_main", targets: [{ format: canvasFormat }] },
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
    ],
  });

  const timingHelper = new TimingHelper(device);

  function draw() {
    const encoder = device.createCommandEncoder();
    const pass = timingHelper.beginRenderPass(encoder, {
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
    timingHelper.getResult().then(time => {
      gpuTimeLabel.textContent = canTimestamp ? `GPU frame: ${(time / 1000).toFixed(1)} us` : "GPU frame: timestamp-query unavailable";
    });
  }

  renderButton.addEventListener("click", draw);
  draw();
}
