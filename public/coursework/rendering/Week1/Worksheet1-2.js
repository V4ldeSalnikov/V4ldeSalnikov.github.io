"use strict";

window.onload = function () { main(); };

async function main() {
  const eye      = [2.0, 1.5, 2.0];
  const center   = [0.0, 0.5, 0.0];
  const up       = [0.0, 1.0, 0.0];
  const camConst = 1.0;

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  const aspect = canvas.width / canvas.height;

  const forward = normalize(subtract(center, eye));
  const right   = normalize(cross(forward, up));
  const upBasis = cross(right, forward);

  const uniforms = new Float32Array([
    eye[0],     eye[1],     eye[2],     0.0,
    right[0],   right[1],   right[2],   0.0,
    upBasis[0], upBasis[1], upBasis[2], 0.0,
    forward[0], forward[1], forward[2], 0.0,
    aspect,     camConst,   0.0,        0.0,
  ]);
  const uniformBuffer = device.createBuffer({
    size: uniforms.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uniformBuffer, 0, uniforms);

  const wgsl = device.createShaderModule({
    code: document.getElementById("ray-wgsl-2").text,
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
