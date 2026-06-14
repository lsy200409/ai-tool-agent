/**
 * 平台适配器基类 — 所有平台适配器必须实现这些方法
 * 提供通用默认实现，子适配器可按需覆盖
 */
var PlatformAdapter = {
  // 平台标识
  id: '',           // 如 'deepseek', 'chatgpt', 'kimi'
  name: '',         // 显示名称
  hostPattern: null, // 匹配主机名的正则，如 /chat\.deepseek\.com/

  // SSE 拦截配置
  sse: {
    // 匹配 API 请求 URL 的正则
    apiPattern: null,  // 如 /chat\/completion/
    // 从 SSE chunk 中提取文本内容
    extractContent: function(chunk) { return null; },
    // 检测流结束
    detectStreamEnd: function(chunk) { return null; },
    // 检测流关闭事件
    detectEventClose: function(eventType, chunk) { return null; },
    // 是否使用二进制流（如 Kimi 的 Connect RPC）
    binaryStream: false,
    // 解析二进制流帧
    parseBinaryFrame: function(buffer) { return null; }
  },

  // DOM 选择器
  dom: {
    // 输入框选择器列表（按优先级排序）
    chatInputSelectors: [],
    // 发送按钮选择器/检测函数
    findSendButton: function() { return null; },
    // AI 消息内容选择器
    aiMessageSelectors: [],
    // 思考内容选择器（用于排除）
    thinkContentSelector: '',
    // 用户消息容器选择器
    userMessageSelector: '',
    // 区分用户/AI消息的方法
    isUserMessage: function(el) { return false; },
    // 流式输出检测
    detectStreaming: function() { return false; }
  },

  /**
   * 默认 Enter 键发送回退方案
   * 大多数平台使用 Enter 发送，Kimi 使用 Ctrl+Enter 需覆盖
   */
  sendMessageFallback: function(input) {
    if (!input) return false;
    input.focus();
    var evt = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    input.dispatchEvent(new KeyboardEvent('keydown', evt));
    input.dispatchEvent(new KeyboardEvent('keypress', evt));
    input.dispatchEvent(new KeyboardEvent('keyup', evt));
    return true;
  },

  /**
   * 默认使用原生 setter 设置 textarea 值
   * 适用于 React/Vue 等框架的 textarea
   */
  setInputValueNative: function(input, value) {
    var nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  },

  /**
   * 默认判断是否为用户消息
   * 通过 data-role/data-author 属性和 className 判断
   */
  isUserMessage: function(el) {
    if (el.getAttribute('data-role') === 'user') return true;
    if (el.getAttribute('data-author') === 'user') return true;
    var cls = (el.className || '');
    if (cls.indexOf('user-message') >= 0 || cls.indexOf('human-message') >= 0) return true;
    if (cls.indexOf('assistant') >= 0 || cls.indexOf('bot') >= 0 || cls.indexOf('ai') >= 0) return false;
    return null; // unknown
  },

  /**
   * 默认清空输入框
   */
  clearInput: function(input) {
    if (!input) return;
    var nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeSetter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  },

  // 输入值设置（不同平台可能需要不同的 React 事件处理）
  setInputValue: function(element, value) {},

  // 发送消息
  sendMessage: function() { return false; }
};
