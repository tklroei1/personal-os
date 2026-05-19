/* ============================================================================
 * JARVIS — Personal OS AI Companion (Iron Man inspired)
 * Drop-in module for https://personal-os-coral-tau.vercel.app/
 * Usage: add <script src="/jarvis.js" defer></script> before </body>
 * Author: built for Roei Klein — May 2026
 * Version: 1.0.0
 * --------------------------------------------------------------------------
 * Features
 *   • Floating HUD orb (Iron Man arc-reactor look)
 *   • Wake-word + push-to-talk voice (he-IL)
 *   • Natural-language command router (Hebrew + English)
 *   • Schedule system: planned/completed/partial/missed/replaced
 *   • Block replacement + reschedule suggestions
 *   • Project debt tracker + next-action surfacing
 *   • Execution log (every action persisted)
 *   • Proactive briefings (morning / end-of-day / weekly)
 *   • Quick-update modal
 * --------------------------------------------------------------------------
 * Zero dependencies. Uses Web Speech API (built into Chrome).
 * Talks to existing window.* functions: addTask, toggleTask, addReminder,
 * goPage, showNotif, callClaude, etc. — does NOT replace them.
 * ============================================================================ */

(function () {
  'use strict';

  // ────────────────────────────────────────────────────────────────────────
  //  0. CONFIG
  // ────────────────────────────────────────────────────────────────────────
  const VERSION       = '1.0.0';
  const STATE_KEY     = 'pos3';
  const LOG_KEY       = 'pos3_jarvis_log';
  const SCHED_KEY     = 'pos3_jarvis_schedule';
  const PERSONA_KEY   = 'pos3_jarvis_persona';
  const SETTINGS_KEY  = 'pos3_jarvis_settings';
  const WAKE_WORDS    = ['ג׳רוויס', 'גרוויס', "ג'רוויס", 'גארביס', 'jarvis', 'הג׳רוויס', 'הי גרוויס'];
  const LANG          = 'he-IL';
  const ACCENT        = '#00d4ff';   // arc-reactor cyan
  const ACCENT_WARM   = '#ff8a3d';   // warning amber
  const ACCENT_OK     = '#42e695';   // success green
  const ACCENT_BAD    = '#ff4d6d';   // error red

  // Block types (Part 3 of the brief)
  const BLOCK_TYPES = {
    fixed:      { label:'קבוע',      color:'#8b9bb4' },
    deep_work:  { label:'עבודה עמוקה', color:'#00d4ff' },
    medium:     { label:'עבודה בינונית', color:'#42a5ff' },
    light:      { label:'עבודה קלה',  color:'#7ec8ff' },
    food:       { label:'אוכל',       color:'#ffb84d' },
    training:   { label:'אימון',      color:'#ff5577' },
    walk:       { label:'הליכה',      color:'#42e695' },
    recovery:   { label:'התאוששות',   color:'#a78bfa' },
    buffer:     { label:'בופר',       color:'#6b7d99' },
    reminder:   { label:'תזכורת',     color:'#ffd84d' },
    family:     { label:'משפחה',      color:'#ff8a3d' },
    university: { label:'אוניברסיטה', color:'#5773ff' },
    meeting:    { label:'פגישה',      color:'#ff6b6b' },
    planning:   { label:'תכנון',      color:'#00bcd4' },
  };

  // Project registry (Part 6 of the brief)
  const PROJECTS = {
    upselles:   { name:'Upselles',          weeklyBudget: 6*60+8*60, priority:1, status:'active', emoji:'🚀' },
    university: { name:'אוניברסיטה (M.Sc)', weeklyBudget: 7*60+10*60, priority:1, status:'active', emoji:'🎓' },
    jobs:       { name:'חיפוש עבודה',       weeklyBudget: 3*60+4*60,  priority:2, status:'active', emoji:'💼' },
    apartment:  { name:'חיפוש דירה',        weeklyBudget: 2*60+3*60,  priority:2, status:'active', emoji:'🏡' },
    anthropic:  { name:'קורס Anthropic',    weeklyBudget: 1.5*60+3*60, priority:3, status:'active', emoji:'🧠' },
    fitness:    { name:'כושר ותזונה',       weeklyBudget: 3*90,        priority:2, status:'active', emoji:'💪' },
    family:     { name:'משפחה / אישי',      weeklyBudget: 5*60,        priority:1, status:'active', emoji:'👨‍👩‍👧' },
    recovery:   { name:'מנוחה / חופש',      weeklyBudget: 8*60,        priority:3, status:'active', emoji:'🌊' },
  };

  // EXACT weekly schedule from the brief.
  // Each block: id, day (0=Sun..6=Sat), start, end, title, type, proj,
  //             dedicated (purpose), action, replaceable, fixed.
  const DEFAULT_BLOCKS = [
    // ───── SUNDAY (day 0) ─────
    { id:'sun-plan',     day:0, start:'10:30', end:'11:00', title:'תכנון שבועי', type:'planning',
      proj:null, dedicated:'תכנון השבוע', action:'בחר 3 משימות מרכזיות לשבוע', replaceable:false, fixed:true },
    { id:'sun-upselles', day:0, start:'11:00', end:'13:00', title:'Upselles — Deep Work', type:'deep_work',
      proj:'upselles', dedicated:'עבודה עמוקה על הפלטפורמה', action:'Roadmap / Prompt / Audit / Implementation review', replaceable:true, fixed:false },
    { id:'sun-buf1',     day:0, start:'13:00', end:'13:30', title:'בופר / התאוששות קצרה', type:'buffer',
      proj:null, dedicated:'מעבר בין משימות', action:'מנוחה קצרה', replaceable:true, fixed:false },
    { id:'sun-bela',     day:0, start:'13:30', end:'14:30', title:'פגישה עם בלה', type:'meeting',
      proj:null, dedicated:'פגישה קבועה', action:'נוכחות בפגישה', replaceable:false, fixed:true },
    { id:'sun-lunch',    day:0, start:'14:30', end:'15:20', title:'הכנת צהריים + אכילה', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'בישול ואכילת ארוחת צהריים', replaceable:false, fixed:true },
    { id:'sun-uni',      day:0, start:'15:30', end:'16:45', title:'אוניברסיטה — לימוד עצמי', type:'university',
      proj:'university', dedicated:'שיעורי בית + תרגול', action:'פירוק וביצוע מטלה', replaceable:true, fixed:false },
    { id:'sun-buf2',     day:0, start:'16:45', end:'17:45', title:'בופר / סידורים קלים', type:'buffer',
      proj:null, dedicated:'התאוששות / סידורים', action:'התאוששות או סידורים קלים', replaceable:true, fixed:false },
    { id:'sun-ronit',    day:0, start:'18:00', end:'18:45', title:'פגישה עם רונית', type:'meeting',
      proj:null, dedicated:'פגישה קבועה', action:'נוכחות בפגישה', replaceable:false, fixed:true },
    { id:'sun-train',    day:0, start:'19:15', end:'20:45', title:'אימון כוח', type:'training',
      proj:'fitness', dedicated:'אימון כוח', action:'אימון לפי תוכנית', replaceable:false, fixed:true },
    { id:'sun-dinner',   day:0, start:'21:00', end:'21:35', title:'הכנת ערב + אכילה', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'בישול ואכילת ארוחת ערב', replaceable:false, fixed:true },
    { id:'sun-meat',     day:0, start:'22:00', end:'22:05', title:'תזכורת: להפשיר עוף/בשר למחר', type:'reminder',
      proj:'fitness', dedicated:'הכנה לעוף ובשר', action:'הוצא מהמקפיא', replaceable:false, fixed:true },

    // ───── MONDAY (day 1) — LOW CAPACITY DAY ─────
    { id:'mon-commute',  day:1, start:'07:00', end:'08:00', title:'נסיעה לאוניברסיטה', type:'buffer',
      proj:'university', dedicated:'נסיעה', action:'תחבורה', replaceable:false, fixed:true },
    { id:'mon-uni',      day:1, start:'08:00', end:'19:30', title:'אוניברסיטה — יום מלא', type:'university',
      proj:'university', dedicated:'יום אוניברסיטה מלא', action:'הרצאות, תרגולים, מטלות בקמפוס', replaceable:false, fixed:true },
    { id:'mon-return',   day:1, start:'19:30', end:'20:15', title:'חזרה הביתה', type:'buffer',
      proj:null, dedicated:'נסיעה הביתה', action:'תחבורה', replaceable:false, fixed:true },
    { id:'mon-recover',  day:1, start:'20:15', end:'21:00', title:'אוכל / מקלחת / התאוששות', type:'recovery',
      proj:'fitness', dedicated:'התאוששות יום ארוך', action:'אכילה, מקלחת, מנוחה', replaceable:false, fixed:true },
    { id:'mon-uni-rev',  day:1, start:'21:00', end:'21:20', title:'סקירת אוניברסיטה קצרה', type:'planning',
      proj:'university', dedicated:'סיכום יום הלימודים', action:'כתוב 3 משימות המשך', replaceable:true, fixed:false },
    { id:'mon-meat',     day:1, start:'22:00', end:'22:05', title:'תזכורת: להפשיר עוף/בשר למחר', type:'reminder',
      proj:'fitness', dedicated:'הכנה', action:'הוצא מהמקפיא', replaceable:false, fixed:true },

    // ───── TUESDAY (day 2) ─────
    { id:'tue-plan',     day:2, start:'10:30', end:'11:00', title:'תכנון יומי', type:'planning',
      proj:null, dedicated:'תכנון היום', action:'בחר משימות היום', replaceable:false, fixed:true },
    { id:'tue-uni',      day:2, start:'11:00', end:'13:00', title:'אוניברסיטה — Deep Study', type:'deep_work',
      proj:'university', dedicated:'לימוד עצמי עמוק', action:'מטלה / תרגול', replaceable:true, fixed:false },
    { id:'tue-lunch',    day:2, start:'13:00', end:'13:50', title:'הכנת צהריים + אכילה', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'בישול ואכילה', replaceable:false, fixed:true },
    { id:'tue-upselles', day:2, start:'14:00', end:'15:30', title:'Upselles — Deep Work', type:'deep_work',
      proj:'upselles', dedicated:'עבודה עמוקה', action:'דוח / פרומפט / פלטפורמה', replaceable:true, fixed:false },
    { id:'tue-walk',     day:2, start:'16:00', end:'16:45', title:'הליכה / סידורים', type:'walk',
      proj:'fitness', dedicated:'תנועה ואוויר', action:'הליכה 30-45 דק׳', replaceable:true, fixed:false },
    { id:'tue-train',    day:2, start:'18:30', end:'20:00', title:'אימון כוח', type:'training',
      proj:'fitness', dedicated:'אימון כוח', action:'אימון לפי תוכנית', replaceable:false, fixed:true },
    { id:'tue-dinner',   day:2, start:'20:15', end:'20:50', title:'הכנת ערב + אכילה', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'בישול ואכילה', replaceable:false, fixed:true },
    { id:'tue-anthropic',day:2, start:'21:15', end:'22:00', title:'קורס Anthropic / למידה קלה', type:'light',
      proj:'anthropic', dedicated:'למידת AI', action:'מודול קורס / קריאה', replaceable:true, fixed:false },
    { id:'tue-meat',     day:2, start:'22:00', end:'22:05', title:'תזכורת: להפשיר עוף/בשר למחר', type:'reminder',
      proj:'fitness', dedicated:'הכנה', action:'הוצא מהמקפיא', replaceable:false, fixed:true },

    // ───── WEDNESDAY (day 3) ─────
    { id:'wed-plan',     day:3, start:'10:30', end:'11:00', title:'תכנון יומי', type:'planning',
      proj:null, dedicated:'תכנון היום', action:'בחר משימות', replaceable:false, fixed:true },
    { id:'wed-uni',      day:3, start:'11:00', end:'13:00', title:'אוניברסיטה — Deep Study', type:'deep_work',
      proj:'university', dedicated:'לימוד עצמי עמוק', action:'מטלות ותרגול', replaceable:true, fixed:false },
    { id:'wed-lunch',    day:3, start:'13:00', end:'13:50', title:'הכנת צהריים + אכילה', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'בישול ואכילה', replaceable:false, fixed:true },
    { id:'wed-apt',      day:3, start:'14:00', end:'15:00', title:'חיפוש דירה', type:'medium',
      proj:'apartment', dedicated:'איתור דירה', action:'מודעות, הודעות, סיורים', replaceable:true, fixed:false },
    { id:'wed-tamar',    day:3, start:'15:30', end:'17:00', title:'פגישה עם תמר', type:'meeting',
      proj:null, dedicated:'פגישה קבועה', action:'נוכחות בפגישה', replaceable:false, fixed:true },
    { id:'wed-walk',     day:3, start:'17:30', end:'18:15', title:'הליכה', type:'walk',
      proj:'fitness', dedicated:'תנועה ואוויר', action:'הליכה 45 דק׳', replaceable:true, fixed:false },
    { id:'wed-dinner',   day:3, start:'19:00', end:'19:35', title:'הכנת ערב + אכילה', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'בישול ואכילה', replaceable:false, fixed:true },
    { id:'wed-jobs',     day:3, start:'20:00', end:'21:00', title:'חיפוש עבודה', type:'light',
      proj:'jobs', dedicated:'חיפוש משרות', action:'איתור ושמירה ל-tracker', replaceable:true, fixed:false },
    { id:'wed-meat',     day:3, start:'22:00', end:'22:05', title:'תזכורת: להפשיר עוף/בשר למחר', type:'reminder',
      proj:'fitness', dedicated:'הכנה', action:'הוצא מהמקפיא', replaceable:false, fixed:true },

    // ───── THURSDAY (day 4) ─────
    { id:'thu-plan',     day:4, start:'10:30', end:'11:00', title:'תכנון יומי', type:'planning',
      proj:null, dedicated:'תכנון היום', action:'בחר משימות', replaceable:false, fixed:true },
    { id:'thu-upselles', day:4, start:'11:00', end:'13:00', title:'Upselles — Deep Work', type:'deep_work',
      proj:'upselles', dedicated:'עבודה עמוקה', action:'פיתוח / לידים / שיווק', replaceable:true, fixed:false },
    { id:'thu-lunch',    day:4, start:'13:00', end:'13:50', title:'הכנת צהריים + אכילה', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'בישול ואכילה', replaceable:false, fixed:true },
    { id:'thu-uni',      day:4, start:'14:00', end:'15:30', title:'אוניברסיטה — מטלה', type:'medium',
      proj:'university', dedicated:'מטלת אוניברסיטה', action:'מטלה / תרגול / כתיבה', replaceable:true, fixed:false },
    { id:'thu-walk',     day:4, start:'16:00', end:'16:45', title:'הליכה / סידורים', type:'walk',
      proj:'fitness', dedicated:'תנועה ואוויר', action:'הליכה 30-45 דק׳', replaceable:true, fixed:false },
    { id:'thu-train',    day:4, start:'18:30', end:'20:00', title:'אימון כוח', type:'training',
      proj:'fitness', dedicated:'אימון כוח', action:'אימון לפי תוכנית', replaceable:false, fixed:true },
    { id:'thu-dinner',   day:4, start:'20:15', end:'20:50', title:'הכנת ערב + אכילה', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'בישול ואכילה', replaceable:false, fixed:true },
    { id:'thu-review',   day:4, start:'21:15', end:'21:45', title:'עדכון התקדמות שבועית', type:'planning',
      proj:null, dedicated:'תכנון', action:'מה התקדם השבוע, מה חסר', replaceable:false, fixed:true },
    { id:'thu-meat',     day:4, start:'22:00', end:'22:05', title:'תזכורת: להפשיר עוף/בשר למחר', type:'reminder',
      proj:'fitness', dedicated:'הכנה', action:'הוצא מהמקפיא', replaceable:false, fixed:true },

    // ───── FRIDAY (day 5) ─────
    { id:'fri-plan',     day:5, start:'10:30', end:'11:00', title:'תכנון יום (קל)', type:'planning',
      proj:null, dedicated:'תכנון יום שישי', action:'בחר משימות יום', replaceable:false, fixed:true },
    { id:'fri-jobs',     day:5, start:'11:00', end:'12:15', title:'חיפוש עבודה איכותי', type:'medium',
      proj:'jobs', dedicated:'הגשת מועמדויות', action:'2 הגשות איכותיות', replaceable:true, fixed:false },
    { id:'fri-errands',  day:5, start:'12:15', end:'13:00', title:'סידורים / בית', type:'light',
      proj:null, dedicated:'סידורים', action:'משימות בית', replaceable:true, fixed:false },
    { id:'fri-lunch',    day:5, start:'13:00', end:'13:50', title:'הכנת צהריים + אכילה', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'בישול ואכילה', replaceable:false, fixed:true },
    { id:'fri-apt',      day:5, start:'14:00', end:'15:15', title:'חיפוש דירה', type:'medium',
      proj:'apartment', dedicated:'איתור דירה', action:'הודעות וסיורים', replaceable:true, fixed:false },
    { id:'fri-rest',     day:5, start:'15:15', end:'17:30', title:'מנוחה / הכנה / משפחה', type:'recovery',
      proj:'family', dedicated:'התאוששות והכנה לשבת', action:'מנוחה והכנות', replaceable:false, fixed:true },
    { id:'fri-dinner',   day:5, start:'18:00', end:'21:00', title:'ארוחת ערב משפחתית — שישי', type:'family',
      proj:'family', dedicated:'זמן משפחתי', action:'ארוחה משפחתית', replaceable:false, fixed:true },

    // ───── SATURDAY (day 6) ─────
    { id:'sat-am',       day:6, start:'08:00', end:'14:00', title:'מנוחה / ים / זמן חופשי', type:'recovery',
      proj:'recovery', dedicated:'התאוששות', action:'בחירה חופשית', replaceable:true, fixed:false },
    { id:'sat-buffer',   day:6, start:'14:00', end:'16:00', title:'בופר משימות שהוחמצו (אופציונלי)', type:'buffer',
      proj:null, dedicated:'השלמת חוב', action:'אוניברסיטה / Upselles / חשוב', replaceable:true, fixed:false },
    { id:'sat-walk',     day:6, start:'16:30', end:'17:15', title:'הליכה (אופציונלי)', type:'walk',
      proj:'fitness', dedicated:'תנועה', action:'הליכה', replaceable:true, fixed:false },
    { id:'sat-review',   day:6, start:'18:00', end:'18:45', title:'סיכום שבועי + תכנון שבוע הבא', type:'planning',
      proj:null, dedicated:'Weekly Review', action:'מה התבצע / מה חסר / יעדים', replaceable:false, fixed:true },
    { id:'sat-evening',  day:6, start:'19:00', end:'23:00', title:'זמן חופשי', type:'recovery',
      proj:'recovery', dedicated:'מנוחה', action:'חופשי', replaceable:true, fixed:false },
  ];

  const PAGE_ALIASES = {
    'דשבורד':'dashboard','דשבר':'dashboard','בית':'dashboard','ראשי':'dashboard',
    'לוז':'week','לוח':'week','שבועי':'week','לוז שבועי':'week',
    'משימות':'tasks','משימה':'tasks','טודו':'tasks',
    'תזכורת':'reminders','תזכורות':'reminders',
    'עבודה':'jobs','חיפוש עבודה':'jobs','jobs':'jobs',
    'אפסלס':'upselles','upselles':'upselles','סטארטאפ':'upselles',
    'כושר':'fitness','אימון':'fitness','דיאטה':'fitness','אוכל':'fitness','תזונה':'fitness',
    'דירה':'apartment','דירות':'apartment','apt':'apartment',
    'משפחה':'family',
    'אוניברסיטה':'university','יוניברסיטה':'university','בר-אילן':'university',
    'דאטה':'university','מדע נתונים':'university','ds':'university','ai':'university','m.sc':'university',
    'אנתרופיק':'anthropic','קורס':'anthropic','anthropic':'anthropic',
    'מנוחה':'recovery','ים':'recovery','חופש':'recovery','beach':'recovery',
    'פיננסים':'finance','כסף':'finance','הוצאות':'finance',
    'פתקים':'notes',
    'תיבה':'inbox','אינבוקס':'inbox',
    'רעיונות':'ideas',
    'יומן':'journal',
    'מטרות':'goals',
    'חדשות':'news',
  };

  // ────────────────────────────────────────────────────────────────────────
  //  1. STATE HELPERS
  // ────────────────────────────────────────────────────────────────────────
  const J = {};               // public namespace exposed on window.JARVIS

  function readState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function writeState(s) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(s));
      // trigger UI re-render if app exposes it
      if (typeof window.renderAll === 'function') {
        try { window.renderAll(); } catch (e) {}
      }
      return true;
    } catch (e) { return false; }
  }
  function readLocal(key, dflt) {
    try { return JSON.parse(localStorage.getItem(key)) ?? dflt; }
    catch (e) { return dflt; }
  }
  function writeLocal(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  function settings() {
    return readLocal(SETTINGS_KEY, {
      voiceOn: true, wakeWordOn: true,
      morningBriefAt: '07:00', eveningBriefAt: '21:30',
      personality: 'professional', // 'professional' | 'witty' | 'warm'
      volume: 1.0, rate: 1.05,
    });
  }
  function updateSettings(patch) {
    const s = { ...settings(), ...patch };
    writeLocal(SETTINGS_KEY, s);
    return s;
  }

  // ────────────────────────────────────────────────────────────────────────
  //  2. EXECUTION LOG
  // ────────────────────────────────────────────────────────────────────────
  function logEvent(kind, payload, result) {
    const log = readLocal(LOG_KEY, []);
    log.push({
      ts: Date.now(),
      iso: new Date().toISOString(),
      kind, payload, result,
      page: getCurrentPage(),
    });
    // keep last 500
    if (log.length > 500) log.splice(0, log.length - 500);
    writeLocal(LOG_KEY, log);
  }
  function getLog(filterFn) {
    const log = readLocal(LOG_KEY, []);
    return filterFn ? log.filter(filterFn) : log;
  }

  // ────────────────────────────────────────────────────────────────────────
  //  3. SCHEDULE SYSTEM
  // ────────────────────────────────────────────────────────────────────────
  /*
   * Schedule store shape (SCHED_KEY):
   * {
   *   blocks: [...]   // editable; falls back to DEFAULT_BLOCKS
   *   weeks: {
   *     "2026-W20": {
   *       "ds-deep::2026-05-18": {
   *         status: 'planned'|'completed'|'partial'|'missed'|'replaced',
   *         actualMinutes: 120,
   *         note: '...',
   *         replacedBy: 'jobs-block' | null,
   *         updatedAt: ms
   *       }, ...
   *     }
   *   }
   * }
   */
  function isoWeekKey(d) {
    d = new Date(d);
    d.setHours(0,0,0,0);
    // ISO week
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(),0,1);
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getFullYear() + '-W' + String(weekNo).padStart(2,'0');
  }
  function dateKey(d) {
    const x = new Date(d);
    return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0');
  }

  function loadSchedule() {
    const s = readLocal(SCHED_KEY, null);
    if (!s) {
      const fresh = { blocks: DEFAULT_BLOCKS, weeks: {} };
      writeLocal(SCHED_KEY, fresh);
      return fresh;
    }
    if (!s.blocks || !s.blocks.length) s.blocks = DEFAULT_BLOCKS;
    if (!s.weeks) s.weeks = {};
    return s;
  }
  function saveSchedule(s) { writeLocal(SCHED_KEY, s); }

  function blocksForDay(date) {
    const dow = new Date(date).getDay();
    const all = loadSchedule().blocks;
    return all.filter(b => Array.isArray(b.day) ? b.day.includes(dow) : b.day === dow);
  }

  function blockStatus(blockId, date) {
    const sched = loadSchedule();
    const wk = isoWeekKey(date);
    const key = blockId + '::' + dateKey(date);
    return sched.weeks[wk]?.[key] || { status:'planned' };
  }

  function setBlockStatus(blockId, date, patch) {
    const sched = loadSchedule();
    const wk = isoWeekKey(date);
    const key = blockId + '::' + dateKey(date);
    sched.weeks[wk] = sched.weeks[wk] || {};
    sched.weeks[wk][key] = { ...(sched.weeks[wk][key] || { status:'planned' }), ...patch, updatedAt: Date.now() };
    saveSchedule(sched);
    logEvent('block.status', { blockId, date: dateKey(date) }, sched.weeks[wk][key]);
    return sched.weeks[wk][key];
  }

  function replaceBlock(blockId, date, replacementId, note) {
    setBlockStatus(blockId, date, { status:'replaced', replacedBy: replacementId, note });
    return true;
  }

  // ─── Project debt: for each project, compute time deficit this week
  function projectDebt() {
    const sched = loadSchedule();
    const today = new Date();
    const wk = isoWeekKey(today);
    const blocks = sched.blocks;
    const wkData = sched.weeks[wk] || {};
    const byProj = {};
    blocks.forEach(b => {
      if (!b.proj) return;
      byProj[b.proj] = byProj[b.proj] || { planned:0, actual:0, missed:0, completed:0, partial:0 };
      // iterate the days this block runs in this week
      const days = Array.isArray(b.day) ? b.day : [b.day];
      const planned = (parseTime(b.end) - parseTime(b.start)) * days.length;
      byProj[b.proj].planned += planned;
      days.forEach(dow => {
        const d = startOfWeek(today);
        d.setDate(d.getDate() + dow);
        const key = b.id + '::' + dateKey(d);
        const st  = wkData[key];
        const dur = parseTime(b.end) - parseTime(b.start);
        if (!st || st.status === 'planned') {
          if (d < today.setHours(23,59,59,999)) byProj[b.proj].missed += dur;
        } else if (st.status === 'completed') {
          byProj[b.proj].actual += st.actualMinutes ?? dur;
          byProj[b.proj].completed += dur;
        } else if (st.status === 'partial') {
          byProj[b.proj].actual += st.actualMinutes ?? Math.floor(dur/2);
          byProj[b.proj].partial += dur;
        } else if (st.status === 'missed') {
          byProj[b.proj].missed += dur;
        }
      });
    });
    Object.values(byProj).forEach(o => o.debt = Math.max(0, o.planned - o.actual));
    return byProj;
  }
  function parseTime(s) {
    const [h,m] = s.split(':').map(Number);
    return h*60 + (m||0);
  }
  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0,0,0,0);
    x.setDate(x.getDate() - x.getDay()); // Sunday
    return x;
  }

  // ─── Reschedule: find next free slot for a missed block
  function suggestReschedule(blockId, fromDate) {
    const sched = loadSchedule();
    const block = sched.blocks.find(b => b.id === blockId);
    if (!block) return null;
    const dur = parseTime(block.end) - parseTime(block.start);
    const day = new Date(fromDate);
    for (let i = 1; i <= 7; i++) {
      day.setDate(day.getDate() + 1);
      const conflicts = blocksForDay(day);
      // simplistic: find a 1h gap between 09:00-22:00 not overlapping any block
      for (let h = 9*60; h + dur <= 22*60; h += 30) {
        const startMin = h, endMin = h + dur;
        const clash = conflicts.some(b => {
          const bs = parseTime(b.start), be = parseTime(b.end);
          return !(endMin <= bs || startMin >= be);
        });
        if (!clash) {
          return {
            day: new Date(day),
            start: fmtTime(startMin),
            end: fmtTime(endMin),
            blockId
          };
        }
      }
    }
    return null;
  }
  function fmtTime(min) {
    return String(Math.floor(min/60)).padStart(2,'0') + ':' + String(min%60).padStart(2,'0');
  }

  // ────────────────────────────────────────────────────────────────────────
  //  4. WHAT-DO-I-OWE / OVERVIEW QUERIES
  // ────────────────────────────────────────────────────────────────────────
  function dueThisWeek() {
    const state = readState();
    const tasks = state.tasks || [];
    return tasks.filter(t => !t.done && (t.period === 'weekly' || t.period === 'daily' || t.period === 'once'));
  }
  function dueToday() {
    const state = readState();
    const tasks = state.tasks || [];
    return tasks.filter(t => !t.done && (t.period === 'daily' || t.period === 'once'));
  }
  function overdueTasks() {
    const state = readState();
    return (state.tasks || []).filter(t => !t.done && t.dueDate && new Date(t.dueDate) < new Date());
  }
  function todayEvents() {
    const state = readState();
    const dow = new Date().getDay();
    const events = state.weekEvents || {};
    return Object.entries(events)
      .filter(([k]) => k.startsWith(dow+'-'))
      .map(([k,v]) => ({ time: k.split('-')[1], ...(typeof v==='string'?{title:v}:v) }))
      .sort((a,b)=>a.time.localeCompare(b.time));
  }
  function todayReminders() {
    const state = readState();
    const today = dateKey(new Date());
    return (state.reminders||[]).filter(r => !r.done && (r.date === today || r.repeat === 'daily'));
  }

  // ────────────────────────────────────────────────────────────────────────
  //  5. ACTIONS (the verbs JARVIS can do)
  // ────────────────────────────────────────────────────────────────────────
  const ACTIONS = {
    navigate(args) {
      const where = (args.where || args.page || '').toLowerCase().trim();
      const target = PAGE_ALIASES[where] || where;
      if (typeof window.goPage === 'function') {
        try { window.goPage(target); logEvent('nav', { target }, 'ok'); return `מנווט ל${args.where}.`; }
        catch (e) { return `לא הצלחתי לעבור ל-${args.where}.`; }
      }
      return 'הניווט לא זמין כרגע.';
    },
    addTask(args) {
      const text = args.text || args.title;
      if (!text) return 'אני צריך שתגיד מה המשימה.';
      const state = readState();
      state.tasks = state.tasks || [];
      const id = (state.tasks.reduce((m,t)=>Math.max(m,t.id||0),0) || 0) + 1;
      state.tasks.push({
        id, text, done:false,
        cat: args.cat || 'work',
        period: args.period || 'once',
        proj: args.proj || null,
        progress: 0, status: ''
      });
      writeState(state);
      logEvent('task.add', { text, cat:args.cat, proj:args.proj }, id);
      return `נוסף: ${text}.`;
    },
    completeTask(args) {
      const q = (args.match || args.text || '').toLowerCase();
      if (!q) return 'תגיד איזו משימה לסיים.';
      const state = readState();
      const t = (state.tasks||[]).find(t => !t.done && t.text.toLowerCase().includes(q));
      if (!t) return `לא מצאתי משימה שמתאימה ל"${q}".`;
      t.done = true; t.progress = 100; t.status = 'done';
      writeState(state);
      logEvent('task.complete', { id:t.id, text:t.text });
      celebrate();
      return `סומן כהושלם: ${t.text}.`;
    },
    addReminder(args) {
      const text = args.text;
      if (!text) return 'מה תזכורת אתה רוצה?';
      const when = parseRelativeTime(args.when || args.in);
      const state = readState();
      state.reminders = state.reminders || [];
      const id = (state.reminders.reduce((m,r)=>Math.max(m,r.id||0),0) || 0) + 1;
      state.reminders.push({
        id, text,
        date: dateKey(when),
        time: String(when.getHours()).padStart(2,'0')+':'+String(when.getMinutes()).padStart(2,'0'),
        done:false, repeat: args.repeat || 'none'
      });
      writeState(state);
      logEvent('reminder.add', { text, when: when.toISOString() }, id);
      // Schedule local notification (Notification API)
      scheduleNotif(text, when);
      return `אזכיר לך: ${text} ב-${state.reminders[state.reminders.length-1].time}.`;
    },
    queryDue(args) {
      const scope = args.scope || 'week';
      if (scope === 'today') {
        const tasks = dueToday();
        const evts = todayEvents();
        const lines = [];
        if (tasks.length) lines.push(`היום יש לך ${tasks.length} משימות: ${tasks.slice(0,3).map(t=>t.text).join('; ')}${tasks.length>3?'...':''}.`);
        if (evts.length)  lines.push(`אירועים: ${evts.map(e=>`${e.time} ${e.title}`).join('; ')}.`);
        if (!lines.length) lines.push('היום נקי. הזדמנות לסגור חוב פתוח.');
        return lines.join(' ');
      }
      const tasks = dueThisWeek();
      const debt  = projectDebt();
      const debts = Object.entries(debt).filter(([,o])=>o.debt>0)
        .map(([p,o])=>`${p}: חוב ${Math.round(o.debt/60)} שעות`).join(', ');
      return `השבוע: ${tasks.length} משימות פתוחות. ${debts ? 'חוב פרויקטים: '+debts+'.' : 'אין חוב פרויקטים פתוח.'}`;
    },
    morningBrief() {
      const tasks = dueToday();
      const evts  = todayEvents();
      const debt  = projectDebt();
      const debts = Object.entries(debt).filter(([,o])=>o.debt>0);
      const dt    = new Date();
      const greet = dt.getHours() < 12 ? 'בוקר טוב' : dt.getHours() < 17 ? 'אחר צהריים טובים' : 'ערב טוב';
      const lines = [
        `${greet}, רואי.`,
        tasks.length ? `יש לך ${tasks.length} משימות היום.` : 'אין משימות דחופות היום.',
        evts.length  ? `אירועים: ${evts.map(e=>`${e.time} ${e.title}`).join(', ')}.` : '',
        debts.length ? `שים לב לחוב פרויקטים: ${debts.map(([p])=>p).join(', ')}.` : '',
        'אני כאן. רק תקרא לי.'
      ].filter(Boolean);
      return lines.join(' ');
    },
    eveningBrief() {
      const log = getLog(e => e.ts > Date.now() - 24*3600*1000);
      const completed = log.filter(e => e.kind === 'task.complete').length;
      const added     = log.filter(e => e.kind === 'task.add').length;
      const debt = projectDebt();
      const lines = [
        `סיכום היום: סיימת ${completed} משימות, הוספת ${added}.`,
        Object.entries(debt).filter(([,o])=>o.debt>0).length
          ? 'מחר כדאי להשלים חוב מפרויקטים: ' + Object.entries(debt)
              .filter(([,o])=>o.debt>0).map(([p])=>p).join(', ') + '.'
          : 'כל הפרויקטים בקצב טוב. כל הכבוד.',
        'לילה טוב.'
      ];
      return lines.join(' ');
    },
    setBlockStatus(args) {
      const date = args.date ? new Date(args.date) : new Date();
      setBlockStatus(args.blockId, date, {
        status: args.status,
        actualMinutes: args.actualMinutes,
        note: args.note
      });
      return `עדכנתי את הבלוק ${args.blockId} לסטטוס ${args.status}.`;
    },
    rescheduleBlock(args) {
      const date = args.date ? new Date(args.date) : new Date();
      const sug  = suggestReschedule(args.blockId, date);
      if (!sug) return 'לא מצאתי חלון פנוי השבוע.';
      return `ההצעה שלי: ${sug.day.toLocaleDateString('he-IL')} ב-${sug.start}–${sug.end}.`;
    },
    showDebt() {
      const debt = projectDebt();
      const lines = Object.entries(debt).map(([p,o]) =>
        `${p}: מתוכנן ${Math.round(o.planned/60)}ש׳, בוצע ${Math.round(o.actual/60)}ש׳, חוב ${Math.round(o.debt/60)}ש׳`
      );
      return lines.length ? lines.join('; ') : 'אין נתונים עדיין השבוע.';
    },
    // ── Advanced agent commands ────────────────────────────────────────────
    activityReport(args) {
      // "הייתי בים מ-14 עד 17 במקום ללמוד"
      const today = new Date();
      const from  = parseInt(args.fromHour || 14);
      const to    = parseInt(args.toHour   || 17);
      const blocks = blocksForDay(today).filter(b => {
        const bS = parseInt(b.start); const bE = parseInt(b.end);
        return bS < to && bE > from;
      });
      const replaceable = blocks.filter(b =>  b.replaceable);
      const fixed       = blocks.filter(b => !b.replaceable);
      replaceable.forEach(b => setBlockStatus(b.id, today, { status:'replaced', note: args.activity || 'פעילות אחרת', actualMinutes:0 }));
      fixed.forEach(b       => setBlockStatus(b.id, today, { status:'missed',   note: args.activity || 'פעילות אחרת' }));
      const lines = [];
      if (args.activity) lines.push(`רשמתי: ${args.activity} בין ${from}:00–${to}:00.`);
      if (replaceable.length) lines.push(`"${replaceable.map(b=>b.title).join(', ')}" — עודכן כ"הוחלף".`);
      if (fixed.length)       lines.push(`"${fixed.map(b=>b.title).join(', ')}" — עודכן כ"הוחמץ".`);
      const sug = replaceable[0] ? suggestReschedule(replaceable[0].id, today) : null;
      if (sug) lines.push(`הצעה לפיצוי: ${sug.day.toLocaleDateString('he-IL')} ב-${sug.start}–${sug.end}.`);
      return lines.join(' ') || 'עדכנתי את הלוז.';
    },

    logActualTime(args) {
      // "עשיתי 70 דק׳ Upselles במקום 120"
      const today   = new Date();
      const actual  = parseInt(args.actualMinutes || 0);
      const planned = parseInt(args.plannedMinutes || 0);
      const projKey = args.proj || '';
      const blocks  = blocksForDay(today).filter(b => b.proj === projKey);
      if (blocks.length) {
        const threshold = planned || actual;
        const st = actual >= threshold * 0.8 ? 'completed' : actual > 0 ? 'partial' : 'missed';
        setBlockStatus(blocks[0].id, today, { status: st, actualMinutes: actual,
          note: `מתוכנן: ${planned} דק׳, בוצע: ${actual} דק׳` });
      }
      const pName = PROJECTS[projKey]?.name || projKey;
      const diff  = planned - actual;
      if (diff > 0) return `${pName}: עשית ${actual} מתוך ${planned} דק׳. חוב של ${diff} דק׳. מומלץ להשלים מחר.`;
      return `${pName}: עשית ${actual} דק׳ — מעולה!${planned ? ` (מתוכנן: ${planned} דק׳)` : ''}`;
    },

    planByMissed() {
      // "תכנן לי את היום לפי מה שפספסתי אתמול"
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const yKey  = isoWeekKey(yesterday);
      const sched = loadSchedule();
      const yData = sched.weeks[yKey] || {};
      const missed = blocksForDay(yesterday).filter(b => {
        const k  = b.id + '::' + dateKey(yesterday);
        const st = yData[k]?.status;
        return st === 'missed' || st === 'partial';
      });
      if (!missed.length) return 'לא מצאתי בלוקים שפספסת אתמול — היום נקי! 🎉';
      const today = new Date();
      const suggestions = missed.slice(0, 3).map(b => {
        const sug = suggestReschedule(b.id, today);
        return sug ? `• ${b.title}: ${sug.start}–${sug.end}` : `• ${b.title}: אין חלון פנוי (שקול שבת)`;
      });
      return `פספסת אתמול:\n${suggestions.join('\n')}`;
    },

    whatToSkip() {
      // "מה אני יכול לדלג בלי לפגוע בשבוע"
      const today    = new Date();
      const debt     = projectDebt();
      const skippable = blocksForDay(today).filter(b => {
        if (!b.replaceable || b.fixed) return false;
        if (!b.proj) return true;
        const d = debt[PROJECTS[b.proj]?.name];
        return !d || d.debt < 60;
      });
      if (!skippable.length) return 'אין בלוקים שאפשר לדלג היום בבטחה — כולם חשובים.';
      return `ניתן לדלג היום (בלי נזק לשבוע):\n${skippable.map(b=>`• ${b.title} (${b.start}–${b.end})`).join('\n')}`;
    },

    whatNow(args) {
      // "מה לעשות עכשיו" — energy-based planning
      const energy   = (args || {}).energy || 'medium';
      const now      = new Date();
      const hm       = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
      const blocks   = blocksForDay(now);
      const current  = blocks.find(b => b.start <= hm && b.end > hm);
      const upcoming = blocks.filter(b => b.start > hm);
      const typeMap  = {
        low:    ['light','recovery','buffer','walk','food','reminder'],
        medium: ['medium','planning','university','walk','jobs','family','light'],
        high:   ['deep_work','training','meeting','university','medium'],
      };
      const suitable = typeMap[energy] || typeMap['medium'];
      const debt     = projectDebt();
      const behind   = Object.entries(debt).filter(([,o])=>o.debt>30).sort((a,b)=>b[1].debt-a[1].debt);
      const eLabel   = energy==='high' ? 'גבוהה' : energy==='low' ? 'נמוכה' : 'בינונית';
      if (current) {
        const tip = energy==='low' ? 'גמור את מה שיש ונח.' : 'תכנס לזה עכשיו.';
        return `עכשיו אמור להיות: "${current.title}" עד ${current.end}. אנרגיה ${eLabel} — ${tip}`;
      }
      const best = upcoming.find(b => suitable.includes(b.type));
      if (best) {
        const debtNote = behind.length ? ` שים לב: חוב ב-${behind[0][0]}.` : '';
        return `אנרגיה ${eLabel} — ממליץ: "${best.title}" ב-${best.start}.${debtNote}`;
      }
      if (behind.length) {
        const action = energy==='high' ? 'פתח deep-work session' : energy==='low' ? 'עשה משהו קל לפרויקט' : 'קדם כמה שיותר';
        return `אין בלוק ספציפי — יש חוב ב-${behind[0][0]}. אנרגיה ${eLabel}: ${action}.`;
      }
      const freeAct = energy==='low' ? 'קח הפסקה.' : energy==='high' ? 'קפוץ קדימה בלוז.' : 'עבור על המשימות.';
      return `אתה בין בלוקים. אנרגיה ${eLabel}: ${freeAct}`;
    },

    // ── Modal-opening shorthands ───────────────────────────────────────────
    dailyCheckIn()  { openDailyCheckIn();  return 'פותח צ׳ק-אין יומי...'; },
    weeklyReview()  { openWeeklyReview();  return 'פותח סיכום שבועי...'; },
    openWhatNow()   { openWhatNowPanel();  return ''; },

    speakOnly(args) { return args.text || ''; },
  };

  function parseRelativeTime(spec) {
    // accepts: "בעוד 10 דקות", "מחר 09:00", "ב-14:30", or Date/ISO
    if (!spec) { const t = new Date(); t.setHours(t.getHours()+1); return t; }
    if (spec instanceof Date) return spec;
    if (typeof spec === 'string') {
      const m1 = spec.match(/(\d+)\s*(דקות|דקה|min|minutes?)/i);
      if (m1) { const t = new Date(); t.setMinutes(t.getMinutes() + parseInt(m1[1])); return t; }
      const m2 = spec.match(/(\d+)\s*(שעות|שעה|hours?)/i);
      if (m2) { const t = new Date(); t.setHours(t.getHours() + parseInt(m2[1])); return t; }
      const m3 = spec.match(/(\d{1,2}):(\d{2})/);
      if (m3) {
        const t = new Date(); t.setHours(parseInt(m3[1]), parseInt(m3[2]), 0, 0);
        if (/מחר/.test(spec)) t.setDate(t.getDate()+1);
        if (t < new Date()) t.setDate(t.getDate()+1);
        return t;
      }
    }
    const t = new Date(); t.setHours(t.getHours()+1); return t;
  }

  function scheduleNotif(text, when) {
    const delay = Math.max(0, when - Date.now());
    if (delay > 2147483000) return; // > 24.8 days, skip
    setTimeout(() => {
      if (Notification && Notification.permission === 'granted') {
        new Notification('JARVIS — תזכורת', { body: text, icon: '/favicon.ico' });
      }
      speak(`תזכורת: ${text}.`);
    }, delay);
  }

  function celebrate() {
    if (typeof window.confetti === 'function') {
      try { window.confetti({ particleCount: 40, spread: 50, origin: { y: 0.7 } }); } catch (e) {}
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  //  6. NLU — Hebrew-first command router
  // ────────────────────────────────────────────────────────────────────────
  function route(text) {
    const t = text.trim();
    if (!t) return null;
    const lower = t.toLowerCase();

    // — Navigation —
    let m = t.match(/(?:פתח|תפתח|לך ל|נווט ל|תעבור ל|תראה לי)\s+(.+)/);
    if (m) return { action:'navigate', args:{ where: m[1] } };

    // — Add task —
    m = t.match(/(?:הוסף|תוסיף)\s+משימה\s+(.+?)(?:\s+לפרויקט\s+(\S+))?$/);
    if (m) return { action:'addTask', args:{ text: m[1], proj: PAGE_ALIASES[m[2]] || m[2] || null } };
    m = t.match(/^(?:הוסף|תוסיף)\s+(.+?)\s+(?:ל|אל)\s*(?:משימות|טודו)$/);
    if (m) return { action:'addTask', args:{ text: m[1] } };

    // — Complete task —
    m = t.match(/(?:סמן|תסמן|סיימתי|גמרתי|הושלם)(?:\s+את)?\s+(.+?)(?:\s+כהושלם|\s+כסיימתי)?$/);
    if (m) return { action:'completeTask', args:{ match: m[1] } };

    // — Add reminder —
    m = t.match(/(?:תזכר|תזכור|תזכיר|הזכר)\s+(?:לי\s+)?(?:על\s+)?(.+?)\s+(?:בעוד\s+(.+)|ב-?(\d{1,2}:\d{2})|מחר\s+(\d{1,2}:\d{2}))/);
    if (m) {
      const when = m[2] || m[3] || (m[4] ? 'מחר ' + m[4] : null);
      return { action:'addReminder', args:{ text: m[1], when } };
    }
    m = t.match(/(?:תזכר|תזכיר)\s+(?:לי\s+)?(.+)/);
    if (m) return { action:'addReminder', args:{ text: m[1], when: 'בעוד שעה' } };

    // — Queries —
    if (/מה (אני )?(חייב|צריך|עליי)\s+(היום|לעשות היום)/.test(t) || /מה (יש לי )?היום/.test(t))
      return { action:'queryDue', args:{ scope:'today' } };
    if (/מה (אני )?חייב\s+השבוע/.test(t) || /מה (יש לי )?השבוע/.test(t))
      return { action:'queryDue', args:{ scope:'week' } };

    // — Briefings —
    if (/(תיאור|תקציר|סיכום) (?:של )?(?:ה)?(?:בוקר|יום)/.test(t) || /בוקר טוב/.test(t))
      return { action:'morningBrief', args:{} };
    if (/(סיכום|תקציר)\s+(ה?ערב|ה?יום)/.test(t) || /לילה טוב/.test(t))
      return { action:'eveningBrief', args:{} };

    // — Schedule —
    if (/(חוב|דיווח)\s+(פרויקטים?|זמן)/.test(t)) return { action:'showDebt', args:{} };
    m = t.match(/(תזמן|הצע|הצעה ל)?\s*(?:לדחות|להעביר)\s+(.+?)\s+(?:למחר|לעוד|ל-?\d+)/);
    if (m) return { action:'rescheduleBlock', args:{ blockId: m[2] } };

    // ── Advanced commands ────────────────────────────────────────────────
    // "הייתי בים מ-14 עד 17"
    m = t.match(/(?:הייתי|הלכתי|בליתי)\s+(.+?)\s+(?:מ-?|מ–?)(\d{1,2})(?::\d{2})?\s+(?:עד|–|-)\s*(\d{1,2})/);
    if (m) return { action:'activityReport', args:{ activity: m[1], fromHour: m[2], toHour: m[3] } };

    // "עשיתי 70 דק׳ Upselles במקום 120"
    m = t.match(/(?:עשיתי|ביצעתי|השקעתי)\s+(\d+)\s*(?:דק[׳'ות]?|שעות?)\s+(?:על\s+|ב-?)?([\w֐-׿]+)/);
    if (m) {
      const rawProj = m[2].toLowerCase();
      const projKey = Object.keys(PROJECTS).find(k =>
        rawProj.includes(k) || PROJECTS[k].name.toLowerCase().includes(rawProj)
      ) || rawProj;
      const planned = parseInt((t.match(/(?:במקום|מתוך|מ-?)\s*(\d+)/)||[])[1] || '0');
      return { action:'logActualTime', args:{ proj: projKey, actualMinutes: parseInt(m[1]), plannedMinutes: planned } };
    }

    // "תכנן לי את היום לפי מה שפספסתי אתמול"
    if (/(?:תכנן|תסדר|תעזור)\s+(?:לי\s+)?(?:את\s+)?(?:ה?יום|המשך)\s+(?:לפי\s+)?(?:מה\s+ש)?(?:פספסתי|החמצתי)/.test(t)
        || /(?:מה\s+)?פספסתי\s+אתמול/.test(t))
      return { action:'planByMissed', args:{} };

    // "מה אני יכול לדלג בלי לפגוע בשבוע"
    if (/(?:מה|אילו?)\s+(?:אני\s+)?(?:יכול|אפשר)\s+(?:לדלג|לדחות|לוותר|לפספס)/.test(t)
        || /מה\s+(?:לא\s+)?חייב\s+(?:להיות|לעשות)/.test(t))
      return { action:'whatToSkip', args:{} };

    // "מה לעשות עכשיו"
    if (/מה\s+(?:לעשות|אעשה|אני\s+עושה|כדאי)\s+(?:ע?כשיו|עכשו)/.test(t)
        || /^(?:עזור\s+לי\s+)?(?:מה\s+)?עכשיו\??$/.test(t)) {
      const energy = /(?:אנרגיה\s+)?(?:נמוכה|low|עייף|רגוע)/.test(lower) ? 'low'
                   : /(?:אנרגיה\s+)?(?:גבוהה|high|ממוקד|חזק)/.test(lower) ? 'high' : 'medium';
      return { action:'whatNow', args:{ energy } };
    }

    // "צ׳ק-אין" / "Daily Check-in"
    if (/(?:צ[׳']?ק[- ]?אין|check[\s-]?in|התחל(?:ת)?\s+יום|תכנון\s+יום\s+עכשיו)/.test(lower))
      return { action:'dailyCheckIn', args:{} };

    // "סיכום שבועי" / "Weekly Review"
    if (/(?:סיכום\s+שבועי|weekly\s+review|סיכום\s+שבוע(?:\s+הזה)?)/.test(lower))
      return { action:'weeklyReview', args:{} };

    // fallback: ask the LLM (if available)
    return { action:'llmFallback', args:{ text: t } };
  }

  async function llmFallback(prompt) {
    // Try the host app's callClaude if available, else fall back to a friendly nudge.
    if (typeof window.callClaude === 'function') {
      try {
        const sys = `אתה JARVIS, עוזר אישי בעברית של רואי קליין. ענה קצר וענייני (1–2 משפטים). אל תמציא.
מידע על המשתמש: ${JSON.stringify(quickContext()).slice(0,800)}`;
        const reply = await window.callClaude(prompt, sys);
        return typeof reply === 'string' ? reply : (reply?.text || 'קיבלתי. נטפל.');
      } catch (e) { return 'אני מבין אבל אין לי תשובה מדויקת כרגע.'; }
    }
    return `שמעתי "${prompt}". עוד לא יודע לבצע את הפעולה הזו לבד — נסה: "מה היום", "הוסף משימה...", "תזכר אותי על...".`;
  }

  function quickContext() {
    const s = readState();
    return {
      tasksOpen: (s.tasks||[]).filter(t=>!t.done).length,
      projects: (s.projects||[]).map(p=>p.id||p.name),
      today: dateKey(new Date()),
    };
  }

  async function handle(text) {
    const r = route(text);
    if (!r) return '';
    if (r.action === 'llmFallback') {
      const out = await llmFallback(r.args.text);
      logEvent('llm', r.args, out);
      return out;
    }
    const fn = ACTIONS[r.action];
    if (!fn) return '';
    const out = fn(r.args) || '';
    return out;
  }

  // ────────────────────────────────────────────────────────────────────────
  //  7. VOICE — recognition + synthesis
  // ────────────────────────────────────────────────────────────────────────
  let recog = null, recogActive = false, listeningHard = false;

  function makeRecognizer() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = LANG;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    return r;
  }

  function startListening(hard=false) {
    if (!settings().voiceOn) return;
    if (!recog) recog = makeRecognizer();
    if (!recog) { speak('אין זיהוי קולי בדפדפן הזה.'); return; }
    listeningHard = hard;
    if (recogActive) return;
    try { recog.start(); } catch (e) {}
  }
  function stopListening() {
    listeningHard = false;
    if (recog) try { recog.stop(); } catch (e) {}
  }
  function bindRecog() {
    if (!recog) return;
    recog.onstart = () => { recogActive = true; hud.setState('listening'); };
    recog.onend   = () => {
      recogActive = false;
      hud.setState('idle');
      // auto-restart if wake-word mode is on
      if (settings().wakeWordOn && !listeningHard) {
        setTimeout(() => startListening(false), 700);
      }
    };
    recog.onerror = (e) => {
      hud.setState('idle');
      // common: 'not-allowed', 'no-speech', 'audio-capture'
      if (e.error === 'not-allowed') {
        hud.toast('אין הרשאת מיקרופון. הרשה בהגדרות הדפדפן.', 'error');
      }
    };
    recog.onresult = async (ev) => {
      let interim = '', final = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      hud.setHeard((final || interim).trim());

      if (final) {
        const text = final.trim();
        // wake word handling
        if (settings().wakeWordOn && !listeningHard) {
          const wake = WAKE_WORDS.find(w => text.toLowerCase().includes(w.toLowerCase()));
          if (!wake) return;
          let cmd = text;
          for (const w of WAKE_WORDS) cmd = cmd.replace(new RegExp(w, 'gi'), '').trim();
          if (!cmd) { speak('כן, רואי?'); listeningHard = true; return; }
          await processSpoken(cmd);
        } else {
          await processSpoken(text);
        }
      }
    };
  }
  async function processSpoken(text) {
    hud.setHeard(text);
    hud.setState('thinking');
    try {
      const reply = await handle(text);
      if (reply) { hud.setReply(reply); speak(reply); }
    } catch (e) {
      hud.toast('משהו השתבש: ' + e.message, 'error');
    } finally {
      hud.setState('idle');
      listeningHard = false;
    }
  }

  let voicesCache = null;
  function pickVoice() {
    const v = window.speechSynthesis?.getVoices() || [];
    voicesCache = v;
    // prefer he-IL female if available
    return v.find(x => x.lang === 'he-IL' && /female|carmit/i.test(x.name))
        || v.find(x => x.lang === 'he-IL')
        || v.find(x => x.lang?.startsWith('he'))
        || v[0];
  }
  function speak(text) {
    if (!settings().voiceOn) return;
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang || LANG;
    u.rate = settings().rate || 1.05;
    u.volume = settings().volume || 1.0;
    u.pitch = 1.0;
    hud.setState('speaking');
    u.onend = () => hud.setState('idle');
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch (e) {}
  }

  // ────────────────────────────────────────────────────────────────────────
  //  8. HUD — visual layer
  // ────────────────────────────────────────────────────────────────────────
  const hud = (function () {
    let root, orb, panel, heard, reply, statusEl, dock;
    let state = 'idle';

    function mount() {
      if (root) return;

      // CSS
      const style = document.createElement('style');
      style.textContent = `
.jv-root { position:fixed; z-index:99999; right:24px; bottom:24px; direction:rtl;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; }
.jv-orb { position:relative; width:64px; height:64px; border-radius:50%;
  background:radial-gradient(circle at 30% 30%, #fff 0%, ${ACCENT} 35%, #003a55 100%);
  box-shadow:0 0 24px ${ACCENT}88, 0 0 60px ${ACCENT}44, inset 0 0 18px #fff8;
  cursor:pointer; transition:transform .2s; }
.jv-orb:hover { transform:scale(1.05); }
.jv-orb::after { content:''; position:absolute; inset:-6px; border-radius:50%;
  border:2px solid ${ACCENT}; opacity:.7; animation:jv-pulse 2.4s ease-out infinite; }
.jv-orb.listening::after { animation:jv-pulse 1s ease-out infinite; border-color:${ACCENT_OK}; }
.jv-orb.thinking::after { animation:jv-spin 1.2s linear infinite; border-style:dashed; border-color:#ffd84d; }
.jv-orb.speaking::after { animation:jv-pulse .6s ease-out infinite; }
@keyframes jv-pulse {
  0% { transform:scale(1); opacity:.85; }
  100% { transform:scale(1.55); opacity:0; }
}
@keyframes jv-spin { from{ transform:rotate(0); } to{ transform:rotate(360deg); } }

.jv-panel { position:absolute; right:78px; bottom:0; width:340px; max-width:80vw;
  background:rgba(8,14,28,.94); color:#e6f3ff; border:1px solid ${ACCENT}66;
  border-radius:14px; padding:14px 16px; box-shadow:0 12px 40px #000a, 0 0 24px ${ACCENT}33;
  backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
  opacity:0; pointer-events:none; transform:translateY(8px); transition:.2s; }
.jv-panel.show { opacity:1; pointer-events:auto; transform:translateY(0); }
.jv-panel h4 { margin:0 0 6px; font-size:13px; font-weight:600; color:${ACCENT}; letter-spacing:.5px; }
.jv-heard { font-size:13px; min-height:18px; opacity:.85; margin-bottom:6px; }
.jv-reply { font-size:14px; line-height:1.4; }
.jv-status { font-size:11px; color:${ACCENT}; text-transform:uppercase; letter-spacing:1.2px; margin-bottom:8px; }
.jv-actions { margin-top:10px; display:flex; gap:6px; flex-wrap:wrap; }
.jv-chip { background:#0f1e36; color:#cfe8ff; border:1px solid ${ACCENT}33;
  border-radius:18px; padding:6px 10px; font-size:11px; cursor:pointer; transition:.15s; }
.jv-chip:hover { background:${ACCENT}22; border-color:${ACCENT}; }
.jv-dock { position:absolute; right:0; bottom:78px; background:rgba(8,14,28,.94); color:#e6f3ff;
  border:1px solid ${ACCENT}33; border-radius:12px; padding:8px;
  display:flex; flex-direction:column; gap:6px; opacity:0; pointer-events:none; transition:.2s; }
.jv-dock.show { opacity:1; pointer-events:auto; }
.jv-dock button { background:transparent; color:#cfe8ff; border:none; padding:6px 10px;
  font-size:12px; text-align:right; cursor:pointer; border-radius:6px; }
.jv-dock button:hover { background:${ACCENT}22; }
.jv-toast { position:fixed; top:24px; right:24px; z-index:100000;
  background:#0a1828; color:#e6f3ff; padding:10px 14px; border-radius:10px;
  border:1px solid ${ACCENT}55; box-shadow:0 8px 24px #0008; max-width:320px;
  opacity:0; transition:.2s; transform:translateY(-6px); }
.jv-toast.show { opacity:1; transform:translateY(0); }
.jv-toast.error { border-color:${ACCENT_BAD}; }
.jv-toast.ok { border-color:${ACCENT_OK}; }
.jv-edge { position:fixed; pointer-events:none; z-index:99998;
  inset:0; box-shadow:inset 0 0 0 2px transparent; transition:.4s; }
.jv-edge.active { box-shadow:inset 0 0 80px ${ACCENT}33, inset 0 0 0 1px ${ACCENT}77; }
@media (max-width:600px) {
  .jv-root { right:12px; bottom:80px; }
  .jv-panel { width: calc(100vw - 100px); right:74px; }
}
`;
      document.head.appendChild(style);

      // DOM
      const edge = document.createElement('div'); edge.className = 'jv-edge'; document.body.appendChild(edge);
      root = document.createElement('div'); root.className = 'jv-root';
      root.innerHTML = `
        <div class="jv-panel" id="jv-panel">
          <div class="jv-status" id="jv-status">JARVIS</div>
          <div class="jv-heard" id="jv-heard"></div>
          <div class="jv-reply" id="jv-reply">היי רואי. אני כאן. תקרא לי "ג'רוויס" או לחץ על הספירה.</div>
          <div class="jv-actions" id="jv-actions">
            <button class="jv-chip" data-cmd="מה יש לי היום">מה היום</button>
            <button class="jv-chip" data-cmd="מה לעשות עכשיו">⚡ מה עכשיו</button>
            <button class="jv-chip" data-cmd="מה אני חייב השבוע">מה חייב השבוע</button>
            <button class="jv-chip" data-cmd="חוב פרויקטים">חוב פרויקטים</button>
            <button class="jv-chip" data-cmd="סיכום הבוקר">תיאור בוקר</button>
          </div>
        </div>
        <div class="jv-dock" id="jv-dock">
          <button data-act="checkin">☀️ צ׳ק-אין יומי</button>
          <button data-act="whatnow">⚡ מה לעשות עכשיו</button>
          <button data-act="brief">📋 תקציר בוקר</button>
          <button data-act="schedule">📅 לוז שבועי</button>
          <button data-act="debt">⚠️ חוב פרויקטים</button>
          <button data-act="review">📊 סיכום שבועי</button>
          <button data-act="settings">⚙️ הגדרות</button>
          <button data-act="log">📜 יומן ביצוע</button>
        </div>
        <div class="jv-orb" id="jv-orb" title="לחיצה אחת — דבר • לחיצה ארוכה — תפריט"></div>
      `;
      document.body.appendChild(root);

      orb     = root.querySelector('#jv-orb');
      panel   = root.querySelector('#jv-panel');
      heard   = root.querySelector('#jv-heard');
      reply   = root.querySelector('#jv-reply');
      statusEl = root.querySelector('#jv-status');
      dock    = root.querySelector('#jv-dock');

      // Click → toggle listening + show panel
      let pressTimer;
      orb.addEventListener('pointerdown', () => {
        pressTimer = setTimeout(() => { dock.classList.toggle('show'); pressTimer = null; }, 450);
      });
      orb.addEventListener('pointerup', () => {
        if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; toggleListen(); }
      });
      orb.addEventListener('pointercancel', () => { if (pressTimer) clearTimeout(pressTimer); });

      // Hover/show panel
      orb.addEventListener('mouseenter', () => panel.classList.add('show'));
      root.addEventListener('mouseleave', () => panel.classList.remove('show'));

      // Chip clicks
      root.querySelectorAll('[data-cmd]').forEach(b => {
        b.addEventListener('click', () => processSpoken(b.dataset.cmd));
      });

      // Dock buttons
      dock.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
          dock.classList.remove('show');
          const a = b.dataset.act;
          if (a === 'checkin')  return openDailyCheckIn();
          if (a === 'whatnow')  return openWhatNowPanel();
          if (a === 'brief')    return processSpoken('סיכום הבוקר');
          if (a === 'schedule') return openScheduleModal();
          if (a === 'debt')     return processSpoken('חוב פרויקטים');
          if (a === 'review')   return openWeeklyReview();
          if (a === 'log')      return openLogModal();
          if (a === 'settings') return openSettingsModal();
        });
      });

      window._jvEdge = edge;
    }

    function toggleListen() {
      if (recogActive) stopListening();
      else { panel.classList.add('show'); startListening(true); }
    }

    function setState(s) {
      state = s;
      if (!orb) return;
      orb.classList.remove('listening','thinking','speaking');
      if (s !== 'idle') orb.classList.add(s);
      const labels = { idle:'JARVIS', listening:'מקשיב…', thinking:'חושב…', speaking:'מדבר…' };
      if (statusEl) statusEl.textContent = labels[s] || 'JARVIS';
      if (window._jvEdge) {
        if (s === 'listening' || s === 'thinking') window._jvEdge.classList.add('active');
        else window._jvEdge.classList.remove('active');
      }
    }
    function setHeard(t) { if (heard) heard.textContent = t ? '🎙 ' + t : ''; if (panel) panel.classList.add('show'); }
    function setReply(t) { if (reply) reply.textContent = t; if (panel) panel.classList.add('show'); }

    function toast(text, kind='ok') {
      const el = document.createElement('div');
      el.className = 'jv-toast ' + kind;
      el.textContent = text;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => { el.classList.remove('show'); setTimeout(()=>el.remove(), 250); }, 3500);
    }

    return { mount, setState, setHeard, setReply, toast, toggleListen };
  })();

  // ────────────────────────────────────────────────────────────────────────
  //  9. MODALS — Schedule update, Log, Settings
  // ────────────────────────────────────────────────────────────────────────
  function modalShell(title, bodyHtml) {
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:fixed;inset:0;background:#000a;z-index:100001;
      display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);direction:rtl;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
    wrap.innerHTML = `
      <div style="background:#0a1828;color:#e6f3ff;border:1px solid ${ACCENT}55;border-radius:14px;
        width:min(620px,92vw);max-height:88vh;overflow:auto;padding:18px 20px;
        box-shadow:0 20px 60px #000c, 0 0 30px ${ACCENT}33">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0;color:${ACCENT};font-size:15px;letter-spacing:.5px">${title}</h3>
          <button id="jv-close" style="background:transparent;color:#cfe8ff;border:none;font-size:20px;cursor:pointer">✕</button>
        </div>
        <div id="jv-body">${bodyHtml}</div>
      </div>`;
    wrap.querySelector('#jv-close').onclick = () => wrap.remove();
    wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    return wrap;
  }

  function openScheduleModal() {
    const today = new Date();
    const blocks = blocksForDay(today);
    const wk = isoWeekKey(today);
    const sched = loadSchedule();
    const wkData = sched.weeks[wk] || {};
    const dayName = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][today.getDay()];
    const html = `
      <p style="opacity:.85;font-size:13px;margin:0 0 12px">היום, יום ${dayName}, ${today.toLocaleDateString('he-IL')}</p>
      <div id="jv-blocks" style="display:flex;flex-direction:column;gap:8px"></div>
      <p style="opacity:.6;font-size:11px;margin-top:14px">לחץ על סטטוס כדי לעדכן.</p>`;
    const m = modalShell('📅 לוז היום — עדכון מהיר', html);
    const list = m.querySelector('#jv-blocks');
    blocks.forEach(b => {
      const key = b.id + '::' + dateKey(today);
      const st  = wkData[key] || { status:'planned' };
      const row = document.createElement('div');
      row.style.cssText = `border:1px solid ${ACCENT}33;border-radius:10px;padding:10px;display:flex;justify-content:space-between;align-items:center`;
      row.innerHTML = `
        <div>
          <div style="font-weight:600">${b.title}</div>
          <div style="font-size:11px;opacity:.7">${b.start}–${b.end}</div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${['planned','completed','partial','missed','replaced'].map(s =>
            `<button data-s="${s}" style="background:${st.status===s ? ACCENT+'44' : 'transparent'};
              color:#e6f3ff;border:1px solid ${ACCENT}55;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer">
              ${ {planned:'מתוכנן',completed:'בוצע',partial:'חלקי',missed:'הוחמץ',replaced:'הוחלף'}[s] }</button>`
          ).join('')}
        </div>`;
      row.querySelectorAll('button').forEach(btn => {
        btn.onclick = () => {
          setBlockStatus(b.id, today, { status: btn.dataset.s });
          openScheduleModal();
          m.remove();
        };
      });
      list.appendChild(row);
    });
  }

  function openLogModal() {
    const log = getLog().slice(-50).reverse();
    const rows = log.map(e =>
      `<tr><td style="padding:4px 8px;opacity:.6;font-size:11px">${new Date(e.ts).toLocaleString('he-IL')}</td>
       <td style="padding:4px 8px;font-size:11px">${e.kind}</td>
       <td style="padding:4px 8px;font-size:11px;opacity:.85">${escapeHtml(JSON.stringify(e.payload||{}).slice(0,80))}</td></tr>`
    ).join('');
    modalShell('📜 יומן ביצוע', `
      <p style="opacity:.7;font-size:12px;margin:0 0 10px">50 פעולות אחרונות</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="opacity:.6">
          <th style="text-align:right;padding:4px 8px">זמן</th>
          <th style="text-align:right;padding:4px 8px">סוג</th>
          <th style="text-align:right;padding:4px 8px">פרטים</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" style="padding:10px;opacity:.6">אין רשומות עדיין.</td></tr>'}</tbody>
      </table>`);
  }

  function openSettingsModal() {
    const s = settings();
    const html = `
      <div style="display:flex;flex-direction:column;gap:10px;font-size:13px">
        <label><input type="checkbox" id="jv-voiceOn" ${s.voiceOn?'checked':''}/> קול פעיל</label>
        <label><input type="checkbox" id="jv-wake" ${s.wakeWordOn?'checked':''}/> מילת הפעלה (ג׳רוויס)</label>
        <label>מהירות דיבור: <input type="range" id="jv-rate" min="0.8" max="1.4" step="0.05" value="${s.rate}"/></label>
        <label>תקציר בוקר ב: <input type="time" id="jv-am" value="${s.morningBriefAt}"/></label>
        <label>תקציר ערב ב: <input type="time" id="jv-pm" value="${s.eveningBriefAt}"/></label>
        <button id="jv-save" style="background:${ACCENT};color:#001828;border:none;border-radius:8px;
          padding:8px 14px;font-weight:600;cursor:pointer;margin-top:8px">שמור</button>
        <button id="jv-test" style="background:transparent;color:#cfe8ff;border:1px solid ${ACCENT}55;
          border-radius:8px;padding:8px 14px;cursor:pointer">בדיקת קול</button>
      </div>`;
    const m = modalShell('⚙️ הגדרות JARVIS', html);
    m.querySelector('#jv-save').onclick = () => {
      updateSettings({
        voiceOn:       m.querySelector('#jv-voiceOn').checked,
        wakeWordOn:    m.querySelector('#jv-wake').checked,
        rate:          parseFloat(m.querySelector('#jv-rate').value),
        morningBriefAt:m.querySelector('#jv-am').value,
        eveningBriefAt:m.querySelector('#jv-pm').value,
      });
      hud.toast('הגדרות נשמרו', 'ok');
      m.remove();
    };
    m.querySelector('#jv-test').onclick = () => speak('בדיקת מערכת. שומע אותי, רואי?');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  // ────────────────────────────────────────────────────────────────────────
  // 10. PROJECT DEBT WIDGET (injects into dashboard if there's a spot)
  // ────────────────────────────────────────────────────────────────────────
  function renderDebtWidget() {
    const existing = document.getElementById('jv-debt-widget');
    if (existing) existing.remove();
    const debt = projectDebt();
    const entries = Object.entries(debt);
    if (!entries.length) return;

    const widget = document.createElement('div');
    widget.id = 'jv-debt-widget';
    widget.style.cssText = `border:1px solid ${ACCENT}55;border-radius:12px;padding:12px 14px;
      margin:10px 0;background:rgba(8,14,28,.6);color:#e6f3ff;direction:rtl;
      font-family:inherit;font-size:13px`;
    widget.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <strong style="color:${ACCENT}">⚠️ חוב פרויקטים — השבוע</strong>
        <button id="jv-debt-close" style="background:transparent;color:#cfe8ff;border:none;cursor:pointer">✕</button>
      </div>
      ${entries.map(([p,o]) => {
        const ratio = o.planned ? Math.min(100, Math.round((o.actual/o.planned)*100)) : 0;
        return `<div style="margin:6px 0">
          <div style="display:flex;justify-content:space-between">
            <span>${p}</span>
            <span style="opacity:.7">${Math.round(o.actual/60)}/${Math.round(o.planned/60)} ש׳ — ${ratio}%</span>
          </div>
          <div style="background:#0f1e36;height:6px;border-radius:3px;margin-top:2px;overflow:hidden">
            <div style="background:${ratio<50?ACCENT_BAD:ratio<80?ACCENT_WARM:ACCENT_OK};
              height:100%;width:${ratio}%;transition:.4s"></div>
          </div>
        </div>`;
      }).join('')}`;
    widget.querySelector('#jv-debt-close').onclick = () => widget.remove();

    // Try to find dashboard container
    const target = document.querySelector('[data-page="dashboard"], #dashboard, .dashboard, main') || document.body;
    if (target === document.body) {
      widget.style.position = 'fixed';
      widget.style.left = '24px';
      widget.style.bottom = '24px';
      widget.style.maxWidth = '300px';
    }
    target.prepend(widget);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 11. BRIEFINGS — cron-style timers
  // ────────────────────────────────────────────────────────────────────────
  function setupBriefings() {
    const tick = () => {
      const s = settings();
      const now = new Date();
      const hm = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
      if (hm === s.morningBriefAt && !readLocal('jv_last_am', null)?.startsWith(dateKey(now))) {
        writeLocal('jv_last_am', dateKey(now)+'T'+hm);
        const text = ACTIONS.morningBrief();
        hud.setReply(text); speak(text);
      }
      if (hm === s.eveningBriefAt && !readLocal('jv_last_pm', null)?.startsWith(dateKey(now))) {
        writeLocal('jv_last_pm', dateKey(now)+'T'+hm);
        const text = ACTIONS.eveningBrief();
        hud.setReply(text); speak(text);
      }
    };
    setInterval(tick, 30*1000);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 12-A. LOCK / DAILY GREETING SCREEN
  // ────────────────────────────────────────────────────────────────────────
  function openLockScreen() {
    const today  = new Date();
    const dKey   = dateKey(today);
    // Show once per day; skip on re-loads within the same day
    if (readLocal('jv_last_lock', '') === dKey) return;
    writeLocal('jv_last_lock', dKey);

    const dayName = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][today.getDay()];
    const greet   = today.getHours() < 12 ? 'בוקר טוב' : today.getHours() < 17 ? 'אחה"צ טוב' : 'ערב טוב';
    const blocks  = blocksForDay(today).slice(0, 6);
    const debt    = projectDebt();
    const behind  = Object.entries(debt).filter(([,o]) => o.debt > 0);

    const wrap = document.createElement('div');
    wrap.id = 'jv-lock-screen';
    wrap.style.cssText = `position:fixed;inset:0;background:rgba(4,9,20,.97);z-index:999999;
      display:flex;align-items:center;justify-content:center;direction:rtl;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
      opacity:0;transition:opacity .4s`;

    wrap.innerHTML = `
      <div style="max-width:460px;width:92vw;text-align:center;color:#e6f3ff;padding:28px 20px">
        <div style="font-size:52px;font-weight:100;color:${ACCENT};letter-spacing:3px;margin-bottom:4px">JARVIS</div>
        <div style="font-size:15px;opacity:.65;margin-bottom:24px">${greet}, רואי &nbsp;•&nbsp; יום ${dayName}, ${today.toLocaleDateString('he-IL')}</div>

        <div style="background:#0a1828;border:1px solid ${ACCENT}44;border-radius:12px;padding:14px 16px;margin-bottom:14px;text-align:right">
          <div style="font-size:11px;color:${ACCENT};margin-bottom:8px;letter-spacing:.5px;text-transform:uppercase">📋 הלוז שלך היום</div>
          ${blocks.length ? blocks.map(b => `
            <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px;
              border-bottom:1px solid ${ACCENT}11">
              <span>${b.title}</span>
              <span style="opacity:.55">${b.start}–${b.end}</span>
            </div>`).join('') : '<div style="opacity:.5;font-size:13px;padding:4px 0">אין בלוקים מוגדרים להיום.</div>'}
        </div>

        ${behind.length ? `
        <div style="background:rgba(255,77,109,.06);border:1px solid ${ACCENT_BAD}44;border-radius:10px;
          padding:12px 14px;margin-bottom:14px;text-align:right">
          <div style="color:${ACCENT_BAD};font-size:11px;margin-bottom:6px">⚠️ חוב פרויקטים</div>
          ${behind.map(([p,o]) => `<div style="font-size:12px;opacity:.85">${p}: ${Math.round(o.debt/60*10)/10} שעות</div>`).join('')}
        </div>` : `
        <div style="background:rgba(66,230,149,.05);border:1px solid ${ACCENT_OK}44;border-radius:10px;
          padding:10px 14px;margin-bottom:14px;font-size:13px;color:${ACCENT_OK}">
          ✅ אין חוב פרויקטים — כל הכבוד!
        </div>`}

        <button id="jv-lock-enter" style="background:${ACCENT};color:#001828;border:none;border-radius:24px;
          padding:13px 44px;font-size:16px;font-weight:700;cursor:pointer;letter-spacing:.5px;
          box-shadow:0 0 32px ${ACCENT}66;transition:transform .15s">
          בוא נתחיל 🚀
        </button>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <button id="jv-lock-checkin" style="background:transparent;color:${ACCENT};border:1px solid ${ACCENT}55;
            border-radius:18px;padding:8px 18px;font-size:12px;cursor:pointer">☀️ צ׳ק-אין יומי</button>
          <button id="jv-lock-skip" style="background:transparent;color:#8b9bb4;border:1px solid #8b9bb444;
            border-radius:18px;padding:8px 18px;font-size:12px;cursor:pointer">דלג →</button>
        </div>
      </div>`;

    document.body.appendChild(wrap);
    requestAnimationFrame(() => { wrap.style.opacity = '1'; });

    const dismiss = () => {
      wrap.style.opacity = '0';
      setTimeout(() => wrap.remove(), 400);
    };

    wrap.querySelector('#jv-lock-enter').onmouseenter = function() { this.style.transform = 'scale(1.04)'; };
    wrap.querySelector('#jv-lock-enter').onmouseleave = function() { this.style.transform = 'scale(1)'; };
    wrap.querySelector('#jv-lock-enter').onclick = () => { dismiss(); speak(`${greet}, רואי. בוא נתחיל.`); };
    wrap.querySelector('#jv-lock-checkin').onclick = () => { dismiss(); setTimeout(openDailyCheckIn, 350); };
    wrap.querySelector('#jv-lock-skip').onclick    = dismiss;
  }

  // ────────────────────────────────────────────────────────────────────────
  // 12-B. DAILY CHECK-IN MODAL
  // ────────────────────────────────────────────────────────────────────────
  function openDailyCheckIn() {
    const today     = new Date();
    const isEvening = today.getHours() >= 17;
    const suffix    = isEvening ? '_pm' : '_am';
    const ciKey     = 'jv_checkin_' + dateKey(today) + suffix;
    const existing  = readLocal(ciKey, {});
    const title     = isEvening ? '🌙 צ׳ק-אין ערב' : '☀️ צ׳ק-אין בוקר';

    let html;
    if (isEvening) {
      // ── EVENING ── what happened
      html = `
        <div style="display:flex;flex-direction:column;gap:12px;font-size:13px">
          <div style="color:${ACCENT};font-size:11px;opacity:.75">${today.toLocaleDateString('he-IL')} — סיכום יום</div>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">✅ מה הושלם היום?</span>
            <textarea id="ci-done" rows="2" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
              border-radius:8px;padding:8px;font-size:13px;resize:none;direction:rtl"
              placeholder="הישגים, משימות שנסגרו...">${existing.done || ''}</textarea>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">❌ מה הוחמץ / לא הסתיים?</span>
            <textarea id="ci-missed" rows="2" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
              border-radius:8px;padding:8px;font-size:13px;resize:none;direction:rtl"
              placeholder="בלוקים שלא בוצעו...">${existing.missed || ''}</textarea>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">📦 מה עובר למחר?</span>
            <textarea id="ci-move" rows="2" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
              border-radius:8px;padding:8px;font-size:13px;resize:none;direction:rtl"
              placeholder="משימות שנדחות למחר...">${existing.move || ''}</textarea>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">⚡ רמת אנרגיה צפויה מחר</span>
            <div style="display:flex;gap:8px">
              <button data-e="low"    class="ci-e-btn" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;
                background:${existing.energyTmr==='low'?ACCENT+'33':'#0f1e36'};
                color:${existing.energyTmr==='low'?ACCENT:'#cfe8ff'};border:1px solid ${ACCENT}33">😴 נמוכה</button>
              <button data-e="medium" class="ci-e-btn" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;
                background:${!existing.energyTmr||existing.energyTmr==='medium'?ACCENT+'33':'#0f1e36'};
                color:${!existing.energyTmr||existing.energyTmr==='medium'?ACCENT:'#cfe8ff'};border:1px solid ${ACCENT}33">😐 בינונית</button>
              <button data-e="high"   class="ci-e-btn" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;
                background:${existing.energyTmr==='high'?ACCENT+'33':'#0f1e36'};
                color:${existing.energyTmr==='high'?ACCENT:'#cfe8ff'};border:1px solid ${ACCENT}33">⚡ גבוהה</button>
            </div>
          </label>
          <input type="hidden" id="ci-energy-val" value="${existing.energyTmr || 'medium'}"/>
          <button id="ci-save" style="background:${ACCENT};color:#001828;border:none;border-radius:8px;
            padding:10px;font-weight:700;cursor:pointer;margin-top:4px">שמור סיכום ✓</button>
        </div>`;
    } else {
      // ── MORNING ── what's planned
      const topBlocks = blocksForDay(today).filter(b => b.type === 'deep_work' || (b.proj && b.type !== 'food' && b.type !== 'reminder')).slice(0, 4);
      html = `
        <div style="display:flex;flex-direction:column;gap:12px;font-size:13px">
          <div style="color:${ACCENT};font-size:11px;opacity:.75">${today.toLocaleDateString('he-IL')} — תכנון יום</div>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">🎯 המשימה המרכזית שלך היום</span>
            <input id="ci-main" type="text" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
              border-radius:8px;padding:8px;font-size:13px;direction:rtl"
              placeholder="הדבר האחד הכי חשוב היום..." value="${existing.main || ''}"/>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">📋 משימה שניונית (אם יהיה זמן)</span>
            <input id="ci-sec" type="text" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
              border-radius:8px;padding:8px;font-size:13px;direction:rtl"
              placeholder="משימה חשובה נוספת..." value="${existing.secondary || ''}"/>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">⚡ רמת אנרגיה היום</span>
            <div style="display:flex;gap:8px">
              <button data-e="low"    class="ci-e-btn" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;
                background:${existing.energy==='low'?ACCENT+'33':'#0f1e36'};
                color:${existing.energy==='low'?ACCENT:'#cfe8ff'};border:1px solid ${ACCENT}33">😴 נמוכה</button>
              <button data-e="medium" class="ci-e-btn" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;
                background:${!existing.energy||existing.energy==='medium'?ACCENT+'33':'#0f1e36'};
                color:${!existing.energy||existing.energy==='medium'?ACCENT:'#cfe8ff'};border:1px solid ${ACCENT}33">😐 בינונית</button>
              <button data-e="high"   class="ci-e-btn" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;
                background:${existing.energy==='high'?ACCENT+'33':'#0f1e36'};
                color:${existing.energy==='high'?ACCENT:'#cfe8ff'};border:1px solid ${ACCENT}33">⚡ גבוהה</button>
            </div>
          </label>
          <input type="hidden" id="ci-energy-val" value="${existing.energy || 'medium'}"/>
          ${topBlocks.length ? `
          <div style="background:#0f1e36;border-radius:8px;padding:10px">
            <div style="font-size:11px;opacity:.65;margin-bottom:6px">📅 הבלוקים שלך היום:</div>
            ${topBlocks.map(b=>`<div style="font-size:12px;opacity:.75;padding:3px 0">${b.start} — ${b.title}</div>`).join('')}
          </div>` : ''}
          <button id="ci-save" style="background:${ACCENT};color:#001828;border:none;border-radius:8px;
            padding:10px;font-weight:700;cursor:pointer;margin-top:4px">שמור תכנון ✓</button>
        </div>`;
    }

    const m = modalShell(title, html);

    // Energy toggle buttons
    m.querySelectorAll('.ci-e-btn').forEach(btn => {
      btn.onclick = () => {
        m.querySelectorAll('.ci-e-btn').forEach(b => {
          b.style.background = '#0f1e36'; b.style.color = '#cfe8ff';
        });
        btn.style.background = ACCENT + '33'; btn.style.color = ACCENT;
        m.querySelector('#ci-energy-val').value = btn.dataset.e;
      };
    });

    m.querySelector('#ci-save').onclick = () => {
      const energy = m.querySelector('#ci-energy-val').value;
      let data, replyText;
      if (isEvening) {
        data = {
          done:      m.querySelector('#ci-done').value,
          missed:    m.querySelector('#ci-missed').value,
          move:      m.querySelector('#ci-move').value,
          energyTmr: energy,
          ts:        Date.now(),
        };
        replyText = `סיכום היום נשמר. ${data.move ? 'מחר: ' + data.move.split('\n')[0] + '.' : 'לילה טוב, רואי.'}`;
      } else {
        data = {
          main:      m.querySelector('#ci-main').value,
          secondary: m.querySelector('#ci-sec').value,
          energy,
          ts:        Date.now(),
        };
        const eTip = energy === 'low' ? 'תתמקד בדברים החיוניים בלבד.'
                   : energy === 'high' ? 'תנצל את הטייסת! בוא נתקוף את היום.'
                   : 'לוז רגיל — תתקדם בשלב שלב.';
        replyText = data.main
          ? `קיבלתי. המשימה המרכזית: "${data.main}". ${eTip}`
          : eTip;
        // Add as a task to the app if possible
        if (data.main && typeof window.addTask === 'function') {
          try { window.addTask({ text: data.main, priority:'high', tags:['יומי'] }); } catch(e) {}
        }
      }
      writeLocal(ciKey, data);
      logEvent(isEvening ? 'checkin.pm' : 'checkin.am', data);
      hud.setReply(replyText);
      speak(replyText);
      hud.toast(isEvening ? 'סיכום ערב נשמר ✓' : 'תכנון בוקר נשמר ✓', 'ok');
      m.remove();
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // 12-C. WEEKLY REVIEW MODAL
  // ────────────────────────────────────────────────────────────────────────
  function openWeeklyReview() {
    const today    = new Date();
    const wk       = isoWeekKey(today);
    const debt     = projectDebt();
    const sched    = loadSchedule();
    const wkData   = sched.weeks[wk] || {};
    const wrKey    = 'jv_weeklyreview_' + wk;
    const existing = readLocal(wrKey, {});

    // Tally block statuses for this week
    const tally = { completed:0, partial:0, missed:0, replaced:0 };
    Object.values(wkData).forEach(s => { if (tally[s.status] !== undefined) tally[s.status]++; });
    const total = Object.values(tally).reduce((a,b)=>a+b,0);
    const pct   = total ? Math.round((tally.completed/total)*100) : 0;

    const behind = Object.entries(debt).filter(([,o]) => o.debt > 0);
    const ontrack = Object.entries(debt).filter(([,o]) => o.debt <= 0 && o.planned > 0);

    const html = `
      <div style="display:flex;flex-direction:column;gap:14px;font-size:13px">
        <div style="background:#0f1e36;border-radius:10px;padding:14px">
          <div style="color:${ACCENT};font-size:11px;margin-bottom:10px;letter-spacing:.5px">📊 שבוע ${wk} — סיכום</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;text-align:center">
            <div style="background:#0a1828;border-radius:8px;padding:8px">
              <div style="font-size:22px;color:${ACCENT_OK}">${tally.completed}</div>
              <div style="font-size:10px;opacity:.6">בוצע</div>
            </div>
            <div style="background:#0a1828;border-radius:8px;padding:8px">
              <div style="font-size:22px;color:${ACCENT_BAD}">${tally.missed}</div>
              <div style="font-size:10px;opacity:.6">הוחמץ</div>
            </div>
            <div style="background:#0a1828;border-radius:8px;padding:8px">
              <div style="font-size:22px;color:${ACCENT_WARM}">${tally.partial}</div>
              <div style="font-size:10px;opacity:.6">חלקי</div>
            </div>
            <div style="background:#0a1828;border-radius:8px;padding:8px">
              <div style="font-size:22px;color:#8b9bb4">${tally.replaced}</div>
              <div style="font-size:10px;opacity:.6">הוחלף</div>
            </div>
          </div>
          ${total ? `
          <div style="margin-top:10px">
            <div style="display:flex;justify-content:space-between;font-size:11px;opacity:.7;margin-bottom:4px">
              <span>ביצוע כולל</span><span>${pct}%</span>
            </div>
            <div style="background:#0a1828;height:6px;border-radius:3px;overflow:hidden">
              <div style="background:${pct<50?ACCENT_BAD:pct<80?ACCENT_WARM:ACCENT_OK};height:100%;width:${pct}%;transition:.4s"></div>
            </div>
          </div>` : ''}
        </div>

        ${behind.length ? `
        <div style="background:rgba(255,77,109,.05);border:1px solid ${ACCENT_BAD}33;border-radius:10px;padding:12px">
          <div style="color:${ACCENT_BAD};font-size:11px;margin-bottom:8px">⚠️ פרויקטים מאחורי</div>
          ${behind.map(([p,o])=>`
            <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px">
              <span>${p}</span>
              <span style="color:${ACCENT_BAD}">${Math.round(o.actual/60*10)/10}/${Math.round(o.planned/60*10)/10} ש׳</span>
            </div>`).join('')}
        </div>` : ''}

        ${ontrack.length ? `
        <div style="background:rgba(66,230,149,.04);border:1px solid ${ACCENT_OK}33;border-radius:10px;padding:10px">
          <div style="color:${ACCENT_OK};font-size:11px;margin-bottom:6px">✅ פרויקטים בקצב טוב</div>
          <div style="font-size:12px;opacity:.8">${ontrack.map(([p])=>p).join(' · ')}</div>
        </div>` : ''}

        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="opacity:.8">🏆 הגדול של השבוע (הישג אחד)</span>
          <input id="wr-win" type="text" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
            border-radius:8px;padding:8px;font-size:13px;direction:rtl"
            placeholder="הדבר הכי טוב שהשגת השבוע..." value="${existing.win || ''}"/>
        </label>

        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="opacity:.8">🎯 עדיפות ראשית שבוע הבא</span>
          <input id="wr-next" type="text" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
            border-radius:8px;padding:8px;font-size:13px;direction:rtl"
            placeholder="מה הדבר הכי חשוב לשבוע הבא?" value="${existing.nextPriority || ''}"/>
        </label>

        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="opacity:.8">📦 מה להעביר לשבוע הבא?</span>
          <textarea id="wr-move" rows="2" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
            border-radius:8px;padding:8px;font-size:13px;resize:none;direction:rtl"
            placeholder="משימות / בלוקים שלא הספקת...">${existing.move || ''}</textarea>
        </label>

        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="opacity:.8">✂️ מה לשנות / לצמצם בלוז?</span>
          <textarea id="wr-reduce" rows="2" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
            border-radius:8px;padding:8px;font-size:13px;resize:none;direction:rtl"
            placeholder="מה לא עבד בלוז השבוע...">${existing.reduce || ''}</textarea>
        </label>

        <button id="wr-save" style="background:${ACCENT};color:#001828;border:none;border-radius:8px;
          padding:10px;font-weight:700;cursor:pointer">שמור סיכום שבועי ✓</button>
      </div>`;

    const m = modalShell('📊 סיכום שבועי — Weekly Review', html);
    m.querySelector('#wr-save').onclick = () => {
      const data = {
        win:          m.querySelector('#wr-win').value,
        nextPriority: m.querySelector('#wr-next').value,
        move:         m.querySelector('#wr-move').value,
        reduce:       m.querySelector('#wr-reduce').value,
        tally,
        pct,
        debtSnapshot: debt,
        ts:           Date.now(),
      };
      writeLocal(wrKey, data);
      logEvent('weekly.review', data);
      const reply = data.nextPriority
        ? `סיכום שבועי נשמר. עדיפות שבוע הבא: "${data.nextPriority}". ${data.win ? 'כל הכבוד על ' + data.win + '!' : 'שבוע טוב!'}`
        : 'סיכום שבועי נשמר. שבוע טוב, רואי!';
      speak(reply); hud.toast('סיכום שבועי נשמר ✓', 'ok'); m.remove();
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // 12-D. "מה לעשות עכשיו" — ENERGY PANEL
  // ────────────────────────────────────────────────────────────────────────
  function openWhatNowPanel() {
    const html = `
      <div style="display:flex;flex-direction:column;gap:14px;font-size:13px">
        <p style="opacity:.8;margin:0;font-size:13px">מה רמת האנרגיה שלך ברגע זה?</p>
        <div style="display:flex;gap:8px">
          <button data-e="low" class="wn-btn" style="flex:1;background:#0f1e36;color:#cfe8ff;
            border:1px solid ${ACCENT}33;border-radius:10px;padding:12px 6px;cursor:pointer;font-size:13px">
            😴<br/><span style="font-size:11px;opacity:.7">נמוכה</span>
          </button>
          <button data-e="medium" class="wn-btn" style="flex:1;background:#0f1e36;color:#cfe8ff;
            border:1px solid ${ACCENT}33;border-radius:10px;padding:12px 6px;cursor:pointer;font-size:13px">
            😐<br/><span style="font-size:11px;opacity:.7">בינונית</span>
          </button>
          <button data-e="high" class="wn-btn" style="flex:1;background:${ACCENT}22;color:${ACCENT};
            border:1px solid ${ACCENT};border-radius:10px;padding:12px 6px;cursor:pointer;font-size:13px">
            ⚡<br/><span style="font-size:11px;opacity:.9">גבוהה</span>
          </button>
        </div>
        <div id="wn-result" style="min-height:56px;padding:12px;background:#0f1e36;border-radius:8px;
          color:#8b9bb4;font-size:13px;line-height:1.5;text-align:right">
          בחר רמת אנרגיה...
        </div>
        <div id="wn-debt" style="display:none;padding:10px;background:rgba(255,77,109,.06);
          border:1px solid ${ACCENT_BAD}33;border-radius:8px;font-size:12px;text-align:right"></div>
      </div>`;

    const m = modalShell('⚡ מה לעשות עכשיו?', html);
    m.querySelectorAll('.wn-btn').forEach(btn => {
      btn.onclick = () => {
        const energy = btn.dataset.e;
        m.querySelectorAll('.wn-btn').forEach(b => {
          b.style.background = '#0f1e36'; b.style.color = '#cfe8ff';
          b.style.border = `1px solid ${ACCENT}33`;
        });
        btn.style.background = ACCENT + '33'; btn.style.color = ACCENT;
        btn.style.border = `1px solid ${ACCENT}`;

        const result = ACTIONS.whatNow({ energy });
        const el = m.querySelector('#wn-result');
        el.style.color = ACCENT;
        el.textContent = result;

        // Also show debt if behind
        const debt = projectDebt();
        const behind = Object.entries(debt).filter(([,o]) => o.debt > 30);
        const debtEl = m.querySelector('#wn-debt');
        if (behind.length) {
          debtEl.style.display = 'block';
          debtEl.innerHTML = `<strong style="color:${ACCENT_WARM}">⚠️ חוב פרויקטים:</strong> ` +
            behind.map(([p,o]) => `${p}: ${Math.round(o.debt/60*10)/10}ש׳`).join(' · ');
        }
        speak(result);
      };
    });
    // Auto-click medium as default
    m.querySelector('[data-e="medium"]').click();
  }

  // ────────────────────────────────────────────────────────────────────────
  // 12. BOOT
  // ────────────────────────────────────────────────────────────────────────
  function boot() {
    hud.mount();
    bindRecog = (function(orig){return function(){ recog = recog || makeRecognizer(); return orig(); }})(bindRecogActual);
    bindRecogActual();
    if (settings().wakeWordOn) startListening(false);
    setupBriefings();
    // Render debt widget once dashboard is ready
    setTimeout(renderDebtWidget, 1500);
    // Ask for notification permission lazily
    if ('Notification' in window && Notification.permission === 'default') {
      setTimeout(() => Notification.requestPermission().catch(()=>{}), 6000);
    }
    // expose API
    window.JARVIS = {
      version: VERSION,
      handle, route, speak, listen: startListening, stop: stopListening,
      readState, projectDebt, blockStatus, setBlockStatus, replaceBlock,
      suggestReschedule, getLog, settings, updateSettings,
      // modals
      openSchedule:     openScheduleModal,
      openLog:          openLogModal,
      openSettings:     openSettingsModal,
      openCheckIn:      openDailyCheckIn,
      openWeeklyReview: openWeeklyReview,
      openWhatNow:      openWhatNowPanel,
      openLock:         openLockScreen,
      // shorthand commands
      brief:    () => ACTIONS.morningBrief(),
      debt:     () => ACTIONS.showDebt(),
      whatNow:  (e)    => ACTIONS.whatNow({ energy: e || 'medium' }),
      whatSkip: ()     => ACTIONS.whatToSkip(),
      planDay:  ()     => ACTIONS.planByMissed(),
      logTime:  (args) => ACTIONS.logActualTime(args),
      activity: (args) => ACTIONS.activityReport(args),
    };
    // Show daily lock/greeting screen once per day
    setTimeout(openLockScreen, 900);
    console.log('%cJARVIS v' + VERSION + ' online. New: Lock screen, Check-In, Weekly Review, Energy planner.', 'color:#00d4ff;font-weight:bold');
  }
  function bindRecogActual() {
    recog = makeRecognizer();
    bindRecog = function(){}; // no-op
    if (recog) bindRecogHandlers();
  }
  function bindRecogHandlers() {
    recog.onstart = () => { recogActive = true; hud.setState('listening'); };
    recog.onend   = () => {
      recogActive = false; hud.setState('idle');
      if (settings().wakeWordOn && !listeningHard) setTimeout(()=>startListening(false), 700);
    };
    recog.onerror = (e) => {
      hud.setState('idle');
      if (e.error === 'not-allowed') hud.toast('אין הרשאת מיקרופון.', 'error');
    };
    recog.onresult = async (ev) => {
      let interim = '', final = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      hud.setHeard((final || interim).trim());
      if (final) {
        const text = final.trim();
        if (settings().wakeWordOn && !listeningHard) {
          const wake = WAKE_WORDS.find(w => text.toLowerCase().includes(w.toLowerCase()));
          if (!wake) return;
          let cmd = text;
          for (const w of WAKE_WORDS) cmd = cmd.replace(new RegExp(w,'gi'),'').trim();
          if (!cmd) { speak('כן, רואי?'); listeningHard = true; return; }
          await processSpoken(cmd);
        } else {
          await processSpoken(text);
        }
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

/* ============================================================================
 * INTEGRATION INSTRUCTIONS — how to add JARVIS to your Personal OS
 * ============================================================================
 *
 * STEP 1 — Upload jarvis.js to your project root
 *   Place this file at the root of your GitHub repo (next to index.html).
 *
 * STEP 2 — Add ONE line to index.html
 *   Open index.html in your editor. Find the closing </body> tag and add:
 *
 *     <script src="/jarvis.js" defer></script>
 *
 *   It must come AFTER all other <script> tags so JARVIS can hook into
 *   the existing window.* functions (addTask, goPage, callClaude, etc.)
 *
 * STEP 3 — Commit and push to GitHub → Vercel auto-deploys
 *
 *   git add jarvis.js index.html
 *   git commit -m "feat: add JARVIS AI companion module v1.0"
 *   git push
 *
 * STEP 4 — Verify
 *   Open https://personal-os-coral-tau.vercel.app/
 *   You should see the blue arc-reactor orb in the bottom-right corner.
 *   Say "ג'רוויס, מה היום" or click the orb.
 *
 * ── localStorage keys used by JARVIS (all prefixed pos3_jarvis_) ──────────
 *   pos3_jarvis_schedule   — weekly block schedule + status log
 *   pos3_jarvis_log        — execution log (last 500 events)
 *   pos3_jarvis_settings   — voice, rate, briefing times
 *   pos3_jarvis_persona    — reserved for persona customisation
 *   jv_last_lock           — date of last lock-screen dismissal
 *   jv_last_am / jv_last_pm — briefing triggers
 *   jv_checkin_YYYY-MM-DD_am/pm — daily check-in data
 *   jv_weeklyreview_YYYY-W## — weekly review data
 *
 * ── Public API (window.JARVIS.*) ──────────────────────────────────────────
 *   .handle(text)         — process any Hebrew command string
 *   .speak(text)          — text-to-speech
 *   .listen()             — start voice recognition
 *   .brief()              — morning briefing
 *   .debt()               — project debt report
 *   .whatNow('high')      — energy-based recommendation (low/medium/high)
 *   .whatSkip()           — safe-to-skip blocks today
 *   .planDay()            — plan today from yesterday's misses
 *   .logTime({proj, actualMinutes, plannedMinutes})
 *   .activity({activity, fromHour, toHour})
 *   .openCheckIn()        — daily check-in modal
 *   .openWeeklyReview()   — weekly review modal
 *   .openWhatNow()        — energy panel
 *   .openLock()           — daily lock/greeting screen
 *   .openSchedule()       — quick-update schedule modal
 *   .openSettings()       — settings modal
 *
 * ── Voice commands (Hebrew) ───────────────────────────────────────────────
 *   "ג'רוויס, מה יש לי היום"
 *   "ג'רוויס, מה לעשות עכשיו"
 *   "הייתי בים מ-14 עד 17 במקום ללמוד"
 *   "עשיתי 70 דק׳ Upselles במקום 120"
 *   "תכנן לי את היום לפי מה שפספסתי אתמול"
 *   "מה אני יכול לדלג בלי לפגוע בשבוע"
 *   "הוסף משימה [שם] לפרויקט [פרויקט]"
 *   "תזכר לי על [משימה] בעוד [זמן]"
 *   "חוב פרויקטים"
 *   "צ׳ק-אין"
 *   "סיכום שבועי"
 *
 * ============================================================================ */
