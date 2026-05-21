/* ============================================================================
 * agent.js — Personal OS · Agent Command Center (Phase 1 — WRAP ZORO)
 * ----------------------------------------------------------------------------
 * An additive orchestration layer that WRAPS the existing Zoro assistant.
 * It does NOT modify Zoro, auth, routing, or any existing page.
 *
 * Architecture (inspired by OpenJarvis 5-primitive model — reference only,
 * no code copied from any open-source project):
 *   • Agent Router       — classifyIntent / selectDomainAgent / route
 *   • Tool Registry      — wraps window.POS, adds risk + schema + dry-run
 *   • Approval Layer     — Level 0 immediate · 1 light · 2 preview · 3 blocked
 *   • Memory Store       — personal_os_agent_* localStorage keys
 *   • Command Center UI  — page-agent, rendered here (no React / no build)
 *
 * Exposes: window.AgentRuntime
 * ========================================================================== */
(function () {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────
  //  0. STORAGE
  // ──────────────────────────────────────────────────────────────────────
  const MEM_KEY     = 'personal_os_agent_memory';
  const PENDING_KEY = 'personal_os_agent_pending_actions';
  const AUDIT_KEY   = 'personal_os_agent_audit_log';
  const MODEL       = 'claude-sonnet-4-6';

  function lsGet(k, def) {
    try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; }
    catch (e) { return def; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ──────────────────────────────────────────────────────────────────────
  //  1. MEMORY STORE
  // ──────────────────────────────────────────────────────────────────────
  const MEMORY_TYPES = [
    'user_profile', 'goals', 'preferences', 'recurring_schedule_rules',
    'active_projects', 'project_decisions', 'open_loops',
    'job_search_preferences', 'apartment_search_preferences',
    'upselles_context', 'notes', 'important_links'
  ];
  const MEMORY_LABELS = {
    user_profile:'פרופיל', goals:'מטרות', preferences:'העדפות',
    recurring_schedule_rules:'כללי לוז קבועים', active_projects:'פרויקטים פעילים',
    project_decisions:'החלטות פרויקט', open_loops:'קצוות פתוחים',
    job_search_preferences:'העדפות חיפוש עבודה', apartment_search_preferences:'העדפות חיפוש דירה',
    upselles_context:'הקשר Upselles', notes:'פתקים', important_links:'קישורים חשובים'
  };

  function readMemory() {
    const m = lsGet(MEM_KEY, null);
    if (!m || typeof m !== 'object') { const init = {}; MEMORY_TYPES.forEach(t => init[t] = []); return init; }
    MEMORY_TYPES.forEach(t => { if (!Array.isArray(m[t])) m[t] = []; });
    return m;
  }
  function writeMemory(m) { lsSet(MEM_KEY, m); }
  function addMemory(type, item) {
    if (MEMORY_TYPES.indexOf(type) < 0) type = 'notes';
    const m = readMemory();
    m[type].push({ text: typeof item === 'string' ? item : (item.text || JSON.stringify(item)), ts: new Date().toISOString() });
    writeMemory(m);
    return 'נשמר בזיכרון (' + (MEMORY_LABELS[type] || type) + ')';
  }
  function removeMemory(type, idx) {
    const m = readMemory();
    if (m[type] && m[type][idx] !== undefined) { m[type].splice(idx, 1); writeMemory(m); }
  }
  function summarizeMemory() {
    const m = readMemory();
    const parts = [];
    MEMORY_TYPES.forEach(t => {
      if (m[t] && m[t].length) parts.push((MEMORY_LABELS[t] || t) + ': ' + m[t].map(x => x.text).join('; '));
    });
    return parts.length ? parts.join('\n') : 'אין עדיין זיכרון שמור.';
  }

  // ──────────────────────────────────────────────────────────────────────
  //  2. AUDIT LOG
  // ──────────────────────────────────────────────────────────────────────
  function audit(entry) {
    const log = lsGet(AUDIT_KEY, []);
    log.unshift(Object.assign({ ts: new Date().toISOString() }, entry));
    lsSet(AUDIT_KEY, log.slice(0, 250));
  }
  function getAudit() { return lsGet(AUDIT_KEY, []); }

  // ──────────────────────────────────────────────────────────────────────
  //  3. TOOL REGISTRY — wraps window.POS, adds risk / schema / dry-run.
  //     window.POS is NOT duplicated — only referenced.
  // ──────────────────────────────────────────────────────────────────────
  const P = () => window.POS;

  const TOOLS = {
    // ── Level 1 — create new (light approval) ──
    create_task: {
      label:'יצירת משימה', riskLevel:1, area:'משימות',
      schema:{ text:{type:'string',required:true}, proj:{type:'string'}, cat:{type:'string'} },
      dryRun:a => 'תיווצר משימה חדשה: "' + (a.text||'') + '"' + (a.proj ? ' · פרויקט ' + a.proj : ''),
      run:a => P().addTask(a)
    },
    create_reminder: {
      label:'יצירת תזכורת', riskLevel:1, area:'תזכורות',
      schema:{ text:{type:'string',required:true}, date:{type:'string'}, time:{type:'string'} },
      dryRun:a => 'תיווצר תזכורת: "' + (a.text||'') + '"' + (a.date ? ' ל-' + a.date : '') + (a.time ? ' ' + a.time : ''),
      run:a => P().addReminder(a)
    },
    create_schedule_block: {
      label:'בלוק בלוז', riskLevel:1, area:'לוז שבועי',
      schema:{ title:{type:'string',required:true}, date:{type:'string',required:true}, time:{type:'string'} },
      dryRun:a => 'ייווצר בלוק בלוז: "' + (a.title||'') + '" ב-' + (a.date||'?') + (a.time ? ' בשעה ' + a.time : ''),
      run:a => P().addEvent(a)
    },
    create_note: {
      label:'יצירת פתק', riskLevel:1, area:'פתקים',
      schema:{ title:{type:'string'}, content:{type:'string',required:true} },
      dryRun:a => 'יישמר פתק: "' + ((a.content||'').slice(0,60)) + '"',
      run:a => P().addNote(a)
    },
    create_goal: {
      label:'יצירת מטרה', riskLevel:1, area:'מטרות',
      schema:{ text:{type:'string',required:true}, emoji:{type:'string'} },
      dryRun:a => 'תיווצר מטרה: "' + (a.text||'') + '"',
      run:a => P().addGoal(a)
    },
    create_idea: {
      label:'שמירת רעיון', riskLevel:1, area:'רעיונות',
      schema:{ text:{type:'string',required:true}, cat:{type:'string'} },
      dryRun:a => 'יישמר רעיון: "' + (a.text||'') + '"',
      run:a => P().addIdea(a)
    },
    create_journal: {
      label:'רשומת יומן', riskLevel:1, area:'יומן',
      schema:{ text:{type:'string',required:true} },
      dryRun:a => 'תיווצר רשומת יומן: "' + ((a.text||'').slice(0,60)) + '"',
      run:a => P().addJournal(a)
    },
    create_job_opportunity: {
      label:'הוספת משרה', riskLevel:1, area:'חיפוש עבודה',
      schema:{ title:{type:'string',required:true}, company:{type:'string'}, status:{type:'string'}, link:{type:'string'} },
      dryRun:a => 'תתווסף משרה למעקב: "' + (a.title||'') + '"' + (a.company ? ' · ' + a.company : ''),
      run:a => P().addJob(a)
    },
    create_habit: {
      label:'יצירת הרגל', riskLevel:1, area:'הרגלים',
      schema:{ name:{type:'string',required:true} },
      dryRun:a => 'ייווצר הרגל: "' + (a.name||'') + '"',
      run:a => P().addHabit(a)
    },
    // ── Level 1 — reversible toggle/append (runs automatically) ──
    complete_task: {
      label:'סימון משימה כבוצעה', riskLevel:1, area:'משימות',
      schema:{ query:{type:'string',required:true} },
      dryRun:a => 'תסומן כבוצעה המשימה התואמת ל-"' + (a.query||'') + '"',
      run:a => P().completeTask(a)
    },
    log_habit: {
      label:'תיעוד הרגל', riskLevel:1, area:'הרגלים',
      schema:{ name:{type:'string',required:true} },
      dryRun:a => 'יתועד ההרגל "' + (a.name||'') + '" כבוצע היום',
      run:a => P().logHabit(a)
    },
    // ── Level 2 — overwrites existing data (preview + approval required) ──
    update_project: {
      label:'עדכון התקדמות פרויקט', riskLevel:2, area:'פרויקטים',
      schema:{ id:{type:'string',required:true}, progress:{type:'number',required:true} },
      dryRun:a => 'התקדמות הפרויקט "' + (a.id||'') + '" תעודכן ל-' + a.progress + '%',
      run:a => P().updateProject(a)
    },
    update_memory: {
      label:'עדכון זיכרון הסוכן', riskLevel:2, area:'זיכרון',
      schema:{ type:{type:'string',required:true}, item:{type:'string',required:true} },
      dryRun:a => 'ייווסף לזיכרון (' + (MEMORY_LABELS[a.type]||a.type) + '): "' + (a.item||'') + '"',
      run:a => addMemory(a.type, a.item)
    },
    // ── Level 0 — navigation only (immediate) ──
    navigate: {
      label:'ניווט לעמוד', riskLevel:0, area:'ניווט',
      schema:{ page:{type:'string',required:true} },
      dryRun:a => 'ניווט לעמוד "' + (a.page||'') + '"',
      run:a => P().navigate(a.page)
    },
    // ── Level 3 — BLOCKED in this phase ──
    delete_data:      { label:'מחיקת נתונים',        riskLevel:3, blocked:true, area:'—' },
    send_email:       { label:'שליחת מייל',          riskLevel:3, blocked:true, area:'—' },
    send_message:     { label:'שליחת הודעה',         riskLevel:3, blocked:true, area:'—' },
    scrape_web:       { label:'גריפת אתרים',         riskLevel:3, blocked:true, area:'—' },
    execute_code:     { label:'הרצת קוד',            riskLevel:3, blocked:true, area:'—' },
    external_account: { label:'גישה לחשבון חיצוני',  riskLevel:3, blocked:true, area:'—' },
    make_payment:     { label:'ביצוע תשלום',         riskLevel:3, blocked:true, area:'—' }
  };

  const RISK = {
    0:{ label:'מיידי',          color:'#7c8aa0' },
    1:{ label:'בוצע אוטומטית',  color:'#42e695' },
    2:{ label:'דורש אישור',     color:'#ffb454' },
    3:{ label:'חסום',           color:'#ff5d6c' }
  };

  // Tolerant aliases — if the model uses a slightly different tool name
  // (e.g. add_task instead of create_task) it still maps correctly
  // instead of being wrongly shown as "blocked".
  const TOOL_ALIASES = {
    add_task:'create_task', new_task:'create_task',
    add_reminder:'create_reminder', new_reminder:'create_reminder',
    add_event:'create_schedule_block', create_event:'create_schedule_block',
    add_schedule_block:'create_schedule_block', schedule_block:'create_schedule_block',
    add_note:'create_note', new_note:'create_note',
    add_goal:'create_goal', new_goal:'create_goal',
    add_idea:'create_idea', new_idea:'create_idea',
    add_journal:'create_journal', journal_entry:'create_journal',
    add_job:'create_job_opportunity', add_job_opportunity:'create_job_opportunity',
    add_habit:'create_habit', new_habit:'create_habit',
    task_complete:'complete_task', mark_complete:'complete_task', mark_done:'complete_task',
    go_to:'navigate', open_page:'navigate'
  };

  function validateAction(act) {
    const t = TOOLS[act.tool];
    if (!t) return { ok:false, reason:'כלי לא מוכר: ' + act.tool };
    if (t.blocked || t.riskLevel >= 3) return { ok:false, reason:'פעולה חסומה (Level 3)' };
    const sc = t.schema || {};
    for (const k in sc) {
      if (sc[k].required) {
        const v = (act.args || {})[k];
        if (v === undefined || v === null || v === '') return { ok:false, reason:'חסר שדה חובה: ' + k };
      }
    }
    return { ok:true };
  }
  function previewAction(act) {
    const t = TOOLS[act.tool];
    if (!t) return 'כלי לא מוכר';
    if (t.blocked) return 'פעולה חסומה — לא תבוצע';
    try { return t.dryRun ? t.dryRun(act.args || {}) : (t.label || act.tool); }
    catch (e) { return t.label || act.tool; }
  }
  function executeApprovedAction(act) {
    const v = validateAction(act);
    if (!v.ok) { audit({ type:'execute', tool:act.tool, status:'failed', error:v.reason }); return { ok:false, msg:v.reason }; }
    let result;
    try { result = TOOLS[act.tool].run(act.args || {}); }
    catch (e) { audit({ type:'execute', tool:act.tool, status:'failed', error:e.message }); return { ok:false, msg:'שגיאה: ' + e.message }; }
    audit({ type:'execute', tool:act.tool, args:act.args, result:String(result), status:'success' });
    return { ok:true, msg:String(result) };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  4. AGENT ROUTER — intent classification + domain agents
  // ──────────────────────────────────────────────────────────────────────
  const AGENTS = {
    ScheduleAgent:    { label:'סוכן לוז',        purpose:'תכנון יום ושבוע, בלוקים של זמן, איזון עומסים' },
    TaskAgent:        { label:'סוכן משימות',     purpose:'ניהול משימות, עדיפויות וקצוות פתוחים' },
    ProjectAgent:     { label:'סוכן פרויקטים',   purpose:'מעקב סטטוס פרויקטים והצעת צעדים הבאים' },
    UpsellesAgent:    { label:'סוכן Upselles',   purpose:'ייעוץ מוצר ופיתוח ל-Upselles' },
    JobSearchAgent:   { label:'סוכן עבודה',      purpose:'קידום חיפוש עבודה ופייפליין משרות' },
    ApartmentAgent:   { label:'סוכן דירה',       purpose:'ארגון חיפוש דירה ומעקב לידים' },
    ResearchAgent:    { label:'סוכן מחקר',       purpose:'מחקר, ניתוח וסיכום מידע' },
    NotesAgent:       { label:'סוכן הערות',      purpose:'הפיכת הערות למשימות ובלוקים' },
    FitnessAgent:     { label:'סוכן כושר',       purpose:'תכנון אימונים ותזונה' },
    PromptBuilderAgent:{label:'בונה Prompts',    purpose:'בניית prompts מובנים ל-Claude Code' },
    PersonalCoachAgent:{label:'מאמן אישי',       purpose:'מיקוד, מוטיבציה ותעדוף ביצועים' }
  };
  const INTENT_AGENT = {
    schedule_planning:'ScheduleAgent', task_management:'TaskAgent',
    project_management:'ProjectAgent', upselles_work:'UpsellesAgent',
    job_search:'JobSearchAgent', apartment_search:'ApartmentAgent',
    research:'ResearchAgent', notes_to_tasks:'NotesAgent',
    fitness_planning:'FitnessAgent', prompt_generation:'PromptBuilderAgent',
    finance_personal:'TaskAgent', general_chat:'PersonalCoachAgent'
  };

  function classifyIntent(cmd) {
    const t = (cmd || '').toLowerCase();
    if (/תכנן.*(שבוע)|plan.*week/.test(t))                       return 'schedule_planning';
    if (/תכנן.*(יום)|plan.*day|מה לעשות היום|סדר.*יום/.test(t))    return 'schedule_planning';
    if (/לוז|בלוק|schedule|מערכת שעות/.test(t))                   return 'schedule_planning';
    if (/upselles|אפסל/.test(t))                                  return 'upselles_work';
    if (/עבוד|משרה|משרות|job|קריירה|cv|קורות חיים|ראיון/.test(t))  return 'job_search';
    if (/דיר|apartment|שכירות|להשכרה/.test(t))                    return 'apartment_search';
    if (/אימון|כושר|תזונה|fitness|קלורי/.test(t))                 return 'fitness_planning';
    if (/הער|notes|הפוך.*משימ|note/.test(t))                      return 'notes_to_tasks';
    if (/prompt|claude code/.test(t))                             return 'prompt_generation';
    if (/חקור|מחקר|research|נתח/.test(t))                         return 'research';
    if (/פרויקט|project/.test(t))                                 return 'project_management';
    if (/הוצא|כסף|תקציב|finance/.test(t))                         return 'finance_personal';
    if (/משימ|task|שוכח|קצוות|open loop/.test(t))                 return 'task_management';
    return 'general_chat';
  }
  function selectDomainAgent(intent) { return INTENT_AGENT[intent] || 'PersonalCoachAgent'; }

  // ──────────────────────────────────────────────────────────────────────
  //  5. THE ENGINE — call Claude, get a structured plan (propose, not execute)
  // ──────────────────────────────────────────────────────────────────────
  function buildSystemPrompt(agentKey) {
    const ag = AGENTS[agentKey] || AGENTS.PersonalCoachAgent;
    let ctx = {};
    try { ctx = (window.POS && window.POS.snapshot) ? window.POS.snapshot() : {}; } catch (e) {}
    const today = ctx.date || new Date().toISOString().split('T')[0];
    const toolList = Object.keys(TOOLS).filter(k => !TOOLS[k].blocked)
      .map(k => '- ' + k + ' (' + TOOLS[k].label + ', ' + (RISK[TOOLS[k].riskLevel].label) + ')').join('\n');

    return 'אתה ה-Agent Runtime של Personal OS — מרכז הפיקוד החכם של Roei (רואי קליין).\n' +
      'תפקידך: להבין פקודה, לסווג אותה, ולהציע פעולות מובנות. פעולות יצירה קלות ירוצו אוטומטית; פעולות שמשנות נתונים קיימים ימתינו לאישור של רואי.\n' +
      'הסוכן שנבחר: ' + ag.label + ' — ' + ag.purpose + '.\n' +
      'תאריך היום: ' + today + '. תמיד המר תאריכים יחסיים (מחר/שישי) ל-YYYY-MM-DD.\n\n' +
      'הקשר נוכחי (אל תמציא נתונים מעבר לזה):\n' + JSON.stringify(ctx) + '\n\n' +
      'זיכרון הסוכן:\n' + summarizeMemory() + '\n\n' +
      'כלים זמינים — השתמש אך ורק בשמות האלה:\n' + toolList + '\n\n' +
      'פעולות אסורות לחלוטין — לעולם אל תציע אותן. אם מבקשים — סרב בנימוס והצע חלופה בטוחה:\n' +
      'מחיקת נתונים · שליחת מיילים/הודעות · גריפת אתרים/פייסבוק/לינקדאין · הרצת קוד · גישה לחשבונות חיצוניים · תשלומים.\n\n' +
      'ענה אך ורק ב-JSON תקין יחיד, בלי טקסט נוסף ובלי סימוני קוד:\n' +
      '{"intent":"schedule_planning|task_management|project_management|job_search|apartment_search|upselles_work|research|notes_to_tasks|fitness_planning|finance_personal|general_chat|prompt_generation",' +
      '"agent":"שם הסוכן","confidence":0.0-1.0,"understanding":"מה הבנת, משפט בעברית",' +
      '"assumptions":["הנחות אם יש"],"missing":["מידע חסר אם יש"],' +
      '"reply":"תשובה קצרה וחמה בעברית לרואי","proposed_actions":[{"tool":"שם כלי","args":{},"reason":"נימוק קצר"}],' +
      '"suggestions":["2-4 המלצות פרודוקטיביות קצרות"]}\n' +
      'אם הבקשה אסורה — proposed_actions ריק, reply מסביר בנימוס + חלופה.\n' +
      'אם זו שאלה/ניתוח/בניית prompt בלבד — proposed_actions ריק, reply מכיל את התשובה המלאה.';
  }

  function parseModelJSON(text) {
    if (!text) return null;
    let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  }

  async function callModel(command, agentKey) {
    try {
      const res = await fetch('/api/claude', {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          model: MODEL, max_tokens: 1600,
          system: buildSystemPrompt(agentKey),
          messages: [{ role:'user', content: command }]
        })
      });
      if (!res.ok) return { _error:'api ' + res.status };
      const data = await res.json();
      if (data && data.error) return { _error: data.error.message || 'api error' };
      const text = data && data.content && data.content[0] ? data.content[0].text : '';
      return { _text: text };
    } catch (e) { return { _error: e.message }; }
  }

  // generateProposedActions — full router: classify → select agent → model → normalize
  async function generateProposedActions(command) {
    const intent = classifyIntent(command);
    const agentKey = selectDomainAgent(intent);
    const r = await callModel(command, agentKey);

    if (r._error) {
      return { ok:false, error:r._error,
        intent, agent:agentKey, confidence:0,
        understanding:'לא הצלחתי להתחבר למנוע ה-AI.', missing:[], assumptions:[],
        reply:'אירעה תקלת תקשורת (' + r._error + '). נסה שוב בעוד רגע.',
        actions:[], suggestions:[] };
    }
    const j = parseModelJSON(r._text) || {};
    // normalize + re-classify risk from the registry (never trust the model on risk)
    const rawActions = Array.isArray(j.proposed_actions) ? j.proposed_actions.slice(0, 12) : [];
    const actions = rawActions.map(a => {
      const toolName = TOOL_ALIASES[a.tool] || a.tool;
      const tool = TOOLS[toolName];
      const risk = tool ? tool.riskLevel : 3;
      const isBlocked = !tool || !!tool.blocked || risk >= 3;
      const act = {
        tool: toolName, args: a.args || {}, reason: a.reason || '',
        riskLevel: risk,
        area: tool ? tool.area : '—',
        blocked: isBlocked,
        status: isBlocked ? 'blocked' : 'pending'
      };
      act.preview = previewAction(act);
      return act;
    });
    // Approval model: Level 0-1 run automatically · Level 2 waits for the
    // approve click · Level 3 stays blocked. Only real overwrites need a click.
    actions.forEach(a => {
      if (!a.blocked && a.riskLevel <= 1) {
        const res = executeApprovedAction(a);
        a.status = res.ok ? 'done' : 'pending';
        a.resultMsg = res.msg;
      }
    });
    return {
      ok:true,
      intent: j.intent || intent,
      agent: j.agent || agentKey,
      confidence: typeof j.confidence === 'number' ? j.confidence : 0.7,
      understanding: j.understanding || '—',
      assumptions: Array.isArray(j.assumptions) ? j.assumptions : [],
      missing: Array.isArray(j.missing) ? j.missing : [],
      reply: j.reply || (r._text ? String(r._text).slice(0, 600) : 'בוצע.'),
      actions,
      suggestions: Array.isArray(j.suggestions) ? j.suggestions : []
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  6. WORKFLOWS
  // ──────────────────────────────────────────────────────────────────────
  const WORKFLOWS = {
    plan_day:    { label:'תכנן את היום',        instant:true,  cmd:'תכנן לי את היום — בחר 3 עדיפויות עליונות, הצע בלוקים של זמן עבודה, בלוק פוקוס אחד ובלוק הפסקה/התאוששות אחד.' },
    plan_week:   { label:'תכנן את השבוע',       instant:true,  cmd:'תכנן לי את השבוע סביב Upselles, חיפוש עבודה, אימונים ולימודים — בלוקי זמן מאוזנים לכל תחום.' },
    notes_tasks: { label:'הערות → משימות',      instant:false, cmd:'הפוך את ההערות הבאות למשימות מסודרות עם פרויקט מתאים: ' },
    upselles:    { label:'הצעד הבא ב-Upselles', instant:true,  cmd:'מה הצעד הבא ב-Upselles? תן סטטוס, קצוות פתוחים ו-3 משימות יישום הבאות.' },
    jobs:        { label:'עוזר חיפוש עבודה',    instant:true,  cmd:'עזור לי להתקדם בחיפוש העבודה — סקור את הפייפליין, מה חסר, ואילו משרות כדאי לחפש.' },
    apartment:   { label:'עוזר חיפוש דירה',     instant:true,  cmd:'עזור לי לארגן את חיפוש הדירה — קריטריונים, מעקב לידים ותזכורות המשך.' },
    open_loops:  { label:'מה אני שוכח?',        instant:true,  cmd:'סקור קצוות פתוחים — משימות באיחור, מטרות בלי לו"ז, פרויקטים בלי צעד הבא, ותזכורות חסרות תאריך.' },
    prompt:      { label:'בונה Prompt ל-Claude Code', instant:false, cmd:'בנה prompt מובנה ל-Claude Code (סוג: Action) עבור: ' }
  };

  // ──────────────────────────────────────────────────────────────────────
  //  7. STATE
  // ──────────────────────────────────────────────────────────────────────
  const state = { busy:false, result:null };

  // ──────────────────────────────────────────────────────────────────────
  //  8. UI
  // ──────────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function injectStyles() {
    if (document.getElementById('agent-css')) return;
    const s = document.createElement('style');
    s.id = 'agent-css';
    s.textContent = `
#agent-root{--ac:#00d4ff;--ag-bg:#0f1318;--ag-card:#181d26;--ag-bd:#2a3140;
  --ag-t:#e8edf4;--ag-t2:#94a3b8;font-family:inherit;color:var(--ag-t);direction:rtl}
#agent-root *{box-sizing:border-box}
#agent-root .ag-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:900px){#agent-root .ag-grid{grid-template-columns:1fr}}
#agent-root .ag-card{background:var(--ag-card);border:1px solid var(--ag-bd);
  border-radius:14px;padding:16px;margin-bottom:14px}
#agent-root .ag-card h3{margin:0 0 12px;font-size:14px;font-weight:700;color:var(--ac);
  letter-spacing:.3px;display:flex;align-items:center;gap:6px}
#agent-root .ag-ta{width:100%;background:#0c0f14;border:1px solid var(--ag-bd);
  border-radius:10px;color:var(--ag-t);padding:11px 13px;font-size:14px;font-family:inherit;
  resize:vertical;min-height:64px;direction:rtl}
#agent-root .ag-ta:focus{outline:none;border-color:var(--ac)}
#agent-root .ag-btn{background:var(--ac);color:#001620;border:none;border-radius:9px;
  padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;
  transition:opacity .15s}
#agent-root .ag-btn:hover{opacity:.85}
#agent-root .ag-btn.sec{background:#222b38;color:var(--ag-t)}
#agent-root .ag-btn.ok{background:#42e695;color:#003318}
#agent-root .ag-btn.no{background:#33202a;color:#ff8da0}
#agent-root .ag-btn:disabled{opacity:.4;cursor:not-allowed}
#agent-root .ag-chip{background:#0c0f14;border:1px solid var(--ag-bd);color:var(--ag-t2);
  border-radius:8px;padding:7px 11px;font-size:12px;cursor:pointer;transition:all .15s}
#agent-root .ag-chip:hover{border-color:var(--ac);color:var(--ag-t)}
#agent-root .ag-row{background:#0c0f14;border:1px solid var(--ag-bd);border-radius:10px;
  padding:11px 13px;margin-bottom:9px}
#agent-root .ag-badge{display:inline-block;font-size:10px;font-weight:700;padding:2px 8px;
  border-radius:20px;letter-spacing:.3px}
#agent-root .ag-mut{color:var(--ag-t2);font-size:12px}
#agent-root .ag-empty{color:var(--ag-t2);font-size:12px;padding:8px 2px}
#agent-root .ag-flex{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
#agent-root .ag-bar{height:5px;background:#0c0f14;border-radius:4px;overflow:hidden;margin-top:5px}
#agent-root .ag-bar>i{display:block;height:100%;background:var(--ac)}
`;
    document.head.appendChild(s);
  }

  function root() { return document.getElementById('agent-root'); }

  function renderUI() {
    const el = root();
    if (!el) return;
    injectStyles();
    el.innerHTML =
      cardCommand() +
      '<div class="ag-grid">' +
        '<div>' + cardUnderstanding() + cardActions() + cardSuggestions() + '</div>' +
        '<div>' + cardExecLog() + cardMemory() + cardStatus() + '</div>' +
      '</div>';
  }

  function cardCommand() {
    const wf = Object.keys(WORKFLOWS).map(k =>
      '<button class="ag-chip" onclick="AgentRuntime.runWorkflow(\'' + k + '\')">' +
      esc(WORKFLOWS[k].label) + '</button>').join('');
    return '<div class="ag-card">' +
      '<h3>🛰️ מרכז הפיקוד — מה תרצה ש-Personal OS יעשה?</h3>' +
      '<textarea class="ag-ta" id="ag-input" placeholder="לדוגמה: תכנן לי את היום · הפוך הערות למשימות · מה הצעד הבא ב-Upselles"></textarea>' +
      '<div class="ag-flex" style="margin-top:10px">' +
        '<button class="ag-btn" id="ag-run" onclick="AgentRuntime.runCommand()">▶ הפעל</button>' +
        '<span class="ag-mut" id="ag-status-line"></span>' +
      '</div>' +
      '<div class="ag-flex" style="margin-top:12px">' + wf + '</div>' +
    '</div>';
  }

  function cardUnderstanding() {
    const r = state.result;
    if (!r) return '<div class="ag-card"><h3>🧠 הבנה</h3>' +
      '<div class="ag-empty">הקלד פקודה או בחר פעולה מהירה כדי להתחיל.</div></div>';
    const ag = AGENTS[r.agent] ? AGENTS[r.agent].label : r.agent;
    const conf = Math.round((r.confidence || 0) * 100);
    return '<div class="ag-card"><h3>🧠 הבנה</h3>' +
      '<div class="ag-row">' +
        '<div style="margin-bottom:6px">' + esc(r.understanding) + '</div>' +
        '<div class="ag-flex">' +
          '<span class="ag-badge" style="background:#11304a;color:#7fd8ff">intent: ' + esc(r.intent) + '</span>' +
          '<span class="ag-badge" style="background:#2a2440;color:#c4b5fd">' + esc(ag) + '</span>' +
          '<span class="ag-mut">ביטחון ' + conf + '%</span>' +
        '</div>' +
        '<div class="ag-bar"><i style="width:' + conf + '%"></i></div>' +
        (r.missing && r.missing.length ? '<div class="ag-mut" style="margin-top:8px">❓ חסר: ' + esc(r.missing.join(', ')) + '</div>' : '') +
        (r.assumptions && r.assumptions.length ? '<div class="ag-mut" style="margin-top:4px">הנחות: ' + esc(r.assumptions.join(', ')) + '</div>' : '') +
      '</div>' +
      (r.reply ? '<div class="ag-row" style="border-color:#1d3a4a">💬 ' + esc(r.reply) + '</div>' : '') +
    '</div>';
  }

  function cardActions() {
    const r = state.result;
    if (!r) return '';
    if (!r.actions || !r.actions.length)
      return '<div class="ag-card"><h3>⚡ פעולות מוצעות</h3>' +
        '<div class="ag-empty">אין פעולות להצעה — זו בקשת מידע/ניתוח בלבד.</div></div>';
    const pendingApprovable = r.actions.some(a => a.status === 'pending');
    const rows = r.actions.map((a, i) => {
      const risk = RISK[a.riskLevel] || RISK[3];
      let ctrls;
      if (a.status === 'done')
        ctrls = '<span class="ag-badge" style="background:#103a22;color:#42e695">✓ בוצע</span>';
      else if (a.status === 'rejected')
        ctrls = '<span class="ag-badge" style="background:#3a2027;color:#ff8da0">נדחה</span>';
      else if (a.status === 'blocked')
        ctrls = '<span class="ag-badge" style="background:#3a2027;color:#ff5d6c">🚫 חסום</span>';
      else
        ctrls = '<button class="ag-btn ok" onclick="AgentRuntime.approve(' + i + ')">אשר</button>' +
                '<button class="ag-btn no" onclick="AgentRuntime.reject(' + i + ')">דחה</button>';
      return '<div class="ag-row">' +
        '<div class="ag-flex" style="justify-content:space-between">' +
          '<strong style="font-size:13px">' + esc((TOOLS[a.tool] && TOOLS[a.tool].label) || a.tool) + '</strong>' +
          '<span class="ag-badge" style="background:' + risk.color + '22;color:' + risk.color + '">' + risk.label + '</span>' +
        '</div>' +
        '<div style="font-size:13px;margin:6px 0">' + esc(a.preview) + '</div>' +
        '<div class="ag-flex" style="justify-content:space-between">' +
          '<span class="ag-mut">תחום: ' + esc(a.area) + (a.reason ? ' · ' + esc(a.reason) : '') + '</span>' +
          '<span class="ag-flex">' + ctrls + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="ag-card"><h3>⚡ פעולות מוצעות</h3>' + rows +
      (pendingApprovable ? '<button class="ag-btn" style="margin-top:6px" onclick="AgentRuntime.approveAll()">אשר את כל המותרות</button>' : '') +
    '</div>';
  }

  function cardSuggestions() {
    const r = state.result;
    if (!r || !r.suggestions || !r.suggestions.length) return '';
    return '<div class="ag-card"><h3>💡 המלצות פרודוקטיביות</h3>' +
      r.suggestions.map(s => '<div class="ag-row" style="padding:9px 12px">' + esc(s) + '</div>').join('') +
    '</div>';
  }

  function cardExecLog() {
    const log = getAudit().filter(e => e.type === 'execute').slice(0, 8);
    const body = log.length ? log.map(e => {
      const ok = e.status === 'success';
      const time = new Date(e.ts).toLocaleTimeString('he-IL', { hour:'2-digit', minute:'2-digit' });
      return '<div class="ag-row" style="padding:8px 11px">' +
        '<span class="ag-badge" style="background:' + (ok ? '#103a22;color:#42e695' : '#3a2027;color:#ff5d6c') + '">' +
        (ok ? '✓' : '✗') + '</span> ' +
        '<span style="font-size:12px">' + esc((TOOLS[e.tool] && TOOLS[e.tool].label) || e.tool) + '</span>' +
        '<span class="ag-mut" style="float:left">' + time + '</span>' +
        '<div class="ag-mut" style="margin-top:3px">' + esc(e.result || e.error || '') + '</div>' +
      '</div>';
    }).join('') : '<div class="ag-empty">עדיין לא בוצעו פעולות.</div>';
    return '<div class="ag-card"><h3>📜 יומן ביצוע</h3>' + body + '</div>';
  }

  function cardMemory() {
    const m = readMemory();
    let body = '';
    MEMORY_TYPES.forEach(t => {
      if (!m[t] || !m[t].length) return;
      body += '<div style="margin-bottom:8px"><div class="ag-mut" style="font-weight:700;color:var(--ag-t)">' +
        esc(MEMORY_LABELS[t]) + '</div>' +
        m[t].map((it, i) => '<div class="ag-row" style="padding:6px 10px;display:flex;justify-content:space-between;gap:8px">' +
          '<span style="font-size:12px">' + esc(it.text) + '</span>' +
          '<span style="cursor:pointer;color:#ff8da0" onclick="AgentRuntime.removeMemory(\'' + t + '\',' + i + ')">✕</span>' +
        '</div>').join('') + '</div>';
    });
    if (!body) body = '<div class="ag-empty">אין עדיין זיכרון. הסוכן ילמד ככל שתשתמש בו.</div>';
    return '<div class="ag-card"><h3>🧩 הקשר וזיכרון</h3>' + body + '</div>';
  }

  function cardStatus() {
    const allowed = Object.keys(TOOLS).filter(k => !TOOLS[k].blocked);
    const blocked = Object.keys(TOOLS).filter(k => TOOLS[k].blocked);
    const agentList = Object.keys(AGENTS).map(k => AGENTS[k].label).join(' · ');
    return '<div class="ag-card"><h3>🛡️ סטטוס סוכנים וכלים</h3>' +
      '<div class="ag-row" style="padding:9px 12px"><div class="ag-mut" style="color:var(--ag-t);font-weight:700">סוכני תחום (' + Object.keys(AGENTS).length + ')</div>' +
        '<div class="ag-mut" style="margin-top:3px">' + esc(agentList) + '</div></div>' +
      '<div class="ag-row" style="padding:9px 12px"><div class="ag-mut" style="color:#42e695;font-weight:700">כלים זמינים (' + allowed.length + ')</div>' +
        '<div class="ag-mut" style="margin-top:3px">' + esc(allowed.map(k => TOOLS[k].label).join(' · ')) + '</div></div>' +
      '<div class="ag-row" style="padding:9px 12px"><div class="ag-mut" style="color:#ff5d6c;font-weight:700">כלים חסומים — Level 3 (' + blocked.length + ')</div>' +
        '<div class="ag-mut" style="margin-top:3px">' + esc(blocked.map(k => TOOLS[k].label).join(' · ')) + '</div></div>' +
    '</div>';
  }

  function setStatusLine(txt) {
    const el = document.getElementById('ag-status-line');
    if (el) el.textContent = txt || '';
  }

  // ──────────────────────────────────────────────────────────────────────
  //  9. CONTROLLER
  // ──────────────────────────────────────────────────────────────────────
  async function run(command) {
    command = (command || '').trim();
    if (!command || state.busy) return;
    state.busy = true;
    const btn = document.getElementById('ag-run');
    if (btn) btn.disabled = true;
    setStatusLine('⏳ הסוכן חושב…');
    audit({ type:'command', command:command });
    try {
      state.result = await generateProposedActions(command);
    } catch (e) {
      state.result = { ok:false, intent:'general_chat', agent:'PersonalCoachAgent', confidence:0,
        understanding:'שגיאה.', reply:'אירעה שגיאה: ' + e.message, actions:[], suggestions:[], missing:[], assumptions:[] };
    }
    state.busy = false;
    if (btn) btn.disabled = false;
    setStatusLine('');
    renderUI();
  }

  function runCommand() {
    const inp = document.getElementById('ag-input');
    if (inp && inp.value.trim()) run(inp.value.trim());
  }
  function runWorkflow(key) {
    const wf = WORKFLOWS[key];
    if (!wf) return;
    if (wf.instant) { run(wf.cmd); }
    else {
      const inp = document.getElementById('ag-input');
      if (inp) { inp.value = wf.cmd; inp.focus(); }
      setStatusLine('✍️ השלם את הפרטים ולחץ "הפעל"');
    }
  }
  function approve(i) {
    const r = state.result;
    if (!r || !r.actions[i] || r.actions[i].status !== 'pending') return;
    const res = executeApprovedAction(r.actions[i]);
    r.actions[i].status = res.ok ? 'done' : 'pending';
    r.actions[i].resultMsg = res.msg;
    if (!res.ok && window.POS) try { window.POS.notify('הפעולה נכשלה: ' + res.msg); } catch (e) {}
    renderUI();
  }
  function reject(i) {
    const r = state.result;
    if (!r || !r.actions[i] || r.actions[i].status !== 'pending') return;
    r.actions[i].status = 'rejected';
    audit({ type:'reject', tool:r.actions[i].tool });
    renderUI();
  }
  function approveAll() {
    const r = state.result;
    if (!r) return;
    r.actions.forEach((a, i) => { if (a.status === 'pending') {
      const res = executeApprovedAction(a);
      a.status = res.ok ? 'done' : 'pending';
      a.resultMsg = res.msg;
    }});
    renderUI();
  }
  function removeMemoryUI(type, idx) { removeMemory(type, idx); renderUI(); }

  // ──────────────────────────────────────────────────────────────────────
  //  10. PUBLIC API
  // ──────────────────────────────────────────────────────────────────────
  window.AgentRuntime = {
    renderUI: renderUI,
    runCommand: runCommand,
    runWorkflow: runWorkflow,
    run: run,
    approve: approve,
    reject: reject,
    approveAll: approveAll,
    removeMemory: removeMemoryUI,
    // exposed for inspection / future phases
    classifyIntent: classifyIntent,
    selectDomainAgent: selectDomainAgent,
    readMemory: readMemory,
    getAudit: getAudit,
    TOOLS: TOOLS,
    AGENTS: AGENTS
  };

  // initial render once the DOM is ready (page is hidden until navigated)
  function boot() { if (root()) renderUI(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  console.log('%cAgent Command Center online — WRAP ZORO, Phase 1.', 'color:#00d4ff;font-weight:bold');
})();
