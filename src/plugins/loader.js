var __plugins = [];

function registerPlugin(name, entry) {
  __plugins.push({ name: name, entry: entry });
}

function loadPlugins() {
  for (var i = 0; i < __plugins.length; i++) {
    try {
      var p = __plugins[i];
      if (typeof p.entry === 'function') p.entry();
    } catch(e) {
      console.warn('[DS Agent] 插件加载失败:', __plugins[i].name, e.message);
    }
  }
}
