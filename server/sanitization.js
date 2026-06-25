/**
 * Unicode 净化模块 — 参考 Claude Code 的 sanitization.ts
 * 防御 ASCII Smuggling / Hidden Prompt Injection 攻击
 */

// 危险 Unicode 类别和范围
var DANGEROUS_RANGES = [
  /[\u200B-\u200D]/g,       // 零宽空格 (ZWSP, ZWNJ, ZWJ)
  /[\u200E-\u200F]/g,       // LTR/RTL 标记
  /[\u202A-\u202E]/g,       // 方向格式 (LRE, RLE, PDF, LRO, RLO)
  /[\u2060-\u2069]/g,       // 字连接符 + 方向隔离
  /[\u206A-\u206F]/g,       // 废弃的方向控制
  /[\uFEFF]/g,              // BOM (零宽不换行空格)
  /[\uFFF9-\uFFFB]/g,       // 行间注解
  /[\uE000-\uF8FF]/g,       // 私用区
  /[\u{1F000}-\u{1FFFF}]/gu // 补充私用区 + 变体选择器
];

var MAX_SANITIZE_ITERATIONS = 10;

/**
 * 净化字符串中的危险 Unicode 字符
 * @param {string} text 输入文本
 * @returns {string} 净化后的文本
 */
function sanitizeUnicode(text) {
  if (typeof text !== 'string') return text;

  var result = text;
  for (var i = 0; i < MAX_SANITIZE_ITERATIONS; i++) {
    var prev = result;
    for (var r = 0; r < DANGEROUS_RANGES.length; r++) {
      result = result.replace(DANGEROUS_RANGES[r], '');
    }
    if (result === prev) break; // 收敛
  }
  return result;
}

/**
 * 递归净化对象中的所有字符串
 */
function sanitizeDeep(obj) {
  if (typeof obj === 'string') return sanitizeUnicode(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeDeep);
  if (obj && typeof obj === 'object') {
    var clean = {};
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        clean[key] = sanitizeDeep(obj[key]);
      }
    }
    return clean;
  }
  return obj;
}

/**
 * 净化工具调用参数
 */
function sanitizeToolArgs(args) {
  if (!args || typeof args !== 'object') return args;
  return sanitizeDeep(args);
}

module.exports = {
  sanitizeUnicode: sanitizeUnicode,
  sanitizeDeep: sanitizeDeep,
  sanitizeToolArgs: sanitizeToolArgs
};
