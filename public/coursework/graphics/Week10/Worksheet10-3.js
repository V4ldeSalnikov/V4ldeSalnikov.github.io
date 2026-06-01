"use strict";

window.onload = () => { main(); };

const Z_EYE0 = 6.0;
const DOLLY_K = 0.02;
const PAN_K   = 0.01;

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

  const tb = createTrackball(canvas);

  function frame() {
    const view = tb.view(at);
    const eye = tb.eye(at);

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
  const tb = {
    q_rot: new Quaternion(),
    zeye: Z_EYE0,
    panX: 0.0, panY: 0.0,
    mode: "orbit",
    dragging: false, last: null, lastX: 0, lastY: 0
  };

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

  tb.center = (a) => {
    const X = tb.q_rot.apply(vec3(1, 0, 0));
    const Y = tb.q_rot.apply(vec3(0, 1, 0));
    return subtract(a, add(scale(tb.panX, X), scale(tb.panY, Y)));
  };
  tb.eye = (a) => add(tb.q_rot.apply(vec3(0, 0, tb.zeye)), tb.center(a));
  tb.view = (a) => {
    const c = tb.center(a);
    return lookAt(add(tb.q_rot.apply(vec3(0, 0, tb.zeye)), c), c, tb.q_rot.apply(vec3(0, 1, 0)));
  };

  function onDown(e) {
    tb.dragging = true;
    const p = toNDC(e);
    tb.last = projectToSphere(p[0], p[1]);
    tb.lastX = e.clientX; tb.lastY = e.clientY;
  }
  function onMove(e) {
    if (!tb.dragging) return;
    if (tb.mode === "orbit") {
      const p = toNDC(e);
      const cur = projectToSphere(p[0], p[1]);
      const q_inc = new Quaternion();
      q_inc.make_rot_vec2vec(cur, tb.last);
      tb.q_rot.multiply(q_inc);
      tb.last = cur;
    } else if (tb.mode === "dolly") {
      tb.zeye = Math.max(1.5, Math.min(40.0, tb.zeye + DOLLY_K * (e.clientY - tb.lastY)));
    } else {
      tb.panX += PAN_K * (e.clientX - tb.lastX);
      tb.panY -= PAN_K * (e.clientY - tb.lastY);
    }
    tb.lastX = e.clientX; tb.lastY = e.clientY;
  }
  function onUp() { tb.dragging = false; }

  canvas.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);

  const buttons = { orbit: "mode-orbit", dolly: "mode-dolly", pan: "mode-pan" };
  for (const [mode, id] of Object.entries(buttons)) {
    document.getElementById(id).addEventListener("click", () => {
      tb.mode = mode;
      for (const [m, bid] of Object.entries(buttons))
        document.getElementById(bid).setAttribute("aria-pressed", String(m === mode));
    });
  }

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
