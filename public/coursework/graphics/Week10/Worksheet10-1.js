"use strict";

window.onload = () => { main(); };

const OMEGA = 0.4;
const Z_EYE = 6.0;

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
        arrayStride: 9 * 4,
        attributes: [
          { shaderLocation: 0, offset: 0,     format: "float32x3" },
          { shaderLocation: 1, offset: 3 * 4, format: "float32x3" },
          { shaderLocation: 2, offset: 6 * 4, format: "float32x3" },
        ]
      }]
    },
    fragment: { module, entryPoint: "main_fs", targets: [{ format }] },
    primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" }
  });

  const mesh = await loadTeapot(device, "teapot.obj");
  const uniformBuffer = device.createBuffer({ size: 40 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });
  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT
  });

  const Mst = mat4(vec4(1,0,0,0), vec4(0,1,0,0), vec4(0,0,0.5,0.5), vec4(0,0,0,1));
  const projection = mult(Mst, perspective(45.0, canvas.width / canvas.height, 0.1, 100.0));
  const model = mult(scalem(0.5, 0.5, 0.5), translate(-0.22, -1.58, 0.0));
  const at = vec3(0, 0, 0), up = vec3(0, 1, 0);
  const lightDir = [0.5, 0.8, 1.0, 0.0];

  let thetaX = 15.0, thetaY = -25.0;
  let dragging = false, x0 = 0, y0 = 0;

  canvas.addEventListener("mousedown", (e) => { dragging = true; x0 = e.clientX; y0 = e.clientY; });
  window.addEventListener("mouseup", () => { dragging = false; });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    thetaX += OMEGA * (e.clientY - y0);
    thetaY += OMEGA * (e.clientX - x0);
    x0 = e.clientX;
    y0 = e.clientY;
  });

  function frame() {
    const eyeRot = mult(rotateX(thetaX), mult(rotateY(thetaY), vec4(0, 0, Z_EYE, 1)));
    const eye = vec3(eyeRot[0], eyeRot[1], eyeRot[2]);
    const view = lookAt(eye, at, up);

    const data = new Float32Array(40);
    data.set(flatten(mult(projection, mult(view, model))), 0);
    data.set(flatten(model), 16);
    data.set(lightDir, 32);
    data.set([eye[0], eye[1], eye[2], 1.0], 36);
    device.queue.writeBuffer(uniformBuffer, 0, data);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear", storeOp: "store",
        clearValue: { r: 0.39, g: 0.56, b: 0.88, a: 1.0 }
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: "clear", depthStoreOp: "store", depthClearValue: 1.0
      }
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, mesh.vertexBuffer);
    pass.setIndexBuffer(mesh.indexBuffer, "uint32");
    pass.drawIndexed(mesh.indexCount);
    pass.end();
    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

async function loadTeapot(device, url) {
  const obj = await readOBJFile(url, 1.0, false);
  const n = obj.vertices.length / 4;
  const vertexData = new Float32Array(n * 9);
  for (let i = 0; i < n; ++i) {
    vertexData[i*9+0] = obj.vertices[i*4+0];
    vertexData[i*9+1] = obj.vertices[i*4+1];
    vertexData[i*9+2] = obj.vertices[i*4+2];
    vertexData[i*9+3] = obj.normals[i*4+0];
    vertexData[i*9+4] = obj.normals[i*4+1];
    vertexData[i*9+5] = obj.normals[i*4+2];
    vertexData[i*9+6] = obj.colors[i*4+0];
    vertexData[i*9+7] = obj.colors[i*4+1];
    vertexData[i*9+8] = obj.colors[i*4+2];
  }
  const indices = stripMaterialIndices(obj.indices);
  return {
    vertexBuffer: makeBuffer(device, vertexData, GPUBufferUsage.VERTEX),
    indexBuffer:  makeBuffer(device, indices, GPUBufferUsage.INDEX),
    indexCount: indices.length
  };
}

function makeBuffer(device, data, usage) {
  const buffer = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

function stripMaterialIndices(indices) {
  const triangles = indices.length / 4;
  const out = new Uint32Array(triangles * 3);
  for (let t = 0; t < triangles; ++t) {
    out[t*3+0] = indices[t*4+0];
    out[t*3+1] = indices[t*4+1];
    out[t*3+2] = indices[t*4+2];
  }
  return out;
}
