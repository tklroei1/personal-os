/* ============================================================================
 * voice.js — Personal OS · Voice Mode (standalone side feature)
 * ----------------------------------------------------------------------------
 * A dedicated hands-free voice-conversation page (#page-voice). Independent of
 * assistant.js / agent.js — shares only window.POS and /api/claude.
 *
 * Speech-to-text strategy (so it works WITH NO API KEY on desktop):
 *   1. Browser Web Speech API (SpeechRecognition) — free, instant, no key.
 *      Used on desktop Chrome/Edge.
 *   2. Fallback: MediaRecorder -> /api/claude transcribe (OpenAI Whisper) —
 *      for iOS Safari, which has no SpeechRecognition. Needs OPENAI_API_KEY.
 * Text-to-speech: OpenAI neural voice if a key exists, else the free browser
 * voice. Either way Zoro always speaks.
 *
 * Architecture inspired by the OpenJarvis 5-primitive model (Apache-2.0,
 * reference only — no open-source code copied).
 *
 * Exposes: window.VoiceMode
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION = '2.0.0';
  const MODEL   = 'claude-sonnet-4-6';
  const MEM_KEY = 'pos_voice_memory';

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // MediaRecorder-fallback silence tuning (iOS path only)
  const SILENCE_RMS = 0.018, SILENCE_MS = 1400, NOSPEECH_MS = 7000, MAX_TURN_MS = 30000;

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
  //  TEXT-TO-SPEECH
  // ──────────────────────────────────────────────────────────────────────
  let audioCtx = null, audioEl = null, audioUnlocked = false, ttsApiDead = false;

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
      u.rate = 1.02;
      u.onend = () => { if (onDone) onDone(); };
      u.onerror = () => { if (onDone) onDone(); };
      window.speechSynthesis.speak(u);
    } catch (e) { if (onDone) onDone(); }
  }
  async function speak(text, onDone){
    const clean = cleanForSpeech(text);
    if (!clean) { if (onDone) onDone(); return; }
    if (ttsApiDead) { browserSpeak(clean, onDone); return; }
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
      ttsApiDead = true;            // no key / unavailable — stop trying the API
      browserSpeak(clean, onDone);
    } catch (e) { browserSpeak(clean, onDone); }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  SPEECH-TO-TEXT
  // ──────────────────────────────────────────────────────────────────────
  let conversing = false, speaking = false;

  // ── Engine A: browser SpeechRecognition (free, no key) ──
  let recog = null, recogOn = false;
  function makeRecog(){
    const r = new SR();
    r.lang = 'he-IL'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onstart  = () => { recogOn = true; if (conversing && !speaking) setState('listening'); };
    r.onend    = () => {
      recogOn = false;
      if (conversing && !speaking) setTimeout(() => {
        if (conversing && !speaking && !recogOn) startSR();
      }, 250);
    };
    r.onerror  = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setStatus('אין גישה למיקרופון — אפשר אותה בהגדרות הדפדפן', 'err');
        stopConversation();
      }
      // no-speech / aborted / network — onend restarts
    };
    r.onresult = (ev) => {
      if (speaking) return;
      let interim = '', final = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim.trim()) setStatus('🎙 ' + interim.trim(), '');
      if (final.trim()) handleUtterance(final.trim());
    };
    return r;
  }
  function startSR(){
    if (!recog) recog = makeRecog();
    if (recogOn) return;
    try { recog.start(); } catch (e) {}
  }
  function stopSR(){
    if (recog) { try { recog.stop(); } catch (e) {} }
    recogOn = false;
  }

  // ── Engine B: MediaRecorder -> /api/claude transcribe (iOS fallback) ──
  let stream = null, recorder = null, recChunks = [], analyser = null, rafId = 0, turnActive = false;
  function blobToB64(blob){
    return new Promise(resolve => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result || '').replace(/^data:[^,]*,/, ''));
      r.onerror   = () => resolve('');
      r.readAsDataURL(blob);
    });
  }
  async function recLoop(){
    if (!conversing || speaking || turnActive) return;
    if (!stream) {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio:true }); }
      catch (e) { setStatus('אין גישה למיקרופון', 'err'); stopConversation(); return; }
    }
    turnActive = true;
    setState('listening');
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser(); analyser.fftSize = 1024;
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
    recorder.onstop = onRecStop;
    recorder.start();
    const buf = analyser ? new Uint8Array(analyser.fftSize) : null;
    const t0 = Date.now();
    let speechSeen = false, quietSince = 0;
    function monitor(){
      if (!turnActive || !recorder || recorder.state !== 'recording') return;
      let rms = 0;
      if (analyser && buf) {
        analyser.getByteTimeDomainData(buf);
        let s = 0; for (let i=0;i<buf.length;i++){ const v=(buf[i]-128)/128; s+=v*v; }
        rms = Math.sqrt(s / buf.length);
      }
      const now = Date.now();
      if (rms > SILENCE_RMS) { speechSeen = true; quietSince = 0; }
      else if (!quietSince) quietSince = now;
      if ((speechSeen && quietSince && now-quietSince > SILENCE_MS) ||
          (!speechSeen && now-t0 > NOSPEECH_MS) || (now-t0 > MAX_TURN_MS)) {
        recorder._gotSpeech = speechSeen;
        try { recorder.stop(); } catch (e) {}
        return;
      }
      rafId = requestAnimationFrame(monitor);
    }
    rafId = requestAnimationFrame(monitor);
  }
  async function onRecStop(){
    if (rafId) cancelAnimationFrame(rafId);
    const gotSpeech = recorder && recorder._gotSpeech;
    const blob = new Blob(recChunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
    turnActive = false;
    if (!conversing) return;
    if (!gotSpeech || blob.size < 1400) { recLoop(); return; }
    setState('thinking');
    let text = '';
    try {
      const b64 = await blobToB64(blob);
      const res = await fetch('/api/claude', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ mode:'transcribe', audio:b64, mime:blob.type||'audio/webm', language:'he' })
      });
      const data = await res.json().catch(() => ({}));
      if (data.error === 'no_key') { setStatus('להפעלת קול באייפון: הוסף OPENAI_API_KEY ב-Vercel','err'); stopConversation(); return; }
      text = (data.text || '').trim();
    } catch (e) {}
    if (!conversing) return;
    if (!text) { recLoop(); return; }
    handleUtterance(text);
  }
  function stopRecorder(){
    turnActive = false;
    if (rafId) cancelAnimationFrame(rafId);
    try { if (recorder && recorder.state === 'recording') recorder.stop(); } catch (e) {}
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  // ── shared: one conversational turn ──
  async function handleUtterance(text){
    if (!conversing || speaking) return;
    speaking = true;                 // mute the mic while we think + speak
    if (SR) stopSR();
    setStatus('', '');
    addLine('user', text);
    setState('thinking');
    const reply = await think(text);
    if (!conversing) { speaking = false; return; }
    addLine('bot', reply);
    setState('speaking');
    speak(reply, () => {
      speaking = false;
      if (!conversing) { setState('idle'); return; }
      setState('listening');
      if (SR) startSR(); else recLoop();
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  CONVERSATION CONTROL
  // ──────────────────────────────────────────────────────────────────────
  function startConversation(){
    if (conversing) return;
    unlockAudio();
    conversing = true; speaking = false;
    setStatus('', '');
    addLine('sys', SR ? 'השיחה התחילה — דבר חופשי, אני מקשיב.'
                      : 'השיחה התחילה — דבר, אזהה לבד מתי סיימת.');
    setState('listening');
    if (SR) startSR(); else recLoop();
  }
  function stopConversation(){
    conversing = false; speaking = false;
    stopSR();
    stopRecorder();
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    try { if (audioEl) audioEl.pause(); } catch (e) {}
    setState('idle');
  }
  function toggleConversation(){ conversing ? stopConversation() : startConversation(); }

  // ──────────────────────────────────────────────────────────────────────
  //  UI — red-sun orb
  // ──────────────────────────────────────────────────────────────────────
  let rootEl, orbEl, statusEl, stateEl, transcriptEl, inputEl, floatEl;

  function injectStyles(){
    if (document.getElementById('voice-css')) return;
    const s = document.createElement('style');
    s.id = 'voice-css';
    s.textContent = `
#voice-root{direction:rtl;color:#f3ece6;
  background:radial-gradient(ellipse at 50% 0%,#2a1206 0%,#120a06 60%);
  border-radius:18px;padding:24px 18px 28px;min-height:78vh;
  display:flex;flex-direction:column;align-items:center;gap:15px;
  font-family:-apple-system,Segoe UI,Rubik,Arial,sans-serif}
#voice-root h2{margin:0;font-size:17px;color:#ff8a3d;letter-spacing:.5px}
#voice-root .v-sub{font-size:12px;color:#b89a86;margin-top:-8px;text-align:center}
/* ── the sun ── */
#v-orb{width:158px;height:158px;border-radius:50%;cursor:pointer;position:relative;
  margin-top:14px;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 38% 30%,#ffe7a0 0%,#ff9a2e 36%,#ef2b00 74%,#7a0d00 100%);
  box-shadow:0 0 60px #ff5a1e88,0 0 120px #ff2d0044,inset -10px -16px 44px #6e0b00cc;
  transition:transform .28s ease,box-shadow .28s ease}
#v-orb::before{content:'';position:absolute;inset:-30px;border-radius:50%;z-index:-1;
  background:repeating-conic-gradient(from 0deg,#ff7a1edd 0deg 6deg,transparent 6deg 17deg);
  -webkit-mask:radial-gradient(circle,transparent 58%,#000 60%,#000 82%,transparent 84%);
          mask:radial-gradient(circle,transparent 58%,#000 60%,#000 82%,transparent 84%);
  animation:v-rays 26s linear infinite;opacity:.5}
@keyframes v-rays{to{transform:rotate(360deg)}}
#v-orb .v-core{width:46px;height:46px;border-radius:50%;
  background:radial-gradient(circle,#fff 0%,#ffe1a8 55%,#ff9a3c 100%);
  box-shadow:0 0 26px #fff,0 0 50px #ffb86b}
/* active / in-action — the sun grows + the core pulses */
#voice-root.listening #v-orb,#voice-root.thinking #v-orb,#voice-root.speaking #v-orb{
  transform:scale(1.16);
  box-shadow:0 0 100px #ff5a1edd,0 0 180px #ff2d0077,inset -10px -16px 44px #6e0b00cc}
#voice-root.listening #v-orb::before{animation-duration:9s;opacity:.85}
#voice-root.thinking  #v-orb::before{animation-duration:5s;opacity:.7}
#voice-root.speaking  #v-orb::before{animation-duration:3.4s;opacity:1}
#voice-root.listening #v-orb .v-core{animation:v-core 1.05s ease-in-out infinite}
#voice-root.thinking  #v-orb .v-core{animation:v-core .85s ease-in-out infinite}
#voice-root.speaking  #v-orb .v-core{animation:v-core .5s ease-in-out infinite}
@keyframes v-core{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.5);opacity:1}}
#v-state{font-size:14px;font-weight:700;height:20px}
#v-state.listening{color:#ffb454}#v-state.thinking{color:#ffd84d}#v-state.speaking{color:#ff7a3d}
#v-status{font-size:12px;min-height:16px;text-align:center;color:#b89a86}
#v-status.err{color:#ff8da0}
#v-transcript{width:100%;max-width:520px;flex:1;overflow-y:auto;max-height:36vh;
  display:flex;flex-direction:column;gap:8px;padding:4px}
.v-line{padding:9px 13px;border-radius:13px;font-size:14px;line-height:1.55;max-width:88%;
  white-space:pre-wrap;word-break:break-word}
.v-line.user{background:#ff8a3d;color:#2a1000;align-self:flex-start;border-bottom-right-radius:3px}
.v-line.bot{background:#2c1d12;color:#f3ece6;align-self:flex-end;border-bottom-left-radius:3px}
.v-line.sys{background:none;color:#b89a86;font-size:12px;align-self:center}
#v-row{width:100%;max-width:520px;display:flex;gap:8px}
#v-input{flex:1;background:#241509;border:1px solid #4a3120;border-radius:11px;
  color:#f3ece6;padding:11px 13px;font-size:14px;font-family:inherit;direction:rtl}
#v-input:focus{outline:none;border-color:#ff8a3d}
#v-row button,#v-clear{background:#2c1d12;border:1px solid #4a3120;color:#f3ece6;
  border-radius:11px;cursor:pointer;font-size:14px;padding:0 15px;height:42px}
#v-row button:hover,#v-clear:hover{border-color:#ff8a3d}
#v-clear{font-size:12px;padding:7px 14px;height:auto}
/* ── floating red-sun orb — appears on every page ── */
#v-float{position:fixed;left:24px;bottom:104px;z-index:999998;width:56px;height:56px;
  border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 38% 30%,#ffe7a0 0%,#ff9a2e 36%,#ef2b00 74%,#7a0d00 100%);
  box-shadow:0 0 24px #ff5a1eaa,0 6px 20px rgba(0,0,0,.5);transition:transform .2s}
#v-float:hover{transform:scale(1.1)}
#v-float .v-core{width:16px;height:16px}
#v-float::before{content:'';position:absolute;inset:-9px;border-radius:50%;z-index:-1;
  background:repeating-conic-gradient(from 0deg,#ff7a1edd 0deg 7deg,transparent 7deg 21deg);
  -webkit-mask:radial-gradient(circle,transparent 56%,#000 58%,#000 84%,transparent 86%);
          mask:radial-gradient(circle,transparent 56%,#000 58%,#000 84%,transparent 86%);
  animation:v-rays 24s linear infinite;opacity:.6}
#v-float.active{box-shadow:0 0 42px #ff5a1e,0 6px 20px rgba(0,0,0,.5)}
#v-float.active::before{animation-duration:7s;opacity:.95}
#v-float.active .v-core{animation:v-core 1s ease-in-out infinite}
`;
    document.head.appendChild(s);
  }

  function buildFloatingOrb(){
    if (document.getElementById('v-float')) return;
    const f = document.createElement('div');
    f.id = 'v-float';
    f.title = 'שיחה קולית עם זורו';
    f.innerHTML = '<div class="v-core"></div>';
    f.addEventListener('click', () => {
      unlockAudio();
      try { if (window.goPage) window.goPage('voice'); } catch (e) {}
      setTimeout(() => { if (!conversing) startConversation(); }, 180);
    });
    document.body.appendChild(f);
    floatEl = f;
  }

  function render(){
    const host = document.getElementById('voice-root');
    if (!host) return;
    injectStyles();
    rootEl = host;
    host.innerHTML =
      '<h2>🔆 שיחה קולית — זורו</h2>' +
      '<div class="v-sub">הקש על השמש ודבר חופשי. השיחה רציפה — אני מזהה מתי סיימת לדבר.</div>' +
      '<div id="v-orb" title="הקש כדי להתחיל / לעצור"><div class="v-core"></div></div>' +
      '<div id="v-state"></div>' +
      '<div id="v-status"></div>' +
      '<div id="v-transcript"></div>' +
      '<div id="v-row">' +
        '<input id="v-input" placeholder="או כתוב כאן…" />' +
        '<button id="v-send">שלח</button>' +
      '</div>' +
      '<button id="v-clear">נקה שיחה</button>';

    orbEl        = host.querySelector('#v-orb');
    stateEl      = host.querySelector('#v-state');
    statusEl     = host.querySelector('#v-status');
    transcriptEl = host.querySelector('#v-transcript');
    inputEl      = host.querySelector('#v-input');

    orbEl.addEventListener('click', () => { unlockAudio(); toggleConversation(); });
    host.querySelector('#v-send').addEventListener('click', sendTyped);
    host.querySelector('#v-clear').addEventListener('click', clearMem);
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') sendTyped(); });

    renderTranscript();
    setState(conversing ? 'listening' : 'idle');
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
    speak(reply, () => setState(conversing ? 'listening' : 'idle'));
  }

  function setState(s){
    if (rootEl){
      rootEl.classList.remove('listening','thinking','speaking');
      if (s !== 'idle') rootEl.classList.add(s);
    }
    if (stateEl){
      stateEl.className = s;
      stateEl.textContent = { idle:'', listening:'מקשיב…', thinking:'חושב…', speaking:'מדבר…' }[s] || '';
    }
    if (floatEl) floatEl.classList.toggle('active', conversing);
  }
  function setStatus(msg, kind){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = kind === 'err' ? 'err' : '';
  }
  function renderTranscript(){
    if (!transcriptEl) return;
    transcriptEl.innerHTML = '';
    if (!memory.length) addLine('sys', 'היי רואי, אני זורו. הקש על השמש ובוא נדבר.');
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
  injectStyles();      // make voice styles available app-wide (for the floating orb)
  buildFloatingOrb();  // a red-sun orb on every page
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && conversing) stopConversation();
  });
  console.log('%cVoice Mode v' + VERSION + ' ready — STT engine: ' +
    (SR ? 'browser SpeechRecognition (no key needed)' : 'MediaRecorder + API'),
    'color:#ff8a3d;font-weight:bold');
})();
