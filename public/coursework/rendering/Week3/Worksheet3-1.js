"use strict";

window.onload = function () { main(); };

async function main() {
  const canvas        = document.getElementById("texture-canvas");
  const addressSelect = document.getElementById("addressing-mode");
  const filterSelect  = document.getElementById("filter-mode");
  const scaleSlider   = document.getElementById("texture-scale");
  const scaleLabel    = document.getElementById("scale-value");

  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  const wgsl = device.createShaderModule({
    code: document.getElementById("texture-wgsl").text,
  });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module: wgsl,
      entryPoint: "vs_main",
      buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] }],
    },
    fragment: { module: wgsl, entryPoint: "fs_main", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-strip" },
  });

  const vertices = new Float32Array([
    -1.0, -1.0,
     1.0, -1.0,
    -1.0,  1.0,
     1.0,  1.0,
  ]);
  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertices);

  const uniforms = new Float32Array([1.0, 1.0, 0.0, 0.0]);
  const uniformBuffer = device.createBuffer({
    size: uniforms.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const texture = await load_texture(device, "grass.jpg");
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: texture.createView() },
    ],
  });

  function render() {
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
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  function update() {
    const scale = parseFloat(scaleSlider.value);
    uniforms[0] = scale;
    uniforms[1] = scale;
    uniforms[2] = Number(addressSelect.value);
    uniforms[3] = Number(filterSelect.value);
    scaleLabel.textContent = `${scale.toFixed(1)}×`;
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
    render();
  }
  addressSelect.addEventListener("change", update);
  filterSelect.addEventListener("change", update);
  scaleSlider.addEventListener("input", update);

  update();
}

async function load_texture(device, filename) {
  const response = await fetch(filename);
  const blob = await response.blob();
  const img = await createImageBitmap(blob, { colorSpaceConversion: "none" });
  const texture = device.createTexture({
    size: [img.width, img.height, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture(
    { source: img, flipY: true },
    { texture },
    { width: img.width, height: img.height },
  );
  return texture;
}
