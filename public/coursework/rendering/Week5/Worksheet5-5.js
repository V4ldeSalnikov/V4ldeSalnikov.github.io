"use strict";

window.onload = function () { main(); };

async function main() {
  const canvas = document.getElementById("my-canvas");

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  const obj = await readOBJFile("CornellBoxWithBlocks.obj", 1.0, false);
  const faceCount = obj.mat_indices.length;
  const lightCount = obj.light_indices.length;

  const positionBuffer = device.createBuffer({
    size: obj.vertices.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, obj.vertices);

  const indexBuffer = device.createBuffer({
    size: obj.indices.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, obj.indices);

  const matIndexBuffer = device.createBuffer({
    size: obj.mat_indices.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(matIndexBuffer, 0, obj.mat_indices);

  const lightIndexBuffer = device.createBuffer({
    size: obj.light_indices.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(lightIndexBuffer, 0, obj.light_indices);

  const materialData = new Float32Array(obj.materials.length * 8);
  obj.materials.forEach((mat, i) => {
    const e = mat.emission, c = mat.color;
    materialData.set([e.r, e.g, e.b, 0.0, c.r, c.g, c.b, 0.0], i * 8);
  });
  const materialBuffer = device.createBuffer({
    size: materialData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(materialBuffer, 0, materialData);

  const xe = [0.0, 0.0, 0.0];
  let n = 0;
  for (const f of obj.light_indices) {
    for (let k = 0; k < 3; k++) {
      const v = obj.indices[f * 4 + k];
      xe[0] += obj.vertices[v * 4 + 0];
      xe[1] += obj.vertices[v * 4 + 1];
      xe[2] += obj.vertices[v * 4 + 2];
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
      { binding: 1, resource: { buffer: positionBuffer } },
      { binding: 2, resource: { buffer: indexBuffer } },
      { binding: 3, resource: { buffer: matIndexBuffer } },
      { binding: 4, resource: { buffer: materialBuffer } },
      { binding: 5, resource: { buffer: lightIndexBuffer } },
    ],
  });

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
