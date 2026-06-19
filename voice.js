/* ============================================================================
 * voice.js — Personal OS · Voice Mode (standalone side feature)
 * ----------------------------------------------------------------------------
 * A dedicated hands-free voice assistant page (#page-voice) + a floating
 * red-sun orb on every page. Independent of assistant.js / agent.js —
 * shares only window.POS and /api/claude.
 *
 *   • Wake word — say "זורו" from anywhere; no need to press a button
 *   • Brain     — Claude tool-use loop via /api/claude (Claude stays the brain)
 *   • Tools     — full system access via window.POS + live web search
 *   • Voice     — browser SpeechRecognition (free, no key) for STT;
 *                 OpenAI neural voice for TTS (browser-voice fallback)
 *
 * Architecture inspired by the OpenJarvis 5-primitive model (Apache-2.0,
 * reference only — no open-source code copied).
 *
 * Exposes: window.VoiceMode
 * ========================================================================== */
(function () {
  'use strict';

  const VERSION  = '3.0.0';
  const MODEL    = 'claude-sonnet-4-6';
  const MEM_KEY  = 'pos_voice_memory';
  const WAKE_KEY = 'pos_voice_wake';
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const WAKE_WORDS = ['זורו', 'זרו', 'זורוו', 'zoro', "ג'ארוויס", 'גארוויס', 'גרוויס', 'jarvis'];

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
    const now = new Date();
    const dateStr = now.toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const timeStr = now.toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});
    const iso = now.toISOString().split('T')[0];
    return `אתה זורו — העוזר הקולי האישי ומאמן הביצועים של רואי קליין, בהשראת JARVIS.
זו שיחה קולית רציפה — רואי מדבר אליך ואתה עונה בקול. דבר כמו בשיחה אמיתית.

עכשיו: ${dateStr}, השעה ${timeStr}. היום בפורמט ISO: ${iso}.

דיוק זמנים — קריטי:
- "בעוד שעתיים" / "בעוד 30 דקות" — חשב מהשעה הנוכחית (${timeStr}) ותן שעה מדויקת.
- "מחר" = יום אחד אחרי ${iso}. תמיד המר תאריך יחסי ל-YYYY-MM-DD מדויק.
- כשאתה קובע תזכורת או אירוע — אמור בקול את השעה והתאריך המדויקים שחישבת.

אתה מחובר לאינטרנט:
- השתמש ב-web_search כדי למצוא מידע עדכני — משרות, דירות, מחירים, חדשות.
- חיפוש עבודה: חפש משרות, ואז שמור את הטובות עם add_job (כותרת, חברה, קישור).
- חיפוש דירה: חפש דירות, ואז שמור עם add_apartment (כתובת, מחיר, אזור, קישור).
- עבוד לפי מה שרואי מבקש; שמור תוצאות במבנה של המערכת.

איפה דברים נשמרים (אתה יודע את זה — לעולם אל תגיד "אני לא יודע איך האפליקציה בנויה"):
- אירועים → הלוז השבועי. משימות → עמוד המשימות. תזכורות → עמוד התזכורות.
- משרות → עמוד חיפוש עבודה. דירות → עמוד מציאת דירה.
- אם רואי לא מוצא משהו — הפעל את הכלי navigate כדי לקחת אותו לעמוד הנכון.

חוקים לשיחה קולית:
- תשובות קצרות מאוד — משפט, אולי שניים. בלי רשימות, בלי מרקדאון, בלי אימוג'ים.
- טבעי, חם וזורם. פנה לרואי בשמו מדי פעם.
- כשרואי מבקש משהו — בצע מיד עם הכלי המתאים ודווח במשפט קצר עם הפרטים המדויקים.
- אם רק שאלו אותך — ענה ישר בלי כלים. אל תמציא נתונים; חסר מידע? get_data או web_search.
- כשמבקשים החלטה או המלצה — תן המלצה ברורה, לא רשימת אופציות.
- בלי אזהרות מיותרות ("אני רק AI", "התייעץ עם איש מקצוע") — רואי מבוגר ויודע מה הוא רוצה.
- תזכורות שאתה קובע עם add_reminder יסונכרנו אוטומטית ל-Google Calendar וייקפצו ב-iPhone — אמור לרואי משהו בסגנון "סנכרנתי לקלנדר".

${(() => {
  // Group upcoming events into day blocks so Zoro can answer "מה הלוז שלי מחר?"
  // accurately without guessing.
  const ev = ctx.upcomingEvents || [];
  if (!ev.length) return 'הלוז שלך הקרוב: ריק.';
  const byDate = {};
  ev.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
  const lines = Object.keys(byDate).sort().slice(0, 7).map(d => {
    const items = byDate[d].sort((a,b) => (a.time||'').localeCompare(b.time||''))
      .map(e => `${e.time || '?'} ${e.text}`).join(' | ');
    const dayLbl = byDate[d][0].day ? ' (' + byDate[d][0].day + ')' : '';
    return `• ${d}${dayLbl}: ${items}`;
  }).join('\n');
  return 'הלוז שלך לשבעה ימים הקרובים — תמיד בסס תשובות על זה ולא תמציא:\n' + lines;
})()}

משימות פתוחות: ${(ctx.openTasks||[]).map(t=>t.text).join(', ')||'אין'}
פרויקטים: ${(ctx.projects||[]).map(p=>p.name+' '+p.progress+'%').join(', ')||'אין'}${ctx.persona?('\n\n'+ctx.persona):''}`;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  TOOLS — full system access via window.POS + live web search
  // ──────────────────────────────────────────────────────────────────────
  const TOOLS = [
    { name:'add_task', description:'הוסף משימה',
      input_schema:{ type:'object', properties:{ text:{type:'string'}, proj:{type:'string'}, cat:{type:'string'} }, required:['text'] } },
    { name:'complete_task', description:'סמן משימה כבוצעה לפי טקסט',
      input_schema:{ type:'object', properties:{ query:{type:'string'} }, required:['query'] } },
    { name:'add_reminder', description:'הוסף תזכורת',
      input_schema:{ type:'object', properties:{ text:{type:'string'}, date:{type:'string'}, time:{type:'string'} }, required:['text'] } },
    { name:'add_event', description:'הוסף אירוע ללוז',
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
    { name:'add_job', description:'הוסף משרה למעקב חיפוש העבודה',
      input_schema:{ type:'object', properties:{ title:{type:'string'}, company:{type:'string'}, status:{type:'string'}, link:{type:'string'} }, required:['title'] } },
    { name:'add_apartment', description:'הוסף דירה למעקב חיפוש הדירה',
      input_schema:{ type:'object', properties:{ title:{type:'string',description:'כתובת/תיאור'}, price:{type:'string'}, area:{type:'string'}, link:{type:'string'}, notes:{type:'string'} }, required:['title'] } },
    { name:'log_meal', description:'תעד ארוחה',
      input_schema:{ type:'object', properties:{ description:{type:'string'} }, required:['description'] } },
    { name:'update_project', description:'עדכן אחוז התקדמות פרויקט',
      input_schema:{ type:'object', properties:{ id:{type:'string'}, progress:{type:'number'} }, required:['id','progress'] } },
    { name:'web_search', description:'חפש באינטרנט מידע עדכני — משרות, דירות, מחירים, חדשות, כל דבר',
      input_schema:{ type:'object', properties:{ query:{type:'string'} }, required:['query'] } },
    { name:'navigate', description:'נווט לעמוד ספציפי. ערכי page חוקיים: dashboard, agenda (לוז שבועי), tasks (משימות), reminders (תזכורות), jobs (חיפוש עבודה), apartment (מציאת דירה), upselles, health, family, ideas, journal, goals, finance, notes, news',
      input_schema:{ type:'object', properties:{ page:{type:'string'} }, required:['page'] } },
    { name:'get_data', description:'קבל תמונת מצב עדכנית של הנתונים', input_schema:{ type:'object', properties:{} } },
    { name:'run_job_hunt', description:'הפעל את סוכן ציד המשרות שסורק אתרים ומנקד משרות מול הפרופיל. השתמש כשמבקשים למצוא/לחפש/להריץ משרות.', input_schema:{ type:'object', properties:{} } }
  ];

  async function webSearch(query){
    try{
      const res = await fetch('/api/search',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ query:query, count:6 })});
      const d = await res.json().catch(()=>({}));
      const results = (d.results||[]).slice(0,6);
      if(!results.length) return 'לא נמצאו תוצאות לחיפוש: '+query;
      return results.map((r,i)=>(i+1)+'. '+(r.title||'ללא כותרת')+' — '+
        ((r.content||r.snippet||r.description||'').toString().slice(0,170))+
        (r.url?' ['+r.url+']':'')).join('\n');
    }catch(e){ return 'שגיאת חיפוש: '+e.message; }
  }

  async function execTool(name, input){
    const P = window.POS; input = input || {};
    if (name === 'web_search') return await webSearch(input.query||'');
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
        case 'add_apartment':  return P.addApartment ? P.addApartment(input) : 'מעקב דירות לא זמין';
        case 'log_meal':       return P.addMeal ? P.addMeal(input) : 'תיעוד ארוחות לא זמין';
        case 'update_project': return P.updateProject(input);
        case 'navigate':       return P.navigate(input.page);
        case 'get_data':       return JSON.stringify(context());
        case 'run_job_hunt':   if (window.runJobHuntNow){ window.runJobHuntNow(); return 'הפעלתי את צייד המשרות — סורק עכשיו, התוצאות יופיעו במרכז הפיקוד.'; } return 'צייד המשרות לא זמין כרגע';
        default:               return 'כלי לא מוכר: ' + name;
      }
    } catch (e) { return 'שגיאה בכלי ' + name + ': ' + e.message; }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  BRAIN — Claude tool-use loop
  // ──────────────────────────────────────────────────────────────────────
  // credit-saving: short/simple commands use cheaper Haiku; complex
  // requests (planning, research, web search) use Sonnet.
  function pickModel(text){
    const t = text || '';
    if (t.length > 170) return MODEL;
    if (/(תכנן|תוכנית|נתח|נתוח|חקור|חפש|מצא לי|סכם|השווה|כתוב לי|המלצ|רעיון|איך כדאי|plan|research|analyz|summar|search)/i.test(t)) return MODEL;
    return 'claude-haiku-4-5-20251001';
  }
  async function apiCall(system, messages, model){
    try {
      const res = await fetch('/api/claude', {
        method:'POST', headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ model: model || MODEL, max_tokens: 1024, system, tools: TOOLS, messages })
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
    memory.push({ role:'user', content: prompt });
    // Gemini is the brain for natural conversation (fast). It delegates to the Claude
    // tool-agent only when an ACTION is requested (task / reminder / event / job-hunt / nav).
    const ACTION_RE = /(הוסף|תוסיף|תזכיר|תזכורת|קבע|תזמן|תזמ|מצא לי|תמצא|תריץ|הרץ|סמן|תסמן|מחק|תמחק|עדכן|תעדכן|רשום|תרשום|פתח|נווט|קח אותי|חפש לי משרות|תקבע)/;
    const wantsAction = ACTION_RE.test(prompt);
    if (!wantsAction) {
      const voiceSys = 'אתה זורו — העוזר הקולי של רואי קליין. דבר עברית טבעית, חמה וזורמת, קצר וממוקד (1-2 משפטים), בגוף ראשון, כמו בשיחת טלפון אמיתית. אתה המוח (Gemini) לשיחה, ויש לך סוכני Claude שמבצעים פעולות במערכת (משימות, תזכורות, אירועים, חיפוש משרות) — כשצריך פעולה אתה פונה אליהם. כששואלים על איזה מודל אתה — ענה בדיוק את זה, בלי להפנות לממשקים חיצוניים. אל תמציא מידע ואל תשתמש במילים לא-תקניות. ענה אך ורק את התשובה הסופית בעברית — בלי לכתוב מחשבות, בלי "THOUGHT", בלי תגיות, ובלי להסביר איך ענית.' + (function(){try{var pp=(window.POS&&window.POS.snapshot)?(window.POS.snapshot().persona||''):'';return pp?('\n\n'+pp):'';}catch(e){return'';}})();
      try {
        const convo = memory.slice(-12).map(m => ({ role:m.role, content:m.content }));
        const r = await fetch('/api/gemini', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ messages: convo, system: voiceSys }) });
        const d = await r.json();
        if (d && d.text && !d.error) { memory.push({ role:'assistant', content: d.text }); saveMem(); return String(d.text).trim(); }
      } catch (e) {}
    }
    // ACTION (or Gemini unavailable) -> Claude tool-use agent (executes real actions).
    const system = systemPrompt(context());
    const model = pickModel(prompt);
    let messages = memory.slice(-12).map(m => ({ role:m.role, content:m.content }));
    while (messages.length && messages[0].role !== 'user') messages.shift();
    let loops = 0;
    while (loops++ < 7) {
      const data = await apiCall(system, messages, model);
      if (data._error) { memory.pop(); return 'לא הצלחתי להתחבר כרגע. ננסה שוב.'; }
      const blocks   = Array.isArray(data.content) ? data.content : [];
      const toolUses = blocks.filter(b => b.type === 'tool_use');
      const textOut  = blocks.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      if (toolUses.length === 0) { memory.push({ role:'assistant', content: textOut }); saveMem(); return textOut || 'בוצע.'; }
      messages.push({ role:'assistant', content: blocks });
      const results = [];
      for (const tu of toolUses) {
        let out;
        try { out = await execTool(tu.name, tu.input); }
        catch (e) { out = 'שגיאה: ' + e.message; }
        results.push({ type:'tool_result', tool_use_id: tu.id, content: String(out) });
      }
      messages.push({ role:'user', content: results });
    }
    saveMem();
    return 'הבקשה מורכבת מדי, ננסה לפצל.';
  }

  // ──────────────────────────────────────────────────────────────────────
  //  TEXT-TO-SPEECH
  // ──────────────────────────────────────────────────────────────────────
  let audioCtx = null, audioEl = null, audioUnlocked = false, ttsApiDead = false;
  // Neural TTS voice preference (Avri = male, Hila = female). Persisted across sessions.
  const TTS_VOICE_KEY = 'pos_tts_voice';
  let ttsVoice = 'avri';
  try { ttsVoice = localStorage.getItem(TTS_VOICE_KEY) || 'avri'; } catch (e) {}
  const ttsVoiceLabel = () => (ttsVoice === 'hila' ? 'אביאלה' : 'זורו');
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
  // Strip any leaked chain-of-thought / labels so the user never sees or hears
  // the model's reasoning (e.g. "THOUGHT: ...", "ANSWER:", "<thinking>...</thinking>").
  function stripReasoning(t){
    let s = String(t || '');
    s = s.replace(/<\/?thinking>/gi, ' ').replace(/<\/?thought>/gi, ' ');
    const m = s.match(/\b(THOUGHT|THINKING|REASONING|מחשבה|חשיבה)\s*:/i);
    if (m){
      const after = s.slice(m.index);
      const heb = after.search(/[֐-׿]/);   // jump to the first Hebrew char (the real answer)
      s = (heb > -1) ? after.slice(heb) : s.slice(0, m.index);
    }
    s = s.replace(/^\s*(ANSWER|RESPONSE|FINAL|תשובה)\s*:\s*/i, '');
    return s.trim();
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
        body: JSON.stringify({ mode:'speak', text: clean, voice: ttsVoice })
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
      ttsApiDead = true;
      browserSpeak(clean, onDone);
    } catch (e) { browserSpeak(clean, onDone); }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  SPEECH-TO-TEXT  — wake word + conversation, unified
  // ──────────────────────────────────────────────────────────────────────
  // State: wakeArmed (always-listen for "זורו") · conversing (tap-to-talk
  // free conversation) · speaking (busy) · awaitingCommand (heard the bare
  // name, next utterance is the command).
  let wakeArmed = false, conversing = false, speaking = false, awaitingCommand = false;
  let stopRequested = false;
  let recog = null, recogOn = false;

  // "זורו עצור" / "עצור" / "stop" — stop listening + acting (after the
  // current action finishes).
  const STOP_WORDS = ['עצור', 'סטופ', 'תעצור', 'לעצור', 'תפסיק', 'להפסיק', 'די', 'מספיק', 'סגור', 'stop', 'enough', 'shut up', 'shutup'];
  function isStopCommand(text){
    const words = (text||'').toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 4) return false;
    const core = ' ' + words.filter(w => !WAKE_WORDS.some(ww => w.indexOf(ww.toLowerCase()) >= 0)).join(' ') + ' ';
    return STOP_WORDS.some(sw => core.indexOf(sw) >= 0);
  }
  function fullStop(announce){
    const wasActive = conversing || wakeArmed || speaking;
    stopRequested = false; conversing = false; speaking = false; awaitingCommand = false;
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    try { if (audioEl) audioEl.pause(); } catch (e) {}
    stopRecorder();
    if (wakeArmed) disarmWake(); else stopSR();
    setState('idle'); syncWakeUI();
    addLine('sys', 'זורו הופסק. הקש על השמש או הפעל "האזנה" כדי להתחיל שוב.');
    if (announce) setTimeout(function(){ browserSpeak('בסדר רואי, אני מפסיק לעבוד. קרא לי כשתצטרך אותי.'); }, 130);
  }

  function interruptSpeak(){
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    try { if (audioEl) audioEl.pause(); } catch (e) {}
    speaking = false; stopRequested = false;
    if (conversing) { setState('listening'); if (SR) startSR(); else recLoop(); }
    else { setState('idle'); }
  }
  function wakeMatch(text){
    const low = ' ' + (text||'').toLowerCase() + ' ';
    for (const w of WAKE_WORDS){
      const i = low.indexOf(w.toLowerCase());
      if (i >= 0) return (text || '').slice(Math.max(0, i - 1 + w.length)).trim();
    }
    return null; // null = no wake word at all
  }

  function makeRecog(){
    const r = new SR();
    r.lang = 'he-IL'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onstart = () => { recogOn = true; if (conversing && !speaking) setState('listening'); };
    r.onend   = () => {
      recogOn = false;
      // Do NOT listen while Zoro is speaking — stops the mic from hearing the TTS (echo / self-talk).
      if ((conversing || wakeArmed) && !speaking) {
        setTimeout(() => { if ((conversing || wakeArmed) && !speaking && !recogOn) startSR(); }, 250);
      }
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wakeArmed = false; conversing = false;
        setStatus('אין גישה למיקרופון — אפשר אותה בהגדרות הדפדפן', 'err');
        syncWakeUI();
      }
    };
    r.onresult = (ev) => {
      let interim = '', final = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      const T = final.trim();
      // stop command — caught even mid-action; if Zoro is busy, finish first
      if (T && isStopCommand(T)) {
        if (speaking) stopRequested = true;
        else fullStop(true);
        return;
      }
      if (speaking) return;
      if (interim.trim() && (conversing || awaitingCommand)) setStatus('🎙 ' + interim.trim(), '');
      if (!T) return;
      if (conversing)              { handleUtterance(T); return; }
      if (awaitingCommand)         { awaitingCommand = false; handleUtterance(T); return; }
      if (wakeArmed) {
        const cmd = wakeMatch(T);
        if (cmd === null) return;            // no wake word — ignore
        if (cmd) { handleUtterance(cmd); }   // "זורו <command>"
        else {                               // just the name
          awaitingCommand = true;
          speaking = true; stopSR();
          browserSpeak('כן רואי?', () => { speaking = false; if (wakeArmed || conversing) startSR(); });
        }
      }
    };
    return r;
  }
  function startSR(){
    if (!SR) return;
    if (!recog) recog = makeRecog();
    if (recogOn) return;
    try { recog.start(); } catch (e) {}
  }
  function stopSR(){
    if (recog) { try { recog.stop(); } catch (e) {} }
    recogOn = false;
  }

  // ── MediaRecorder fallback (iOS — no SpeechRecognition) ──
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
    turnActive = true; setState('listening');
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
  async function handleUtterance(text, source){
    if (speaking) return;
    text = (text || '').trim();
    if (!text) return;
    if (isStopCommand(text)) { fullStop(true); return; }
    speaking = true;
    stopSR();
    setStatus('', '');
    addLine('user', text);
    setState('thinking');
    const reply = stripReasoning(await think(text));
    addLine('bot', reply);
    setState('speaking');
    const done = () => {
      speaking = false;
      if (stopRequested) { fullStop(true); return; }   // user said "עצור" mid-action
      if (conversing || wakeArmed) {
        setState(conversing ? 'listening' : 'idle');
        if (SR) startSR(); else if (conversing) recLoop();
      } else {
        setState('idle');
      }
    };
    // Replies use the neural Hebrew voice (Edge: Zoro/Aviela); speak() auto-falls back
    // to the browser voice if the TTS API is unavailable.
    speak(reply, done);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  CONVERSATION + WAKE CONTROL
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
    conversing = false; speaking = false; awaitingCommand = false;
    stopRecorder();
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    try { if (audioEl) audioEl.pause(); } catch (e) {}
    if (wakeArmed && SR) { setState('idle'); startSR(); }   // fall back to wake listening
    else { stopSR(); setState('idle'); }
  }
  function toggleConversation(){ conversing ? stopConversation() : startConversation(); }

  function armWake(){
    if (!SR || wakeArmed) { syncWakeUI(); return; }
    wakeArmed = true;
    try { localStorage.setItem(WAKE_KEY, '1'); } catch (e) {}
    syncWakeUI();
    if (!speaking) startSR();
  }
  function disarmWake(){
    wakeArmed = false;
    try { localStorage.setItem(WAKE_KEY, '0'); } catch (e) {}
    syncWakeUI();
    if (!conversing) stopSR();
  }
  function toggleWake(){ wakeArmed ? disarmWake() : armWake(); }

  // ──────────────────────────────────────────────────────────────────────
  //  USAGE SUGGESTIONS — what Zoro can do for Roei
  // ──────────────────────────────────────────────────────────────────────
  const SUGGESTIONS = [
    { group:'יומיום', items:[
      { t:'מה יש לי היום?', run:true },
      { t:'תכנן לי את היום', run:true },
      { t:'מה הכי דחוף לעשות עכשיו?', run:true },
      { t:'סכם לי את השבוע', run:true } ] },
    { group:'משימות וזמן', items:[
      { t:'תוסיף משימה ', run:false },
      { t:'תזכיר לי בעוד שעה ', run:false },
      { t:'תוסיף אירוע מחר בשעה ', run:false } ] },
    { group:'פרויקטים + אינטרנט', items:[
      { t:'חפש לי משרות AI בתל אביב', run:true },
      { t:'חפש דירות 3 חדרים בתל אביב עד 6000 שקל', run:true },
      { t:'מה הסטטוס של חיפוש העבודה?', run:true },
      { t:'מה הצעד הבא ב-Upselles?', run:true } ] },
    { group:'מאמן אישי', items:[
      { t:'תן לי דחיפה למוטיבציה', run:true },
      { t:'מה אני שוכח לעשות?', run:true } ] }
  ];

  // ──────────────────────────────────────────────────────────────────────
  //  UI
  // ──────────────────────────────────────────────────────────────────────
  let rootEl, orbEl, statusEl, stateEl, transcriptEl, inputEl, floatEl, wakeBtn;

  function injectStyles(){
    if (document.getElementById('voice-css')) return;
    const s = document.createElement('style');
    s.id = 'voice-css';
    s.textContent = `
#voice-root{direction:rtl;color:#f3eef0;position:relative;overflow:hidden;
  background:radial-gradient(ellipse 130% 78% at 50% -8%,#3a0a16 0%,#1a070d 42%,#070305 100%);
  border-radius:22px;padding:26px 20px 30px;min-height:80vh;
  display:flex;flex-direction:column;align-items:center;gap:14px;
  font-family:-apple-system,'SF Pro Display',Segoe UI,Rubik,Arial,sans-serif}
#voice-root::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:0;
  background-image:linear-gradient(rgba(255,60,80,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,60,80,.045) 1px,transparent 1px);
  background-size:46px 46px;
  -webkit-mask:radial-gradient(ellipse at 50% 28%,#000 0%,transparent 78%);
          mask:radial-gradient(ellipse at 50% 28%,#000 0%,transparent 78%)}
#voice-root>*{position:relative;z-index:1}
#voice-root h2{margin:0;font-size:15px;font-weight:600;letter-spacing:5px;
  color:#ff6470;text-shadow:0 0 20px rgba(255,60,80,.6)}
#voice-root .v-sub{font-size:12px;color:#9a8b90;margin-top:-8px;text-align:center;letter-spacing:.3px}
@keyframes v-rot{to{transform:rotate(360deg)}}
@keyframes v-rotr{to{transform:rotate(-360deg)}}
@keyframes v-pulse{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.5);opacity:1}}
#v-orb{width:208px;height:208px;border-radius:50%;cursor:pointer;position:relative;
  margin-top:16px;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 42% 34%,#ff8585 0%,#ff2438 16%,#c20f24 34%,#6e0a16 56%,#26060b 78%,#070203 100%);
  box-shadow:0 0 80px rgba(255,40,60,.55),0 0 170px rgba(255,20,40,.32),inset -16px -22px 64px rgba(0,0,0,.78),inset 16px 18px 48px rgba(255,120,120,.16);
  transition:transform .4s cubic-bezier(.2,.8,.2,1),box-shadow .4s ease}
#v-orb::after{content:'';position:absolute;top:10%;left:23%;width:44%;height:32%;border-radius:50%;
  background:radial-gradient(circle at 42% 42%,rgba(255,255,255,.55),transparent 70%);filter:blur(3px);pointer-events:none}
#v-orb::before{content:'';position:absolute;inset:-28px;border-radius:50%;z-index:-1;
  background:repeating-conic-gradient(from 0deg,rgba(255,75,95,.92) 0deg 2.2deg,transparent 2.2deg 13deg);
  -webkit-mask:radial-gradient(circle,transparent 62%,#000 64%,#000 70%,transparent 72%);
          mask:radial-gradient(circle,transparent 62%,#000 64%,#000 70%,transparent 72%);
  animation:v-rot 32s linear infinite}
#v-orb .v-ring{position:absolute;border-radius:50%;pointer-events:none}
#v-orb .v-ring-a{inset:13px;border:1.5px dashed rgba(255,90,105,.5);animation:v-rot 20s linear infinite}
#v-orb .v-ring-b{inset:36px;border:1.5px solid rgba(255,150,150,.28);
  border-top-color:rgba(255,95,95,.95);border-right-color:rgba(255,95,95,.6);animation:v-rotr 10s linear infinite}
#v-orb .v-core{width:56px;height:56px;border-radius:50%;
  background:radial-gradient(circle,#fff 0%,#ffd2ca 36%,#ff4a4a 76%,#c81022 100%);
  box-shadow:0 0 32px #fff,0 0 76px #ff5e5e,0 0 120px rgba(255,40,60,.65)}
#voice-root.listening #v-orb,#voice-root.thinking #v-orb,#voice-root.speaking #v-orb{transform:scale(1.1)}
#voice-root.listening #v-orb{box-shadow:0 0 120px rgba(255,40,60,.82),0 0 240px rgba(255,20,40,.5),inset -16px -22px 64px rgba(0,0,0,.78),inset 16px 18px 48px rgba(255,120,120,.24)}
#voice-root.speaking #v-orb{box-shadow:0 0 140px rgba(255,60,80,.95),0 0 260px rgba(255,30,50,.6),inset -16px -22px 64px rgba(0,0,0,.78),inset 16px 18px 48px rgba(255,140,140,.3)}
#voice-root.listening #v-orb::before{animation-duration:11s}
#voice-root.speaking #v-orb::before{animation-duration:4.5s}
#voice-root.thinking #v-orb .v-ring-a{animation-duration:3.5s}
#voice-root.speaking #v-orb .v-ring-b{animation-duration:4s}
#voice-root.listening #v-orb .v-core{animation:v-pulse 1.2s ease-in-out infinite}
#voice-root.thinking #v-orb .v-core{animation:v-pulse .9s ease-in-out infinite}
#voice-root.speaking #v-orb .v-core{animation:v-pulse .5s ease-in-out infinite}
#v-state{font-size:11px;font-weight:700;height:16px;letter-spacing:3px;text-transform:uppercase}
#v-state.listening{color:#ff7a86}#v-state.thinking{color:#ffb24d}#v-state.speaking{color:#ff5566}
#v-status{font-size:12px;min-height:15px;text-align:center;color:#9a8b90}
#v-status.err{color:#ff8da0}
#v-wake{display:flex;align-items:center;gap:9px;cursor:pointer;border-radius:22px;
  padding:8px 16px;font-size:12.5px;color:#f3eef0;transition:all .2s;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
  -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
#v-wake.on{border-color:rgba(255,60,80,.55);background:rgba(255,40,60,.12);box-shadow:0 0 22px rgba(255,40,60,.22)}
#v-wake .v-dot{width:9px;height:9px;border-radius:50%;background:#5a4044}
#v-wake.on .v-dot{background:#ff4d5e;box-shadow:0 0 10px #ff4d5e;animation:v-pulse 1.5s ease-in-out infinite}
#v-ctl{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:center}
#v-stop{border:none;color:#fff;border-radius:22px;cursor:pointer;font-size:12.5px;font-weight:700;
  padding:9px 18px;letter-spacing:.5px;background:linear-gradient(135deg,#ff2d4a,#9a0f1f);
  box-shadow:0 4px 18px rgba(255,40,60,.4);transition:transform .15s}
#v-stop:hover{transform:translateY(-1px)}
#v-transcript{width:100%;max-width:560px;overflow-y:auto;max-height:26vh;
  display:flex;flex-direction:column;gap:8px;padding:4px}
.v-line{padding:9px 13px;border-radius:14px;font-size:13.5px;line-height:1.55;max-width:88%;
  white-space:pre-wrap;word-break:break-word}
.v-line.user{background:linear-gradient(135deg,#ff3b4d,#bf1527);color:#fff;align-self:flex-start;
  border-bottom-right-radius:4px;box-shadow:0 4px 16px rgba(255,40,60,.3)}
.v-line.bot{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);color:#f3eef0;
  align-self:flex-end;border-bottom-left-radius:4px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.v-line.sys{background:none;color:#9a8b90;font-size:12px;align-self:center}
#v-row{width:100%;max-width:560px;display:flex;gap:9px}
#v-input{flex:1;border-radius:14px;color:#f3eef0;padding:12px 15px;font-size:14px;font-family:inherit;direction:rtl;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
  -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
#v-input:focus{outline:none;border-color:rgba(255,60,80,.7);box-shadow:0 0 20px rgba(255,40,60,.22)}
#v-row button{border:none;color:#fff;border-radius:14px;cursor:pointer;font-size:14px;font-weight:600;
  padding:0 18px;height:46px;background:linear-gradient(135deg,#ff3b4d,#bf1527);
  box-shadow:0 4px 18px rgba(255,40,60,.35);transition:transform .15s}
#v-row button:hover{transform:translateY(-1px)}
#v-clear{cursor:pointer;font-size:12px;padding:7px 15px;border-radius:11px;color:#9a8b90;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}
#v-clear:hover{color:#f3eef0;border-color:rgba(255,60,80,.5)}
#v-suggest{width:100%;max-width:560px;border-radius:18px;padding:15px 16px;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
  -webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}
#v-suggest h3{margin:0 0 4px;font-size:13px;font-weight:600;color:#ff6470}
#v-suggest .v-grp{font-size:10px;color:#9a8b90;margin:11px 0 6px;font-weight:700;letter-spacing:1.5px}
#v-suggest .v-chips{display:flex;flex-wrap:wrap;gap:7px}
#v-suggest .v-chip{border-radius:11px;padding:7px 12px;font-size:12px;cursor:pointer;color:#e8dde0;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);transition:all .15s}
#v-suggest .v-chip:hover{border-color:rgba(255,60,80,.6);background:rgba(255,40,60,.14);color:#fff;transform:translateY(-1px)}
/* floating arc-reactor orb on every page */
#v-float{position:fixed;left:24px;bottom:104px;z-index:999998;width:66px;height:66px;
  border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(circle at 42% 34%,#ff8585 0%,#ff2438 18%,#9e0c1c 48%,#26060b 78%,#070203 100%);
  box-shadow:0 0 30px rgba(255,40,60,.6),0 8px 26px rgba(0,0,0,.6);transition:transform .2s}
#v-float:hover{transform:scale(1.1)}
#v-float .v-core{width:18px;height:18px;border-radius:50%;
  background:radial-gradient(circle,#fff,#ffd2ca 45%,#ff4a4a 100%);box-shadow:0 0 16px #fff,0 0 30px #ff5e5e}
#v-float::before{content:'';position:absolute;inset:-7px;border-radius:50%;z-index:-1;
  background:repeating-conic-gradient(from 0deg,rgba(255,75,95,.92) 0deg 3deg,transparent 3deg 15deg);
  -webkit-mask:radial-gradient(circle,transparent 58%,#000 60%,#000 80%,transparent 82%);
          mask:radial-gradient(circle,transparent 58%,#000 60%,#000 80%,transparent 82%);
  animation:v-rot 26s linear infinite}
#v-float.armed{box-shadow:0 0 30px rgba(255,40,60,.6),0 8px 26px rgba(0,0,0,.6),0 0 0 2px rgba(255,75,95,.6)}
#v-float.active{box-shadow:0 0 48px rgba(255,55,75,.95),0 8px 26px rgba(0,0,0,.6)}
#v-float.active::before{animation-duration:7s}
#v-float.active .v-core{animation:v-pulse 1s ease-in-out infinite}
#v-float{touch-action:none;-webkit-user-select:none;user-select:none}
#v-float.dragging{transition:none;transform:scale(1.12);cursor:grabbing}
/* radial action menu — voice / text chat / hide */
#v-menu{position:fixed;z-index:999999;display:none;flex-direction:column;gap:6px;
  background:rgba(22,8,12,.97);border:1px solid rgba(255,75,95,.35);border-radius:14px;
  padding:8px;box-shadow:0 14px 40px rgba(0,0,0,.62),0 0 30px rgba(255,40,60,.22);
  font-family:'Heebo',sans-serif;direction:rtl}
#v-menu.show{display:flex;animation:v-menu-in .16s ease}
@keyframes v-menu-in{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)}}
#v-menu button{display:flex;align-items:center;gap:9px;background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.09);color:#f1e7e9;border-radius:10px;padding:10px 14px;
  font-size:13px;font-family:inherit;cursor:pointer;white-space:nowrap;transition:all .14s}
#v-menu button:hover{background:rgba(255,40,60,.18);border-color:rgba(255,75,95,.5);color:#fff}
#v-menu button .vm-i{font-size:16px}
/* edge tab to bring the orb back after hiding */
#v-restore{position:fixed;left:0;bottom:118px;z-index:999998;width:28px;height:52px;
  border-radius:0 13px 13px 0;cursor:pointer;display:none;align-items:center;justify-content:center;
  background:radial-gradient(circle at 62% 40%,#ff7a7a,#9e0c1c 68%,#26060b);
  box-shadow:0 4px 18px rgba(0,0,0,.5),0 0 18px rgba(255,40,60,.5);font-size:15px}
#v-restore.show{display:flex}
@media(max-width:560px){
  #voice-root{padding:20px 12px 26px;border-radius:16px;gap:11px}
  #v-orb{width:170px;height:170px;margin-top:8px}
  #v-orb .v-core{width:46px;height:46px}
  #v-transcript{max-height:30vh}
  #v-float{left:16px;bottom:90px;width:60px;height:60px}
  #v-row{flex-wrap:wrap}
}
`;
    document.head.appendChild(s);
  }

  function buildFloatingOrb(){
    if (document.getElementById('v-float')) return;
    const f = document.createElement('div');
    f.id = 'v-float';
    f.title = 'זורו — גרור להזזה · הקש לתפריט';
    f.innerHTML = '<div class="v-core"></div>';
    document.body.appendChild(f);
    floatEl = f;

    // ── action menu: voice · text chat · hide ──
    const menu = document.createElement('div');
    menu.id = 'v-menu';
    menu.innerHTML =
      '<button data-act="voice"><span class="vm-i">🎤</span>שיחה קולית</button>' +
      '<button data-act="chat"><span class="vm-i">⌨️</span>צ\'אט בכתב</button>' +
      '<button data-act="sync"><span class="vm-i">🔄</span>סנכרן עכשיו</button>' +
      '<button data-act="import"><span class="vm-i">📥</span>ייבוא תוכן (פוסט/משרה/פתק)</button>' +
      '<button data-act="voicesel"><span class="vm-i">🗣️</span>קול: <span id="vm-voice-label">' + ttsVoiceLabel() + '</span></button>' +
      '<button data-act="hide"><span class="vm-i">🙈</span>הסתר את זורו</button>';
    document.body.appendChild(menu);

    // ── edge tab to restore the orb after hiding ──
    const restore = document.createElement('div');
    restore.id = 'v-restore';
    restore.textContent = '☀';
    restore.title = 'החזר את זורו';
    document.body.appendChild(restore);

    function hideMenu(){ menu.classList.remove('show'); }
    function showMenu(){
      const r = f.getBoundingClientRect();
      menu.style.visibility = 'hidden';
      menu.classList.add('show');
      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      let left = r.left + r.width / 2 - mw / 2;
      let top  = r.top - mh - 10;
      if (top < 8) top = r.bottom + 10;                       // flip below if no room
      left = Math.max(8, Math.min(left, innerWidth - mw - 8));
      top  = Math.max(8, Math.min(top,  innerHeight - mh - 8));
      menu.style.left = left + 'px';
      menu.style.top  = top + 'px';
      menu.style.visibility = 'visible';
    }
    menu.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      hideMenu();
      const act = b.dataset.act;
      if (act === 'voice'){
        unlockAudio();
        try { if (window.goPage) window.goPage('voice'); } catch (e) {}
        setTimeout(() => { if (!conversing) startConversation(); }, 180);
      } else if (act === 'chat'){
        try { if (window.Assistant && window.Assistant.open) window.Assistant.open(); } catch (e) {}
      } else if (act === 'sync'){
        try { if (typeof window.posSyncNow === 'function') window.posSyncNow(); } catch (e) {}
      } else if (act === 'import'){
        try { if (typeof window.posOpenImport === 'function') window.posOpenImport(); } catch (e) {}
      } else if (act === 'voicesel'){
        ttsVoice = (ttsVoice === 'avri') ? 'hila' : 'avri';
        try { localStorage.setItem(TTS_VOICE_KEY, ttsVoice); } catch (e) {}
        const lbl = document.getElementById('vm-voice-label'); if (lbl) lbl.textContent = ttsVoiceLabel();
        ttsApiDead = false;                 // re-enable neural TTS for the new voice
        unlockAudio();
        try { speak(ttsVoice === 'hila' ? 'שלום, אני אביאלה' : 'שלום, אני זורו'); } catch (e) {}
      } else if (act === 'hide'){
        f.style.display = 'none';
        restore.classList.add('show');
        try { localStorage.setItem('pos_orb_hidden', '1'); } catch (e) {}
      }
    });
    document.addEventListener('click', e => {
      if (menu.classList.contains('show') && !menu.contains(e.target) && e.target !== f)
        hideMenu();
    });
    restore.addEventListener('click', () => {
      f.style.display = '';
      restore.classList.remove('show');
      try { localStorage.removeItem('pos_orb_hidden'); } catch (e) {}
    });

    // ── drag (move anywhere) + tap (open menu) ──
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    function applyPos(x, y){
      const m = 8, w = f.offsetWidth || 66, h = f.offsetHeight || 66;
      x = Math.max(m, Math.min(x, innerWidth  - w - m));
      y = Math.max(m, Math.min(y, innerHeight - h - m));
      f.style.left = x + 'px';  f.style.top = y + 'px';
      f.style.right = 'auto';   f.style.bottom = 'auto';
    }
    function savePos(){
      try {
        localStorage.setItem('pos_orb_pos',
          JSON.stringify({ x: parseFloat(f.style.left), y: parseFloat(f.style.top) }));
      } catch (e) {}
    }
    function onDown(e){
      const p = e.touches ? e.touches[0] : e;
      dragging = true; moved = false;
      sx = p.clientX; sy = p.clientY;
      const r = f.getBoundingClientRect(); ox = r.left; oy = r.top;
      f.classList.add('dragging');
    }
    function onMove(e){
      if (!dragging) return;
      const p = e.touches ? e.touches[0] : e;
      const dx = p.clientX - sx, dy = p.clientY - sy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (moved){ applyPos(ox + dx, oy + dy); if (e.cancelable) e.preventDefault(); }
    }
    function onUp(){
      if (!dragging) return;
      dragging = false;
      f.classList.remove('dragging');
      if (moved){ savePos(); return; }
      // pure tap
      unlockAudio();
      if (speaking){ interruptSpeak(); hideMenu(); return; }   // tap mid-speech = stop talking & keep listening
      if (conversing){ fullStop(true); hideMenu(); return; }   // tap while listening = stop conversation
      menu.classList.contains('show') ? hideMenu() : showMenu();
    }
    f.addEventListener('mousedown', onDown);
    f.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);

    // restore saved position / hidden state
    try {
      const saved = JSON.parse(localStorage.getItem('pos_orb_pos') || 'null');
      if (saved && typeof saved.x === 'number') applyPos(saved.x, saved.y);
      if (localStorage.getItem('pos_orb_hidden') === '1'){
        f.style.display = 'none';
        restore.classList.add('show');
      }
    } catch (e) {}
    window.addEventListener('resize', () => {
      if (f.style.left) applyPos(parseFloat(f.style.left), parseFloat(f.style.top));
    });

    syncWakeUI();
  }

  function render(){
    const host = document.getElementById('voice-root');
    if (!host) return;
    injectStyles();
    rootEl = host;
    const sug = SUGGESTIONS.map(g =>
      '<div class="v-grp">' + esc(g.group) + '</div><div class="v-chips">' +
      g.items.map((it,ix) => '<span class="v-chip" data-g="'+SUGGESTIONS.indexOf(g)+'" data-i="'+ix+'">' +
        esc(it.t.trim()) + (it.run?'':' …') + '</span>').join('') + '</div>'
    ).join('');
    host.innerHTML =
      '<h2>◆ זורו ◆</h2>' +
      '<div class="v-sub">הקש על השמש ודבר — או הפעל "האזנה לשם" ופשוט קרא לי בשם "זורו".</div>' +
      '<div id="v-orb" title="הקש כדי להתחיל / לעצור"><span class="v-ring v-ring-a"></span><span class="v-ring v-ring-b"></span><div class="v-core"></div></div>' +
      '<div id="v-state"></div>' +
      '<div id="v-status"></div>' +
      '<div id="v-ctl"><div id="v-wake"><span class="v-dot"></span><span id="v-wake-lbl">האזנה לשם "זורו"</span></div>' +
      '<button id="v-stop">⛔ עצור את זורו</button></div>' +
      '<div id="v-transcript"></div>' +
      '<div id="v-row">' +
        '<input id="v-input" placeholder="או כתוב כאן…" />' +
        '<button id="v-send">שלח</button>' +
      '</div>' +
      '<button id="v-clear">נקה שיחה</button>' +
      '<div id="v-suggest"><h3>💡 הצעות לשימוש — מה אני יכול לעשות בשבילך</h3>' + sug + '</div>';

    orbEl        = host.querySelector('#v-orb');
    stateEl      = host.querySelector('#v-state');
    statusEl     = host.querySelector('#v-status');
    transcriptEl = host.querySelector('#v-transcript');
    inputEl      = host.querySelector('#v-input');
    wakeBtn      = host.querySelector('#v-wake');

    orbEl.addEventListener('click', () => { unlockAudio(); if (speaking) interruptSpeak(); else toggleConversation(); });
    wakeBtn.addEventListener('click', () => { unlockAudio(); toggleWake(); });
    host.querySelector('#v-stop').addEventListener('click', () => fullStop(true));
    host.querySelector('#v-send').addEventListener('click', sendTyped);
    host.querySelector('#v-clear').addEventListener('click', clearMem);
    inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') sendTyped(); });
    host.querySelectorAll('.v-chip').forEach(ch => ch.addEventListener('click', () => {
      const g = SUGGESTIONS[+ch.dataset.g], it = g && g.items[+ch.dataset.i];
      if (!it) return;
      unlockAudio();
      if (it.run) { handleUtterance(it.t.trim(), 'text'); }
      else { inputEl.value = it.t; inputEl.focus(); }
    }));

    renderTranscript();
    setState(conversing ? 'listening' : 'idle');
    syncWakeUI();
  }

  async function sendTyped(){
    if (!inputEl || !inputEl.value.trim()) return;
    const v = inputEl.value.trim();
    inputEl.value = '';
    unlockAudio();
    handleUtterance(v, 'text');
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
    if (floatEl) floatEl.classList.toggle('active', conversing || s === 'thinking' || s === 'speaking');
  }
  function syncWakeUI(){
    if (wakeBtn){
      wakeBtn.classList.toggle('on', wakeArmed);
      const lbl = document.getElementById('v-wake-lbl');
      if (lbl) lbl.textContent = wakeArmed ? 'מקשיב לשם "זורו" — פעיל' : 'האזנה לשם "זורו" — כבוי';
      if (!SR){ wakeBtn.style.display = 'none'; }
    }
    if (floatEl) floatEl.classList.toggle('armed', wakeArmed);
  }
  function setStatus(msg, kind){
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = kind === 'err' ? 'err' : '';
  }
  function renderTranscript(){
    if (!transcriptEl) return;
    transcriptEl.innerHTML = '';
    if (!memory.length) addLine('sys', 'היי רואי, אני זורו. הקש על השמש או קרא לי בשם.');
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
  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ──────────────────────────────────────────────────────────────────────
  //  PUBLIC API + BOOT
  // ──────────────────────────────────────────────────────────────────────
  window.VoiceMode = {
    version: VERSION,
    render: render,
    start: startConversation,
    stop: stopConversation,
    armWake: armWake,
    disarmWake: disarmWake,
    clearMemory: clearMem
  };

  function boot(){
    loadMem();
    injectStyles();
    buildFloatingOrb();
    // auto-arm the wake word if mic permission is already granted
    if (SR) {
      let want = true;
      try { want = localStorage.getItem(WAKE_KEY) !== '0'; } catch (e) {}
      if (want && navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name:'microphone' })
          .then(p => { if (p.state === 'granted') armWake(); })
          .catch(() => {});
      }
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && conversing) stopConversation();
    });
    console.log('%cVoice Mode v' + VERSION + ' — wake word ' + (SR ? 'available' : 'unavailable (no SpeechRecognition)'),
      'color:#ff8a3d;font-weight:bold');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
