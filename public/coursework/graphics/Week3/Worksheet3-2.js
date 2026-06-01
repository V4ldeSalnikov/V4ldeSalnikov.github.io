"use strict";
window.onload = () => { main(); };

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();
  const canvas  = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const positions = new Float32Array([
    0,0,1,  0,1,1,  1,1,1,  1,0,1,
    0,0,0,  0,1,0,  1,1,0,  1,0,0,
  ]);
  const wire = new Uint16Array([
    0,1, 1,2, 2,3, 3,0,
    2,3, 3,7, 7,6, 6,2,
    0,3, 3,7, 7,4, 4,0,
    1,2, 2,6, 6,5, 5,1,
    4,5, 5,6, 6,7, 7,4,
    0,1, 1,5, 5,4, 4,0,
  ]);

  const vbuf = device.createBuffer({
    size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(vbuf, 0, positions);

  const ibuf = device.createBuffer({
    size: wire.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(ibuf, 0, wire);

  const vertexLayout = {
    arrayStride: sizeof['vec3'],
    attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }]
  };

  const module = device.createShaderModule({ code: document.getElementById("wgsl").text });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex:   { module, entryPoint: "main_vs", buffers: [vertexLayout] },
    fragment: { module, entryPoint: "main_fs", targets: [{ format }] },
    primitive:{ topology: "line-list" }
  });

  const fovy   = 45.0;
  const aspect = canvas.width / canvas.height;
  const P = perspective(fovy, aspect, 0.1, 100.0);

  const eye = vec3(0.0, 0.0, 4.5);
  const at  = vec3(0.0, 0.0, 0.0);
  const up  = vec3(0.0, 1.0, 0.0);
  const V   = lookAt(eye, at, up);

  const Mst = mat4(
    vec4(1, 0, 0,   0),
    vec4(0, 1, 0,   0),
    vec4(0, 0, 0.5, 0.5),
    vec4(0, 0, 0,   1)
  );

  const center = translate(-0.5, -0.5, -0.5);
  const S      = scalem(0.9, 0.9, 0.9);
  const place  = mult(S, center);

  const M1 = mult(translate(-1.5, 0.0, 0.0), place);
  const M2 = mult(rotateY(30.0), place);
  const M3 = mult(translate(1.5, 0.0, 0.0), mult(rotateX(-20.0), mult(rotateY(-30.0), place)));

  const cubes = [M1, M2, M3].map((M) => {
    const ubo = device.createBuffer({
      size: sizeof['mat4'],
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(ubo, 0, flatten(mult(Mst, mult(P, mult(V, M)))));
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: ubo } }]
    });
    return bindGroup;
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      loadOp:  "clear",
      storeOp: "store",
      clearValue: { r: 0.96, g: 0.98, b: 1.0, a: 1.0 }
    }]
  });
  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, vbuf);
  pass.setIndexBuffer(ibuf, "uint16");

  for (const bindGroup of cubes) {
    pass.setBindGroup(0, bindGroup);
    pass.drawIndexed(wire.length);
  }

  pass.end();
  device.queue.submit([encoder.finish()]);
}
