/**
 * 插件沙箱代理模块 — 受限的 fs 和 http/https
 * 
 * 设计原则:
 *   - fs: 仅允许 workspace 目录内的操作，禁止访问系统路径
 *   - http/https: 集成 SSRF 防护，禁止访问私有 IP 和云元数据端点
 *   - 代理透明: 插件代码无需修改，require('fs') 返回代理对象
 */

var fs = require('fs');
var path = require('path');
var ssrfGuard = require('./ssrf-guard');

// ═══════════════════════════════════════════════════════════
// 受限 fs 代理
// ═══════════════════════════════════════════════════════════

/**
 * 创建受限 fs 代理
 * @param {string} workspaceDir - 允许访问的工作目录
 * @param {string} pluginId - 插件 ID（用于日志）
 * @returns {Object} 代理 fs 对象
 */
function createSandboxedFs(workspaceDir, pluginId) {
  var allowedRoot = path.resolve(workspaceDir);

  // 检查目标路径是否在 workspace 内
  function isPathAllowed(targetPath) {
    var resolved = path.resolve(targetPath);
    return resolved.startsWith(allowedRoot + path.sep) || resolved === allowedRoot;
  }

  // 路径安全守卫 — 包装回调风格的 fs 方法
  function guardPath(targetPath) {
    if (!isPathAllowed(targetPath)) {
      throw new Error('[PluginSandbox] 插件 ' + pluginId + ' 无权访问 workspace 外路径: ' + targetPath);
    }
    return targetPath;
  }

  // 创建代理对象 — 代理所有 fs 方法
  var proxy = {};

  // 同步方法列表
  var syncMethods = [
    'existsSync', 'mkdirSync', 'readFileSync', 'writeFileSync',
    'appendFileSync', 'unlinkSync', 'readdirSync', 'statSync',
    'lstatSync', 'chmodSync', 'renameSync', 'copyFileSync',
    'readlinkSync', 'symlinkSync', 'rmdirSync', 'rmSync',
    'truncateSync', 'watchFileSync', 'unwatchFileSync'
  ];

  // 异步回调方法列表
  var asyncMethods = [
    'exists', 'mkdir', 'readFile', 'writeFile',
    'appendFile', 'unlink', 'readdir', 'stat',
    'lstat', 'chmod', 'rename', 'copyFile',
    'readlink', 'symlink', 'rmdir', 'rm',
    'truncate', 'watch', 'watchFile', 'unwatchFile',
    'open', 'close', 'read', 'write'
  ];

  // 代理同步方法
  syncMethods.forEach(function(method) {
    if (typeof fs[method] === 'function') {
      proxy[method] = function() {
        var args = Array.prototype.slice.call(arguments);
        // 第一个参数通常是路径
        if (args.length > 0 && typeof args[0] === 'string') {
          guardPath(args[0]);
        }
        return fs[method].apply(fs, args);
      };
    }
  });

  // 代理异步回调方法
  asyncMethods.forEach(function(method) {
    if (typeof fs[method] === 'function') {
      proxy[method] = function() {
        var args = Array.prototype.slice.call(arguments);
        // 第一个参数通常是路径
        if (args.length > 0 && typeof args[0] === 'string') {
          guardPath(args[0]);
        }
        return fs[method].apply(fs, args);
      };
    }
  });

  // 代理 fs.promises — 返回受限的 Promise 版本
  if (fs.promises) {
    proxy.promises = {};
    var promiseMethods = [
      'readFile', 'writeFile', 'appendFile', 'unlink',
      'readdir', 'stat', 'lstat', 'mkdir', 'rmdir', 'rm',
      'rename', 'copyFile', 'readlink', 'symlink', 'truncate',
      'open', 'chmod', 'access', 'appendFile', 'watch'
    ];

    promiseMethods.forEach(function(method) {
      if (typeof fs.promises[method] === 'function') {
        proxy.promises[method] = function() {
          var args = Array.prototype.slice.call(arguments);
          if (args.length > 0 && typeof args[0] === 'string') {
            guardPath(args[0]);
          }
          return fs.promises[method].apply(fs.promises, args);
        };
      }
    });

    // fs.promises.open 返回 FileHandle，也需要代理
    if (typeof fs.promises.open === 'function') {
      proxy.promises.open = function() {
        var args = Array.prototype.slice.call(arguments);
        if (args.length > 0 && typeof args[0] === 'string') {
          guardPath(args[0]);
        }
        return fs.promises.open.apply(fs.promises, args);
      };
    }
  }

  // 代理 createReadStream / createWriteStream
  proxy.createReadStream = function(filePath, options) {
    guardPath(filePath);
    return fs.createReadStream(filePath, options);
  };

  proxy.createWriteStream = function(filePath, options) {
    guardPath(filePath);
    return fs.createWriteStream(filePath, options);
  };

  // 常量直接透传
  proxy.F_OK = fs.F_OK;
  proxy.R_OK = fs.R_OK;
  proxy.W_OK = fs.W_OK;
  proxy.X_OK = fs.X_OK;
  proxy.constants = fs.constants;

  return proxy;
}

// ═══════════════════════════════════════════════════════════
// 受限 http/https 代理
// ═══════════════════════════════════════════════════════════

/**
 * 创建受限 http 代理
 * @param {string} pluginId - 插件 ID
 * @param {Object} nativeModule - 原生 http 或 https 模块
 * @returns {Object} 代理 http 对象
 */
function createSandboxedHttp(pluginId, nativeModule) {
  var proxy = {};

  // 代理 request 方法 — 添加 SSRF 防护
  proxy.request = function(options, callback) {
    // 提取 URL/hostname
    var hostname = '';
    var urlStr = '';

    if (typeof options === 'string') {
      urlStr = options;
    } else if (options && typeof options === 'object') {
      hostname = options.hostname || options.host || '';
      if (options.port) hostname += ':' + options.port;
      if (options.protocol) urlStr = options.protocol + '//' + hostname;
    }

    // SSRF 检查
    if (urlStr) {
      var ssrfResult = ssrfGuard.validateUrl(urlStr);
      if (!ssrfResult.safe) {
        var err = new Error('[PluginSandbox] 插件 ' + pluginId + ' SSRF 防护: ' + ssrfResult.reason);
        if (typeof callback === 'function') {
          process.nextTick(function() { callback(err); });
        }
        // 返回一个会立即 emit error 的伪请求
        var fakeReq = new (require('events').EventEmitter)();
        fakeReq.end = function() { this.emit('error', err); };
        fakeReq.write = function() { return true; };
        process.nextTick(function() { fakeReq.emit('error', err); });
        return fakeReq;
      }
    }

    if (hostname && !urlStr) {
      // hostname 存在但无完整 URL，检查 hostname
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|0\.0\.0\.)/.test(hostname)) {
        var err2 = new Error('[PluginSandbox] 插件 ' + pluginId + ' SSRF 防护: 目标主机在私有网络范围内');
        if (typeof callback === 'function') {
          process.nextTick(function() { callback(err2); });
        }
        var fakeReq2 = new (require('events').EventEmitter)();
        fakeReq2.end = function() { this.emit('error', err2); };
        fakeReq2.write = function() { return true; };
        process.nextTick(function() { fakeReq2.emit('error', err2); });
        return fakeReq2;
      }
    }

    return nativeModule.request.apply(nativeModule, arguments);
  };

  // 代理 get 方法
  proxy.get = function(options, callback) {
    var req = proxy.request(options, callback);
    if (req && req.end) req.end();
    return req;
  };

  // 透传常量
  proxy.STATUS_CODES = nativeModule.STATUS_CODES;
  proxy.Agent = nativeModule.Agent;
  proxy.globalAgent = nativeModule.globalAgent;

  return proxy;
}

/**
 * 沙箱化的 child_process — 只暴露 exec 和 execSync
 * - 命令经过安全分级检查（复用 tool-registry 的 classifyCommand）
 * - 危险命令被拒绝，敏感命令需要确认（由插件调用者处理）
 * - 记录所有命令执行日志
 */
function createSandboxedChildProcess(pluginId) {
  var cp = require('child_process');
  var registry = require('./tool-registry');

  var proxy = {};

  // exec — 异步执行
  proxy.exec = function(command, options, callback) {
    // 安全检查
    try {
      registry.detectDangerousCommand(command);
    } catch (e) {
      if (callback) callback(new Error('插件 ' + pluginId + ': 危险命令被拒绝: ' + command), '', '');
      return;
    }
    var level = registry.classifyCommand(command);
    console.log('[sandbox:child_process] 插件 ' + pluginId + ' 执行命令 (' + level + '): ' + command);
    if (level === 'dangerous') {
      if (callback) callback(new Error('插件 ' + pluginId + ': 危险命令被拒绝: ' + command), '', '');
      return;
    }
    return cp.exec(command, options, callback);
  };

  // execSync — 同步执行
  proxy.execSync = function(command, options) {
    try {
      registry.detectDangerousCommand(command);
    } catch (e) {
      throw new Error('插件 ' + pluginId + ': 危险命令被拒绝: ' + command);
    }
    var level = registry.classifyCommand(command);
    console.log('[sandbox:child_process] 插件 ' + pluginId + ' 同步执行命令 (' + level + '): ' + command);
    if (level === 'dangerous') {
      throw new Error('插件 ' + pluginId + ': 危险命令被拒绝: ' + command);
    }
    return cp.execSync(command, options);
  };

  // spawn — 受限暴露
  proxy.spawn = function(command, args, options) {
    var fullCmd = command + (args && args.length ? ' ' + args.join(' ') : '');
    try {
      registry.detectDangerousCommand(fullCmd);
    } catch (e) {
      throw new Error('插件 ' + pluginId + ': 危险命令被拒绝: ' + fullCmd);
    }
    var level = registry.classifyCommand(fullCmd);
    console.log('[sandbox:child_process] 插件 ' + pluginId + ' spawn (' + level + '): ' + fullCmd);
    if (level === 'dangerous') {
      throw new Error('插件 ' + pluginId + ': 危险命令被拒绝: ' + fullCmd);
    }
    return cp.spawn(command, args, options);
  };

  return proxy;
}

module.exports = {
  createSandboxedFs: createSandboxedFs,
  createSandboxedHttp: createSandboxedHttp,
  createSandboxedChildProcess: createSandboxedChildProcess
};
