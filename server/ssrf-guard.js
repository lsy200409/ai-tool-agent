/**
 * SSRF 防护模块 — 参考 Claude Code 的 ssrfGuard.ts
 *
 * 防止工具执行中的 HTTP 请求访问云元数据端点和内部基础设施
 *
 * 阻断的 IP 范围:
 *   - 0.0.0.0/8      (当前网络)
 *   - 10.0.0.0/8     (A类私有)
 *   - 100.64.0.0/10  (CGNAT)
 *   - 127.0.0.0/8    (回环) — 允许例外
 *   - 169.254.0.0/16 (链路本地/云元数据)
 *   - 172.16.0.0/12  (B类私有)
 *   - 192.168.0.0/16 (C类私有)
 *   - ::/128         (IPv6 未指定)
 *   - ::1/128        (IPv6 回环) — 允许例外
 *   - fc00::/7       (IPv6 唯一本地)
 *   - fe80::/10      (IPv6 链路本地)
 */

var dns = require('dns');

// 阻断的 IPv4 范围
var BLOCKED_IPV4_RANGES = [
  { start: '0.0.0.0', end: '0.255.255.255' },       // 当前网络
  { start: '10.0.0.0', end: '10.255.255.255' },      // A类私有
  { start: '100.64.0.0', end: '100.127.255.255' },   // CGNAT
  { start: '169.254.0.0', end: '169.254.255.255' },  // 链路本地/云元数据
  { start: '172.16.0.0', end: '172.31.255.255' },    // B类私有
  { start: '192.168.0.0', end: '192.168.255.255' },  // C类私有
  { start: '224.0.0.0', end: '239.255.255.255' },    // 组播
  { start: '240.0.0.0', end: '255.255.255.255' }     // 保留
];

// 允许的回环地址（本地开发）
var ALLOWED_LOOPBACK = [
  '127.0.0.1', '::1'
];

/**
 * IPv4 地址转整数
 */
function ipv4ToInt(ip) {
  var parts = ip.split('.');
  return ((parseInt(parts[0]) << 24) + (parseInt(parts[1]) << 16) +
          (parseInt(parts[2]) << 8) + parseInt(parts[3])) >>> 0;
}

/**
 * 检查 IP 是否在阻断范围内
 */
function isBlockedIP(ip) {
  // 允许回环地址（本地开发需要）
  if (ALLOWED_LOOPBACK.indexOf(ip) >= 0) return false;

  // IPv4 检查
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    var ipInt = ipv4ToInt(ip);
    for (var i = 0; i < BLOCKED_IPV4_RANGES.length; i++) {
      var range = BLOCKED_IPV4_RANGES[i];
      if (ipInt >= ipv4ToInt(range.start) && ipInt <= ipv4ToInt(range.end)) {
        return true;
      }
    }
    return false;
  }

  // IPv6 检查
  if (ip.indexOf(':') >= 0) {
    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    var v4Match = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
    if (v4Match) return isBlockedIP(v4Match[1]);

    // IPv6 回环
    if (ip === '::1') return false;
    // IPv6 链路本地
    if (/^fe80:/i.test(ip)) return true;
    // IPv6 唯一本地
    if (/^f[cd]/i.test(ip)) return true;
    // IPv6 未指定
    if (ip === '::') return true;
  }

  return false;
}

/**
 * 验证 URL 是否安全（不含 SSRF 风险）
 * @param {string} url - 要验证的 URL
 * @returns {{ safe: boolean, reason?: string }}
 */
function validateUrl(url) {
  try {
    var parsed = new URL(url);
    var hostname = parsed.hostname;

    // 检查是否是 IP 地址
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      if (isBlockedIP(hostname)) {
        return { safe: false, reason: '目标 IP 在私有/保留范围内: ' + hostname };
      }
    }

    // 检查 localhost 变体
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return { safe: true }; // 允许本地开发
    }

    // 检查可疑主机名
    if (hostname === '0.0.0.0') {
      return { safe: false, reason: '不允许连接到 0.0.0.0' };
    }

    // 检查元数据端点
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal' ||
        hostname === 'metadata.azure.com') {
      return { safe: false, reason: '不允许访问云元数据端点: ' + hostname };
    }

    return { safe: true };
  } catch (e) {
    return { safe: false, reason: 'URL 解析失败: ' + e.message };
  }
}

/**
 * DNS 级别 SSRF 防护 — 解析域名后验证 IP
 * @param {string} hostname - 域名
 * @param {function} callback - callback(err, isSafe)
 */
function ssrfGuardedLookup(hostname, callback) {
  // 本地地址直接放行
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return callback(null, true);
  }

  dns.lookup(hostname, function(err, address) {
    if (err) return callback(err);
    if (isBlockedIP(address)) {
      return callback(null, false, address);
    }
    callback(null, true, address);
  });
}

module.exports = {
  isBlockedIP: isBlockedIP,
  validateUrl: validateUrl,
  ssrfGuardedLookup: ssrfGuardedLookup
};
