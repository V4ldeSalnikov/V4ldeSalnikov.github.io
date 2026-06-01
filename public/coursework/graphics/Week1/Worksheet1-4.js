"use strict";
window.onload = () => { main(); };

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();
  const canvas  = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const positions = [
    vec2(-0.5, -0.5), vec2( 0.5, -0.5), vec2( 0.5,  0.5),
    vec2(-0.5, -0.5), vec2( 0.5,  0.5), vec2(-0.5,  0.5),
  ];

  const positionData = flatten(positions);
  const positionBuffer = device.createBuffer({
    size: positionData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, positionData);

  const positionBufferLayout = {
    arrayStride: sizeof["vec2"],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  const wgsl = device.createShaderModule({ code: document.getElementById("wgsl").text });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex:   { module: wgsl, entryPoint: "main_vs", buffers: [positionBufferLayout] },
    fragment: { module: wgsl, entryPoint: "main_fs", targets: [{ format }] },
    primitive:{ topology: "triangle-list" },
  });

  const uniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const ROT_SPEED = Math.PI / 3;
  let angle = 0.0;
  let prevT = 0;

  function frame(ts_ms) {
    const t = ts_ms * 0.001;
    const dt = prevT ? (t - prevT) : 0;
    prevT = t;

    angle = (angle + ROT_SPEED * dt) % (Math.PI * 2);
    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([angle]));

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 },
      }],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, positionBuffer);
    pass.draw(6);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
