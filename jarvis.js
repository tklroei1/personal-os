/* ============================================================================
 * JARVIS â Personal OS AI Companion (Iron Man inspired)
 * Drop-in module for https://personal-os-coral-tau.vercel.app/
 * Usage: add <script src="/jarvis.js" defer></script> before </body>
 * Author: built for Roei Klein â May 2026
 * Version: 3.0.0
 * --------------------------------------------------------------------------
 * Features
 *   â¢ Floating HUD orb (Iron Man arc-reactor look)
 *   â¢ Wake-word + push-to-talk voice (he-IL)
 *   â¢ Natural-language command router (Hebrew + English)
 *   â¢ Schedule system: planned/completed/partial/missed/replaced
 *   â¢ Block replacement + reschedule suggestions
 *   â¢ Project debt tracker + next-action surfacing
 *   â¢ Execution log (every action persisted)
 *   â¢ Proactive briefings (morning / end-of-day / weekly)
 *   â¢ Quick-update modal
 * --------------------------------------------------------------------------
 * Zero dependencies. Uses Web Speech API (built into Chrome).
 * Talks to existing window.* functions: addTask, toggleTask, addReminder,
 * goPage, showNotif, callClaude, etc. â does NOT replace them.
 * ============================================================================ */

(function () {
  'use strict';

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  //  0. CONFIG
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const VERSION       = '2.0.0';
  const STATE_KEY     = 'pos3';
  const LOG_KEY       = 'pos3_jarvis_log';
  const SCHED_KEY     = 'pos3_jarvis_schedule';
  const PERSONA_KEY   = 'pos3_jarvis_persona';
  const SETTINGS_KEY  = 'pos3_jarvis_settings';
  const WAKE_WORDS    = ['××³×¨××××¡', '××¨××××¡', "×'×¨××××¡", '×××¨×××¡', 'jarvis', '×××³×¨××××¡', '×× ××¨××××¡'];
  const LANG          = 'he-IL';
  const ACCENT        = '#00d4ff';   // arc-reactor cyan
  const ACCENT_WARM   = '#ff8a3d';   // warning amber
  const ACCENT_OK     = '#42e695';   // success green
  const ACCENT_BAD    = '#ff4d6d';   // error red

  // Block types (Part 3 of the brief)
  const BLOCK_TYPES = {
    fixed:      { label:'×§×××¢',      color:'#8b9bb4' },
    deep_work:  { label:'×¢×××× ×¢×××§×', color:'#00d4ff' },
    medium:     { label:'×¢×××× ××× ×× ××ª', color:'#42a5ff' },
    light:      { label:'×¢×××× ×§××',  color:'#7ec8ff' },
    food:       { label:'××××',       color:'#ffb84d' },
    training:   { label:'×××××',      color:'#ff5577' },
    walk:       { label:'×××××',      color:'#42e695' },
    recovery:   { label:'××ª×××©×©××ª',   color:'#a78bfa' },
    buffer:     { label:'×××¤×¨',       color:'#6b7d99' },
    reminder:   { label:'×ª××××¨×ª',     color:'#ffd84d' },
    family:     { label:'××©×¤××',      color:'#ff8a3d' },
    university: { label:'××× ×××¨×¡×××', color:'#5773ff' },
    meeting:    { label:'×¤×××©×',      color:'#ff6b6b' },
    planning:   { label:'×ª×× ××',      color:'#00bcd4' },
  };

  // Project registry (Part 6 of the brief)
  const PROJECTS = {
    upselles:   { name:'Upselles',          weeklyBudget: 6*60+8*60, priority:1, status:'active', emoji:'ð' },
    university: { name:'××× ×××¨×¡××× (M.Sc)', weeklyBudget: 7*60+10*60, priority:1, status:'active', emoji:'ð' },
    jobs:       { name:'×××¤××© ×¢××××',       weeklyBudget: 3*60+4*60,  priority:2, status:'active', emoji:'ð¼' },
    apartment:  { name:'×××¤××© ×××¨×',        weeklyBudget: 2*60+3*60,  priority:2, status:'active', emoji:'ð¡' },
    anthropic:  { name:'×§××¨×¡ Anthropic',    weeklyBudget: 1.5*60+3*60, priority:3, status:'active', emoji:'ð§ ' },
    fitness:    { name:'×××©×¨ ××ª××× ×',       weeklyBudget: 3*90,        priority:2, status:'active', emoji:'ðª' },
    family:     { name:'××©×¤×× / ×××©×',      weeklyBudget: 5*60,        priority:1, status:'active', emoji:'ð¨âð©âð§' },
    recovery:   { name:'×× ××× / ×××¤×©',      weeklyBudget: 8*60,        priority:3, status:'active', emoji:'ð' },
  };

  // EXACT weekly schedule from the brief.
  // Each block: id, day (0=Sun..6=Sat), start, end, title, type, proj,
  //             dedicated (purpose), action, replaceable, fixed.
  const DEFAULT_BLOCKS = [
    // âââââ SUNDAY (day 0) âââââ
    { id:'sun-plan',     day:0, start:'10:30', end:'11:00', title:'×ª×× ×× ×©×××¢×', type:'planning',
      proj:null, dedicated:'×ª×× ×× ××©×××¢', action:'×××¨ 3 ××©××××ª ××¨×××××ª ××©×××¢', replaceable:false, fixed:true },
    { id:'sun-upselles', day:0, start:'11:00', end:'13:00', title:'Upselles â Deep Work', type:'deep_work',
      proj:'upselles', dedicated:'×¢×××× ×¢×××§× ×¢× ××¤×××¤××¨××', action:'Roadmap / Prompt / Audit / Implementation review', replaceable:true, fixed:false },
    { id:'sun-buf1',     day:0, start:'13:00', end:'13:30', title:'×××¤×¨ / ××ª×××©×©××ª ×§×¦×¨×', type:'buffer',
      proj:null, dedicated:'××¢××¨ ××× ××©××××ª', action:'×× ××× ×§×¦×¨×', replaceable:true, fixed:false },
    { id:'sun-bela',     day:0, start:'13:30', end:'14:30', title:'×¤×××©× ×¢× ×××', type:'meeting',
      proj:null, dedicated:'×¤×××©× ×§×××¢×', action:'× ×××××ª ××¤×××©×', replaceable:false, fixed:true },
    { id:'sun-lunch',    day:0, start:'14:30', end:'15:20', title:'××× ×ª ×¦××¨××× + ×××××', type:'food',
      proj:'fitness', dedicated:'×ª××× ×', action:'×××©×× ××××××ª ××¨×××ª ×¦××¨×××', replaceable:false, fixed:true },
    { id:'sun-uni',      day:0, start:'15:30', end:'16:45', title:'××× ×××¨×¡××× â ××××× ×¢×¦××', type:'university',
      proj:'university', dedicated:'×©××¢××¨× ×××ª + ×ª×¨×××', action:'×¤××¨××§ ××××¦××¢ ××××', replaceable:true, fixed:false },
    { id:'sun-buf2',     day:0, start:'16:45', end:'17:45', title:'×××¤×¨ / ×¡××××¨×× ×§×××', type:'buffer',
      proj:null, dedicated:'××ª×××©×©××ª / ×¡××××¨××', action:'××ª×××©×©××ª ×× ×¡××××¨×× ×§×××', replaceable:true, fixed:false },
    { id:'sun-ronit',    day:0, start:'18:00', end:'18:45', title:'×¤×××©× ×¢× ×¨×× ××ª', type:'meeting',
      proj:null, dedicated:'×¤×××©× ×§×××¢×', action:'× ×××××ª ××¤×××©×', replaceable:false, fixed:true },
    { id:'sun-train',    day:0, start:'19:15', end:'20:45', title:'××××× ×××', type:'training',
      proj:'fitness', dedicated:'××××× ×××', action:'××××× ××¤× ×ª××× ××ª', replaceable:false, fixed:true },
    { id:'sun-dinner',   day:0, start:'21:00', end:'21:35', title:'××× ×ª ×¢×¨× + ×××××', type:'food',
      proj:'fitness', dedicated:'×ª××× ×', action:'×××©×× ××××××ª ××¨×××ª ×¢×¨×', replaceable:false, fixed:true },
    { id:'sun-meat',     day:0, start:'22:00', end:'22:05', title:'×ª××××¨×ª: ×××¤×©××¨ ×¢××£/××©×¨ ××××¨', type:'reminder',
      proj:'fitness', dedicated:'××× × ××¢××£ ×××©×¨', action:'×××¦× ××××§×¤××', replaceable:false, fixed:true },

    // âââââ MONDAY (day 1) â LOW CAPACITY DAY âââââ
    { id:'mon-commute',  day:1, start:'07:00', end:'08:00', title:'× ×¡××¢× ×××× ×××¨×¡×××', type:'buffer',
      proj:'university', dedicated:'× ×¡××¢×', action:'×ª××××¨×', replaceable:false, fixed:true },
    { id:'mon-uni',      day:1, start:'08:00', end:'19:30', title:'××× ×××¨×¡××× â ××× ×××', type:'university',
      proj:'university', dedicated:'××× ××× ×××¨×¡××× ×××', action:'××¨×¦×××ª, ×ª×¨×××××, ×××××ª ××§××¤××¡', replaceable:false, fixed:true },
    { id:'mon-return',   day:1, start:'19:30', end:'20:15', title:'×××¨× ××××ª×', type:'buffer',
      proj:null, dedicated:'× ×¡××¢× ××××ª×', action:'×ª××××¨×', replaceable:false, fixed:true },
    { id:'mon-recover',  day:1, start:'20:15', end:'21:00', title:'×××× / ××§×××ª / ××ª×××©×©××ª', type:'recovery',
      proj:'fitness', dedicated:'××ª×××©×©××ª ××× ××¨××', action:'×××××, ××§×××ª, ×× ×××', replaceable:false, fixed:true },
    { id:'mon-uni-rev',  day:1, start:'21:00', end:'21:20', title:'×¡×§××¨×ª ××× ×××¨×¡××× ×§×¦×¨×', type:'planning',
      proj:'university', dedicated:'×¡×××× ××× ××××××××', action:'××ª×× 3 ××©××××ª ×××©×', replaceable:true, fixed:false },
    { id:'mon-meat',     day:1, start:'22:00', end:'22:05', title:'×ª××××¨×ª: ×××¤×©××¨ ×¢××£/××©×¨ ××××¨', type:'reminder',
      proj:'fitness', dedicated:'××× ×', action:'×××¦× ××××§×¤××', replaceable:false, fixed:true },

    // âââââ TUESDAY (day 2) âââââ
    { id:'tue-plan',     day:2, start:'10:30', end:'11:00', title:'×ª×× ×× ××××', type:'planning',
      proj:null, dedicated:'×ª×× ×× ××××', action:'×××¨ ××©××××ª ××××', replaceable:false, fixed:true },
    { id:'tue-uni',      day:2, start:'11:00', end:'13:00', title:'××× ×××¨×¡××× â Deep Study', type:'deep_work',
      proj:'university', dedicated:'××××× ×¢×¦×× ×¢×××§', action:'×××× / ×ª×¨×××', replaceable:true, fixed:false },
    { id:'tue-lunch',    day:2, start:'13:00', end:'13:50', title:'××× ×ª ×¦××¨××× + ×××××', type:'food',
      proj:'fitness', dedicated:'×ª××× ×', action:'×××©×× ××××××', replaceable:false, fixed:true },
    { id:'tue-upselles', day:2, start:'14:00', end:'15:30', title:'Upselles â Deep Work', type:'deep_work',
      proj:'upselles', dedicated:'×¢×××× ×¢×××§×', action:'××× / ×¤×¨×××¤× / ×¤×××¤××¨××', replaceable:true, fixed:false },
    { id:'tue-walk',     day:2, start:'16:00', end:'16:45', title:'××××× / ×¡××××¨××', type:'walk',
      proj:'fitness', dedicated:'×ª× ××¢× ××××××¨', action:'××××× 30-45 ××§×³', replaceable:true, fixed:false },
    { id:'tue-train',    day:2, start:'18:30', end:'20:00', title:'××××× ×××', type:'training',
      proj:'fitness', dedicated:'××××× ×××', action:'××××× ××¤× ×ª××× ××ª', replaceable:false, fixed:true },
    { id:'tue-dinner',   day:2, start:'20:15', end:'20:50', title:'××× ×ª ×¢×¨× + ×××××', type:'food',
      proj:'fitness', dedicated:'×ª××× ×', action:'×××©×× ××××××', replaceable:false, fixed:true },
    { id:'tue-anthropic',day:2, start:'21:15', end:'22:00', title:'×§××¨×¡ Anthropic / ××××× ×§××', type:'light',
      proj:'anthropic', dedicated:'×××××ª AI', action:'××××× ×§××¨×¡ / ×§×¨×××', replaceable:true, fixed:false },
    { id:'tue-meat',     day:2, start:'22:00', end:'22:05', title:'×ª××××¨×ª: ×××¤×©××¨ ×¢××£/××©×¨ ××××¨', type:'reminder',
      proj:'fitness', dedicated:'××× ×', action:'×××¦× ××××§×¤××', replaceable:false, fixed:true },

    // âââââ WEDNESDAY (day 3) âââââ
    { id:'wed-plan',     day:3, start:'10:30', end:'11:00', title:'×ª×× ×× ××××', type:'planning',
      proj:null, dedicated:'×ª×× ×× ××××', action:'×××¨ ××©××××ª', replaceable:false, fixed:true },
    { id:'wed-uni',      day:3, start:'11:00', end:'13:00', title:'××× ×××¨×¡××× â Deep Study', type:'deep_work',
      proj:'university', dedicated:'××××× ×¢×¦×× ×¢×××§', action:'×××××ª ××ª×¨×××', replaceable:true, fixed:false },
    { id:'wed-lunch',    day:3, start:'13:00', end:'13:50', title:'××× ×ª ×¦××¨××× + ×××××', type:'food',
      proj:'fitness', dedicated:'×ª××× ×', action:'×××©×× ××××××', replaceable:false, fixed:true },
    { id:'wed-apt',      day:3, start:'14:00', end:'15:00', title:'×××¤××© ×××¨×', type:'medium',
      proj:'apartment', dedicated:'×××ª××¨ ×××¨×', action:'××××¢××ª, ××××¢××ª, ×¡×××¨××', replaceable:true, fixed:false },
    { id:'wed-tamar',    day:3, start:'15:30', end:'17:00', title:'×¤×××©× ×¢× ×ª××¨', type:'meeting',
      proj:null, dedicated:'×¤×××©× ×§×××¢×', action:'× ×××××ª ××¤×××©×', replaceable:false, fixed:true },
    { id:'wed-walk',     day:3, start:'17:30', end:'18:15', title:'×××××', type:'walk',
      proj:'fitness', dedicated:'×ª× ××¢× ××××××¨', action:'××××× 45 ××§×³', replaceable:true, fixed:false },
    { id:'wed-dinner',   day:3, start:'19:00', end:'19:35', title:'××× ×ª ×¢×¨× + ×××××', type:'food',
      proj:'fitness', dedicated:'×ª××× ×', action:'×××©×× ××××××', replaceable:false, fixed:true },
    { id:'wed-jobs',     day:3, start:'20:00', end:'21:00', title:'×××¤××© ×¢××××', type:'light',
      proj:'jobs', dedicated:'×××¤××© ××©×¨××ª', action:'×××ª××¨ ××©×××¨× ×-tracker', replaceable:true, fixed:false },
    { id:'wed-meat',     day:3, start:'22:00', end:'22:05', title:'×ª××××¨×ª: ×××¤×©××¨ ×¢××£/××©×¨ ××××¨', type:'reminder',
      proj:'fitness', dedicated:'××× ×', action:'×××¦× ××××§×¤××', replaceable:false, fixed:true },

    // âââââ THURSDAY (day 4) âââââ
    { id:'thu-plan',     day:4, start:'10:30', end:'11:00', title:'×ª×× ×× ××××', type:'planning',
      proj:null, dedicated:'×ª×× ×× ××××', action:'×××¨ ××©××××ª', replaceable:false, fixed:true },
    { id:'thu-upselles', day:4, start:'11:00', end:'13:00', title:'Upselles â Deep Work', type:'deep_work',
      proj:'upselles', dedicated:'×¢×××× ×¢×××§×', action:'×¤××ª×× / ××××× / ×©××××§', replaceable:true, fixed:false },
    { id:'thu-lunch',    day:4, start:'13:00', end:'13:50', title:'××× ×ª ×¦××¨××× + ×××××', type:'food',
      proj:'fitness', dedicated:'×ª××× ×', action:'×××©×× ××××××', replaceable:false, fixed:true },
    { id:'thu-uni',      day:4, start:'14:00', end:'15:30', title:'××× ×××¨×¡××× â ××××', type:'medium',
      proj:'university', dedicated:'××××ª ××× ×××¨×¡×××', action:'×××× / ×ª×¨××× / ××ª×××', replaceable:true, fixed:false },
    { id:'thu-walk',     day:4, start:'16:00', end:'16:45', title:'××××× / ×¡××××¨××', type:'walk',
      proj:'fitness', dedicated:'×ª× ××¢× ××××××¨', action:'××××× 30-45 ××§×³', replaceable:true, fixed:false },
    { id:'thu-train',    day:4, start:'18:30', end:'20:00', title:'××××× ×××', type:'training',
      proj:'fitness', dedicated:'××××× ×××', action:'××××× ××¤× ×ª××× ××ª', replaceable:false, fixed:true },
    { id:'thu-dinner',   day:4, start:'20:15', end:'20:50', title:'××× ×ª ×¢×¨× + ×××××', type:'food',
      proj:'fitness', dedicated:'×ª××× ×', action:'×××©×× ××××××', replaceable:false, fixed:true },
    { id:'thu-review',   day:4, start:'21:15', end:'21:45', title:'×¢×××× ××ª×§××××ª ×©×××¢××ª', type:'planning',
      proj:null, dedicated:'×ª×× ××', action:'×× ××ª×§×× ××©×××¢, ×× ××¡×¨', replaceable:false, fixed:true },
    { id:'thu-meat',     day:4, start:'22:00', end:'22:05', title:'×ª××××¨×ª: ×××¤×©××¨ ×¢××£/××©×¨ ××××¨', type:'reminder',
      proj:'fitness', dedicated:'××× ×', action:'×××¦× ××××§×¤××', replaceable:false, fixed:true },

    // âââââ FRIDAY (day 5) âââââ
    { id:'fri-plan',     day:5, start:'10:30', end:'11:00', title:'×ª×× ×× ××× (×§×)', type:'planning',
      proj:null, dedicated:'×ª×× ×× ××× ×©××©×', action:'×××¨ ××©××××ª ×××', replaceable:false, fixed:true },
    { id:'fri-jobs',     day:5, start:'11:00', end:'12:15', title:'×××¤××© ×¢×××× ×××××ª×', type:'medium',
      proj:'jobs', dedicated:'×××©×ª ×××¢××××××ª', action:'2 ×××©××ª ×××××ª×××ª', replaceable:true, fixed:false },
    { id:'fri-errands',  day:5, start:'12:15', end:'13:00', title:'×¡××××¨×× / ×××ª', type:'light',
      proj:null, dedicated:'×¡××××¨××', action:'××©××××ª ×××ª', replaceable:true, fixed:false },
    { id:'fri-lunch',    day:5, start:'13:00', end:'13:50', title:'××× ×ª ×¦××¨××× + ×××××', type:'food',
      proj:'fitness', dedicated:'×ª××× ×', action:'×××©×× ××××××', replaceable:false, fixed:true },
    { id:'fri-apt',      day:5, start:'14:00', end:'15:15', title:'×××¤××© ×××¨×', type:'medium',
      proj:'apartment', dedicated:'×××ª××¨ ×××¨×', action:'××××¢××ª ××¡×××¨××', replaceable:true, fixed:false },
    { id:'fri-rest',     day:5, start:'15:15', end:'17:30', title:'×× ××× / ××× × / ××©×¤××', type:'recovery',
      proj:'family', dedicated:'××ª×××©×©××ª ×××× × ××©××ª', action:'×× ××× ×××× ××ª', replaceable:false, fixed:true },
    { id:'fri-dinner',   day:5, start:'18:00', end:'21:00', title:'××¨×××ª ×¢×¨× ××©×¤××ª××ª â ×©××©×', type:'family',
      proj:'family', dedicated:'××× ××©×¤××ª×', action:'××¨××× ××©×¤××ª××ª', replaceable:false, fixed:true },

    // âââââ SATURDAY (day 6) âââââ
    { id:'sat-am',       day:6, start:'08:00', end:'14:00', title:'×× ××× / ×× / ××× ×××¤×©×', type:'recovery',
      proj:'recovery', dedicated:'××ª×××©×©××ª', action:'××××¨× ×××¤×©××ª', replaceable:true, fixed:false },
    { id:'sat-buffer',   day:6, start:'14:00', end:'16:00', title:'×××¤×¨ ××©××××ª ×©×××××¦× (×××¤×¦××× ××)', type:'buffer',
      proj:null, dedicated:'××©×××ª ×××', action:'××× ×××¨×¡××× / Upselles / ××©××', replaceable:true, fixed:false },
    { id:'sat-walk',     day:6, start:'16:30', end:'17:15', title:'××××× (×××¤×¦××× ××)', type:'walk',
      proj:'fitness', dedicated:'×ª× ××¢×', action:'×××××', replaceable:true, fixed:false },
    { id:'sat-review',   day:6, start:'18:00', end:'18:45', title:'×¡×××× ×©×××¢× + ×ª×× ×× ×©×××¢ ×××', type:'planning',
      proj:null, dedicated:'Weekly Review', action:'×× ××ª××¦×¢ / ×× ××¡×¨ / ××¢×××', replaceable:false, fixed:true },
    { id:'sat-evening',  day:6, start:'19:00', end:'23:00', title:'××× ×××¤×©×', type:'recovery',
      proj:'recovery', dedicated:'×× ×××', action:'×××¤×©×', replaceable:true, fixed:false },
  ];

  const PAGE_ALIASES = {
    '××©×××¨×':'dashboard','××©××¨':'dashboard','×××ª':'dashboard','×¨××©×':'dashboard',
    '×××':'week','×××':'week','×©×××¢×':'week','××× ×©×××¢×':'week',
    '××©××××ª':'tasks','××©×××':'tasks','××××':'tasks',
    '×ª××××¨×ª':'reminders','×ª××××¨××ª':'reminders',
    '×¢××××':'jobs','×××¤××© ×¢××××':'jobs','jobs':'jobs',
    '××¤×¡××¡':'upselles','upselles':'upselles','×¡×××¨×××¤':'upselles',
    '×××©×¨':'fitness','×××××':'fitness','×××××':'fitness','××××':'fitness','×ª××× ×':'fitness',
    '×××¨×':'apartment','×××¨××ª':'apartment','apt':'apartment',
    '××©×¤××':'family',
    '××× ×××¨×¡×××':'university','××× ×××¨×¡×××':'university','××¨-××××':'university',
    '××××':'university','×××¢ × ×ª×× ××':'university','ds':'university','ai':'university','m.sc':'university',
    '×× ×ª×¨××¤××§':'anthropic','×§××¨×¡':'anthropic','anthropic':'anthropic',
    '×× ×××':'recovery','××':'recovery','×××¤×©':'recovery','beach':'recovery',
    '×¤×× × ×¡××':'finance','××¡×£':'finance','×××¦×××ª':'finance',
    '×¤×ª×§××':'notes',
    '×ª×××':'inbox','××× ×××§×¡':'inbox',
    '×¨×¢××× ××ª':'ideas',
    '××××':'journal',
    '×××¨××ª':'goals',
    '×××©××ª':'news',
  };

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  //  1. STATE HELPERS
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  //  2. EXECUTION LOG
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  //  3. SCHEDULE SYSTEM
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

  // âââ Project debt: for each project, compute time deficit this week
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

  // âââ Reschedule: find next free slot for a missed block
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

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  //  4. WHAT-DO-I-OWE / OVERVIEW QUERIES
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  //  5. ACTIONS (the verbs JARVIS can do)
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  const ACTIONS = {
    navigate(args) {
      const where = (args.where || args.page || '').toLowerCase().trim();
      const target = PAGE_ALIASES[where] || where;
      if (typeof window.goPage === 'function') {
        try { window.goPage(target); logEvent('nav', { target }, 'ok'); return `×× ××× ×${args.where}.`; }
        catch (e) { return `×× ××¦×××ª× ××¢×××¨ ×-${args.where}.`; }
      }
      return '×× ×××× ×× ×××× ××¨××¢.';
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
      return `Added: "${text}"${args.proj ? ' â ' + args.proj : ''}.`;
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
      return `Done â "${t.text}". Good work.`;
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
      return `ð Reminder set: "${text}" at ${timeStr}.`;
    },
    addScheduleBlock(args) {
      // "×ª×× ×¡× X ×-Y ×¢× Z" / "schedule X from Y to Z"
      const today = new Date();
      const dayNum = typeof args.day === 'number' ? args.day : today.getDay();
      const block = writeScheduleBlock(dayNum, args.start, args.end, args.title, args.type || 'medium', args.proj || null);
      hud.toast(`Schedule updated: ${block.title}`, 'ok');
      return `ð Scheduled "${block.title}" from ${block.start} to ${block.end}. Check your weekly view.`;
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
        if (blks.length)  lines.push(`Schedule: ${blks.map(b=>`${b.start} ${b.title}`).join(' â ')}.`);
        if (!lines.length) lines.push('Your day looks clear. Good opportunity to chip away at project debt.');
        return lines.join(' ');
      }
      const tasks = dueThisWeek();
      const debt  = projectDebt();
      const debts = Object.entries(debt).filter(([,o])=>o.debt>0)
        .map(([p,o])=>`${p}: ${Math.round(o.debt/60)}h debt`).join(', ');
      return `This week: ${tasks.length} open task${tasks.length!==1?'s':''}. ${debts ? 'Project debt â '+debts+'.' : 'No project debt. On track!'}`;
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
        debts.length ? `Watch out â project debt on: ${debts.map(([p])=>p).join(', ')}.` : '',
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
      return `Block "${args.blockId}" updated â ${args.status}.`;
    },
    rescheduleBlock(args) {
      const date = args.date ? new Date(args.date) : new Date();
      const sug  = suggestReschedule(args.blockId, date);
      if (!sug) return 'No free slot found this week. Consider Saturday.';
      return `Suggested slot: ${sug.day.toLocaleDateString('en-IL')} at ${sug.start}â${sug.end}.`;
    },
    showDebt() {
      const debt = projectDebt();
      const lines = Object.entries(debt).map(([p,o]) =>
        `${p}: planned ${Math.round(o.planned/60)}h, done ${Math.round(o.actual/60)}h, debt ${Math.round(o.debt/60)}h`
      );
      return lines.length ? lines.join(' | ') : 'No project data yet this week.';
    },
    // ââ Advanced agent commands ââââââââââââââââââââââââââââââââââââââââââââ
    activityReport(args) {
      // "××××ª× ××× ×-14 ×¢× 17 ×××§×× ×××××"
      const today = new Date();
      const from  = parseInt(args.fromHour || 14);
      const to    = parseInt(args.toHour   || 17);
      const blocks = blocksForDay(today).filter(b => {
        const bS = parseInt(b.start); const bE = parseInt(b.end);
        return bS < to && bE > from;
      });
      const replaceable = blocks.filter(b =>  b.replaceable);
      const fixed       = blocks.filter(b => !b.replaceable);
      replaceable.forEach(b => setBlockStatus(b.id, today, { status:'replaced', note: args.activity || '×¤×¢××××ª ×××¨×ª', actualMinutes:0 }));
      fixed.forEach(b       => setBlockStatus(b.id, today, { status:'missed',   note: args.activity || '×¤×¢××××ª ×××¨×ª' }));
      const lines = [];
      if (args.activity) lines.push(`Logged: ${args.activity} between ${from}:00â${to}:00.`);
      if (replaceable.length) lines.push(`"${replaceable.map(b=>b.title).join(', ')}" â marked as replaced.`);
      if (fixed.length)       lines.push(`"${fixed.map(b=>b.title).join(', ')}" â marked as missed.`);
      const sug = replaceable[0] ? suggestReschedule(replaceable[0].id, today) : null;
      if (sug) lines.push(`Recovery slot: ${sug.day.toLocaleDateString('en-IL')} at ${sug.start}â${sug.end}.`);
      return lines.join(' ') || 'Schedule updated.';
    },

    logActualTime(args) {
      // "×¢×©××ª× 70 ××§×³ Upselles ×××§×× 120"
      const today   = new Date();
      const actual  = parseInt(args.actualMinutes || 0);
      const planned = parseInt(args.plannedMinutes || 0);
      const projKey = args.proj || '';
      const blocks  = blocksForDay(today).filter(b => b.proj === projKey);
      if (blocks.length) {
        const threshold = planned || actual;
        const st = actual >= threshold * 0.8 ? 'completed' : actual > 0 ? 'partial' : 'missed';
        setBlockStatus(blocks[0].id, today, { status: st, actualMinutes: actual,
          note: `××ª××× ×: ${planned} ××§×³, ×××¦×¢: ${actual} ××§×³` });
      }
      const pName = PROJECTS[projKey]?.name || projKey;
      const diff  = planned - actual;
      if (diff > 0) return `${pName}: you did ${actual} of ${planned} min. ${diff} min debt â suggest making it up tomorrow.`;
      return `${pName}: ${actual} min done â excellent!${planned ? ` (target was ${planned} min)` : ''}`;
    },

    planByMissed() {
      // "×ª×× × ×× ××ª ×××× ××¤× ×× ×©×¤×¡×¤×¡×ª× ××ª×××"
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const yKey  = isoWeekKey(yesterday);
      const sched = loadSchedule();
      const yData = sched.weeks[yKey] || {};
      const missed = blocksForDay(yesterday).filter(b => {
        const k  = b.id + '::' + dateKey(yesterday);
        const st = yData[k]?.status;
        return st === 'missed' || st === 'partial';
      });
      if (!missed.length) return 'Nothing missed yesterday â clean slate today! ð';
      const today = new Date();
      const suggestions = missed.slice(0, 3).map(b => {
        const sug = suggestReschedule(b.id, today);
        return sug ? `â¢ ${b.title}: ${sug.start}â${sug.end}` : `â¢ ${b.title}: no free slot (consider Saturday)`;
      });
      return `Missed yesterday:\n${suggestions.join('\n')}`;
    },

    whatToSkip() {
      // "×× ×× × ×××× ×××× ××× ××¤×××¢ ××©×××¢"
      const today    = new Date();
      const debt     = projectDebt();
      const skippable = blocksForDay(today).filter(b => {
        if (!b.replaceable || b.fixed) return false;
        if (!b.proj) return true;
        const d = debt[PROJECTS[b.proj]?.name];
        return !d || d.debt < 60;
      });
      if (!skippable.length) return 'Nothing safe to skip today â every block matters.';
      return `Safe to skip today (no weekly damage):\n${skippable.map(b=>`â¢ ${b.title} (${b.start}â${b.end})`).join('\n')}`;
    },

    whatNow(args) {
      // "×× ××¢×©××ª ×¢××©××" â energy-based planning
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
        return `You should be on: "${current.title}" until ${current.end}. Energy ${eLabel} â ${tip}`;
      }
      const best = upcoming.find(b => suitable.includes(b.type));
      if (best) {
        const debtNote = behind.length ? ` Note: you have debt on ${behind[0][0]}.` : '';
        return `Energy ${eLabel} â best move: "${best.title}" at ${best.start}.${debtNote}`;
      }
      if (behind.length) {
        const action = energy==='high' ? 'open a deep-work session' : energy==='low' ? 'do a light task on the project' : 'push as far as you can';
        return `No scheduled block right now â but you have debt on ${behind[0][0]}. Energy ${eLabel}: ${action}.`;
      }
      const freeAct = energy==='low' ? 'Take a break.' : energy==='high' ? 'Jump ahead on your schedule.' : 'Review your open tasks.';
      return `You\'re between blocks. Energy ${eLabel}: ${freeAct}`;
    },

    // ââ Modal-opening shorthands âââââââââââââââââââââââââââââââââââââââââââ
    dailyCheckIn()  { openDailyCheckIn();  return 'Opening daily check-in...'; },
    weeklyReview()  { openWeeklyReview();  return 'Opening weekly review...'; },
    openWhatNow()   { openWhatNowPanel();  return ''; },

    speakOnly(args) { return args.text || ''; },
  };

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  //  5-A. SYSTEM WRITE HELPERS â direct state mutations by JARVIS
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
      hud.toast('Notifications already enabled â', 'ok');
      speak('Push notifications are already active.');
      return;
    }
    Notification.requestPermission().then(perm => {
      if (perm === 'granted') {
        hud.toast('ð Notifications enabled!', 'ok');
        speak('Great. I\'ll now send you push notifications for reminders and briefings.');
        new Notification('JARVIS is connected ð', {
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
    // accepts: "××¢×× 10 ××§××ª", "×××¨ 09:00", "×-14:30", or Date/ISO
    if (!spec) { const t = new Date(); t.setHours(t.getHours()+1); return t; }
    if (spec instanceof Date) return spec;
    if (typeof spec === 'string') {
      const m1 = spec.match(/(\d+)\s*(××§××ª|××§×|min|minutes?)/i);
      if (m1) { const t = new Date(); t.setMinutes(t.getMinutes() + parseInt(m1[1])); return t; }
      const m2 = spec.match(/(\d+)\s*(×©×¢××ª|×©×¢×|hours?)/i);
      if (m2) { const t = new Date(); t.setHours(t.getHours() + parseInt(m2[1])); return t; }
      const m3 = spec.match(/(\d{1,2}):(\d{2})/);
      if (m3) {
        const t = new Date(); t.setHours(parseInt(m3[1]), parseInt(m3[2]), 0, 0);
        if (/×××¨/.test(spec)) t.setDate(t.getDate()+1);
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
        new Notification('JARVIS â ×ª××××¨×ª', { body: text, icon: '/favicon.ico' });
      }
      speak(`Reminder: ${text}.`);
    }, delay);
  }

  function celebrate() {
    if (typeof window.confetti === 'function') {
      try { window.confetti({ particleCount: 40, spread: 50, origin: { y: 0.7 } }); } catch (e) {}
    }
  }

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  //  6. NLU â Hebrew-first command router
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  function route(text) {
    const t = text.trim();
    if (!t) return null;
    const lower = t.toLowerCase();

    // â Navigation (Hebrew + English) â
    let m = t.match(/(?:×¤×ª×|×ª×¤×ª×|×× ×|× ××× ×|×ª×¢×××¨ ×|×ª×¨×× ××|open|go to|navigate to|show me)\s+(.+)/i);
    if (m) return { action:'navigate', args:{ where: m[1] } };

    // â Add task (Hebrew) â
    m = t.match(/(?:×××¡×£|×ª××¡××£)\s+××©×××\s+(.+?)(?:\s+××¤×¨×××§×\s+(\S+))?$/);
    if (m) return { action:'addTask', args:{ text: m[1], proj: PAGE_ALIASES[m[2]] || m[2] || null } };
    m = t.match(/^(?:×××¡×£|×ª××¡××£)\s+(.+?)\s+(?:×|××)\s*(?:××©××××ª|××××)$/);
    if (m) return { action:'addTask', args:{ text: m[1] } };
    // â Add task (English) â
    m = t.match(/^(?:add task|create task|new task)\s+(.+?)(?:\s+(?:to|for)\s+(\w+))?$/i);
    if (m) return { action:'addTask', args:{ text: m[1], proj: m[2] || null } };

    // â Complete task (Hebrew + English) â
    m = t.match(/(?:×¡××|×ª×¡××|×¡××××ª×|×××¨×ª×|×××©××)(?:\s+××ª)?\s+(.+?)(?:\s+××××©××|\s+××¡××××ª×)?$/);
    if (m) return { action:'completeTask', args:{ match: m[1] } };
    m = t.match(/^(?:done|complete|finish|mark done|mark as done)\s+(.+)/i);
    if (m) return { action:'completeTask', args:{ match: m[1] } };

    // â Add reminder (Hebrew) â
    m = t.match(/(?:×ª×××¨|×ª××××¨|×ª××××¨|××××¨)\s+(?:××\s+)?(?:×¢×\s+)?(.+?)\s+(?:××¢××\s+(.+)|×-?(\d{1,2}:\d{2})|×××¨\s+(\d{1,2}:\d{2}))/);
    if (m) {
      const when = m[2] || m[3] || (m[4] ? '×××¨ ' + m[4] : null);
      return { action:'addReminder', args:{ text: m[1], when } };
    }
    m = t.match(/(?:×ª×××¨|×ª××××¨)\s+(?:××\s+)?(.+)/);
    if (m) return { action:'addReminder', args:{ text: m[1], when: '××¢×× ×©×¢×' } };
    // â Add reminder (English) â
    m = t.match(/^remind me (?:to |about )?(.+?) (?:at|in)\s+(.+)/i);
    if (m) return { action:'addReminder', args:{ text: m[1], when: m[2] } };
    m = t.match(/^remind me (?:to |about )?(.+)/i);
    if (m) return { action:'addReminder', args:{ text: m[1], when: 'in 1 hour' } };

    // â Schedule a block: "×ª×× ××¡× X ×-Y ×¢× Z" / "schedule X from Y to Z" â
    m = t.match(/(?:×ª×× ×¡×|×ª×× ××¡×|×ª××¡××¤×|××× ×¡×|×ª××× ×)\s+(.+?)\s+(?:×-?|×â?)(\d{1,2}:\d{2}|\d{1,2})\s+(?:×¢×|â|-)\s*(\d{1,2}:\d{2}|\d{1,2})/);
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

    // â Queries (Hebrew + English) â
    if (/×× (×× × )?(××××|×¦×¨××|×¢×××)\s+(××××|××¢×©××ª ××××)/.test(t) || /×× (××© ×× )?××××/.test(t)
        || /^(?:what(?:'s| is) (?:on )?(?:my )?(?:today|today's|schedule today)|what do i have today)/i.test(lower))
      return { action:'queryDue', args:{ scope:'today' } };
    if (/×× (×× × )?××××\s+××©×××¢/.test(t) || /×× (××© ×× )?××©×××¢/.test(t)
        || /^(?:what(?:'s| is) (?:on )?(?:my )?(?:week|this week|weekly))/i.test(lower))
      return { action:'queryDue', args:{ scope:'week' } };

    // â Briefings (Hebrew + English) â
    if (/(×ª××××¨|×ª×§×¦××¨|×¡××××) (?:×©× )?(?:×)?(?:×××§×¨|×××)/.test(t) || /×××§×¨ ×××/.test(t)
        || /^(?:morning brief|good morning|morning update|start my day)/i.test(lower))
      return { action:'morningBrief', args:{} };
    if (/(×¡××××|×ª×§×¦××¨)\s+(×?×¢×¨×|×?×××)/.test(t) || /×××× ×××/.test(t)
        || /^(?:evening brief|good night|end of day|daily summary)/i.test(lower))
      return { action:'eveningBrief', args:{} };

    // â Schedule / Debt (Hebrew + English) â
    if (/(×××|×××××)\s+(×¤×¨×××§×××?|×××)/.test(t)
        || /^(?:project debt|show debt|time debt)/i.test(lower))
      return { action:'showDebt', args:{} };
    m = t.match(/(×ª×××|××¦×¢|××¦×¢× ×)?\s*(?:×××××ª|×××¢×××¨)\s+(.+?)\s+(?:××××¨|××¢××|×-?\d+)/);
    if (m) return { action:'rescheduleBlock', args:{ blockId: m[2] } };

    // ââ Advanced commands ââââââââââââââââââââââââââââââââââââââââââââââââ
    // "××××ª× ××× ×-14 ×¢× 17"
    m = t.match(/(?:××××ª×|××××ª×|××××ª×)\s+(.+?)\s+(?:×-?|×â?)(\d{1,2})(?::\d{2})?\s+(?:×¢×|â|-)\s*(\d{1,2})/);
    if (m) return { action:'activityReport', args:{ activity: m[1], fromHour: m[2], toHour: m[3] } };

    // "×¢×©××ª× 70 ××§×³ Upselles ×××§×× 120"
    m = t.match(/(?:×¢×©××ª×|×××¦×¢×ª×|××©×§×¢×ª×)\s+(\d+)\s*(?:××§[×³'××ª]?|×©×¢××ª?)\s+(?:×¢×\s+|×-?)?([\wÖ-×¿]+)/);
    if (m) {
      const rawProj = m[2].toLowerCase();
      const projKey = Object.keys(PROJECTS).find(k =>
        rawProj.includes(k) || PROJECTS[k].name.toLowerCase().includes(rawProj)
      ) || rawProj;
      const planned = parseInt((t.match(/(?:×××§××|××ª××|×-?)\s*(\d+)/)||[])[1] || '0');
      return { action:'logActualTime', args:{ proj: projKey, actualMinutes: parseInt(m[1]), plannedMinutes: planned } };
    }

    // "×ª×× × ×× ××ª ×××× ××¤× ×× ×©×¤×¡×¤×¡×ª× ××ª×××"
    if (/(?:×ª×× ×|×ª×¡××¨|×ª×¢×××¨)\s+(?:××\s+)?(?:××ª\s+)?(?:×?×××|×××©×)\s+(?:××¤×\s+)?(?:××\s+×©)?(?:×¤×¡×¤×¡×ª×|××××¦×ª×)/.test(t)
        || /(?:××\s+)?×¤×¡×¤×¡×ª×\s+××ª×××/.test(t))
      return { action:'planByMissed', args:{} };

    // "×× ×× × ×××× ×××× ××× ××¤×××¢ ××©×××¢"
    if (/(?:××|××××?)\s+(?:×× ×\s+)?(?:××××|××¤×©×¨)\s+(?:××××|×××××ª|××××ª×¨|××¤×¡×¤×¡)/.test(t)
        || /××\s+(?:××\s+)?××××\s+(?:×××××ª|××¢×©××ª)/.test(t))
      return { action:'whatToSkip', args:{} };

    // "×× ××¢×©××ª ×¢××©××"
    if (/××\s+(?:××¢×©××ª|××¢×©×|×× ×\s+×¢××©×|××××)\s+(?:×¢?××©××|×¢××©×)/.test(t)
        || /^(?:×¢×××¨\s+××\s+)?(?:××\s+)?×¢××©××\??$/.test(t)) {
      const energy = /(?:×× ×¨×××\s+)?(?:× ××××|low|×¢×××£|×¨×××¢)/.test(lower) ? 'low'
                   : /(?:×× ×¨×××\s+)?(?:×××××|high|××××§×|×××§)/.test(lower) ? 'high' : 'medium';
      return { action:'whatNow', args:{ energy } };
    }

    // "×¦×³×§-×××" / "Daily Check-in"
    if (/(?:×¦[×³']?×§[- ]?×××|check[\s-]?in|××ª××(?:×ª)?\s+×××|×ª×× ××\s+×××\s+×¢××©××)/.test(lower))
      return { action:'dailyCheckIn', args:{} };

    // "×¡×××× ×©×××¢×" / "Weekly Review"
    if (/(?:×¡××××\s+×©×××¢×|weekly\s+review|×¡××××\s+×©×××¢(?:\s+×××)?)/.test(lower))
      return { action:'weeklyReview', args:{} };

    // fallback: ask the LLM (if available)
    return { action:'llmFallback', args:{ text: t } };
  }

  async function llmFallback(text) {
    if (!window.callClaude) return null;
    var today = new Date().toLocaleDateString('he-IL');
    var tasks = '' ;
    try {
      var d = readState();
      tasks = (d.tasks||[]).filter(function(t){return !t.done;}).slice(0,8).map(function(t){return t.text;}).join(', ');
    } catch(e2){}
    var sys = 'You are JARVIS, the AI companion of Personal OS for Roei Klein.\n'+ 'Today: ' + today + '\nOpen tasks: ' + (tasks||'none') + '\n'+ 'Available tools (respond ONLY as JSON):\n'+ '  goPage(page) - navigate to: dashboard,weekly,tasks,reminders,projects,tools\n'+ '  addTask(text,priority,project) - add task; priority: low/medium/high\n'+ '  addReminder(text,minutes) - remind in N minutes\n'+ '  setBlockStatus(blockId,status) - status: completed/missed/skipped\n'+ '  speak(text) - just say something\n'+ 'Format: {\"speech\":\"...\",\"actions\":[{\"tool\":\"...\",\"args\":{}}]}\n'+ 'Speak Hebrew unless user uses English. Be concise.';
    try {
      var raw = await window.callClaude(sys + '\nUser: ' + text);
      var clean = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
      var parsed = JSON.parse(clean);
      var acts = parsed.actions || [];
      for (var i = 0; i < acts.length; i++) {
        var a = acts[i];
        try {
          if (a.tool === 'goPage' && window.goPage) window.goPage(a.args.page);
          else if (a.tool === 'addTask' && window.addTask) window.addTask(a.args.text, a.args.priority||'medium', a.args.project||'');
          else if (a.tool === 'addReminder' && window.addReminder) window.addReminder(a.args.text, a.args.minutes||5);
          else if (a.tool === 'setBlockStatus') setBlockStatus(a.args.blockId, new Date().toISOString().slice(0,10), {status:a.args.status});
          else if (a.tool === 'speak') speak(a.args.text);
        } catch(ae) { console.warn('JARVIS action failed:', ae); }
      }
      return parsed.speech || raw;
    } catch(e) {
      try { return await window.callClaude(text); } catch(e2) { return null; }
    }
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

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  //  7. VOICE â recognition + synthesis
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
    if (!recog) { speak('Speech recognition is not available in this browser.'); return; }
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
        hud.toast('Microphone access denied. Enable it in browser settings.', 'error');
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
          if (!cmd) { speak('Yes, Roei? I\'m listening.'); listeningHard = true; return; }
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
      hud.toast('××©×× ××©×ª××©: ' + e.message, 'error');
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

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  //  7-A. APPLE / FUTURISTIC THEME INJECTION
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  function injectAppleTheme() {
    if (document.getElementById('jv-apple-theme')) return;
    const s = document.createElement('style');
    s.id = 'jv-apple-theme';
    s.textContent = `
/* âââ JARVIS APPLE THEME â injected by jarvis.js âââ */
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

/* ââ Reset & body ââ */
html, body {
  background: var(--jv-bg) !important;
  color: var(--jv-text) !important;
  font-family: var(--jv-font) !important;
  -webkit-font-smoothing: antialiased !important;
}

/* ââ Scrollbar ââ */
::-webkit-scrollbar { width:5px; height:5px; }
::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-thumb { background:rgba(255,255,255,.15); border-radius:10px; }
::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,.28); }

/* ââ All card-like containers ââ */
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

/* ââ Sidebar / nav ââ */
nav, sidebar, .sidebar, .nav, .side-nav, .left-panel, .right-panel,
[class*="sidebar"], [class*="nav-"]:not(.jv-chip) {
  background: rgba(10,10,10,.92) !important;
  backdrop-filter: var(--jv-blur) !important;
  border-color: var(--jv-border) !important;
}

/* ââ Buttons ââ */
button:not(.jv-chip):not(.jv-dock button):not(#jv-lock-enter):not(#jv-lock-checkin):not(#jv-lock-skip):not(#jv-panel-close) {
  border-radius: 10px !important;
  font-family: var(--jv-font) !important;
  transition: all .18s ease !important;
}
button:not(.jv-chip):not(.jv-dock button):not(#jv-lock-enter):not(#jv-lock-checkin):not(#jv-lock-skip):not(#jv-panel-close):hover {
  filter: brightness(1.12) !important;
  transform: translateY(-1px) !important;
}

/* ââ Primary action buttons ââ */
[class*="btn-primary"], [class*="primary-btn"],
[class*="add-btn"], [class*="save-btn"],
button[class*="primary"] {
  background: var(--jv-accent2) !important;
  color: #fff !important;
  border: none !important;
  box-shadow: 0 4px 16px rgba(0,113,227,.35) !important;
}

/* ââ Inputs ââ */
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

/* ââ Headers / titles ââ */
h1,h2,h3,h4,h5,h6 { font-family: var(--jv-font) !important; font-weight:600 !important; }

/* ââ KPI / stat numbers ââ */
[class*="kpi"], [class*="stat"], [class*="metric"],
[class*="number"], [class*="count"] {
  font-weight: 700 !important;
  letter-spacing: -.5px !important;
  color: var(--jv-accent) !important;
}

/* ââ Tags / badges ââ */
[class*="tag"], [class*="badge"], [class*="chip"],
[class*="label"], [class*="pill"] {
  background: rgba(0,212,255,.12) !important;
  color: var(--jv-accent) !important;
  border: 1px solid rgba(0,212,255,.25) !important;
  border-radius: 20px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
}

/* ââ Checkboxes (task done state) ââ */
input[type="checkbox"] {
  accent-color: var(--jv-accent) !important;
}

/* ââ Tables ââ */
table { border-collapse: collapse !important; }
th { color: var(--jv-text2) !important; font-weight:500 !important; font-size:11px !important; letter-spacing:.5px !important; text-transform:uppercase !important; }
tr:hover td { background: rgba(255,255,255,.03) !important; }
td, th { border-color: var(--jv-border) !important; }

/* ââ Progress bars ââ */
progress, [class*="progress"] {
  background: rgba(255,255,255,.08) !important;
  border-radius: 4px !important;
  overflow: hidden !important;
}
progress::-webkit-progress-bar { background: rgba(255,255,255,.08) !important; }
progress::-webkit-progress-value { background: var(--jv-accent) !important; border-radius:4px !important; }

/* ââ Glowing accent dividers ââ */
hr { border-color: var(--jv-border) !important; }

/* ââ Subtle background shimmer on main content area ââ */
main, .main, .content, .main-content, [class*="main-"], [class*="-content"] {
  background: var(--jv-bg2) !important;
}

/* ââ Page sections / rows ââ */
section, .row, [class*="row-"], [class*="-row"] {
  border-color: var(--jv-border) !important;
}

/* ââ Dropdown menus ââ */
[class*="dropdown"], [class*="menu"], [class*="popover"] {
  background: rgba(28,28,30,.96) !important;
  backdrop-filter: var(--jv-blur) !important;
  border: 1px solid var(--jv-border) !important;
  border-radius: var(--jv-radius) !important;
  box-shadow: 0 20px 60px rgba(0,0,0,.6) !important;
}

/* ââ Modal overlays ââ */
[class*="modal"], [class*="dialog"], [class*="overlay"] {
  background: rgba(0,0,0,.75) !important;
  backdrop-filter: blur(8px) !important;
}
[class*="modal-content"], [class*="dialog-content"] {
  background: rgba(28,28,30,.97) !important;
  border: 1px solid var(--jv-border) !important;
  border-radius: 18px !important;
}

/* ââ Selection highlight ââ */
::selection {
  background: rgba(0,212,255,.25) !important;
  color: #fff !important;
}

/* âââ JARVIS HUD itself â update to match âââ */
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

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  //  8. HUD â visual layer
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div class="jv-status" id="jv-status">JARVIS</div>
            <button id="jv-panel-close" title="Close" style="background:none;border:none;color:#8b9bb4;cursor:pointer;font-size:16px;padding:0 0 0 8px;line-height:1;transition:color .15s" onmouseenter="this.style.color='#fff'" onmouseleave="this.style.color='#8b9bb4'">â</button>
          </div>
          <div class="jv-heard" id="jv-heard"></div>
          <div class="jv-reply" id="jv-reply">Hey Roei. I'm online. Say "Jarvis" or tap the orb to start.</div>
          <div class="jv-actions" id="jv-actions">
            <button class="jv-chip" data-cmd="×× ××© ×× ××××">ð Today</button>
            <button class="jv-chip" data-cmd="×× ××¢×©××ª ×¢××©××">â¡ What now</button>
            <button class="jv-chip" data-cmd="×× ×× × ×××× ××©×××¢">ð This week</button>
            <button class="jv-chip" data-cmd="××× ×¤×¨×××§×××">â ï¸ Debt</button>
            <button class="jv-chip" data-cmd="×¡×××× ××××§×¨">ð Morning brief</button>
          </div>
        </div>
        <div class="jv-dock" id="jv-dock">
          <button data-act="checkin">âï¸ Daily Check-In</button>
          <button data-act="whatnow">â¡ What to do now</button>
          <button data-act="brief">ð Morning Brief</button>
          <button data-act="schedule">ð Weekly Schedule</button>
          <button data-act="debt">â ï¸ Project Debt</button>
          <button data-act="review">ð Weekly Review</button>
          <button data-act="notif">ð Notifications</button>
          <button data-act="settings">âï¸ Settings</button>
          <button data-act="log">ð Execution Log</button>
        </div>
        <div class="jv-orb" id="jv-orb" title="××××¦× ×××ª â ×××¨ â¢ ××××¦× ××¨××× â ×ª×¤×¨××"></div>
      `;
      document.body.appendChild(root);

      orb     = root.querySelector('#jv-orb');
      panel   = root.querySelector('#jv-panel');
      heard   = root.querySelector('#jv-heard');
      reply   = root.querySelector('#jv-reply');
      statusEl = root.querySelector('#jv-status');
      dock    = root.querySelector('#jv-dock');

      // Click â toggle listening + show panel
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

      // Dock buttons
      dock.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => {
          dock.classList.remove('show');
          const a = b.dataset.act;
          if (a === 'checkin')  return openDailyCheckIn();
          if (a === 'whatnow')  return openWhatNowPanel();
          if (a === 'brief')    return processSpoken('×¡×××× ××××§×¨');
          if (a === 'schedule') return openScheduleModal();
          if (a === 'debt')     return processSpoken('××× ×¤×¨×××§×××');
          if (a === 'review')   return openWeeklyReview();
          if (a === 'log')      return openLogModal();
          if (a === 'settings') return openSettingsModal();
          if (a === 'notif')    return requestNotifPermission();
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
      const labels = { idle:'JARVIS', listening:'××§×©××â¦', thinking:'×××©×â¦', speaking:'××××¨â¦' };
      if (statusEl) statusEl.textContent = labels[s] || 'JARVIS';
      if (window._jvEdge) {
        if (s === 'listening' || s === 'thinking') window._jvEdge.classList.add('active');
        else window._jvEdge.classList.remove('active');
      }
    }
    function setHeard(t) { if (heard) heard.textContent = t ? 'ð ' + t : ''; if (panel) panel.classList.add('show'); }
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

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  //  9. MODALS â Schedule update, Log, Settings
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
          <button id="jv-close" style="background:transparent;color:#cfe8ff;border:none;font-size:20px;cursor:pointer">â</button>
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
    const dayName = ['×¨××©××','×©× ×','×©×××©×','×¨×××¢×','××××©×','×©××©×','×©××ª'][today.getDay()];
    const html = `
      <p style="opacity:.85;font-size:13px;margin:0 0 12px">××××, ××× ${dayName}, ${today.toLocaleDateString('he-IL')}</p>
      <div id="jv-blocks" style="display:flex;flex-direction:column;gap:8px"></div>
      <p style="opacity:.6;font-size:11px;margin-top:14px">×××¥ ×¢× ×¡××××¡ ××× ××¢×××.</p>`;
    const m = modalShell('ð ××× ×××× â ×¢×××× ××××¨', html);
    const list = m.querySelector('#jv-blocks');
    blocks.forEach(b => {
      const key = b.id + '::' + dateKey(today);
      const st  = wkData[key] || { status:'planned' };
      const row = document.createElement('div');
      row.style.cssText = `border:1px solid ${ACCENT}33;border-radius:10px;padding:10px;display:flex;justify-content:space-between;align-items:center`;
      row.innerHTML = `
        <div>
          <div style="font-weight:600">${b.title}</div>
          <div style="font-size:11px;opacity:.7">${b.start}â${b.end}</div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${['planned','completed','partial','missed','replaced'].map(s =>
            `<button data-s="${s}" style="background:${st.status===s ? ACCENT+'44' : 'transparent'};
              color:#e6f3ff;border:1px solid ${ACCENT}55;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer">
              ${ {planned:'××ª××× ×',completed:'×××¦×¢',partial:'×××§×',missed:'×××××¥',replaced:'×××××£'}[s] }</button>`
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
    modalShell('ð ×××× ×××¦××¢', `
      <p style="opacity:.7;font-size:12px;margin:0 0 10px">50 ×¤×¢××××ª ×××¨×× ××ª</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="opacity:.6">
          <th style="text-align:right;padding:4px 8px">×××</th>
          <th style="text-align:right;padding:4px 8px">×¡××</th>
          <th style="text-align:right;padding:4px 8px">×¤×¨×××</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" style="padding:10px;opacity:.6">××× ×¨×©××××ª ×¢××××.</td></tr>'}</tbody>
      </table>`);
  }

  function openSettingsModal() {
    const s = settings();
    const html = `
      <div style="display:flex;flex-direction:column;gap:10px;font-size:13px">
        <label><input type="checkbox" id="jv-voiceOn" ${s.voiceOn?'checked':''}/> ×§×× ×¤×¢××</label>
        <label><input type="checkbox" id="jv-wake" ${s.wakeWordOn?'checked':''}/> ××××ª ××¤×¢×× (××³×¨××××¡)</label>
        <label>××××¨××ª ×××××¨: <input type="range" id="jv-rate" min="0.8" max="1.4" step="0.05" value="${s.rate}"/></label>
        <label>×ª×§×¦××¨ ×××§×¨ ×: <input type="time" id="jv-am" value="${s.morningBriefAt}"/></label>
        <label>×ª×§×¦××¨ ×¢×¨× ×: <input type="time" id="jv-pm" value="${s.eveningBriefAt}"/></label>
        <button id="jv-save" style="background:${ACCENT};color:#001828;border:none;border-radius:8px;
          padding:8px 14px;font-weight:600;cursor:pointer;margin-top:8px">×©×××¨</button>
        <button id="jv-test" style="background:transparent;color:#cfe8ff;border:1px solid ${ACCENT}55;
          border-radius:8px;padding:8px 14px;cursor:pointer">××××§×ª ×§××</button>
      </div>`;
    const m = modalShell('âï¸ ××××¨××ª JARVIS', html);
    m.querySelector('#jv-save').onclick = () => {
      updateSettings({
        voiceOn:       m.querySelector('#jv-voiceOn').checked,
        wakeWordOn:    m.querySelector('#jv-wake').checked,
        rate:          parseFloat(m.querySelector('#jv-rate').value),
        morningBriefAt:m.querySelector('#jv-am').value,
        eveningBriefAt:m.querySelector('#jv-pm').value,
      });
      hud.toast('××××¨××ª × ×©××¨×', 'ok');
      m.remove();
    };
    m.querySelector('#jv-test').onclick = () => speak('××××§×ª ××¢×¨××ª. ×©×××¢ ×××ª×, ×¨×××?');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // 10. PROJECT DEBT WIDGET (injects into dashboard if there's a spot)
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
        <strong style="color:${ACCENT}">â ï¸ ××× ×¤×¨×××§××× â ××©×××¢</strong>
        <button id="jv-debt-close" style="background:transparent;color:#cfe8ff;border:none;cursor:pointer">â</button>
      </div>
      ${entries.map(([p,o]) => {
        const ratio = o.planned ? Math.min(100, Math.round((o.actual/o.planned)*100)) : 0;
        return `<div style="margin:6px 0">
          <div style="display:flex;justify-content:space-between">
            <span>${p}</span>
            <span style="opacity:.7">${Math.round(o.actual/60)}/${Math.round(o.planned/60)} ×©×³ â ${ratio}%</span>
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

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // 11. BRIEFINGS â cron-style timers
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // 12-A. LOCK / DAILY GREETING SCREEN
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  function openLockScreen() {
    const today  = new Date();
    const dKey   = dateKey(today);
    // Show once per session (every fresh page load), not once per day
    if (sessionStorage.getItem('jv_locked_this_session')) return;
    sessionStorage.setItem('jv_locked_this_session', '1');

    const dayName = ['×¨××©××','×©× ×','×©×××©×','×¨×××¢×','××××©×','×©××©×','×©××ª'][today.getDay()];
    const greet   = today.getHours() < 12 ? '×××§×¨ ×××' : today.getHours() < 17 ? '×××"×¦ ×××' : '×¢×¨× ×××';
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
        <div style="font-size:15px;opacity:.65;margin-bottom:24px">${greet}, ×¨××× &nbsp;â¢&nbsp; ××× ${dayName}, ${today.toLocaleDateString('he-IL')}</div>

        <div style="background:#0a1828;border:1px solid ${ACCENT}44;border-radius:12px;padding:14px 16px;margin-bottom:14px;text-align:right">
          <div style="font-size:11px;color:${ACCENT};margin-bottom:8px;letter-spacing:.5px;text-transform:uppercase">ð ×××× ×©×× ××××</div>
          ${blocks.length ? blocks.map(b => `
            <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px;
              border-bottom:1px solid ${ACCENT}11">
              <span>${b.title}</span>
              <span style="opacity:.55">${b.start}â${b.end}</span>
            </div>`).join('') : '<div style="opacity:.5;font-size:13px;padding:4px 0">××× ××××§×× ×××××¨×× ×××××.</div>'}
        </div>

        ${behind.length ? `
        <div style="background:rgba(255,77,109,.06);border:1px solid ${ACCENT_BAD}44;border-radius:10px;
          padding:12px 14px;margin-bottom:14px;text-align:right">
          <div style="color:${ACCENT_BAD};font-size:11px;margin-bottom:6px">â ï¸ ××× ×¤×¨×××§×××</div>
          ${behind.map(([p,o]) => `<div style="font-size:12px;opacity:.85">${p}: ${Math.round(o.debt/60*10)/10} ×©×¢××ª</div>`).join('')}
        </div>` : `
        <div style="background:rgba(66,230,149,.05);border:1px solid ${ACCENT_OK}44;border-radius:10px;
          padding:10px 14px;margin-bottom:14px;font-size:13px;color:${ACCENT_OK}">
          â ××× ××× ×¤×¨×××§××× â ×× ×××××!
        </div>`}

        <button id="jv-lock-enter" style="background:${ACCENT};color:#001828;border:none;border-radius:24px;
          padding:13px 44px;font-size:16px;font-weight:700;cursor:pointer;letter-spacing:.5px;
          box-shadow:0 0 32px ${ACCENT}66;transition:transform .15s">
          Let's go ð
        </button>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <button id="jv-lock-checkin" style="background:transparent;color:${ACCENT};border:1px solid ${ACCENT}55;
            border-radius:18px;padding:8px 18px;font-size:12px;cursor:pointer">âï¸ Daily Check-In</button>
          <button id="jv-lock-skip" style="background:transparent;color:#8b9bb4;border:1px solid #8b9bb444;
            border-radius:18px;padding:8px 18px;font-size:12px;cursor:pointer">Skip â</button>
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
    wrap.querySelector('#jv-lock-enter').onclick = () => { dismiss(); speak(`${greet}, Roei. Let's get to work.`); };
    wrap.querySelector('#jv-lock-checkin').onclick = () => { dismiss(); setTimeout(openDailyCheckIn, 350); };
    wrap.querySelector('#jv-lock-skip').onclick    = dismiss;
  }

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // 12-B. DAILY CHECK-IN MODAL
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  function openDailyCheckIn() {
    const today     = new Date();
    const isEvening = today.getHours() >= 17;
    const suffix    = isEvening ? '_pm' : '_am';
    const ciKey     = 'jv_checkin_' + dateKey(today) + suffix;
    const existing  = readLocal(ciKey, {});
    const title     = isEvening ? 'ð ×¦×³×§-××× ×¢×¨×' : 'âï¸ ×¦×³×§-××× ×××§×¨';

    let html;
    if (isEvening) {
      // ââ EVENING ââ what happened
      html = `
        <div style="display:flex;flex-direction:column;gap:12px;font-size:13px">
          <div style="color:${ACCENT};font-size:11px;opacity:.75">${today.toLocaleDateString('he-IL')} â ×¡×××× ×××</div>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">â ×× ×××©×× ××××?</span>
            <textarea id="ci-done" rows="2" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
              border-radius:8px;padding:8px;font-size:13px;resize:none;direction:rtl"
              placeholder="×××©×××, ××©××××ª ×©× ×¡××¨×...">${existing.done || ''}</textarea>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">â ×× ×××××¥ / ×× ××¡×ª×××?</span>
            <textarea id="ci-missed" rows="2" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
              border-radius:8px;padding:8px;font-size:13px;resize:none;direction:rtl"
              placeholder="××××§×× ×©×× ×××¦×¢×...">${existing.missed || ''}</textarea>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">ð¦ ×× ×¢×××¨ ××××¨?</span>
            <textarea id="ci-move" rows="2" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
              border-radius:8px;padding:8px;font-size:13px;resize:none;direction:rtl"
              placeholder="××©××××ª ×©× ××××ª ××××¨...">${existing.move || ''}</textarea>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">â¡ ×¨××ª ×× ×¨××× ×¦×¤××× ×××¨</span>
            <div style="display:flex;gap:8px">
              <button data-e="low"    class="ci-e-btn" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;
                background:${existing.energyTmr==='low'?ACCENT+'33':'#0f1e36'};
                color:${existing.energyTmr==='low'?ACCENT:'#cfe8ff'};border:1px solid ${ACCENT}33">ð´ × ××××</button>
              <button data-e="medium" class="ci-e-btn" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;
                background:${!existing.energyTmr||existing.energyTmr==='medium'?ACCENT+'33':'#0f1e36'};
                color:${!existing.energyTmr||existing.energyTmr==='medium'?ACCENT:'#cfe8ff'};border:1px solid ${ACCENT}33">ð ××× ×× ××ª</button>
              <button data-e="high"   class="ci-e-btn" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;
                background:${existing.energyTmr==='high'?ACCENT+'33':'#0f1e36'};
                color:${existing.energyTmr==='high'?ACCENT:'#cfe8ff'};border:1px solid ${ACCENT}33">â¡ ×××××</button>
            </div>
          </label>
          <input type="hidden" id="ci-energy-val" value="${existing.energyTmr || 'medium'}"/>
          <button id="ci-save" style="background:${ACCENT};color:#001828;border:none;border-radius:8px;
            padding:10px;font-weight:700;cursor:pointer;margin-top:4px">×©×××¨ ×¡×××× â</button>
        </div>`;
    } else {
      // ââ MORNING ââ what's planned
      const topBlocks = blocksForDay(today).filter(b => b.type === 'deep_work' || (b.proj && b.type !== 'food' && b.type !== 'reminder')).slice(0, 4);
      html = `
        <div style="display:flex;flex-direction:column;gap:12px;font-size:13px">
          <div style="color:${ACCENT};font-size:11px;opacity:.75">${today.toLocaleDateString('he-IL')} â ×ª×× ×× ×××</div>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">ð¯ ×××©××× ×××¨××××ª ×©×× ××××</span>
            <input id="ci-main" type="text" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
              border-radius:8px;padding:8px;font-size:13px;direction:rtl"
              placeholder="××××¨ ×××× ××× ××©×× ××××..." value="${existing.main || ''}"/>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">ð ××©××× ×©× ××× ××ª (×× ×××× ×××)</span>
            <input id="ci-sec" type="text" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
              border-radius:8px;padding:8px;font-size:13px;direction:rtl"
              placeholder="××©××× ××©××× × ××¡×¤×ª..." value="${existing.secondary || ''}"/>
          </label>
          <label style="display:flex;flex-direction:column;gap:4px">
            <span style="opacity:.8">â¡ ×¨××ª ×× ×¨××× ××××</span>
            <div style="display:flex;gap:8px">
              <button data-e="low"    class="ci-e-btn" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;
                background:${existing.energy==='low'?ACCENT+'33':'#0f1e36'};
                color:${existing.energy==='low'?ACCENT:'#cfe8ff'};border:1px solid ${ACCENT}33">ð´ × ××××</button>
              <button data-e="medium" class="ci-e-btn" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;
                background:${!existing.energy||existing.energy==='medium'?ACCENT+'33':'#0f1e36'};
                color:${!existing.energy||existing.energy==='medium'?ACCENT:'#cfe8ff'};border:1px solid ${ACCENT}33">ð ××× ×× ××ª</button>
              <button data-e="high"   class="ci-e-btn" style="flex:1;padding:8px;border-radius:8px;cursor:pointer;font-size:12px;
                background:${existing.energy==='high'?ACCENT+'33':'#0f1e36'};
                color:${existing.energy==='high'?ACCENT:'#cfe8ff'};border:1px solid ${ACCENT}33">â¡ ×××××</button>
            </div>
          </label>
          <input type="hidden" id="ci-energy-val" value="${existing.energy || 'medium'}"/>
          ${topBlocks.length ? `
          <div style="background:#0f1e36;border-radius:8px;padding:10px">
            <div style="font-size:11px;opacity:.65;margin-bottom:6px">ð ×××××§×× ×©×× ××××:</div>
            ${topBlocks.map(b=>`<div style="font-size:12px;opacity:.75;padding:3px 0">${b.start} â ${b.title}</div>`).join('')}
          </div>` : ''}
          <button id="ci-save" style="background:${ACCENT};color:#001828;border:none;border-radius:8px;
            padding:10px;font-weight:700;cursor:pointer;margin-top:4px">×©×××¨ ×ª×× ×× â</button>
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
        replyText = `×¡×××× ×××× × ×©××¨. ${data.move ? '×××¨: ' + data.move.split('\n')[0] + '.' : '×××× ×××, ×¨×××.'}`;
      } else {
        data = {
          main:      m.querySelector('#ci-main').value,
          secondary: m.querySelector('#ci-sec').value,
          energy,
          ts:        Date.now(),
        };
        const eTip = energy === 'low' ? '×ª×ª××§× ××××¨×× ××××× ××× ××××.'
                   : energy === 'high' ? '×ª× ×¦× ××ª ×××××¡×ª! ××× × ×ª×§××£ ××ª ××××.'
                   : '××× ×¨××× â ×ª×ª×§×× ××©×× ×©××.';
        replyText = data.main
          ? `×§××××ª×. ×××©××× ×××¨××××ª: "${data.main}". ${eTip}`
          : eTip;
        // Add as a task to the app if possible
        if (data.main && typeof window.addTask === 'function') {
          try { window.addTask({ text: data.main, priority:'high', tags:['××××'] }); } catch(e) {}
        }
      }
      writeLocal(ciKey, data);
      logEvent(isEvening ? 'checkin.pm' : 'checkin.am', data);
      hud.setReply(replyText);
      speak(replyText);
      hud.toast(isEvening ? '×¡×××× ×¢×¨× × ×©××¨ â' : '×ª×× ×× ×××§×¨ × ×©××¨ â', 'ok');
      m.remove();
    };
  }

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // 12-C. WEEKLY REVIEW MODAL
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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
          <div style="color:${ACCENT};font-size:11px;margin-bottom:10px;letter-spacing:.5px">ð ×©×××¢ ${wk} â ×¡××××</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;text-align:center">
            <div style="background:#0a1828;border-radius:8px;padding:8px">
              <div style="font-size:22px;color:${ACCENT_OK}">${tally.completed}</div>
              <div style="font-size:10px;opacity:.6">×××¦×¢</div>
            </div>
            <div style="background:#0a1828;border-radius:8px;padding:8px">
              <div style="font-size:22px;color:${ACCENT_BAD}">${tally.missed}</div>
              <div style="font-size:10px;opacity:.6">×××××¥</div>
            </div>
            <div style="background:#0a1828;border-radius:8px;padding:8px">
              <div style="font-size:22px;color:${ACCENT_WARM}">${tally.partial}</div>
              <div style="font-size:10px;opacity:.6">×××§×</div>
            </div>
            <div style="background:#0a1828;border-radius:8px;padding:8px">
              <div style="font-size:22px;color:#8b9bb4">${tally.replaced}</div>
              <div style="font-size:10px;opacity:.6">×××××£</div>
            </div>
          </div>
          ${total ? `
          <div style="margin-top:10px">
            <div style="display:flex;justify-content:space-between;font-size:11px;opacity:.7;margin-bottom:4px">
              <span>×××¦××¢ ××××</span><span>${pct}%</span>
            </div>
            <div style="background:#0a1828;height:6px;border-radius:3px;overflow:hidden">
              <div style="background:${pct<50?ACCENT_BAD:pct<80?ACCENT_WARM:ACCENT_OK};height:100%;width:${pct}%;transition:.4s"></div>
            </div>
          </div>` : ''}
        </div>

        ${behind.length ? `
        <div style="background:rgba(255,77,109,.05);border:1px solid ${ACCENT_BAD}33;border-radius:10px;padding:12px">
          <div style="color:${ACCENT_BAD};font-size:11px;margin-bottom:8px">â ï¸ ×¤×¨×××§××× ×××××¨×</div>
          ${behind.map(([p,o])=>`
            <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px">
              <span>${p}</span>
              <span style="color:${ACCENT_BAD}">${Math.round(o.actual/60*10)/10}/${Math.round(o.planned/60*10)/10} ×©×³</span>
            </div>`).join('')}
        </div>` : ''}

        ${ontrack.length ? `
        <div style="background:rgba(66,230,149,.04);border:1px solid ${ACCENT_OK}33;border-radius:10px;padding:10px">
          <div style="color:${ACCENT_OK};font-size:11px;margin-bottom:6px">â ×¤×¨×××§××× ××§×¦× ×××</div>
          <div style="font-size:12px;opacity:.8">${ontrack.map(([p])=>p).join(' Â· ')}</div>
        </div>` : ''}

        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="opacity:.8">ð ××××× ×©× ××©×××¢ (×××©× ×××)</span>
          <input id="wr-win" type="text" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
            border-radius:8px;padding:8px;font-size:13px;direction:rtl"
            placeholder="××××¨ ××× ××× ×©××©××ª ××©×××¢..." value="${existing.win || ''}"/>
        </label>

        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="opacity:.8">ð¯ ×¢×××¤××ª ×¨××©××ª ×©×××¢ ×××</span>
          <input id="wr-next" type="text" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
            border-radius:8px;padding:8px;font-size:13px;direction:rtl"
            placeholder="×× ××××¨ ××× ××©×× ××©×××¢ ×××?" value="${existing.nextPriority || ''}"/>
        </label>

        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="opacity:.8">ð¦ ×× ×××¢×××¨ ××©×××¢ ×××?</span>
          <textarea id="wr-move" rows="2" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
            border-radius:8px;padding:8px;font-size:13px;resize:none;direction:rtl"
            placeholder="××©××××ª / ××××§×× ×©×× ××¡×¤×§×ª...">${existing.move || ''}</textarea>
        </label>

        <label style="display:flex;flex-direction:column;gap:4px">
          <span style="opacity:.8">âï¸ ×× ××©× ××ª / ××¦××¦× ××××?</span>
          <textarea id="wr-reduce" rows="2" style="background:#0f1e36;color:#e6f3ff;border:1px solid ${ACCENT}33;
            border-radius:8px;padding:8px;font-size:13px;resize:none;direction:rtl"
            placeholder="×× ×× ×¢×× ×××× ××©×××¢...">${existing.reduce || ''}</textarea>
        </label>

        <button id="wr-save" style="background:${ACCENT};color:#001828;border:none;border-radius:8px;
          padding:10px;font-weight:700;cursor:pointer">×©×××¨ ×¡×××× ×©×××¢× â</button>
      </div>`;

    const m = modalShell('ð ×¡×××× ×©×××¢× â Weekly Review', html);
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
        ? `×¡×××× ×©×××¢× × ×©××¨. ×¢×××¤××ª ×©×××¢ ×××: "${data.nextPriority}". ${data.win ? '×× ××××× ×¢× ' + data.win + '!' : '×©×××¢ ×××!'}`
        : '×¡×××× ×©×××¢× × ×©××¨. ×©×××¢ ×××, ×¨×××!';
      speak(reply); hud.toast('×¡×××× ×©×××¢× × ×©××¨ â', 'ok'); m.remove();
    };
  }

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // 12-D. "×× ××¢×©××ª ×¢××©××" â ENERGY PANEL
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  function openWhatNowPanel() {
    const html = `
      <div style="display:flex;flex-direction:column;gap:14px;font-size:13px">
        <p style="opacity:.8;margin:0;font-size:13px">×× ×¨××ª ××× ×¨××× ×©×× ××¨××¢ ××?</p>
        <div style="display:flex;gap:8px">
          <button data-e="low" class="wn-btn" style="flex:1;background:#0f1e36;color:#cfe8ff;
            border:1px solid ${ACCENT}33;border-radius:10px;padding:12px 6px;cursor:pointer;font-size:13px">
            ð´<br/><span style="font-size:11px;opacity:.7">× ××××</span>
          </button>
          <button data-e="medium" class="wn-btn" style="flex:1;background:#0f1e36;color:#cfe8ff;
            border:1px solid ${ACCENT}33;border-radius:10px;padding:12px 6px;cursor:pointer;font-size:13px">
            ð<br/><span style="font-size:11px;opacity:.7">××× ×× ××ª</span>
          </button>
          <button data-e="high" class="wn-btn" style="flex:1;background:${ACCENT}22;color:${ACCENT};
            border:1px solid ${ACCENT};border-radius:10px;padding:12px 6px;cursor:pointer;font-size:13px">
            â¡<br/><span style="font-size:11px;opacity:.9">×××××</span>
          </button>
        </div>
        <div id="wn-result" style="min-height:56px;padding:12px;background:#0f1e36;border-radius:8px;
          color:#8b9bb4;font-size:13px;line-height:1.5;text-align:right">
          ×××¨ ×¨××ª ×× ×¨×××...
        </div>
        <div id="wn-debt" style="display:none;padding:10px;background:rgba(255,77,109,.06);
          border:1px solid ${ACCENT_BAD}33;border-radius:8px;font-size:12px;text-align:right"></div>
      </div>`;

    const m = modalShell('â¡ ×× ××¢×©××ª ×¢××©××?', html);
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
          debtEl.innerHTML = `<strong style="color:${ACCENT_WARM}">â ï¸ ××× ×¤×¨×××§×××:</strong> ` +
            behind.map(([p,o]) => `${p}: ${Math.round(o.debt/60*10)/10}×©×³`).join(' Â· ');
        }
        speak(result);
      };
    });
    // Auto-click medium as default
    m.querySelector('[data-e="medium"]').click();
  }

  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // 12. BOOT
  // ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
  // === ACCOUNT SYSTEM ===
  var ACCOUNTS_KEY = 'jv_accounts';
  var SESSION_USER = 'jv_session_user';
  function hashPass(p){var h=5381;for(var i=0;i<p.length;i++)h=((h<<5)+h)^p.charCodeAt(i);return(h>>>0).toString(36);}
  function getAccounts(){return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)||'{}');}
  function getCurrentUser(){return sessionStorage.getItem(SESSION_USER);}
  function installAccountProxy(username){
    if(Storage.prototype._jvProxied)return;
    var UK='pos3_u_'+username;
    var ex=localStorage.getItem('pos3');
    if(ex&&!localStorage.getItem(UK))localStorage.setItem(UK,ex);
    var g=Storage.prototype.getItem,s=Storage.prototype.setItem,r=Storage.prototype.removeItem;
    Storage.prototype._jvProxied=true;
    Storage.prototype.getItem=function(k){return g.call(this,k==='pos3'?UK:k);};
    Storage.prototype.setItem=function(k,v){return s.call(this,k==='pos3'?UK:k,v);};
    Storage.prototype.removeItem=function(k){return r.call(this,k==='pos3'?UK:k);};
  }
  function loginUser(u,pw){var a=getAccounts(),k=u.toLowerCase().trim();if(!a[k]||a[k]!==hashPass(pw))return false;sessionStorage.setItem(SESSION_USER,k);installAccountProxy(k);return true;}
  function registerUser(u,pw){var a=getAccounts(),k=u.toLowerCase().trim();if(!k)return false;a[k]=hashPass(pw);localStorage.setItem(ACCOUNTS_KEY,JSON.stringify(a));sessionStorage.setItem(SESSION_USER,k);installAccountProxy(k);return true;}
  function logoutUser(){sessionStorage.removeItem(SESSION_USER);sessionStorage.removeItem('jv_locked_this_session');Storage.prototype._jvProxied=false;location.reload();}

  var GOOGLE_CLIENT_ID='REPLACE_WITH_YOUR_GOOGLE_CLIENT_ID';
  function initGoogleAuth(onSuccess){
    if(!GOOGLE_CLIENT_ID||GOOGLE_CLIENT_ID.indexOf('REPLACE')===0)return;
    var s=document.createElement('script');
    s.src='https://accounts.google.com/gsi/client';
    s.onload=function(){
      if(!window.google||!google.accounts)return;
      google.accounts.id.initialize({
        client_id:GOOGLE_CLIENT_ID,
        callback:function(r){handleGoogleCredential(r,onSuccess);}
      });
      var el=document.getElementById('jv-google-btn');
      if(el)google.accounts.id.renderButton(el,{theme:'filled_black',size:'large',text:'signin_with',shape:'pill',width:280});
    };
    document.head.appendChild(s);
  }
  function handleGoogleCredential(r,onSuccess){
    try{
      var b=r.credential.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      while(b.length%4)b+='=';
      var p=JSON.parse(atob(b));
      var k=p.email.toLowerCase().trim();
      var a=getAccounts();
      if(!a[k]){a[k]='google:'+p.sub;localStorage.setItem(ACCOUNTS_KEY,JSON.stringify(a));}
      sessionStorage.setItem(SESSION_USER,k);
      sessionStorage.setItem('jv_google_user','1');
      installAccountProxy(k);
      var el=document.getElementById('jv-login');if(el)el.remove();
      if(onSuccess)onSuccess();
    }catch(e){console.warn('JARVIS Google auth:',e);}
  }
  function openLoginScreen(onSuccess){
    var o=document.createElement('div');o.id='jv-login';
    o.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,10,20,0.97);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:-apple-system,sans-serif;';
    o.innerHTML='<div style="background:#0a1628;border:1px solid #00d4ff44;border-radius:16px;padding:40px;width:340px;color:#e0f0ff;"><div style="text-align:center;margin-bottom:24px;"><div style="font-size:36px;color:#00d4ff;font-weight:700;letter-spacing:3px;">JARVIS</div><div style="font-size:12px;color:#7fb3d0;margin-top:4px;">Personal OS Access</div></div><div id="jv-lmsg" style="color:#ff6b6b;font-size:12px;text-align:center;min-height:16px;margin-bottom:8px;"></div><input id="jv-luser" placeholder="Username" style="width:100%;padding:10px 12px;margin-bottom:12px;background:#0d1f35;border:1px solid #00d4ff44;border-radius:8px;color:#e0f0ff;font-size:14px;box-sizing:border-box;outline:none;" /><input id="jv-lpass" type="password" placeholder="Password" style="width:100%;padding:10px 12px;margin-bottom:20px;background:#0d1f35;border:1px solid #00d4ff44;border-radius:8px;color:#e0f0ff;font-size:14px;box-sizing:border-box;outline:none;" /><button id="jv-lbtn" style="width:100%;padding:11px;background:linear-gradient(135deg,#00d4ff,#0066cc);border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:10px;">Sign In</button><button id="jv-rbtn" style="width:100%;padding:11px;background:transparent;border:1px solid #00d4ff44;border-radius:8px;color:#7fb3d0;font-size:13px;cursor:pointer;">Create Account</button><div style="margin:20px 0 8px;text-align:center;color:#4a6070;font-size:12px">── or ──</div><div id="jv-google-btn" style="display:flex;justify-content:center;min-height:48px"></div></div>';
    document.body.appendChild(o);
    initGoogleAuth(onSuccess);
    var msg=document.getElementById('jv-lmsg');
    var uIn=document.getElementById('jv-luser');
    var pIn=document.getElementById('jv-lpass');
    document.getElementById('jv-lbtn').onclick=function(){
      var u=uIn.value.trim(),p=pIn.value;
      if(!u||!p){msg.textContent='Enter username and password';return;}
      if(loginUser(u,p)){o.remove();onSuccess();}
      else{msg.textContent='Invalid credentials';pIn.value='';}
    };
    document.getElementById('jv-rbtn').onclick=function(){
      var u=uIn.value.trim(),p=pIn.value;
      if(!u||!p){msg.textContent='Enter username and password';return;}
      var a=getAccounts();if(a[u.toLowerCase()]){msg.textContent='Username taken';return;}
      registerUser(u,p);o.remove();onSuccess();
    };
    pIn.onkeydown=function(e){if(e.key==='Enter')document.getElementById('jv-lbtn').onclick();};
    setTimeout(function(){uIn.focus();},100);
  }

  function boot() {
    injectAppleTheme();
    var doInit = function() {
      var user = getCurrentUser();
      if (user) installAccountProxy(user);
      hud.mount();
      bindRecogHandlers();
      setupBriefings();
      setTimeout(renderDebtWidget, 1500);
      window.JARVIS = {
        version: VERSION,
        handle: handle,
        route: route,
        speak: speak,
        listen: function(){ _recogStarted=true; if(recog) recog.start(); },
        stop: function(){ _recogStarted=false; if(recog) recog.abort(); },
        logoutUser: logoutUser,
        getCurrentUser: getCurrentUser,
        writeScheduleBlock: writeScheduleBlock
      };
      setTimeout(openLockScreen, 900);
    };
    if (getCurrentUser()) { doInit(); }
    else { openLoginScreen(function(){ doInit(); }); }
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
      if (e.error === 'not-allowed') hud.toast('Microphone access denied. Enable in browser settings.', 'error');
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

/* ============================================================================
 * INTEGRATION INSTRUCTIONS â how to add JARVIS to your Personal OS
 * ============================================================================
 *
 * STEP 1 â Upload jarvis.js to your project root
 *   Place this file at the root of your GitHub repo (next to index.html).
 *
 * STEP 2 â Add ONE line to index.html
 *   Open index.html in your editor. Find the closing </body> tag and add:
 *
 *     <script src="/jarvis.js" defer></script>
 *
 *   It must come AFTER all other <script> tags so JARVIS can hook into
 *   the existing window.* functions (addTask, goPage, callClaude, etc.)
 *
 * STEP 3 â Commit and push to GitHub â Vercel auto-deploys
 *
 *   git add jarvis.js index.html
 *   git commit -m "feat: add JARVIS AI companion module v1.0"
 *   git push
 *
 * STEP 4 â Verify
 *   Open https://personal-os-coral-tau.vercel.app/
 *   You should see the blue arc-reactor orb in the bottom-right corner.
 *   Say "×'×¨××××¡, ×× ××××" or click the orb.
 *
 * ââ localStorage keys used by JARVIS (all prefixed pos3_jarvis_) ââââââââââ
 *   pos3_jarvis_schedule   â weekly block schedule + status log
 *   pos3_jarvis_log        â execution log (last 500 events)
 *   pos3_jarvis_settings   â voice, rate, briefing times
 *   pos3_jarvis_persona    â reserved for persona customisation
 *   jv_last_lock           â date of last lock-screen dismissal
 *   jv_last_am / jv_last_pm â briefing triggers
 *   jv_checkin_YYYY-MM-DD_am/pm â daily check-in data
 *   jv_weeklyreview_YYYY-W## â weekly review data
 *
 * ââ Public API (window.JARVIS.*) ââââââââââââââââââââââââââââââââââââââââââ
 *   .handle(text)         â process any Hebrew command string
 *   .speak(text)          â text-to-speech
 *   .listen()             â start voice recognition
 *   .brief()              â morning briefing
 *   .debt()               â project debt report
 *   .whatNow('high')      â energy-based recommendation (low/medium/high)
 *   .whatSkip()           â safe-to-skip blocks today
 *   .planDay()            â plan today from yesterday's misses
 *   .logTime({proj, actualMinutes, plannedMinutes})
 *   .activity({activity, fromHour, toHour})
 *   .openCheckIn()        â daily check-in modal
 *   .openWeeklyReview()   â weekly review modal
 *   .openWhatNow()        â energy panel
 *   .openLock()           â daily lock/greeting screen
 *   .openSchedule()       â quick-update schedule modal
 *   .openSettings()       â settings modal
 *
 * ââ Voice commands (Hebrew) âââââââââââââââââââââââââââââââââââââââââââââââ
 *   "×'×¨××××¡, ×× ××© ×× ××××"
 *   "×'×¨××××¡, ×× ××¢×©××ª ×¢××©××"
 *   "××××ª× ××× ×-14 ×¢× 17 ×××§×× ×××××"
 *   "×¢×©××ª× 70 ××§×³ Upselles ×××§×× 120"
 *   "×ª×× × ×× ××ª ×××× ××¤× ×× ×©×¤×¡×¤×¡×ª× ××ª×××"
 *   "×× ×× × ×××× ×××× ××× ××¤×××¢ ××©×××¢"
 *   "×××¡×£ ××©××× [×©×] ××¤×¨×××§× [×¤×¨×××§×]"
 *   "×ª×××¨ ×× ×¢× [××©×××] ××¢×× [×××]"
 *   "××× ×¤×¨×××§×××"
 *   "×¦×³×§-×××"
 *   "×¡×××× ×©×××¢×"
 *
 * ============================================================================ */
