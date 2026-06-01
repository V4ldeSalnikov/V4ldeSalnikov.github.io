"use strict";
window.onload = function() { main(); }

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();
  const canvas  = document.getElementById('my-canvas');
  const context = canvas.getContext('webgpu');
  const format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const pointSize = 20 * (2 / canvas.height);

  function add_point(array, point, size) {
    const off = size / 2;
    const p = [
      vec2(point[0] - off, point[1] - off), vec2(point[0] + off, point[1] - off),
      vec2(point[0] - off, point[1] + off), vec2(point[0] - off, point[1] + off),
      vec2(point[0] + off, point[1] - off), vec2(point[0] + off, point[1] + off),
    ];
    array.push.apply(array, p);
  }

  const edge = 1 - pointSize / 2;
  const positions = [];
  add_point(positions, vec2(0.00, 0.00), pointSize);
  add_point(positions, vec2(edge, 0.00), pointSize);
  add_point(positions, vec2(edge, edge), pointSize);

  const positionBuffer = device.createBuffer({
    size: flatten(positions).byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

  const positionBufferLayout = {
    arrayStride: sizeof['vec2'],
    attributes: [{ format: 'float32x2', offset: 0, shaderLocation: 0 }]
  };

  const wgsl = device.createShaderModule({ code: document.getElementById('wgsl').text });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: wgsl, entryPoint: 'main_vs', buffers: [positionBufferLayout] },
    fragment: { module: wgsl, entryPoint: 'main_fs', targets: [{ format }] },
    primitive:{ topology: 'triangle-list' }
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }
    }],
  });

  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, positionBuffer);
  pass.draw(positions.length);
  pass.end();

  device.queue.submit([encoder.finish()]);
}
