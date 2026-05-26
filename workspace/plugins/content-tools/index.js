module.exports = function register(api) {
  var fsp = require('fs').promises;
  var fss = require('fs');
  var path = require('path');

  api.logger.info('[content-tools] 初始化自媒体内容工具 v1.0.0');

  var templatesDir = path.join(api.workspaceDir || api.resolvePath(''), 'templates');

  var PLATFORM_TEMPLATES = {
    '微信公众号': {
      format: 'markdown',
      specs: '标题≤64字，正文字数不限，支持Markdown排版，封面图比例2.35:1',
      template: '# {title}\n\n> {summary}\n\n## {section1}\n\n{content1}\n\n## {section2}\n\n{content2}\n\n## 总结\n\n{conclusion}\n\n---\n*本文由AI辅助创作*'
    },
    '小红书': {
      format: 'plain',
      specs: '标题≤20字，正文≤1000字，需#话题标签，图片比例3:4，风格口语化',
      template: '{title}\n\n{content}\n\n# {tag1}  # {tag2}  # {tag3}'
    },
    '知乎回答': {
      format: 'markdown',
      specs: '开头需引用原问题，结构清晰有逻辑，支持图文混排',
      template: '> {question}\n\n{opening}\n\n## 核心观点\n\n{points}\n\n## 详细分析\n\n{analysis}\n\n## 总结\n\n{conclusion}'
    },
    '抖音脚本': {
      format: 'plain',
      specs: '前3秒必须抓眼球，总时长15-60秒，口播+画面提示',
      template: '【视频脚本】\n\n🎬 开头 (0-3秒):\n{hook}\n\n📝 主体 (3-45秒):\n{body}\n\n🔥 结尾 (45-60秒):\n{cta}'
    },
    '微博': {
      format: 'plain',
      specs: '≤140字(会员≤2000字)，可带#话题#和@用户，支持图片/视频',
      template: '{content}  {hashtags}'
    },
    'B站专栏': {
      format: 'markdown',
      specs: '标题≤30字，支持Markdown排版，封面图比例16:9',
      template: '# {title}\n\n![封面]({cover_url})\n\n## 前言\n\n{intro}\n\n## {main_title}\n\n{main_content}\n\n## 结尾\n\n{ending}'
    }
  };

  api.registerTool(function(ctx) {
    return [
      {
        name: 'content_template',
        label: '内容模板',
        description: '获取指定自媒体平台的内容模板和创作规范。支持平台: ' + Object.keys(PLATFORM_TEMPLATES).join('、'),
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string', description: '平台名称: 微信公众号/小红书/知乎回答/抖音脚本/微博/B站专栏' }
          },
          required: ['platform']
        },
        execute: async function(args) {
          var tmpl = PLATFORM_TEMPLATES[args.platform];
          if (!tmpl) return JSON.stringify({ error: '不支持的平台，可选: ' + Object.keys(PLATFORM_TEMPLATES).join('、') });
          return JSON.stringify({ platform: args.platform, specs: tmpl.specs, format: tmpl.format, template: tmpl.template });
        }
      },
      {
        name: 'platform_list',
        label: '平台列表',
        description: '列出所有支持的自媒体平台及其创作规范摘要',
        parameters: { type: 'object', properties: {}, required: [] },
        execute: async function(args) {
          var list = {};
          var keys = Object.keys(PLATFORM_TEMPLATES);
          for (var i = 0; i < keys.length; i++) {
            list[keys[i]] = PLATFORM_TEMPLATES[keys[i]].specs;
          }
          return JSON.stringify({ platforms: list, tip: '使用 content_template 工具并指定 platform 参数获取具体模板' });
        }
      },
      {
        name: 'content_export',
        label: '导出内容',
        description: '将创作内容导出为文件，保存到 workspace 目录。支持 .md 和 .txt 格式。',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '文件标题' },
            content: { type: 'string', description: '文件内容' },
            platform: { type: 'string', description: '目标平台(用于自动选择格式): 微信公众号/知乎回答/B站专栏 用.md, 其他用.txt' }
          },
          required: ['title', 'content']
        },
        execute: async function(args) {
          try {
            if (!fss.existsSync(templatesDir)) fss.mkdirSync(templatesDir, { recursive: true });
            var ext = '.txt';
            if (args.platform && ['微信公众号', '知乎回答', 'B站专栏'].indexOf(args.platform) >= 0) ext = '.md';
            var safeName = args.title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
            var filePath = path.join(templatesDir, safeName + '_' + Date.now().toString(36) + ext);
            await fsp.writeFile(filePath, args.content, 'utf-8');
            return JSON.stringify({ success: true, file: filePath, title: args.title });
          } catch(e) {
            return JSON.stringify({ error: '导出失败: ' + e.message });
          }
        }
      }
    ];
  });
};