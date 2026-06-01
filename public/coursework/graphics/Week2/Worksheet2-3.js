"use strict";

window.onload = () => { main(); };

async function main() {
  const adapter = await navigator.gpu.requestAdapter();
  const device  = await adapter.requestDevice();

  const canvas  = document.getElementById('my-canvas');
  const context = canvas.getContext('webgpu');
  const format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const selBG   = document.getElementById('bg-color');
  const selPT   = document.getElementById('pt-color');
  const btnClr  = document.getElementById('clear-btn');
  const btnPoint= document.getElementById('mode-point');
  const btnTri  = document.getElementById('mode-tri');

  const COLORS = {
    cornflower:[0.3921,0.5843,0.9294], white:[1,1,1], black:[0,0,0],
    red:[1,0,0], green:[0,1,0], blue:[0,0,1],
    yellow:[1,1,0], magenta:[1,0,1], cyan:[0,1,1],
    orange:[1,0.5,0], purple:[0.5,0,0.5], gray:[0.5,0.5,0.5]
  };
  let clearColor        = COLORS[selBG.value];
  let currentVertexColor= COLORS[selPT.value];

  selBG.addEventListener('change', () => { clearColor = COLORS[selBG.value]; render(); });
  selPT.addEventListener('change', () => { currentVertexColor = COLORS[selPT.value]; });

  let mode = 'point';
  function setMode(m) {
    mode = m;
    btnPoint.setAttribute('aria-pressed', m === 'point' ? 'true':'false');
    btnTri.setAttribute('aria-pressed',   m === 'triangle' ? 'true':'false');
    triClicks.length = 0;
  }
  btnPoint.onclick = () => setMode('point');
  btnTri.onclick   = () => setMode('triangle');

  const SIZEOF_VEC2 = sizeof['vec2'];
  const SIZEOF_VEC3 = sizeof['vec3'];

  const pointSize = (20 * 2) / canvas.height;

  function addPoint(posArr, colArr, p, size, color) {
    const o = size / 2;
    const a = vec2(p[0]-o, p[1]-o), b = vec2(p[0]+o, p[1]-o);
    const c = vec2(p[0]-o, p[1]+o), d = vec2(p[0]+o, p[1]+o);
    posArr.push(a,b,c,  c,b,d);
    for (let i = 0; i < 6; ++i) colArr.push(vec3(color[0], color[1], color[2]));
  }

  function addTriangle(posArr, colArr, p1, p2, p3, c1, c2, c3) {
    posArr.push(vec2(p1[0],p1[1]), vec2(p2[0],p2[1]), vec2(p3[0],p3[1]));
    colArr.push(vec3(c1[0],c1[1],c1[2]), vec3(c2[0],c2[1],c2[2]), vec3(c3[0],c3[1],c3[2]));
  }

  function clientToClip(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const nx = (clientX - r.left) / r.width;
    const ny = (clientY - r.top)  / r.height;
    return [nx * 2 - 1, 1 - ny * 2];
  }

  const positions = [];
  const colors    = [];

  function align4(n){ return (n + 3) & ~3; }
  let positionBuffer = null, positionCap = 0;
  let colorBuffer    = null, colorCap    = 0;

  function ensurePositionBuffer(bytes) {
    if (!positionBuffer || bytes > positionCap) {
      if (positionBuffer) positionBuffer.destroy();
      positionCap = align4(Math.max(bytes, 16) * 2);
      positionBuffer = device.createBuffer({
        size: positionCap,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
    }
  }
  function ensureColorBuffer(bytes) {
    if (!colorBuffer || bytes > colorCap) {
      if (colorBuffer) colorBuffer.destroy();
      colorCap = align4(Math.max(bytes, 16) * 2);
      colorBuffer = device.createBuffer({
        size: colorCap,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      });
    }
  }
  function upload() {
    const posData = flatten(positions);
    const colData = flatten(colors);
    ensurePositionBuffer(posData.byteLength);
    ensureColorBuffer(colData.byteLength);
    if (posData.byteLength) device.queue.writeBuffer(positionBuffer, 0, posData);
    if (colData.byteLength) device.queue.writeBuffer(colorBuffer, 0, colData);
  }

  const positionLayout = {
    arrayStride: SIZEOF_VEC2,
    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
  };
  const colorLayout = {
    arrayStride: SIZEOF_VEC3,
    attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }],
  };
  const wgsl = device.createShaderModule({ code: document.getElementById('wgsl').text });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: wgsl, entryPoint: 'main_vs', buffers: [positionLayout, colorLayout] },
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
        clearValue: { r: clearColor[0], g: clearColor[1], b: clearColor[2], a: 1.0 }
      }]
    });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, colorBuffer);
    pass.draw(positions.length);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }
  upload(); render();

  const triClicks = [];

  canvas.addEventListener('click', (e) => {
    const [x, y] = clientToClip(e.clientX, e.clientY);

    if (mode === 'point') {
      addPoint(positions, colors, [x,y], pointSize, currentVertexColor);
      upload(); render();
      return;
    }

    if (triClicks.length < 2) {
      addPoint(positions, colors, [x,y], pointSize, currentVertexColor);
      triClicks.push({ p:[x,y], color:[...currentVertexColor] });
      upload(); render();
    } else {
      positions.splice(-12, 12);
      colors.splice(-12, 12);

      const p1 = triClicks[0].p, c1 = triClicks[0].color;
      const p2 = triClicks[1].p, c2 = triClicks[1].color;
      const p3 = [x,y],          c3 = [...currentVertexColor];
      addTriangle(positions, colors, p1, p2, p3, c1, c2, c3);

      triClicks.length = 0;
      upload(); render();
    }
  });

  btnClr.addEventListener('click', () => {
    positions.length = 0;
    colors.length = 0;
    triClicks.length = 0;
    upload(); render();
  });
}
