/* ============================================================================
 * voice.js — Personal OS · Voice Mode (standalone side feature)
 * ----------------------------------------------------------------------------
 * A dedicated, immersive hands-free voice-conversation experience — a separate
 * page (#page-voice). It does NOT touch or depend on assistant.js / agent.js;
 * it only shares the window.POS data bridge and the /api/claude backend.
 *
 * Flow: tap the orb -> it listens -> auto-detects when you stop talking ->
 * transcribes -> Claude answers (with tools) -> speaks the answer ->
 * automatically listens again. A real back-and-forth conversation.
 *
 *   • Brain   — Claude tool-use loop via /api/claude
 *   • Tools   — full system access through window.POS (every function)
 *   • Voice   — getUserMedia + silence detection + /api/claude STT/TTS
 *
 * Architecture inspired by the OpenJarvis 5-primitive model (Apache-2.0,
 * reference only — no open-source code copied).
 *
 * Exposes: window.VoiceMode
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '1.0.0';
  const MODEL   = 'claude-sonnet-4-6';
  const MEM_KEY = 'pos_voice_memory';
  const ACCENT  = '#00e5ff';

  // silence-detection tuning
  const SILENCE_RMS   = 0.018;  // below this counts as quiet
  const SILENCE_MS    = 1400;   // quiet this long after speech -> stop
  const NOSPEECH_MS   = 7000;   // no speech at all this long -> give up the turn
  const MAX_TURN_MS   = 30000;  // hard cap on one recording

  // ──────────────────────────────────────────────────────────────────────
  //  MEMORY
  // ──────────────────────────────────────────────────────────────────────
  let memory = [];
  function loadMem(){ try{ memory = JSON.parse(localStorage.getItem(MEM_KEY)||'[]')||[]; }catch(e){ memory=[]; } }
  function saveMem(){ try{ localStorage.setItem(MEM_KEY, JSON.stringify(memory.slice(-24))); }catch(e){} }
  function clearMem(){ memory=[]; saveMem(); renderTranscript(); }

  // ──────────────────────────────────────────────────────────────────────
  //  CONTEXT + SYSTEM PROMPT
  // ──────────────────────────────────────────────────────────────────────
  function context(){
    try{ return (window.POS && window.POS.snapshot) ? window.POS.snapshot() : {}; }
    catch(e){ return {}; }
  }
  function systemPrompt(ctx){
    return `אתה זורו — העוזר הקולי האישי ומאמן הביצועים של רואי קליין, בהשראת JARVIS.
זו שיחה קולית רציפה — רואי מדבר אליך ואתה עונה בקול. דבר כמו בשיחה אמיתית.

חוקים לשיחה קולית:
- תשובות קצרות מאוד — משפט, אולי שניים. בלי הרצאות, בלי רשימות, בלי מרקדאון, בלי אימוג'ים.
- טבעי, חם וזורם. פנה לרואי בשמו מדי פעם.
- כשרואי מבקש משהו — בצע מיד עם הכלי המתאים ואז דווח במשפט אחד קצר.
- אם רק שאלו אותך — ענה ישר, בלי כלים.
- אל תמציא נתונים. חסר מידע? get_data. המר תאריכים יחסיים ל-YYYY-MM-DD.

תאריך: ${ctx.date||''}
משימות פתוחות: ${(ctx.openTasks||[]).map(t=>t.text).join(', ')||'אין'}
פרויקטים: ${(ctx.projects||[]).map(p=>p.name+' '+p.progress+'%').join(', ')||'אין'}`;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  TOOLS — full system access via window.POS
  // ──────────────────────────────────────────────────────────────────────
  const TOOLS = [
    { name:'add_task', description:'הוסף משימה',
      input_schema:{ type:'object', properties:{ text:{type:'string'}, proj:{type:'string'}, cat:{type:'string'} }, required:['text'] } },
    { name:'complete_task', description:'סמן משימה כבוצעה לפי טקסט',
      input_schema:{ type:'object', properties:{ query:{type:'string'} }, required:['query'] } },
    { name:'add_reminder', description:'הוסף תזכורת',
      input_schema:{ type:'object', properties:{ text:{type:'string'}, date:{type:'string'}, time:{type:'string'} }, required:['text'] } },
    { name:'add_event', description:'הוסף אירוע ליומן',
      input_schema:{ type:'object', properties:{ title:{type:'string'}, date:{type:'string'}, time:{type:'string'} }, required:['title','date'] } },
    { name:'add_habit', description:'הוסף הרגל',
      input_schema:{ type:'object', properties:{ name:{type:'string'} }, required:['name'] } },
    { name:'log_habit', description:'תעד הרגל כבוצע היום',
      input_schema:{ type:'object', properties:{ name:{type:'string'} }, required:['name'] } },
    { name:'add_note', description:'שמור פתק',
      input_schema:{ type:'object', properties:{ title:{type:'string'}, content:{type:'string'} }, required:['content'] } },
    { name:'add_goal', description:'הוסף מטרה',
      input_schema:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } },
    { name:'add_idea', description:'שמור רעיון',
      input_schema:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } },
    { name:'add_journal', description:'הוסף רשומת יומן',
      input_schema:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } },
    { name:'add_job', description:'הוסף משרה למעקב',
      input_schema:{ type:'object', properties:{ title:{type:'string'}, company:{type:'string'}, status:{type:'string'} }, required:['title'] } },
    { name:'log_meal', description:'תעד ארוחה',
      input_schema:{ type:'object', properties:{ description:{type:'string'} }, required:['description'] } },
    { name:'update_project', description:'עדכן אחוז התקדמות פרויקט',
      input_schema:{ type:'object', properties:{ id:{type:'string'}, progress:{type:'number'} }, required:['id','progress'] } },
    { name:'navigate', description:'נווט לעמוד',
      input_schema:{ type:'object', properties:{ page:{type:'string'} }, required:['page'] } },
    { name:'get_data', description:'קבל תמונת מצב עדכנית', input_schema:{ type:'object', properties:{} } }
  ];

  function execTool(name, input){
    const P = window.POS; input = input || {};
    if (!P) return 'המערכת עוד נטענת';
    try {
      switch (name) {
        case 'add_task':       return P.addTask(input);
        case 'complete_task':  return P.completeTask(input);
        case 'add_reminder':   return P.addReminder(input);
        case 'add_event':      return P.addEvent(input);
        case 'add_habit':      return P.addHabit(input);
        case 'log_habit':      return P.logHabit(input);
        case 'add_note':       return P.addNote(input);
        case 'add_goal':       return P.addGoal(input);
        case 'add_idea':       return P.addIdea(input);
        case 'add_journal':    return P.addJournal(input);
        case 'add_job':        return P.addJob(input);
        case 'log_meal':       return P.addMeal ? P.addMeal(input) : 'תיעוד ארוחות לא זמין';
        case 'update_project': return P.updateProject(input);
        case 'navigate':       return P.navigate(input.page);
        case 'get_data':       return JSON.stringify(context());
        default:               return 'כלי לא מוכר: ' + name;
      }
    } catch (e) { return 'שגיאה בכלי ' + name + ': ' + e.message; }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  BRAIN — Claude tool-use loop
  // ──────────────────────────────────────────────────────────────────────
  async function apiCall(system, messages){
    try {
      const res = await fetch('/api/claude', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 900, system, tools: TOOLS, messages })
      });
      if (!res.ok) return { _error:'api ' + res.status };
      const data = await res.json();
      if (data && data.error) return { _error: data.error.message || 'api error' };
      return data;
    } catch (e) { return { _error: e.message }; }
  }

  async function think(prompt){
    prompt = (prompt || '').trim();
    if (!prompt) return '';
    const system = systemPrompt(context());
    memory.push({ role:'user', content: prompt });
    let messages = memory.slice(-16).map(m => ({ role:m.role, content:m.content }));
    while (messages.length && messages[0].role !== 'user') messages.shift();

    let loops = 0;
    while (loops++ < 6) {
      const data = await apiCall(system, messages);
      if (data._error) { memory.pop(); return 'לא הצלחתי להתחבר כרגע. ננסה שוב.'; }
      const blocks   = Array.isArray(data.content) ? data.content : [];
      const toolUses = blocks.filter(b => b.type === 'tool_use');
      const textOut  = blocks.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (toolUses.length === 0) {
        memory.push({ role:'assistant', content: textOut });
        saveMem();
        return textOut || 'בוצע.';
      }
      messages.push({ role:'assistant', content: blocks });
      messages.push({ role:'user', content: toolUses.map(tu => ({
        type:'tool_result', tool_use_id: tu.id, content: String(execTool(tu.name, tu.input))
      })) });
    }
    saveMem();
    return 'הבקשה מורכבת מדי, ננסה לפצל.';
  }

  // ──────────────────────────────────────────────────────────────────────
  //  VOICE I/O
  // ──────────────────────────────────────────────────────────────────────
  let audioCtx = null, audioEl = null, audioUnlocked = false;
  function unlockAudio(){
    if (audioUnlocked) return;
    audioUnlocked = true;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      audioEl = new Audio();
      audioEl.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTEFNRTMuOTkuNVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
      audioEl.volume = 0;
      const p = audioEl.play();
      if (p && p.catch) p.catch(()=>{});
    } catch (e) {}
  }

  function cleanForSpeech(t){
    return (t||'')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu,'')
      .replace(/[*_`~#>|]+/g,'').replace(/\s+/g,' ').trim();
  }
  function browserSpeak(text, onDone){
    try {
      if (!window.speechSynthesis) { if(onDone) onDone(); return; }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(cleanForSpeech(text));
      const vs = window.speechSynthesis.getVoices() || [];
      const he = vs.find(v => v.lang === 'he-IL') || vs.find(v => v.lang && v.lang.startsWith('he'));
      if (he) { u.voice = he; u.lang = he.lang; } else u.lang = 'he-IL';
      u.onend = () => { if (onDone) onDone(); };
      u.onerror = () => { if (onDone) onDone(); };
      window.speechSynthesis.speak(u);
    } catch (e) { if (onDone) onDone(); }
  }
  async function speak(text, onDone){
    const clean = cleanForSpeech(text);
    if (!clean) { if (onDone) onDone(); return; }
    try {
      const res = await fetch('/api/claude', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ mode:'speak', text: clean })
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('audio')) {
        const url = URL.createObjectURL(await res.blob());
        if (!audioEl) audioEl = new Audio();
        audioEl.src = url; audioEl.volume = 1;
        audioEl.onended = () => { URL.revokeObjectURL(url); if (onDone) onDone(); };
        audioEl.onerror = () => { browserSpeak(clean, onDone); };
        const p = audioEl.play();
        if (p && p.catch) p.catch(() => browserSpeak(clean, onDone));
        return;
      }
      browserSpeak(clean, onDone);
    } catch (e) { browserSpeak(clean, onDone); }
  }

  // ── recording with silence detection ──
  let stream = null, recorder = null, recChunks = [], analyser = null, rafId = 0;
  let conversing = false, turnActive = false;

  function blobToB64(blob){
    return new Promise(resolve => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result || '').replace(/^data:[^,]*,/, ''));
      r.onerror   = () => resolve('');
      r.readAsDataURL(blob);
    });
  }

  async function ensureStream(){
    if (stream) return true;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio:true }); return true; }
    catch (e) { setStatus('אין גישה למיקרופון', 'err'); return false; }
  }

  async function listenTurn(){
    if (!conversing || turnActive) return;
    if (!(await ensureStream())) { stopConversation(); return; }
    turnActive = true;
    setState('listening');

    // analyser for silence detection + orb reactivity
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
    } catch (e) { analyser = null; }

    let mime = '';
    ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].forEach(m => {
      if (!mime && window.MediaRecorder && MediaRecorder.isTypeSupported(m)) mime = m;
    });
    try { recorder = mime ? new MediaRecorder(stream,{mimeType:mime}) : new MediaRecorder(stream); }
    catch (e) { setStatus('הקלטה לא נתמכת בדפדפן הזה','err'); stopConversation(); return; }

    recChunks = [];
    recorder.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop = onTurnRecorded;
    recorder.start();

    // monitor volume
    const buf = analyser ? new Uint8Array(analyser.fftSize) : null;
    const t0 = Date.now();
    let speechSeen = false, quietSince = 0;
    function monitor(){
      if (!turnActive || !recorder || recorder.state !== 'recording') return;
      let rms = 0;
      if (analyser && buf) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i=0;i<buf.length;i++){ const v=(buf[i]-128)/128; sum+=v*v; }
        rms = Math.sqrt(sum / buf.length);
      }
      setOrbLevel(rms);
      const now = Date.now();
      if (rms > SILENCE_RMS) { speechSeen = true; quietSince = 0; }
      else if (!quietSince) quietSince = now;

      const stopForSilence  = speechSeen && quietSince && (now - quietSince > SILENCE_MS);
      const stopForNoSpeech = !speechSeen && (now - t0 > NOSPEECH_MS);
      const stopForMax      = now - t0 > MAX_TURN_MS;
      if (stopForSilence || stopForNoSpeech || stopForMax) {
        recorder._gotSpeech = speechSeen;
        try { recorder.stop(); } catch (e) {}
        return;
      }
      rafId = requestAnimationFrame(monitor);
    }
    rafId = requestAnimationFrame(monitor);
  }

  async function onTurnRecorded(){
    if (rafId) cancelAnimationFrame(rafId);
    setOrbLevel(0);
    const gotSpeech = recorder && recorder._gotSpeech;
    const blob = new Blob(recChunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
    turnActive = false;
    if (!conversing) return;
    if (!gotSpeech || blob.size < 1400) { listenTurn(); return; } // heard nothing — listen again

    setState('thinking');
    const text = await transcribe(blob);
    if (!conversing) return;
    if (!text) { listenTurn(); return; }
    addLine('user', text);

    const reply = await think(text);
    if (!conversing) return;
    addLine('bot', reply);
    setState('speaking');
    speak(reply, () => { if (conversing) listenTurn(); else setState('idle'); });
  }

  async function transcribe(blob){
    try {
      const b64 = await blobToB64(blob);
      if (!b64) return '';
      const res = await fetch('/api/claude', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ mode:'transcribe', audio:b64, mime: blob.type||'audio/webm', language:'he' })
      });
      const data = await res.json().catch(() => ({}));
      if (data.error === 'no_key') {
        setStatus('להפעלת קול: הוסף OPENAI_API_KEY ב-Vercel', 'err');
        return '';
      }
      if (data.error) { setStatus(data.message || 'שגיאת תמלול', 'err'); return ''; }
      return (data.text || '').trim();
    } catch (e) { return ''; }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  CONVERSATION CONTROL
  // ──────────────────────────────────────────────────────────────────────
  function startConversation(){
    if (conversing) return;
    unlockAudio();
    conversing = true;
    setStatus('', '');
    addLine('sys', 'השיחה התחילה — דבר חופשי, אני מקשיב.');
    listenTurn();
  }
  function stopConversation(){
    conversing = false; turnActive = false;
    if (rafId) cancelAnimationFrame(rafId);
    try { if (recorder && recorder.state === 'recording') recorder.stop(); } catch (e) {}
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    try { if (audioEl) audioEl.pause(); } catch (e) {}
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    setOrbLevel(0);
    setState('idle');
  }
  function toggleConversation(){ conversing ? stopConversation() : startConversation(); }

  // ──────────────────────────────────────────────────────────────────────
  //  UI
  // ──────────────────────────────────────────────────────────────────────
  let rootEl, orbEl, statusEl, stateEl, transcriptEl, inputEl;
  let curState = 'idle';

  function injectStyles(){
    if (document.getElementById('voice-css')) return;
    const s = document.createElement('style');
    s.id = 'voice-css';
    s.textContent = `
#voice-root{--vac:${ACCENT};direction:rtl;color:#eaf2f8;
  background:radial-gradient(ellipse at 50% 0%,#13243a 0%,#0a0f17 60%);
  border-radius:18px;padding:24px 18px 28px;min-height:78vh;
  display:flex;flex-direction:column;align-items:center;gap:16px;
  font-family:-apple-system,Segoe UI,Rubik,Arial,sans-serif}
#voice-root h2{margin:0;font-size:17px;color:var(--vac);letter-spacing:.5px}
#voice-root .v-sub{font-size:12px;color:#8aa0b6;margin-top:-8px}
#v-orb{width:150px;height:150px;border-radius:50%;cursor:pointer;position:relative;
  background:radial-gradient(circle at 38% 32%,#fff 0%,var(--vac) 42%,#012b3a 100%);
  box-shadow:0 0 50px ${ACCENT}55,0 10px 40px rgba(0,0,0,.6);
  transition:transform .12s ease;display:flex;align-items:center;justify-content:center;
  font-size:42px;margin-top:6px}
#v-orb::after{content:'';position:absolute;inset:-10px;border-radius:50%;
  border:2px solid var(--vac);opacity:0}
#voice-root.listening #v-orb::after{animation:v-pulse 1.4s ease-out infinite;border-color:#42e695}
#voice-root.thinking  #v-orb::after{animation:v-spin 1.1s linear infinite;border-style:dashed;border-color:#ffd84d}
#voice-root.speaking  #v-orb::after{animation:v-pulse .8s ease-out infinite;border-color:var(--vac)}
@keyframes v-pulse{0%{opacity:.7;transform:scale(1)}100%{opacity:0;transform:scale(1.7)}}
@keyframes v-spin{to{transform:rotate(360deg)}}
#v-state{font-size:14px;font-weight:700;height:20px}
#v-state.listening{color:#42e695}#v-state.thinking{color:#ffd84d}#v-state.speaking{color:var(--vac)}
#v-status{font-size:12px;min-height:16px;text-align:center}
#v-status.err{color:#ff8da0}
#v-transcript{width:100%;max-width:520px;flex:1;overflow-y:auto;max-height:38vh;
  display:flex;flex-direction:column;gap:8px;padding:4px}
.v-line{padding:9px 13px;border-radius:13px;font-size:14px;line-height:1.55;max-width:88%;
  white-space:pre-wrap;word-break:break-word}
.v-line.user{background:var(--vac);color:#012;align-self:flex-start;border-bottom-right-radius:3px}
.v-line.bot{background:#1c2a3c;color:#eaf2f8;align-self:flex-end;border-bottom-left-radius:3px}
.v-line.sys{background:none;color:#8aa0b6;font-size:12px;align-self:center}
#v-row{width:100%;max-width:520px;display:flex;gap:8px}
#v-input{flex:1;background:#16202e;border:1px solid #2b3a4d;border-radius:11px;
  color:#eaf2f8;padding:11px 13px;font-size:14px;font-family:inherit;direction:rtl}
#v-input:focus{outline:none;border-color:var(--vac)}
#v-row button,#v-clear{background:#1c2a3c;border:1px solid #2b3a4d;color:#eaf2f8;
  border-radius:11px;cursor:pointer;font-size:14px;padding:0 15px;height:42px}
#v-row button:hover,#v-clear:hover{border-color:var(--vac)}
#v-clear{font-size:12px;padding:7px 14px;height:auto}
`;
    document.head.appendChild(s);
  }

  function render(){
    const host = document.getElementById('voice-root');
    if (!host) return;
    injectStyles();
    rootEl = host;
    host.innerHTML =
      '<h2>🎙 שיחה קולית — זורו</h2>' +
      '<div class="v-sub">הקש על הכדור ודבר חופשי. השיחה רציפה — אני מזהה מתי סיימת לדבר.</div>' +
      '<div id="v-orb" title="הקש כדי להתחיל / לעצור">🎙</div>' +
      '<div id="v-state"></div>' +
      '<div id="v-status"></div>' +
      '<div id="v-transcript"></div>' +
      '<div id="v-row">' +
        '<input id="v-input" placeholder="או כתוב כאן…" />' +
        '<button id="v-send">שלח</button>' +
      '</div>' +
      '<button id="v-clear">נקה שיחה</button>';

    orbEl       = host.querySelector('#v-orb');
    stateEl     = host.querySelector('#v-state');
    statusEl    = host.querySelector('#v-status');
    transcriptEl= host.querySelector('#v-transcript');
    inputEl     = host.querySelector('#v-input');

    orbEl.addEventListener('click', () => { unlockAudio(); toggleConversation(); });
    host.querySelector('#v-send').addEventListener('click', sendTyped);
    host.querySelector('#v-clear').addEventListener('click', clearMem);
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') sendTyped(); });

    renderTranscript();
    setState('idle');
  }

  async function sendTyped(){
    if (!inputEl || !inputEl.value.trim()) return;
    const v = inputEl.value.trim();
    inputEl.value = '';
    unlockAudio();
    addLine('user', v);
    setState('thinking');
    const reply = await think(v);
    addLine('bot', reply);
    setState('speaking');
    speak(reply, () => setState('idle'));
  }

  function setState(s){
    curState = s;
    if (rootEl){ rootEl.classList.remove('listening','thinking','speaking');
      if (s !== 'idle') rootEl.classList.add(s); }
    if (stateEl){
      stateEl.className = s;
      stateEl.textContent = { idle:'', listening:'מקשיב…', thinking:'חושב…', speaking:'מדבר…' }[s] || '';
    }
    if (orbEl && s === 'idle') orbEl.style.transform = 'scale(1)';
  }
  function setOrbLevel(rms){
    if (orbEl) orbEl.style.transform = 'scale(' + (1 + Math.min(0.35, rms * 3)) + ')';
  }
  function setStatus(msg, kind){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = kind === 'err' ? 'err' : '';
  }
  function renderTranscript(){
    if (!transcriptEl) return;
    transcriptEl.innerHTML = '';
    if (!memory.length) addLine('sys', 'היי רואי, אני זורו. הקש על הכדור ובוא נדבר.');
    else memory.slice(-30).forEach(m => addLine(m.role === 'user' ? 'user' : 'bot', m.content));
  }
  function addLine(kind, text){
    if (!transcriptEl) return;
    const d = document.createElement('div');
    d.className = 'v-line ' + kind;
    d.textContent = text;
    transcriptEl.appendChild(d);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PUBLIC API
  // ──────────────────────────────────────────────────────────────────────
  window.VoiceMode = {
    version: VERSION,
    render: render,
    start: startConversation,
    stop: stopConversation,
    clearMemory: clearMem
  };

  loadMem();
  // stop the mic/audio if the user navigates away from the voice page
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && conversing) stopConversation();
  });
  console.log('%cVoice Mode v' + VERSION + ' ready (standalone side feature).',
    'color:' + ACCENT + ';font-weight:bold');
})();
