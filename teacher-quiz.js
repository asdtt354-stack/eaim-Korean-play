/* ══════════════════════════════════════════════════════════
   EAIM 국어 — 선생님용 AI 문제 세트  · teacher-quiz.js  v1.0 (2026-09-25)
   - 어휘 게임방(eaim-korean-game.html)에 붙는 국어 전용 파일.
   - 흐름: 선생님이 교사 대시보드에서 분류·문제 수·문제 모양을 고름 → AI가 한 번에 문제를 만듦
           → 선생님이 읽고 고치거나 빼거나 다시 만듦 → 저장 → "수업에 내기" 또는 "세트 링크"로 학생이 풂.
   - AI가 맡는 것은 문제 글(예문·상황)뿐이다. 정답 어휘와 뜻은 vocab-data.js 의 확인된 목록에서만,
     보기(오답 3개)는 같은 분류 목록에서 코드가 고른다(공통규칙 3번 — AI가 뜻이나 정답을 지어내지 않게).
   - AI는 교사만 누른다(공통규칙 6-5). 호출은 세트 하나에 한 번(분당 제한·비용).
   - 저장 위치: teachers/{uid}/meta/koreanQuizSets 문서 하나 { sets:[...], activeId } (국어 부록 6-2).
     rooms 방식으로 옮길 때 함께 옮긴다.
   - 이 파일은 게임방의 전역 값(db, teacherUid, currentUser, isStudentMode, TERMS, startGame …)을 쓴다.
   ══════════════════════════════════════════════════════════ */
(function () {
  const CAT_NAME = { '관용어': '관용어', '한자': '한자성어', '순우리말': '순우리말', '문학': '문학어휘', '맞춤법': '맞춤법' };
  const MAX_SETS = 30;
  const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const core = (w) => String(w || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '');
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const qsRef = (uid) => db.collection('teachers').doc(uid).collection('meta').doc('koreanQuizSets');

  let data = { sets: [], activeId: '' };   // 교사 화면에서 불러온 저장본
  let draft = null;                          // 만들고 있는 세트 { cat, type, items:[...] }
  window.currentSet = null;                  // 게임에서 풀고 있는 세트

  /* ── 화면(교사용 전체 화면) ── */
  const css = document.createElement('style');
  css.textContent = `
#qsPage{position:fixed;inset:0;z-index:210;background:var(--bg,#0F0A1A);overflow:auto;display:none;word-break:keep-all}
.qs-wrap{max-width:760px;margin:0 auto;padding:18px 16px 60px;color:#fff}
.qs-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:16px}
.qs-top h2{font-size:1.15rem}
.qs-box{background:var(--card,#1A1030);border:2px solid rgba(255,255,255,.07);border-radius:16px;padding:16px;margin-bottom:14px}
.qs-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.qs-row label{font-size:.78rem;color:rgba(255,255,255,.6);min-width:64px}
.qs-row select,.qs-row input{flex:1;min-width:120px;background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.12);color:#fff;border-radius:10px;padding:9px 10px;font-family:inherit;font-size:.88rem}
.qs-row select option{color:#000}
.qs-note{font-size:.74rem;color:rgba(255,255,255,.5);line-height:1.7}
.qs-st{font-size:.82rem;margin-top:10px;min-height:1.2em;line-height:1.6}
.qs-st.err{color:#FF9A9A}
.qs-item{background:var(--card2,#221540);border-radius:12px;padding:12px;margin-bottom:10px;border:1.5px solid transparent}
.qs-item.bad{border-color:rgba(255,154,154,.5)}
.qs-item .hd{display:flex;justify-content:space-between;gap:8px;font-size:.74rem;color:rgba(255,255,255,.55);margin-bottom:6px}
.qs-item textarea{width:100%;min-height:64px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;padding:8px 10px;font-family:inherit;font-size:.9rem;line-height:1.6;resize:vertical}
.qs-ans{font-size:.84rem;margin-top:6px}
.qs-ans b{color:#8EF0B8}
.qs-opts{font-size:.78rem;color:rgba(255,255,255,.6);margin-top:3px}
.qs-mini{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.qs-set{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;background:var(--card2,#221540);border-radius:12px;padding:12px;margin-bottom:8px}
.qs-set .t{font-weight:800}
.qs-set .m{font-size:.74rem;color:rgba(255,255,255,.5)}
.qs-on{color:#8EF0B8;font-size:.74rem;font-weight:800}
#qsQr{background:#fff;border-radius:10px;padding:10px;display:inline-block;margin-top:8px}
.tset-card{background:linear-gradient(135deg,rgba(123,108,246,.25),rgba(56,189,248,.15));border:2px solid rgba(123,108,246,.45);border-radius:16px;padding:16px;margin-bottom:14px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.tset-card .t{font-weight:900}.tset-card .m{font-size:.76rem;color:rgba(255,255,255,.6);margin-top:3px}`;
  document.head.appendChild(css);

  const page = document.createElement('div');
  page.id = 'qsPage';
  page.innerHTML = `<div class="qs-wrap">
    <div class="qs-top"><h2>🤖 AI 문제 세트</h2><button class="btn bg2 bsm" onclick="closeQuizSets()">← 대시보드</button></div>
    <div class="qs-box">
      <div class="qs-row"><label>분류</label><select id="qsCat"></select></div>
      <div class="qs-row"><label>문제 수</label><select id="qsCount"><option>10</option><option selected>15</option><option>20</option></select></div>
      <div class="qs-row"><label>문제 모양</label><select id="qsType">
        <option value="mix">섞어서 (예문 빈칸 + 상황 이야기)</option>
        <option value="blank">예문 빈칸 — "___"에 들어갈 말 고르기</option>
        <option value="story">상황 이야기 — 이럴 때 쓰는 말 고르기</option></select></div>
      <button class="btn bvio bfl" id="qsMake" onclick="qsMakeDraft()">🤖 AI로 문제 만들기</button>
      <div class="qs-st" id="qsSt"></div>
      <div class="qs-note">AI는 문제 글만 써요. 정답과 뜻은 게임방의 확인된 어휘 목록에서, 보기 3개는 같은 분류에서 골라요. 저장하기 전에 꼭 한 번 읽어 봐 주세요.</div>
    </div>
    <div id="qsDraft"></div>
    <div class="qs-box"><div style="font-weight:800;margin-bottom:10px">💾 저장한 세트</div><div id="qsSaved"></div><div id="qsLinkBox"></div></div>
  </div>`;
  const mount = () => { if (!page.isConnected && document.body) document.body.appendChild(page); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();

  /* ── 교사: 열기·닫기 ── */
  window.openQuizSets = async function () {
    if (!teacherUid || !currentUser) return;
    document.getElementById('teacherPanel').style.display = 'none';
    page.style.display = 'block';
    const sel = document.getElementById('qsCat');
    sel.innerHTML = Object.keys(TERMS).map((c) => `<option value="${c}">${CAT_NAME[c] || c} (${TERMS[c].length}개)</option>`).join('');
    await loadSets();
    renderDraft(); renderSaved();
  };
  window.closeQuizSets = function () { page.style.display = 'none'; enterTeacherDashboard(); };

  async function loadSets() {
    try {
      const snap = await qsRef(teacherUid).get();
      data = snap.exists ? Object.assign({ sets: [], activeId: '' }, snap.data()) : { sets: [], activeId: '' };
    } catch (e) { say('저장한 세트를 불러오지 못했어요: ' + e.message, true); }
  }
  async function saveSets() {
    await qsRef(teacherUid).set({ sets: data.sets, activeId: data.activeId || '', platform: 'korean', updatedAt: new Date().toISOString() });
  }
  function say(t, err) { const el = document.getElementById('qsSt'); if (el) { el.textContent = t || ''; el.classList.toggle('err', !!err); } }

  /* ── 보기 고르기: 같은 분류에서 정답과 다른 것 3개 ── */
  function pickOpts(cat, w) {
    const m = (TERMS[cat].find((t) => t.w === w) || {}).m;
    return shuffle(TERMS[cat].filter((t) => t.w !== w && t.m !== m)).slice(0, 3).map((t) => t.w);
  }

  /* ── AI에게 문제 글 받기 ── */
  function buildPrompt(cat, words, type) {
    const spelling = cat === '맞춤법';
    const kinds = spelling ? '모든 문제를 "빈칸"으로' :
      type === 'blank' ? '모든 문제를 "빈칸"으로' : type === 'story' ? '모든 문제를 "상황"으로' : '"빈칸"과 "상황"을 반쯤씩 섞어서';
    return `너는 중학교 국어 선생님을 돕는다. 아래 [${CAT_NAME[cat] || cat}] 목록의 어휘마다 퀴즈 문제 글을 1개씩 써라. ${kinds} 만든다.
- 빈칸: 그 어휘가 들어갈 자리를 ___ 로 비운 자연스러운 예문 1~2문장. ___ 에는 그 어휘만 들어가야 자연스럽다.${spelling ? ' 맞춤법 문제이므로 헷갈리는 짝이 되는 말(예: 맞히다/맞추다)을 넣으면 틀린 문장이 되게 쓴다.' : ''}
- 상황: 그 어휘가 딱 맞는 중학생 생활 이야기 2~3문장을 쓰고 "이럴 때 알맞은 말은?"으로 끝낸다.
- 어휘의 뜻은 목록에 적힌 뜻을 따르고, 목록에 없는 뜻을 지어내지 않는다.
- 문제 글에 정답 어휘를 그대로 쓰지 않는다. 실제 사람 이름은 쓰지 않는다(지어낸 이름은 된다). 폭력·차별·놀림이 되는 내용은 쓰지 않는다.
- 결과는 JSON만: {"items":[{"w":"목록의 어휘를 그대로","type":"빈칸 또는 상황","q":"문제 글"}]}
[목록]
${words.map((t, i) => `${i + 1}. ${t.w} — ${t.m}`).join('\n')}`;
  }
  async function askAI(cat, words, type) {
    const res = await KoreanAI.call('text', {
      contents: [{ parts: [{ text: buildPrompt(cat, words, type) }] }],
      generationConfig: { maxOutputTokens: 6000, temperature: 0.9, responseMimeType: 'application/json' },
    });
    let txt = KoreanAI.textOf(res).replace(/```json|```/g, '').trim();
    let out; try { out = JSON.parse(txt); } catch (e) { throw new Error('AI 답을 문제 모양으로 읽지 못했어요. 한 번 더 눌러 주세요.'); }
    return (out.items || out || []);
  }
  function checkItem(cat, it) {
    const t = TERMS[cat].find((x) => x.w === it.w);
    if (!t) return null;
    let q = String(it.q || '').replace(/_{2,}/g, '___').trim();
    const type = /상황/.test(it.type || '') ? '상황' : '빈칸';
    const problems = [];
    if (q.length < 8) problems.push('문제 글이 너무 짧아요');
    if (type === '빈칸' && !q.includes('___')) problems.push('빈칸(___)이 없어요');
    const c = core(t.w);
    if (c.length >= 2 && q.replace(/\s+/g, '').includes(c)) problems.push('문제 글에 정답이 들어 있어요');
    return { w: t.w, m: t.m, type, q, opts: pickOpts(cat, t.w), warn: problems.join(' · ') };
  }

  window.qsMakeDraft = async function () {
    if (!KoreanAI.ready()) { say(KoreanAI.NO_AI, true); return; }
    const cat = document.getElementById('qsCat').value;
    const n = Number(document.getElementById('qsCount').value);
    const type = document.getElementById('qsType').value;
    const words = shuffle(TERMS[cat]).slice(0, n);
    const btn = document.getElementById('qsMake'); btn.disabled = true;
    say(`🤖 ${CAT_NAME[cat]} ${n}문제를 만들고 있어요... (20~40초)`);
    try {
      const raw = await askAI(cat, words, type);
      const items = raw.map((it) => checkItem(cat, it)).filter(Boolean);
      const got = new Set(items.map((i) => i.w));
      words.filter((t) => !got.has(t.w)).forEach((t) => items.push({ w: t.w, m: t.m, type: '빈칸', q: '', opts: pickOpts(cat, t.w), warn: 'AI가 이 어휘 문제를 만들지 않았어요 — 🔄 다시 만들기' }));
      draft = { cat, type, items, title: `${CAT_NAME[cat]} ${new Date().toLocaleDateString('ko-KR')}` };
      const bad = items.filter((i) => i.warn).length;
      say(`✅ ${items.length}문제를 만들었어요.${bad ? ` 빨간 테두리 ${bad}개는 확인이 필요해요.` : ''} 읽어 보고 저장해 주세요.`);
    } catch (e) { say(KoreanAI.why(e, '문제 만들기'), true); }
    btn.disabled = false; renderDraft();
  };

  window.qsRegenOne = async function (i) {
    const it = draft.items[i]; const t = TERMS[draft.cat].find((x) => x.w === it.w);
    it.warn = '🤖 다시 만드는 중...'; renderDraft();
    try {
      const raw = await askAI(draft.cat, [t], draft.type);
      const c = checkItem(draft.cat, raw[0] || {});
      if (c) { c.opts = it.opts; draft.items[i] = c; } else it.warn = 'AI 답이 알맞지 않아요. 다시 눌러 주세요.';
    } catch (e) { it.warn = KoreanAI.why(e, '다시 만들기'); }
    renderDraft();
  };
  window.qsEdit = function (i, v) {
    const it = draft.items[i]; it.q = v;
    const c = core(it.w);
    it.warn = [it.q.trim().length < 8 ? '문제 글이 너무 짧아요' : '', it.type === '빈칸' && !it.q.includes('___') ? '빈칸(___)이 없어요' : '',
      c.length >= 2 && it.q.replace(/\s+/g, '').includes(c) ? '문제 글에 정답이 들어 있어요' : ''].filter(Boolean).join(' · ');
    const box = document.getElementById('qsItem' + i);
    if (box) { box.classList.toggle('bad', !!it.warn); box.querySelector('.warn').textContent = it.warn ? '⚠️ ' + it.warn : ''; }
  };
  window.qsDel = function (i) { draft.items.splice(i, 1); renderDraft(); };
  window.qsReopts = function (i) { draft.items[i].opts = pickOpts(draft.cat, draft.items[i].w); renderDraft(); };

  function renderDraft() {
    const el = document.getElementById('qsDraft'); if (!el) return;
    if (!draft) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="qs-box">
      <div class="qs-row"><label>세트 이름</label><input id="qsTitle" value="${esc(draft.title)}" oninput="qsTitleIn(this.value)"></div>
      <div class="qs-note" style="margin-bottom:10px">문제 글은 바로 고칠 수 있어요. 빈칸은 밑줄 세 개(___)로 적어요.</div>
      ${draft.items.map((it, i) => `<div class="qs-item${it.warn ? ' bad' : ''}" id="qsItem${i}">
        <div class="hd"><span>${i + 1}. ${it.type === '상황' ? '상황 이야기' : '예문 빈칸'}</span><span class="warn" style="color:#FF9A9A">${it.warn ? '⚠️ ' + esc(it.warn) : ''}</span></div>
        <textarea oninput="qsEdit(${i}, this.value)">${esc(it.q)}</textarea>
        <div class="qs-ans">정답: <b>${esc(it.w)}</b> — ${esc(it.m)}</div>
        <div class="qs-opts">보기: ${it.opts.map(esc).join(' · ')}</div>
        <div class="qs-mini"><button class="btn bg2 bsm" onclick="qsRegenOne(${i})">🔄 AI로 다시</button><button class="btn bg2 bsm" onclick="qsReopts(${i})">🔀 보기 바꾸기</button><button class="btn bg2 bsm" onclick="qsDel(${i})">🗑 빼기</button></div>
      </div>`).join('')}
      <button class="btn bvio bfl" onclick="qsSave()">💾 이 세트 저장 (${draft.items.length}문제)</button>
    </div>`;
  }
  window.qsTitleIn = function (v) { if (draft) draft.title = v; };

  window.qsSave = async function () {
    const items = draft.items.filter((i) => i.q.trim());
    const bad = items.filter((i) => i.warn);
    if (!items.length) { say('저장할 문제가 없어요.', true); return; }
    if (bad.length && !confirm(`확인이 필요한 문제가 ${bad.length}개 있어요. 그래도 저장할까요?`)) return;
    const set = { id: 's' + Date.now().toString(36), title: (draft.title || '').trim() || CAT_NAME[draft.cat], cat: draft.cat,
      createdAt: new Date().toISOString(), items: items.map(({ w, m, type, q, opts }) => ({ w, m, type, q, opts })) };
    data.sets = [set].concat(data.sets || []).slice(0, MAX_SETS);
    try { await saveSets(); draft = null; renderDraft(); renderSaved(); say(`💾 "${set.title}" 저장했어요. 아래에서 수업에 내거나 링크를 나눠 주세요.`); }
    catch (e) { data.sets.shift(); say('저장하지 못했어요: ' + e.message + ' (Firestore 보안 규칙이 이 문서를 막고 있을 수 있어요)', true); }
  };

  function setLink(id) { return `${location.origin}${location.pathname}?teacher=${teacherUid}&set=${id}`; }
  function renderSaved() {
    const el = document.getElementById('qsSaved'); if (!el) return;
    if (!data.sets || !data.sets.length) { el.innerHTML = '<div class="qs-note">아직 저장한 세트가 없어요.</div>'; return; }
    el.innerHTML = data.sets.map((s) => `<div class="qs-set">
      <div><div class="t">${esc(s.title)} ${data.activeId === s.id ? '<span class="qs-on">● 수업에 내는 중</span>' : ''}</div>
        <div class="m">${CAT_NAME[s.cat] || s.cat} · ${s.items.length}문제 · ${new Date(s.createdAt).toLocaleDateString('ko-KR')}</div></div>
      <div class="qs-mini" style="margin:0">
        <button class="btn bg2 bsm" onclick="qsPlay('${s.id}')">▶ 해 보기</button>
        <button class="btn bg2 bsm" onclick="qsActive('${s.id}')">${data.activeId === s.id ? '수업에서 내리기' : '🎯 수업에 내기'}</button>
        <button class="btn bg2 bsm" onclick="qsLink('${s.id}')">🔗 링크·QR</button>
        <button class="btn bg2 bsm" onclick="qsRemove('${s.id}')">🗑</button></div></div>`).join('');
  }
  window.qsActive = async function (id) {
    const before = data.activeId; data.activeId = data.activeId === id ? '' : id;
    try { await saveSets(); } catch (e) { data.activeId = before; say('바꾸지 못했어요: ' + e.message, true); }
    renderSaved();
  };
  window.qsRemove = async function (id) {
    if (!confirm('이 세트를 지울까요?')) return;
    const keep = data.sets; data.sets = data.sets.filter((s) => s.id !== id); if (data.activeId === id) data.activeId = '';
    try { await saveSets(); } catch (e) { data.sets = keep; say('지우지 못했어요: ' + e.message, true); }
    renderSaved(); document.getElementById('qsLinkBox').innerHTML = '';
  };
  window.qsLink = function (id) {
    const url = setLink(id), box = document.getElementById('qsLinkBox');
    box.innerHTML = `<div class="qs-note" style="margin-top:10px">이 링크는 누구나 로그인 없이 이 세트만 풀 수 있어요(기록은 남지 않음). 수업 기록이 필요하면 "🎯 수업에 내기"를 쓰세요.</div>
      <div style="font-size:.72rem;word-break:break-all;background:rgba(255,255,255,.06);border-radius:8px;padding:8px;margin-top:6px">${esc(url)}</div>
      <button class="btn bg2 bsm" style="margin-top:6px" onclick="navigator.clipboard.writeText('${url}').then(()=>alert('링크를 복사했어요'))">📋 링크 복사</button>
      <div><div id="qsQr"></div></div>`;
    try { new QRCode(document.getElementById('qsQr'), { text: url, width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M }); } catch (e) {}
  };
  window.qsPlay = function (id) {
    const s = data.sets.find((x) => x.id === id); if (!s) return;
    page.style.display = 'none';
    window.currentSet = s; showSetCard();
    goGameAsTeacher(); startGame('tset');
  };

  /* ── 학생·공개 화면: 세트 불러와 로비에 카드 보이기 ── */
  window.qsOnEnter = async function () {
    const q = new URLSearchParams(location.search);
    const uid = q.get('teacher'), wantId = q.get('set');
    if (!uid || !db || (!isStudentMode && !wantId)) { window.currentSet = null; showSetCard(); return; }
    try {
      const snap = await qsRef(uid).get();
      const d = snap.exists ? snap.data() : {};
      const id = wantId || (isStudentMode ? d.activeId : '');
      window.currentSet = (d.sets || []).find((s) => s.id === id) || null;
    } catch (e) { window.currentSet = null; }
    showSetCard();
  };
  function showSetCard() {
    const el = document.getElementById('tsetCard'); if (!el) return;
    const s = window.currentSet;
    el.innerHTML = s ? `<div class="tset-card"><div><div class="t">📝 선생님 문제: ${esc(s.title)}</div>
      <div class="m">${CAT_NAME[s.cat] || s.cat} · ${s.items.length}문제 · 선생님이 확인한 문제예요</div></div>
      <button class="btn bvio" onclick="startGame('tset')">풀어 보기 →</button></div>` : '';
  }
  window.showSetCard = showSetCard;

  /* ── 게임: 선생님 문제 한 개 보여 주기 ── */
  window.showTSet = function () {
    const s = window.currentSet, it = s.items[gameState.current - 1];
    const choices = shuffle([it.w].concat(it.opts || []));
    gameState.tsetAns = it;
    document.getElementById('game-content').innerHTML = `
      <div class="q-card"><div class="q-label">📝 ${it.type === '상황' ? '이럴 때 알맞은 말은?' : '___ 에 알맞은 말은?'}</div>
      <div class="q-text" style="font-size:1rem;line-height:1.8;text-align:left">${esc(it.q).replace(/___/g, '<u>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</u>')}</div></div>
      <div class="choices">${choices.map((c, i) => `<button class="choice-btn" data-w="${esc(c)}" onclick="checkTSet(this)">${['①', '②', '③', '④'][i]} ${esc(c)}</button>`).join('')}</div>`;
  };
  window.checkTSet = function (btn) {
    const it = gameState.tsetAns, ok = btn.dataset.w === it.w;
    document.querySelectorAll('.choice-btn').forEach((b) => { b.disabled = true; if (b.dataset.w === it.w) b.classList.add('correct'); });
    if (!ok) btn.classList.add('wrong');
    showFB(ok, { w: it.w, m: it.m });
    setTimeout(() => nextQ(), 2200);
  };
})();
