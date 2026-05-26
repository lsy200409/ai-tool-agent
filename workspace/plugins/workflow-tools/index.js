module.exports = function register(api) {
  var fsp = require('fs').promises;
  var fss = require('fs');
  var path = require('path');

  api.logger.info('[workflow-tools] 初始化工作流工具 v1.0.0');

  var tasksDir = path.join(api.workspaceDir || api.resolvePath(''), 'tasks');
  var taskFile = path.join(tasksDir, 'tasks.json');

  function ensureTasksDir() {
    if (!fss.existsSync(tasksDir)) fss.mkdirSync(tasksDir, { recursive: true });
  }

  function loadTasks() {
    ensureTasksDir();
    try {
      if (fss.existsSync(taskFile)) return JSON.parse(fss.readFileSync(taskFile, 'utf-8'));
    } catch(e) {}
    return [];
  }

  function saveTasks(tasks) {
    ensureTasksDir();
    fss.writeFileSync(taskFile, JSON.stringify(tasks, null, 2), 'utf-8');
  }

  api.registerTool(function(ctx) {
    return [
      {
        name: 'task_create',
        label: '创建任务',
        description: '创建定时任务提醒。设置标题、描述和截止时间，任务列表持久化存储。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '任务标题' },
            description: { type: 'string', description: '任务描述，可选' },
            deadline: { type: 'string', description: '截止时间，ISO格式如 2026-06-01T18:00:00，可选' },
            tags: { type: 'string', description: '标签，逗号分隔，如"自媒体,小红书"，可选' }
          },
          required: ['title']
        },
        execute: async function(args) {
          var tasks = loadTasks();
          var task = {
            id: 'task_' + Date.now().toString(36),
            title: args.title,
            description: args.description || '',
            deadline: args.deadline || '',
            tags: args.tags ? args.tags.split(',').map(function(t) { return t.trim(); }) : [],
            status: 'pending',
            createdAt: new Date().toISOString()
          };
          tasks.push(task);
          saveTasks(tasks);
          return JSON.stringify({ success: true, task: task, total: tasks.length });
        }
      },
      {
        name: 'task_list',
        label: '任务列表',
        description: '列出所有已创建的定时任务，支持按状态筛选(pending/done/all)',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', description: '状态筛选: pending/done/all，默认 all' }
          },
          required: []
        },
        execute: async function(args) {
          var tasks = loadTasks();
          var status = args.status || 'all';
          if (status !== 'all') {
            tasks = tasks.filter(function(t) { return t.status === status; });
          }
          var overdue = tasks.filter(function(t) {
            return t.status === 'pending' && t.deadline && new Date(t.deadline) < new Date();
          });
          return JSON.stringify({
            total: tasks.length, overdue: overdue.length,
            tasks: tasks.map(function(t) { return { id: t.id, title: t.title, status: t.status, deadline: t.deadline, tags: t.tags }; })
          });
        }
      },
      {
        name: 'task_done',
        label: '完成任务',
        description: '将指定任务标记为已完成',
        parameters: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: '任务ID' }
          },
          required: ['task_id']
        },
        execute: async function(args) {
          var tasks = loadTasks();
          var found = null;
          for (var i = 0; i < tasks.length; i++) {
            if (tasks[i].id === args.task_id) { found = tasks[i]; tasks[i].status = 'done'; break; }
          }
          if (!found) return JSON.stringify({ error: '未找到任务: ' + args.task_id });
          saveTasks(tasks);
          return JSON.stringify({ success: true, task: found.title });
        }
      },
      {
        name: 'data_convert',
        label: '数据转换',
        description: '将JSON数据转换为CSV或Markdown表格格式，方便导入Excel或Notion。',
        parameters: {
          type: 'object',
          properties: {
            data: { type: 'string', description: 'JSON数组格式的数据，如[{"name":"A","val":1}]' },
            format: { type: 'string', description: '输出格式: csv/markdown/table，默认 csv' }
          },
          required: ['data']
        },
        execute: async function(args) {
          try {
            var rows = JSON.parse(args.data);
            if (!Array.isArray(rows) || rows.length === 0) return JSON.stringify({ error: '数据必须是有效的非空JSON数组' });
            var format = args.format || 'csv';
            var keys = Object.keys(rows[0]);
            var result = '';

            if (format === 'csv') {
              result = keys.join(',') + '\n';
              for (var i = 0; i < rows.length; i++) {
                result += keys.map(function(k) {
                  var v = String(rows[i][k] || '');
                  if (v.indexOf(',') >= 0 || v.indexOf('"') >= 0) v = '"' + v.replace(/"/g, '""') + '"';
                  return v;
                }).join(',') + '\n';
              }
            } else if (format === 'markdown' || format === 'table') {
              result = '| ' + keys.join(' | ') + ' |\n';
              result += '| ' + keys.map(function() { return '---'; }).join(' | ') + ' |\n';
              for (var i = 0; i < rows.length; i++) {
                result += '| ' + keys.map(function(k) { return String(rows[i][k] || ''); }).join(' | ') + ' |\n';
              }
            }

            return JSON.stringify({ success: true, format: format, result: result, rows: rows.length });
          } catch(e) {
            return JSON.stringify({ error: 'JSON解析失败: ' + e.message });
          }
        }
      }
    ];
  });
};