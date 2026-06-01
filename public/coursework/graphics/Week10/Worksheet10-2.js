"use strict";

window.onload = () => { main(); };

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
  const at = vec3(0, 0, 0);
  const lightDir = [0.5, 0.8, 1.0, 0.0];

  const trackball = createTrackball(canvas);

  function frame() {
    const eye = trackball.q_rot.apply(vec3(0, 0, Z_EYE));
    const up  = trackball.q_rot.apply(vec3(0, 1, 0));
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

function createTrackball(canvas) {
  const tb = { q_rot: new Quaternion(), q_inc: new Quaternion(), dragging: false, last: null };

  function projectToSphere(nx, ny) {
    const d = Math.sqrt(nx * nx + ny * ny);
    const z = (d <= 1.0 / Math.SQRT2) ? Math.sqrt(1.0 - d * d) : 1.0 / (2.0 * d);
    return normalize(vec3(nx, ny, z));
  }

  function toNDC(e) {
    const r = canvas.getBoundingClientRect();
    return [2.0 * (e.clientX - r.left) / r.width - 1.0,
            1.0 - 2.0 * (e.clientY - r.top) / r.height];
  }

  tb.begin = (nx, ny) => { tb.dragging = true; tb.last = projectToSphere(nx, ny); };
  tb.move = (nx, ny) => {
    if (!tb.dragging) return;
    const cur = projectToSphere(nx, ny);
    tb.q_inc = new Quaternion();
    tb.q_inc.make_rot_vec2vec(cur, tb.last);
    tb.q_rot.multiply(tb.q_inc);
    tb.last = cur;
  };
  tb.end = () => { tb.dragging = false; };

  canvas.addEventListener("mousedown", (e) => { const p = toNDC(e); tb.begin(p[0], p[1]); });
  window.addEventListener("mousemove", (e) => { if (tb.dragging) { const p = toNDC(e); tb.move(p[0], p[1]); } });
  window.addEventListener("mouseup", () => tb.end());

  return tb;
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
