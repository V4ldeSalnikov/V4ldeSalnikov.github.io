/// <reference types="@webgpu/types" />
import { useEffect, useRef, useState } from 'react';

interface Props {
  shader?: string;
  width?: number;
  height?: number;
  fallback?: string;
  caption?: string;
}

const DEFAULT_WGSL = /* wgsl */ `
  struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
  @vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    var o: VOut;
    o.pos = vec4f(p[i], 0.0, 1.0);
    o.uv = (p[i] + vec2f(1.0)) * 0.5;
    return o;
  }
  // u.x = time in seconds; vec4f keeps the uniform a clean 16 bytes.
  @group(0) @binding(0) var<uniform> u: vec4f;
  @fragment fn fs(in: VOut) -> @location(0) vec4f {
    let uv = in.uv;
    let t = u.x;
    let r = 0.5 + 0.5 * sin(t + uv.x * 6.2831);
    let g = 0.5 + 0.5 * sin(t * 0.7 + uv.y * 6.2831 + 2.0);
    let b = 0.5 + 0.5 * sin(t * 1.3 + (uv.x + uv.y) * 3.14159 + 4.0);
    return vec4f(r * 0.45, g * 0.45, b * 0.7, 1.0);
  }
`;

export default function WebGPUCanvas({
  shader,
  width = 800,
  height = 450,
  fallback,
  caption,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'init' | 'running' | 'unsupported' | 'error'>('init');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;

    async function start() {
      const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
      if (!gpu) {
        setStatus('unsupported');
        return;
      }
      const canvas = canvasRef.current;
      if (!canvas) return;

      try {
        const adapter = await gpu.requestAdapter();
        if (!adapter) {
          setStatus('unsupported');
          return;
        }
        const device = await adapter.requestDevice();
        const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
        if (!ctx) {
          setStatus('unsupported');
          return;
        }
        const format = gpu.getPreferredCanvasFormat();
        ctx.configure({ device, format, alphaMode: 'opaque' });

        const code = shader ? await (await fetch(shader)).text() : DEFAULT_WGSL;
        const module = device.createShaderModule({ code });
        const pipeline = device.createRenderPipeline({
          layout: 'auto',
          vertex: { module, entryPoint: 'vs' },
          fragment: { module, entryPoint: 'fs', targets: [{ format }] },
          primitive: { topology: 'triangle-list' },
        });

        const uni = device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: uni } }],
        });

        setStatus('running');
        const t0 = performance.now();
        const frame = () => {
          if (cancelled) return;
          const t = (performance.now() - t0) / 1000;
          device.queue.writeBuffer(uni, 0, new Float32Array([t, 0, 0, 0]));
          const enc = device.createCommandEncoder();
          const pass = enc.beginRenderPass({
            colorAttachments: [
              {
                view: ctx.getCurrentTexture().createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
              },
            ],
          });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.draw(3);
          pass.end();
          device.queue.submit([enc.finish()]);
          rafId = requestAnimationFrame(frame);
        };
        frame();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    }

    start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [shader]);

  if (status === 'unsupported') {
    return (
      <figure>
        {fallback ? (
          <img src={fallback} alt={caption ?? 'WebGPU demo (fallback)'} />
        ) : (
          <div
            style={{
              width: '100%',
              aspectRatio: `${width} / ${height}`,
              background: 'var(--color-bg-soft)',
              border: '1px solid var(--color-line)',
              borderRadius: '4px',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--color-fg-dim)',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.9em',
              padding: '1rem',
              textAlign: 'center',
            }}
          >
            WebGPU is not available in this browser. Try Chrome, Edge, or Safari 18+.
          </div>
        )}
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    );
  }

  return (
    <figure>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width: '100%', height: 'auto' }}
      />
      {status === 'error' && (
        <figcaption style={{ color: '#f87171' }}>WebGPU error: {error}</figcaption>
      )}
      {caption && status !== 'error' && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
