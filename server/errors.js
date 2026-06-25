/**
 * 错误分层体系 — 参考 Claude Code 的 errors.ts + toolErrors.ts
 *
 * 设计原则:
 *   1. 错误类分层，每个错误类携带上下文信息
 *   2. 传给 LLM 的错误消息精简（截断堆栈、限制长度）
 *   3. 日志和遥测中的错误消息与用户看到的分离
 */

// ═══════════════════════════════════════════════════════════
// 基础错误类
// ═══════════════════════════════════════════════════════════

/**
 * 工具执行错误 — 携带工具名和参数上下文
 */
function ToolExecutionError(toolName, message, details) {
  this.name = 'ToolExecutionError';
  this.toolName = toolName;
  this.message = message;
  this.details = details || {};
  this.timestamp = Date.now();
  Error.captureStackTrace && Error.captureStackTrace(this, ToolExecutionError);
}
ToolExecutionError.prototype = Object.create(Error.prototype);
ToolExecutionError.prototype.constructor = ToolExecutionError;

/**
 * 权限拒绝错误 — 携带权限决策原因
 */
function PermissionDeniedError(toolName, reason, decisionReason) {
  this.name = 'PermissionDeniedError';
  this.toolName = toolName;
  this.message = reason || '权限拒绝';
  this.decisionReason = decisionReason || {};
  this.timestamp = Date.now();
  Error.captureStackTrace && Error.captureStackTrace(this, PermissionDeniedError);
}
PermissionDeniedError.prototype = Object.create(Error.prototype);
PermissionDeniedError.prototype.constructor = PermissionDeniedError;

/**
 * 输入验证错误 — 携带验证失败详情
 */
function InputValidationError(toolName, errors) {
  this.name = 'InputValidationError';
  this.toolName = toolName;
  this.message = '输入验证失败: ' + errors.join('; ');
  this.errors = errors;
  this.timestamp = Date.now();
  Error.captureStackTrace && Error.captureStackTrace(this, InputValidationError);
}
InputValidationError.prototype = Object.create(Error.prototype);
InputValidationError.prototype.constructor = InputValidationError;

/**
 * 安全拦截错误 — NEVER_ALLOW / 危险操作
 */
function SecurityBlockedError(toolName, reason, safetyLevel) {
  this.name = 'SecurityBlockedError';
  this.toolName = toolName;
  this.message = reason || '操作被安全规则拦截';
  this.safetyLevel = safetyLevel || 'dangerous';
  this.timestamp = Date.now();
  Error.captureStackTrace && Error.captureStackTrace(this, SecurityBlockedError);
}
SecurityBlockedError.prototype = Object.create(Error.prototype);
SecurityBlockedError.prototype.constructor = SecurityBlockedError;

// ═══════════════════════════════════════════════════════════
// 错误格式化工具
// ═══════════════════════════════════════════════════════════

/**
 * 精简错误堆栈 — 传给 LLM 的只保留前 5 帧
 * 参考 Claude Code 的 shortErrorStack()
 */
function shortErrorStack(err, maxFrames) {
  maxFrames = maxFrames || 5;
  if (!err || !err.stack) return String(err);
  var lines = err.stack.split('\n');
  return lines.slice(0, maxFrames + 1).join('\n');
}

/**
 * 格式化错误消息 — 超长时截断
 * 参考 Claude Code 的 formatError()
 */
function formatError(err, maxLength) {
  maxLength = maxLength || 10000;
  var msg = err instanceof Error ? err.message : String(err);
  if (msg.length <= maxLength) return msg;
  var half = Math.floor(maxLength / 2);
  return msg.substring(0, half) + '\n... [省略 ' + (msg.length - maxLength) + ' 字符] ...\n' + msg.substring(msg.length - half);
}

/**
 * 将错误转为 LLM 友好的工具结果
 */
function errorToToolResult(err) {
  var result = {
    success: false,
    error: formatError(err, 2000)
  };

  if (err.toolName) result.tool = err.toolName;
  if (err.name === 'SecurityBlockedError') {
    result.blocked = true;
    result.neverAllow = err.safetyLevel === 'never_allow';
    result.safetyLevel = err.safetyLevel;
  }
  if (err.name === 'PermissionDeniedError') {
    result.blocked = true;
    result.denied = true;
    result.decisionReason = err.decisionReason;
  }
  if (err.name === 'InputValidationError') {
    result.validationError = true;
    result.errors = err.errors;
  }

  return result;
}

module.exports = {
  ToolExecutionError: ToolExecutionError,
  PermissionDeniedError: PermissionDeniedError,
  InputValidationError: InputValidationError,
  SecurityBlockedError: SecurityBlockedError,
  shortErrorStack: shortErrorStack,
  formatError: formatError,
  errorToToolResult: errorToToolResult
};
