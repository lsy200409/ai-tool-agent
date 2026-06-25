(function() {
  'use strict';

  if (window.__ds_sse_interceptor_ready) return;
  window.__ds_sse_interceptor_ready = true;

  // 通过 PlatformRegistry 获取当前平台的 SSE 配置
  var platform = window.PlatformRegistry ? PlatformRegistry.detect() : null;
  var sseConfig = platform ? platform.sse : null;

  // 兼容：如果 PlatformRegistry 未加载，使用 DeepSeek 默认配置
  var DS_API_PATTERN = sseConfig ? sseConfig.apiPattern : /chat\/completion/;
  var SSEContentType = 'text/event-stream';

  // 调试开关：生产环境下关闭可避免昂贵的调试数据收集开销
  // 计数器（_debug.xxx++）开销极低，始终保留；pushDebugEvent 和 URL 追踪等操作仅在开启时执行
  var _debugEnabled = window.__ds_sse_debug || false;

  var _streamState = {
    active: false,
    accumulatedText: '',
    lastChunkTime: 0,
    finishReason: null,
    requestCount: 0,
    requestUrl: '',
    platformId: platform ? platform.id : 'unknown'
  };

  // 并发流保护：每个流分配唯一 ID，防止新流覆盖旧流状态
  var _streamId = 0;           // 自增计数器，每个新流 +1
  var _activeStreamId = null;  // 当前活跃流的 ID

  var _debug = {
    wrapperCalledTotal: 0,
    wrapperCalledMatchingUrl: 0,
    wrapperCalledNonMatching: 0,
    wrapperCalledDuplicate: 0,
    setterCalledTotal: 0,
    getterCalledTotal: 0,
    urlsSeen: [],
    fetchAtLoadNative: false,
    fetchAtLoadStr: '',
    fetchDescWritable: false,
    definePropertyUsed: false,
    xhrOpenCalled: 0,
    xhrSendCalled: 0,
    xhrMatchingUrl: 0,
    xhrPollActiveCount: 0,
    xhrPollTotalCount: 0,
    xhrTotalBytes: 0,
    xhrSamples: [],
    streamEvents: [],
    platformId: platform ? platform.id : 'unknown'
  };

  // 调试事件统一推送函数，硬上限 200 条；仅在调试模式下收集
  function pushDebugEvent(entry) {
    if (!_debugEnabled) return;
    if (_debug.streamEvents.length >= 200) return;
    _debug.streamEvents.push(entry);
  }

  window.__ds_interceptor_debug = function() { return _debug; };

  if (typeof window.fetch === 'function') {
    _debug.fetchAtLoadNative = window.fetch.toString().includes('[native code]');
    _debug.fetchAtLoadStr = window.fetch.toString().substring(0, 100);
  }

  var fetchDesc = Object.getOwnPropertyDescriptor(window, 'fetch');
  if (fetchDesc) {
    _debug.fetchDescWritable = fetchDesc.writable === true;
    _debug.fetchDescConfigurable = fetchDesc.configurable === true;
    _debug.fetchDescHasGetter = typeof fetchDesc.get === 'function';
  }

  /**
   * 通过 postMessage 向页面发送 SSE 流事件通知
   * @param {string} type - 事件类型（如 __ds_stream_start / __ds_stream_chunk / __ds_stream_end）
   * @param {Object} data - 事件数据，会自动附加 source / type / platformId / streamId
   */
  function postSSEMessage(type, data) {
    data.source = 'ai-tool-agent';
    data.type = type;
    data.platformId = _streamState.platformId;
    data.streamId = _activeStreamId;  // 携带流 ID，消费者可据此区分不同流
    window.postMessage(data, window.location.origin);
  }

  /**
   * 从 SSE chunk 中提取文本内容，委托给平台适配器处理
   * @param {Object} chunk - 解析后的 SSE JSON 数据块
   * @returns {string|null} 提取到的文本内容，无内容时返回 null
   */
  function getContentFromChunk(chunk) {
    if (!chunk) return null;
    if (sseConfig && sseConfig.extractContent) {
      return sseConfig.extractContent(chunk);
    }
    // Fallback: DeepSeek 格式
    if (chunk.choices && chunk.choices.length > 0) {
      var delta = chunk.choices[0].delta;
      if (delta && delta.content) return delta.content;
    }
    return null;
  }

  /**
   * 检测流结束信号，委托给平台适配器处理
   * @param {Object} chunk - 解析后的 SSE JSON 数据块
   * @returns {string|null} 结束原因（如 'stop'/'finished'/'timeout'），未结束时返回 null
   */
  function detectStreamEnd(chunk) {
    if (!chunk) return null;
    if (sseConfig && sseConfig.detectStreamEnd) {
      return sseConfig.detectStreamEnd(chunk);
    }
    // Fallback: DeepSeek 格式
    if (chunk.p === 'response/status' && chunk.o === 'SET' && chunk.v === 'FINISHED') return 'finished';
    if (chunk.choices && chunk.choices.length > 0) {
      var fr = chunk.choices[0].finish_reason;
      if (fr) return fr;
    }
    return null;
  }

  /**
   * 检测流关闭事件，委托给平台适配器处理
   * @param {string} eventType - SSE 事件类型（如 'close'）
   * @param {Object} chunk - 解析后的 SSE JSON 数据块
   * @returns {string|null} 关闭原因，非关闭事件返回 null
   */
  function detectEventClose(eventType, chunk) {
    if (sseConfig && sseConfig.detectEventClose) {
      return sseConfig.detectEventClose(eventType, chunk);
    }
    if (eventType === 'close') return 'close';
    return null;
  }

  var _lastStreamContext = null;
  // 累积内容追踪（用于 ChatGPT/ChatGLM 等发送累积文本的平台）
  var _accumulatedLength = 0;
  // 当前活跃的 ReadableStream reader 引用，超时可取消
  var _activeReader = null;
  // __ds_stream_chunk 时间节流：避免高速流下消息过于频繁
  var _lastChunkNotifyTime = 0;
  var CHUNK_NOTIFY_INTERVAL = 500; // 每500ms最多发送一次

  // 超时保护：如果流卡在 active 超过 120 秒，自动重置
  var _timeoutIntervalId = setInterval(function() {
    if (_streamState.active && _streamState.lastChunkTime > 0) {
      var elapsed = Date.now() - _streamState.lastChunkTime;
      if (elapsed > 120000) {
        console.warn('[SSE Interceptor] 流超时 (' + Math.round(elapsed/1000) + 's)，强制重置');
        _streamState.active = false;
        _lastStreamContext = null;
        // 超时时取消底层 reader，防止超时后仍处理新数据块
        if (_activeReader) {
          try { _activeReader.cancel(); } catch(e) {}
          _activeReader = null;
        }
        postSSEMessage('__ds_stream_end', {
          text: _streamState.accumulatedText || '',
          finishReason: 'timeout'
        });
        _activeStreamId = null;
      }
    }
  }, 30000);

  // 页面卸载时清理定时器，防止内存泄漏
  window.addEventListener('unload', function() {
    if (_timeoutIntervalId) {
      clearInterval(_timeoutIntervalId);
      _timeoutIntervalId = null;
    }
  });

  /**
   * 创建流上下文对象，用于跟踪单个 SSE 流的状态
   * @returns {Object} 包含 started / fullText / chunkCount / streamId 的上下文对象
   */
  function createStreamContext() {
    return { started: false, fullText: '', chunkCount: 0, streamId: null };
  }

  /**
   * 处理流内容增量，累积文本并通过 postMessage 通知页面
   * 支持增量内容平台（DeepSeek/Qwen）和累积内容平台（ChatGPT/ChatGLM）
   * @param {string} content - 本次接收到的文本内容
   * @param {Object} [ctx] - 流上下文对象，省略时使用上次的上下文或新建
   */
  function onStreamContent(content, ctx) {
    ctx = ctx || _lastStreamContext || createStreamContext();
    _lastStreamContext = ctx;

    if (!ctx.started) {
      // 并发流保护：如果已有活跃流，先为旧流发送结束事件
      if (_streamState.active) {
        postSSEMessage('__ds_stream_end', {
          text: _streamState.accumulatedText || '',
          finishReason: 'superseded'  // 旧流被新流取代
        });
        _streamState.active = false;
      }
      ctx.started = true;
      ctx.fullText = '';
      ctx.chunkCount = 0;
      _accumulatedLength = 0;
      // 分配新的流 ID
      _streamId++;
      _activeStreamId = _streamId;
      ctx.streamId = _streamId;
      _streamState.active = true;
      _streamState.accumulatedText = '';
      _streamState.lastChunkTime = Date.now();
      _streamState.finishReason = null;
      postSSEMessage('__ds_stream_start', {
        requestCount: _streamState.requestCount,
        streamId: _streamId
      });
    }

    ctx.chunkCount++;

    // 处理累积内容平台（ChatGPT/ChatGLM 等）
    var isCumulative = sseConfig && sseConfig.cumulativeContent;
    if (isCumulative) {
      // content 是累积的完整文本，只取增量部分
      if (content.length > _accumulatedLength) {
        var delta = content.substring(_accumulatedLength);
        _accumulatedLength = content.length;
        ctx.fullText += delta;
        _streamState.accumulatedText = ctx.fullText;
        _streamState.lastChunkTime = Date.now();
      }
      // 如果 content 长度没变或变短，跳过（可能是重复或重置）
    } else {
      // 增量内容平台（DeepSeek/Qwen 等）
      ctx.fullText += content;
      _streamState.accumulatedText = ctx.fullText;
      _streamState.lastChunkTime = Date.now();
    }

    pushDebugEvent({
      type: 'content',
      contentLen: content.length,
      contentPreview: content.substring(0, 30),
      totalLen: ctx.fullText.length,
      ts: Date.now()
    });

    // 时间节流：避免高速流下 __ds_stream_chunk 消息过于频繁
    var now = Date.now();
    if (now - _lastChunkNotifyTime >= CHUNK_NOTIFY_INTERVAL || ctx.chunkCount === 1) {
      _lastChunkNotifyTime = now;
      postSSEMessage('__ds_stream_chunk', {
        text: isCumulative ? (_streamState.accumulatedText.substring(_streamState.accumulatedText.length - 100)) : content,
        fullText: _streamState.accumulatedText,
        chunkCount: ctx.chunkCount
      });
    }
  }

  /**
   * 处理流结束事件，重置全局流状态并发送 __ds_stream_end 通知
   * 并发流保护：只有当前活跃流才能发送结束事件
   * @param {string} reason - 结束原因（如 'stop'/'done'/'timeout'/'error'/'superseded'）
   * @param {Object} [ctx] - 流上下文对象
   */
  function onStreamEnd(reason, ctx) {
    ctx = ctx || _lastStreamContext;
    // 并发流保护：只有当前活跃流才能发送结束事件，避免旧流的结束覆盖新流
    var ctxStreamId = ctx ? ctx.streamId : null;
    if (ctxStreamId !== null && ctxStreamId !== _activeStreamId) {
      // 这是旧流的结束事件，忽略它（不发送，不修改全局状态）
      return;
    }
    _streamState.active = false;
    _streamState.finishReason = reason || 'done';
    _streamState.accumulatedText = ctx ? ctx.fullText : '';
    _activeReader = null;
    postSSEMessage('__ds_stream_end', {
      text: ctx ? ctx.fullText : '',
      finishReason: _streamState.finishReason
    });
    _activeStreamId = null;
    _lastStreamContext = null;
  }

  /**
   * 解析 SSE 文本行，提取 data 字段并调用 onStreamContent / onStreamEnd
   * @param {string} newText - 待解析的 SSE 文本（可能包含多行）
   * @param {string|null} eventTypeOverride - 强制覆盖的事件类型
   * @param {Object} [ctx] - 流上下文对象
   */
  function parseSSELines(newText, eventTypeOverride, ctx) {
    ctx = ctx || _lastStreamContext || createStreamContext();
    _lastStreamContext = ctx;
    var lines = newText.split('\n');
    var currentEventType = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('event:') === 0) {
        currentEventType = line.substring(6).trim();
        continue;
      }

      if (line.indexOf('data:') !== 0) continue;

      var payload = line.substring(5).trim();

      if (payload === '[DONE]') {
        onStreamEnd('stop', ctx);
        return;
      }

      try {
        var chunk = JSON.parse(payload);

        // 调试：记录原始 SSE chunk
        var chunkKeys = Object.keys(chunk).join(',');
        var debugEntry = {
          type: 'raw_chunk',
          keys: chunkKeys,
          hasText: !!chunk.text,
          hasEventType: chunk.event_type !== undefined,
          hasPatchOp: !!chunk.patch_op,
          hasContent: !!chunk.content,
          ts: Date.now()
        };
        // z.ai {type, data} 格式：记录 type 值和 data 结构
        if (chunk.type !== undefined) {
          debugEntry.chunkType = chunk.type;
        }
        if (chunk.data !== undefined) {
          var dataStr = typeof chunk.data === 'string' ? chunk.data.substring(0, 200) : JSON.stringify(chunk.data).substring(0, 200);
          debugEntry.dataPreview = dataStr;
          debugEntry.dataIsString = typeof chunk.data === 'string';
          // 尝试解析 data 看内部结构
          if (typeof chunk.data === 'string') {
            try {
              var inner = JSON.parse(chunk.data);
              debugEntry.dataKeys = Object.keys(inner).join(',');
              if (inner.choices && inner.choices[0]) {
                debugEntry.innerDelta = !!inner.choices[0].delta;
                debugEntry.innerContent = !!(inner.choices[0].delta && inner.choices[0].delta.content);
              }
            } catch(e) {
              debugEntry.dataParseError = true;
            }
          } else if (typeof chunk.data === 'object' && chunk.data !== null) {
            debugEntry.dataKeys = Object.keys(chunk.data).join(',');
          }
        }
        pushDebugEvent(debugEntry);

        var endReason = detectStreamEnd(chunk);
        if (endReason) {
          onStreamEnd(endReason, ctx);
          return;
        }

        var content = getContentFromChunk(chunk);
        if (content) {
          onStreamContent(content, ctx);
        }
      } catch(e) {
        // JSON 解析失败，可能是非标准 SSE 数据（如心跳、注释行等），忽略
        // 只有看起来像 JSON 但解析失败的才记录
        if (payload.charAt(0) === '{') {
          pushDebugEvent({ type: 'json_parse_error', payload: payload.substring(0, 100), error: e.message, ts: Date.now() });
        }
      }

      var closeReason = detectEventClose(currentEventType || eventTypeOverride, null);
      if (closeReason) {
        onStreamEnd(closeReason, ctx);
        return;
      }

      if (currentEventType === 'ready') {
        _streamState.requestCount++;
      }

      if (currentEventType === 'update_session') {
        pushDebugEvent({ type: 'session', ts: Date.now() });
      }
    }
  }

  /**
   * 解析 Kimi Connect RPC 等二进制流格式
   * 使用平台适配器的 parseBinaryFrame 方法逐帧解析
   * @param {ReadableStream} stream - 原始 ReadableStream 对象
   */
  function parseBinaryStream(stream) {
    var reader = stream.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var streamCtx = createStreamContext();

    // 二进制流超时保护：120 秒无数据则强制结束
    var _binaryTimeout = null;
    function resetBinaryTimeout() {
      if (_binaryTimeout) clearTimeout(_binaryTimeout);
      _binaryTimeout = setTimeout(function() {
        onStreamEnd('timeout', streamCtx);
        try { reader.cancel(); } catch(e) {}
      }, 120000);
    }
    resetBinaryTimeout();

    function processChunk(result) {
      if (result.done) {
        if (_binaryTimeout) clearTimeout(_binaryTimeout);
        if (streamCtx.started) {
          onStreamEnd('stream_done', streamCtx);
        }
        return;
      }

      // 收到数据，重置超时计时器
      resetBinaryTimeout();

      // 将二进制数据转为字符串
      var rawStr = decoder.decode(result.value, { stream: true });
      buffer += rawStr;

      // 使用平台适配器的 parseBinaryFrame
      if (sseConfig && sseConfig.parseBinaryFrame) {
        var parsed = sseConfig.parseBinaryFrame(buffer);
        if (parsed && parsed.frames) {
          for (var i = 0; i < parsed.frames.length; i++) {
            var frame = parsed.frames[i];

            var endReason = detectStreamEnd(frame);
            if (endReason) {
              if (_binaryTimeout) clearTimeout(_binaryTimeout);
              onStreamEnd(endReason, streamCtx);
              return;
            }

            var content = getContentFromChunk(frame);
            if (content) {
              onStreamContent(content, streamCtx);
            }
          }
          buffer = buffer.substring(parsed.consumed);
        }
      }

      return reader.read().then(processChunk).catch(function(err) {
        if (_binaryTimeout) clearTimeout(_binaryTimeout);
        onStreamEnd('error:' + err.message, streamCtx);
      });
    }

    reader.read().then(processChunk).catch(function(err) {
      onStreamEnd('error:' + err.message, streamCtx);
    });
  }

  /**
   * 解析标准 SSE 文本流（text/event-stream）
   * 逐块读取 ReadableStream，按换行符分割后交给 parseSSELines 处理
   * @param {ReadableStream} stream - 原始 ReadableStream 对象
   */
  function parseSSEStream(stream) {
    // 检查是否是二进制流（如 Kimi）
    if (sseConfig && sseConfig.binaryStream) {
      parseBinaryStream(stream);
      return;
    }

    var reader = stream.getReader();
    _activeReader = reader;
    var decoder = new TextDecoder();
    var buffer = '';
    var streamCtx = createStreamContext();

    function processChunk(result) {
      if (result.done) {
        if (buffer.length > 0) {
          parseSSELines(buffer, null, streamCtx);
          buffer = '';
        }
        if (streamCtx.started) {
          onStreamEnd('stream_done', streamCtx);
        }
        return;
      }

      buffer += decoder.decode(result.value, { stream: true });
      var splitIdx = buffer.lastIndexOf('\n');
      if (splitIdx >= 0) {
        var toProcess = buffer.substring(0, splitIdx + 1);
        buffer = buffer.substring(splitIdx + 1);
        parseSSELines(toProcess, null, streamCtx);
      }

      return reader.read().then(processChunk);
    }

    reader.read().then(processChunk).catch(function(err) {
      onStreamEnd('error:' + err.message, streamCtx);
    });
  }

  var _origFetch = window.fetch;
  // 请求去重：防止 fetch 被多次包装导致同一请求被处理多次
  var _processedRequests = new WeakSet();
  // URL级别去重：同一URL在短时间内只处理一次
  var _recentProcessedUrls = {};
  var DEDUP_WINDOW = 2000; // 2秒去重窗口

  /**
   * 创建 fetch 包装函数，拦截匹配 API 模式的请求并解析 SSE 响应流
   * 包含 URL 去重、Response tee 分流、并发流保护等机制
   * @param {Function} baseFetch - 底层 fetch 函数（原始或上一层包装）
   * @returns {Function} 包装后的 fetch 函数
   */
  function makeFetchWrapper(baseFetch) {
    return function(input, init) {
      _debug.wrapperCalledTotal++;
      var url = typeof input === 'string' ? input : (input && input.url || '');

      if (_debugEnabled && _debug.urlsSeen.length < 20) {
        _debug.urlsSeen.push(url.substring(0, 80));
      }

      if (!DS_API_PATTERN.test(url)) {
        _debug.wrapperCalledNonMatching++;
        return baseFetch.apply(this, arguments);
      }

      // URL级别去重：同一URL在2秒内只处理一次
      var now = Date.now();
      // 简化 URL 解析：避免每次请求都 new URL()，仅提取路径+查询部分
      var urlPath = url;
      if (url.charAt(0) === '/' || url.indexOf('://') > 0) {
        try {
          var pathStart = url.indexOf('://');
          if (pathStart > 0) {
            var slashIdx = url.indexOf('/', pathStart + 3);
            urlPath = slashIdx > 0 ? url.substring(slashIdx) : '/';
          }
          // 去掉 hash 部分
          var hIdx = urlPath.indexOf('#');
          if (hIdx > 0) urlPath = urlPath.substring(0, hIdx);
        } catch(e) {}
      }
      var urlKey = urlPath.substring(0, 150);
      if (_recentProcessedUrls[urlKey] && (now - _recentProcessedUrls[urlKey]) < DEDUP_WINDOW) {
        // 只有当前有活跃流且URL相同时才去重，避免杀死网络错误后的合法重试
        if (_streamState.active && _streamState.requestUrl.indexOf(urlPath) >= 0) {
          _debug.wrapperCalledDuplicate++;
          return baseFetch.apply(this, arguments);
        }
      }
      _recentProcessedUrls[urlKey] = now;
      // 内存泄漏防护：超过 100 条记录时删除最旧的一半
      if (Object.keys(_recentProcessedUrls).length > 100) {
        var sorted = Object.entries(_recentProcessedUrls).sort(function(a, b) { return a[1] - b[1]; });
        for (var si = 0; si < Math.floor(sorted.length / 2); si++) {
          delete _recentProcessedUrls[sorted[si][0]];
        }
      }
      // 清理过期的去重记录
      var keys = Object.keys(_recentProcessedUrls);
      for (var ki = 0; ki < keys.length; ki++) {
        if (now - _recentProcessedUrls[keys[ki]] > DEDUP_WINDOW * 2) {
          delete _recentProcessedUrls[keys[ki]];
        }
      }

      _debug.wrapperCalledMatchingUrl++;

      var fetchPromise = baseFetch.apply(this, arguments);

      return fetchPromise.then(function(response) {
        if (!response.ok || !response.body) return response;

        // 去重检查：如果这个 response 已经被处理过，直接返回
        if (_processedRequests.has(response)) {
          return response;
        }

        var contentType = response.headers.get('content-type') || '';
        // Kimi 使用 application/connect+json，不是 text/event-stream
        var isSSE = contentType.indexOf(SSEContentType) >= 0;
        var isBinaryStream = sseConfig && sseConfig.binaryStream &&
                             (contentType.indexOf('application/connect') >= 0 || contentType.indexOf('application/grpc') >= 0);
        // 对于二进制流平台，如果 URL 匹配但 content-type 未知，也尝试解析
        if (!isSSE && !isBinaryStream && sseConfig && sseConfig.binaryStream) {
          isBinaryStream = true; // 信任 apiPattern 匹配结果
        }

        // 调试：记录匹配请求的 content-type
        pushDebugEvent({
          type: 'fetch_match',
          url: url.substring(0, 80),
          contentType: contentType,
          isSSE: isSSE,
          isBinaryStream: isBinaryStream,
          hasBody: !!response.body,
          ts: Date.now()
        });

        if (!isSSE && !isBinaryStream) return response;

        _streamState.requestCount++;
        _streamState.requestUrl = url;

        // 标记此 response 已处理，防止嵌套 wrapper 重复处理
        _processedRequests.add(response);

        try {
          var teeStreams = response.body.tee();
          parseSSEStream(teeStreams[0]);

          return new Response(teeStreams[1], {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (teeErr) {
          return response;
        }
      }).catch(function(err) {
        throw err;
      });
    };
  }

  var _currentFetch = makeFetchWrapper(_origFetch);

  _debug.definePropertyUsed = true;
  Object.defineProperty(window, 'fetch', {
    get: function() {
      _debug.getterCalledTotal++;
      return _currentFetch;
    },
    set: function(val) {
      _debug.setterCalledTotal++;
      _origFetch = val;
      _currentFetch = makeFetchWrapper(val);
    },
    configurable: true,
    enumerable: true
  });

  window.__ds_streamState = function() { return _streamState; };
  window.__ds_isStreamActive = function() { return _streamState.active; };
  window.__ds_getStreamText = function() { return _streamState.accumulatedText; };

  // ========== EventSource 拦截 ==========
  // 某些平台（如通义千问）使用 EventSource API 接收 SSE 流
  var _origEventSource = window.EventSource;
  if (_origEventSource) {
    window.EventSource = function(url, config) {
      _debug.esCreated = (_debug.esCreated || 0) + 1;
      var esUrl = typeof url === 'string' ? url : '';
      _debug.esUrls = _debug.esUrls || [];
      _debug.esUrls.push(esUrl.substring(0, 100));

      var isChatApi = DS_API_PATTERN.test(esUrl);
      var es = new _origEventSource(url, config);

      if (isChatApi) {
        _debug.esMatched = (_debug.esMatched || 0) + 1;

        // 创建 EventSource 专用的流上下文
        var esStreamCtx = createStreamContext();
        esStreamCtx.started = true;
        _streamId++;
        _activeStreamId = _streamId;
        var esStreamId = _streamId;
        esStreamCtx.streamId = esStreamId;
        esStreamCtx.fullText = '';
        _lastStreamContext = esStreamCtx;
        _accumulatedLength = 0;

        _streamState.active = true;
        _streamState.requestCount++;
        _streamState.requestUrl = esUrl;
        _streamState.accumulatedText = '';
        _streamState.finishReason = null;
        _streamState.lastChunkTime = Date.now();

        postSSEMessage('__ds_stream_start', {
          requestCount: _streamState.requestCount,
          streamId: esStreamId
        });

        es.addEventListener('message', function(event) {
          // 并发流保护：忽略旧流的事件
          if (esStreamId !== _activeStreamId) return;
          try {
            var chunk = JSON.parse(event.data);
            var content = sseConfig && sseConfig.extractContent ? sseConfig.extractContent(chunk) : null;
            if (content) {
              onStreamContent(content, esStreamCtx);
            }
            // 检测流结束
            var finish = sseConfig && sseConfig.detectStreamEnd ? sseConfig.detectStreamEnd(chunk) : null;
            if (finish) {
              onStreamEnd(finish, esStreamCtx);
            }
          } catch(e) {
            // EventSource 消息解析错误，记录日志
            pushDebugEvent({ type: 'es_parse_error', error: e.message, ts: Date.now() });
          }
        });

        es.addEventListener('error', function() {
          // 并发流保护：只有当前活跃流才处理错误
          if (esStreamId !== _activeStreamId) return;
          onStreamEnd('error', esStreamCtx);
        });
      }

      return es;
    };
    window.EventSource.prototype = _origEventSource.prototype;
    window.EventSource.CONNECTING = _origEventSource.CONNECTING;
    window.EventSource.OPEN = _origEventSource.OPEN;
    window.EventSource.CLOSED = _origEventSource.CLOSED;
  }

  // Bridge: receive monitor state from ISOLATED world via postMessage
  window.__ds_monitorState = { state: 'unknown', autoWatch: false, toolCalls: 0 };
  window.addEventListener('message', function(e) {
    // 安全校验：只接受同源消息
    if (e.origin !== window.location.origin) return;
    if (e.data && e.data.type === '__ds_monitor_state_sync') {
      window.__ds_monitorState = e.data.payload;
    }
  });

  (function() {
    var _origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      _debug.xhrOpenCalled++;
      this.__ds_url = typeof url === 'string' ? url : (url && url.toString ? url.toString() : '');
      this.__ds_method = method;
      return _origOpen.apply(this, arguments);
    };

    var _origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
      _debug.xhrSendCalled++;
      var xhr = this;
      var url = xhr.__ds_url || '';

      if (DS_API_PATTERN.test(url)) {
        _debug.xhrMatchingUrl++;

        var lastTextLen = 0;
        var streamCtx = createStreamContext();

        _debug.xhrPollActiveCount++;
        _debug.xhrPollTotalCount++;

        var thisPollId = _debug.xhrPollTotalCount;
        var respType = xhr.responseType || '';
        var rsAtStart = xhr.readyState;

        if (_debugEnabled && _debug.xhrSamples.length < 5) {
          _debug.xhrSamples.push({
            pollId: thisPollId,
            url: url.substring(0, 80),
            responseType: respType,
            readyStateAtStart: rsAtStart
          });
        }

        var pollTimer = setInterval(function() {
          if (xhr.readyState >= 3 || (xhr.readyState === 4 && xhr.status >= 200)) {
            var rawText = '';
            try { rawText = xhr.responseText || ''; } catch(e) {}

            if (rawText.length > lastTextLen) {
              var newText = rawText.substring(lastTextLen);
              lastTextLen = rawText.length;

              if (_debugEnabled && _debug.xhrSamples.length < 5) {
                var sampleEntry = _debug.xhrSamples[_debug.xhrSamples.length - 1];
                if (sampleEntry && !sampleEntry.firstText) {
                  sampleEntry.firstText = newText.substring(0, 200);
                  sampleEntry.totalBytes = rawText.length;
                }
              }

              parseSSELines(newText, null, streamCtx);
            }
          }

          if (xhr.readyState === 4) {
            clearInterval(pollTimer);
            _debug.xhrPollActiveCount--;
            _debug.xhrTotalBytes += lastTextLen;
          }
        }, 200);

        // XHR 中止时清理轮询定时器
        xhr.addEventListener('abort', function() {
          clearInterval(pollTimer);
          _debug.xhrPollActiveCount--;
        });
      }

      return _origSend.apply(this, arguments);
    };
  })();
})();
