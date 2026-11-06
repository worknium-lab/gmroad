// 사진 EXIF에서 촬영 시각 · GPS 읽기 (외부 라이브러리 없이)
/** JPEG만. 압축하면 EXIF가 지워지므로 올리기 전에 읽음 */
export type Exif = { taken?: Date; lat?: number; lng?: number };
export async function readExif(file: File): Promise<Exif> {
  try {
    const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (buf.getUint16(0) !== 0xffd8) return {};
    let off = 2;
    while (off + 4 < buf.byteLength) {
      const marker = buf.getUint16(off); const len = buf.getUint16(off + 2);
      if (marker === 0xffe1 && buf.getUint32(off + 4) === 0x45786966) return parseTiff(buf, off + 10);
      if ((marker & 0xff00) !== 0xff00) break;
      off += 2 + len;
    }
  } catch { /* 읽지 못하면 파일 시각을 씀 */ }
  return {};
}
function parseTiff(v: DataView, t: number): Exif {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o: number) => v.getUint16(t + o, le); const u32 = (o: number) => v.getUint32(t + o, le);
  const ifd = (o: number) => { const n = u16(o); const m = new Map<number, number>(); for (let i = 0; i < n; i++) m.set(u16(o + 2 + i * 12), o + 2 + i * 12); return m; };
  const str = (e: number) => { const cnt = u32(e + 4); const p = cnt > 4 ? u32(e + 8) : e + 8; let s = ''; for (let i = 0; i < cnt - 1; i++) s += String.fromCharCode(v.getUint8(t + p + i)); return s; };
  const rats = (e: number) => { const p = u32(e + 8); return [0, 1, 2].map((i) => u32(p + i * 8) / (u32(p + i * 8 + 4) || 1)); };
  const out: Exif = {};
  const ifd0 = ifd(u32(4));
  const ex = ifd0.get(0x8769);
  const dateEntry = ex != null ? ifd(u32(ex + 8)).get(0x9003) : undefined;
  const ds = dateEntry != null ? str(dateEntry) : ifd0.get(0x0132) != null ? str(ifd0.get(0x0132)!) : '';
  const m = ds.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
  if (m) out.taken = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]); // 카메라 시각 = 현지 시각
  const g = ifd0.get(0x8825);
  if (g != null) {
    const gi = ifd(u32(g + 8));
    const la = gi.get(2), lo = gi.get(4);
    if (la != null && lo != null) {
      const dms = (a: number[]) => a[0] + a[1] / 60 + a[2] / 3600;
      const ref = (tag: number) => { const e = gi.get(tag); return e != null ? String.fromCharCode(v.getUint8(t + e + 8)) : ''; };
      out.lat = dms(rats(la)) * (ref(1) === 'S' ? -1 : 1);
      out.lng = dms(rats(lo)) * (ref(3) === 'W' ? -1 : 1);
      if (!isFinite(out.lat) || !isFinite(out.lng) || (out.lat === 0 && out.lng === 0)) { delete out.lat; delete out.lng; }
    }
  }
  return out;
}

