"use strict";

window.onload = function () { main(); };

async function main() {
  const canvas = document.getElementById("my-canvas");

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  const obj = await readOBJFile("teapot.obj", 1.0, false);
  const faceCount = obj.mat_indices.length;

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

  const normalBuffer = device.createBuffer({
    size: obj.normals.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(normalBuffer, 0, obj.normals);

  const camera = { eye: [0.15, 1.5, 10.0], center: [0.15, 1.5, 0.0], up: [0.0, 1.0, 0.0], camConst: 2.5 };
  const plane = { point: [0.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], color: [0.1, 0.7, 0.0] };
  const teapot = { color: [0.9, 0.9, 0.9] };
  const light = { direction: normalize([-1.0, -1.0, -1.0]), radiance: [Math.PI, Math.PI, Math.PI] };
  const background = [0.1, 0.3, 0.6];

  const aspect  = canvas.width / canvas.height;
  const forward = normalize(subtract(camera.center, camera.eye));
  const right   = normalize(cross(forward, camera.up));
  const up      = cross(right, forward);

  const uniforms = new Float32Array([
    ...camera.eye, 0.0,
    ...right,      0.0,
    ...up,         0.0,
    ...forward,    0.0,
    aspect, camera.camConst, faceCount, 0.0,

    ...plane.point,  0.0,
    ...plane.normal, 0.0,
    ...plane.color,  0.0,

    ...teapot.color, 0.0,

    ...background,       1.0,
    ...light.direction,  0.0,
    ...light.radiance,   0.0,
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
      { binding: 3, resource: { buffer: normalBuffer } },
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
