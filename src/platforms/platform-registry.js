/**
 * 平台适配器注册表 — 管理所有已注册的平台适配器
 */
(function() {
  var PlatformRegistry = {
    _adapters: {},
    _current: null,

    /**
     * 注册平台适配器
     * @param {Object} adapter - 平台适配器对象
     */
    register: function(adapter) {
      if (!adapter || !adapter.id) {
        console.error('[PlatformRegistry] 注册失败：适配器缺少 id');
        return;
      }
      this._adapters[adapter.id] = adapter;
      console.log('[PlatformRegistry] 已注册平台适配器：' + adapter.id + ' (' + adapter.name + ')');
    },

    /**
     * 根据当前页面 URL 自动检测平台
     * @returns {Object|null} 匹配的适配器或 null
     */
    detect: function() {
      var host = window.location.hostname;
      for (var id in this._adapters) {
        if (!this._adapters.hasOwnProperty(id)) continue;
        var adapter = this._adapters[id];
        if (adapter.hostPattern && adapter.hostPattern.test(host)) {
          this._current = adapter;
          console.log('[PlatformRegistry] 检测到平台：' + adapter.id + ' (' + adapter.name + ')');
          return adapter;
        }
      }
      console.log('[PlatformRegistry] 未检测到匹配的平台，当前主机：' + host);
      return null;
    },

    /**
     * 获取当前平台适配器
     * @returns {Object|null} 当前适配器或 null
     */
    getCurrent: function() {
      if (!this._current) this.detect();
      return this._current;
    },

    /**
     * 获取所有已注册平台
     * @returns {Object} 适配器映射表
     */
    getAll: function() {
      return this._adapters;
    },

    /**
     * 根据 id 获取指定平台适配器
     * @param {string} id - 平台标识
     * @returns {Object|null} 适配器或 null
     */
    get: function(id) {
      return this._adapters[id] || null;
    },

    /**
     * 重置当前检测状态（用于页面导航后重新检测）
     */
    reset: function() {
      this._current = null;
    }
  };

  // 导出到全局
  window.PlatformRegistry = PlatformRegistry;
})();
