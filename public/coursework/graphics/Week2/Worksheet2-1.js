"use strict";

window.onload = () => { main(); };

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas  = document.getElementById('my-canvas');
  const context = canvas.getContext('webgpu');
  const format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const pointSize = (20 * 2) / canvas.height;

  function addPoint(arr, p, size) {
    const o = size / 2;
    const a = vec2(p[0]-o, p[1]-o), b = vec2(p[0]+o, p[1]-o);
    const c = vec2(p[0]-o, p[1]+o), d = vec2(p[0]+o, p[1]+o);
    arr.push(a, b, c, c, b, d);
  }

  const positions = [];
  addPoint(positions, vec2(0.00, 0.00), pointSize);
  addPoint(positions, vec2(0.96, 0.00), pointSize);
  const edge = 1 - pointSize / 2;
  addPoint(positions, vec2(edge, edge), pointSize);

  let positionBuffer = null;
  function ensureBuffer(byteLength) {
    if (positionBuffer && byteLength <= positionBuffer.size) return;
    if (positionBuffer) positionBuffer.destroy();
    positionBuffer = device.createBuffer({
      size: Math.max(4, byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    });
  }
  function uploadPositions() {
    const data = flatten(positions);
    ensureBuffer(data.byteLength);
    device.queue.writeBuffer(positionBuffer, 0, data);
  }
  uploadPositions();

  const positionLayout = {
    arrayStride: sizeof['vec2'],
    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }]
  };
  const wgsl = device.createShaderModule({ code: document.getElementById('wgsl').text });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: wgsl, entryPoint: 'main_vs', buffers: [positionLayout] },
    fragment: { module: wgsl, entryPoint: 'main_fs', targets: [{ format }] },
    primitive:{ topology: 'triangle-list' }
  });

  function render() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }
      }]
    });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, positionBuffer);
    pass.draw(positions.length);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  render();

  function clientToClip(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top)  / rect.height;
    return [nx * 2 - 1, 1 - ny * 2];
  }

  canvas.addEventListener('click', (e) => {
    const [x, y] = clientToClip(e.clientX, e.clientY);
    addPoint(positions, vec2(x, y), pointSize);
    uploadPositions();
    render();
  });
}
