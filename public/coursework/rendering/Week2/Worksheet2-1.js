"use strict";

const SHADER_LAMBERTIAN = 1;

window.onload = function () { main(); };

async function main() {
  const camera = { eye: [2.0, 1.5, 2.0], center: [0.0, 0.5, 0.0], up: [0.0, 1.0, 0.0], camConst: 1.0 };
  const plane = material({
    base: [0.1, 0.7, 0.0], specular: [0.0, 0.0, 0.0], shininess: 0, shader: SHADER_LAMBERTIAN,
    point: [0.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0],
  });
  const triangle = material({
    base: [0.4, 0.3, 0.2], specular: [0.0, 0.0, 0.0], shininess: 0, shader: SHADER_LAMBERTIAN,
    v0: [-0.2, 0.1, 0.9], v1: [0.2, 0.1, 0.9], v2: [-0.2, 0.1, -0.1],
  });
  const sphere = material({
    base: [0.0, 0.0, 0.0], specular: [0.1, 0.1, 0.1], shininess: 42, shader: SHADER_LAMBERTIAN,
    center: [0.0, 0.5, 0.0], radius: 0.3,
  });
  const light = { position: [0.0, 1.0, 0.0], intensity: [Math.PI, Math.PI, Math.PI] };
  const background = [0.1, 0.3, 0.6];

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
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
    ...plane.normal,   plane.shader,
    ...plane.ambient,  0.0,
    ...plane.diffuse,  0.0,
    ...plane.specular, plane.shininess,

    ...sphere.center,   sphere.radius,
    ...sphere.ambient,  sphere.shader,
    ...sphere.diffuse,  0.0,
    ...sphere.specular, sphere.shininess,

    ...triangle.v0,       0.0,
    ...triangle.v1,       0.0,
    ...triangle.v2,       triangle.shader,
    ...triangle.ambient,  0.0,
    ...triangle.diffuse,  0.0,
    ...triangle.specular, triangle.shininess,

    ...background,      1.0,
    ...light.position,  0.0,
    ...light.intensity, 0.0,
  ]);
  const uniformBuffer = device.createBuffer({
    size: uniforms.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniforms);

  const wgsl = device.createShaderModule({
    code: document.getElementById("raytracing-wgsl").text,
  });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex:   { module: wgsl, entryPoint: "vs_main" },
    fragment: { module: wgsl, entryPoint: "fs_main", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-strip" },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear",
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      storeOp: "store",
    }],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(4);
  pass.end();
  device.queue.submit([encoder.finish()]);
}

function material(obj) {
  obj.ambient = obj.base.map(c => 0.1 * c);
  obj.diffuse = obj.base.map(c => 0.9 * c);
  return obj;
}
