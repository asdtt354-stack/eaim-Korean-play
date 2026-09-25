/* ══════════════════════════════════════════════════════════
   EAIM 국어 — AI 중계 연결  · korean-ai.js  v1.0 (2026-09-25)
   - 국어 4개 앱(시·글쓰기·신문·게임)이 AI를 부를 때 쓰는 국어 저장소 전용 파일(공통 파일 아님).
   - 학생 화면 → api/ai (Vercel 중계 함수) → Gemini. 키는 서버에만 있고 학생 기기로 내려오지 않는다(공통규칙 6-1).
   - api/ai.js 는 음악과 eaim-play 기준본(v0.5)을 그대로 복사한 것이므로 이 저장소에서 고치지 않는다(공통규칙 4-1).
   - 모델 이름은 보내지 않고 별칭만 보낸다(공통규칙 6-2):
     글 'text'(gemini-flash-latest = 최신 Flash), 그림 'image-lite'(gemini-3.1-flash-lite-image), 음악 'music'(lyria-3-clip-preview, 30초).
   - 누구의 AI인지: 초대 링크(QR)의 교사 UID(?teacher=). 주소에 ?demo=<암호> 가 있으면 체험 키.
   ══════════════════════════════════════════════════════════ */
(function () {
  const qs = new URLSearchParams(location.search);
  const demo = (qs.get('demo') || '').slice(0, 64);
  let teacherFn = () => qs.get('teacher') || '';

  // 공통규칙 6-3: 프롬프트에 "마크다운 쓰지 말 것"을 넣고, 결과에서 한 번 더 지운다.
  const NO_MARKDOWN = '\n\n[출력 규칙] 마크다운(별표 **, #, -, ``` 등)을 쓰지 말고 평범한 문장으로만 써줘.';
  function stripMarkdown(t) {
    return String(t || '')
      .replace(/```[a-z]*\n?/gi, '')
      .replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1')
      .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1$2')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '· ')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** 중계 함수 부르기. 혼잡(500·502·503)이면 두 번까지 자동 재시도(공통규칙 6-3).
   *  돌아오는 값은 Gemini 원래 응답 모양 그대로. 실패하면 서버가 보낸 안내 문구로 오류를 던진다. */
  async function call(alias, payload, opt) {
    opt = opt || {};
    const body = Object.assign({ model: alias, teacher: teacherFn() || '' }, payload || {});
    if (demo) body.demo = demo;
    let lastErr = null, waited = 0;
    for (let i = 0; i < 3; i++) {
      let res;
      try {
        res = await fetch('api/ai', {                       // 상대 경로(공통규칙 10-1)
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
      } catch (e) { throw Object.assign(new Error('인터넷 연결을 확인해 주세요.'), { status: 0 }); }
      const data = await res.json().catch(() => ({ error: { message: 'AI 서버 응답을 읽지 못했어요.' } }));
      if (!data.error) return data;
      lastErr = Object.assign(new Error(data.error.message || 'AI 오류'), { status: res.status });
      // 음악처럼 분당 횟수 제한(429)이 걸리기 쉬운 요청은, 서버가 알려 준 시간만큼 기다렸다가 다시 보낸다(최대 3번)
      if (res.status === 429 && opt.wait429 && waited < 3) {
        const ra = Number(res.headers.get('retry-after')) || 20;
        const sec = Math.min(Math.max(ra, 5), 40);
        waited++; i--;
        if (opt.onWait) opt.onWait(sec);
        await sleep(sec * 1000);
        continue;
      }
      if (![500, 502, 503].includes(res.status) || i === 2) break;
      await sleep(1500 * (i + 1));
    }
    throw lastErr;
  }

  /** 응답에서 글만 모으기 */
  function textOf(data) {
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map((p) => p.text || '').join('');
  }

  /** 글 만들기: 프롬프트 끝에 마크다운 금지를 붙이고, 결과에서 마크다운을 지운다. */
  async function text(prompt, maxTokens = 800, temperature = 0.8) {
    const data = await call('text', {
      contents: [{ parts: [{ text: prompt + NO_MARKDOWN }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature },   // thinkingBudget:0 은 중계 함수가 넣는다
    });
    return { data, text: stripMarkdown(textOf(data)), finish: data?.candidates?.[0]?.finishReason || '' };
  }

  /** 그림 만들기 → data:image/... 주소.
   *  모델: 'image-lite' = gemini-3.1-flash-lite-image (저렴·빠름), 'image' = gemini-3.1-flash-image (고품질) — 공통규칙 6-2.
   *  화면비 설정 이름이 모델마다 달라 새 이름 → 옛 이름 → 없이 순서로 시도한다(뮤지컬메이커와 같은 방법). */
  async function image(prompt, aspect, alias) {
    const text = prompt + ' No text, letters or flags in the image.';   // 공통규칙 3번: 국기를 그리게 하지 않는다
    const cfgs = aspect
      ? [{ responseModalities: ['IMAGE'], responseFormat: { image: { aspectRatio: aspect } } },
         { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
         { responseModalities: ['IMAGE'] }]
      : [{ responseModalities: ['IMAGE'] }, null];
    let last;
    for (const gc of cfgs) {
      try {
        const payload = { contents: [{ parts: [{ text }] }] };
        if (gc) payload.generationConfig = gc;
        const data = await call(alias || 'image-lite', payload);
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const p = parts.filter((x) => (x.inlineData || x.inline_data) && !x.thought).pop();
        const inline = p && (p.inlineData || p.inline_data);
        if (!inline || !inline.data) throw new Error('그림이 만들어지지 않았어요. 설명을 조금 바꿔 다시 해 보세요.');
        return `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`;
      } catch (e) { last = e; if (e.status !== 400) throw e; }
    }
    throw last;
  }

  /** AI를 쓸 수 있는 상태인지(초대 링크의 교사 UID나 체험 암호가 있으면 true) */
  function ready() { return !!(demo || teacherFn()); }

  const NO_AI = 'AI 기능은 선생님이 준 QR·초대 링크로 들어왔을 때 쓸 수 있어요.';
  /** 실패 원인에 맞는 안내 문구 (공통규칙 6-3: "API 키를 설정하세요"라고 하지 않기) */
  function why(err, what) {
    if (!ready()) return NO_AI;
    const m = (err && err.message) || '';
    return `⚠️ ${what || 'AI 도움'} — 잘 안 됐어요. ${m || '잠시 뒤 다시 해 보세요.'}`;
  }

  /** 교사 대시보드용: 이 교사 UID로 AI가 되는지 확인 → { ok, reason } */
  async function ping(uid) {
    try {
      const u = 'api/ai?action=ping&teacher=' + encodeURIComponent(uid || '') + (demo ? '&demo=' + encodeURIComponent(demo) : '');
      const r = await fetch(u);
      return await r.json();
    } catch (e) { return { ok: false, reason: 'AI 중계 함수에 연결하지 못했어요(배포 후 확인).' }; }
  }


  /* ══════════════════════════════════════════════════════════
     🎼 리리아(Lyria) 음악 + 낭송 — 수노 대신 (2026-09-25)
     - 'music' 별칭 = lyria-3-clip-preview (30초 곡). 수노처럼 다른 사이트에 다녀올 필요가 없다.
     - 만든 음악은 이 기기(브라우저)에만 있다. 저장하려면 ⬇️ 버튼으로 내려받는다.
     - 낭송은 브라우저 음성(speechSynthesis)으로, 음악을 작게 깔고 그 위에서 읽는다.
     ══════════════════════════════════════════════════════════ */
  const GENRE_EN = {
    '발라드': 'soft ballad', '어쿠스틱': 'acoustic guitar', '피아노': 'solo piano', '국악풍': 'Korean traditional instruments (gayageum, daegeum)',
    '클래식': 'classical strings', '재즈': 'soft jazz', 'OST풍': 'cinematic film score', '자연 소리': 'gentle nature ambience',
    '인디팝': 'indie pop', '포크': 'folk', 'K-Pop': 'K-pop', '팝록': 'pop rock', '뉴스 브리핑': 'light news-briefing background',
  };
  const DEFAULT_GENRES = ['피아노', '어쿠스틱', '국악풍', '클래식', 'OST풍', '재즈', '자연 소리', '발라드'];

  function b64ToUrl(b64, mime) {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([u8], { type: mime || 'audio/mpeg' }));
  }

  /** 음악 만들기 → { url, mime, lyrics } */
  async function music(prompt, onWait) {
    const data = await call('music', { contents: [{ parts: [{ text: prompt }] }] }, { wait429: true, onWait });
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const p = parts.filter((x) => (x.inlineData || x.inline_data) && !x.thought).pop();
    const inline = p && (p.inlineData || p.inline_data);
    if (!inline || !inline.data) throw new Error('음악이 만들어지지 않았어요. 스타일을 바꿔 다시 해 보세요.');
    const mime = inline.mimeType || inline.mime_type || 'audio/mpeg';
    const lyrics = parts.filter((x) => x.text && !x.thought).map((x) => x.text).join('\n').trim();
    return { url: b64ToUrl(inline.data, mime), mime, lyrics };
  }

  /* ── 음악 위에서 낭송하기 ── */
  let reciteRun = 0;
  function koVoice() {
    const vs = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
    return vs.find((v) => /ko/i.test(v.lang)) || null;
  }
  function fade(audio, to, ms) {
    return new Promise((res) => {
      const from = audio.volume, steps = 20; let k = 0;
      const t = setInterval(() => {
        k++; audio.volume = Math.max(0, Math.min(1, from + (to - from) * (k / steps)));
        if (k >= steps) { clearInterval(t); res(); }
      }, Math.max(10, ms / steps));
    });
  }
  function speakLine(text, rate, run) {
    return new Promise((res) => {
      if (run !== reciteRun) return res();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR'; u.rate = rate; u.pitch = 0.95;
      const v = koVoice(); if (v) u.voice = v;
      u.onend = u.onerror = () => res();
      speechSynthesis.speak(u);
    });
  }
  /** audio 가 있으면 음악을 틀고(처음 몇 초는 크게, 읽을 때는 작게) 줄마다 읽은 뒤 음악을 천천히 끈다. */
  async function recite(text, audio, rate, onDone) {
    stopRecite(audio, true);
    if (!window.speechSynthesis) { alert('이 브라우저는 읽어 주기(음성)를 지원하지 않아요. 크롬을 써 보세요.'); return; }
    const run = ++reciteRun;
    const lines = String(text || '').split('\n').map((l) => l.trim());
    // 아이폰·아이패드는 버튼을 누른 순간에 음성을 한 번 켜 두어야 뒤에서도 읽는다
    try { const u0 = new SpeechSynthesisUtterance(' '); u0.volume = 0; speechSynthesis.speak(u0); } catch (e) {}
    if (audio && audio.src) {
      audio.loop = true; audio.currentTime = 0; audio.volume = 0.9;
      try { await audio.play(); } catch (e) {}
      await sleep(2500);                    // 음악 전주
      if (run !== reciteRun) return;
      await fade(audio, 0.28, 800);         // 읽는 동안은 작게
    }
    for (const line of lines) {
      if (run !== reciteRun) return;
      if (!line || /^-{3,}$/.test(line)) { await sleep(900); continue; }   // 빈 줄 = 연 사이 쉼
      await speakLine(line, rate || 0.8, run);
      await sleep(250);
    }
    if (run !== reciteRun) return;
    if (audio && audio.src) { await fade(audio, 0.9, 1200); await sleep(1500); await fade(audio, 0, 2500); audio.pause(); }
    if (onDone) onDone();
  }
  function stopRecite(audio, quiet) {
    reciteRun++;
    try { speechSynthesis.cancel(); } catch (e) {}
    if (audio && !quiet) { audio.pause(); }
  }

  /* ── 음악 만들기 + 낭송 화면 (앱마다 같은 모양으로 붙인다) ── */
  function injectCss() {
    if (document.getElementById('kai-css')) return;
    const st = document.createElement('style'); st.id = 'kai-css';
    st.textContent = `
.kai-studio{word-break:keep-all}
.kai-lbl{font-size:.8rem;font-weight:700;color:var(--ink2,#5C4A2A);margin:4px 0 8px}
.kai-chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}
.kai-chip{padding:7px 14px;border-radius:99px;font-size:.8rem;font-weight:700;cursor:pointer;border:2px solid var(--border,#E8DCC8);background:#fff;color:var(--ink2,#5C4A2A);user-select:none;font-family:inherit}
.kai-chip.on{background:var(--accent,#8B4513);border-color:var(--accent,#8B4513);color:#fff}
.kai-modes{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
.kai-mode{padding:12px 10px;border-radius:12px;border:2px solid var(--border,#E8DCC8);background:#fff;cursor:pointer;font-family:inherit;font-size:.82rem;font-weight:700;color:var(--ink2,#5C4A2A);line-height:1.5;text-align:center}
.kai-mode small{display:block;font-weight:400;font-size:.7rem;color:var(--ink3,#9C8060)}
.kai-mode.on{border-color:var(--accent,#8B4513);background:rgba(139,69,19,.07);color:var(--accent,#8B4513)}
.kai-go{width:100%;padding:14px;border:none;border-radius:12px;font-family:inherit;font-weight:900;font-size:.98rem;cursor:pointer;color:#fff;background:linear-gradient(135deg,var(--accent,#8B4513),#C8A84B)}
.kai-go:disabled{opacity:.55;cursor:wait}
.kai-status{font-size:.8rem;color:var(--ink3,#9C8060);margin-top:10px;min-height:1.2em;line-height:1.6}
.kai-status.err{color:#B91C1C}
.kai-result{margin-top:14px;padding:14px;border-radius:14px;background:linear-gradient(135deg,#1A1208,#2C1810);color:#F5E6C0}
.kai-result audio{width:100%;margin-bottom:10px}
.kai-lyrics{white-space:pre-line;font-size:.8rem;line-height:1.8;color:rgba(245,230,192,.8);margin-bottom:10px;max-height:160px;overflow:auto}
.kai-ctrl{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.kai-ctrl button,.kai-ctrl select{padding:10px 14px;border-radius:10px;border:1px solid rgba(200,168,75,.4);background:rgba(200,168,75,.15);color:#F5E6C0;font-family:inherit;font-weight:700;font-size:.82rem;cursor:pointer}
.kai-ctrl .kai-start{background:#C8A84B;color:#1A1208;border-color:#C8A84B}
.kai-note{font-size:.7rem;color:rgba(245,230,192,.55);margin-top:10px;line-height:1.7}
.kai-reading{font-size:.78rem;color:#C8A84B;margin-top:8px;min-height:1.2em}
@media (max-width:480px){.kai-modes{grid-template-columns:1fr}.kai-ctrl button,.kai-ctrl select{flex:1 1 auto}}`;
    document.head.appendChild(st);
  }
  const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /** el 안에 음악 만들기 + 낭송 화면을 그린다.
   *  opt: { file:'poetry'(내려받기 이름), readLabel:'시 낭송', getText()→읽을 글, getTitle(), getMood(),
   *         songLyrics()→노래 가사(Promise 가능), allowSong:true, genres:[...] } */
  function mountStudio(el, opt) {
    if (!el) return;
    injectCss();
    opt = opt || {};
    const genres = opt.genres || DEFAULT_GENRES;
    const picked = new Set([genres[0]]);
    let mode = 'bgm', made = null;
    el.innerHTML = `<div class="kai-studio">
      <div class="kai-lbl">🎵 음악 스타일 (여러 개 골라도 돼요)</div>
      <div class="kai-chips">${genres.map((g, i) => `<button type="button" class="kai-chip${i === 0 ? ' on' : ''}" data-g="${esc(g)}">${esc(g)}</button>`).join('')}</div>
      ${opt.allowSong === false ? '' : `<div class="kai-lbl">무엇을 만들까요?</div>
      <div class="kai-modes">
        <button type="button" class="kai-mode on" data-m="bgm">🎼 낭송용 배경음악<small>노래 없이 연주만 · 위에서 ${esc(opt.readLabel || '낭송')}</small></button>
        <button type="button" class="kai-mode" data-m="song">🎤 노래로 만들기<small>${esc(opt.songHint || '내 글이 가사가 되어 불려요')}</small></button>
      </div>`}
      <button type="button" class="kai-go">🎼 리리아로 음악 만들기 (30초)</button>
      <div class="kai-status"></div>
      <div class="kai-result" style="display:none">
        <audio controls preload="auto"></audio>
        <div class="kai-lyrics" style="display:none"></div>
        <div class="kai-ctrl">
          <button type="button" class="kai-start">🎙️ 이 음악에 맞춰 ${esc(opt.readLabel || '낭송')} 시작</button>
          <button type="button" class="kai-stop">■ 멈춤</button>
          <select class="kai-speed"><option value="0.65">🐌 천천히</option><option value="0.8" selected>🚶 보통</option><option value="1">🏃 빠르게</option></select>
          <button type="button" class="kai-dl">⬇️ 음악 저장</button>
        </div>
        <div class="kai-reading"></div>
        <div class="kai-note">리리아(Gemini)가 만든 30초 음악이에요. 낭송이 길면 음악이 이어서 반복돼요. 이 음악은 이 기기에만 있으니 필요하면 ⬇️ 저장해 두세요. AI로 만든 음악에는 눈에 안 보이는 표시(SynthID)가 들어가 있어요.</div>
      </div></div>`;
    const $ = (q) => el.querySelector(q);
    const audio = $('audio'), st = $('.kai-status'), go = $('.kai-go');
    el.querySelectorAll('.kai-chip').forEach((b) => b.onclick = () => {
      const g = b.dataset.g;
      if (picked.has(g)) { if (picked.size > 1) picked.delete(g); } else picked.add(g);
      b.classList.toggle('on', picked.has(g));
    });
    el.querySelectorAll('.kai-mode').forEach((b) => b.onclick = () => {
      mode = b.dataset.m;
      el.querySelectorAll('.kai-mode').forEach((x) => x.classList.toggle('on', x === b));
    });
    const say = (t, err) => { st.textContent = t || ''; st.classList.toggle('err', !!err); };

    go.onclick = async () => {
      if (!ready()) { say(NO_AI, true); return; }
      stopRecite(audio);
      const title = (opt.getTitle && opt.getTitle()) || '';
      const mood = (opt.getMood && opt.getMood()) || 'calm and heartfelt';
      const style = [...picked].map((g) => GENRE_EN[g] || g).join(', ');
      let prompt;
      if (mode === 'song') {
        let lyr = '';
        try { go.disabled = true; say('가사를 준비하고 있어요...'); lyr = String((opt.songLyrics ? await opt.songLyrics() : (opt.getText && opt.getText())) || '').trim(); }
        catch (e) { go.disabled = false; say(why(e, '가사 만들기'), true); return; }
        if (!lyr) { go.disabled = false; say('노래로 만들 글이 아직 없어요. 먼저 글을 써 주세요.', true); return; }
        lyr = lyr.split('\n').filter((l) => l.trim()).slice(0, 8).join('\n');   // 30초에 부를 수 있는 만큼
        prompt = `A 30-second song clip in the style of ${style}. Mood: ${mood}. Sing in Korean, clear and gentle vocals, easy for middle-school students to sing along.${title ? ` Title: ${title}.` : ''}\n\nLyrics:\n${lyr}`;
      } else {
        prompt = `Instrumental background music for reading a Korean ${opt.readWhat || 'poem'} aloud. Style: ${style}. Mood: ${mood}.${title ? ` Theme: ${title}.` : ''} Instrumental only, absolutely no vocals, no singing, no lyrics, no vocal chops. Soft background that sits under a speaking voice: gentle dynamics, simple repeating harmony, no sudden loud hits, seamless loop feel. About 70 BPM.`;
      }
      go.disabled = true; say('🎼 리리아가 음악을 만들고 있어요... (20~40초쯤 걸려요)');
      try {
        const r = await music(prompt, (sec) => say(`친구들이 동시에 많이 만들고 있어요. ${sec}초 기다렸다가 다시 보내요...`));
        if (made) URL.revokeObjectURL(made.url);
        made = r; audio.src = r.url; audio.loop = mode === 'bgm';
        $('.kai-result').style.display = 'block';
        $('.kai-start').style.display = mode === 'bgm' ? '' : 'none';
        $('.kai-speed').style.display = mode === 'bgm' ? '' : 'none';
        const ly = $('.kai-lyrics');
        if (mode === 'song' && r.lyrics) { ly.textContent = r.lyrics; ly.style.display = 'block'; } else ly.style.display = 'none';
        say(mode === 'bgm' ? '✅ 완성! 아래에서 들어 보고, 🎙️ 버튼을 누르면 음악 위에서 읽어 줘요.' : '✅ 완성! ▶ 를 눌러 들어 보세요.');
        if (opt.onMade) opt.onMade(mode);
      } catch (e) { say(why(e, '음악 만들기'), true); }
      go.disabled = false;
    };
    $('.kai-start').onclick = () => {
      const text = (opt.getText && opt.getText()) || '';
      if (!text.trim()) { say('읽을 글이 아직 없어요. 먼저 글을 써 주세요.', true); return; }
      $('.kai-reading').textContent = '🎙️ 읽는 중이에요...';
      recite(text, audio, parseFloat($('.kai-speed').value), () => { $('.kai-reading').textContent = '✨ 낭송이 끝났어요.'; });
    };
    $('.kai-stop').onclick = () => { stopRecite(audio); $('.kai-reading').textContent = ''; };
    $('.kai-dl').onclick = () => {
      if (!made) return;
      const ext = /wav/.test(made.mime) ? 'wav' : /ogg/.test(made.mime) ? 'ogg' : 'mp3';
      const a = document.createElement('a'); a.href = made.url; a.download = `${opt.file || 'eaim-korean'}-music.${ext}`; a.click();
    };
    return { stop: () => stopRecite(audio) };
  }

  window.KoreanAI = {
    call, text, image, music, recite, stopRecite, mountStudio, textOf, stripMarkdown, NO_MARKDOWN, ready, why, ping, NO_AI,
    setTeacher(fn) { if (typeof fn === 'function') teacherFn = fn; },
  };
})();
