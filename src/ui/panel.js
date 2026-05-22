// ============================================================
// DeepSeek Tool Agent v2.5 — Panel UI (Chromium-native styling)
// Design tokens from chromium-ui-react (--cr-* variables)
// Layout: dual-column (Tools&Skills | Live Logs) + bottom bar
// Pure vanilla JS — no framework dependency
// NOTE: agentTools/agentSkills/executionHistory 在 state.js 中声明
// ============================================================

var agentPersonality = null;
var agentCustomSkills = [];
var quickActions = [];
var logLevelFilter = 'all';
var autoScroll = true;
var petDragging = false;
var petOffsetX = 0;
var petOffsetY = 0;
var petDragStartX = 0;
var petDragStartY = 0;
var panelVisible = false;

// ============================================================
// CSS — Chromium design tokens (--cr-*) + component styles
// ============================================================
function injectPanelCSS() {
  var s = document.getElementById('__ds-agent-css');
  if (s) return;
  s = document.createElement('style');
  s.id = '__ds-agent-css';
  s.textContent = [
    '/* ===== Chromium Design Tokens ===== */',
    ':root {',
    '  --cr-fallback-color-primary:#1a73e8;',
    '  --cr-fallback-color-on-primary:#fff;',
    '  --cr-fallback-color-surface:#fff;',
    '  --cr-fallback-color-surface-1:#f8f9fa;',
    '  --cr-fallback-color-surface-variant:#eee;',
    '  --cr-fallback-color-on-surface:#202124;',
    '  --cr-fallback-color-on-surface-subtle:#5f6368;',
    '  --cr-fallback-color-outline:#dadce0;',
    '  --cr-fallback-color-error:#d93025;',
    '  --cr-fallback-color-disabled-background:#f1f3f4;',
    '  --cr-fallback-color-disabled-foreground:#bdc1c6;',
    '  --google-blue-500:#4285f4;',
    '  --google-green-600:#1e8e3e;',
    '  --google-red-600:#d93025;',
    '  --google-yellow-400:#fcc934;',
    '  --google-grey-500:#9aa0a6;',
    '  --cr-space-1:4px;--cr-space-2:8px;--cr-space-3:12px;',
    '  --cr-space-4:16px;--cr-space-5:20px;--cr-space-6:24px;',
    '  --cr-space-8:32px;--cr-space-10:40px;',
    '  --cr-radius-xs:2px;--cr-radius-sm:4px;--cr-radius-md:8px;',
    '  --cr-radius-lg:16px;--cr-radius-xl:24px;--cr-radius-full:100px;',
    '  --cr-font-family:"Roboto","Segoe UI",system-ui,-apple-system,sans-serif;',
    '  --cr-font-size-xs:11px;--cr-font-size-sm:12px;--cr-font-size-md:13px;',
    '  --cr-font-size-base:14px;--cr-font-size-lg:16px;--cr-font-size-xl:20px;',
    '  --cr-elevation-1:0 1px 2px rgba(60,64,67,.3),0 1px 3px 1px rgba(60,64,67,.15);',
    '  --cr-elevation-2:0 1px 2px rgba(60,64,67,.3),0 2px 6px 2px rgba(60,64,67,.15);',
    '  --cr-elevation-3:0 1px 3px rgba(60,64,67,.3),0 4px 8px 3px rgba(60,64,67,.15);',
    '  --cr-elevation-5:0 1px 4px rgba(60,64,67,.3),0 8px 24px 6px rgba(60,64,67,.15);',
    '  --cr-transition-duration:80ms;',
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  :root {',
    '    --cr-fallback-color-surface:#202124;',
    '    --cr-fallback-color-surface-1:#292a2d;',
    '    --cr-fallback-color-surface-variant:#3c4043;',
    '    --cr-fallback-color-on-surface:#e8eaed;',
    '    --cr-fallback-color-on-surface-subtle:#9aa0a6;',
    '    --cr-fallback-color-outline:#5f6368;',
    '    --cr-fallback-color-disabled-background:#2d2e30;',
    '    --cr-fallback-color-disabled-foreground:#80868b;',
    '  }',
    '  #__ds-agent-panel{background:#202124 !important;border-color:#5f6368}',
    '  #__ds-header{background:#292a2d;border-color:#5f6368}',
    '  #__ds-header-left,#__ds-header-left *{color:#e8eaed}',
    '  #__ds-col-left{border-color:#5f6368;background:#202124}',
    '  #__ds-col-right{background:#202124}',
    '  .ds-col-header{background:#202124;border-color:#5f6368}',
    '  .ds-col-title{color:#e8eaed}',
    '  .ds-tool-list{background:#202124}',
    '  .ds-tool-card{background:#202124}',
    '  .ds-tool-card:hover{background:#292a2d}',
    '  .ds-tool-name{color:#e8eaed}',
    '  .ds-tool-desc{color:#9aa0a6}',
    '  .ds-tool-mode.ds-mode-off{background:#3c4043;color:#9aa0a6}',
    '  .ds-skills-list{background:#202124}',
    '  .ds-skill-row{background:#202124}',
    '  .ds-skill-row:hover{background:#292a2d}',
    '  .ds-skill-name{color:#e8eaed}',
    '  .ds-search-input{background:#292a2d;color:#e8eaed;border-color:#5f6368}',
    '  #__ds-log-area{background:#202124;color:#e8eaed}',
    '  .ds-log-entry:hover{background:#292a2d}',
    '  .ds-log-msg{color:#e8eaed}',
    '  .ds-log-tab{color:#9aa0a6}',
    '  .ds-log-tab:hover{background:#292a2d;color:#e8eaed}',
    '  .ds-log-toolbar{background:#202124}',
    '  .ds-log-scroll-btn{background:#292a2d;border-color:#5f6368;color:#9aa0a6}',
    '  #__ds-bottom-bar{background:#202124;border-color:#5f6368}',
    '  .ds-qbtn{background:#292a2d;border-color:#5f6368;color:#e8eaed}',
    '  .ds-log-tb-btn{background:#292a2d;border-color:#5f6368;color:#e8eaed}',
    '  .ds-add-skill-btn{color:#9aa0a6}',
    '  .ds-more-btn{color:#9aa0a6}',
    '  #__ds-status{background:#292a2d;border-color:#5f6368}',
    '  #__ds-status-text{color:#9aa0a6}',
    '  #__ds-status-line{color:#9aa0a6}',
    '  .ds-toggle-pill.off{background:#3c4043}',
    '  .ds-form-input{background:#292a2d;color:#e8eaed;border-color:#5f6368}',
    '  .ds-form-label{color:#9aa0a6}',
    '  .ds-qa-entry{background:#292a2d;border-color:#5f6368}',
    '  .ds-btn-secondary{background:#292a2d;color:#e8eaed}',
    '  .ds-btn-secondary:hover{background:#3c4043}',
    '  .ds-modal{background:#202124;border-color:#5f6368;color:#e8eaed}',
    '  .ds-modal-title{color:#e8eaed}',
    '  .ds-badge-info{background:#1a3a5c;color:#8ab4f8}',
    '  .ds-badge-warn{background:#3c2e00;color:#fdd663}',
    '  .ds-badge-error{background:#3c1a1a;color:#f28b82}',
    '  .ds-badge-success{background:#1a3c1a;color:#81c995}',
    '}',

    '/* ===== Reset & Panel Container ===== */',
    '#__ds-agent-panel *{box-sizing:border-box;margin:0;padding:0}',
    '#__ds-agent-panel{',
    '  position:fixed;bottom:120px;right:20px;z-index:2147483640;',
    '  width:680px;height:440px;background:#fff;',
    '  border:1px solid #dadce0;border-radius:12px;',
    '  font-family:"Roboto","Segoe UI",system-ui,sans-serif;font-size:13px;',
    '  color:#202124;display:none !important;overflow:hidden;',
    '  box-shadow:0 4px 8px 3px rgba(60,64,67,.15),0 1px 3px 1px rgba(60,64,67,.3);',
    '}',
    '#__ds-agent-panel.visible{display:flex !important;flex-direction:column}',

    '/* ===== Header ===== */',
    '#__ds-header{',
    '  display:flex;align-items:center;justify-content:space-between;',
    '  padding:var(--cr-space-3) var(--cr-space-4);',
    '  border-bottom:1px solid var(--cr-fallback-color-outline);',
    '  background:var(--cr-fallback-color-surface-1);flex-shrink:0;',
    '  cursor:grab;user-select:none;',
    '}',
    '#__ds-header:active{cursor:grabbing}',
    '#__ds-header-left{display:flex;align-items:center;gap:var(--cr-space-2)}',
    '#__ds-logo{font-size:var(--cr-font-size-base);font-weight:700;color:var(--google-blue-500)}',
    '#__ds-title{font-weight:500;font-size:var(--cr-font-size-base)}',
    '#__ds-version{font-size:var(--cr-font-size-xs);color:var(--cr-fallback-color-on-surface-subtle);',
    '  padding:1px 6px;border-radius:var(--cr-radius-sm);background:var(--cr-fallback-color-surface-variant)}',
    '#__ds-status{',
    '  display:flex;align-items:center;gap:6px;padding:3px 10px;',
    '  border:1px solid var(--cr-fallback-color-outline);border-radius:var(--cr-radius-full);',
    '  font-size:var(--cr-font-size-xs);',
    '}',
    '#__ds-dot{width:8px;height:8px;border-radius:50%;background:var(--google-grey-500);transition:background .2s}',
    '#__ds-dot.online{background:var(--google-green-600)}',
    '#__ds-dot.offline{background:var(--google-red-600)}',
    '#__ds-status-text{color:var(--cr-fallback-color-on-surface-subtle)}',
    '#__ds-header-btns{display:flex;align-items:center;gap:2px}',
    '.ds-hbtn{',
    '  width:28px;height:28px;border:1px solid transparent;border-radius:var(--cr-radius-sm);',
    '  background:none;cursor:pointer;font-size:16px;display:flex;align-items:center;',
    '  justify-content:center;color:var(--cr-fallback-color-on-surface-subtle);',
    '  transition:all var(--cr-transition-duration);',
    '}',
    '.ds-hbtn:hover{border-color:var(--cr-fallback-color-outline);background:var(--cr-fallback-color-surface-1)}',

    '/* ===== Body: Dual Column Layout ===== */',
    '#__ds-body{display:flex;flex:1;overflow:hidden;min-height:0}',
    '#__ds-col-left{width:55%;display:flex;flex-direction:column;border-right:1px solid var(--cr-fallback-color-outline);overflow-y:auto}',
    '#__ds-col-right{width:45%;display:flex;flex-direction:column;overflow:hidden}',

    '/* Column Headers */',
    '.ds-col-header{',
    '  display:flex;align-items:center;justify-content:space-between;',
    '  padding:var(--cr-space-3) var(--cr-space-4);',
    '  border-bottom:1px solid var(--cr-fallback-color-outline);flex-shrink:0;',
    '  background:var(--cr-fallback-color-surface);',
    '}',
    '.ds-col-title{font-size:var(--cr-font-size-lg);font-weight:500}',
    '.ds-search-wrap{position:relative;width:160px}',
    '.ds-search-input{',
    '  width:100%;padding:5px 10px 5px 28px;border:1px solid var(--cr-fallback-color-outline);',
    '  border-radius:var(--cr-radius-full);font-size:var(--cr-font-size-sm);',
    '  background:var(--cr-fallback-color-surface);outline:none;',
    '}',
    '.ds-search-input:focus{border-color:var(--cr-fallback-color-primary)}',
    '.ds-search-icon{position:absolute;left:9px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--cr-fallback-color-on-surface-subtle)}',
    '.ds-more-btn{background:none;border:none;font-size:18px;cursor:pointer;color:var(--cr-fallback-color-on-surface-subtle);padding:2px 6px;border-radius:var(--cr-radius-sm)}',
    '.ds-more-btn:hover{background:var(--cr-fallback-color-surface-1)}',

    /* Tool Cards */
    '.ds-tool-list{padding:var(--cr-space-2) var(--cr-space-3);display:flex;flex-direction:column;gap:1px}',
    '.ds-tool-card{',
    '  display:flex;align-items:center;gap:var(--cr-space-3);padding:var(--cr-space-3);',
    '  border-radius:var(--cr-radius-md);cursor:pointer;transition:background var(--cr-transition-duration);',
    '}',
    '.ds-tool-card:hover{background:var(--cr-fallback-color-surface-1)}',
    '.ds-tool-icon{font-size:18px;width:24px;text-align:center;flex-shrink:0}',
    '.ds-tool-info{flex:1;min-width:0}',
    '.ds-tool-name{font-size:var(--cr-font-size-base);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ds-tool-desc{font-size:var(--cr-font-size-xs);color:var(--cr-fallback-color-on-surface-subtle);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}',
    '.ds-tool-mode{',
    '  font-size:var(--cr-font-size-xs);font-weight:600;padding:2px 10px;border-radius:var(--cr-radius-sm);',
    '  cursor:pointer;user-select:none;flex-shrink:0;transition:all var(--cr-transition-duration);',
    '  letter-spacing:.5px;',
    '}',
    '.ds-mode-auto{color:var(--google-blue-500);background:#e8f0fe}',
    '.ds-mode-manual{color:var(--google-yellow-400);background:#fef7e0}',
    '.ds-mode-off{color:var(--cr-fallback-color-on-surface-subtle);background:var(--cr-fallback-color-surface-variant)}',
    '.ds-tool-add{font-size:18px;color:var(--cr-fallback-color-on-surface-subtle);cursor:pointer;width:20px;text-align:center}',

    /* Skills */
    '.ds-skills-list{padding:var(--cr-space-2) var(--cr-space-3)}',
    '.ds-skill-row{',
    '  display:flex;align-items:center;justify-content:space-between;',
    '  padding:var(--cr-space-2) var(--cr-space-3);border-radius:var(--cr-radius-sm);',
    '}',
    '.ds-skill-row:hover{background:var(--cr-fallback-color-surface-1)}',
    '.ds-skill-name{font-size:var(--cr-font-size-sm);font-weight:500}',
    '.ds-skill-toggle{',
    '  display:flex;align-items:center;gap:6px;cursor:pointer;',
    '}',
    '.ds-toggle-pill{',
    '  width:32px;height:18px;border-radius:var(--cr-radius-full);position:relative;',
    '  transition:background var(--cr-transition-duration);border:none;cursor:pointer;',
    '}',
    '.ds-toggle-pill.on{background:var(--google-blue-500)}',
    '.ds-toggle-pill.off{background:var(--cr-fallback-color-surface-variant)}',
    '.ds-toggle-knob{',
    '  position:absolute;top:2px;width:14px;height:14px;border-radius:50%;',
    '  background:#fff;transition:transform var(--cr-transition-duration);box-shadow:0 1px 2px rgba(0,0,0,.2)',
    '}',
    '.ds-toggle-pill.on .ds-toggle-knob{transform:translateX(14px)}',
    '.ds-add-skill-btn{',
    '  display:flex;align-items:center;gap:4px;margin:var(--cr-space-2) var(--cr-space-3);',
    '  padding:var(--cr-space-2) var(--cr-space-3);border:1px dashed var(--cr-fallback-color-outline);',
    '  border-radius:var(--cr-radius-sm);font-size:var(--cr-font-size-sm);color:var(--cr-fallback-color-on-surface-subtle);',
    '  background:none;cursor:pointer;width:calc(100% - var(--cr-space-6));',
    '}',
    '.ds-add-skill-btn:hover{background:var(--cr-fallback-color-surface-1);border-color:var(--cr-fallback-color-primary)}',

    /* Right column: Logs */
    '#__ds-log-tabs{display:flex;gap:2px;padding:var(--cr-space-2) var(--cr-space-4) 0}',
    '.ds-log-tab{',
    '  padding:4px 12px;border:none;background:none;font-size:var(--cr-font-size-sm);',
    '  color:var(--cr-fallback-color-on-surface-subtle);cursor:pointer;border-radius:var(--cr-radius-sm);',
    '  font-weight:500;transition:all var(--cr-transition-duration);',
    '}',
    '.ds-log-tab:hover{background:var(--cr-fallback-color-surface-1)}',
    '.ds-log-tab.active{',
    '  background:var(--google-blue-500);color:#fff;',
    '}',
    '.ds-log-toolbar{',
    '  display:flex;align-items:center;justify-content:space-between;',
    '  padding:var(--cr-space-2) var(--cr-space-4);',
    '}',
    '.ds-log-tb-btn{',
    '  padding:3px 12px;border:1px solid var(--cr-fallback-color-outline);',
    '  border-radius:var(--cr-radius-sm);background:var(--cr-fallback-color-surface);',
    '  font-size:var(--cr-font-size-xs);cursor:pointer;color:var(--cr-fallback-color-on-surface);',
    '}',
    '.ds-log-tb-btn:hover{background:var(--cr-fallback-color-surface-1);border-color:var(--cr-fallback-color-primary)}',
    '#__ds-log-area{',
    '  flex:1;overflow-y:auto;padding:var(--cr-space-2) var(--cr-space-4);',
    '  font-size:var(--cr-font-size-xs);line-height:1.65;font-family:var(--cr-font-family);',
    '}',
    '.ds-log-entry{padding:2px 0;border-bottom:1px solid transparent;display:flex;gap:6px}',
    '.ds-log-entry:hover{background:var(--cr-fallback-color-surface-1)}',
    '.ds-log-time{color:var(--cr-fallback-color-on-surface-subtle);flex-shrink:0}',
    '.ds-log-badge{',
    '  padding:0 6px;border-radius:2px;font-size:10px;font-weight:700;flex-shrink:0;',
    '  text-transform:uppercase;letter-spacing:.5px;',
    '}',
    '.ds-badge-info{background:#e8f0fe;color:var(--google-blue-500)}',
    '.ds-badge-warn{background:#fef7e0;color:#b06000}',
    '.ds-badge-error{background:#fce8e6;color:var(--google-red-600)}',
    '.ds-badge-success{background:#e6f4ea;color:var(--google-green-600)}',
    '.ds-log-msg{color:var(--cr-fallback-color-on-surface);word-break:break-word}',
    '.ds-log-scroll-btn{',
    '  display:flex;align-items:center;justify-content:center;gap:4px;',
    '  padding:4px;border-top:1px solid var(--cr-fallback-color-outline);',
    '  background:var(--cr-fallback-color-surface-1);font-size:var(--cr-font-size-xs);',
    '  color:var(--cr-fallback-color-on-surface-subtle);cursor:pointer;',
    '}',
    '.ds-log-scroll-btn.active{color:var(--google-blue-500)}',

    /* Bottom bar */
    '#__ds-bottom-bar{',
    '  display:flex;align-items:center;justify-content:space-between;',
    '  padding:var(--cr-space-2) var(--cr-space-4);',
    '  border-top:1px solid var(--cr-fallback-color-outline);',
    '  background:var(--cr-fallback-color-surface);flex-shrink:0;',
    '}',
    '#__ds-quick-btns{display:flex;gap:6px;flex:1}',
    '.ds-qbtn{',
    '  display:flex;align-items:center;gap:4px;padding:5px 12px;',
    '  border:1px solid var(--cr-fallback-color-outline);border-radius:var(--cr-radius-full);',
    '  background:var(--cr-fallback-color-surface);font-size:var(--cr-font-size-xs);',
    '  cursor:pointer;color:var(--cr-fallback-color-on-surface);white-space:nowrap;',
    '  transition:all var(--cr-transition-duration);',
    '}',
    '.ds-qbtn:hover{border-color:var(--cr-fallback-color-primary);background:#e8f0fe}',
    '.ds-qbtn-icon{font-size:13px}',
    '#__ds-status-line{',
    '  display:flex;align-items:center;gap:6px;font-size:var(--cr-font-size-xs);',
    '  color:var(--cr-fallback-color-on-surface-subtle);flex-shrink:0;',
    '}',
    '#__ds-status-line .ds-online{color:var(--google-green-600);font-weight:600}',
    '.ds-edit-btn{',
    '  width:26px;height:26px;border:1px solid var(--cr-fallback-color-outline);',
    '  border-radius:50%;background:none;cursor:pointer;font-size:12px;',
    '  display:flex;align-items:center;justify-content:center;',
    '  color:var(--cr-fallback-color-on-surface-subtle);margin-left:6px;',
    '}',
    '.ds-edit-btn:hover{background:var(--cr-fallback-color-surface-1)}',

    /* Modal */

    /* Pet ball */
    '#__ds-pet-ball{',
    '  position:fixed;bottom:20px;right:20px;width:40px;height:40px;',
    '  background:#1a73e8;color:#fff;border-radius:50%;',
    '  display:flex;align-items:center;justify-content:center;',
    '  font-size:11px;font-weight:700;cursor:grab;z-index:2147483639;',
    '  box-shadow:0 2px 6px 2px rgba(60,64,67,.15),0 1px 3px 1px rgba(60,64,67,.3);',
    '  user-select:none;transition:transform .15s;',
    '}',
    '#__ds-pet-ball:active{cursor:grabbing}',
    '#__ds-pet-ball.visible{transform:scale(0);pointer-events:none}',

    /* Modal */
    '.ds-modal-overlay{',
    '  position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147483647;',
    '  display:none;align-items:center;justify-content:center;',
    '}',
    '.ds-modal-overlay.show{display:flex;padding:20px}',
    '.ds-modal{',
    '  background:var(--cr-fallback-color-surface);border:1px solid var(--cr-fallback-color-outline);',
    '  border-radius:var(--cr-radius-lg);padding:var(--cr-space-5);width:420px;max-height:70vh;',
    '  overflow-y:auto;position:relative;box-shadow:var(--cr-elevation-5);z-index:1;',
    '}',
    '.ds-modal-title{font-size:var(--cr-font-size-lg);font-weight:500;margin-bottom:var(--cr-space-4)}',
    '.ds-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:var(--cr-space-4)}',
    '.ds-form-group{margin-bottom:var(--cr-space-3)}',
    '.ds-form-label{display:block;font-size:var(--cr-font-size-xs);font-weight:500;margin-bottom:4px;color:var(--cr-fallback-color-on-surface-subtle)}',
    '.ds-form-input{',
    '  width:100%;padding:7px 10px;border:1px solid var(--cr-fallback-color-outline);',
    '  border-radius:var(--cr-radius-sm);font-size:var(--cr-font-size-sm);',
    '  background:var(--cr-fallback-color-surface);outline:none;font-family:inherit;',
    '}',
    '.ds-form-input:focus{border-color:var(--cr-fallback-color-primary)}',
    '.ds-btn{',
    '  padding:6px 16px;border:1px solid var(--cr-fallback-color-outline);',
    '  border-radius:var(--cr-radius-sm);font-size:var(--cr-font-size-sm);cursor:pointer;',
    '  font-family:inherit;transition:all var(--cr-transition-duration);',
    '}',
    '.ds-btn-primary{background:var(--google-blue-500);color:#fff;border-color:var(--google-blue-500)}',
    '.ds-btn-secondary{background:var(--cr-fallback-color-surface);color:var(--cr-fallback-color-on-surface)}',
    '.ds-btn-secondary:hover{background:var(--cr-fallback-color-surface-1)}',
    '.ds-btn-sm{padding:4px 12px;font-size:var(--cr-font-size-xs)}',
    '.ds-qa-entry{border:1px solid var(--cr-fallback-color-outline);padding:var(--cr-space-3);border-radius:var(--cr-radius-sm);margin-bottom:var(--cr-space-2)}',
  ].join('\n');
  document.head.appendChild(s);
}

// ============================================================
// HTML — Dual-column layout
// ============================================================
function injectPanelHTML() {
  if (document.getElementById('__ds-agent-panel')) return;

  // Pet ball
  var pet = document.createElement('div');
  pet.id = '__ds-pet-ball';
  pet.textContent = '[DS]';
  pet.title = 'DS-Agent v2.5';
  pet.addEventListener('mousedown', startPetDrag);
  document.body.appendChild(pet);

  // Main panel
  var panel = document.createElement('div');
  panel.id = '__ds-agent-panel';
  panel.innerHTML = buildPanelHTML();
  document.body.appendChild(panel);

  // Modal overlay (contains QA modal)
  var overlay = document.createElement('div');
  overlay.id = '__ds-modal-overlay';
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = buildQAModalHTML();
  overlay.addEventListener('click', function(e) { if (e.target === overlay) hideAllModals(); });
  document.body.appendChild(overlay);

  bindPanelEvents();
}

function buildPanelHTML() {
  return [
    '<div id="__ds-header">',
    '  <div id="__ds-header-left">',
    '    <span id="__ds-logo" class="ds-logo">[DS]</span>',
    '    <span id="__ds-title">Agent</span>',
    '    <span id="__ds-version">v2.5</span>',
    '  </div>',
    '  <div id="__ds-status">',
    '    <span id="__ds-dot"></span>',
    '    <span id="__ds-status-text">Checking...</span>',
    '  </div>',
    '  <div id="__ds-header-btns">',
    '    <button class="ds-hbtn" id="__ds-btn-minimize" title="Minimize">&#8722;</button>',
    '    <button class="ds-hbtn" id="__ds-btn-close" title="Close">&times;</button>',
    '  </div>',
    '</div>',

    '<div id="__ds-body">',
    '  <!-- Left Column: Tools & Skills -->',
    '  <div id="__ds-col-left">',
    '    <div class="ds-col-header">',
    '      <span class="ds-col-title">Tools &amp; Skills</span>',
    '      <div class="ds-search-wrap">',
    '        <span class="ds-search-icon">&#128269;</span>',
    '        <input class="ds-search-input" id="__ds-tool-search" placeholder="Search tools..." />',
    '      </div>',
    '    </div>',
    '    <div class="ds-tool-list" id="__ds-tools-container"><div style="padding:16px;color:var(--cr-fallback-color-on-surface-subtle);text-align:center;">Loading...</div></div>',
    '    <div class="ds-skills-list" id="__ds-skills-container"></div>',
    '    <button class="ds-add-skill-btn" id="__ds-btn-add-skill">+ Add Skill</button>',
    '  </div>',

    '  <!-- Right Column: Live Logs -->',
    '  <div id="__ds-col-right">',
    '    <div class="ds-col-header">',
    '      <span class="ds-col-title">Live Logs</span>',
    '      <button class="ds-more-btn" id="__ds-btn-log-more">&#8943;</button>',
    '    </div>',
    '    <div id="__ds-log-tabs">',
    '      <button class="ds-log-tab active" data-level="all">All</button>',
    '      <button class="ds-log-tab" data-level="info">Info</button>',
    '      <button class="ds-log-tab" data-level="warn">Warn</button>',
    '      <button class="ds-log-tab" data-level="error">Error</button>',
    '    </div>',
    '    <div class="ds-log-toolbar">',
    '      <span></span>',
    '      <div style="display:flex;gap:6px;">',
    '        <button class="ds-log-tb-btn" id="__ds-btn-export">Export</button>',
    '        <button class="ds-log-tb-btn" id="__ds-btn-clear">Clear</button>',
    '      </div>',
    '    </div>',
    '    <div id="__ds-log-area"><div style="padding:16px;color:var(--cr-fallback-color-on-surface-subtle);text-align:center;">No logs yet</div></div>',
    '    <div class="ds-log-scroll-btn active" id="__ds-btn-autoscroll">&#8964; auto-scroll</div>',
    '  </div>',
    '</div>',

    '<div id="__ds-bottom-bar">',
    '  <div id="__ds-quick-btns"></div>',
    '  <div id="__ds-status-line">',
    '    <span id="__ds-agent-status-text">Agent Not Ready</span>',
    '    <button class="ds-edit-btn" id="__ds-btn-edit-qa" title="Edit Quick Actions">&#9998;</button>',
    '  </div>',
    '</div>'
  ].join('');
}

function buildQAModalHTML() {
  return [
    '<div id="__ds-qa-modal" class="ds-modal" style="display:none;">',
    '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">',
    '    <div class="ds-modal-title">Edit Quick Actions (max 5)</div>',
    '    <button class="ds-hbtn" id="__ds-qa-close" style="font-size:14px;">&times;</button>',
    '  </div>',
    '  <div id="__ds-qa-entries"></div>',
    '  <div class="ds-modal-actions">',
    '    <button class="ds-btn ds-btn-secondary ds-btn-sm" id="__ds-qa-cancel">Cancel</button>',
    '    <button class="ds-btn ds-btn-primary ds-btn-sm" id="__ds-qa-save">Save</button>',
    '  </div>',
    '</div>'
  ].join('');
}

// ============================================================
// Event bindings
// ============================================================
function bindPanelEvents() {
  // Header
  var minBtn = document.getElementById('__ds-btn-minimize');
  if (minBtn) minBtn.onclick = function() { togglePanel(false); };
  var closeBtn = document.getElementById('__ds-btn-close');
  if (closeBtn) closeBtn.onclick = function() { togglePanel(false); };
  var header = document.getElementById('__ds-header');
  if (header) header.addEventListener('mousedown', startPanelDrag);

  // Search
  var searchInput = document.getElementById('__ds-tool-search');
  if (searchInput) {
    var _searchTimer = null;
    searchInput.addEventListener('input', function() {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(function() { renderToolCardsFiltered(searchInput.value.trim()); }, 200);
    });
  }

  // Log tabs
  var logTabs = document.querySelectorAll('.ds-log-tab');
  for (var i = 0; i < logTabs.length; i++) {
    logTabs[i].addEventListener('click', function() {
      logTabs.forEach(function(t) { t.classList.remove('active'); });
      this.classList.add('active');
      logLevelFilter = this.getAttribute('data-level') || 'all';
      renderLogs();
    });
  }

  // Log toolbar
  var exportBtn = document.getElementById('__ds-btn-export');
  if (exportBtn) exportBtn.onclick = function() { exportLogs(); };
  var clearBtn = document.getElementById('__ds-btn-clear');
  if (clearBtn) clearBtn.onclick = function() {
    executionHistory = []; renderLogs(); logPanel('info', 'Logs cleared');
  };

  // Auto scroll toggle
  var asBtn = document.getElementById('__ds-btn-autoscroll');
  if (asBtn) asBtn.onclick = function() {
    autoScroll = !autoScroll;
    this.classList.toggle('active', autoScroll);
    this.innerHTML = autoScroll ? '&#8964; auto-scroll' : '&#9644; paused';
    if (autoScroll) scrollToLogBottom();
  };

  // Quick actions edit
  var editQABtn = document.getElementById('__ds-btn-edit-qa');
  if (editQABtn) editQABtn.onclick = function() { showQAEditor(window.__ds_quickActions || []); };

  // Add skill
  var addSkillBtn = document.getElementById('__ds-btn-add-skill');
  if (addSkillBtn) addSkillBtn.onclick = function() {
    logPanel('info', 'Skill creation: use AI skill-creator or add manually via config');
  };

  // QA Modal
  var qaSave = document.getElementById('__ds-qa-save');
  if (qaSave) qaSave.onclick = saveQuickActions;
  var qaCancel = document.getElementById('__ds-qa-cancel');
  if (qaCancel) qaCancel.onclick = hideAllModals;
  var qaClose = document.getElementById('__ds-qa-close');
  if (qaClose) qaClose.onclick = hideAllModals;
}

// ============================================================
// Pet ball drag
// ============================================================
function startPetDrag(e) {
  if (e.button !== 0) return;
  petDragging = true;
  petDragStartX = e.clientX; petDragStartY = e.clientY;
  var pet = document.getElementById('__ds-pet-ball');
  var rect = pet.getBoundingClientRect();
  petOffsetX = e.clientX - rect.left; petOffsetY = e.clientY - rect.top;
  pet.style.transition = 'none';
  document.addEventListener('mousemove', petDragMove);
  document.addEventListener('mouseup', petDragEnd);
  e.preventDefault();
}
function petDragMove(e) {
  if (!petDragging) return;
  var pet = document.getElementById('__ds-pet-ball');
  var vw = window.innerWidth, vh = window.innerHeight;
  pet.style.left = Math.min(Math.max(e.clientX - petOffsetX, 0), vw - 48) + 'px';
  pet.style.right = 'auto'; pet.style.bottom = 'auto';
  pet.style.top = Math.min(Math.max(e.clientY - petOffsetY, 0), vh - 48) + 'px';
}
function petDragEnd(e) {
  if (!petDragging) return;
  petDragging = false;
  var dx = Math.abs(e.clientX - petDragStartX), dy = Math.abs(e.clientY - petDragStartY);
  var pet = document.getElementById('__ds-pet-ball');
  pet.style.transition = 'transform .15s';
  if (dx < 5 && dy < 5) togglePanel();
  document.removeEventListener('mousemove', petDragMove);
  document.removeEventListener('mouseup', petDragEnd);
}

// ============================================================
// Panel drag
// ============================================================
var panelDragging = false, panelOffX = 0, panelOffY = 0;
function startPanelDrag(e) {
  if (e.button !== 0 || e.target.closest('button')) return;
  panelDragging = true;
  var p = document.getElementById('__ds-agent-panel'), r = p.getBoundingClientRect();
  panelOffX = e.clientX - r.left; panelOffY = e.clientY - r.top;
  p.style.transition = 'none';
  document.addEventListener('mousemove', panelDragMove);
  document.addEventListener('mouseup', panelDragEnd);
  e.preventDefault();
}
function panelDragMove(e) {
  if (!panelDragging) return;
  var p = document.getElementById('__ds-agent-panel'), vw = window.innerWidth, vh = window.innerHeight;
  p.style.right = 'auto'; p.style.bottom = 'auto';
  p.style.left = Math.min(Math.max(e.clientX - panelOffX, 0), vw - 680) + 'px';
  p.style.top = Math.min(Math.max(e.clientY - panelOffY, 0), vh - 480) + 'px';
}
function panelDragEnd() {
  if (!panelDragging) return;
  panelDragging = false;
  document.getElementById('__ds-agent-panel').style.transition = '';
  document.removeEventListener('mousemove', panelDragMove);
  document.removeEventListener('mouseup', panelDragEnd);
}

// ============================================================
// Toggle panel visibility
// ============================================================
function togglePanel(show) {
  var panel = document.getElementById('__ds-agent-panel');
  var pet = document.getElementById('__ds-pet-ball');
  if (!panel || !pet) { console.warn('[DS] togglePanel: elements not found', !!panel, !!pet); return; }

  var isOpen = panel.classList.contains('visible');

  if (show === true && !isOpen) {
    openPanel(panel, pet);
  } else if (show === false && isOpen) {
    closePanel(panel, pet);
  } else if (show === undefined) {
    if (isOpen) { closePanel(panel, pet); }
    else { openPanel(panel, pet); }
  }
}

function openPanel(panel, pet) {
  panel.classList.add('visible');
  panel.style.display = 'flex';
  pet.classList.add('visible');
  loadPanelData();
}

function closePanel(panel, pet) {
  panel.classList.remove('visible');
  panel.style.display = 'none';
  pet.classList.remove('visible');
  pet.style.left = '';
  pet.style.right = '';
  pet.style.top = '';
  pet.style.bottom = '';
}

async function loadPanelData() {
  var serverOnline = false;
  try {
    if (window.checkServerHealth) {
      var r = await window.checkServerHealth();
      serverOnline = r && r.healthy;
      updateServerStatusUI(serverOnline);
    }
  } catch(e) {}
  if (serverOnline) {
    try { if (window.loadTools) window.loadTools(); } catch(e) {}
    try { if (window.loadSkills) window.loadSkills(); } catch(e) {}
    try { if (window.loadQuickActions) window.loadQuickActions(); } catch(e) {}
  }
  renderLogs();
}

// ============================================================
// Tool cards rendering (with mode cycling)
// ============================================================
var MODE_CYCLE = ['auto', 'manual', 'off'];
var MODE_LABELS = { auto: 'AUTO', manual: 'MANUAL', off: 'OFF' };
var MODE_ICON = { auto: '\u26A1', manual: '\u25CF', off: '\u25CB' };
var MODE_CLASS = { auto: 'ds-mode-auto', manual: 'ds-mode-manual', off: 'ds-mode-off' };

function renderToolsList(tools) {
  if (!tools || !Array.isArray(tools)) return;
  agentTools = tools;
  renderToolCardsFiltered('');
}

function renderToolCardsFiltered(query) {
  var container = document.getElementById('__ds-tools-container');
  if (!container) return;
  var q = (query || '').toLowerCase();
  var filtered = agentTools.filter(function(t) {
    return !q || (t.name || '').toLowerCase().indexOf(q) >= 0 || (t.description || '').toLowerCase().indexOf(q) >= 0;
  });
  if (filtered.length === 0) {
    container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--cr-fallback-color-on-surface-subtle);font-size:var(--cr-font-size-sm);">' +
      (q ? 'No tools match "' + escapeAttr(q) + '"' : 'No tools loaded') + '</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var tool = filtered[i];
    var mode = tool.mode || 'off';
    html += '<div class="ds-tool-card" data-tool="' + escapeAttr(tool.name) + '">';
    html += '<span class="ds-tool-icon">' + (MODE_ICON[mode] || '\u25CB') + '</span>';
    html += '<div class="ds-tool-info">';
    html += '<div class="ds-tool-name">' + escapeAttr(tool.name) + '</div>';
    html += '<div class="ds-tool-desc">' + escapeAttr(tool.description || '') + '</div>';
    html += '</div>';
    html += '<span class="ds-tool-mode ' + (MODE_CLASS[mode] || 'ds-mode-off') + '" data-tool="' + escapeAttr(tool.name) + '">' + (MODE_LABELS[mode] || 'OFF') + '</span>';
    html += '<span class="ds-tool-add" data-tool="' + escapeAttr(tool.name) + '">+</span>';
    html += '</div>';
  }
  container.innerHTML = html;

  // Mode cycle click
  var modeEls = container.querySelectorAll('.ds-tool-mode');
  for (var j = 0; j < modeEls.length; j++) {
    modeEls[j].onclick = (function(el) {
      return function() {
        var tName = el.getAttribute('data-tool');
        var currentMode = el.textContent.trim().toUpperCase();
        var idx = MODE_CYCLE.indexOf(currentMode.toLowerCase());
        var nextIdx = (idx + 1) % MODE_CYCLE.length;
        var nextMode = MODE_CYCLE[nextIdx];
        el.textContent = MODE_LABELS[nextMode];
        el.className = 'ds-tool-mode ' + MODE_CLASS[nextMode];
        el.parentNode.querySelector('.ds-tool-icon').textContent = MODE_ICON[nextMode];
        if (window.__ds_onToolModeChange) window.__ds_onToolModeChange(tName, nextMode);
      };
    })(modeEls[j]);
  }
}

// ============================================================
// Skills rendering
// ============================================================
function renderSkillsList(skills, customSkills) {
  if (!skills) skills = [];
  if (!Array.isArray(skills)) return;
  agentSkills = skills;
  agentCustomSkills = customSkills || [];
  var container = document.getElementById('__ds-skills-container');
  if (!container) return;
  if (skills.length === 0) { container.innerHTML = ''; return; }
  var html = '';
  for (var i = 0; i < skills.length; i++) {
    var sk = skills[i];
    var enabled = sk.enabled !== undefined ? sk.enabled : false;
    html += '<div class="ds-skill-row">';
    html += '<span class="ds-skill-name">' + escapeAttr(sk.name) + '</span>';
    html += '<div class="ds-skill-toggle" data-skill="' + escapeAttr(sk.dirName || sk.name) + '" data-enabled="' + enabled + '">';
    html += '<div class="ds-toggle-pill ' + (enabled ? 'on' : 'off') + '"><div class="ds-toggle-knob"></div></div>';
    html += '</div></div>';
  }
  container.innerHTML = html;

  var toggles = container.querySelectorAll('.ds-skill-toggle');
  for (var j = 0; j < toggles.length; j++) {
    toggles[j].onclick = (function(el) {
      return function() {
        var sName = el.getAttribute('data-skill');
        var curEnabled = el.getAttribute('data-enabled') === 'true';
        var newEnabled = !curEnabled;
        el.setAttribute('data-enabled', String(newEnabled));
        var pill = el.querySelector('.ds-toggle-pill');
        pill.className = 'ds-toggle-pill ' + (newEnabled ? 'on' : 'off');
        if (window.__ds_toggleSkill) window.__ds_toggleSkill(sName, newEnabled);
      };
    })(toggles[j]);
  }
}

// ============================================================
// Quick actions (bottom bar)
// ============================================================
function updateQuickActionButtons(actions) {
  if (!actions) actions = [];
  window.__ds_quickActions = actions;
  quickActions = actions;
  var container = document.getElementById('__ds-quick-btns');
  if (!container) return;
  if (actions.length === 0) {
    container.innerHTML = '<span style="color:var(--cr-fallback-color-on-surface-subtle);font-size:var(--cr-font-size-xs);">No quick actions</span>';
    return;
  }
  var icons = ['\u229E', '\u2600', '\u274C'];
  var html = '';
  for (var i = 0; i < actions.length; i++) {
    html += '<button class="ds-qbtn" data-qa-index="' + i + '">';
    html += '<span class="ds-qbtn-icon">' + (icons[i % icons.length] || '\u229E') + '</span>';
    html += escapeAttr(actions[i].label || 'Action ' + (i+1));
    html += '</button>';
  }
  container.innerHTML = html;
  var btns = container.querySelectorAll('.ds-qbtn');
  for (var j = 0; j < btns.length; j++) {
    btns[j].onclick = (function(idx) {
      return function() {
        if (window.triggerQuickAction) window.triggerQuickAction(idx);
      };
    })(parseInt(btns[j].getAttribute('data-qa-index')));
  }
  updateStatusBar();
}

function updateStatusBar() {
  var statusEl = document.getElementById('__ds-agent-status-text');
  if (!statusEl) return;
  var autoCount = 0;
  for (var i = 0; i < agentTools.length; i++) {
    if ((agentTools[i].mode || 'off') === 'auto') autoCount++;
  }
  statusEl.innerHTML = '<span class="ds-online">Ready</span> &middot; ' + agentTools.length + ' tools &middot; ' + autoCount + ' auto';
}

// ============================================================
// Agent state
// ============================================================
function updateAgentPanelUI(initialized) {
  updateStatusBar();
  updateQuickActionButtons(window.__ds_quickActions || []);
}

// ============================================================
// Logs
// ============================================================
function renderLogs() {
  var area = document.getElementById('__ds-log-area');
  if (!area) return;
  if (!executionHistory || executionHistory.length === 0) {
    area.innerHTML = '<div style="padding:16px;text-align:center;color:var(--cr-fallback-color-on-surface-subtle);">No logs yet</div>';
    return;
  }
  var recent = executionHistory.slice(-200);
  var filtered = recent;
  if (logLevelFilter && logLevelFilter !== 'all') {
    filtered = recent.filter(function(l) { return l.level === logLevelFilter; });
  }
  if (filtered.length === 0) {
    area.innerHTML = '<div style="padding:16px;text-align:center;color:var(--cr-fallback-color-on-surface-subtle);">No ' + logLevelFilter + ' logs</div>';
    return;
  }
  var html = '';
  for (var i = 0; i < filtered.length; i++) {
    var log = filtered[i];
    var cls = 'ds-badge-' + (log.level === 'error' ? 'error' : log.level === 'warn' ? 'warn' : log.level === 'success' ? 'success' : 'info');
    html += '<div class="ds-log-entry">';
    html += '<span class="ds-log-time">' + escapeAttr(log.time || '--:--') + '</span>';
    html += '<span class="ds-log-badge ' + cls + '">' + (log.level || 'info') + '</span>';
    html += '<span class="ds-log-msg">' + escapeAttr(log.message || '') + '</span>';
    html += '</div>';
  }
  area.innerHTML = html;
  if (autoScroll) scrollToLogBottom();
}

function scrollToLogBottom() {
  var area = document.getElementById('__ds-log-area');
  if (area) area.scrollTop = area.scrollHeight;
}

function exportLogs() {
  if (!executionHistory || executionHistory.length === 0) { logPanel('warn', 'No logs to export'); return; }
  var text = '=== DS-Agent Logs ===\n';
  for (var i = 0; i < executionHistory.length; i++) {
    text += '[' + (executionHistory[i].time || '--:--') + '] [' + (executionHistory[i].level || 'info').toUpperCase() + '] ' + (executionHistory[i].message || '') + '\n';
  }
  var blob = new Blob([text], { type: 'text/plain' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = 'agent-logs-' + Date.now() + '.txt'; a.click();
  URL.revokeObjectURL(url);
  logPanel('info', 'Logs exported');
}

function logPanel(level, message) {
  var time = new Date().toTimeString().split(' ')[0];
  executionHistory.push({ time: time, level: level, message: message });
  if (executionHistory.length > 500) executionHistory = executionHistory.slice(-500);
  renderLogs();
  try { if (typeof saveLocalLog === 'function') saveLocalLog(level, message, time, new Date().toISOString()); } catch(e) {}
  try { if (typeof sendLogToFile === 'function') sendLogToFile(level, message, new Date().toISOString()); } catch(e) {}
}

// ============================================================
// Server status
// ============================================================
function updateServerStatusUI(online) {
  var dot = document.getElementById('__ds-dot');
  var txt = document.getElementById('__ds-status-text');
  if (dot) dot.className = online ? 'online' : 'offline';
  if (txt) txt.textContent = online ? 'Connected' : 'Disconnected';

  var dotColor = online ? '#5b8a4a' : '#c0bab0';
  var dotShadow = online ? '0 0 6px rgba(91,138,74,0.4)' : 'none';
  var petDot = document.getElementById('__ds-pet-dot');
  var headerDot = document.getElementById('__ds-h-status-dot');
  var serverStatusText = document.getElementById('__ds-server-status-text');
  var panelStatusDot = document.getElementById('__ds-panel-status-dot');
  var serverText = document.getElementById('__ds-server-text');
  if (petDot) { petDot.style.background = dotColor; petDot.style.boxShadow = dotShadow; }
  if (headerDot) { headerDot.style.background = dotColor; headerDot.style.boxShadow = dotShadow; }
  if (serverStatusText) serverStatusText.textContent = online ? '✅ 已连接' : '❌ 未连接';
  if (panelStatusDot) { panelStatusDot.className = online ? '__ds-status-connected' : '__ds-status-disconnected'; }
  if (serverText) { serverText.textContent = online ? '已连接' : '未连接'; serverText.className = online ? '__ds-status-on' : '__ds-status-off'; }
}

function setStageText(text) {
  var el = document.getElementById('__ds-status-text');
  if (el) el.textContent = text || 'Connected';
}

// ============================================================
// QA Editor modal
// ============================================================
function showQAEditor(actions) {
  if (!actions || !Array.isArray(actions)) actions = [];
  var modal = document.getElementById('__ds-qa-modal');
  var overlay = document.getElementById('__ds-modal-overlay');
  if (!modal || !overlay) return;
  hideAllModals();
  overlay.classList.add('show');
  modal.style.display = 'block';
  var entries = document.getElementById('__ds-qa-entries');
  if (!entries) return;
  var html = '';
  var count = Math.max(actions.length, 2);
  for (var i = 0; i < count; i++) {
    var act = actions[i] || { label: '', prompt: '' };
    html += '<div class="ds-qa-entry">';
    html += '<div class="ds-form-group"><label class="ds-form-label">Label</label>';
    html += '<input class="ds-form-input ds-qa-label" value="' + escapeAttr(act.label || '') + '" placeholder="e.g. Summarize chat" /></div>';
    html += '<div class="ds-form-group"><label class="ds-form-label">Prompt</label>';
    html += '<textarea class="ds-form-input ds-qa-prompt" rows="2" placeholder="Prompt AI receives...">' + escapeAttr(act.prompt || '') + '</textarea></div>';
    html += '</div>';
  }
  entries.innerHTML = html;
}

async function saveQuickActions() {
  var entries = document.querySelectorAll('#__ds-qa-entries .ds-qa-entry');
  var actions = [];
  for (var i = 0; i < entries.length; i++) {
    var label = entries[i].querySelector('.ds-qa-label');
    var prompt = entries[i].querySelector('.ds-qa-prompt');
    if (label && prompt && label.value.trim() && prompt.value.trim()) {
      actions.push({ label: label.value.trim(), prompt: prompt.value.trim() });
    }
  }
  if (actions.length === 0) { alert('Need at least one valid action'); return; }
  if (actions.length > 5) { alert('Max 5 actions'); return; }
  window.__ds_quickActions = actions;
  updateQuickActionButtons(actions);
  if (window.__ds_saveQuickActions) await window.__ds_saveQuickActions(actions);
  hideAllModals();
  logPanel('info', 'Quick actions saved');
}

function hideAllModals() {
  var overlay = document.getElementById('__ds-modal-overlay');
  if (overlay) overlay.classList.remove('show');
  var modal = document.getElementById('__ds-qa-modal');
  if (modal) modal.style.display = 'none';
}

// ============================================================
// Utility
// ============================================================
function escapeAttr(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ============================================================
// Exports to window (for actions.js / external callers)
// ============================================================
window.injectOperationPanel = injectPanelHTML;
window.updateServerStatusUI = updateServerStatusUI;
window.setStageText = setStageText;
window.renderToolsList = renderToolsList;
window.renderSkillsList = renderSkillsList;
window.updateAgentPanelUI = updateAgentPanelUI;
window.renderLogs = renderLogs;
window.updateQuickActionButtons = updateQuickActionButtons;
window.showConfigModal = function() {};
window.showQuickActionsEditor = showQAEditor;
window.showSettingsModal = function() {};
window.hideAllModals = hideAllModals;
window.logPanel = logPanel;

// ============================================================
// Auto init
// ============================================================
(function() {
  if (document.getElementById('__ds-agent-panel')) return;
  injectPanelCSS();
  injectPanelHTML();
  var pet = document.getElementById('__ds-pet-ball');
  var panel = document.getElementById('__ds-agent-panel');
  console.log('[DS-Agent v2.5] Panel injected. Pet:', !!pet, 'Panel:', !!panel, 'Panel display:', panel ? panel.style.display : 'N/A');

  var __ds_healthTimer = null;

  function startHealthPolling() {
    if (__ds_healthTimer) clearInterval(__ds_healthTimer);
    function check() {
      try {
        if (window.checkServerStatus) {
          window.checkServerStatus();
        } else if (window.checkServerHealth) {
          window.checkServerHealth().then(function(r) { updateServerStatusUI(r && r.healthy); });
        }
      } catch(e) {}
    }
    check();
    __ds_healthTimer = setInterval(check, 30000);
  }

  setTimeout(function() {
    startHealthPolling();
  }, 1000);

  console.log('[Agent v2.5] Panel injected with Chromium UI tokens');
})();
