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

  var _streamState = {
    active: false,
    accumulatedText: '',
    lastChunkTime: 0,
    finishReason: null,
    requestCount: 0,
    requestUrl: '',
    platformId: platform ? platform.id : 'unknown'
  };

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

  function postSSEMessage(type, data) {
    data.source = 'ai-tool-agent';
    data.type = type;
    data.platformId = _streamState.platformId;
    window.postMessage(data, '*');
  }

  // 从 SSE chunk 中提取文本内容 — 委托给平台适配器
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

  // 检测流结束 — 委托给平台适配器
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

  // 检测流关闭事件 — 委托给平台适配器
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

  // 超时保护：如果流卡在 active 超过 120 秒，自动重置
  setInterval(function() {
    if (_streamState.active && _streamState.lastChunkTime > 0) {
      var elapsed = Date.now() - _streamState.lastChunkTime;
      if (elapsed > 120000) {
        console.warn('[SSE Interceptor] 流超时 (' + Math.round(elapsed/1000) + 's)，强制重置');
        _streamState.active = false;
        _lastStreamContext = null;
        postSSEMessage('__ds_stream_end', {
          text: _streamState.accumulatedText || '',
          finishReason: 'timeout'
        });
      }
    }
  }, 30000);

  function createStreamContext() {
    return { started: false, fullText: '', chunkCount: 0 };
  }

  function onStreamContent(content, ctx) {
    ctx = ctx || _lastStreamContext || createStreamContext();
    _lastStreamContext = ctx;

    if (!ctx.started) {
      if (_streamState.active) {
        _streamState.active = false;
      }
      ctx.started = true;
      ctx.fullText = '';
      ctx.chunkCount = 0;
      _accumulatedLength = 0;
      _streamState.active = true;
      _streamState.accumulatedText = '';
      _streamState.lastChunkTime = Date.now();
      _streamState.finishReason = null;
      postSSEMessage('__ds_stream_start', {
        requestCount: _streamState.requestCount
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

    if (_debug.streamEvents.length < 200) {
      _debug.streamEvents.push({
        type: 'content',
        contentLen: content.length,
        contentPreview: content.substring(0, 30),
        totalLen: ctx.fullText.length,
        ts: Date.now()
      });
    }

    if (ctx.chunkCount % 10 === 0 || ctx.chunkCount === 1) {
      postSSEMessage('__ds_stream_chunk', {
        text: isCumulative ? (_streamState.accumulatedText.substring(_streamState.accumulatedText.length - 100)) : content,
        fullText: _streamState.accumulatedText,
        chunkCount: ctx.chunkCount
      });
    }
  }

  function onStreamEnd(reason, ctx) {
    ctx = ctx || _lastStreamContext;
    _streamState.active = false;
    _streamState.finishReason = reason || 'done';
    _streamState.accumulatedText = ctx ? ctx.fullText : '';
    postSSEMessage('__ds_stream_end', {
      text: ctx ? ctx.fullText : '',
      finishReason: _streamState.finishReason
    });
    _lastStreamContext = null;
  }

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

        var endReason = detectStreamEnd(chunk);
        if (endReason) {
          onStreamEnd(endReason, ctx);
          return;
        }

        var content = getContentFromChunk(chunk);
        if (content) {
          onStreamContent(content, ctx);
        }
      } catch(e) {}

      var closeReason = detectEventClose(currentEventType || eventTypeOverride, null);
      if (closeReason) {
        onStreamEnd(closeReason, ctx);
        return;
      }

      if (currentEventType === 'ready') {
        _streamState.requestCount++;
      }

      if (currentEventType === 'update_session') {
        if (_debug.streamEvents.length < 50) {
          _debug.streamEvents.push({ type: 'session', ts: Date.now() });
        }
      }
    }
  }

  // Kimi Connect RPC 二进制流解析
  function parseBinaryStream(stream) {
    var reader = stream.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var streamCtx = createStreamContext();

    function processChunk(result) {
      if (result.done) {
        if (streamCtx.started) {
          onStreamEnd('stream_done', streamCtx);
        }
        return;
      }

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
        onStreamEnd('error:' + err.message, streamCtx);
      });
    }

    reader.read().then(processChunk).catch(function(err) {
      onStreamEnd('error:' + err.message, streamCtx);
    });
  }

  function parseSSEStream(stream) {
    // 检查是否是二进制流（如 Kimi）
    if (sseConfig && sseConfig.binaryStream) {
      parseBinaryStream(stream);
      return;
    }

    var reader = stream.getReader();
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

  function makeFetchWrapper(baseFetch) {
    return function(input, init) {
      _debug.wrapperCalledTotal++;
      var url = typeof input === 'string' ? input : (input && input.url || '');

      if (_debug.urlsSeen.length < 20) {
        _debug.urlsSeen.push(url.substring(0, 80));
      }

      if (!DS_API_PATTERN.test(url)) {
        _debug.wrapperCalledNonMatching++;
        return baseFetch.apply(this, arguments);
      }

      // URL级别去重：同一URL在2秒内只处理一次
      var now = Date.now();
      // 只取路径部分进行去重，避免相对路径和绝对路径被视为不同URL
      var urlPath = url;
      try {
        var urlObj = new URL(url, location.origin);
        urlPath = urlObj.pathname + urlObj.search;
      } catch(e) {}
      var urlKey = urlPath.substring(0, 150);
      if (_recentProcessedUrls[urlKey] && (now - _recentProcessedUrls[urlKey]) < DEDUP_WINDOW) {
        _debug.wrapperCalledDuplicate++;
        return baseFetch.apply(this, arguments);
      }
      _recentProcessedUrls[urlKey] = now;
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
        if (_debug.streamEvents.length < 200) {
          _debug.streamEvents.push({
            type: 'fetch_match',
            url: url.substring(0, 80),
            contentType: contentType,
            isSSE: isSSE,
            isBinaryStream: isBinaryStream,
            hasBody: !!response.body,
            ts: Date.now()
          });
        }

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
        _streamState.active = true;
        _streamState.requestCount++;
        _streamState.requestUrl = esUrl;
        _streamState.accumulatedText = '';
        _streamState.finishReason = null;
        _streamState.lastChunkTime = Date.now();

        es.addEventListener('message', function(event) {
          try {
            var chunk = JSON.parse(event.data);
            var content = sseConfig && sseConfig.extractContent ? sseConfig.extractContent(chunk) : null;
            if (content) {
              if (sseConfig && sseConfig.cumulativeContent) {
                _streamState.accumulatedText = content;
              } else {
                _streamState.accumulatedText += content;
              }
              _streamState.lastChunkTime = Date.now();

              if (_debug.streamEvents.length < 200) {
                _debug.streamEvents.push({
                  type: 'es_content',
                  contentLen: content.length,
                  totalLen: _streamState.accumulatedText.length,
                  contentPreview: content.substring(0, 50),
                  ts: Date.now()
                });
              }
            }
            // 检测流结束
            var finish = sseConfig && sseConfig.detectStreamEnd ? sseConfig.detectStreamEnd(chunk) : null;
            if (finish) {
              _streamState.finishReason = finish;
              _streamState.active = false;
            }
          } catch(e) {}
        });

        es.addEventListener('error', function() {
          _streamState.active = false;
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

        if (_debug.xhrSamples.length < 5) {
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

              if (_debug.xhrSamples.length < 5) {
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
        }, 100);
      }

      return _origSend.apply(this, arguments);
    };
  })();
})();
