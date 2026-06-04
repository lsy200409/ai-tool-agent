module.exports = function register(api) {
  var fsp = require('fs').promises;
  var fss = require('fs');
  var path = require('path');

  api.logger.info('[study-tools] 初始化学习工具集 v1.0.0');

  var dataDir = path.join(api.resolvePath(''), '..', 'study_data');
  if (!fss.existsSync(dataDir)) fss.mkdirSync(dataDir, { recursive: true });

  var gpaStandard = { 'A+': 4.3, 'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7, 'C+': 2.3, 'C': 2.0, 'C-': 1.7, 'D+': 1.3, 'D': 1.0, 'F': 0 };
  var gpaCN = { '95-100': 4.0, '90-94': 4.0, '85-89': 3.7, '82-84': 3.3, '78-81': 3.0, '75-77': 2.7, '72-74': 2.3, '68-71': 2.0, '64-67': 1.5, '60-63': 1.0, '0-59': 0 };

  api.registerTool(function(ctx) {
    return [
      {
        name: 'study_flashcard',
        label: '闪卡生成',
        description: '根据知识点生成Anki风格的闪卡，帮助记忆。参数: topic(主题), cards(卡片数组[{q:"问题", a:"答案"}]), exportFormat(可选, 导出格式: anki/csv/json)',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: '主题/科目名称' },
            cards: { type: 'string', description: 'JSON数组格式的卡片数据，每项包含q(问题)和a(答案)' },
            exportFormat: { type: 'string', description: '导出格式: anki/csv/json (默认json)' }
          },
          required: ['topic', 'cards']
        },
        execute: async function(toolCallId, args) {
          try {
            var cards = typeof args.cards === 'string' ? JSON.parse(args.cards) : args.cards;
            var format = args.exportFormat || 'json';
            var safeName = args.topic.replace(/[<>:"/\\|?*]/g, '_').substring(0, 40);
            var ts = Date.now().toString(36);
            var filePath;
            var content;

            if (format === 'csv') {
              content = 'question,answer\n';
              for (var i = 0; i < cards.length; i++) {
                content += '"' + cards[i].q.replace(/"/g, '""') + '","' + cards[i].a.replace(/"/g, '""') + '"\n';
              }
              filePath = path.join(dataDir, safeName + '_' + ts + '.csv');
            } else if (format === 'anki') {
              content = '#separator:tab\n#html:true\n#tags:' + args.topic + '\n';
              for (var j = 0; j < cards.length; j++) {
                content += cards[j].q + '\t' + cards[j].a + '\n';
              }
              filePath = path.join(dataDir, safeName + '_' + ts + '.txt');
            } else {
              content = JSON.stringify({ topic: args.topic, cards: cards, createdAt: new Date().toISOString() }, null, 2);
              filePath = path.join(dataDir, safeName + '_' + ts + '.json');
            }
            await fsp.writeFile(filePath, content, 'utf-8');
            return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'study_flashcard', topic: args.topic, cardCount: cards.length, format: format, file: filePath, sample: cards.slice(0, 3) }) }];
          } catch(e) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'study_flashcard', error: e.message }) }];
          }
        }
      },
      {
        name: 'study_quiz',
        label: '模拟测验',
        description: '根据知识点生成模拟测验题并评分。参数: topic(主题), questions(题目数组[{q, options[], answer}]), mode(模式: quiz/self_test)',
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: '测验主题' },
            questions: { type: 'string', description: 'JSON格式的题目数组，每项含q(题目), options(选项数组), answer(正确答案索引)' },
            mode: { type: 'string', description: '模式: quiz(测验模式,带评分) / self_test(自测模式)' }
          },
          required: ['topic', 'questions']
        },
        execute: async function(toolCallId, args) {
          try {
            var questions = typeof args.questions === 'string' ? JSON.parse(args.questions) : args.questions;
            var mode = args.mode || 'quiz';
            var formatted = questions.map(function(q, i) {
              var opts = (q.options || []).map(function(o, j) {
                return '  ' + String.fromCharCode(65 + j) + '. ' + o;
              }).join('\n');
              return '**第' + (i + 1) + '题** ' + q.q + '\n' + opts;
            }).join('\n\n');

            var answerKey = mode === 'quiz' ? '\n\n---\n## 答案\n' + questions.map(function(q, i) {
              var ai = typeof q.answer === 'number' ? q.answer : parseInt(q.answer);
              return (i + 1) + '. ' + String.fromCharCode(65 + ai) + (q.explanation ? ' — ' + q.explanation : '');
            }).join('\n') : '';

            return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'study_quiz', topic: args.topic, questionCount: questions.length, mode: mode, content: '## 模拟测验：' + args.topic + '\n\n' + formatted + answerKey + '\n\n---\n做完后对照答案，每题1分，满分' + questions.length + '分' }) }];
          } catch(e) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'study_quiz', error: e.message }) }];
          }
        }
      },
      {
        name: 'study_note_format',
        label: '笔记格式化',
        description: '将零散笔记整理为结构化格式。参数: content(原始笔记内容), style(样式: outline/cornell/mindmap/table)',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '原始笔记内容' },
            style: { type: 'string', description: '样式: outline(大纲), cornell(康奈尔), mindmap(思维导图), table(表格)' }
          },
          required: ['content']
        },
        execute: async function(toolCallId, args) {
          try {
            var style = args.style || 'outline';
            var content = args.content;
            var header = '## 笔记 · ' + new Date().toLocaleDateString('zh-CN') + '\n\n';

            var templates = {
              outline: header + '笔记内容已接收，请按以下大纲结构整理：\n\n```\n一、xxx\n  1.1 xxx\n  1.2 xxx\n二、xxx\n  2.1 xxx\n```\n\n原始内容：\n' + content,
              cornell: header + '┌─────────────────────────┬──────────────────┐\n│ 笔记区（记录要点）       │ 线索区（关键词/问题） │\n├─────────────────────────┼──────────────────┤\n│                         │                  │\n├─────────────────────────┴──────────────────┤\n│ 总结区（用自己的话概括）                         │\n└────────────────────────────────────────────┘\n\n原始内容：\n' + content,
              mindmap: header + '```\n中心主题\n├── 分支1\n│   ├── 子节点1.1\n│   └── 子节点1.2\n├── 分支2\n│   └── 子节点2.1\n└── 分支3\n```\n\n原始内容：\n' + content,
              table: header + '| 概念 | 定义 | 举例 | 备注 |\n|------|------|------|------|\n| | | | |\n\n原始内容：\n' + content
            };

            return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'study_note_format', style: style, template: templates[style] || templates.outline, hint: '请根据模板格式整理以下原始笔记' }) }];
          } catch(e) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'study_note_format', error: e.message }) }];
          }
        }
      },
      {
        name: 'study_gpa_calc',
        label: 'GPA计算',
        description: '计算GPA/加权平均分。参数: courses(课程数组[{name, credit, score}]), system(体系: standard/cn4/cn5)',
        parameters: {
          type: 'object',
          properties: {
            courses: { type: 'string', description: 'JSON数组，每项含name(课程名), credit(学分), score(分数)' },
            system: { type: 'string', description: '评分体系: standard(标准4.0), cn4(中国4.0), cn5(中国5.0)' }
          },
          required: ['courses']
        },
        execute: async function(toolCallId, args) {
          try {
            var courses = typeof args.courses === 'string' ? JSON.parse(args.courses) : args.courses;
            var system = args.system || 'standard';

            function scoreToGPA(score, sys) {
              if (sys === 'cn5') {
                if (score >= 95) return 5.0;
                if (score >= 90) return 4.5;
                if (score >= 85) return 4.0;
                if (score >= 80) return 3.5;
                if (score >= 75) return 3.0;
                if (score >= 70) return 2.5;
                if (score >= 65) return 2.0;
                if (score >= 60) return 1.0;
                return 0;
              }
              if (sys === 'cn4') {
                if (score >= 90) return 4.0;
                if (score >= 85) return 3.7;
                if (score >= 82) return 3.3;
                if (score >= 78) return 3.0;
                if (score >= 75) return 2.7;
                if (score >= 72) return 2.3;
                if (score >= 68) return 2.0;
                if (score >= 64) return 1.5;
                if (score >= 60) return 1.0;
                return 0;
              }
              if (score >= 93) return 4.0;
              if (score >= 90) return 3.7;
              if (score >= 87) return 3.3;
              if (score >= 83) return 3.0;
              if (score >= 80) return 2.7;
              if (score >= 77) return 2.3;
              if (score >= 73) return 2.0;
              if (score >= 70) return 1.7;
              if (score >= 67) return 1.3;
              if (score >= 60) return 1.0;
              return 0;
            }

            var totalCredits = 0;
            var totalPoints = 0;
            var details = [];
            for (var i = 0; i < courses.length; i++) {
              var gpa = scoreToGPA(courses[i].score, system);
              var points = courses[i].credit * gpa;
              totalCredits += courses[i].credit;
              totalPoints += points;
              details.push({ name: courses[i].name, score: courses[i].score, credit: courses[i].credit, gpa: Math.round(gpa * 100) / 100 });
            }
            var finalGPA = totalCredits > 0 ? Math.round(totalPoints / totalCredits * 100) / 100 : 0;

            return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'study_gpa_calc', system: system, totalCredits: totalCredits, totalPoints: Math.round(totalPoints * 100) / 100, gpa: finalGPA, courses: details, message: 'GPA: ' + finalGPA + ' / ' + (system === 'cn5' ? '5.0' : '4.0') + ' (总学分: ' + totalCredits + ')' }) }];
          } catch(e) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'study_gpa_calc', error: e.message }) }];
          }
        }
      },
      {
        name: 'study_pomodoro',
        label: '番茄钟',
        description: '启动番茄钟计时建议。参数: task(任务名称), sessions(番茄钟数量, 默认4), workMinutes(工作时间, 默认25), breakMinutes(休息时间, 默认5)',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: '任务名称' },
            sessions: { type: 'number', description: '番茄钟数量(默认4)' },
            workMinutes: { type: 'number', description: '每个番茄钟时长/分钟(默认25)' },
            breakMinutes: { type: 'number', description: '休息时长/分钟(默认5)' }
          },
          required: ['task']
        },
        execute: async function(toolCallId, args) {
          try {
            var sessions = args.sessions || 4;
            var workMin = args.workMinutes || 25;
            var breakMin = args.breakMinutes || 5;
            var totalWork = sessions * workMin;
            var totalBreak = (sessions - 1) * breakMin + (sessions >= 4 ? 15 : 5);
            var totalTime = totalWork + totalBreak;

            var plan = [];
            for (var i = 0; i < sessions; i++) {
              plan.push('🍅 第' + (i + 1) + '个番茄钟: ' + workMin + '分钟专注');
              if (i < sessions - 1) plan.push('☕ 休息 ' + breakMin + ' 分钟');
            }
            if (sessions >= 4) plan.push('☕ 长休息 15 分钟');

            return [{ type: 'text', text: JSON.stringify({ success: true, tool: 'study_pomodoro', task: args.task, sessions: sessions, workMinutes: workMin, breakMinutes: breakMin, totalWorkMinutes: totalWork, totalBreakMinutes: totalBreak, totalMinutes: totalTime, plan: plan, message: '已为「' + args.task + '」设置 ' + sessions + ' 个番茄钟，预计总耗时 ' + Math.floor(totalTime / 60) + ' 小时 ' + (totalTime % 60) + ' 分钟' }) }];
          } catch(e) {
            return [{ type: 'text', text: JSON.stringify({ success: false, tool: 'study_pomodoro', error: e.message }) }];
          }
        }
      }
    ];
  });

  api.logger.info('[study-tools] 已注册 5 个学习工具');
};