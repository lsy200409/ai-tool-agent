/**
 * CLI-Anything 适配器
 *
 * 将 CLI-Anything / CLI-Hub 的命令行工具包装为 AI Tool Agent 插件。
 * 核心依赖: pip install cli-anything-hub
 *
 * 提供的工具:
 *   cli_hub_list    — 浏览 CLI 注册表
 *   cli_hub_search  — 按关键词搜索 CLI
 *   cli_hub_info    — 查看某个 CLI 的详细信息
 *   cli_hub_install — 安装一个 CLI
 *   cli_hub_launch  — 运行已安装的 CLI
 *   cli_hub_update  — 更新已安装的 CLI
 *   cli_hub_uninstall — 卸载 CLI
 */

var childProcess = require('child_process');

// 检测 cli-hub 是否可用（优先 Windows 原生，回退到 WSL）
var _cliHubCmd = null;

function findCliHub() {
  // 1. 尝试 Windows 原生 cli-hub
  try {
    var result = childProcess.execSync('cli-hub --version', {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true
    });
    _cliHubCmd = 'cli-hub';
    return { available: true, version: (result || '').trim(), mode: 'native' };
  } catch (e) {
    // Windows 原生不可用
  }

  // 2. 尝试 WSL 中的 cli-hub
  try {
    var result = childProcess.execSync(
      'wsl bash -c \'export PATH="$HOME/.local/bin:$PATH"; cli-hub --version\'',
      { encoding: 'utf-8', timeout: 10000, windowsHide: true }
    );
    _cliHubCmd = 'wsl';
    return { available: true, version: (result || '').trim(), mode: 'wsl' };
  } catch (e) {
    return { available: false, error: e.message };
  }
}

// 执行 cli-hub 命令
function execCliHub(args, timeout) {
  return new Promise(function (resolve) {
    var cmd;
    if (_cliHubCmd === 'wsl') {
      // 通过 WSL 执行，确保 PATH 包含 ~/.local/bin
      cmd = 'wsl bash -c \'export PATH="$HOME/.local/bin:$PATH"; cli-hub ' + args.replace(/'/g, "'\\''") + '\'';
    } else {
      cmd = 'cli-hub ' + args;
    }
    childProcess.exec(cmd, {
      encoding: 'utf-8',
      timeout: timeout || 30000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      shell: true
    }, function (err, stdout, stderr) {
      if (err) {
        resolve({
          success: false,
          error: (stderr || err.message || '').trim(),
          exitCode: err.code || -1
        });
      } else {
        resolve({
          success: true,
          output: (stdout || '').trim(),
          stderr: (stderr || '').trim()
        });
      }
    });
  });
}

// 解析 cli-hub list 的输出，提取结构化数据
function parseListOutput(output) {
  if (!output) return [];
  var items = [];
  var lines = output.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line || line.match(/^[-=]+$/) || line.match(/^Name\b/i) || line.match(/^Total/i)) continue;
    // 尝试解析表格格式: name  description  status
    var parts = line.split(/\s{2,}/);
    if (parts.length >= 1 && parts[0]) {
      items.push({
        name: parts[0],
        description: parts[1] || '',
        status: parts[2] || ''
      });
    }
  }
  return items;
}

module.exports = function register(api) {
  var pluginId = api.id;

  // 启动时检测 cli-hub 可用性
  var hubStatus = findCliHub();
  if (!hubStatus.available) {
    console.log('[cli-anything] cli-hub 不可用，请先安装: pip install cli-anything-hub');
    console.log('[cli-anything] 错误: ' + hubStatus.error);
  } else {
    console.log('[cli-anything] cli-hub 已就绪: ' + hubStatus.version);
  }

  api.registerTool(function () {
    return [
      {
        name: 'cli_hub_list',
        label: 'CLI-Hub List',
        description: '浏览 CLI-Hub 注册表中所有可用的 CLI 工具。参数: category(可选分类筛选)',
        parameters: {
          type: 'object',
          properties: {
            category: { type: 'string', description: '可选分类筛选(如 image, video, cad)' }
          },
          required: []
        },
        execute: async function (toolCallId, args) {
          if (!hubStatus.available) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: 'cli-hub 未安装，请先执行: pip install cli-anything-hub' }) }];
          }
          var cmdArgs = 'list';
          if (args.category) cmdArgs += ' --category ' + args.category;
          var result = await execCliHub(cmdArgs);
          if (result.success) {
            var items = parseListOutput(result.output);
            return [{ type: 'text', text: JSON.stringify({ success: true, total: items.length, items: items, raw: result.output }) }];
          }
          return [{ type: 'text', text: JSON.stringify(result) }];
        }
      },
      {
        name: 'cli_hub_search',
        label: 'CLI-Hub Search',
        description: '按关键词搜索 CLI-Hub 注册表中的 CLI 工具。参数: query(搜索关键词)',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词(如 gimp, blender, image)' }
          },
          required: ['query']
        },
        execute: async function (toolCallId, args) {
          if (!hubStatus.available) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: 'cli-hub 未安装' }) }];
          }
          if (!args.query) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: '缺少 query 参数' }) }];
          }
          var result = await execCliHub('search ' + args.query);
          if (result.success) {
            var items = parseListOutput(result.output);
            return [{ type: 'text', text: JSON.stringify({ success: true, query: args.query, total: items.length, items: items, raw: result.output }) }];
          }
          return [{ type: 'text', text: JSON.stringify(result) }];
        }
      },
      {
        name: 'cli_hub_info',
        label: 'CLI-Hub Info',
        description: '查看某个 CLI 工具的详细信息(命令列表、参数、依赖)。参数: name(CLI名称)',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'CLI 名称(如 gimp, blender, libreoffice)' }
          },
          required: ['name']
        },
        execute: async function (toolCallId, args) {
          if (!hubStatus.available) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: 'cli-hub 未安装' }) }];
          }
          if (!args.name) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: '缺少 name 参数' }) }];
          }
          var result = await execCliHub('info ' + args.name);
          return [{ type: 'text', text: JSON.stringify({ success: result.success, name: args.name, info: result.output || result.error, raw: result.output || '' }) }];
        }
      },
      {
        name: 'cli_hub_install',
        label: 'CLI-Hub Install',
        description: '从 CLI-Hub 安装一个 CLI 工具。安装后可通过 cli_hub_launch 调用。参数: name(CLI名称)',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'CLI 名称(如 gimp, blender, libreoffice)' }
          },
          required: ['name']
        },
        execute: async function (toolCallId, args) {
          if (!hubStatus.available) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: 'cli-hub 未安装，请先执行: pip install cli-anything-hub' }) }];
          }
          if (!args.name) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: '缺少 name 参数' }) }];
          }
          // 安装可能需要较长时间
          var result = await execCliHub('install ' + args.name, 120000);
          if (result.success) {
            return [{ type: 'text', text: JSON.stringify({ success: true, name: args.name, message: 'CLI 已安装: ' + args.name, output: result.output }) }];
          }
          return [{ type: 'text', text: JSON.stringify({ success: false, name: args.name, error: result.error, hint: '可能需要先安装上游软件(如 GIMP/Blender)' }) }];
        }
      },
      {
        name: 'cli_hub_launch',
        label: 'CLI-Hub Launch',
        description: '运行已安装的 CLI 工具，传入子命令和参数。参数: name(CLI名称), args(子命令和参数)',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'CLI 名称(如 gimp, blender)' },
            args: { type: 'string', description: '子命令和参数(如 "open --file photo.xcf")' }
          },
          required: ['name']
        },
        execute: async function (toolCallId, args) {
          if (!hubStatus.available) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: 'cli-hub 未安装' }) }];
          }
          if (!args.name) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: '缺少 name 参数' }) }];
          }
          var cmdArgs = 'launch ' + args.name;
          if (args.args) cmdArgs += ' ' + args.args;
          var result = await execCliHub(cmdArgs, 60000);
          return [{ type: 'text', text: JSON.stringify({ success: result.success, name: args.name, output: result.output || result.error, exitCode: result.exitCode }) }];
        }
      },
      {
        name: 'cli_hub_update',
        label: 'CLI-Hub Update',
        description: '更新已安装的 CLI 工具到最新版本。参数: name(CLI名称)',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'CLI 名称' }
          },
          required: ['name']
        },
        execute: async function (toolCallId, args) {
          if (!hubStatus.available) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: 'cli-hub 未安装' }) }];
          }
          if (!args.name) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: '缺少 name 参数' }) }];
          }
          var result = await execCliHub('update ' + args.name, 120000);
          return [{ type: 'text', text: JSON.stringify({ success: result.success, name: args.name, output: result.output || result.error }) }];
        }
      },
      {
        name: 'cli_hub_uninstall',
        label: 'CLI-Hub Uninstall',
        description: '卸载已安装的 CLI 工具。参数: name(CLI名称)',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'CLI 名称' }
          },
          required: ['name']
        },
        execute: async function (toolCallId, args) {
          if (!hubStatus.available) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: 'cli-hub 未安装' }) }];
          }
          if (!args.name) {
            return [{ type: 'text', text: JSON.stringify({ success: false, error: '缺少 name 参数' }) }];
          }
          var result = await execCliHub('uninstall ' + args.name);
          return [{ type: 'text', text: JSON.stringify({ success: result.success, name: args.name, output: result.output || result.error }) }];
        }
      }
    ];
  });
};
