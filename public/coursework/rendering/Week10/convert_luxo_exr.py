import bpy
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src_path = ROOT / "luxo_pxr_campus.hdr.png"
dst_path = ROOT / "luxo_pxr_campus.exr"

src = bpy.data.images.load(str(src_path))
src.colorspace_settings.name = 'Non-Color'
src.alpha_mode = 'CHANNEL_PACKED'
w, h = src.size

buf = np.empty(w * h * 4, dtype=np.float32)
src.pixels.foreach_get(buf)
buf = buf.reshape(h, w, 4)

scale = np.exp2(255.0 * buf[..., 3:4] - 128.0)
lin = buf[..., :3] * scale

lin = lin.reshape(h // 2, 2, w // 2, 2, 3).mean(axis=(1, 3))
h, w = lin.shape[:2]
out = np.concatenate([lin, np.ones((h, w, 1), np.float32)], axis=2)

dst = bpy.data.images.new("luxoEXR", w, h, alpha=False, float_buffer=True)
dst.colorspace_settings.name = 'Linear Rec.709'
dst.pixels.foreach_set(out.reshape(-1))
dst.filepath_raw = str(dst_path)
dst.file_format = 'OPEN_EXR'
dst.save()
print(f"WROTE {dst_path}  ({w}x{h})  max_radiance={lin.max():.1f}")
