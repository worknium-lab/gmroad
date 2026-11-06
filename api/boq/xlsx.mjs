// 엑셀(xlsx) 원본을 그대로 다루는 도구
//  - read: 모든 시트의 값 · 수식을 읽음 (공유 수식은 셀마다 풀어서)
//  - patch: 원본 파일에서 지정한 셀만 값/수식으로 바꾸고 나머지(서식 · 병합 · 그림 · 다른 시트)는 그대로 둠
import JSZip from 'jszip';

export const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
export const encode = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function colToNum(c) { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
export function numToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
export function splitAddr(a) { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(a); return { col: colToNum(m[1]), row: +m[2] }; }
export const addr = (col, row) => numToCol(col) + row;

/** 상대 참조를 (dr, dc)만큼 옮김 — 공유 수식 풀기용. 문자열 안 · 시트명 안은 건드리지 않음 */
export function shiftFormula(f, dr, dc) {
  let out = '', i = 0;
  while (i < f.length) {
    const ch = f[i];
    if (ch === '"') { const j = f.indexOf('"', i + 1); out += f.slice(i, j + 1); i = j + 1; continue; }
    if (ch === "'") { const j = f.indexOf("'", i + 1); out += f.slice(i, j + 1); i = j + 1; continue; }
    const m = /^(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/.exec(f.slice(i));
    const prev = i > 0 ? f[i - 1] : '';
    if (m && !/[A-Za-z0-9_.]/.test(prev)) {
      const col = m[1] ? m[2] : numToCol(colToNum(m[2]) + dc);
      const row = m[3] ? m[4] : String(+m[4] + dr);
      out += m[1] + col + m[3] + row; i += m[0].length; continue;
    }
    const w = /^[A-Za-z_][\w.]*/.exec(f.slice(i));
    if (w) { out += w[0]; i += w[0].length; continue; }
    out += ch; i++;
  }
  return out;
}

export async function sheetFiles(zip) {
  const wb = await zip.file('xl/workbook.xml').async('string');
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1]; let t = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && t) { t = t.replace(/^\/?xl\//, '').replace(/^\//, ''); relMap[id] = 'xl/' + t; }
  }
  const out = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = decode(/name="([^"]*)"/.exec(m[0])[1]);
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] || /\bid="([^"]+)"/.exec(m[0])?.[1];
    if (relMap[rid]) out.push({ name, path: relMap[rid] });
  }
  return out;
}

async function sharedStrings(zip) {
  const f = zip.file('xl/sharedStrings.xml'); if (!f) return [];
  const x = await f.async('string');
  return [...x.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
}

/** 워크북 읽기 → { sheets: [{ name, path, cells: Map(addr → { v, f }) }] } */
export async function readWorkbook(buf) {
  const zip = await JSZip.loadAsync(buf);
  const ss = await sharedStrings(zip);
  const sheets = [];
  for (const s of await sheetFiles(zip)) {
    const xml = await zip.file(s.path).async('string');
    const cells = new Map();
    const masters = {};
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, a, attrs, inner = ''] = m;
      const t = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const vRaw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let v = null;
      if (t === 's') v = vRaw != null ? ss[+vRaw] : null;
      else if (t === 'str' || t === 'e') v = vRaw != null ? decode(vRaw) : null;
      else if (t === 'inlineStr') v = decode([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else if (t === 'b') v = vRaw === '1';
      else v = vRaw != null && vRaw !== '' ? Number(vRaw) : null;
      let f = null;
      const fm = /<f([^>]*)>([\s\S]*?)<\/f>|<f([^>]*)\/>/.exec(inner);
      if (fm) {
        const fa = fm[1] ?? fm[3] ?? ''; const text = fm[2] != null ? decode(fm[2]) : null;
        const si = /\bsi="(\d+)"/.exec(fa)?.[1];
        if (/t="shared"/.test(fa)) {
          if (text) { masters[si] = { a, f: text }; f = text; }
          else { const ms = masters[si]; if (ms) { const p = splitAddr(ms.a), q = splitAddr(a); f = shiftFormula(ms.f, q.row - p.row, q.col - p.col); } }
        } else f = text;
      }
      if (v !== null || f) cells.set(a, { v, f });
    }
    sheets.push({ name: s.name, path: s.path, cells });
  }
  return { sheets, sheet: (n) => sheets.find((x) => x.name === n) };
}

/**
 * 원본 파일에서 셀만 바꾸기
 * edits: { [sheetName]: { [addr]: { value?: number|string|null, formula?: string } } }
 * 바꾼 셀이 공유 수식의 기준(master)이면, 딸린 셀들을 일반 수식으로 풀어 써서 깨지지 않게 함.
 * 저장 시 엑셀이 열 때 전체를 다시 계산하도록 fullCalcOnLoad 설정.
 */
export async function patchWorkbook(buf, edits, values = {}) {
  const zip = await JSZip.loadAsync(buf);
  const files = await sheetFiles(zip);
  for (const name of new Set([...Object.keys(edits), ...Object.keys(values)])) {
    const cellEdits = edits[name] || {};
    const sf = files.find((s) => s.name === name);
    if (!sf) throw new Error(`시트 없음: ${name}`);
    let xml = await zip.file(sf.path).async('string');
    // 1) 바꿀 셀이 공유 수식 master면 그 그룹 전체를 일반 수식으로 풀기
    const targets = new Set(Object.keys(cellEdits));
    const masterRe = /<c r="([A-Z]+\d+)"[^>]*>\s*<f t="shared" ref="([^"]+)" si="(\d+)"[^>]*>([\s\S]*?)<\/f>/g;
    const unshare = [];
    for (const m of xml.matchAll(masterRe)) if (targets.has(m[1])) unshare.push({ a: m[1], si: m[3], f: decode(m[4]) });
    for (const u of unshare) {
      const p = splitAddr(u.a);
      xml = xml.replace(new RegExp(`(<c r="([A-Z]+\\d+)"[^>]*>)<f t="shared"(?: ref="[^"]*")? si="${u.si}"[^>]*?(?:/>|>[\\s\\S]*?</f>)`, 'g'), (all, open, a) => {
        const q = splitAddr(a);
        return `${open}<f>${encode(shiftFormula(u.f, q.row - p.row, q.col - p.col))}</f>`;
      });
    }
    // 2) 셀 바꾸기 (없으면 행에 추가)
    for (const [a, e] of Object.entries(cellEdits)) {
      const style = (() => { const m = new RegExp(`<c r="${a}"([^>]*?)(?:/>|>)`).exec(xml); return m ? (/\bs="(\d+)"/.exec(m[1])?.[0] || '') : ''; })();
      let cellXml;
      if (e.formula) cellXml = `<c r="${a}" ${style}><f>${encode(e.formula.replace(/^=/, ''))}</f></c>`;
      else if (e.value === null || e.value === undefined || e.value === '') cellXml = `<c r="${a}" ${style}/>`;
      else if (typeof e.value === 'number') cellXml = `<c r="${a}" ${style}><v>${e.value}</v></c>`;
      else cellXml = `<c r="${a}" ${style} t="inlineStr"><is><t>${encode(e.value)}</t></is></c>`;
      cellXml = cellXml.replace(/\s+>/g, '>').replace(/\s+\/>/g, '/>');
      const re = new RegExp(`<c r="${a}"(?:[^>]*?/>|[^>]*>[\\s\\S]*?</c>)`);
      if (re.test(xml)) xml = xml.replace(re, cellXml);
      else {
        const { row, col } = splitAddr(a);
        const rowRe = new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(</row>)`);
        if (rowRe.test(xml)) xml = xml.replace(rowRe, (all, o, body, c) => {
          const cells = [...body.matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*?\/>|[^>]*>[\s\S]*?<\/c>)/g)];
          const after = cells.find((x) => colToNum(x[1]) > col);
          return after ? o + body.replace(after[0], cellXml + after[0]) + c : o + body + cellXml + c;
        });
        else throw new Error(`${name}!${a}: 행이 없어 셀을 추가할 수 없습니다`);
      }
    }
    // 3) 수식 셀의 저장값(<v>)을 새 계산값으로 — 다시 계산하지 않는 프로그램(미리보기 등)에서도 맞는 값이 보이게
    for (const [a, v] of Object.entries(values[name] || {})) {
      const re = new RegExp(`<c r="${a}"([^>]*?)>([\\s\\S]*?)</c>`);
      xml = xml.replace(re, (all, attrs, inner) => {
        if (!/<f[\s>\/]/.test(inner)) return all;
        const at = attrs.replace(/\s*t="[^"]*"/, '') + (typeof v === 'string' ? ' t="str"' : typeof v === 'boolean' ? ' t="b"' : '');
        const vv = v === null || v === undefined ? '' : `<v>${typeof v === 'boolean' ? (v ? 1 : 0) : encode(v)}</v>`;
        return `<c r="${a}"${at}>${inner.replace(/<v>[\s\S]*?<\/v>/, '').replace(/(<\/f>|<f[^>]*\/>)/, `$1${vv}`)}</c>`;
      });
    }
    zip.file(sf.path, xml);
  }
  await finishZip(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** 엑셀이 열 때 전체 다시 계산하도록 (계산 순서 캐시 지움) */
export async function finishZip(zip) {
  let wb = await zip.file('xl/workbook.xml').async('string');
  if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b([^>]*?)(\/?)>/, (m, a, sl) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"${sl}>`);
  else wb = wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
  zip.file('xl/workbook.xml', wb);
  zip.remove('xl/calcChain.xml');
  const ct = await zip.file('[Content_Types].xml').async('string');
  zip.file('[Content_Types].xml', ct.replace(/<Override[^>]*calcChain[^>]*\/>/, ''));
  const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  zip.file('xl/_rels/workbook.xml.rels', rels.replace(/<Relationship[^>]*calcChain[^>]*\/>/, ''));
}
