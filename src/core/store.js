/**
 * 极简不可变 Store — 参考 Claude Code 的 state/store.ts
 *
 * 设计原则:
 *   1. setState 接受 updater 函数，返回新对象（不可变更新）
 *   2. subscribe 返回取消订阅函数
 *   3. 单次实例，全局共享
 *
 * 用法:
 *   var store = createStore({ count: 0 });
 *   store.subscribe(function() { console.log(store.getState()); });
 *   store.setState(function(prev) { return { count: prev.count + 1 }; });
 */

function createStore(initialState) {
  var state = initialState;
  var listeners = [];

  function getState() {
    return state;
  }

  function setState(updater) {
    var nextState = typeof updater === 'function' ? updater(state) : updater;
    if (nextState === state) return; // 无变化，不通知
    state = nextState;
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i]();
      } catch (e) {
        console.error('[Store] listener error:', e);
      }
    }
  }

  function subscribe(listener) {
    listeners.push(listener);
    return function unsubscribe() {
      var idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  return { getState: getState, setState: setState, subscribe: subscribe };
}

// ═══════════════════════════════════════════════════════════
// 全局应用状态 — 统一管理分散的状态
// ═══════════════════════════════════════════════════════════
var APP_STATE = createStore({
  // 服务器状态
  server: {
    connected: false,
    url: 'http://localhost:3002',
    mode: 'disconnected'  // 'native' | 'http' | 'disconnected'
  },
  // 监控状态
  monitor: {
    state: 'idle',  // 'idle' | 'listening' | 'ai_streaming' | 'ai_done' | 'executing_tools'
    autoWatch: false,
    sseEnabled: false,
    sseActive: false
  },
  // 工具执行
  tools: {
    executing: false,
    currentTool: null,
    chainProgress: { current: 0, total: 0 },
    iterations: 0
  },
  // 权限
  permissions: {
    globalPermissions: false,
    deniedCount: 0
  },
  // UI
  ui: {
    panelOpen: false,
    logFilter: 'all'
  }
});

// 便捷访问器
function getAppState() { return APP_STATE.getState(); }
function updateAppState(updater) { APP_STATE.setState(updater); }
function onAppStateChange(listener) { return APP_STATE.subscribe(listener); }

// 暴露到全局
window.__ds_store = APP_STATE;
window.__ds_getAppState = getAppState;
window.__ds_updateAppState = updateAppState;
window.__ds_onAppStateChange = onAppStateChange;
