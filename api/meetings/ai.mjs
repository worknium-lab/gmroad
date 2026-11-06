// 받아쓰기(우리 서버의 faster-whisper)와 요약 · 글자 인식(Claude API)
//  - STT_URL           : 받아쓰기 서버 (docker compose의 stt, 기본 http://stt:9000)
//  - ANTHROPIC_API_KEY : 고객사 Claude API 키 (없으면 요약 · 글자 인식은 건너뛰고 직접 씀)
//  - CLAUDE_MODEL      : 기본 claude-sonnet-5-5
const STT_URL = (process.env.STT_URL || 'http://stt:9000').replace(/\/$/, '');
const KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

export const aiEnabled = () => !!KEY;

export async function sttHealth() {
  try {
    const r = await fetch(STT_URL + '/health', { signal: AbortSignal.timeout(3000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** 녹음 → [{ start, end, text }] */
export async function transcribe(buf, prompt) {
  let r;
  try {
    r = await fetch(STT_URL + '/transcribe?language=ko', {
      method: 'POST', body: buf, headers: { 'Content-Type': 'application/octet-stream', 'X-Prompt': encodeURIComponent(prompt || '') },
      signal: AbortSignal.timeout(6 * 60 * 60 * 1000),
    });
  } catch (e) {
    throw new Error('받아쓰기 서버에 연결할 수 없습니다. 서버에서 받아쓰기(stt)를 켰는지 확인하세요 (' + (e.cause?.code || e.message) + ')');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || '받아쓰기 실패');
  return j;
}

/** Claude 호출 → 글자 */
export async function claude({ system, content, maxTokens = 8000 }) {
  if (!KEY) throw new Error('Claude API 키가 없습니다 (.env 의 ANTHROPIC_API_KEY)');
  const body = { model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] };
  for (let attempt = 0; ; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise((ok) => setTimeout(ok, 5000 * (attempt + 1))); continue; }
    throw new Error('Claude API 오류: ' + (j.error?.message || r.status));
  }
}

/** 응답에서 JSON 꺼내기 (```json 감싸도 됨) */
export function parseJson(text) {
  const t = String(text || '').trim();
  const m = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  const s = m ? m[1] : t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1);
  return JSON.parse(s);
}

const mmss = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** 회의 요약 · 할 일 뽑기 */
export async function summarize(m, { members = [], glossary = [] } = {}) {
  const lines = (m.transcript || []).map((x) => `[${mmss(x.start)}]${x.speaker ? ' ' + x.speaker + ':' : ''} ${x.text}`).join('\n');
  const pages = (m.pages || []).filter((p) => p.text).map((p, i) => `--- ${p.kind === 'note' ? '노트' : '수기'} ${i + 1}쪽 ---\n${p.text}`).join('\n');
  const system = `당신은 한국 건설회사(교량 보수보강 · 특허공법) 현장의 회의록 정리 담당입니다.
받아쓰기 · 수기 회의록 · 메모를 읽고 회의 내용을 정리합니다. 원문에 없는 내용은 만들지 않습니다.
받아쓰기는 오타가 있을 수 있으니 현장 용어 목록을 참고해 바로잡아 이해하되, 확실하지 않은 것은 그대로 둡니다.
반드시 아래 JSON 하나만 답합니다.
{
  "one_line": "회의 전체 한 줄 요약",
  "agenda": [{ "title": "안건", "points": ["논의 내용 요점"], "start": 안건이 시작된 초(받아쓰기 시간, 없으면 null) }],
  "decisions": ["결정된 사항 (누가 · 무엇을 · 언제까지가 있으면 포함)"],
  "open_issues": ["결론 나지 않은 사항"],
  "todos": [{ "text": "할 일", "assignee": "담당자 이름(참석자 · 직원 이름 중, 모르면 빈 글자)", "due": "YYYY-MM-DD 또는 빈 글자" }]
}
쉬운 말로, 문장은 짧게 씁니다. 회의 날짜를 기준으로 '다음 주 금요일' 같은 기한을 날짜로 바꿉니다.`;
  const content = `회의: ${m.title} (${m.kind}) · 일시 ${new Date(m.held_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} · 장소 ${m.place || '-'}
참석자: ${(m.attendees || []).map((a) => `${a.name}${a.org ? '(' + a.org + ')' : ''}`).join(', ') || '-'}
직원 · 프로젝트 참여자: ${members.join(', ') || '-'}
안건: ${m.agenda || '-'}
현장 용어: ${glossary.slice(0, 200).join(', ') || '-'}

[받아쓰기]
${lines || '(없음)'}

[수기 · 노트]
${pages || '(없음)'}

[메모]
${m.note_text || '(없음)'}`;
  return parseJson(await claude({ system, content: [{ type: 'text', text: content }], maxTokens: 8000 }));
}

/** 수기 회의록 · 펜 노트 사진 → 글자 */
export async function readPage(imageBuf, mediaType, glossary = []) {
  const system = `손으로 쓴 한국어 회의록 · 필기 사진을 글자로 옮깁니다. 보이는 그대로 줄 단위로 옮기고, 내용을 고치거나 덧붙이지 않습니다.
읽기 어려운 글자는 [?]로 표시합니다. 서명 · 도장은 [서명]으로만 씁니다. 현장 용어: ${glossary.slice(0, 150).join(', ')}
반드시 JSON 하나만 답합니다: { "text": "옮긴 글 (줄바꿈 포함)", "unsure": ["확실하지 않은 줄"] }`;
  return parseJson(await claude({
    system, maxTokens: 4000,
    content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(imageBuf).toString('base64') } }, { type: 'text', text: '이 쪽의 글자를 옮겨 주세요.' }],
  }));
}
