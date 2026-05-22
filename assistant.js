/* ============================================================================
 * assistant.js — Personal OS · clean assistant ("Zoro" rebuilt)
 * ----------------------------------------------------------------------------
 * A fresh, single-purpose conversational assistant that replaces the legacy
 * jarvis.js. Vanilla JS, no build, no framework.
 *
 *   • Brain   — Claude tool-use loop via /api/claude (Claude stays the brain)
 *   • Tools   — executes through window.POS (the app's data bridge)
 *   • Voice   — real STT/TTS via /api/transcribe + /api/speak (works on iOS;
 *               falls back to the browser voice if no OPENAI_API_KEY)
 *   • HUD     — clean high-contrast orb + chat panel
 *
 * Architecture inspired by the OpenJarvis 5-primitive model (Apache-2.0,
 * reference only — no open-source code copied).
 *
 * Exposes: window.Assistant
 * ========================================================================== */
(function () {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────
  //  0. CONFIG
  // ──────────────────────────────────────────────────────────────────────
  const VERSION   = '6.0.0';
  const MODEL     = 'claude-sonnet-4-6';
  const MEM_KEY   = 'pos_assistant_memory';
  const ACCENT    = '#00d4ff';
  const MAX_REC_MS = 60000; // cap a voice recording at 60s

  // ──────────────────────────────────────────────────────────────────────
  //  1. MEMORY
  // ──────────────────────────────────────────────────────────────────────
  let memory = [];
  function loadMemory() {
    try { memory = JSON.parse(localStorage.getItem(MEM_KEY) || '[]') || []; }
    catch (e) { memory = []; }
  }
  function saveMemory() {
    try { localStorage.setItem(MEM_KEY, JSON.stringify(memory.slice(-24))); } catch (e) {}
  }
  function clearMemory() { memory = []; saveMemory(); renderThread(); }

  // ──────────────────────────────────────────────────────────────────────
  //  2. CONTEXT — snapshot of the app state for the model
  // ──────────────────────────────────────────────────────────────────────
  function context() {
    try { return (window.POS && window.POS.snapshot) ? window.POS.snapshot() : {}; }
    catch (e) { return {}; }
  }

  function systemPrompt(ctx) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('he-IL', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const timeStr = now.toLocaleTimeString('he-IL', { hour:'2-digit', minute:'2-digit' });
    const iso = now.toISOString().split('T')[0];
    return `אתה זורו — העוזר האישי ומאמן הביצועים של רואי קליין, בהשראת JARVIS של איירון מן.
אופי: רגוע, חד, חם וישיר. מכיר את רואי, דוחף אותו קדימה בעדינות וחוגג איתו הצלחות.

אתה עוזר קולי אמיתי — רואי מדבר אליך במיקרופון ואתה עונה לו בקול. אתה גם שומע וגם מדבר.

עכשיו: ${dateStr}, השעה ${timeStr}. היום ISO: ${iso}.
דיוק זמנים: "בעוד X שעות/דקות" — חשב מהשעה הנוכחית (${timeStr}). "מחר" — יום אחרי ${iso}. תמיד המר ל-YYYY-MM-DD מדויק, ואמור את השעה/תאריך שחישבת.
איפה דברים נשמרים: אירועים → הלוז השבועי, משימות → עמוד המשימות, תזכורות → עמוד התזכורות. אם רואי לא מוצא משהו — השתמש ב-navigate. לעולם אל תגיד "אני לא יודע איך האפליקציה בנויה".

סגנון:
- דבר טבעי וזורם כמו בשיחה. בלי אימוג'ים, בלי כוכביות, בלי מרקדאון.
- קצר וענייני — משפט עד שניים. בלי הרצאות.
- עברית טבעית. פנה לרואי בשמו מדי פעם.

משימות פתוחות: ${(ctx.openTasks || []).map(t => t.text).join(', ') || 'אין'}
אירועים קרובים: ${(ctx.upcomingEvents || []).map(e => e.date + ' ' + e.text).join(', ') || 'אין'}
פרויקטים: ${(ctx.projects || []).map(p => p.name + ' ' + p.progress + '%').join(', ') || 'אין'}

עקרונות:
1. כשרואי מבקש לבצע משהו — בצע מיד עם הכלי המתאים, בלי לבקש אישור, ואז דווח במשפט קצר עם הפרטים המדויקים.
2. אם רק שאלו אותך — ענה ישירות בלי כלים.
3. כמאמן: כשרלוונטי הוסף דחיפה קטנה או תובנה, בקצרה ובחום.
4. אל תמציא נתונים. חסר מידע? השתמש ב-get_data.
5. מותר להפעיל כמה כלים ברצף לבקשה מורכבת.`;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  3. TOOLS — schemas + execution via window.POS
  // ──────────────────────────────────────────────────────────────────────
  const TOOLS = [
    { name:'add_task', description:'הוסף משימה חדשה',
      input_schema:{ type:'object', properties:{
        text:{type:'string'}, proj:{type:'string',description:'jobs/upselles/health/apartment/family/university/anthropic/none'},
        cat:{type:'string',description:'work/health/family/project/home'} }, required:['text'] } },
    { name:'complete_task', description:'סמן משימה פתוחה כבוצעה לפי טקסט',
      input_schema:{ type:'object', properties:{ query:{type:'string'} }, required:['query'] } },
    { name:'add_reminder', description:'הוסף תזכורת',
      input_schema:{ type:'object', properties:{
        text:{type:'string'}, date:{type:'string',description:'YYYY-MM-DD'}, time:{type:'string',description:'HH:MM'} }, required:['text'] } },
    { name:'add_event', description:'הוסף אירוע ליומן',
      input_schema:{ type:'object', properties:{
        title:{type:'string'}, date:{type:'string',description:'YYYY-MM-DD'}, time:{type:'string'} }, required:['title','date'] } },
    { name:'add_habit', description:'הוסף הרגל למעקב',
      input_schema:{ type:'object', properties:{ name:{type:'string'} }, required:['name'] } },
    { name:'log_habit', description:'תעד הרגל כבוצע היום',
      input_schema:{ type:'object', properties:{ name:{type:'string'} }, required:['name'] } },
    { name:'add_note', description:'שמור פתק',
      input_schema:{ type:'object', properties:{ title:{type:'string'}, content:{type:'string'} }, required:['content'] } },
    { name:'add_goal', description:'הוסף מטרה',
      input_schema:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } },
    { name:'add_idea', description:'שמור רעיון',
      input_schema:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } },
    { name:'add_journal', description:'הוסף רשומת יומן אישית',
      input_schema:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } },
    { name:'add_job', description:'הוסף משרה למעקב חיפוש העבודה',
      input_schema:{ type:'object', properties:{
        title:{type:'string'}, company:{type:'string'}, status:{type:'string'} }, required:['title'] } },
    { name:'log_meal', description:'תעד ארוחה שרואי אכל',
      input_schema:{ type:'object', properties:{ description:{type:'string'} }, required:['description'] } },
    { name:'update_project', description:'עדכן אחוז התקדמות של פרויקט',
      input_schema:{ type:'object', properties:{ id:{type:'string'}, progress:{type:'number'} }, required:['id','progress'] } },
    { name:'add_apartment', description:'הוסף דירה למעקב חיפוש הדירה',
      input_schema:{ type:'object', properties:{ title:{type:'string'}, price:{type:'string'}, area:{type:'string'}, link:{type:'string'} }, required:['title'] } },
    { name:'web_search', description:'חפש באינטרנט מידע עדכני — משרות, דירות, מחירים, חדשות',
      input_schema:{ type:'object', properties:{ query:{type:'string'} }, required:['query'] } },
    { name:'navigate', description:'נווט לעמוד באפליקציה',
      input_schema:{ type:'object', properties:{ page:{type:'string',
        description:'dashboard/agent/agenda/tasks/reminders/jobs/upselles/health/apartment/family/ideas/journal/goals/finance/notes/news/ds-ai'} }, required:['page'] } },
    { name:'get_data', description:'קבל תמונת מצב עדכנית של הנתונים',
      input_schema:{ type:'object', properties:{} } }
  ];

  async function webSearch(query){
    try{
      const res = await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ query:query, count:6 })});
      const d = await res.json().catch(()=>({}));
      const results = (d.results||[]).slice(0,6);
      if(!results.length) return 'לא נמצאו תוצאות.';
      return results.map((r,i)=>(i+1)+'. '+(r.title||'')+' — '+
        ((r.content||r.snippet||'').toString().slice(0,170))+(r.url?' ['+r.url+']':'')).join('\n');
    }catch(e){ return 'שגיאת חיפוש: '+e.message; }
  }
  async function execTool(name, input) {
    const P = window.POS;
    input = input || {};
    if (name === 'web_search') return await webSearch(input.query||'');
    if (!P) return 'המערכת עוד נטענת, נסה שוב';
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
        case 'add_apartment':  return P.addApartment ? P.addApartment(input) : 'מעקב דירות לא זמין';
        case 'log_meal':       return P.addMeal ? P.addMeal(input) : 'תיעוד ארוחות לא זמין';
        case 'update_project': return P.updateProject(input);
        case 'navigate':       return P.navigate(input.page);
        case 'get_data':       return JSON.stringify(context());
        default:               return 'כלי לא מוכר: ' + name;
      }
    } catch (e) { return 'שגיאה בכלי ' + name + ': ' + e.message; }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  4. BRAIN — Claude tool-use loop
  // ──────────────────────────────────────────────────────────────────────
  // credit-saving: short/simple commands use cheaper Haiku, complex use Sonnet
  function pickModel(text){
    const t = text || '';
    if (t.length > 170) return MODEL;
    if (/(תכנן|תוכנית|נתח|נתוח|חקור|חפש|מצא לי|סכם|השווה|כתוב לי|המלצ|רעיון|איך כדאי|plan|research|analyz|summar|search)/i.test(t)) return MODEL;
    return 'claude-haiku-4-5-20251001';
  }
  async function apiCall(system, messages, model) {
    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || MODEL, max_tokens: 1024, system, tools: TOOLS, messages })
      });
      if (!res.ok) return { _error: 'api ' + res.status };
      const data = await res.json();
      if (data && data.error) return { _error: data.error.message || 'api error' };
      return data;
    } catch (e) { return { _error: e.message }; }
  }

  async function ask(prompt) {
    prompt = (prompt || '').trim();
    if (!prompt) return '';
    const ctx = context();
    const system = systemPrompt(ctx);

    const model = pickModel(prompt);
    memory.push({ role: 'user', content: prompt });
    let messages = memory.slice(-12).map(m => ({ role: m.role, content: m.content }));
    while (messages.length && messages[0].role !== 'user') messages.shift();

    let loops = 0;
    while (loops++ < 6) {
      const data = await apiCall(system, messages, model);
      if (data._error) {
        memory.pop();
        return 'לא הצלחתי להתחבר כרגע (' + data._error + '). נסה שוב בעוד רגע.';
      }
      const blocks   = Array.isArray(data.content) ? data.content : [];
      const toolUses = blocks.filter(b => b.type === 'tool_use');
      const textOut  = blocks.filter(b => b.type === 'text').map(b => b.text).join('').trim();

      if (toolUses.length === 0) {
        memory.push({ role: 'assistant', content: textOut });
        saveMemory();
        return textOut || 'בוצע.';
      }
      messages.push({ role: 'assistant', content: blocks });
      const results = [];
      for (const tu of toolUses) {
        let out;
        try { out = await execTool(tu.name, tu.input); }
        catch (e) { out = 'שגיאה: ' + e.message; }
        results.push({ type:'tool_result', tool_use_id: tu.id, content: String(out) });
      }
      messages.push({ role: 'user', content: results });
    }
    saveMemory();
    return 'הבקשה מורכבת מדי — נסה לפצל אותה לכמה צעדים.';
  }

  // ──────────────────────────────────────────────────────────────────────
  //  5. VOICE — record (MediaRecorder) → /api/transcribe ; speak → /api/speak
  // ──────────────────────────────────────────────────────────────────────
  let mediaRec = null, recChunks = [], recording = false, recTimer = null;
  let audioEl = null, audioUnlocked = false;

  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try {
      audioEl = new Audio();
      // a tiny silent clip primes iOS so later programmatic play() works
      audioEl.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTEFNRTMuOTkuNVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
      audioEl.volume = 0;
      const p = audioEl.play();
      if (p && p.then) p.then(() => { audioEl.volume = 1; }).catch(() => {});
    } catch (e) {}
  }

  function cleanForSpeech(t) {
    return (t || '')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
      .replace(/[*_`~#>|]+/g, '').replace(/\s+/g, ' ').trim();
  }

  function browserSpeak(text) {
    try {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(cleanForSpeech(text));
      const voices = window.speechSynthesis.getVoices() || [];
      const he = voices.find(v => v.lang === 'he-IL') || voices.find(v => v.lang && v.lang.startsWith('he'));
      if (he) u.voice = he;
      u.lang = he ? he.lang : 'he-IL';
      u.onstart = () => setState('speaking');
      u.onend   = () => setState('idle');
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  async function speak(text) {
    const clean = cleanForSpeech(text);
    if (!clean) return;
    setState('speaking');
    try {
      const res = await fetch('/api/claude', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'speak', text: clean })
      });
      const ct = res.headers.get('content-type') || '';
      if (res.ok && ct.includes('audio')) {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        if (!audioEl) audioEl = new Audio();
        audioEl.src = url;
        audioEl.volume = 1;
        audioEl.onended = () => { setState('idle'); URL.revokeObjectURL(url); };
        audioEl.onerror = () => { setState('idle'); browserSpeak(clean); };
        const p = audioEl.play();
        if (p && p.catch) p.catch(() => { browserSpeak(clean); });
        return;
      }
      // no key / failure → browser voice
      browserSpeak(clean);
    } catch (e) {
      browserSpeak(clean);
    }
  }

  async function startRecording() {
    if (recording) return;
    unlockAudio();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toast('אין גישה למיקרופון — אפשר אותה בהגדרות הדפדפן.', true);
      return;
    }
    let mime = '';
    ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].forEach(m => {
      if (!mime && window.MediaRecorder && MediaRecorder.isTypeSupported(m)) mime = m;
    });
    try {
      mediaRec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      toast('הקלטה לא נתמכת בדפדפן הזה.', true);
      stream.getTracks().forEach(t => t.stop());
      return;
    }
    recChunks = [];
    mediaRec.ondataavailable = e => { if (e.data && e.data.size) recChunks.push(e.data); };
    mediaRec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      recording = false;
      setState('thinking');
      const blob = new Blob(recChunks, { type: mediaRec.mimeType || 'audio/webm' });
      if (blob.size < 1200) { setState('idle'); return; } // silence
      const text = await transcribe(blob);
      if (text) { send(text); }
      else { setState('idle'); }
    };
    mediaRec.start();
    recording = true;
    setState('listening');
    recTimer = setTimeout(() => { if (recording) stopRecording(); }, MAX_REC_MS);
  }

  function stopRecording() {
    if (!recording || !mediaRec) return;
    if (recTimer) { clearTimeout(recTimer); recTimer = null; }
    try { mediaRec.stop(); } catch (e) { recording = false; setState('idle'); }
  }
  function toggleRecording() { recording ? stopRecording() : startRecording(); }

  function blobToBase64(blob) {
    return new Promise(resolve => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result || '').replace(/^data:[^,]*,/, ''));
      r.onerror = () => resolve('');
      r.readAsDataURL(blob);
    });
  }

  async function transcribe(blob) {
    try {
      const b64 = await blobToBase64(blob);
      if (!b64) return '';
      const res = await fetch('/api/claude', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'transcribe', audio: b64, mime: blob.type || 'audio/webm', language: 'he' })
      });
      const data = await res.json().catch(() => ({}));
      if (data.error === 'no_key') {
        toast('כדי שהקול יעבוד — הוסף OPENAI_API_KEY בהגדרות Vercel.', true);
        return '';
      }
      if (data.error) { toast(data.message || 'שגיאת תמלול', true); return ''; }
      return (data.text || '').trim();
    } catch (e) { toast('שגיאת תמלול: ' + e.message, true); return ''; }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  6. HUD — orb + chat panel
  // ──────────────────────────────────────────────────────────────────────
  let root, orb, panel, thread, input, statusEl, micBtn;
  let state = 'idle';

  function injectStyles() {
    if (document.getElementById('assistant-css')) return;
    const s = document.createElement('style');
    s.id = 'assistant-css';
    s.textContent = `
#as-root{position:fixed;bottom:20px;left:20px;z-index:999999;direction:rtl;
  font-family:-apple-system,Segoe UI,Rubik,Arial,sans-serif}
#as-orb{width:62px;height:62px;border-radius:50%;cursor:pointer;position:relative;
  background:radial-gradient(circle at 35% 30%,#fff 0%,${ACCENT} 38%,#024 100%);
  box-shadow:0 6px 24px rgba(0,0,0,.4),0 0 22px ${ACCENT}66;transition:transform .15s;
  display:none}/* merged into the red Zoro orb — opened via its ⌨️ menu item */
#as-orb:hover{transform:scale(1.06)}
#as-orb::after{content:'';position:absolute;inset:-6px;border-radius:50%;
  border:2px solid ${ACCENT};opacity:0}
#as-root.listening #as-orb::after{animation:as-pulse 1s ease-out infinite;border-color:#42e695}
#as-root.thinking  #as-orb::after{animation:as-spin 1.1s linear infinite;border-style:dashed;border-color:#ffd84d}
#as-root.speaking  #as-orb::after{animation:as-pulse .7s ease-out infinite;border-color:${ACCENT}}
@keyframes as-pulse{0%{opacity:.8;transform:scale(1)}100%{opacity:0;transform:scale(1.5)}}
@keyframes as-spin{to{transform:rotate(360deg)}}
#as-panel{position:absolute;bottom:74px;left:0;width:360px;max-width:86vw;
  background:#12161d;border:1px solid #2a3340;border-radius:16px;
  box-shadow:0 18px 50px rgba(0,0,0,.55);display:none;flex-direction:column;
  overflow:hidden}
#as-root.open #as-panel{display:flex}
#as-head{display:flex;align-items:center;gap:8px;padding:12px 14px;
  border-bottom:1px solid #2a3340;background:#0e1218}
#as-head b{color:${ACCENT};font-size:14px;flex:1;letter-spacing:.5px}
#as-status{font-size:11px;color:#8b9bb4}
#as-head .as-x{cursor:pointer;color:#8b9bb4;font-size:16px;line-height:1;background:none;border:none}
#as-head .as-x:hover{color:#fff}
#as-thread{padding:12px;max-height:46vh;overflow-y:auto;display:flex;
  flex-direction:column;gap:8px;background:#12161d}
.as-msg{padding:9px 12px;border-radius:12px;font-size:13.5px;line-height:1.5;
  max-width:85%;white-space:pre-wrap;word-break:break-word}
.as-msg.user{background:${ACCENT};color:#012;align-self:flex-start;border-bottom-right-radius:3px}
.as-msg.bot{background:#1d2530;color:#eef2f7;align-self:flex-end;border-bottom-left-radius:3px}
.as-msg.sys{background:none;color:#8b9bb4;font-size:12px;align-self:center;text-align:center}
#as-row{display:flex;gap:7px;padding:10px;border-top:1px solid #2a3340;background:#0e1218;
  align-items:center}
#as-input{flex:1;background:#1d2530;border:1px solid #2a3340;border-radius:10px;
  color:#eef2f7;padding:10px 12px;font-size:13.5px;font-family:inherit;direction:rtl}
#as-input:focus{outline:none;border-color:${ACCENT}}
#as-row button{border:none;border-radius:10px;cursor:pointer;font-size:15px;
  width:40px;height:40px;flex-shrink:0;transition:opacity .15s}
#as-row button:hover{opacity:.85}
#as-send{background:${ACCENT};color:#012}
#as-mic{background:#1d2530;color:#eef2f7;border:1px solid #2a3340!important}
#as-root.listening #as-mic{background:#ff4d6d;color:#fff;animation:as-mic 1s infinite}
@keyframes as-mic{50%{opacity:.55}}
#as-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 10px 10px;background:#0e1218}
.as-chip{background:#1d2530;border:1px solid #2a3340;color:#cfe0f0;border-radius:8px;
  padding:6px 10px;font-size:11.5px;cursor:pointer}
.as-chip:hover{border-color:${ACCENT};color:#fff}
`;
    document.head.appendChild(s);
  }

  function build() {
    if (document.getElementById('as-root')) return;
    injectStyles();
    root = document.createElement('div');
    root.id = 'as-root';
    root.innerHTML =
      '<div id="as-panel">' +
        '<div id="as-head"><b>זורו</b><span id="as-status">מוכן</span>' +
          '<button class="as-x" id="as-clear" title="נקה שיחה">⟲</button>' +
          '<button class="as-x" id="as-close" title="סגור">✕</button></div>' +
        '<div id="as-thread"></div>' +
        '<div id="as-chips">' +
          '<span class="as-chip" data-cmd="מה יש לי היום?">מה היום</span>' +
          '<span class="as-chip" data-cmd="מה הכי דחוף לעשות עכשיו?">מה עכשיו</span>' +
          '<span class="as-chip" data-cmd="תכנן לי את היום">תכנן יום</span>' +
          '<span class="as-chip" data-cmd="סכם לי את השבוע">סיכום שבוע</span>' +
        '</div>' +
        '<div id="as-row">' +
          '<input id="as-input" placeholder="כתוב לזורו או הקש על המיקרופון…" />' +
          '<button id="as-mic" title="דבר">🎙</button>' +
          '<button id="as-send" title="שלח">➤</button>' +
        '</div>' +
      '</div>' +
      '<div id="as-orb" title="זורו — הקש לפתיחה"></div>';
    document.body.appendChild(root);

    orb      = root.querySelector('#as-orb');
    panel    = root.querySelector('#as-panel');
    thread   = root.querySelector('#as-thread');
    input    = root.querySelector('#as-input');
    statusEl = root.querySelector('#as-status');
    micBtn   = root.querySelector('#as-mic');

    orb.addEventListener('click', () => { unlockAudio(); toggle(); });
    root.querySelector('#as-close').addEventListener('click', close);
    root.querySelector('#as-clear').addEventListener('click', clearMemory);
    root.querySelector('#as-send').addEventListener('click', () => submitInput());
    micBtn.addEventListener('click', () => { unlockAudio(); toggleRecording(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submitInput(); });
    root.querySelectorAll('.as-chip').forEach(c =>
      c.addEventListener('click', () => { open(); send(c.dataset.cmd); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    renderThread();
  }

  function setState(s) {
    state = s;
    if (root) {
      root.classList.remove('listening', 'thinking', 'speaking');
      if (s !== 'idle') root.classList.add(s);
    }
    if (statusEl) {
      statusEl.textContent =
        { idle:'מוכן', listening:'מקשיב…', thinking:'חושב…', speaking:'מדבר…' }[s] || 'מוכן';
    }
  }

  function renderThread() {
    if (!thread) return;
    thread.innerHTML = '';
    if (!memory.length) {
      addBubble('sys', 'היי רואי, אני זורו. דבר אליי או כתוב — אני כאן לעזור.');
    } else {
      memory.slice(-30).forEach(m => addBubble(m.role === 'user' ? 'user' : 'bot', m.content));
    }
  }
  function addBubble(kind, text) {
    if (!thread) return;
    const d = document.createElement('div');
    d.className = 'as-msg ' + kind;
    d.textContent = text;
    thread.appendChild(d);
    thread.scrollTop = thread.scrollHeight;
    return d;
  }
  function toast(msg, isErr) {
    open();
    addBubble('sys', (isErr ? '⚠ ' : '') + msg);
  }

  function open()  { if (root) root.classList.add('open'); }
  function close() { if (root) root.classList.remove('open'); }
  function toggle(){ if (root) root.classList.toggle('open'); if (root.classList.contains('open') && input) input.focus(); }

  function submitInput() {
    if (!input || !input.value.trim()) return;
    const v = input.value.trim();
    input.value = '';
    send(v);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  7. CONTROLLER
  // ──────────────────────────────────────────────────────────────────────
  let busy = false;
  async function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true;
    open();
    addBubble('user', text);
    setState('thinking');
    const typing = addBubble('sys', '·  ·  ·');
    let reply = '';
    try {
      reply = await ask(text);
    } catch (e) {
      reply = 'אירעה שגיאה: ' + e.message;
    }
    if (typing) typing.remove();
    if (reply) {
      addBubble('bot', reply);
      browserSpeak(reply);   // free browser voice — saves TTS credits on the chat orb
    } else {
      setState('idle');
    }
    busy = false;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  8. PUBLIC API + BOOT
  // ──────────────────────────────────────────────────────────────────────
  window.Assistant = {
    version: VERSION,
    open: open, close: close, toggle: toggle,
    send: send, speak: speak, clearMemory: clearMemory
  };

  function boot() {
    loadMemory();
    build();
    console.log('%cזורו v' + VERSION + ' — clean assistant online (voice via API, Claude brain).',
      'color:' + ACCENT + ';font-weight:bold');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
