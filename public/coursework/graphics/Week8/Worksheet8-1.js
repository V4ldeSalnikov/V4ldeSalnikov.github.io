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
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
  });

  const { vertexBuffer, indexBuffer } = buildScene(device);

  const marble = await loadTexture(device, "xamp23.png");
  const red    = solidColorTexture(device, [255, 0, 0, 255]);

  const sampler = device.createSampler({
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
    minFilter: "linear",
    magFilter: "linear"
  });

  const Mst = mat4(
    vec4(1, 0, 0,   0),
    vec4(0, 1, 0,   0),
    vec4(0, 0, 0.5, 0.5),
    vec4(0, 0, 0,   1)
  );
  const projection = mult(Mst, perspective(45.0, canvas.width / canvas.height, 0.1, 100.0));
  const view = lookAt(vec3(0, 1, 2), vec3(0, -1, -3), vec3(0, 1, 0));
  const mvp  = mult(projection, view);

  const uniformBuffer = device.createBuffer({
    size: sizeof['mat4'],
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(uniformBuffer, 0, flatten(mvp));

  const groundBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: marble.createView() }
    ]
  });
  const redBindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: sampler },
      { binding: 2, resource: red.createView() }
    ]
  });

  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp: "clear", storeOp: "store",
      clearValue: { r: 0.04, g: 0.11, b: 0.24, a: 1.0 }
    }],
    depthStencilAttachment: {
      view: depthTexture.createView(),
      depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1.0
    }
  });
  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.setIndexBuffer(indexBuffer, "uint16");
  pass.setBindGroup(0, groundBindGroup);
  pass.drawIndexed(6);
  pass.setBindGroup(0, redBindGroup);
  pass.drawIndexed(12, 1, 6);
  pass.end();
  device.queue.submit([encoder.finish()]);
}

function buildScene(device) {
  const vertexData = new Float32Array([
    -2.0, -1.0, -1.0,   0.0, 0.0,
     2.0, -1.0, -1.0,   1.0, 0.0,
     2.0, -1.0, -5.0,   1.0, 1.0,
    -2.0, -1.0, -5.0,   0.0, 1.0,

     0.25, -0.5, -1.25,  0.0, 0.0,
     0.75, -0.5, -1.25,  1.0, 0.0,
     0.75, -0.5, -1.75,  1.0, 1.0,
     0.25, -0.5, -1.75,  0.0, 1.0,

    -1.0, -1.0, -2.5,   0.0, 1.0,
    -1.0,  0.0, -2.5,   0.0, 0.0,
    -1.0,  0.0, -3.0,   1.0, 0.0,
    -1.0, -1.0, -3.0,   1.0, 1.0,
  ]);
  const vertexBuffer = device.createBuffer({
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexData);

  const indexData = new Uint16Array([
    0, 1, 2,  0, 2, 3,
    4, 5, 6,  4, 6, 7,
    8, 9, 10, 8, 10, 11,
  ]);
  const indexBuffer = device.createBuffer({
    size: indexData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(indexBuffer, 0, indexData);

  return { vertexBuffer, indexBuffer };
}

async function loadTexture(device, url) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  const texture = device.createTexture({
    size: [img.width, img.height, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });
  device.queue.copyExternalImageToTexture(
    { source: img }, { texture }, { width: img.width, height: img.height }
  );
  return texture;
}

function solidColorTexture(device, rgba) {
  const texture = device.createTexture({
    size: [1, 1],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });
  device.queue.writeTexture({ texture }, new Uint8Array(rgba), { bytesPerRow: 4 }, [1, 1]);
  return texture;
}
