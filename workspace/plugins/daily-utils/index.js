module.exports = function register(api) {
  var fsp = require('fs').promises;
  var fss = require('fs');
  var path = require('path');

  api.logger.info('[daily-utils] 初始化日常工具集 v1.0.0');

  var dataDir = path.join(api.resolvePath(''), '..', 'daily_data');
  if (!fss.existsSync(dataDir)) fss.mkdirSync(dataDir, { recursive: true });

  var todoFile = path.join(dataDir, 'todos.json');

  function loadTodos() {
    try {
      if (fss.existsSync(todoFile)) return JSON.parse(fss.readFileSync(todoFile, 'utf-8'));
    } catch(e) {}
    return [];
  }

  function saveTodos(todos) {
    fss.writeFileSync(todoFile, JSON.stringify(todos, null, 2), 'utf-8');
  }

  api.registerTool(function(ctx) {
    return [
      {
        name: 'daily_todo',
        label: '待办清单',
        description: '管理待办事项。参数: action(操作: add/list/done/delete), task(任务名称), id(任务ID, done/delete时需要)',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: '操作: add(添加), list(查看列表), done(标记完成), delete(删除)' },
            task: { type: 'string', description: '任务名称(add时需要)' },
            priority: { type: 'string', description: '优先级: high/medium/low(默认medium)' },
            id: { type: 'string', description: '任务ID(完成/删除时需要)' }
          },
          required: ['action']
        },
        execute: async function(toolCallId, args) {
          try {
            var todos = loadTodos();
            var action = args.action;

            if (action === 'add') {
              if (!args.task) return [{ type: 'text', text: JSON.stringify({ success: false, error: '请提供任务名称' }) }];
              var newTodo = { id: 'todo_' + Date.now().toString(36), task: args.task, priority: args.priority || 'medium', done: false, createdAt: new Date().toISOString() };
              todos.push(newTodo);
              saveTodos(todos);
              return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_todo', action: 'add', todo: newTodo, total: todos.length, active: todos.filter(function(t) { return !t.done; }).length }) }];
            }

            if (action === 'list') {
              var active = todos.filter(function(t) { return !t.done; });
              var done = todos.filter(function(t) { return t.done; });
              return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_todo', action: 'list', total: todos.length, active: active.length, done: done.length, activeList: active, doneList: done.slice(-10) }) }];
            }

            if (action === 'done') {
              if (!args.id) return [{ type: 'text', text: JSON.stringify({ success: false, error: '请提供任务ID' }) }];
              for (var i = 0; i < todos.length; i++) {
                if (todos[i].id === args.id) { todos[i].done = true; todos[i].doneAt = new Date().toISOString(); saveTodos(todos); return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_todo', action: 'done', todo: todos[i], message: '已完成: ' + todos[i].task }) }]; }
              }
              return [{ type: 'text', text: JSON.stringify({ success: false, error: '未找到该任务' }) }];
            }

            if (action === 'delete') {
              if (!args.id) return [{ type: 'text', text: JSON.stringify({ success: false, error: '请提供任务ID' }) }];
              var before = todos.length;
              todos = todos.filter(function(t) { return t.id !== args.id; });
              saveTodos(todos);
              return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_todo', action: 'delete', deleted: before - todos.length, remaining: todos.length }) }];
            }

            return [{ type: 'text', text: JSON.stringify({ success: false, error: '不支持的操作: ' + action + '，支持: add/list/done/delete' }) }];
          } catch(e) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'daily_todo', error: e.message }) }];
          }
        }
      },
      {
        name: 'daily_countdown',
        label: 'DDL倒计时',
        description: '创建和管理截止日期倒计时。参数: action(操作: add/list/delete), title(事件名称), date(日期 YYYY-MM-DD)',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: '操作: add/list/delete' },
            title: { type: 'string', description: '事件名称' },
            date: { type: 'string', description: '截止日期，格式YYYY-MM-DD' },
            id: { type: 'string', description: '事件ID(删除时需要)' }
          },
          required: ['action']
        },
        execute: async function(toolCallId, args) {
          try {
            var countdownFile = path.join(dataDir, 'countdowns.json');
            var countdowns = [];
            try { if (fss.existsSync(countdownFile)) countdowns = JSON.parse(fss.readFileSync(countdownFile, 'utf-8')); } catch(e) {}

            if (args.action === 'add') {
              if (!args.title || !args.date) return [{ type: 'text', text: JSON.stringify({ success: false, error: '请提供title和date' }) }];
              var d = new Date(args.date + 'T23:59:59');
              if (isNaN(d.getTime())) return [{ type: 'text', text: JSON.stringify({ success: false, error: '日期格式错误，请使用YYYY-MM-DD' }) }];
              var cd = { id: 'cd_' + Date.now().toString(36), title: args.title, date: args.date, deadline: d.toISOString(), createdAt: new Date().toISOString() };
              countdowns.push(cd);
              fss.writeFileSync(countdownFile, JSON.stringify(countdowns, null, 2), 'utf-8');
              var daysLeft = Math.ceil((d.getTime() - Date.now()) / 86400000);
              return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_countdown', action: 'add', countdown: cd, daysLeft: daysLeft, message: '距离「' + args.title + '」还有 ' + daysLeft + ' 天' }) }];
            }

            if (args.action === 'list') {
              var now = Date.now();
              var sorted = countdowns.slice().sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
              var result = sorted.map(function(c) {
                var days = Math.ceil((new Date(c.date + 'T23:59:59').getTime() - now) / 86400000);
                return { id: c.id, title: c.title, date: c.date, daysLeft: days, urgent: days <= 3, overdue: days < 0 };
              });
              return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_countdown', action: 'list', total: countdowns.length, countdowns: result }) }];
            }

            if (args.action === 'delete') {
              if (!args.id) return [{ type: 'text', text: JSON.stringify({ success: false, error: '请提供事件ID' }) }];
              var before = countdowns.length;
              countdowns = countdowns.filter(function(c) { return c.id !== args.id; });
              fss.writeFileSync(countdownFile, JSON.stringify(countdowns, null, 2), 'utf-8');
              return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_countdown', action: 'delete', deleted: before - countdowns.length }) }];
            }

            return [{ type: 'text', text: JSON.stringify({ success: false, error: '不支持的操作: ' + args.action }) }];
          } catch(e) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'daily_countdown', error: e.message }) }];
          }
        }
      },
      {
        name: 'daily_schedule',
        label: '课程表管理',
        description: '管理课程表。参数: action(操作: add/list/clear), day(星期: 1-7), course(课程名), time(时间段), location(地点)',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: '操作: add/list/clear' },
            day: { type: 'number', description: '星期: 1-7 (1=周一)' },
            course: { type: 'string', description: '课程名称' },
            time: { type: 'string', description: '上课时间, 如"08:00-09:40"' },
            location: { type: 'string', description: '上课地点' }
          },
          required: ['action']
        },
        execute: async function(toolCallId, args) {
          try {
            var scheduleFile = path.join(dataDir, 'schedule.json');
            var schedule = {};
            try { if (fss.existsSync(scheduleFile)) schedule = JSON.parse(fss.readFileSync(scheduleFile, 'utf-8')); } catch(e) {}

            if (args.action === 'add') {
              if (!args.day || !args.course) return [{ type: 'text', text: JSON.stringify({ success: false, error: '请提供day和course' }) }];
              var dayKey = 'day_' + args.day;
              if (!schedule[dayKey]) schedule[dayKey] = [];
              schedule[dayKey].push({ course: args.course, time: args.time || '', location: args.location || '' });
              schedule[dayKey].sort(function(a, b) { return (a.time || '').localeCompare(b.time || ''); });
              fss.writeFileSync(scheduleFile, JSON.stringify(schedule, null, 2), 'utf-8');
              return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_schedule', action: 'add', day: args.day, course: args.course }) }];
            }

            if (args.action === 'list') {
              var dayNames = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
              var formatted = {};
              for (var d = 1; d <= 7; d++) {
                var key = 'day_' + d;
                if (schedule[key] && schedule[key].length > 0) formatted[dayNames[d]] = schedule[key];
              }
              return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_schedule', action: 'list', schedule: formatted, totalDays: Object.keys(formatted).length }) }];
            }

            if (args.action === 'clear') {
              fss.writeFileSync(scheduleFile, '{}', 'utf-8');
              return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_schedule', action: 'clear', message: '课程表已清空' }) }];
            }

            return [{ type: 'text', text: JSON.stringify({ success: false, error: '不支持的操作: ' + args.action }) }];
          } catch(e) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'daily_schedule', error: e.message }) }];
          }
        }
      },
      {
        name: 'daily_text',
        label: '文本处理',
        description: '常用文本处理工具。参数: action(操作: word_count/case_convert/format), content(文本内容), options(选项)',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: '操作: word_count(字数统计), case_convert(大小写转换), format(格式整理)' },
            content: { type: 'string', description: '要处理的文本' },
            options: { type: 'string', description: '选项: case_convert时选upper/lower/title' }
          },
          required: ['action', 'content']
        },
        execute: async function(toolCallId, args) {
          try {
            var content = args.content;
            var action = args.action;

            if (action === 'word_count') {
              var cnChars = (content.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
              var enWords = (content.match(/[a-zA-Z]+/g) || []).length;
              var digits = (content.match(/\d+/g) || []).length;
              var lines = content.split('\n').length;
              var totalChars = content.replace(/\s/g, '').length;
              return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_text', action: 'word_count', chineseChars: cnChars, englishWords: enWords, numbers: digits, lines: lines, totalCharsNoSpace: totalChars, estimateReadingMin: Math.ceil(cnChars / 400 + enWords / 200) }) }];
            }

            if (action === 'case_convert') {
              var opt = (args.options || 'lower').toLowerCase();
              var result;
              if (opt === 'upper') result = content.toUpperCase();
              else if (opt === 'title') result = content.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
              else result = content.toLowerCase();
              return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_text', action: 'case_convert', option: opt, result: result }) }];
            }

            if (action === 'format') {
              var cleaned = content.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/[，,]\s*/g, '，').replace(/[。.]\s*/g, '。').trim();
              return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'daily_text', action: 'format', originalLength: content.length, cleanedLength: cleaned.length, result: cleaned }) }];
            }

            return [{ type: 'text', text: JSON.stringify({ success: false, error: '不支持的操作: ' + action + '，支持: word_count/case_convert/format' }) }];
          } catch(e) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'daily_text', error: e.message }) }];
          }
        }
      }
    ];
  });

  api.logger.info('[daily-utils] 已注册 4 个日常工具');
};