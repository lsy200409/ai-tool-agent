module.exports = function register(api) {
  var fsp = require('fs').promises;
  var fss = require('fs');
  var path = require('path');

  api.logger.info('[memory-plugin] 初始化记忆引擎 v1.0.0');

  var memDir = path.join(api.resolvePath(''), '..', 'memory');
  var indexFile = path.join(memDir, '_index.json');
  var LAMBDA = 0.01;
  var MS_PER_DAY = 86400000;

  function ensureDir() {
    if (!fss.existsSync(memDir)) {
      fss.mkdirSync(memDir, { recursive: true });
    }
  }

  function loadIndex() {
    ensureDir();
    try {
      if (fss.existsSync(indexFile)) {
        return JSON.parse(fss.readFileSync(indexFile, 'utf-8'));
      }
    } catch (e) {}
    return { records: {}, sessions: {} };
  }

  function saveIndex(idx) {
    ensureDir();
    fss.writeFileSync(indexFile, JSON.stringify(idx, null, 2), 'utf-8');
  }

  function sessionFile(sessionId) {
    var safe = sessionId.replace(/[<>:"/\\|?*]/g, '_');
    return path.join(memDir, safe + '.json');
  }

  function loadSession(sessionId) {
    try {
      var fp = sessionFile(sessionId);
      if (fss.existsSync(fp)) {
        return JSON.parse(fss.readFileSync(fp, 'utf-8'));
      }
    } catch (e) {}
    return [];
  }

  function saveSession(sessionId, records) {
    ensureDir();
    fss.writeFileSync(sessionFile(sessionId), JSON.stringify(records, null, 2), 'utf-8');
  }

  function uid() {
    return 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function chunkText(text, maxLen) {
    maxLen = maxLen || 500;
    if (text.length <= maxLen) return [text];
    var chunks = [];
    var overlap = Math.floor(maxLen * 0.15);
    var i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + maxLen));
      i += maxLen - overlap;
    }
    return chunks;
  }

  function tokenize(text) {
    var tokens = [];
    var re = /[\u4e00-\u9fff\u3400-\u4dbf]+|[a-zA-Z0-9]+/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var t = m[0].toLowerCase();
      if (t.length >= 2) tokens.push(t);
    }
    return tokens;
  }

  function computeTF(tokens) {
    var tf = {};
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      tf[t] = (tf[t] || 0) + 1;
    }
    var total = tokens.length || 1;
    var keys = Object.keys(tf);
    for (var j = 0; j < keys.length; j++) {
      tf[keys[j]] = tf[keys[j]] / total;
    }
    return tf;
  }

  function computeIDF(allRecords, queryTokens) {
    var N = allRecords.length || 1;
    var df = {};
    for (var i = 0; i < allRecords.length; i++) {
      var seen = {};
      var rTokens = tokenize(allRecords[i].content || '');
      for (var j = 0; j < rTokens.length; j++) {
        var t = rTokens[j];
        if (!seen[t]) {
          seen[t] = true;
          df[t] = (df[t] || 0) + 1;
        }
      }
    }
    var idf = {};
    for (var k = 0; k < queryTokens.length; k++) {
      var t = queryTokens[k];
      var d = df[t] || 0;
      idf[t] = Math.log((N - d + 0.5) / (d + 0.5) + 1);
    }
    return idf;
  }

  function keywordSearch(query, records, topK) {
    topK = topK || 10;
    if (records.length === 0) return [];

    var queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    var idf = computeIDF(records, queryTokens);
    var now = Date.now();
    var scored = [];

    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var rTokens = tokenize(r.content || '');
      var tf = computeTF(rTokens);

      var score = 0;
      for (var j = 0; j < queryTokens.length; j++) {
        var t = queryTokens[j];
        score += (tf[t] || 0) * (idf[t] || 0);
      }

      if (score > 0) {
        var daysOld = (now - r.createdAt) / MS_PER_DAY;
        scored.push({
          record: r,
          keywordScore: score,
          decayedScore: score * Math.exp(-LAMBDA * daysOld)
        });
      }
    }

    scored.sort(function (a, b) { return b.decayedScore - a.decayedScore; });
    return scored.slice(0, topK);
  }

  function recencySearch(records, topK) {
    topK = topK || 10;
    var now = Date.now();
    var scored = [];

    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var daysOld = (now - r.createdAt) / MS_PER_DAY;
      scored.push({
        record: r,
        recencyScore: Math.exp(-LAMBDA * daysOld)
      });
    }

    scored.sort(function (a, b) { return b.recencyScore - a.recencyScore; });
    return scored.slice(0, topK);
  }

  function rrfFusion(kwResults, recResults, topK, rrfK) {
    topK = topK || 10;
    rrfK = rrfK || 60;
    var scores = {};
    var recordMap = {};

    for (var i = 0; i < kwResults.length; i++) {
      var key = kwResults[i].record.id;
      scores[key] = (scores[key] || 0) + 1 / (rrfK + i + 1);
      recordMap[key] = kwResults[i].record;
    }

    for (var j = 0; j < recResults.length; j++) {
      var key2 = recResults[j].record.id;
      scores[key2] = (scores[key2] || 0) + 1 / (rrfK + j + 1);
      recordMap[key2] = recResults[j].record;
    }

    var keys = Object.keys(scores);
    keys.sort(function (a, b) { return scores[b] - scores[a]; });

    var results = [];
    for (var k = 0; k < Math.min(topK, keys.length); k++) {
      results.push(recordMap[keys[k]]);
    }
    return results;
  }

  function getAllRecords(idx) {
    var all = [];
    var sessionIds = Object.keys(idx.sessions);
    for (var i = 0; i < sessionIds.length; i++) {
      var sid = sessionIds[i];
      var records = loadSession(sid);
      for (var j = 0; j < records.length; j++) {
        all.push(records[j]);
      }
    }
    return all;
  }

  function getSessionRecords(idx, sessionId) {
    if (!idx.sessions[sessionId]) return [];
    return loadSession(sessionId);
  }

  function addToIndex(idx, record) {
    idx.records[record.id] = {
      id: record.id,
      sessionId: record.sessionId,
      role: record.role,
      createdAt: record.createdAt,
      contentPreview: (record.content || '').slice(0, 80)
    };
    idx.sessions[record.sessionId] = (idx.sessions[record.sessionId] || 0) + 1;
    saveIndex(idx);
  }

  function removeFromIndex(idx, recordId, sessionId) {
    delete idx.records[recordId];
    if (idx.sessions[sessionId]) {
      idx.sessions[sessionId] = Math.max(0, idx.sessions[sessionId] - 1);
    }
    saveIndex(idx);
  }

  api.registerTool(function (ctx) {
    return [
      {
        name: 'memory_save',
        label: 'Save Memory',
        description: '保存对话记忆到本地持久化存储。参数: role(user/assistant), content(记忆内容), sessionId(可选, 会话标识), provider(可选, 来源标识, 如deepseek)',
        parameters: {
          type: 'object',
          properties: {
            role: { type: 'string', description: '角色: user 或 assistant' },
            content: { type: 'string', description: '要保存的记忆内容' },
            sessionId: { type: 'string', description: '会话标识(可选, 默认自动生成)' },
            provider: { type: 'string', description: '来源标识(可选, 默认deepseek)' }
          },
          required: ['role', 'content']
        },
        execute: async function (toolCallId, args) {
          try {
            var idx = loadIndex();
            var sid = args.sessionId || 'default';
            var record = {
              id: uid(),
              role: args.role,
              content: args.content,
              sessionId: sid,
              provider: args.provider || 'deepseek',
              createdAt: Date.now(),
              timestamp: Date.now()
            };

            var session = loadSession(sid);
            session.push(record);
            saveSession(sid, session);
            addToIndex(idx, record);

            return [{ type: 'text', text: JSON.stringify({
              success: true,
              tool: 'memory_save',
              id: record.id,
              sessionId: sid,
              message: '记忆已保存'
            }) }];
          } catch (e) {
            return [{ type: 'text', text: JSON.stringify({
              success: false,
              tool: 'memory_save',
              error: e.message
            }) }];
          }
        }
      },

      {
        name: 'memory_search',
        label: 'Search Memory',
        description: '混合搜索记忆：关键词匹配 + 时间衰减 + RRF融合排序。参数: query(搜索关键词), topK(可选, 返回条数, 默认10), sessionId(可选, 限定会话)',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词' },
            topK: { type: 'number', description: '返回结果数量(默认10)' },
            sessionId: { type: 'string', description: '限定搜索的会话ID(可选)' }
          },
          required: ['query']
        },
        execute: async function (toolCallId, args) {
          try {
            var idx = loadIndex();
            var topK = args.topK || 10;
            var query = args.query || '';

            var records;
            if (args.sessionId) {
              records = getSessionRecords(idx, args.sessionId);
            } else {
              records = getAllRecords(idx);
            }

            if (records.length === 0) {
              return [{ type: 'text', text: JSON.stringify({
                success: true,
                tool: 'memory_search',
                results: [],
                query: query,
                message: '暂无记忆数据'
              }) }];
            }

            var kwResults = keywordSearch(query, records, Math.min(30, records.length));
            var recResults = recencySearch(records, Math.min(30, records.length));
            var merged = rrfFusion(kwResults, recResults, topK);

            return [{ type: 'text', text: JSON.stringify({
              success: true,
              tool: 'memory_search',
              query: query,
              totalRecords: records.length,
              resultCount: merged.length,
              results: merged.map(function (r) {
                return {
                  id: r.id,
                  role: r.role,
                  content: r.content,
                  sessionId: r.sessionId,
                  createdAt: r.createdAt,
                  provider: r.provider
                };
              })
            }) }];
          } catch (e) {
            return [{ type: 'text', text: JSON.stringify({
              success: false,
              tool: 'memory_search',
              error: e.message
            }) }];
          }
        }
      },

      {
        name: 'memory_recall',
        label: 'Recall Memory',
        description: '获取最近的记忆记录。参数: limit(可选, 条数, 默认10), sessionId(可选, 限定会话)',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: '返回条数(默认10)' },
            sessionId: { type: 'string', description: '限定会话ID(可选)' }
          },
          required: []
        },
        execute: async function (toolCallId, args) {
          try {
            var idx = loadIndex();
            var limit = args.limit || 10;

            var records;
            if (args.sessionId) {
              records = getSessionRecords(idx, args.sessionId);
            } else {
              records = getAllRecords(idx);
            }

            records.sort(function (a, b) { return b.createdAt - a.createdAt; });
            var recent = records.slice(0, limit);

            return [{ type: 'text', text: JSON.stringify({
              success: true,
              tool: 'memory_recall',
              totalRecords: records.length,
              resultCount: recent.length,
              results: recent.map(function (r) {
                return {
                  id: r.id,
                  role: r.role,
                  content: r.content,
                  sessionId: r.sessionId,
                  createdAt: r.createdAt,
                  provider: r.provider
                };
              })
            }) }];
          } catch (e) {
            return [{ type: 'text', text: JSON.stringify({
              success: false,
              tool: 'memory_recall',
              error: e.message
            }) }];
          }
        }
      },

      {
        name: 'memory_forget',
        label: 'Forget Memory',
        description: '删除记忆。参数: id(记忆ID, 可选) 或 sessionId(清除整个会话, 可选)',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '要删除的记忆ID' },
            sessionId: { type: 'string', description: '要清除的会话ID(删除该会话全部记忆)' }
          },
          required: []
        },
        execute: async function (toolCallId, args) {
          try {
            var idx = loadIndex();
            var deleted = 0;

            if (args.sessionId) {
              deleted = idx.sessions[args.sessionId] || 0;
              delete idx.sessions[args.sessionId];
              var fp = sessionFile(args.sessionId);
              if (fss.existsSync(fp)) {
                fss.unlinkSync(fp);
              }
              var ids = Object.keys(idx.records);
              for (var i = 0; i < ids.length; i++) {
                if (idx.records[ids[i]].sessionId === args.sessionId) {
                  delete idx.records[ids[i]];
                }
              }
              saveIndex(idx);
            } else if (args.id) {
              var target = idx.records[args.id];
              if (target) {
                var sid = target.sessionId;
                var session = loadSession(sid);
                session = session.filter(function (r) { return r.id !== args.id; });
                saveSession(sid, session);
                removeFromIndex(idx, args.id, sid);
                deleted = 1;
              }
            }

            return [{ type: 'text', text: JSON.stringify({
              success: true,
              tool: 'memory_forget',
              deleted: deleted,
              message: deleted > 0 ? '已删除 ' + deleted + ' 条记忆' : '未找到匹配的记忆'
            }) }];
          } catch (e) {
            return [{ type: 'text', text: JSON.stringify({
              success: false,
              tool: 'memory_forget',
              error: e.message
            }) }];
          }
        }
      },

      {
        name: 'memory_stats',
        label: 'Memory Stats',
        description: '获取记忆统计信息。参数: 无',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        },
        execute: async function (toolCallId, args) {
          try {
            var idx = loadIndex();
            var sessionIds = Object.keys(idx.sessions);
            var totalRecords = 0;
            var sessions = [];

            for (var i = 0; i < sessionIds.length; i++) {
              var sid = sessionIds[i];
              var count = idx.sessions[sid];
              totalRecords += count;
              var session = loadSession(sid);
              var firstAt = session.length > 0 ? session[0].createdAt : 0;
              var lastAt = session.length > 0 ? session[session.length - 1].createdAt : 0;
              sessions.push({
                sessionId: sid,
                count: count,
                firstAt: firstAt,
                lastAt: lastAt
              });
            }

            return [{ type: 'text', text: JSON.stringify({
              success: true,
              tool: 'memory_stats',
              totalRecords: totalRecords,
              sessionCount: sessionIds.length,
              sessions: sessions,
              storageDir: memDir
            }) }];
          } catch (e) {
            return [{ type: 'text', text: JSON.stringify({
              success: false,
              tool: 'memory_stats',
              error: e.message
            }) }];
          }
        }
      }
    ];
  });

  api.logger.info('[memory-plugin] 已注册 5 个记忆工具: memory_save, memory_search, memory_recall, memory_forget, memory_stats');
};