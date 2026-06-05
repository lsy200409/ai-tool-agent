/**
 * 平台适配器基类 — 所有平台适配器必须实现这些方法
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

  // 输入值设置（不同平台可能需要不同的 React 事件处理）
  setInputValue: function(element, value) {},

  // 发送消息
  sendMessage: function() { return false; }
};
