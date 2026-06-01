"use strict";

window.onload = function () { main(); };

async function main() {
  const canvas = document.getElementById("my-canvas");

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  const obj = await readOBJFile("triangle.obj", 1.0, false);
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

  const camera = { eye: [2.0, 1.5, 2.0], center: [0.0, 0.5, 0.0], up: [0.0, 1.0, 0.0], camConst: 1.0 };
  const plane  = material({ base: [0.1, 0.7, 0.0], point: [0.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0] });
  const sphere = material({ base: [0.0, 0.0, 0.0], center: [0.0, 0.5, 0.0], radius: 0.3 });
  const mesh   = material({ base: [0.4, 0.3, 0.2] });
  const light  = { position: [0.0, 1.0, 0.0], intensity: [Math.PI, Math.PI, Math.PI] };
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

    ...plane.point,    0.0,
    ...plane.normal,   0.0,
    ...plane.ambient,  0.0,
    ...plane.diffuse,  0.0,

    ...sphere.center,  sphere.radius,
    ...sphere.ambient, 0.0,
    ...sphere.diffuse, 0.0,

    ...mesh.ambient,   0.0,
    ...mesh.diffuse,   0.0,

    ...background,      1.0,
    ...light.position,  0.0,
    ...light.intensity, 0.0,
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

function material(o) {
  o.ambient = o.base.map(c => 0.1 * c);
  o.diffuse = o.base.map(c => 0.9 * c);
  return o;
}
