"use strict";
window.onload = function() { main(); }

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();
  const canvas  = document.getElementById('my-canvas');
  const context = canvas.getContext('webgpu');
  const format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 }
    }],
  });
  pass.end();

  device.queue.submit([encoder.finish()]);
}
