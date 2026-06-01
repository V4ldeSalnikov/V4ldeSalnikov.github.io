"use strict";

window.onload = function () { main(); };

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const canTimestamp = adapter.features.has("timestamp-query");
  const device = await adapter.requestDevice({
    requiredFeatures: canTimestamp ? ["timestamp-query"] : [],
  });

  const canvas = document.getElementById("my-canvas");
  const context = canvas.getContext("webgpu");
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: canvasFormat });

  const sceneSelect = document.getElementById("scene-select");
  const gpuTimeLabel = document.getElementById("gpu-time");
  const renderButton = document.getElementById("render-button");

  const scenes = {
    teapot: { filename: "../Week5/teapot.obj", camera: { eye: [0.15, 1.5, 10.0], center: [0.15, 1.5, 0.0], up: [0.0, 1.0, 0.0], camConst: 2.5 } },
    bunny:  { filename: "../Week5/bunny.obj",  camera: { eye: [-0.02, 0.11, 0.6], center: [-0.02, 0.11, 0.0], up: [0.0, 1.0, 0.0], camConst: 3.5 } },
  };

  const plane = { point: [0.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], color: [0.1, 0.7, 0.0] };
  const meshColor = [0.9, 0.9, 0.9];
  const light = { direction: normalize([-1.0, -1.0, -1.0]), radiance: [Math.PI, Math.PI, Math.PI] };
  const background = [0.1, 0.3, 0.6];

  let camera = scenes.teapot.camera;
  let faceCount = 0;
  let buffers = null;
  let bindGroup = null;

  const wgsl = device.createShaderModule({ code: document.getElementById("raytracing-wgsl").text });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex:   { module: wgsl, entryPoint: "vs_main" },
    fragment: { module: wgsl, entryPoint: "fs_main", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-strip" },
  });
  const uniformBuffer = device.createBuffer({
    size: 12 * 4 * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const timingHelper = new TimingHelper(device);

  function updateUniforms() {
    const aspect  = canvas.width / canvas.height;
    const forward = normalize(subtract(camera.center, camera.eye));
    const right   = normalize(cross(forward, camera.up));
    const up      = cross(right, forward);
    const uniforms = new Float32Array([
      ...camera.eye, 0.0,
      ...right,      0.0,
      ...up,         0.0,
      ...forward,    0.0,
      aspect, camera.camConst, faceCount, 0.0,
      ...plane.point,  0.0,
      ...plane.normal, 0.0,
      ...plane.color,  0.0,
      ...meshColor,    0.0,
      ...background,       1.0,
      ...light.direction,  0.0,
      ...light.radiance,   0.0,
    ]);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);
  }

  function draw() {
    if (!bindGroup) { return; }
    const encoder = device.createCommandEncoder();
    const pass = timingHelper.beginRenderPass(encoder, {
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: "store",
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(4);
    pass.end();
    device.queue.submit([encoder.finish()]);
    timingHelper.getResult().then(time => {
      gpuTimeLabel.textContent = canTimestamp ? `GPU frame: ${(time / 1000).toFixed(1)} us` : "GPU frame: timestamp-query unavailable";
    });
  }

  async function loadScene(name) {
    const scene = scenes[name] ?? scenes.teapot;
    gpuTimeLabel.textContent = `Loading ${name}...`;
    const drawingInfo = await readOBJFile(scene.filename, 1.0, false);
    faceCount = drawingInfo.indices.length / 4;
    camera = scene.camera;

    tree_objects = [];
    root = null;
    const newBuffers = {};
    build_bsp_tree(drawingInfo, device, newBuffers);
    buffers = newBuffers;

    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: buffers.positions } },
        { binding: 2, resource: { buffer: buffers.indices } },
        { binding: 3, resource: { buffer: buffers.normals } },
        { binding: 4, resource: { buffer: buffers.aabb } },
        { binding: 5, resource: { buffer: buffers.treeIds } },
        { binding: 6, resource: { buffer: buffers.bspTree } },
        { binding: 7, resource: { buffer: buffers.bspPlanes } },
      ],
    });

    updateUniforms();
    draw();
  }

  sceneSelect.addEventListener("change", () => loadScene(sceneSelect.value));
  renderButton.addEventListener("click", draw);

  const requested = new URLSearchParams(window.location.search).get("scene") ?? "teapot";
  sceneSelect.value = requested in scenes ? requested : "teapot";
  await loadScene(sceneSelect.value);
}
