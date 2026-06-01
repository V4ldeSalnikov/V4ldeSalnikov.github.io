"use strict";
window.onload = () => { main(); };

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();
  const canvas  = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  function buildCircleVertices(segments) {
    const v = [];
    for (let i = 0; i < segments; i++) {
      const a0 = 2 * Math.PI * (i / segments);
      const a1 = 2 * Math.PI * ((i + 1) / segments);
      v.push(
        vec2(0, 0),
        vec2(Math.cos(a0), Math.sin(a0)),
        vec2(Math.cos(a1), Math.sin(a1)),
      );
    }
    return v;
  }

  const circleVerts = buildCircleVertices(96);
  const circleData  = flatten(circleVerts);
  const vertexCount = circleVerts.length;

  const vertexBuffer = device.createBuffer({
    size: circleData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, circleData);

  const vertexLayout = {
    arrayStride: sizeof["vec2"],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
  };

  const wgsl = device.createShaderModule({ code: document.getElementById("wgsl").text });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex:   { module: wgsl, entryPoint: "main_vs", buffers: [vertexLayout] },
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

  const RADIUS      = 0.30;
  const RESTITUTION = 0.85;
  const GRAVITY     = -3.0;
  const X           = 0.0;

  let cy = -1 + RADIUS;
  let vy = 1.8;
  let prevT = 0;

  function frame(ts_ms) {
    const t  = ts_ms * 0.001;
    const dt = prevT ? (t - prevT) : 0;
    prevT = t;

    vy += GRAVITY * dt;
    cy += vy * dt;

    const floorY = -1 + RADIUS;
    if (cy < floorY) {
      cy = floorY;
      if (vy < 0) vy = -vy * RESTITUTION;
    }
    const ceilY = 1 - RADIUS;
    if (cy > ceilY) {
      cy = ceilY;
      if (vy > 0) vy = -vy * RESTITUTION;
    }

    device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([X, cy, RADIUS, 0.0]));

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
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(vertexCount);
    pass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
