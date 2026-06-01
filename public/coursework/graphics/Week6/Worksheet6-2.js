"use strict";

window.onload = () => { main(); };

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas  = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const module = device.createShaderModule({ code: document.getElementById("wgsl").text });

  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module, entryPoint: "main_vs",
      buffers: [{
        arrayStride: 5 * 4,
        attributes: [
          { shaderLocation: 0, offset: 0,     format: "float32x3" },
          { shaderLocation: 1, offset: 3 * 4, format: "float32x2" },
        ]
      }]
    },
    fragment: { module, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "none" }
  });

  const vertexData = new Float32Array([
    -4.0, -1.0,  -1.0,   -1.5,  0.0,
     4.0, -1.0,  -1.0,    2.5,  0.0,
     4.0, -1.0, -21.0,    2.5, 10.0,
    -4.0, -1.0, -21.0,   -1.5, 10.0,
  ]);
  const vertexBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexData);

  const indexData = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const indexBuffer = device.createBuffer({
    size: indexData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(indexBuffer, 0, indexData);

  const texSize = 256;
  const numSquares = 16;
  const squarePx = texSize / numSquares;
  const texels = new Uint8Array(texSize * texSize * 4);
  for (let y = 0; y < texSize; ++y) {
    for (let x = 0; x < texSize; ++x) {
      const c = (Math.floor(x / squarePx) % 2 !== Math.floor(y / squarePx) % 2) ? 245 : 30;
      const idx = 4 * (y * texSize + x);
      texels[idx] = texels[idx + 1] = texels[idx + 2] = c;
      texels[idx + 3] = 255;
    }
  }

  const mipLevelCount = numMipLevels(texSize, texSize);
  const maxLod = mipLevelCount - 1;
  const texture = device.createTexture({
    size: [texSize, texSize, 1],
    format: "rgba8unorm",
    mipLevelCount,
    usage: GPUTextureUsage.TEXTURE_BINDING |
           GPUTextureUsage.COPY_DST |
           GPUTextureUsage.RENDER_ATTACHMENT
  });
  device.queue.writeTexture(
    { texture }, texels,
    { offset: 0, bytesPerRow: texSize * 4, rowsPerImage: texSize },
    [texSize, texSize, 1]
  );
  generateMipmap(device, texture);

  const Mst = mat4(
    vec4(1, 0, 0,   0),
    vec4(0, 1, 0,   0),
    vec4(0, 0, 0.5, 0.5),
    vec4(0, 0, 0,   1)
  );
  const mvp = mult(Mst, perspective(90.0, canvas.width / canvas.height, 0.1, 100.0));
  const uniformBuffer = device.createBuffer({
    size: sizeof['mat4'],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

  const ui = {
    wrap: document.getElementById("wrap-mode"),
    min:  document.getElementById("min-filter"),
    mag:  document.getElementById("mag-filter"),
    mip:  document.getElementById("mipmap-filter"),
    mipToggle: document.getElementById("mipmap-toggle"),
  };

  let bindGroup;
  function rebuildBindGroup() {
    const mipEnabled = ui.mipToggle.checked;
    ui.mip.disabled = !mipEnabled;
    const sampler = device.createSampler({
      addressModeU: ui.wrap.value,
      addressModeV: ui.wrap.value,
      minFilter: ui.min.value,
      magFilter: ui.mag.value,
      mipmapFilter: ui.mip.value,
      lodMaxClamp: mipEnabled ? maxLod : 0.0
    });
    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: texture.createView() }
      ]
    });
  }

  function draw() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear", storeOp: "store",
        clearValue: { r: 0.05, g: 0.12, b: 0.32, a: 1.0 }
      }]
    });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setIndexBuffer(indexBuffer, "uint16");
    pass.setBindGroup(0, bindGroup);
    pass.drawIndexed(indexData.length);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  for (const el of [ui.wrap, ui.min, ui.mag, ui.mip, ui.mipToggle]) {
    el.addEventListener("change", () => { rebuildBindGroup(); requestAnimationFrame(draw); });
  }

  rebuildBindGroup();
  draw();
}
