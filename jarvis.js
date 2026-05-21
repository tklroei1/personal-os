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
  const VERSION       = '5.3.0';
  const STATE_KEY     = 'pos3';
  const LOG_KEY       = 'pos3_jarvis_log';
  const SCHED_KEY     = 'pos3_jarvis_schedule';
  const PERSONA_KEY   = 'pos3_jarvis_persona';
  const SETTINGS_KEY  = 'pos3_jarvis_settings';
  const WAKE_WORDS    = ['זורו','zoro','ג׳רוויס', 'גרוויס', "ג'רוויס", 'גארביס', 'jarvis', 'הג׳רוויס', 'הי גרוויס', 'היי זורו'];
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
    // ── SUNDAY (0) ──
    { id:'sun-plan',     day:0, start:'10:30', end:'11:00', title:'פתיחת שבוע', type:'planning',
      proj:null, dedicated:'בחירת 3 משימות מרכזיות לשבוע + בדיקת מה נכנס למשבצות', action:'תכנן את השבוע', replaceable:false, fixed:true },
    { id:'sun-upselles', day:0, start:'11:00', end:'13:00', title:'Upselles — עבודה עמוקה', type:'deep_work',
      proj:'upselles', dedicated:'עבודה עמוקה', action:'Roadmap / Prompt / בדיקה / קריאת דוח', replaceable:true, fixed:false },
    { id:'sun-buf1',     day:0, start:'13:00', end:'13:30', title:'באפר / מנוחה', type:'buffer',
      proj:null, dedicated:'מנוחה קצרה / מעבר', action:'מנוחה', replaceable:true, fixed:false },
    { id:'sun-bela',     day:0, start:'13:30', end:'14:30', title:'פגישה עם בלה', type:'meeting',
      proj:'family', dedicated:'פגישה קבועה', action:'נוכחות בפגישה', replaceable:false, fixed:true },
    { id:'sun-lunch',    day:0, start:'14:30', end:'15:20', title:'צהריים', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'30 דק׳ הכנה + 20 דק׳ אוכל', replaceable:false, fixed:true },
    { id:'sun-uni',      day:0, start:'15:30', end:'16:45', title:'אוניברסיטה — לימוד עצמי', type:'university',
      proj:'university', dedicated:'שיעורי בית', action:'פירוק מטלה / מעבר על חומר / תכנון השלמות', replaceable:true, fixed:false },
    { id:'sun-buf2',     day:0, start:'16:45', end:'17:45', title:'באפר / סידורים', type:'buffer',
      proj:null, dedicated:'התאוששות', action:'סידורים קלים / מנוחה', replaceable:true, fixed:false },
    { id:'sun-ronit',    day:0, start:'18:00', end:'18:45', title:'פגישה עם רונית', type:'meeting',
      proj:'family', dedicated:'פגישה קבועה', action:'נוכחות בפגישה', replaceable:false, fixed:true },
    { id:'sun-train',    day:0, start:'19:15', end:'20:45', title:'אימון כוח', type:'training',
      proj:'fitness', dedicated:'אימון ערב', action:'אימון לפי תוכנית', replaceable:false, fixed:true },
    { id:'sun-dinner',   day:0, start:'21:00', end:'21:35', title:'ארוחת ערב', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'15 דק׳ הכנה + 20 דק׳ אוכל', replaceable:false, fixed:true },
    { id:'sun-meat',     day:0, start:'22:00', end:'22:05', title:'תזכורת: הפשרת עוף/בשר', type:'reminder',
      proj:'fitness', dedicated:'הכנה למחר', action:'הוצא מהמקפיא', replaceable:false, fixed:true },

    // ── MONDAY (1) — יום אוניברסיטה מלא ──
    { id:'mon-commute',  day:1, start:'07:00', end:'08:00', title:'נסיעה לאוניברסיטה', type:'buffer',
      proj:'university', dedicated:'נסיעה', action:'יציאה ונסיעה', replaceable:false, fixed:true },
    { id:'mon-uni',      day:1, start:'08:00', end:'19:30', title:'אוניברסיטה — יום מלא', type:'university',
      proj:'university', dedicated:'לימודים', action:'הרצאות, תרגולים, מטלות בקמפוס', replaceable:false, fixed:true },
    { id:'mon-return',   day:1, start:'19:30', end:'20:15', title:'חזרה הביתה', type:'buffer',
      proj:null, dedicated:'נסיעה הביתה', action:'הגעה הביתה', replaceable:false, fixed:true },
    { id:'mon-recover',  day:1, start:'20:15', end:'21:00', title:'התאוששות', type:'recovery',
      proj:'fitness', dedicated:'אוכל / מקלחת / מנוחה אחרי יום עמוס', action:'אכילה, מקלחת, מנוחה', replaceable:true, fixed:false },
    { id:'mon-uni-rev',  day:1, start:'21:00', end:'21:20', title:'סיכום קצר — אוניברסיטה', type:'light',
      proj:'university', dedicated:'סיכום יום', action:'לכתוב 3 דברים שצריך להשלים מהאוניברסיטה', replaceable:true, fixed:false },
    { id:'mon-meat',     day:1, start:'22:00', end:'22:05', title:'תזכורת: הפשרת עוף/בשר', type:'reminder',
      proj:'fitness', dedicated:'הכנה', action:'הוצא מהמקפיא', replaceable:false, fixed:true },

    // ── TUESDAY (2) ──
    { id:'tue-plan',     day:2, start:'10:30', end:'11:00', title:'פתיחת יום', type:'planning',
      proj:null, dedicated:'תכנון', action:'בחירת משימה מרכזית + משימה משנית', replaceable:true, fixed:false },
    { id:'tue-uni',      day:2, start:'11:00', end:'13:00', title:'אוניברסיטה — לימוד עמוק', type:'deep_work',
      proj:'university', dedicated:'לימוד בית עמוק', action:'מטלה / תרגול / חומר קשה', replaceable:true, fixed:false },
    { id:'tue-lunch',    day:2, start:'13:00', end:'13:50', title:'צהריים', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'30 דק׳ הכנה + 20 דק׳ אוכל', replaceable:false, fixed:true },
    { id:'tue-upselles', day:2, start:'14:00', end:'15:30', title:'Upselles — עבודה עמוקה', type:'deep_work',
      proj:'upselles', dedicated:'עבודה עמוקה', action:'פלטפורמה / דוח / Prompt / צעד הבא', replaceable:true, fixed:false },
    { id:'tue-walk',     day:2, start:'16:00', end:'16:45', title:'הליכה / סידורים', type:'walk',
      proj:'fitness', dedicated:'תנועה', action:'30–45 דק׳ הליכה / סידורים / התאוששות', replaceable:true, fixed:false },
    { id:'tue-train',    day:2, start:'18:30', end:'20:00', title:'אימון כוח', type:'training',
      proj:'fitness', dedicated:'אימון ערב', action:'אימון לפי תוכנית', replaceable:false, fixed:true },
    { id:'tue-dinner',   day:2, start:'20:15', end:'20:50', title:'ארוחת ערב', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'15 דק׳ הכנה + 20 דק׳ אוכל', replaceable:false, fixed:true },
    { id:'tue-anthropic',day:2, start:'21:15', end:'22:00', title:'קורס Anthropic', type:'light',
      proj:'anthropic', dedicated:'למידת AI', action:'יחידה אחת + 5 נקודות סיכום', replaceable:true, fixed:false },
    { id:'tue-meat',     day:2, start:'22:00', end:'22:05', title:'תזכורת: הפשרת עוף/בשר', type:'reminder',
      proj:'fitness', dedicated:'הכנה', action:'הוצא מהמקפיא', replaceable:false, fixed:true },

    // ── WEDNESDAY (3) ──
    { id:'wed-plan',     day:3, start:'10:30', end:'11:00', title:'פתיחת יום', type:'planning',
      proj:null, dedicated:'תכנון', action:'בדיקת משימות היום ועדיפויות', replaceable:true, fixed:false },
    { id:'wed-uni',      day:3, start:'11:00', end:'13:00', title:'אוניברסיטה — לימוד עמוק', type:'deep_work',
      proj:'university', dedicated:'לימוד בית', action:'עבודות / תרגול / קריאה', replaceable:true, fixed:false },
    { id:'wed-lunch',    day:3, start:'13:00', end:'13:50', title:'צהריים', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'30 דק׳ הכנה + 20 דק׳ אוכל', replaceable:false, fixed:true },
    { id:'wed-apt',      day:3, start:'14:00', end:'15:00', title:'חיפוש דירה', type:'light',
      proj:'apartment', dedicated:'איתור דירה', action:'מודעות / הודעות / תיאום צפיות', replaceable:true, fixed:false },
    { id:'wed-tamar',    day:3, start:'15:30', end:'17:00', title:'פגישה עם תמר', type:'meeting',
      proj:'family', dedicated:'פגישה קבועה', action:'נוכחות בפגישה', replaceable:false, fixed:true },
    { id:'wed-walk',     day:3, start:'17:30', end:'18:15', title:'הליכה', type:'walk',
      proj:'fitness', dedicated:'תנועה', action:'30–45 דק׳ הליכה', replaceable:true, fixed:false },
    { id:'wed-dinner',   day:3, start:'19:00', end:'19:35', title:'ארוחת ערב', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'15 דק׳ הכנה + 20 דק׳ אוכל', replaceable:false, fixed:true },
    { id:'wed-jobs',     day:3, start:'20:00', end:'21:00', title:'חיפוש עבודה', type:'light',
      proj:'jobs', dedicated:'חיפוש משרות', action:'למצוא 3 משרות ולשמור בטבלה', replaceable:true, fixed:false },
    { id:'wed-meat',     day:3, start:'22:00', end:'22:05', title:'תזכורת: הפשרת עוף/בשר', type:'reminder',
      proj:'fitness', dedicated:'הכנה', action:'הוצא מהמקפיא', replaceable:false, fixed:true },

    // ── THURSDAY (4) ──
    { id:'thu-plan',     day:4, start:'10:30', end:'11:00', title:'פתיחת יום', type:'planning',
      proj:null, dedicated:'תכנון', action:'בדיקת פוקוס יומי', replaceable:true, fixed:false },
    { id:'thu-upselles', day:4, start:'11:00', end:'13:00', title:'Upselles — עבודה עמוקה', type:'deep_work',
      proj:'upselles', dedicated:'עבודה עמוקה', action:'Prompt / פיצ׳ר / בדיקות / Roadmap', replaceable:true, fixed:false },
    { id:'thu-lunch',    day:4, start:'13:00', end:'13:50', title:'צהריים', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'30 דק׳ הכנה + 20 דק׳ אוכל', replaceable:false, fixed:true },
    { id:'thu-uni',      day:4, start:'14:00', end:'15:30', title:'אוניברסיטה — מטלה', type:'medium',
      proj:'university', dedicated:'לימוד בית', action:'מטלה / תרגול / כתיבה', replaceable:true, fixed:false },
    { id:'thu-walk',     day:4, start:'16:00', end:'16:45', title:'הליכה / סידורים', type:'walk',
      proj:'fitness', dedicated:'תנועה', action:'הליכה או סידורים קלים', replaceable:true, fixed:false },
    { id:'thu-train',    day:4, start:'18:30', end:'20:00', title:'אימון כוח', type:'training',
      proj:'fitness', dedicated:'אימון ערב', action:'אימון לפי תוכנית', replaceable:false, fixed:true },
    { id:'thu-dinner',   day:4, start:'20:15', end:'20:50', title:'ארוחת ערב', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'15 דק׳ הכנה + 20 דק׳ אוכל', replaceable:false, fixed:true },
    { id:'thu-review',   day:4, start:'21:15', end:'21:45', title:'עדכון שבועי קצר', type:'planning',
      proj:null, dedicated:'סיכום', action:'מה בוצע ומה עובר לשבת / שבוע הבא', replaceable:true, fixed:false },
    { id:'thu-meat',     day:4, start:'22:00', end:'22:05', title:'תזכורת: הפשרת עוף/בשר', type:'reminder',
      proj:'fitness', dedicated:'הכנה', action:'הוצא מהמקפיא', replaceable:false, fixed:true },

    // ── FRIDAY (5) ──
    { id:'fri-plan',     day:5, start:'10:30', end:'11:00', title:'פתיחת יום קלילה', type:'planning',
      proj:null, dedicated:'תכנון', action:'בדיקת משימות קצרות', replaceable:true, fixed:false },
    { id:'fri-jobs',     day:5, start:'11:00', end:'12:15', title:'חיפוש עבודה', type:'medium',
      proj:'jobs', dedicated:'הגשת מועמדויות', action:'להגיש ל־2 משרות איכותיות + עדכון מעקב', replaceable:true, fixed:false },
    { id:'fri-errands',  day:5, start:'12:15', end:'13:00', title:'סידורים / בית', type:'light',
      proj:null, dedicated:'סידורים', action:'קניות / בית / משימות קטנות', replaceable:true, fixed:false },
    { id:'fri-lunch',    day:5, start:'13:00', end:'13:50', title:'צהריים', type:'food',
      proj:'fitness', dedicated:'תזונה', action:'30 דק׳ הכנה + 20 דק׳ אוכל', replaceable:false, fixed:true },
    { id:'fri-apt',      day:5, start:'14:00', end:'15:15', title:'חיפוש דירה', type:'medium',
      proj:'apartment', dedicated:'איתור דירה', action:'הודעות / תיאום צפיות / סטטוס', replaceable:true, fixed:false },
    { id:'fri-rest',     day:5, start:'15:15', end:'17:30', title:'מנוחה / התארגנות', type:'recovery',
      proj:'family', dedicated:'מנוחה', action:'משפחה / מנוחה / הכנות לשישי', replaceable:true, fixed:false },
    { id:'fri-dinner',   day:5, start:'18:00', end:'20:00', title:'ארוחת שישי — משפחה', type:'family',
      proj:'family', dedicated:'זמן משפחתי', action:'ארוחת שישי עם המשפחה', replaceable:false, fixed:true },

    // ── SATURDAY (6) ──
    { id:'sat-buffer',   day:6, start:'14:00', end:'16:00', title:'השלמות (אופציונלי)', type:'buffer',
      proj:null, dedicated:'השלמת חוב', action:'אוניברסיטה / Upselles / מה שפוספס בלבד', replaceable:true, fixed:false },
    { id:'sat-walk',     day:6, start:'16:30', end:'17:15', title:'הליכה (אופציונלי)', type:'walk',
      proj:'fitness', dedicated:'תנועה', action:'הליכה אם מתאים', replaceable:true, fixed:false },
    { id:'sat-review',   day:6, start:'18:00', end:'18:45', title:'Weekly Review', type:'planning',
      proj:null, dedicated:'סיכום שבוע + תכנון שבוע הבא', action:'מה בוצע / מה חסר / יעדים', replaceable:false, fixed:true },
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

  function getCurrentPage() {
    if (typeof window.currentPage === 'string') return window.currentPage;
    const hash = location.hash.replace('#','');
    if (hash) return hash;
    const active = document.querySelector('[class*="active"][data-page], .nav-link.active, [class*="navItem"][class*="active"]');
    if (active) return active.dataset?.page || active.textContent?.trim() || 'unknown';
    return 'dashboard';
  }

  function readState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function writeState(s) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(s));
      // Try all known render functions the host app might expose
      const renders = ['renderAll','render','refreshApp','update','rerender','updateUI'];
      for (const fn of renders) {
        if (typeof window[fn] === 'function') { try { window[fn](); } catch(e) {} break; }
      }
      // Also dispatch storage event so any listeners in the app pick it up
      try { window.dispatchEvent(new StorageEvent('storage', { key: STATE_KEY, storageArea: localStorage })); } catch(e) {}
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
      if (!text) return 'What task should I add?';
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
      celebrate();
      return `Added: "${text}"${args.proj ? ' → ' + args.proj : ''}.`;
    },
    completeTask(args) {
      const q = (args.match || args.text || '').toLowerCase();
      if (!q) return 'Which task should I mark done?';
      const state = readState();
      const t = (state.tasks||[]).find(t => !t.done && t.text.toLowerCase().includes(q));
      if (!t) return `I couldn't find a task matching "${q}".`;
      t.done = true; t.progress = 100; t.status = 'done';
      writeState(state);
      logEvent('task.complete', { id:t.id, text:t.text });
      celebrate();
      return `Done ✓ "${t.text}". Good work.`;
    },
    addReminder(args) {
      const text = args.text;
      if (!text) return 'What should I remind you about?';
      const when = parseRelativeTime(args.when || args.in);
      const state = readState();
      state.reminders = state.reminders || [];
      const id = (state.reminders.reduce((m,r)=>Math.max(m,r.id||0),0) || 0) + 1;
      const timeStr = String(when.getHours()).padStart(2,'0')+':'+String(when.getMinutes()).padStart(2,'0');
      state.reminders.push({
        id, text,
        date: dateKey(when),
        time: timeStr,
        done:false, repeat: args.repeat || 'none'
      });
      writeState(state);
      logEvent('reminder.add', { text, when: when.toISOString() }, id);
      scheduleNotif(text, when);
      return `🔔 Reminder set: "${text}" at ${timeStr}.`;
    },
    addScheduleBlock(args) {
      // "תכנסי X מ-Y עד Z" / "schedule X from Y to Z"
      const today = new Date();
      const dayNum = typeof args.day === 'number' ? args.day : today.getDay();
      const block = writeScheduleBlock(dayNum, args.start, args.end, args.title, args.type || 'medium', args.proj || null);
      hud.toast(`Schedule updated: ${block.title}`, 'ok');
      return `📅 Scheduled "${block.title}" from ${block.start} to ${block.end}. Check your weekly view.`;
    },
    queryDue(args) {
      const scope = args.scope || 'week';
      if (scope === 'today') {
        const tasks = dueToday();
        const evts = todayEvents();
        const blks = blocksForDay(new Date()).slice(0,4);
        const lines = [];
        if (tasks.length) lines.push(`${tasks.length} task${tasks.length>1?'s':''} due today: ${tasks.slice(0,3).map(t=>t.text).join(', ')}${tasks.length>3?' ...':''}.`);
        if (evts.length)  lines.push(`Events: ${evts.map(e=>`${e.time} ${e.title}`).join(', ')}.`);
        if (blks.length)  lines.push(`Schedule: ${blks.map(b=>`${b.start} ${b.title}`).join(' → ')}.`);
        if (!lines.length) lines.push('Your day looks clear. Good opportunity to chip away at project debt.');
        return lines.join(' ');
      }
      const tasks = dueThisWeek();
      const debt  = projectDebt();
      const debts = Object.entries(debt).filter(([,o])=>o.debt>0)
        .map(([p,o])=>`${p}: ${Math.round(o.debt/60)}h debt`).join(', ');
      return `This week: ${tasks.length} open task${tasks.length!==1?'s':''}. ${debts ? 'Project debt — '+debts+'.' : 'No project debt. On track!'}`;
    },
    morningBrief() {
      const tasks = dueToday();
      const evts  = todayEvents();
      const blks  = blocksForDay(new Date()).slice(0,5);
      const debt  = projectDebt();
      const debts = Object.entries(debt).filter(([,o])=>o.debt>0);
      const dt    = new Date();
      const greet = dt.getHours() < 12 ? 'Good morning' : dt.getHours() < 17 ? 'Good afternoon' : 'Good evening';
      const lines = [
        `${greet}, Roei.`,
        tasks.length ? `You have ${tasks.length} task${tasks.length>1?'s':''} today.` : 'No urgent tasks today.',
        blks.length  ? `Today\'s schedule: ${blks.map(b=>`${b.start} ${b.title}`).join(', ')}.` : '',
        evts.length  ? `Events: ${evts.map(e=>`${e.time} ${e.title}`).join(', ')}.` : '',
        debts.length ? `Watch out — project debt on: ${debts.map(([p])=>p).join(', ')}.` : '',
        `I'm here when you need me.`
      ].filter(Boolean);
      return lines.join(' ');
    },
    eveningBrief() {
      const log = getLog(e => e.ts > Date.now() - 24*3600*1000);
      const completed = log.filter(e => e.kind === 'task.complete').length;
      const added     = log.filter(e => e.kind === 'task.add').length;
      const debt = projectDebt();
      const behind = Object.entries(debt).filter(([,o])=>o.debt>0);
      const lines = [
        `Day summary: ${completed} task${completed!==1?'s':''} completed, ${added} added.`,
        behind.length
          ? `Tomorrow, prioritize debt on: ${behind.map(([p])=>p).join(', ')}.`
          : 'All projects are on track. Well done.',
        'Good night.'
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
      return `Block "${args.blockId}" updated → ${args.status}.`;
    },
    rescheduleBlock(args) {
      const date = args.date ? new Date(args.date) : new Date();
      const sug  = suggestReschedule(args.blockId, date);
      if (!sug) return 'No free slot found this week. Consider Saturday.';
      return `Suggested slot: ${sug.day.toLocaleDateString('en-IL')} at ${sug.start}–${sug.end}.`;
    },
    showDebt() {
      const debt = projectDebt();
      const lines = Object.entries(debt).map(([p,o]) =>
        `${p}: planned ${Math.round(o.planned/60)}h, done ${Math.round(o.actual/60)}h, debt ${Math.round(o.debt/60)}h`
      );
      return lines.length ? lines.join(' | ') : 'No project data yet this week.';
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
      if (args.activity) lines.push(`Logged: ${args.activity} between ${from}:00–${to}:00.`);
      if (replaceable.length) lines.push(`"${replaceable.map(b=>b.title).join(', ')}" → marked as replaced.`);
      if (fixed.length)       lines.push(`"${fixed.map(b=>b.title).join(', ')}" → marked as missed.`);
      const sug = replaceable[0] ? suggestReschedule(replaceable[0].id, today) : null;
      if (sug) lines.push(`Recovery slot: ${sug.day.toLocaleDateString('en-IL')} at ${sug.start}–${sug.end}.`);
      return lines.join(' ') || 'Schedule updated.';
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
      if (diff > 0) return `${pName}: you did ${actual} of ${planned} min. ${diff} min debt — suggest making it up tomorrow.`;
      return `${pName}: ${actual} min done — excellent!${planned ? ` (target was ${planned} min)` : ''}`;
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
      if (!missed.length) return 'Nothing missed yesterday — clean slate today! 🎉';
      const today = new Date();
      const suggestions = missed.slice(0, 3).map(b => {
        const sug = suggestReschedule(b.id, today);
        return sug ? `• ${b.title}: ${sug.start}–${sug.end}` : `• ${b.title}: no free slot (consider Saturday)`;
      });
      return `Missed yesterday:\n${suggestions.join('\n')}`;
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
      if (!skippable.length) return 'Nothing safe to skip today — every block matters.';
      return `Safe to skip today (no weekly damage):\n${skippable.map(b=>`• ${b.title} (${b.start}–${b.end})`).join('\n')}`;
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
      const eLabel   = energy==='high' ? 'high' : energy==='low' ? 'low' : 'medium';
      if (current) {
        const tip = energy==='low' ? 'Wrap it up and rest.' : 'Lock in and execute.';
        return `You should be on: "${current.title}" until ${current.end}. Energy ${eLabel} — ${tip}`;
      }
      const best = upcoming.find(b => suitable.includes(b.type));
      if (best) {
        const debtNote = behind.length ? ` Note: you have debt on ${behind[0][0]}.` : '';
        return `Energy ${eLabel} — best move: "${best.title}" at ${best.start}.${debtNote}`;
      }
      if (behind.length) {
        const action = energy==='high' ? 'open a deep-work session' : energy==='low' ? 'do a light task on the project' : 'push as far as you can';
        return `No scheduled block right now — but you have debt on ${behind[0][0]}. Energy ${eLabel}: ${action}.`;
      }
      const freeAct = energy==='low' ? 'Take a break.' : energy==='high' ? 'Jump ahead on your schedule.' : 'Review your open tasks.';
      return `You\'re between blocks. Energy ${eLabel}: ${freeAct}`;
    },

    // ── New v4.0 modal openers ─────────────────────────────────────────────
    todayView()    { openTodayView();         return ''; },
    weekSchedule() { openWeekScheduleView();  return ''; },
    projectHub()   { openProjectHub();        return ''; },

    updateBlockActivity(args) {
      // "עדכן בלוק university לבים"
      const today = new Date();
      const blocks = blocksForDay(today);
      const match = (args.blockMatch||'').toLowerCase();
      const block = blocks.find(b =>
        b.title.toLowerCase().includes(match) ||
        (b.proj||'').toLowerCase().includes(match) ||
        (b.dedicated||'').toLowerCase().includes(match)
      );
      if (!block) return `לא מצאתי בלוק שמתאים ל"${args.blockMatch}". נסה שם יותר ספציפי.`;
      const actual = args.actualActivity || '';
      const isRecovery = /(?:ים|בים|חוף|מנוחה|beach|rest|recovery|שינה|טיול)/i.test(actual);
      const patch = { actualActivity: actual };
      if (isRecovery) patch.status = 'replaced';
      else if (actual) patch.status = 'replaced';
      setBlockStatus(block.id, today, patch);
      logEvent('block.activityUpdate', { blockId:block.id, actual });
      const sug = suggestReschedule(block.id, today);
      const sugText = sug ? ` הצעה: ${sug.day.toLocaleDateString('he-IL',{weekday:'long'})} ${sug.start}–${sug.end}.` : '';
      return `${block.title} עודכן: "${actual}". חוב נוסף ל-${PROJECTS[block.proj]?.name||block.proj||'הפרויקט'}.${sugText}`;
    },

    // ── Modal-opening shorthands ───────────────────────────────────────────
    dailyCheckIn()  { openDailyCheckIn();  return 'Opening daily check-in...'; },
    weeklyReview()  { openWeeklyReview();  return 'Opening weekly review...'; },
    openWhatNow()   { openWhatNowPanel();  return ''; },
    closeJarvis()   {
      stopListening();
      const panel = document.getElementById('jv-panel');
      const dock  = document.getElementById('jv-dock');
      if (panel) panel.classList.remove('show');
      if (dock)  dock.classList.remove('show');
      hud.setState('idle');
      return ''; // silent close
    },
    speakOnly(args) { return args.text || ''; },
  };

  // ────────────────────────────────────────────────────────────────────────
  //  5-A. SYSTEM WRITE HELPERS — direct state mutations by JARVIS
  // ────────────────────────────────────────────────────────────────────────
  function writeScheduleBlock(day, start, end, title, type, proj) {
    const sched = loadSchedule();
    const id = 'jv_custom_' + Date.now();
    const block = {
      id, day: typeof day === 'number' ? day : new Date().getDay(),
      start: start || '09:00', end: end || '10:00',
      title: title || 'Custom Block', type: type || 'medium',
      proj: proj || null, dedicated: title || 'Custom',
      action: title || 'Custom', replaceable: true, fixed: false
    };
    sched.blocks.push(block);
    writeLocal(SCHED_KEY, sched);
    logEvent('schedule.add', block, 'ok');
    return block;
  }

  function requestNotifPermission() {
    if (!('Notification' in window)) {
      hud.toast('Push notifications not supported in this browser.', 'error');
      return;
    }
    if (Notification.permission === 'granted') {
      hud.toast('Notifications already enabled ✓', 'ok');
      speak('Push notifications are already active.');
      return;
    }
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        hud.toast('🔔 Notifications enabled!', 'ok');
        speak('Great. I\'ll now send you push notifications for reminders and briefings.');
        new Notification('זורו מחובר 🔔', {
          body: 'You\'ll get reminders and briefing alerts from here.',
          icon: '/favicon.ico'
        });
      } else {
        hud.toast('Notifications blocked. Enable in your browser settings.', 'error');
        speak('Notifications are blocked. You can enable them in your browser settings.');
      }
    }).catch(() => hud.toast('Could not request notifications.', 'error'));
  }

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
      speak(`Reminder: ${text}.`);
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

    // — Navigation (Hebrew + English) —
    let m = t.match(/(?:פתח|תפתח|לך ל|נווט ל|תעבור ל|תראה לי|open|go to|navigate to|show me)\s+(.+)/i);
    if (m) return { action:'navigate', args:{ where: m[1] } };

    // — Add task (Hebrew) —
    m = t.match(/(?:הוסף|תוסיף)\s+משימה\s+(.+?)(?:\s+לפרויקט\s+(\S+))?$/);
    if (m) return { action:'addTask', args:{ text: m[1], proj: PAGE_ALIASES[m[2]] || m[2] || null } };
    m = t.match(/^(?:הוסף|תוסיף)\s+(.+?)\s+(?:ל|אל)\s*(?:משימות|טודו)$/);
    if (m) return { action:'addTask', args:{ text: m[1] } };
    // — Add task (English) —
    m = t.match(/^(?:add task|create task|new task)\s+(.+?)(?:\s+(?:to|for)\s+(\w+))?$/i);
    if (m) return { action:'addTask', args:{ text: m[1], proj: m[2] || null } };

    // — Complete task (Hebrew + English) —
    m = t.match(/(?:סמן|תסמן|סיימתי|גמרתי|הושלם)(?:\s+את)?\s+(.+?)(?:\s+כהושלם|\s+כסיימתי)?$/);
    if (m) return { action:'completeTask', args:{ match: m[1] } };
    m = t.match(/^(?:done|complete|finish|mark done|mark as done)\s+(.+)/i);
    if (m) return { action:'completeTask', args:{ match: m[1] } };

    // — Add reminder (Hebrew) —
    m = t.match(/(?:תזכר|תזכור|תזכיר|הזכר)\s+(?:לי\s+)?(?:על\s+)?(.+?)\s+(?:בעוד\s+(.+)|ב-?(\d{1,2}:\d{2})|מחר\s+(\d{1,2}:\d{2}))/);
    if (m) {
      const when = m[2] || m[3] || (m[4] ? 'מחר ' + m[4] : null);
      return { action:'addReminder', args:{ text: m[1], when } };
    }
    m = t.match(/(?:תזכר|תזכיר)\s+(?:לי\s+)?(.+)/);
    if (m) return { action:'addReminder', args:{ text: m[1], when: 'בעוד שעה' } };
    // — Add reminder (English) —
    m = t.match(/^remind me (?:to |about )?(.+?) (?:at|in)\s+(.+)/i);
    if (m) return { action:'addReminder', args:{ text: m[1], when: m[2] } };
    m = t.match(/^remind me (?:to |about )?(.+)/i);
    if (m) return { action:'addReminder', args:{ text: m[1], when: 'in 1 hour' } };

    // — Schedule a block: "תכניסי X מ-Y עד Z" / "schedule X from Y to Z" —
    m = t.match(/(?:תכנסי|תכניסי|תוסיפי|הכנסי|תזמני)\s+(.+?)\s+(?:מ-?|מ–?)(\d{1,2}:\d{2}|\d{1,2})\s+(?:עד|–|-)\s*(\d{1,2}:\d{2}|\d{1,2})/);
    if (m) {
      const title = m[1].trim();
      const start = m[2].includes(':') ? m[2] : m[2]+':00';
      const end   = m[3].includes(':') ? m[3] : m[3]+':00';
      return { action:'addScheduleBlock', args:{ title, start, end, day: new Date().getDay() } };
    }
    m = t.match(/^(?:schedule|add (?:to )?schedule|block off|block out)\s+(.+?)\s+from\s+(\d{1,2}(?::\d{2})?(?:am|pm)?)\s+to\s+(\d{1,2}(?::\d{2})?(?:am|pm)?)/i);
    if (m) {
      const toH = (hStr) => { const p=hStr.match(/(\d+)(?::(\d+))?(am|pm)?/i); if(!p) return hStr+':00'; let h=parseInt(p[1]); if(/pm/i.test(p[3]||'')&&h<12) h+=12; if(/am/i.test(p[3]||'')&&h===12) h=0; return String(h).padStart(2,'0')+':'+(p[2]||'00'); };
      return { action:'addScheduleBlock', args:{ title: m[1].trim(), start: toH(m[2]), end: toH(m[3]), day: new Date().getDay() } };
    }

    // — Queries (Hebrew + English) —
    if (/מה (אני )?(חייב|צריך|עליי)\s+(היום|לעשות היום)/.test(t) || /מה (יש לי )?היום/.test(t)
        || /^(?:what(?:'s| is) (?:on )?(?:my )?(?:today|today's|schedule today)|what do i have today)/i.test(lower))
      return { action:'queryDue', args:{ scope:'today' } };
    if (/מה (אני )?חייב\s+השבוע/.test(t) || /מה (יש לי )?השבוע/.test(t)
        || /^(?:what(?:'s| is) (?:on )?(?:my )?(?:week|this week|weekly))/i.test(lower))
      return { action:'queryDue', args:{ scope:'week' } };

    // — Briefings (Hebrew + English) —
    if (/(תיאור|תקציר|סיכום) (?:של )?(?:ה)?(?:בוקר|יום)/.test(t) || /בוקר טוב/.test(t)
        || /^(?:morning brief|good morning|morning update|start my day)/i.test(lower))
      return { action:'morningBrief', args:{} };
    if (/(סיכום|תקציר)\s+(ה?ערב|ה?יום)/.test(t) || /לילה טוב/.test(t)
        || /^(?:evening brief|good night|end of day|daily summary)/i.test(lower))
      return { action:'eveningBrief', args:{} };

    // — Schedule / Debt (Hebrew + English) —
    if (/(חוב|דיווח)\s+(פרויקטים?|זמן)/.test(t)
        || /^(?:project debt|show debt|time debt)/i.test(lower))
      return { action:'showDebt', args:{} };
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

    // — Today Command Center —
    if (/(?:today|today[\s-]?view|command[\s-]?center|מרכז\s+פיקוד|היום\s+שלי|תצוגת\s+היום)/.test(lower))
      return { action:'todayView', args:{} };

    // — Week Schedule View —
    if (/(?:לוז\s+שבועי|weekly\s+schedule|show.*week|הצג.*שבוע|תצוגת\s+שבוע)/.test(lower))
      return { action:'weekSchedule', args:{} };

    // — Project Hub —
    if (/(?:project\s+hub|פרויקטים\s+כל|כל\s+הפרויקטים|hub|מרכז\s+פרויקטים)/.test(lower))
      return { action:'projectHub', args:{} };

    // — Update block with actual activity —
    m = t.match(/(?:עדכן|תעדכן)\s+(?:בלוק|הבלוק)\s+(.+?)\s+(?:ל|כ-?|ב-?)(.+)/i);
    if (m) return { action:'updateBlockActivity', args:{ blockMatch: m[1].trim(), actualActivity: m[2].trim() } };

    // — Mark block completed with time: "גמרתי Upselles 90 דקות" —
    m = t.match(/(?:גמרתי|סיימתי|עשיתי)\s+(.+?)\s+(\d+)\s*(?:דק[׳'ות]?|דקות|min)/);
    if (m) {
      const rawProj = m[1].toLowerCase().trim();
      const projKey = Object.keys(PROJECTS).find(k =>
        rawProj.includes(k) || PROJECTS[k].name.toLowerCase().includes(rawProj)
      ) || rawProj;
      return { action:'logActualTime', args:{ proj:projKey, actualMinutes:parseInt(m[2]), plannedMinutes:0 } };
    }

    // — "צ׳ק-אין" / "Daily Check-in"
    if (/(?:צ[׳']?ק[- ]?אין|check[\s-]?in|התחל(?:ת)?\s+יום|תכנון\s+יום\s+עכשיו)/.test(lower))
      return { action:'dailyCheckIn', args:{} };

    // "סיכום שבועי" / "Weekly Review"
    if (/(?:סיכום\s+שבועי|weekly\s+review|סיכום\s+שבוע(?:\s+הזה)?)/.test(lower))
      return { action:'weeklyReview', args:{} };

    // — Close JARVIS —
    if (/^(?:סגור|תסגר|bye|goodbye|close|that'?s? all|thanks? jarvis|תודה|עזוב|תפסיק)/.test(lower))
      return { action:'closeJarvis', args:{} };

    // fallback: ask the LLM (if available)
    return { action:'llmFallback', args:{ text: t } };
  }

  // ════════════════════════════════════════════════════════════════════
  //  ZORO AI ENGINE — real tool-use agent (rebuilt v5.2)
  //  Talks to /api/claude, runs a client-side tool loop, executes via POS.
  // ════════════════════════════════════════════════════════════════════
  let zoroMem = [];
  const ZORO_MEM_KEY = 'pos3_zoro_memory';

  function loadZoroMem() {
    try { zoroMem = JSON.parse(localStorage.getItem(ZORO_MEM_KEY) || '[]') || []; }
    catch (e) { zoroMem = []; }
  }
  function saveZoroMem() {
    try { localStorage.setItem(ZORO_MEM_KEY, JSON.stringify(zoroMem.slice(-20))); } catch (e) {}
  }
  function clearZoroMem() { zoroMem = []; saveZoroMem(); }

  const ZORO_TOOLS = [
    { name:'add_task', description:'הוסף משימה חדשה לרשימת המשימות',
      input_schema:{ type:'object', properties:{
        text:{type:'string',description:'תוכן המשימה בעברית'},
        proj:{type:'string',description:'מזהה פרויקט: jobs/upselles/health/apartment/family/university/anthropic/none'},
        cat:{type:'string',description:'work/health/family/project/home'} },
        required:['text'] } },
    { name:'complete_task', description:'סמן משימה פתוחה כבוצעה לפי חיפוש בטקסט שלה',
      input_schema:{ type:'object', properties:{ query:{type:'string',description:'מילים מתוך המשימה'} }, required:['query'] } },
    { name:'add_reminder', description:'הוסף תזכורת עם תאריך ושעה',
      input_schema:{ type:'object', properties:{
        text:{type:'string'}, date:{type:'string',description:'YYYY-MM-DD'}, time:{type:'string',description:'HH:MM'} },
        required:['text'] } },
    { name:'add_event', description:'הוסף אירוע ליומן בתאריך מסוים',
      input_schema:{ type:'object', properties:{
        title:{type:'string'}, date:{type:'string',description:'YYYY-MM-DD'}, time:{type:'string',description:'HH:MM'} },
        required:['title','date'] } },
    { name:'add_habit', description:'הוסף הרגל חדש למעקב',
      input_schema:{ type:'object', properties:{ name:{type:'string'} }, required:['name'] } },
    { name:'log_habit', description:'תעד הרגל כבוצע היום',
      input_schema:{ type:'object', properties:{ name:{type:'string'} }, required:['name'] } },
    { name:'add_note', description:'שמור פתק או מידע חשוב',
      input_schema:{ type:'object', properties:{ title:{type:'string'}, content:{type:'string'} }, required:['content'] } },
    { name:'add_goal', description:'הוסף מטרה',
      input_schema:{ type:'object', properties:{ text:{type:'string'}, emoji:{type:'string'} }, required:['text'] } },
    { name:'add_idea', description:'שמור רעיון',
      input_schema:{ type:'object', properties:{ text:{type:'string'}, cat:{type:'string'} }, required:['text'] } },
    { name:'add_journal', description:'הוסף רשומה ליומן האישי',
      input_schema:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } },
    { name:'add_job', description:'הוסף משרה למעקב חיפוש העבודה',
      input_schema:{ type:'object', properties:{
        title:{type:'string'}, company:{type:'string'},
        status:{type:'string',description:'waiting/interview/offer/rejected'}, link:{type:'string'} },
        required:['title'] } },
    { name:'update_project', description:'עדכן אחוז התקדמות של פרויקט',
      input_schema:{ type:'object', properties:{ id:{type:'string'}, progress:{type:'number'} }, required:['id','progress'] } },
    { name:'update_schedule_block', description:'עדכן סטטוס של בלוק בלוז היום',
      input_schema:{ type:'object', properties:{
        block_id:{type:'string'}, status:{type:'string',description:'completed/partial/missed/skipped'},
        actual_minutes:{type:'number'}, actual_activity:{type:'string'} },
        required:['block_id','status'] } },
    { name:'navigate', description:'נווט לעמוד באפליקציה',
      input_schema:{ type:'object', properties:{ page:{type:'string',
        description:'dashboard/agenda/tasks/reminders/jobs/upselles/health/apartment/family/ideas/journal/goals/finance/notes/news/ds-ai'} },
        required:['page'] } },
    { name:'get_data', description:'קבל תמונת מצב עדכנית של כל הנתונים — משימות, אירועים, פרויקטים, לוז',
      input_schema:{ type:'object', properties:{} } },
  ];

  function zoroContext() {
    const base = (window.POS && window.POS.snapshot) ? window.POS.snapshot() : {};
    let jc = {};
    try { jc = quickContext(); } catch (e) {}
    const todayBlocks = (jc.todayBlocks || []).map(b => ({
      start:b.start, end:b.end, title:b.title, status:b.status
    }));
    return { ...base, todaySchedule: todayBlocks, projectDebt: jc.projectDebt || [] };
  }

  function zoroSystemPrompt(ctx) {
    return `אתה זורו — העוזר האישי ומאמן הביצועים של רואי, בהשראת JARVIS של איירון מן.
אופי: רגוע, חכם, חם וישיר. מכיר את רואי, דוחף אותו קדימה בעדינות, וחוגג איתו הצלחות.

סגנון דיבור — קריטי:
- אתה מ-ד-ב-ר, לא כותב. נסח כמו בשיחה קולית אמיתית וזורמת, כמו חבר חכם.
- בלי אימוג'ים, בלי כוכביות, בלי מרקדאון, בלי רשימות עם מקפים. רק משפטים טבעיים.
- קצר: משפט עד שניים. לא הרצאות.
- פנה לרואי בשמו מדי פעם, בחום.

תאריך היום: ${ctx.date || ''}.

מצב נוכחי:
- משימות פתוחות: ${(ctx.openTasks||[]).map(t=>t.text).join(', ') || 'אין'}
- אירועים קרובים: ${(ctx.upcomingEvents||[]).map(e=>e.date+' '+e.text).join(', ') || 'אין'}
- לוז היום: ${(ctx.todaySchedule||[]).map(b=>b.start+' '+b.title).join(', ') || 'לא נטען'}
- פרויקטים: ${(ctx.projects||[]).map(p=>p.name+' '+p.progress+'%').join(', ') || 'אין'}
- חוב שבועי: ${(ctx.projectDebt||[]).join(', ') || 'אין'}

עקרונות:
1. כשרואי מבקש לבצע משהו — בצע מיד עם הכלי המתאים, בלי לשאול אישור, ואז דווח במשפט טבעי קצר.
2. אם רק שאלו אותך — ענה ישירות, בלי כלים.
3. כמאמן ביצועים: כשרלוונטי, הוסף דחיפה קטנה או תובנה — אבל בקצרה ובטון תומך.
4. אל תמציא נתונים. חסר לך מידע עדכני? השתמש ב-get_data.
5. ענה תמיד בעברית טבעית ומדוברת. מותר להפעיל כמה כלים ברצף לבקשה מורכבת.`;
  }

  function executeZoroTool(name, input) {
    const P = window.POS;
    input = input || {};
    if (!P && name !== 'update_schedule_block') return 'המערכת עוד נטענת, נסה שוב';
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
        case 'update_project': return P.updateProject(input);
        case 'navigate':       return P.navigate(input.page);
        case 'get_data':       return JSON.stringify(zoroContext());
        case 'update_schedule_block':
          try {
            setBlockStatus(input.block_id, new Date(), {
              status: input.status,
              actualMinutes: input.actual_minutes,
              actualActivity: input.actual_activity
            });
            return 'בלוק הלוז עודכן: ' + input.status;
          } catch (e) { return 'לא הצלחתי לעדכן את הבלוק'; }
        default: return 'כלי לא מוכר: ' + name;
      }
    } catch (e) { return 'שגיאה בכלי ' + name + ': ' + e.message; }
  }

  async function zoroAPICall(system, messages) {
    try {
      const res = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system,
          tools: ZORO_TOOLS,
          messages
        })
      });
      if (!res.ok) return { _error: 'api ' + res.status };
      const data = await res.json();
      if (data && data.error) return { _error: data.error.message || 'api error' };
      return data;
    } catch (e) { return { _error: e.message }; }
  }

  // Main entry — a real tool-use agent. Replaces the old broken llmFallback.
  async function llmFallback(prompt) {
    prompt = (prompt || '').trim();
    if (!prompt) return '';

    const ctx = zoroContext();
    const system = zoroSystemPrompt(ctx);

    zoroMem.push({ role:'user', content: prompt });
    let messages = zoroMem.slice(-16).map(m => ({ role:m.role, content:m.content }));
    while (messages.length && messages[0].role !== 'user') messages.shift();

    let loops = 0;
    while (loops++ < 6) {
      const data = await zoroAPICall(system, messages);
      if (data._error) {
        zoroMem.pop(); // drop the failed turn so memory stays valid
        return 'לא הצלחתי להתחבר כרגע (' + data._error + '). נסה שוב בעוד רגע.';
      }
      const blocks = Array.isArray(data.content) ? data.content : [];
      const toolUses = blocks.filter(b => b.type === 'tool_use');
      const textOut = blocks.filter(b => b.type === 'text').map(b => b.text).join('').trim();

      if (toolUses.length === 0) {
        zoroMem.push({ role:'assistant', content: textOut });
        saveZoroMem();
        return textOut || 'בוצע.';
      }

      // execute the requested tools and feed the results back
      messages.push({ role:'assistant', content: blocks });
      const results = [];
      for (const tu of toolUses) {
        const out = executeZoroTool(tu.name, tu.input);
        results.push({ type:'tool_result', tool_use_id: tu.id, content: String(out) });
      }
      messages.push({ role:'user', content: results });
    }

    saveZoroMem();
    return 'הבקשה מורכבת מדי — נסה לפצל אותה לכמה צעדים.';
  }

  function quickContext() {
    const s = readState();
    const today = new Date();
    const wk = isoWeekKey(today);
    const sched = loadSchedule();
    const wkData = sched.weeks[wk] || {};
    const blocks = blocksForDay(today);
    const debt = projectDebt();
    const behind = Object.entries(debt).filter(([,o]) => o.debt > 30)
      .map(([p,o]) => `${p}: ${Math.round(o.debt/60*10)/10}h behind`);
    return {
      tasksOpen: (s.tasks||[]).filter(t=>!t.done).length,
      projects: (s.projects||[]).map(p=>p.id||p.name),
      today: dateKey(today),
      todayBlocks: blocks.map(b => {
        const k = b.id+'::'+dateKey(today);
        const st = (wkData[k]||{}).status||'planned';
        return { start:b.start, end:b.end, title:b.title, proj:b.proj, type:b.type, status:st, fixed:b.fixed, replaceable:b.replaceable };
      }),
      projectDebt: behind,
    };
  }

  // Every command — voice, chat, or chip — goes through the Zoro agent.
  // The agent decides what to do and executes tools itself.
  async function handle(text) {
    text = (text || '').trim();
    if (!text) return '';
    const out = await llmFallback(text);
    try { logEvent('zoro', { text }, out); } catch (e) {}
    return out;
  }

  // ────────────────────────────────────────────────────────────────────────
  //  7. VOICE — recognition + synthesis
  // ────────────────────────────────────────────────────────────────────────
  let recog = null, recogActive = false, listeningHard = false;
  let zoroSpeaking = false; // true while TTS is talking — mutes the mic

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

  let _recogStarted = false; // track if user has ever started recognition
  function startListening(hard=false) {
    if (!settings().voiceOn) return;
    if (!recog) recog = makeRecognizer();
    if (!recog) { speak('Speech recognition is not available in this browser.'); return; }
    listeningHard = hard;
    _recogStarted = true;
    if (recogActive) return;
    try { recog.start(); } catch (e) {}
  }
  function stopListening() {
    listeningHard = false;
    _recogStarted = false;
    if (recog) try { recog.stop(); } catch (e) {}
  }
  function bindRecog() {
    if (!recog) return;
    recog.onstart = () => { recogActive = true; hud.setState('listening'); };
    recog.onend   = () => {
      recogActive = false;
      hud.setState('idle');
      // Only auto-restart if user explicitly started recognition AND wake-word mode is on
      if (_recogStarted && settings().wakeWordOn && !listeningHard) {
        setTimeout(() => { if (_recogStarted) startListening(false); }, 1000);
      }
    };
    recog.onerror = (e) => {
      hud.setState('idle');
      if (e.error === 'not-allowed') {
        _recogStarted = false;
        hud.toast('Microphone access denied. Enable it in browser settings.', 'error');
      } else if (e.error === 'no-speech' || e.error === 'audio-capture') {
        // silent — just stop
      }
    };
    recog.onresult = async (ev) => {
      if (zoroSpeaking) return; // ignore mic input while Zoro is talking
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
          if (!cmd) { speak('Yes, Roei? I\'m listening.'); listeningHard = true; return; }
          await processSpoken(cmd);
        } else {
          await processSpoken(text);
        }
      }
    };
  }
  async function processSpoken(text) {
    hud.appendChat('user', text);
    hud.setHeard(text);
    hud.setState('thinking');
    const typing = hud.showTyping();
    try {
      const reply = await handle(text);
      if (typing) typing.remove();
      if (reply) { hud.appendChat('bot', reply); speak(reply); }
    } catch (e) {
      if (typing) typing.remove();
      hud.toast('שגיאה: ' + e.message, 'error');
    } finally {
      hud.setState('idle');
      hud.setHeard('');
      listeningHard = false;
    }
  }

  let voicesCache = null;
  function pickVoice() {
    const v = window.speechSynthesis?.getVoices() || [];
    voicesCache = v;
    // Roei speaks Hebrew — prefer a natural Hebrew voice
    const prefer = [
      v.find(x => x.lang==='he-IL' && /natural|neural|google|carmit/i.test(x.name)),
      v.find(x => x.lang==='he-IL' && !x.localService),   // cloud/premium Hebrew
      v.find(x => x.lang==='he-IL'),
      v.find(x => x.lang && x.lang.startsWith('he')),
      v.find(x => x.lang==='en-US' && !x.localService),
      v.find(x => x.lang && x.lang.startsWith('en')),
      v[0],
    ];
    return prefer.find(Boolean) || null;
  }
  // Strip emoji + markdown so TTS reads natural speech, not symbol names
  function cleanForSpeech(text) {
    return (text || '')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~#>|]+/g, '')
      .replace(/^\s*[-•]\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function speak(text) {
    if (!settings().voiceOn) return;
    if (!window.speechSynthesis) return;
    const spoken = cleanForSpeech(text);
    if (!spoken) return;
    window.speechSynthesis.cancel(); // stop any ongoing speech
    // wait for voices to load if needed
    const doSpeak = () => {
      const u = new SpeechSynthesisUtterance(spoken);
      const v = pickVoice();
      if (v) u.voice = v;
      u.lang = v?.lang || 'he-IL';
      u.rate   = Math.min(1.1, Math.max(0.85, settings().rate || 0.95));
      u.volume = settings().volume ?? 1.0;
      u.pitch  = 1.0;
      hud.setState('speaking');
      zoroSpeaking = true; // mute the mic so Zoro never hears itself
      const finish = () => {
        hud.setState('idle');
        // release the guard a beat after the audio tail clears
        setTimeout(() => { zoroSpeaking = false; }, 350);
      };
      u.onend   = finish;
      u.onerror = finish;
      try { window.speechSynthesis.speak(u); } catch (e) { zoroSpeaking = false; hud.setState('idle'); }
    };
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; doSpeak(); };
    } else {
      doSpeak();
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  //  6-B. MULTI-ACCOUNT SYSTEM
  // ────────────────────────────────────────────────────────────────────────
  const ACCOUNTS_KEY   = 'jv_accounts';
  const SESSION_USER   = 'jv_session_user';

  function hashPass(pass) {
    // Simple deterministic hash for local use (not cryptographic)
    let h = 5381;
    for (let i = 0; i < pass.length; i++) h = ((h << 5) + h) ^ pass.charCodeAt(i);
    return (h >>> 0).toString(36);
  }

  function getAccounts() { return readLocal(ACCOUNTS_KEY, {}); }
  function getCurrentUser() { return sessionStorage.getItem(SESSION_USER) || null; }
  function getCurrentUserDisplay() {
    const u = getCurrentUser();
    if (!u) return 'רואי';
    const acc = getAccounts()[u];
    const name = acc?.displayName || u;
    // Never show the email address as a name — fall back to רואי.
    if (!name || name.includes('@')) return 'רואי';
    return name;
  }

  function installAccountProxy(username) {
    if (Storage.prototype._jvProxied) return; // idempotent
    const USER_KEY = 'pos3_u_' + username;
    // Data migration: copy generic pos3 data to per-user key on first login
    try {
      const migKey = 'jv_migrated_' + username;
      if (!localStorage.getItem(migKey)) {
        const existing = localStorage.getItem('pos3');
        if (existing && !localStorage.getItem(USER_KEY)) {
          localStorage.setItem(USER_KEY, existing);
        }
        localStorage.setItem(migKey, '1');
      }
    } catch (e) { /* silent */ }
    const _get = Storage.prototype.getItem;
    const _set = Storage.prototype.setItem;
    const _rem = Storage.prototype.removeItem;
    Storage.prototype._jvProxied = true;
    Storage.prototype.getItem    = function(k) { return _get.call(this, k === 'pos3' ? USER_KEY : k); };
    Storage.prototype.setItem    = function(k,v){ return _set.call(this, k === 'pos3' ? USER_KEY : k, v); };
    Storage.prototype.removeItem = function(k) { return _rem.call(this, k === 'pos3' ? USER_KEY : k); };
  }

  function loginUser(username, password) {
    const accounts = getAccounts();
    const key = username.toLowerCase().trim();
    const acc = accounts[key];
    if (!acc) return { ok:false, error:'Account not found. Check username or create one.' };
    if (acc.passwordHash !== hashPass(password)) return { ok:false, error:'Wrong password.' };
    sessionStorage.setItem(SESSION_USER, key);
    installAccountProxy(key);
    return { ok:true, displayName: acc.displayName };
  }

  function registerUser(username, password) {
    const accounts = getAccounts();
    const key = username.toLowerCase().trim();
    if (key.length < 2) return { ok:false, error:'Username must be at least 2 characters.' };
    if (password.length < 4) return { ok:false, error:'Password must be at least 4 characters.' };
    if (accounts[key]) return { ok:false, error:'Username already taken.' };
    accounts[key] = { displayName: username.trim(), passwordHash: hashPass(password), createdAt: Date.now() };
    writeLocal(ACCOUNTS_KEY, accounts);
    sessionStorage.setItem(SESSION_USER, key);
    installAccountProxy(key);
    return { ok:true, displayName: username.trim() };
  }

  function logoutUser() {
    sessionStorage.removeItem(SESSION_USER);
    sessionStorage.removeItem('jv_locked_this_session');
    location.reload();
  }

  // ────────────────────────────────────────────────────────────────────────
  // 6-C. GOOGLE AUTH
  // ────────────────────────────────────────────────────────────────────────
  var GOOGLE_CLIENT_ID = '786576755989-7cr0hvf95q0f5oc5rq40ocpsv3lolkii.apps.googleusercontent.com';

  function initGoogleAuth(onSuccess) {
    if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.indexOf('REPLACE') === 0) return;
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = function() {
      if (!window.google || !google.accounts) return;
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: function(r) { handleGoogleCredential(r, onSuccess); }
      });
      var el = document.getElementById('jv-google-btn');
      if (el) google.accounts.id.renderButton(el, {
        theme:'filled_black', size:'large', text:'signin_with', shape:'pill', width:280
      });
    };
    document.head.appendChild(s);
  }

  function handleGoogleCredential(r, onSuccess) {
    try {
      var b = r.credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      while (b.length % 4) b += '=';
      var p = JSON.parse(atob(b));
      var k = p.email.toLowerCase().trim();
      var a = getAccounts();
      if (!a[k]) { a[k] = { displayName: p.name||k, passwordHash:'google:'+p.sub, createdAt:Date.now() }; writeLocal(ACCOUNTS_KEY, a); }
      sessionStorage.setItem(SESSION_USER, k);
      sessionStorage.setItem('jv_google_user', '1');
      installAccountProxy(k);
      var el = document.getElementById('jv-login-screen'); if (el) el.remove();
      if (onSuccess) onSuccess(a[k].displayName||k);
    } catch(e) { console.warn('JARVIS Google auth:', e); }
  }

  function openLoginScreen(onSuccess) {
    if (document.getElementById('jv-login-screen')) return;
    const accounts  = getAccounts();
    const hasUsers  = Object.keys(accounts).length > 0;

    const wrap = document.createElement('div');
    wrap.id = 'jv-login-screen';
    wrap.style.cssText = `position:fixed;inset:0;background:#000;z-index:9999999;display:flex;
      align-items:center;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;`;

    const render = (mode) => {
      wrap.innerHTML = `
        <div style="width:380px;max-width:92vw;padding:40px 32px;
          background:#0a0a0a;border:1px solid rgba(255,255,255,.1);border-radius:20px;
          box-shadow:0 40px 80px rgba(0,0,0,.9)">
          <div style="text-align:center;margin-bottom:32px">
            <div style="font-size:42px;font-weight:100;color:#00d4ff;letter-spacing:4px;margin-bottom:8px">זורו</div>
            <div style="font-size:13px;color:rgba(255,255,255,.4)">Personal OS &nbsp;·&nbsp; ${mode==='login' ? 'Sign in' : 'Create account'}</div>
          </div>
          <div style="margin-bottom:14px">
            <div style="font-size:11px;color:rgba(255,255,255,.45);margin-bottom:6px;letter-spacing:.5px;text-transform:uppercase">Username</div>
            <input id="jv-lu" type="text" placeholder="e.g. roei" autocomplete="username"
              style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.07);
              border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:13px 14px;
              color:#fff;font-size:15px;outline:none;transition:.2s"
              onfocus="this.style.borderColor='#00d4ff'" onblur="this.style.borderColor='rgba(255,255,255,.14)'">
          </div>
          <div style="margin-bottom:20px">
            <div style="font-size:11px;color:rgba(255,255,255,.45);margin-bottom:6px;letter-spacing:.5px;text-transform:uppercase">Password</div>
            <input id="jv-lp" type="password" placeholder="••••••••" autocomplete="${mode==='login'?'current':'new'}-password"
              style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.07);
              border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:13px 14px;
              color:#fff;font-size:15px;outline:none;transition:.2s"
              onfocus="this.style.borderColor='#00d4ff'" onblur="this.style.borderColor='rgba(255,255,255,.14)'">
          </div>
          <div id="jv-lerr" style="color:#ff375f;font-size:12px;text-align:center;min-height:18px;margin-bottom:12px"></div>
          <button id="jv-lbtn" style="width:100%;background:#00d4ff;color:#000;border:none;
            border-radius:12px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;
            letter-spacing:.3px;transition:.15s"
            onmouseenter="this.style.background='#33ddff'" onmouseleave="this.style.background='#00d4ff'">
            ${mode==='login' ? 'Sign In →' : 'Create Account →'}
          </button>
          <div style="display:flex;align-items:center;gap:10px;margin:16px 0">
            <div style="flex:1;height:1px;background:rgba(255,255,255,.12)"></div>
            <span style="font-size:11px;color:rgba(255,255,255,.3)">or</span>
            <div style="flex:1;height:1px;background:rgba(255,255,255,.12)"></div>
          </div>
          <div id="jv-google-btn" style="display:flex;justify-content:center;margin-bottom:4px"></div>
          <div style="text-align:center;margin-top:14px">
            <button id="jv-lswitch" style="background:none;border:none;color:rgba(255,255,255,.35);
              font-size:12px;cursor:pointer;transition:.15s"
              onmouseenter="this.style.color='#fff'" onmouseleave="this.style.color='rgba(255,255,255,.35)'">
              ${mode==='login' ? "New user? Create account" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>`;

      const submit = () => {
        const u = wrap.querySelector('#jv-lu').value.trim();
        const p = wrap.querySelector('#jv-lp').value;
        const result = mode==='login' ? loginUser(u,p) : registerUser(u,p);
        if (!result.ok) { wrap.querySelector('#jv-lerr').textContent = result.error; return; }
        wrap.style.opacity = '0'; wrap.style.transition = 'opacity .3s';
        setTimeout(() => { wrap.remove(); if (onSuccess) onSuccess(result.displayName); }, 300);
      };

      wrap.querySelector('#jv-lbtn').onclick = submit;
      wrap.querySelector('#jv-lp').onkeydown  = e => { if (e.key==='Enter') submit(); };
      wrap.querySelector('#jv-lu').onkeydown  = e => { if (e.key==='Enter') wrap.querySelector('#jv-lp').focus(); };
      wrap.querySelector('#jv-lswitch').onclick = () => render(mode==='login' ? 'register' : 'login');
      setTimeout(() => wrap.querySelector('#jv-lu').focus(), 80);
      // Init Google Sign-In after DOM is ready
      setTimeout(() => initGoogleAuth(() => { wrap.remove(); if (onSuccess) onSuccess(''); }), 150);
    };

    render(hasUsers ? 'login' : 'register');
    document.body.appendChild(wrap);
  }

  // ────────────────────────────────────────────────────────────────────────
  //  7-A. APPLE / FUTURISTIC THEME INJECTION
  // ────────────────────────────────────────────────────────────────────────
  function injectAppleTheme() {
    if (document.getElementById('jv-apple-theme')) return;
    const s = document.createElement('style');
    s.id = 'jv-apple-theme';
    s.textContent = `
/* ═══ JARVIS APPLE THEME v2 — injected by jarvis.js ═══ */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

:root {
  --jv-bg:        #000000;
  --jv-bg2:       #0a0a0a;
  --jv-bg3:       #111111;
  --jv-surface:   rgba(28,28,30,.85);
  --jv-surface2:  rgba(44,44,46,.80);
  --jv-border:    rgba(255,255,255,.10);
  --jv-accent:    #00d4ff;
  --jv-accent2:   #0071e3;
  --jv-text:      #f5f5f7;
  --jv-text2:     rgba(245,245,247,.60);
  --jv-text3:     rgba(245,245,247,.35);
  --jv-red:       #ff375f;
  --jv-green:     #34c759;
  --jv-yellow:    #ffd60a;
  --jv-radius:    14px;
  --jv-font:      'Inter','SF Pro Display',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --jv-blur:      blur(24px) saturate(180%);
}

/* ── Reset & body ── */
html, body {
  background: var(--jv-bg) !important;
  color: var(--jv-text) !important;
  font-family: var(--jv-font) !important;
  -webkit-font-smoothing: antialiased !important;
}

/* ── GLOBAL TEXT FIX — ensure everything is readable on dark bg ── */
*, *::before, *::after {
  color: inherit;
}
body, body * {
  color: var(--jv-text);
}
/* Explicit white/light text for all common text elements */
p, span, div, li, td, th, label, h1, h2, h3, h4, h5, h6,
a, strong, em, small, b, i, u, cite, blockquote,
[class*="title"], [class*="label"], [class*="text"],
[class*="name"], [class*="desc"], [class*="value"],
[class*="count"], [class*="total"], [class*="amount"] {
  color: var(--jv-text) !important;
}
/* Dimmed secondary text */
[class*="sub"], [class*="secondary"], [class*="muted"],
[class*="hint"], [class*="caption"], [class*="meta"],
[class*="small"], small, .text-muted {
  color: var(--jv-text2) !important;
}
/* Links */
a { color: var(--jv-accent) !important; text-decoration: none; }
a:hover { color: #fff !important; }
/* Ensure inputs show text */
input, textarea, select {
  color: var(--jv-text) !important;
}
/* Force emoji and icon spans to not be hidden */
[class*="icon"], [class*="emoji"] { color: inherit !important; }

/* ── Scrollbar ── */
::-webkit-scrollbar { width:5px; height:5px; }
::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-thumb { background:rgba(255,255,255,.15); border-radius:10px; }
::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,.28); }

/* ── All card-like containers ── */
.card, .widget, .panel, .box, .block, .module, .section-card,
[class*="card"], [class*="widget"], [class*="panel"],
[class*="-box"], [class*="-block"], [class*="-module"],
[class*="container"]:not(#root):not(.jv-root),
.task-item, .habit-item, .event-item, .reminder-item, .project-item,
[class*="item"]:not(.jv-chip):not(.jv-dock button) {
  background: var(--jv-surface) !important;
  backdrop-filter: var(--jv-blur) !important;
  -webkit-backdrop-filter: var(--jv-blur) !important;
  border: 1px solid var(--jv-border) !important;
  border-radius: var(--jv-radius) !important;
  box-shadow: 0 2px 20px rgba(0,0,0,.4) !important;
  color: var(--jv-text) !important;
}

/* ── Sidebar / nav ── */
nav, sidebar, .sidebar, .nav, .side-nav, .left-panel, .right-panel,
[class*="sidebar"], [class*="nav-"]:not(.jv-chip) {
  background: rgba(10,10,10,.92) !important;
  backdrop-filter: var(--jv-blur) !important;
  border-color: var(--jv-border) !important;
}

/* ── Buttons ── */
button:not(.jv-chip):not(.jv-dock button):not(#jv-lock-enter):not(#jv-lock-checkin):not(#jv-lock-skip):not(#jv-panel-close) {
  border-radius: 10px !important;
  font-family: var(--jv-font) !important;
  transition: all .18s ease !important;
}
button:not(.jv-chip):not(.jv-dock button):not(#jv-lock-enter):not(#jv-lock-checkin):not(#jv-lock-skip):not(#jv-panel-close):hover {
  filter: brightness(1.12) !important;
  transform: translateY(-1px) !important;
}

/* ── Primary action buttons ── */
[class*="btn-primary"], [class*="primary-btn"],
[class*="add-btn"], [class*="save-btn"],
button[class*="primary"] {
  background: var(--jv-accent2) !important;
  color: #fff !important;
  border: none !important;
  box-shadow: 0 4px 16px rgba(0,113,227,.35) !important;
}

/* ── Inputs ── */
input, textarea, select {
  background: rgba(255,255,255,.06) !important;
  border: 1px solid var(--jv-border) !important;
  border-radius: 10px !important;
  color: var(--jv-text) !important;
  font-family: var(--jv-font) !important;
}
input:focus, textarea:focus, select:focus {
  outline: none !important;
  border-color: var(--jv-accent) !important;
  box-shadow: 0 0 0 3px rgba(0,212,255,.15) !important;
}
input::placeholder, textarea::placeholder {
  color: var(--jv-text3) !important;
}

/* ── Headers / titles ── */
h1,h2,h3,h4,h5,h6 { font-family: var(--jv-font) !important; font-weight:600 !important; }

/* ── KPI / stat numbers ── */
[class*="kpi"], [class*="stat"], [class*="metric"],
[class*="number"], [class*="count"] {
  font-weight: 700 !important;
  letter-spacing: -.5px !important;
  color: var(--jv-accent) !important;
}

/* ── Tags / badges ── */
[class*="tag"], [class*="badge"], [class*="chip"],
[class*="label"], [class*="pill"] {
  background: rgba(0,212,255,.12) !important;
  color: var(--jv-accent) !important;
  border: 1px solid rgba(0,212,255,.25) !important;
  border-radius: 20px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
}

/* ── Checkboxes (task done state) ── */
input[type="checkbox"] {
  accent-color: var(--jv-accent) !important;
}

/* ── Tables ── */
table { border-collapse: collapse !important; }
th { color: var(--jv-text2) !important; font-weight:500 !important; font-size:11px !important; letter-spacing:.5px !important; text-transform:uppercase !important; }
tr:hover td { background: rgba(255,255,255,.03) !important; }
td, th { border-color: var(--jv-border) !important; }

/* ── Progress bars ── */
progress, [class*="progress"] {
  background: rgba(255,255,255,.08) !important;
  border-radius: 4px !important;
  overflow: hidden !important;
}
progress::-webkit-progress-bar { background: rgba(255,255,255,.08) !important; }
progress::-webkit-progress-value { background: var(--jv-accent) !important; border-radius:4px !important; }

/* ── Glowing accent dividers ── */
hr { border-color: var(--jv-border) !important; }

/* ── Subtle background shimmer on main content area ── */
main, .main, .content, .main-content, [class*="main-"], [class*="-content"] {
  background: var(--jv-bg2) !important;
}

/* ── Page sections / rows ── */
section, .row, [class*="row-"], [class*="-row"] {
  border-color: var(--jv-border) !important;
}

/* ── Dropdown menus ── */
[class*="dropdown"], [class*="menu"], [class*="popover"] {
  background: rgba(28,28,30,.96) !important;
  backdrop-filter: var(--jv-blur) !important;
  border: 1px solid var(--jv-border) !important;
  border-radius: var(--jv-radius) !important;
  box-shadow: 0 20px 60px rgba(0,0,0,.6) !important;
}

/* ── Modal overlays ── */
[class*="modal"], [class*="dialog"], [class*="overlay"] {
  background: rgba(0,0,0,.75) !important;
  backdrop-filter: blur(8px) !important;
}
[class*="modal-content"], [class*="dialog-content"] {
  background: rgba(28,28,30,.97) !important;
  border: 1px solid var(--jv-border) !important;
  border-radius: 18px !important;
}

/* ── Selection highlight ── */
::selection {
  background: rgba(0,212,255,.25) !important;
  color: #fff !important;
}

/* ── Week grid — dark theme fix (was white-on-white) ── */
.wg-wrap { background: var(--jv-bg2) !important; border-radius: var(--jv-radius) !important; overflow: hidden !important; }
.wg-hdr { background: rgba(0,212,255,.07) !important; color: var(--jv-accent) !important; font-size:11px !important; font-weight:700 !important; letter-spacing:.4px !important; padding:6px 4px !important; text-align:center !important; border-color: rgba(0,212,255,.15) !important; }
.wg-time { background: var(--jv-bg3) !important; color: var(--jv-text3) !important; font-size:10px !important; text-align:center !important; padding:3px 2px !important; border-color: rgba(255,255,255,.05) !important; }
.wg-cell { background: var(--jv-bg2) !important; border-color: rgba(255,255,255,.05) !important; transition: background .12s !important; }
.wg-cell:hover { background: rgba(0,212,255,.04) !important; }
.wg-ev { border-radius: 6px !important; font-size: 11px !important; padding: 3px 6px !important; font-weight: 500 !important; cursor: grab !important; color: #fff !important; overflow: hidden !important; text-overflow: ellipsis !important; }
.wg-ev:active { cursor: grabbing !important; opacity: .8 !important; }
.jv-sched-ev { border-radius: 5px; padding: 2px 5px; font-size: 10px; font-weight: 600; color: #fff !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; margin: 1px 0; display: block; line-height: 1.4; }
.jv-sched-ev:hover { filter: brightness(1.15); transform: scale(1.01); }
.jv-sched-ev.dragging { opacity: .5; }
.wg-cell.drag-over { background: rgba(0,212,255,.12) !important; border: 1px dashed var(--jv-accent) !important; }

/* ═══ זורו HUD itself — update to match ═══ */
.jv-panel {
  background: rgba(10,10,12,.95) !important;
  border-color: rgba(0,212,255,.25) !important;
}
.jv-dock {
  background: rgba(10,10,12,.95) !important;
  border-color: rgba(0,212,255,.20) !important;
}
`;
    document.head.appendChild(s);
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
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:6px">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:15px;font-weight:700;color:#00d4ff;letter-spacing:1px">זורו</span>
              <div class="jv-status" id="jv-status" style="font-size:11px;opacity:.55;font-weight:400">מוכן</div>
            </div>
            <button id="jv-panel-close" title="Close" style="background:none;border:none;color:#8b9bb4;cursor:pointer;font-size:16px;padding:0 0 0 8px;line-height:1;transition:color .15s" onmouseenter="this.style.color='#fff'" onmouseleave="this.style.color='#8b9bb4'">✕</button>
          </div>
          <div id="jv-chat-log" style="flex:1;overflow-y:auto;max-height:220px;min-height:60px;display:flex;flex-direction:column;gap:6px;margin-bottom:8px;padding-right:2px">
            <div class="jv-msg jv-msg-bot" style="background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.2);border-radius:10px 10px 10px 2px;padding:7px 10px;font-size:12px;color:#e6f3ff;max-width:90%;align-self:flex-start">
              היי רועי, אני זורו — העוזר שלך. תגיד לי מה לעשות, כתוב כאן, או לחץ על ה-orb לדיבור.
            </div>
          </div>
          <div class="jv-heard" id="jv-heard" style="font-size:11px;opacity:.6;margin-bottom:4px;min-height:0"></div>
          <div id="jv-chat-input-row" style="display:flex;gap:6px;margin-bottom:6px">
            <input id="jv-chat-input" type="text" placeholder="כתוב פקודה..." dir="rtl"
              style="flex:1;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:8px;
                     padding:6px 10px;font-size:12px;color:#f5f5f7;outline:none;font-family:inherit"/>
            <button id="jv-chat-send"
              style="background:#00d4ff;border:none;border-radius:8px;padding:6px 10px;
                     cursor:pointer;font-size:14px;color:#000;font-weight:700;transition:opacity .15s"
              onmouseenter="this.style.opacity='.8'" onmouseleave="this.style.opacity='1'">↑</button>
          </div>
          <div class="jv-actions" id="jv-actions" style="display:flex;flex-wrap:wrap;gap:4px">
            <button class="jv-chip" data-cmd="מה יש לי היום">📋 היום</button>
            <button class="jv-chip" data-cmd="מה לעשות עכשיו">⚡ מה עכשיו</button>
            <button class="jv-chip" data-cmd="מה אני חייב השבוע">📅 השבוע</button>
            <button class="jv-chip" data-cmd="חוב פרויקטים">⚠️ חוב</button>
            <button class="jv-chip" data-cmd="סיכום הבוקר">🌅 בריפינג</button>
          </div>
        </div>
        <div class="jv-dock" id="jv-dock">
          <button data-act="today">🎯 Today — Command Center</button>
          <button data-act="checkin">☀️ Daily Check-In</button>
          <button data-act="whatnow">⚡ What to do now</button>
          <button data-act="schedule">📅 לוז היום</button>
          <button data-act="weekview">📆 לוז שבועי</button>
          <button data-act="projecthub">📊 Project Hub</button>
          <button data-act="brief">📋 Morning Brief</button>
          <button data-act="review">📊 Weekly Review</button>
          <button data-act="debt">⚠️ Project Debt</button>
          <button data-act="notif">🔔 Notifications</button>
          <button data-act="settings">⚙️ Settings</button>
          <button data-act="log">📜 Execution Log</button>
          <button data-act="logout" style="color:rgba(245,245,247,.4)!important;font-size:11px">⇠ Switch account</button>
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

      // Close panel button
      const closeBtn = root.querySelector('#jv-panel-close');
      if (closeBtn) closeBtn.addEventListener('click', () => panel.classList.remove('show'));

      // Close on Escape key
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          const p = document.getElementById('jv-panel');
          if (p) p.classList.remove('show');
        }
      });
      // Close on click outside panel
      document.addEventListener('click', e => {
        const p = document.getElementById('jv-panel');
        const o = document.getElementById('jv-orb');
        if (p && p.classList.contains('show') &&
            !p.contains(e.target) && !o?.contains(e.target)) {
          p.classList.remove('show');
        }
      });

      // Dock buttons
      dock.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
          dock.classList.remove('show');
          const a = b.dataset.act;
          if (a === 'today')      return openTodayView();
          if (a === 'checkin')    return openDailyCheckIn();
          if (a === 'whatnow')    return openWhatNowPanel();
          if (a === 'brief')      return processSpoken('סיכום הבוקר');
          if (a === 'schedule')   return openScheduleModal();
          if (a === 'weekview')   return openWeekScheduleView();
          if (a === 'projecthub') return openProjectHub();
          if (a === 'debt')     return processSpoken('חוב פרויקטים');
          if (a === 'review')   return openWeeklyReview();
          if (a === 'log')      return openLogModal();
          if (a === 'settings') return openSettingsModal();
          if (a === 'notif')    return requestNotifPermission();
          if (a === 'logout')   return logoutUser();
        });
      });

      window._jvEdge = edge;
      wireChatInput();
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
      const labels = { idle:'מוכן', listening:'מקשיב…', thinking:'חושב…', speaking:'מדבר…' };
      if (statusEl) statusEl.textContent = labels[s] || 'מוכן';
      if (window._jvEdge) {
        if (s === 'listening' || s === 'thinking') window._jvEdge.classList.add('active');
        else window._jvEdge.classList.remove('active');
      }
    }
    function setHeard(t) { if (heard) heard.textContent = t ? '🎙 ' + t : ''; if (panel) panel.classList.add('show'); }
    function setReply(t) { appendChat('bot', t); if (panel) panel.classList.add('show'); }

    function appendChat(who, text) {
      const log = document.getElementById('jv-chat-log');
      if (!log) return;
      const isBot = who === 'bot';
      const div = document.createElement('div');
      div.className = 'jv-msg jv-msg-' + who;
      div.style.cssText = isBot
        ? 'background:rgba(0,212,255,.1);border:1px solid rgba(0,212,255,.2);border-radius:10px 10px 10px 2px;padding:7px 10px;font-size:12px;color:#e6f3ff;max-width:90%;align-self:flex-start;word-break:break-word'
        : 'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:10px 10px 2px 10px;padding:7px 10px;font-size:12px;color:#f5f5f7;max-width:85%;align-self:flex-end;word-break:break-word;direction:rtl';
      div.textContent = text;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }

    function showTyping() {
      const log = document.getElementById('jv-chat-log');
      if (!log) return null;
      const div = document.createElement('div');
      div.id = 'jv-typing';
      div.style.cssText = 'background:rgba(0,212,255,.08);border-radius:10px 10px 10px 2px;padding:7px 12px;font-size:18px;color:#00d4ff;align-self:flex-start;letter-spacing:3px';
      div.textContent = '···';
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      return div;
    }

    // Wire up text input
    function wireChatInput() {
      const inp = document.getElementById('jv-chat-input');
      const btn = document.getElementById('jv-chat-send');
      if (!inp || !btn) return;
      const send = async () => {
        const txt = inp.value.trim();
        if (!txt) return;
        inp.value = '';
        appendChat('user', txt);
        panel.classList.add('show');
        const typing = showTyping();
        const reply = await handle(txt);
        if (typing) typing.remove();
        if (reply) { appendChat('bot', reply); speak(reply); }
      };
      btn.addEventListener('click', send);
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    }

    function toast(text, kind='ok') {
      const el = document.createElement('div');
      el.className = 'jv-toast ' + kind;
      el.textContent = text;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add('show'));
      setTimeout(() => { el.classList.remove('show'); setTimeout(()=>el.remove(), 250); }, 3500);
    }

    return { mount, setState, setHeard, setReply, toast, toggleListen, appendChat, showTyping };
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

  function openScheduleModal(targetDate) {
    const today = targetDate || new Date();
    const blocks = blocksForDay(today);
    const wk = isoWeekKey(today);
    const sched = loadSchedule();
    const wkData = sched.weeks[wk] || {};
    const dayNames = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
    const dayName = dayNames[today.getDay()];
    const typeColors = {
      fixed:'#ff9f43', deep_work:'#00d4ff', medium:'#a29bfe', light:'#55efc4',
      food:'#fdcb6e', training:'#e17055', walk:'#00cec9', recovery:'#81ecec',
      buffer:'#636e72', reminder:'#fd79a8', family:'#ff7675', university:'#74b9ff',
      meeting:'#ff6b9d', planning:'#a0c4ff'
    };
    const html = `
      <p style="opacity:.85;font-size:13px;margin:0 0 12px">יום ${dayName} · ${today.toLocaleDateString('he-IL')}</p>
      <div id="jv-blocks" style="display:flex;flex-direction:column;gap:10px"></div>
      <p style="opacity:.5;font-size:11px;margin-top:14px;text-align:center">לחץ על בלוק לעדכון מפורט</p>`;
    const m = modalShell('📅 לוז היום — עדכון מהיר', html);
    const list = m.querySelector('#jv-blocks');
    blocks.forEach(b => {
      const key = b.id + '::' + dateKey(today);
      const st  = wkData[key] || { status:'planned' };
      const col = typeColors[b.type] || ACCENT;
      const statusEmoji = {planned:'⬜',completed:'✅',partial:'🔶',missed:'❌',replaced:'🔄',skipped:'⏭',postponed:'📌'}[st.status] || '⬜';
      const row = document.createElement('div');
      row.style.cssText = `border:1px solid ${col}55;border-left:3px solid ${col};border-radius:10px;padding:10px 12px;cursor:pointer;transition:background .15s`;
      row.onmouseenter = () => { row.style.background = col+'11'; };
      row.onmouseleave = () => { row.style.background = 'transparent'; };
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div style="flex:1">
            <div style="font-weight:600;font-size:13px">${b.title}</div>
            <div style="font-size:11px;opacity:.65;margin-top:2px">${b.start}–${b.end} · ${b.dedicated||b.type}</div>
            ${st.actualMinutes ? `<div style="font-size:11px;color:${ACCENT_OK};margin-top:2px">✓ בוצע: ${st.actualMinutes} דק׳</div>` : ''}
            ${st.note ? `<div style="font-size:11px;opacity:.6;margin-top:2px;font-style:italic">${st.note.slice(0,60)}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            <span style="font-size:16px">${statusEmoji}</span>
            ${b.fixed ? '<span style="font-size:9px;color:#ff9f43;background:rgba(255,159,67,.15);padding:1px 6px;border-radius:8px">🔒 קבוע</span>'
                       : '<span style="font-size:9px;color:#a29bfe;background:rgba(162,155,254,.15);padding:1px 6px;border-radius:8px">↔ גמיש</span>'}
          </div>
        </div>`;
      row.onclick = () => openBlockUpdateModal(b, today, m);
      list.appendChild(row);
    });
    if (!blocks.length) {
      list.innerHTML = '<div style="opacity:.5;text-align:center;padding:20px">אין בלוקים להיום.</div>';
    }
  }

  function openBlockUpdateModal(block, date, parentModal) {
    if (parentModal) parentModal.remove();
    const wk = isoWeekKey(date);
    const sched = loadSchedule();
    const wkData = sched.weeks[wk] || {};
    const key = block.id + '::' + dateKey(date);
    const existing = wkData[key] || { status:'planned' };
    const plannedMins = block.plannedMinutes || (function(){
      const [sh,sm] = block.start.split(':').map(Number);
      const [eh,em] = block.end.split(':').map(Number);
      return (eh*60+em) - (sh*60+sm);
    })();
    const statusLabels = {planned:'מתוכנן',completed:'בוצע',partial:'חלקי',missed:'הוחמץ',replaced:'הוחלף',skipped:'דולג',postponed:'נדחה'};

    const html = `
      <div style="display:flex;flex-direction:column;gap:12px;font-size:13px">
        <div style="background:rgba(0,212,255,.08);border:1px solid ${ACCENT}33;border-radius:10px;padding:10px 12px">
          <div style="font-weight:700;color:${ACCENT}">${block.title}</div>
          <div style="font-size:11px;opacity:.7;margin-top:3px">${block.start}–${block.end} · ${block.dedicated||''}</div>
          <div style="font-size:11px;opacity:.6;margin-top:2px">מתוכנן: ${plannedMins} דק׳</div>
        </div>

        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="opacity:.8;font-size:11px;text-transform:uppercase;letter-spacing:.5px">סטטוס</span>
          <div style="display:flex;gap:5px;flex-wrap:wrap" id="bu-status-btns">
            ${Object.entries(statusLabels).map(([s,l]) =>
              `<button data-s="${s}" class="bu-st-btn" style="background:${existing.status===s?ACCENT+'33':'transparent'};
                color:${existing.status===s?ACCENT:'#cfe8ff'};border:1px solid ${existing.status===s?ACCENT:ACCENT+'44'};
                border-radius:8px;padding:5px 10px;font-size:11px;cursor:pointer;transition:.15s">${l}</button>`
            ).join('')}
          </div>
          <input type="hidden" id="bu-status" value="${existing.status||'planned'}"/>
        </label>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8;font-size:11px">⏱ דק׳ בפועל</span>
            <input type="number" id="bu-actual" min="0" max="480" value="${existing.actualMinutes||''}"
              placeholder="${plannedMins}"
              style="background:rgba(255,255,255,.07);border:1px solid ${ACCENT}33;border-radius:8px;
                padding:8px;color:#e6f3ff;font-size:13px"/>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8;font-size:11px">📌 פעילות בפועל</span>
            <input type="text" id="bu-actual-act" value="${existing.actualActivity||''}"
              placeholder="מה עשית בפועל?"
              style="background:rgba(255,255,255,.07);border:1px solid ${ACCENT}33;border-radius:8px;
                padding:8px;color:#e6f3ff;font-size:13px;direction:rtl"/>
          </label>
        </div>

        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="opacity:.8;font-size:11px">📝 הערה / סיבה</span>
          <textarea id="bu-note" rows="2"
            style="background:rgba(255,255,255,.07);border:1px solid ${ACCENT}33;border-radius:8px;
              padding:8px;color:#e6f3ff;font-size:13px;resize:none;direction:rtl"
            placeholder="סיבה / הערה / מה השתנה...">${existing.note||''}</textarea>
        </label>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="bu-followup" ${existing.followUp?'checked':''}
              style="width:16px;height:16px;accent-color:${ACCENT}"/>
            <span style="font-size:12px">צור משימת המשך</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="checkbox" id="bu-reschedule" ${existing.rescheduleSuggested?'checked':''}
              style="width:16px;height:16px;accent-color:${ACCENT}"/>
            <span style="font-size:12px">הצע תזמון מחדש</span>
          </label>
        </div>

        <div id="bu-reschedule-result" style="display:none;padding:10px;background:rgba(0,212,255,.06);
          border:1px solid ${ACCENT}33;border-radius:8px;font-size:12px"></div>

        <div style="display:flex;gap:8px;margin-top:4px">
          <button id="bu-save" style="flex:1;background:${ACCENT};color:#001828;border:none;border-radius:8px;
            padding:10px;font-weight:700;cursor:pointer">שמור עדכון ✓</button>
          <button id="bu-back" style="background:transparent;color:#cfe8ff;border:1px solid ${ACCENT}44;
            border-radius:8px;padding:10px 14px;cursor:pointer;font-size:12px">← חזור</button>
        </div>
      </div>`;

    const m = modalShell(`⚡ עדכון: ${block.title}`, html);

    // Status toggle buttons
    m.querySelectorAll('.bu-st-btn').forEach(btn => {
      btn.onclick = () => {
        m.querySelectorAll('.bu-st-btn').forEach(b => {
          b.style.background = 'transparent'; b.style.color = '#cfe8ff';
          b.style.borderColor = ACCENT+'44';
        });
        btn.style.background = ACCENT+'33'; btn.style.color = ACCENT; btn.style.borderColor = ACCENT;
        m.querySelector('#bu-status').value = btn.dataset.s;
        // Auto-check reschedule when missed/partial
        if (btn.dataset.s === 'missed' || btn.dataset.s === 'partial') {
          m.querySelector('#bu-reschedule').checked = true;
        }
      };
    });

    // Reschedule checkbox — show suggestion
    m.querySelector('#bu-reschedule').onchange = function() {
      const resEl = m.querySelector('#bu-reschedule-result');
      if (this.checked) {
        const sug = suggestReschedule(block.id, date);
        resEl.style.display = 'block';
        if (sug) {
          const sDay = sug.day.toLocaleDateString('he-IL', {weekday:'long',month:'short',day:'numeric'});
          resEl.innerHTML = `💡 <strong>הצעת תזמון מחדש:</strong> ${sDay} בשעה ${sug.start}–${sug.end}`;
        } else {
          resEl.textContent = 'לא נמצא חלון זמין — שקול להזיז לשבוע הבא.';
        }
      } else {
        m.querySelector('#bu-reschedule-result').style.display = 'none';
      }
    };
    if (m.querySelector('#bu-reschedule').checked) m.querySelector('#bu-reschedule').onchange.call(m.querySelector('#bu-reschedule'));

    // Back button
    m.querySelector('#bu-back').onclick = () => { m.remove(); openScheduleModal(date); };

    // Save
    m.querySelector('#bu-save').onclick = () => {
      const status    = m.querySelector('#bu-status').value;
      const actualMin = parseInt(m.querySelector('#bu-actual').value) || 0;
      const actualAct = m.querySelector('#bu-actual-act').value.trim();
      const note      = m.querySelector('#bu-note').value.trim();
      const followUp  = m.querySelector('#bu-followup').checked;
      const resched   = m.querySelector('#bu-reschedule').checked;

      const patch = { status, note };
      if (actualMin > 0) patch.actualMinutes = actualMin;
      if (actualAct)     patch.actualActivity = actualAct;
      if (followUp)      patch.followUp = true;
      if (resched)       patch.rescheduleSuggested = true;

      setBlockStatus(block.id, date, patch);
      logEvent('block.update', { blockId: block.id, ...patch });

      // Follow-up task
      if (followUp && typeof window.addTask === 'function') {
        const remaining = actualMin > 0 ? Math.max(0, plannedMins - actualMin) : plannedMins;
        try {
          window.addTask({ text: `המשך: ${block.title}${remaining ? ` (${remaining} דק׳)` : ''}`, priority:'medium', tags:[block.proj||'general'] });
        } catch(e) {}
      }

      // Speak summary
      const diffMsg = actualMin > 0 ? ` בוצע ${actualMin} מתוך ${plannedMins} דק׳.` : '';
      const statusMsg = { completed:'✅ בוצע', partial:'🔶 חלקי', missed:'❌ הוחמץ', replaced:'🔄 הוחלף', skipped:'⏭ דולג', postponed:'📌 נדחה', planned:'⬜ מתוכנן' }[status] || status;
      const msg = `${block.title}: ${statusMsg}.${diffMsg}${note ? ' הערה נשמרה.' : ''}`;
      hud.toast(msg, status==='completed'?'ok':status==='missed'?'error':'ok');
      speak(msg.replace(/[✅❌🔶🔄⏭📌⬜]/g,'').trim());

      if (status === 'completed' && actualMin >= plannedMins * 0.9) celebrate();
      m.remove();
    };
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
        <label><input type="checkbox" id="jv-wake" ${s.wakeWordOn?'checked':''}/> מילת הפעלה (זורו)</label>
        <label>מהירות דיבור: <input type="range" id="jv-rate" min="0.8" max="1.4" step="0.05" value="${s.rate}"/></label>
        <label>תקציר בוקר ב: <input type="time" id="jv-am" value="${s.morningBriefAt}"/></label>
        <label>תקציר ערב ב: <input type="time" id="jv-pm" value="${s.eveningBriefAt}"/></label>
        <label style="flex-direction:column;align-items:flex-start;gap:4px">מפתח Anthropic API (אופציונלי לסוכן AI):
          <input type="password" id="jv-apikey" placeholder="sk-ant-..." value="${s.anthropicKey||''}"
            style="width:100%;margin-top:4px"/>
        </label>
        <button id="jv-save" style="background:${ACCENT};color:#001828;border:none;border-radius:8px;
          padding:8px 14px;font-weight:600;cursor:pointer;margin-top:8px">שמור</button>
        <button id="jv-test" style="background:transparent;color:#cfe8ff;border:1px solid ${ACCENT}55;
          border-radius:8px;padding:8px 14px;cursor:pointer">בדיקת קול</button>
      </div>`;
    const m = modalShell('⚙️ הגדרות זורו', html);
    m.querySelector('#jv-save').onclick = () => {
      updateSettings({
        voiceOn:       m.querySelector('#jv-voiceOn').checked,
        wakeWordOn:    m.querySelector('#jv-wake').checked,
        rate:          parseFloat(m.querySelector('#jv-rate').value),
        morningBriefAt:m.querySelector('#jv-am').value,
        eveningBriefAt:m.querySelector('#jv-pm').value,
        anthropicKey:  m.querySelector('#jv-apikey').value.trim(),
      });
      hud.toast('הגדרות נשמרו', 'ok');
      m.remove();
    };
    m.querySelector('#jv-test').onclick = () => speak('בדיקת מערכת. שומע אותי, רואי?');
  }

  // ────────────────────────────────────────────────────────────────────────
  // 9-A. WEEK SCHEDULE VIEW — full Sun–Sat day cards
  // ────────────────────────────────────────────────────────────────────────
  function openWeekScheduleView() {
    const today = new Date();
    const wk = isoWeekKey(today);
    const sched = loadSchedule();
    const wkData = sched.weeks[wk] || {};
    const dayNames = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
    const typeColors = {
      fixed:'#ff9f43', deep_work:'#00d4ff', medium:'#a29bfe', light:'#55efc4',
      food:'#fdcb6e', training:'#e17055', walk:'#00cec9', recovery:'#81ecec',
      buffer:'#636e72', reminder:'#fd79a8', family:'#ff7675', university:'#74b9ff',
      meeting:'#ff6b9d', planning:'#a0c4ff'
    };
    const statusEmoji = {planned:'⬜',completed:'✅',partial:'🔶',missed:'❌',replaced:'🔄',skipped:'⏭',postponed:'📌'};

    // Figure out the start of this week (Sunday = day 0)
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());

    let bodyHtml = `<div style="font-size:12px;opacity:.65;margin-bottom:14px;text-align:center">שבוע ${wk} — לחץ על בלוק לעדכון</div>`;

    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart); day.setDate(weekStart.getDate() + d);
      const isToday = dateKey(day) === dateKey(today);
      const blocks = blocksForDay(day);
      if (!blocks.length) continue;

      const dayTally = { completed:0, missed:0, total: blocks.length };
      blocks.forEach(b => {
        const k = b.id+'::'+dateKey(day);
        const st = (wkData[k]||{}).status||'planned';
        if (st === 'completed') dayTally.completed++;
        else if (st === 'missed') dayTally.missed++;
      });
      const dayPct = dayTally.total ? Math.round(dayTally.completed/dayTally.total*100) : 0;
      const isPast = day < today && !isToday;

      bodyHtml += `
        <div style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;
            padding:8px 12px;border-radius:10px;background:${isToday?ACCENT+'22':'rgba(255,255,255,.04)'}">
            <div>
              <span style="font-weight:700;font-size:14px;color:${isToday?ACCENT:'#e6f3ff'}">${dayNames[d]}</span>
              <span style="font-size:11px;opacity:.55;margin-right:8px">${day.toLocaleDateString('he-IL',{month:'short',day:'numeric'})}</span>
              ${isToday ? '<span style="font-size:10px;background:'+ACCENT+'33;color:'+ACCENT+';padding:1px 7px;border-radius:10px">היום</span>' : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              ${isPast || isToday ? `<span style="font-size:11px;opacity:.7">${dayTally.completed}/${dayTally.total} בוצע</span>
              <div style="width:50px;height:5px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden">
                <div style="height:100%;background:${dayPct>80?ACCENT_OK:dayPct>40?ACCENT_WARM:ACCENT_BAD};width:${dayPct}%;transition:.4s"></div>
              </div>` : ''}
              <button data-day="${d}" class="wsv-day-schedule-btn"
                style="background:transparent;color:${ACCENT};border:1px solid ${ACCENT}44;
                border-radius:6px;padding:3px 9px;font-size:11px;cursor:pointer">פתח ▸</button>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${blocks.map(b => {
              const k = b.id+'::'+dateKey(day);
              const st = (wkData[k]||{}).status||'planned';
              const col = typeColors[b.type] || ACCENT;
              const em = statusEmoji[st] || '⬜';
              const actualMin = (wkData[k]||{}).actualMinutes;
              return `<div data-bid="${b.id}" data-dayidx="${d}" class="wsv-block-row"
                style="display:flex;align-items:center;gap:8px;padding:7px 10px;
                  border:1px solid ${col}33;border-left:3px solid ${col};border-radius:8px;
                  cursor:pointer;transition:background .15s;opacity:${isPast&&st==='planned'?.5:1}"
                onmouseenter="this.style.background='${col}11'" onmouseleave="this.style.background='transparent'">
                <span style="font-size:13px">${em}</span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.title}</div>
                  <div style="font-size:10px;opacity:.55">${b.start}–${b.end}${actualMin?` · ${actualMin} דק׳`:''}</div>
                </div>
                <span style="font-size:9px;padding:2px 6px;border-radius:8px;
                  background:${col}22;color:${col};white-space:nowrap">
                  ${b.fixed?'🔒':b.replaceable?'↔':'·'}
                </span>
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }

    const m = modalShell('📅 לוז שבועי — '+wk, bodyHtml);

    // Day "open" buttons → open that day's schedule
    m.querySelectorAll('.wsv-day-schedule-btn').forEach(btn => {
      btn.onclick = () => {
        const d = parseInt(btn.dataset.day);
        const day = new Date(weekStart); day.setDate(weekStart.getDate() + d);
        m.remove();
        openScheduleModal(day);
      };
    });

    // Block rows → open block update modal
    m.querySelectorAll('.wsv-block-row').forEach(row => {
      row.onclick = () => {
        const dayIdx = parseInt(row.dataset.dayidx);
        const day = new Date(weekStart); day.setDate(weekStart.getDate() + dayIdx);
        const blocks = blocksForDay(day);
        const block = blocks.find(b => b.id === row.dataset.bid);
        if (block) { m.remove(); openBlockUpdateModal(block, day, null); }
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────────
  // 9-B. PROJECT HUB — debt, progress, next action, weekly targets
  // ────────────────────────────────────────────────────────────────────────
  function openProjectHub() {
    const debt = projectDebt();
    const wk = isoWeekKey(new Date());
    const projOrder = ['upselles','university','jobs','apartment','anthropic','fitness','family','recovery'];
    const projEmojis = {upselles:'🚀',university:'🎓',jobs:'💼',apartment:'🏠',anthropic:'🤖',fitness:'💪',family:'❤️',recovery:'🌊'};

    const entries = projOrder.map(k => {
      const p = PROJECTS[k];
      if (!p) return null;
      const d = debt[p.name] || { planned:0, actual:0, debt:0, missed:0, completed:0 };
      const budgetMins = (p.weeklyBudget || 0) * 60;
      const actualH = Math.round(d.actual/60*10)/10;
      const plannedH = Math.round((budgetMins||d.planned)/60*10)/10;
      const debtH = Math.round(Math.max(0, (budgetMins||d.planned) - d.actual)/60*10)/10;
      const pct = budgetMins ? Math.min(100, Math.round(d.actual/budgetMins*100)) : (d.planned ? Math.min(100, Math.round(d.actual/d.planned*100)) : 0);
      const status = pct >= 90 ? {l:'בקצב טוב ✅', c:ACCENT_OK} : pct >= 50 ? {l:'קצת מאחור 🔶', c:ACCENT_WARM} : pct > 0 ? {l:'מאחור ⚠️', c:ACCENT_BAD} : {l:'לא התחיל', c:'#636e72'};
      return { k, p, d, budgetMins, actualH, plannedH, debtH, pct, status };
    }).filter(Boolean);

    const html = `
      <div style="font-size:12px;opacity:.6;margin-bottom:14px;text-align:center">שבוע ${wk} — ביצוע מול יעד</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${entries.map(({k,p,d,budgetMins,actualH,plannedH,debtH,pct,status}) => `
        <div style="border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:13px">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
            <div>
              <span style="font-size:15px">${projEmojis[k]||'📁'}</span>
              <span style="font-weight:700;font-size:14px;margin-right:6px">${p.name}</span>
              <span style="font-size:10px;padding:2px 7px;border-radius:8px;
                background:${status.c}22;color:${status.c}">${status.l}</span>
            </div>
            <div style="text-align:left;font-size:11px;opacity:.7">${p.weeklyBudget||'?'} ש׳/שבוע</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;text-align:center">
            <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:8px">
              <div style="font-size:18px;font-weight:700;color:${ACCENT}">${actualH}</div>
              <div style="font-size:10px;opacity:.55">בוצע (ש׳)</div>
            </div>
            <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:8px">
              <div style="font-size:18px;font-weight:700;color:rgba(255,255,255,.6)">${plannedH}</div>
              <div style="font-size:10px;opacity:.55">יעד (ש׳)</div>
            </div>
            <div style="background:${debtH>0?ACCENT_BAD+'11':'rgba(255,255,255,.04)'};border-radius:8px;padding:8px">
              <div style="font-size:18px;font-weight:700;color:${debtH>0?ACCENT_BAD:ACCENT_OK}">${debtH}</div>
              <div style="font-size:10px;opacity:.55">חוב (ש׳)</div>
            </div>
          </div>
          <div style="height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden;margin-bottom:8px">
            <div style="height:100%;background:${pct>=80?ACCENT_OK:pct>=40?ACCENT_WARM:ACCENT_BAD};
              width:${pct}%;transition:.6s;border-radius:3px"></div>
          </div>
          <div style="font-size:11px;opacity:.7;display:flex;justify-content:space-between">
            <span>${d.completed} בלוקים הושלמו · ${d.missed} הוחמצו</span>
            <span>${pct}% מהיעד</span>
          </div>
          ${p.nextAction ? `<div style="margin-top:8px;font-size:12px;color:${ACCENT};background:rgba(0,212,255,.07);
            border-radius:6px;padding:6px 10px">▶ ${p.nextAction}</div>` : ''}
        </div>`).join('')}
      </div>
      <div style="margin-top:16px;text-align:center">
        <button id="jv-ph-debt" style="background:transparent;color:${ACCENT};border:1px solid ${ACCENT}44;
          border-radius:8px;padding:8px 16px;font-size:12px;cursor:pointer">⚠️ דוח חוב מפורט</button>
      </div>`;

    const m = modalShell('📊 Project Hub — כל הפרויקטים', html);
    m.querySelector('#jv-ph-debt').onclick = () => { speak(ACTIONS.showDebt()); };
  }

  // ────────────────────────────────────────────────────────────────────────
  // 9-C. TODAY COMMAND CENTER — mobile-first daily view
  // ────────────────────────────────────────────────────────────────────────
  function openTodayView() {
    const today = new Date();
    const hm = String(today.getHours()).padStart(2,'0')+':'+String(today.getMinutes()).padStart(2,'0');
    const dayNames = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
    const blocks = blocksForDay(today);
    const wk = isoWeekKey(today);
    const sched = loadSchedule();
    const wkData = sched.weeks[wk] || {};
    const debt = projectDebt();
    const ciKey = 'jv_checkin_' + dateKey(today) + '_am';
    const ci = readLocal(ciKey, {});
    const typeColors = {
      fixed:'#ff9f43', deep_work:'#00d4ff', medium:'#a29bfe', light:'#55efc4',
      food:'#fdcb6e', training:'#e17055', walk:'#00cec9', recovery:'#81ecec',
      buffer:'#636e72', reminder:'#fd79a8', family:'#ff7675', university:'#74b9ff',
      meeting:'#ff6b9d', planning:'#a0c4ff'
    };

    // Find current + next block
    const current  = blocks.find(b => b.start <= hm && b.end > hm);
    const upcoming = blocks.filter(b => b.start > hm).slice(0,3);
    const done     = blocks.filter(b => { const k=b.id+'::'+dateKey(today); return (wkData[k]||{}).status==='completed'; }).length;
    const behind   = Object.entries(debt).filter(([,o])=>o.debt>30).map(([p,o])=>`${p} ${Math.round(o.debt/60*10)/10}ש׳`);

    const html = `
      <div style="display:flex;flex-direction:column;gap:14px;font-size:13px">
        <!-- Header -->
        <div style="text-align:center;padding:10px 0">
          <div style="font-size:20px;font-weight:700;color:${ACCENT}">${today.toLocaleDateString('he-IL',{month:'long',day:'numeric'})}</div>
          <div style="font-size:12px;opacity:.6;margin-top:2px">יום ${dayNames[today.getDay()]} · ${done}/${blocks.length} בלוקים בוצעו</div>
        </div>

        <!-- Main Task -->
        <div style="background:rgba(0,212,255,.08);border:1px solid ${ACCENT}44;border-radius:12px;padding:12px">
          <div style="font-size:10px;color:${ACCENT};text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">🎯 משימה ראשית</div>
          <div style="font-size:14px;font-weight:700">${ci.main || 'לא הוגדרה — פתח Check-In'}</div>
          ${ci.secondary ? `<div style="font-size:12px;opacity:.7;margin-top:4px">📋 משני: ${ci.secondary}</div>` : ''}
        </div>

        <!-- Current Block -->
        ${current ? `
        <div style="background:rgba(0,212,255,.15);border:1px solid ${ACCENT};border-radius:12px;padding:12px">
          <div style="font-size:10px;color:${ACCENT};text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">⏱ עכשיו</div>
          <div style="font-size:15px;font-weight:700">${current.title}</div>
          <div style="font-size:11px;opacity:.7;margin-top:2px">${current.start}–${current.end}</div>
          <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
            <button data-act="complete-current" style="flex:1;background:${ACCENT_OK};color:#001828;border:none;
              border-radius:8px;padding:7px;font-size:12px;font-weight:700;cursor:pointer">✅ בוצע</button>
            <button data-act="update-current" style="flex:1;background:rgba(255,255,255,.08);color:#e6f3ff;border:1px solid ${ACCENT}44;
              border-radius:8px;padding:7px;font-size:12px;cursor:pointer">✏️ עדכן</button>
          </div>
        </div>` : `
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px;text-align:center">
          <div style="opacity:.55;font-size:12px">אין בלוק פעיל כרגע</div>
        </div>`}

        <!-- Upcoming blocks -->
        ${upcoming.length ? `
        <div>
          <div style="font-size:10px;color:${ACCENT};text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">🔜 הבא בתור</div>
          ${upcoming.map(b => {
            const k=b.id+'::'+dateKey(today); const st=(wkData[k]||{}).status||'planned';
            const col=typeColors[b.type]||ACCENT;
            return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px;
              border:1px solid ${col}33;border-left:3px solid ${col};border-radius:8px;">
              <div style="flex:1">
                <div style="font-size:13px;font-weight:600">${b.title}</div>
                <div style="font-size:11px;opacity:.55">${b.start}–${b.end}</div>
              </div>
              <button data-bid="${b.id}" class="tc-update-btn"
                style="background:transparent;color:${ACCENT};border:1px solid ${ACCENT}44;
                border-radius:6px;padding:3px 9px;font-size:11px;cursor:pointer">עדכן</button>
            </div>`;
          }).join('')}
        </div>` : ''}

        <!-- Debt alert -->
        ${behind.length ? `
        <div style="background:rgba(255,77,109,.08);border:1px solid ${ACCENT_BAD}44;border-radius:10px;padding:10px">
          <div style="color:${ACCENT_BAD};font-size:11px;margin-bottom:4px">⚠️ מאחור השבוע</div>
          <div style="font-size:12px;opacity:.85">${behind.join(' · ')}</div>
        </div>` : `
        <div style="background:rgba(66,230,149,.06);border:1px solid ${ACCENT_OK}44;border-radius:10px;padding:8px;text-align:center;font-size:12px;color:${ACCENT_OK}">
          ✅ כל הפרויקטים בקצב טוב
        </div>`}

        <!-- Quick command -->
        <div>
          <div style="font-size:10px;color:${ACCENT};text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">⚡ פקודה מהירה</div>
          <div style="display:flex;gap:6px">
            <input id="tc-cmd" type="text" placeholder="מה עשית? מה לדחות? מה הבא?"
              style="flex:1;background:rgba(255,255,255,.07);border:1px solid ${ACCENT}33;border-radius:8px;
                padding:9px 10px;color:#e6f3ff;font-size:13px;direction:rtl"/>
            <button id="tc-send" style="background:${ACCENT};color:#001828;border:none;border-radius:8px;
              padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer">▶</button>
          </div>
          <div style="display:flex;gap:5px;margin-top:8px;flex-wrap:wrap">
            <button class="tc-chip" data-cmd="מה לעשות עכשיו" style="background:rgba(255,255,255,.05);color:#cfe8ff;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:5px 10px;font-size:11px;cursor:pointer">⚡ מה עכשיו</button>
            <button class="tc-chip" data-cmd="מה אני חייב השבוע" style="background:rgba(255,255,255,.05);color:#cfe8ff;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:5px 10px;font-size:11px;cursor:pointer">📋 חוב שבועי</button>
            <button class="tc-chip" data-cmd="תכנן לי את היום לפי מה שפספסתי אתמול" style="background:rgba(255,255,255,.05);color:#cfe8ff;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:5px 10px;font-size:11px;cursor:pointer">📅 תכנן יום</button>
            <button class="tc-chip" data-cmd="מה אני יכול לדלג" style="background:rgba(255,255,255,.05);color:#cfe8ff;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:5px 10px;font-size:11px;cursor:pointer">↩ מה לדלג</button>
          </div>
        </div>

        <!-- Quick actions -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button id="tc-checkin" style="background:rgba(0,212,255,.1);color:${ACCENT};border:1px solid ${ACCENT}44;border-radius:10px;padding:10px;font-size:12px;cursor:pointer">☀️ Check-In</button>
          <button id="tc-week" style="background:rgba(162,155,254,.1);color:#a29bfe;border:1px solid #a29bfe44;border-radius:10px;padding:10px;font-size:12px;cursor:pointer">📅 לוז שבועי</button>
          <button id="tc-hub" style="background:rgba(85,239,196,.1);color:#55efc4;border:1px solid #55efc444;border-radius:10px;padding:10px;font-size:12px;cursor:pointer">📊 Project Hub</button>
          <button id="tc-schedule" style="background:rgba(253,203,110,.1);color:#fdcb6e;border:1px solid #fdcb6e44;border-radius:10px;padding:10px;font-size:12px;cursor:pointer">📋 לוז היום</button>
        </div>
      </div>`;

    const m = modalShell('🎯 Today — Command Center', html);

    // Complete current
    if (current) {
      m.querySelector('[data-act="complete-current"]').onclick = () => {
        setBlockStatus(current.id, today, { status:'completed', actualMinutes: function(){
          const [sh,sm]=current.start.split(':').map(Number); const [eh,em]=current.end.split(':').map(Number);
          return (eh*60+em)-(sh*60+sm);
        }()});
        celebrate(); m.remove(); hud.toast('✅ '+current.title+' בוצע!', 'ok'); speak(current.title+' marked done.');
      };
      m.querySelector('[data-act="update-current"]').onclick = () => { m.remove(); openBlockUpdateModal(current, today, null); };
    }

    // Upcoming update buttons
    m.querySelectorAll('.tc-update-btn').forEach(btn => {
      btn.onclick = () => {
        const b = blocks.find(x=>x.id===btn.dataset.bid);
        if (b) { m.remove(); openBlockUpdateModal(b, today, null); }
      };
    });

    // Command input
    const cmdInput = m.querySelector('#tc-cmd');
    const sendCmd = async () => {
      const txt = cmdInput.value.trim();
      if (!txt) return;
      cmdInput.value = '';
      hud.setState('thinking');
      const reply = await handle(txt);
      hud.setState('idle');
      if (reply) { hud.toast(reply.slice(0,80), 'ok'); speak(reply); }
    };
    m.querySelector('#tc-send').onclick = sendCmd;
    cmdInput.onkeydown = e => { if (e.key==='Enter') sendCmd(); };
    m.querySelectorAll('.tc-chip').forEach(c => { c.onclick = () => { cmdInput.value=c.dataset.cmd; sendCmd(); }; });

    // Navigation buttons
    m.querySelector('#tc-checkin').onclick  = () => { m.remove(); openDailyCheckIn(); };
    m.querySelector('#tc-week').onclick     = () => { m.remove(); openWeekScheduleView(); };
    m.querySelector('#tc-hub').onclick      = () => { m.remove(); openProjectHub(); };
    m.querySelector('#tc-schedule').onclick = () => { m.remove(); openScheduleModal(today); };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  // ────────────────────────────────────────────────────────────────────────
  // 10. PROJECT DEBT WIDGET (injects into dashboard if there's a spot)
  // ────────────────────────────────────────────────────────────────────────
  function renderDebtWidget() {
    // Only inject into dashboard page — check URL hash or active nav
    const page = getCurrentPage().toLowerCase();
    const isDashboard = !page || page === 'dashboard' || page === 'home' || page === '' || page === 'ראשי' || page === 'בית';
    if (!isDashboard) return;

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
    // Show once per session (every fresh page load), not once per day
    if (sessionStorage.getItem('jv_locked_this_session')) return;
    sessionStorage.setItem('jv_locked_this_session', '1');

    const dayName    = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'][today.getDay()];
    const greet      = today.getHours() < 12 ? 'Good morning' : today.getHours() < 17 ? 'Good afternoon' : 'Good evening';
    const userName   = getCurrentUserDisplay();
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
        <div style="font-size:52px;font-weight:100;color:${ACCENT};letter-spacing:3px;margin-bottom:4px">זורו</div>
        <div style="font-size:15px;color:rgba(245,245,247,.65);margin-bottom:24px">${greet}, ${userName} &nbsp;·&nbsp; ${today.toLocaleDateString('en-IL',{weekday:'long',month:'short',day:'numeric'})}</div>

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
          Let's go 🚀
        </button>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <button id="jv-lock-checkin" style="background:transparent;color:${ACCENT};border:1px solid ${ACCENT}55;
            border-radius:18px;padding:8px 18px;font-size:12px;cursor:pointer">☀️ Daily Check-In</button>
          <button id="jv-lock-skip" style="background:transparent;color:rgba(245,245,247,.5);border:1px solid rgba(245,245,247,.15);
            border-radius:18px;padding:8px 18px;font-size:12px;cursor:pointer">Skip →</button>
          <button id="jv-lock-logout" style="background:transparent;color:rgba(245,245,247,.3);border:none;
            border-radius:18px;padding:8px 12px;font-size:11px;cursor:pointer">⇠ Switch account</button>
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
    wrap.querySelector('#jv-lock-enter').onclick    = () => { dismiss(); speak(`${greet}, ${userName}. Let's go.`); };
    wrap.querySelector('#jv-lock-checkin').onclick  = () => { dismiss(); setTimeout(openDailyCheckIn, 350); };
    wrap.querySelector('#jv-lock-skip').onclick     = dismiss;
    wrap.querySelector('#jv-lock-logout').onclick   = logoutUser;
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
  // 11-D. SCHEDULE GRID INJECTION — populate .wg-cell elements with blocks
  // ────────────────────────────────────────────────────────────────────────
  const TYPE_COLORS = {
    fixed:'#ff9f43', deep_work:'#00d4ff', medium:'#a29bfe', light:'#55efc4',
    food:'#fdcb6e', training:'#e17055', walk:'#00cec9', recovery:'#81ecec',
    buffer:'#636e72', reminder:'#fd79a8', family:'#ff7675', university:'#74b9ff',
    meeting:'#ff6b9d', planning:'#a0c4ff'
  };

  function injectScheduleIntoGrid() {
    // Disabled in v5.3 — the weekly schedule now lives natively inside the
    // app's own week grid (S.weekEvents), seeded by seedSchedule() in index.html.
    return;
    // eslint-disable-next-line no-unreachable
    const GRID_START_HOUR = 6;
    const today = new Date();
    const wk = isoWeekKey(today);
    const sched = loadSchedule();
    const wkData = sched.weeks[wk] || {};

    // Remove any previously injected events
    document.querySelectorAll('.jv-sched-ev').forEach(el => el.remove());

    DEFAULT_BLOCKS.forEach(block => {
      const dayIdx = block.day; // 0=Sun...6=Sat
      const [startH, startM] = block.start.split(':').map(Number);
      const rowIdx = startH - GRID_START_HOUR;
      if (rowIdx < 0 || rowIdx > 16) return;

      const cell = document.getElementById(`wc-${dayIdx}-${rowIdx}`);
      if (!cell) return;

      // Get status for this week
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay()); // Sunday
      const blockDate = new Date(weekStart);
      blockDate.setDate(weekStart.getDate() + dayIdx);
      const dk = dateKey(blockDate);
      const stEntry = wkData[block.id + '::' + dk] || {};
      const status = stEntry.status || 'planned';

      const statusEmoji = {planned:'',completed:'✅',partial:'🔶',missed:'❌',replaced:'🔄',skipped:'⏭',postponed:'📌'};
      const col = TYPE_COLORS[block.type] || '#00d4ff';
      const em = statusEmoji[status] || '';
      const locked = block.fixed ? '🔒' : '';

      const el = document.createElement('div');
      el.className = 'jv-sched-ev';
      el.draggable = true;
      el.dataset.blockId = block.id;
      el.dataset.dayIdx = dayIdx;
      el.dataset.rowIdx = rowIdx;
      el.dataset.dk = dk;
      el.style.cssText = `background:${col}bb;border-left:3px solid ${col};`;
      el.title = `${block.start}–${block.end} | ${block.title}\n${block.action}`;
      el.textContent = `${em}${locked} ${block.start} ${block.title}`;

      // Click → open block update modal
      el.addEventListener('click', e => {
        e.stopPropagation();
        openBlockUpdateModal(block, blockDate, null);
      });

      // Drag start
      el.addEventListener('dragstart', e => {
        el.classList.add('dragging');
        e.dataTransfer.setData('text/plain', JSON.stringify({
          blockId: block.id, dayIdx, rowIdx, dk
        }));
        e.dataTransfer.effectAllowed = 'move';
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));

      cell.appendChild(el);
    });

    // Make cells accept drops
    document.querySelectorAll('.wg-cell').forEach(cell => {
      cell.addEventListener('dragover', e => {
        e.preventDefault();
        cell.classList.add('drag-over');
        e.dataTransfer.dropEffect = 'move';
      });
      cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
      cell.addEventListener('drop', e => {
        e.preventDefault();
        cell.classList.remove('drag-over');
        try {
          const data = JSON.parse(e.dataTransfer.getData('text/plain'));
          const idMatch = cell.id.match(/^wc-(\d+)-(\d+)$/);
          if (!idMatch) return;
          const newDayIdx = parseInt(idMatch[1]);
          const newRowIdx = parseInt(idMatch[2]);
          const newHour = GRID_START_HOUR + newRowIdx;
          const newStart = String(newHour).padStart(2,'0') + ':00';

          // Update block start time in schedule
          const sched2 = loadSchedule();
          const blockIdx = sched2.blocks.findIndex(b => b.id === data.blockId);
          if (blockIdx === -1) return;

          const origBlock = sched2.blocks[blockIdx];
          const dur = _blockDurMins(origBlock);
          const endHour = newHour + Math.floor(dur/60);
          const endMin = dur % 60;
          sched2.blocks[blockIdx] = {
            ...origBlock,
            day: newDayIdx,
            start: newStart,
            end: String(endHour).padStart(2,'0') + ':' + String(endMin).padStart(2,'0')
          };
          saveSchedule(sched2);
          hud.toast(`${origBlock.title} הועבר ל${newStart}`, 'ok');
          injectScheduleIntoGrid(); // refresh
        } catch(e2) { /* silent */ }
      });
    });
  }

  function _blockDurMins(block) {
    const [sh,sm] = block.start.split(':').map(Number);
    const [eh,em] = block.end.split(':').map(Number);
    return (eh*60+em) - (sh*60+sm);
  }

  function saveSchedule(sched) {
    try { localStorage.setItem(SCHED_KEY, JSON.stringify(sched)); } catch(e) {}
  }

  // Minimal palette for the Zoro HUD only — the app keeps its own (light)
  // theme. The old full-page dark override caused unreadable contrast.
  function injectZoroVars() {
    if (document.getElementById('jv-zoro-vars')) return;
    const s = document.createElement('style');
    s.id = 'jv-zoro-vars';
    s.textContent = `
:root {
  --jv-bg:#000; --jv-bg2:#0a0a0a; --jv-bg3:#111;
  --jv-surface:rgba(28,28,30,.94); --jv-surface2:rgba(44,44,46,.9);
  --jv-border:rgba(255,255,255,.12);
  --jv-accent:#00d4ff; --jv-accent2:#0071e3;
  --jv-text:#f5f5f7; --jv-text2:rgba(245,245,247,.66); --jv-text3:rgba(245,245,247,.4);
  --jv-red:#ff375f; --jv-green:#34c759; --jv-yellow:#ffd60a;
  --jv-radius:14px;
}
.jv-panel { background:rgba(10,10,12,.97) !important; border-color:rgba(0,212,255,.25) !important; }
.jv-dock  { background:rgba(10,10,12,.97) !important; border-color:rgba(0,212,255,.20) !important; }
`;
    document.head.appendChild(s);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 12. BOOT
  // ────────────────────────────────────────────────────────────────────────
  function boot() {
    // 1. Inject Zoro's scoped palette — does NOT override the app theme
    injectZoroVars();

    // 2. Account system — show login screen if no active session
    const doInit = () => {
      const user = getCurrentUser();
      if (user) installAccountProxy(user);

      hud.mount();
      bindRecog = (function(orig){return function(){ recog = recog || makeRecognizer(); return orig(); }})(bindRecogActual);
      bindRecogActual();
      // ⚠️ No auto-start of recognition — user must click the orb first
      setupBriefings();
      setTimeout(renderDebtWidget, 1500);

      if ('Notification' in window && Notification.permission === 'default') {
        setTimeout(() => Notification.requestPermission().catch(()=>{}), 8000);
      }

      window.JARVIS = {
        version: VERSION,
        handle, route, speak, listen: startListening, stop: stopListening,
        readState, writeState, writeScheduleBlock,
        projectDebt, blockStatus, setBlockStatus, replaceBlock,
        suggestReschedule, getLog, settings, updateSettings,
        requestNotifPermission, logoutUser,
        openSchedule:     openScheduleModal,
        openWeekSchedule: openWeekScheduleView,
        openProjectHub:   openProjectHub,
        openTodayView:    openTodayView,
        openBlockUpdate:  openBlockUpdateModal,
        openLog:          openLogModal,
        openSettings:     openSettingsModal,
        openCheckIn:      openDailyCheckIn,
        openWeeklyReview: openWeeklyReview,
        openWhatNow:      openWhatNowPanel,
        openLock:         openLockScreen,
        brief:    ()     => ACTIONS.morningBrief(),
        debt:     ()     => ACTIONS.showDebt(),
        whatNow:  (e)    => ACTIONS.whatNow({ energy: e || 'medium' }),
        whatSkip: ()     => ACTIONS.whatToSkip(),
        planDay:  ()     => ACTIONS.planByMissed(),
        logTime:  (args) => ACTIONS.logActualTime(args),
        activity: (args) => ACTIONS.activityReport(args),
        addBlock: (args) => ACTIONS.addScheduleBlock(args),
      };

      setTimeout(openLockScreen, 900);
      loadZoroMem();

      // Inject on page navigation
      const _origGoPage = window.goPage;
      window.goPage = function(page) {
        if (typeof _origGoPage === 'function') _origGoPage(page);
        if (page === 'week' || page === 'schedule') {
          setTimeout(injectScheduleIntoGrid, 400);
        }
      };

      // Also inject if already on week page
      setTimeout(() => {
        if (getCurrentPage() === 'week') injectScheduleIntoGrid();
      }, 1500);

      // MutationObserver — inject when week grid appears
      const _gridObserver = new MutationObserver(() => {
        if (document.getElementById('wc-0-0') || document.querySelector('.wg-cell')) {
          injectScheduleIntoGrid();
          _gridObserver.disconnect();
        }
      });
      _gridObserver.observe(document.body, { childList: true, subtree: true });
      console.log('%cזורו v5.3 online — natural speech, app-native theme, native schedule.', 'color:#00d4ff;font-weight:bold;font-size:14px');
    };

    // If already logged in this session → go directly
    if (getCurrentUser()) {
      doInit();
    } else {
      // Show login screen; doInit runs after successful login
      openLoginScreen(() => doInit());
    }
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
      if (_recogStarted && settings().wakeWordOn && !listeningHard) setTimeout(()=>{ if(_recogStarted) startListening(false); }, 1000);
    };
    recog.onerror = (e) => {
      hud.setState('idle');
      if (e.error === 'not-allowed') { _recogStarted = false; hud.toast('Microphone access denied. Enable in browser settings.', 'error'); }
    };
    recog.onresult = async (ev) => {
      if (zoroSpeaking) return; // ignore mic input while Zoro is talking
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
          if (!cmd) { speak('Yes, Roei? I\'m listening.'); listeningHard = true; return; }
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

// zoro v5.0
