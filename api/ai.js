// EAIM — Gemini AI 중계 서버 함수 (Vercel)  · api/ai.js  v0.5 (2026-09-17)
// ★ 기준본: eaim-play 저장소(음악과). 다른 저장소는 이 파일을 고치지 않고 같은 버전을 그대로 복사합니다.
//   모델 별칭 추가·수정이 필요하면 음악과 창에 요청 → 기준본을 고치고 버전을 올린 뒤 다시 복사.
// 본보기: 같은 저장소의 api/lalal.js (키는 서버 환경변수에만, 학생 브라우저로 내려보내지 않음)
// 위치: 저장소 루트의 api/ai.js  → 앱은 상대 경로 'api/ai' 로 부릅니다 (공통 규칙 10-1)
//
// Vercel 프로젝트 → Settings → Environment Variables
// 어떤 키를 쓰나 (2026-09-17 중간 단계 결정)
//   ① 초대 링크의 교사가 ALLOWED_TEACHERS에 있으면 → 운영자 키 GEMINI_KEY
//   ② 그 밖의 교사 → 그 교사가 뮤지컬메이커 교사 대시보드에 넣은 본인 키(meta/settings.apiKey)
//   ③ 둘 다 없으면 → 막고 "선생님 키가 없어요" 안내
//   어느 키든 서버 안에서만 쓰고 학생 브라우저로 내려보내지 않습니다.
//
//   GEMINI_KEY        (선택) 운영자 서버용 Gemini 키. ※ '웹사이트 제한'을 걸면 서버에서 호출이 막힙니다.
//                     웹사이트 제한 없이 'API 제한(Generative Language API만)' + 하루 한도만 걸어 둔 키를 따로 만드세요.
//   ALLOWED_TEACHERS  (선택) 운영자 키를 쓸 교사 UID, 쉼표로 구분. 여기 없는 교사는 본인 키로만 씁니다.
//   ALLOWED_ORIGINS   (선택) 허용 주소, 쉼표로 구분. 비워 두면 아래 기본 목록.
//   AI_PER_MIN        (선택) 교사 한 명당 분당 텍스트 요청 수 (기본 60)
//   ── 심사·시연용 체험 링크 (선택) ──
//   DEMO_KEY          체험 전용 Gemini 키 (하루 한도를 낮게 걸어 두세요)
//   DEMO_TOKEN        체험 링크의 암호. 주소 뒤에 ?demo=<이 값> 이 붙어 있을 때만 체험 키를 씁니다
//   DEMO_UNTIL        체험 마지막 날 (YYYY-MM-DD, 그날 밤 12시까지). 비우면 기한 없음
//   DEMO_PER_MIN      체험 링크 전체의 분당 요청 수 (기본 10)
//   MUSIC_PER_MIN     (선택) 교사 한 명당 분당 노래 생성 수 (기본 6)
//
// 요청: POST api/ai   { teacher, model: 'text'|'image'|'image-lite'|'music'|'music-full', contents, generationConfig, search }
// 응답: Gemini 원래 응답 JSON 그대로 (앱의 기존 해석 코드를 그대로 쓰기 위해). 오류는 { error: { code, message } }
// 상태 확인: GET api/ai?action=ping&teacher=UID  → { ok, reason }

export const config = { api: { bodyParser: false }, maxDuration: 60 };

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MODELS = {                       // 공통 규칙 6-2 — 앱이 모델 이름을 직접 고르지 못하게 별칭으로만 받음
  'text':       'gemini-flash-latest',
  'image':      'gemini-3.1-flash-image',       // 고품질 (글자 들어간 그림 등) — 2026-09-17 3.1로 결정
  'image-lite': 'gemini-3.1-flash-lite-image',  // 저렴·빠름 (뮤지컬메이커 production-media의 기본 이미지)
  'music':      'lyria-3-clip-preview',   // 규칙 6-2에 아직 없음 → 규칙 변경 제안
  'music-full': 'lyria-3-pro-preview',    // 규칙 6-2에 아직 없음 → 규칙 변경 제안
};
const DEFAULT_ORIGINS = [   // 어느 저장소에 복사해도 같은 파일이 되도록 EAIM 주소를 모두 둠. 목록에 없는 주소는 ALLOWED_ORIGINS로
  // 음악
  'https://eaim-play.vercel.app', 'https://eaim-music.vercel.app', 'https://eaim-musical-maker.vercel.app',
  'https://eaimmusic-midia-letter.vercel.app', 'https://eaim-gugak.vercel.app',
  // 다른 교과 (배포 주소 확인된 것)
  'https://eaim-social-history.vercel.app', 'https://eaim-science-lap.vercel.app', 'https://eaim-math.vercel.app',
  'https://eaim-korean-play.vercel.app', 'https://eaim-care.vercel.app', 'https://eaim-edu.vercel.app',
];
// 수업 상태(교사 설정 문서)를 읽기 위한 Firebase 웹 설정 키 — 원래 모든 페이지에 공개되어 있는 값이며 Gemini 키가 아님
const FB_WEB_KEY = 'AIzaSyBalg0f5x0ydfHxn_nzgZ1pAELvJw6PzoY', PROJECT = 'eaim-classroom';
const MAX_BODY = 4 * 1024 * 1024;       // Vercel 요청 한도(약 4.5MB)보다 조금 작게

const list = (v, d) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : d);
const ORIGINS = list(process.env.ALLOWED_ORIGINS, DEFAULT_ORIGINS);
const TEACHERS = list(process.env.ALLOWED_TEACHERS, []);
const DEMO_PER_MIN = Number(process.env.DEMO_PER_MIN) || 10;
const PER_MIN = { text: Number(process.env.AI_PER_MIN) || 60, image: Number(process.env.AI_PER_MIN) || 60, music: Number(process.env.MUSIC_PER_MIN) || 6 };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('too-big'), { tooBig: true })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function send(req, res, status, obj, extra = {}) {
  const origin = req.headers.origin || '';
  if (ORIGINS.includes(origin)) {          // '*' 를 쓰지 않고, 허용 목록에 있는 주소만 돌려줌
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  }
  res.setHeader('Cache-Control', 'no-store');
  Object.entries(extra).forEach(([k, v]) => res.setHeader(k, v));
  res.status(status).json(obj);
}
const fail = (req, res, status, message, extra) => send(req, res, status, { error: { code: status, message } }, extra);

/* ── 체험 링크: 암호와 기한이 맞으면 체험 전용 키를 씀 (교사 설정을 보지 않음) ── */
function demoGate(tok) {
  const want = process.env.DEMO_TOKEN || '', key = process.env.DEMO_KEY || '', until = (process.env.DEMO_UNTIL || '').trim();
  if (!want || !key) return { ok: false, status: 403, reason: '체험 링크가 아직 준비되지 않았어요.' };
  if (String(tok) !== want) return { ok: false, status: 403, reason: '체험 링크가 올바르지 않아요. 주소를 다시 확인해 주세요.' };
  if (until) { const end = Date.parse(until + 'T23:59:59+09:00'); if (Number.isFinite(end) && Date.now() > end) return { ok: false, status: 403, reason: `체험 기간이 끝났어요 (${until}까지였어요).` }; }
  return { ok: true, key, who: 'demo' };
}

/* ── 교사 설정 확인 (30초 캐시): 선생님이 AI를 켜 두었는지 ── */
const settingsCache = new Map();
async function teacherGate(uid) {
  if (!/^[A-Za-z0-9]{20,40}$/.test(uid || '')) return { ok: false, status: 403, reason: 'AI는 선생님이 준 초대 링크(QR)로 들어왔을 때 쓸 수 있어요.' };
  const hit = settingsCache.get(uid);
  if (hit && Date.now() - hit.t < 30000) return hit.v;
  let v;
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/teachers/${uid}/meta/settings?key=${FB_WEB_KEY}`);
    const operator = TEACHERS.includes(uid) && process.env.GEMINI_KEY ? process.env.GEMINI_KEY : '';
    if (r.status === 404) {
      v = operator ? { ok: true, key: operator, who: 'operator' } : { ok: false, status: 403, reason: '선생님 설정이 아직 없어요. 선생님이 뮤지컬메이커 교사 대시보드에서 Gemini 키를 넣어야 해요.' };
    } else if (!r.ok) {
      v = { ok: false, status: 503, reason: '선생님 설정을 읽지 못했어요. 잠시 뒤 다시 해 보세요.' };
    } else {
      const f = (await r.json()).fields || {};
      const own = (f.apiKey?.stringValue || '').trim();
      // AI 켜짐 판단은 mediaOn만 봄 (classOn은 과학 앱과 함께 쓰는 값이라 보지 않음 — 2026-09-17 결정). rooms 전환 후 수업 방 열림 상태로 교체
      if (f.mediaOn?.booleanValue === false) v = { ok: false, status: 403, reason: '선생님이 지금 AI 기능을 꺼 두었어요.' };
      else if (operator) v = { ok: true, key: operator, who: 'operator' };
      else if (own) v = { ok: true, key: own, who: 'teacher' };
      else v = { ok: false, status: 403, reason: '선생님 Gemini 키가 아직 없어요. 선생님이 뮤지컬메이커 교사 대시보드에서 키를 넣어야 해요.' };
    }
  } catch { v = { ok: false, status: 503, reason: '선생님 설정을 읽지 못했어요. 인터넷 연결을 확인해 주세요.' }; }
  settingsCache.set(uid, { t: Date.now(), v });
  return v;
}

/* ── 분당 요청 수 제한 (교사 기준 — 학교는 한 반이 같은 인터넷 주소를 쓰므로 주소 기준으로 막지 않음) ── */
const buckets = new Map();
function rateOk(uid, kind, limit) {
  const k = uid + ':' + kind, now = Date.now(), lim = limit || PER_MIN[kind] || 60;
  const arr = (buckets.get(k) || []).filter(t => now - t < 60000);
  if (arr.length >= lim) { buckets.set(k, arr); return Math.ceil((60000 - (now - arr[0])) / 1000); }
  arr.push(now); buckets.set(k, arr); return 0;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (req.method === 'OPTIONS') return ORIGINS.includes(origin) ? send(req, res, 200, { ok: true }) : fail(req, res, 403, '허용되지 않은 주소예요.');
  const action = (req.query && req.query.action) || '';

  if (req.method === 'GET' && action === 'ping') {
    const dq = (req.query && req.query.demo) || '';
    const g = dq ? demoGate(dq) : await teacherGate((req.query && req.query.teacher) || '');
    return send(req, res, 200, { ok: g.ok, reason: g.ok ? '' : g.reason, demo: !!(dq && g.ok) });
  }
  if (req.method !== 'POST') return fail(req, res, 405, 'POST로 보내 주세요.');
  if (!ORIGINS.includes(origin)) return fail(req, res, 403, '허용되지 않은 주소에서 온 요청이에요.');

  let body;
  try { body = JSON.parse((await readBody(req)).toString() || '{}'); }
  catch (e) { return fail(req, res, e.tooBig ? 413 : 400, e.tooBig ? '보낸 내용이 너무 커요. 사진을 더 작게 해서 다시 올려 주세요.' : '요청 형식이 잘못됐어요.'); }

  const alias = body.model || 'text';
  const model = MODELS[alias];
  if (!model) return fail(req, res, 400, '알 수 없는 모델 종류예요: ' + alias);
  if (!Array.isArray(body.contents) || !body.contents.length) return fail(req, res, 400, '보낼 내용이 비어 있어요.');

  const demoTok = typeof body.demo === 'string' ? body.demo.slice(0, 64) : '';
  const gate = demoTok ? demoGate(demoTok) : await teacherGate(body.teacher || '');
  if (!gate.ok) return fail(req, res, gate.status, gate.reason);
  const key = gate.key;

  const kind = alias.startsWith('music') ? 'music' : alias.startsWith('image') ? 'image' : alias;
  const wait = gate.who === 'demo' ? rateOk('__demo__', kind, kind === 'music' ? Math.max(2, Math.floor(DEMO_PER_MIN / 3)) : DEMO_PER_MIN) : rateOk(body.teacher, kind);
  if (wait) return fail(req, res, 429, `요청이 몰려 있어요. ${wait}초쯤 뒤에 다시 눌러 주세요.`, { 'Retry-After': String(wait) });

  // 앱이 보낸 값 중 필요한 것만 골라 전달
  const out = { contents: body.contents };
  const gc = body.generationConfig && typeof body.generationConfig === 'object' ? { ...body.generationConfig } : {};
  if (alias === 'text') {
    gc.thinkingConfig = { thinkingBudget: 0 };                        // 규칙 6-3: 답 잘림 방지
    if (body.search) out.tools = [{ google_search: {} }];              // 규칙 6-3: 사실 조회 1단계(검색 그라운딩)
  }
  if (Object.keys(gc).length) out.generationConfig = gc;

  try {
    const r = await fetch(GEMINI + model + ':generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(out),
    });
    const text = await r.text();
    let d; try { d = JSON.parse(text); } catch { d = { error: { code: r.status, message: text.slice(0, 300) } }; }
    if (!r.ok) {
      const msg = d?.error?.message || '';
      let m = msg || ('AI 오류 ' + r.status);
      const which = gate.who === 'demo' ? '체험용 키(Vercel DEMO_KEY)' : gate.who === 'operator' ? '운영자 키(Vercel GEMINI_KEY)' : '선생님 Gemini 키(뮤지컬메이커 교사 대시보드)';
      if (r.status === 403 && /referer|referrer|blocked|API key/i.test(msg)) { m = `${which}에 웹사이트 제한이 걸려 있어 서버에서 쓸 수 없어요. 제한 없는 키로 바꿔 주세요.`; settingsCache.delete(body.teacher); }
      else if (r.status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) { m = `${which}가 올바르지 않아요. 키 값을 확인해 주세요.`; settingsCache.delete(body.teacher); }
      else if (r.status === 429 && gate.who === 'demo') m = '체험용 키의 오늘 사용 한도를 다 썼어요. 내일 다시 눌러 주세요.';
      const ra = r.headers.get('retry-after');
      return fail(req, res, r.status, m, ra ? { 'Retry-After': ra } : {});
    }
    return send(req, res, 200, d);
  } catch (e) {
    return fail(req, res, 502, 'AI 서버에 연결하지 못했어요. 잠시 뒤 다시 해 보세요.');
  }
}
