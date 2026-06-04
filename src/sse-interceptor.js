(function() {
  'use strict';

  if (window.__ds_sse_interceptor_ready) return;
  window.__ds_sse_interceptor_ready = true;

  var DS_API_PATTERN = /chat\/completion/;
  var SSEContentType = 'text/event-stream';

  var _streamState = {
    active: false,
    accumulatedText: '',
    lastChunkTime: 0,
    finishReason: null,
    requestCount: 0,
    requestUrl: ''
  };

  var _debug = {
    wrapperCalledTotal: 0,
    wrapperCalledMatchingUrl: 0,
    wrapperCalledNonMatching: 0,
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
    streamEvents: []
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
    data.source = 'deepseek-tool-agent';
    data.type = type;
    window.postMessage(data, '*');
  }

  function getContentFromDSChunk(chunk) {
    if (!chunk) return null;

    if (chunk.choices && chunk.choices.length > 0) {
      var delta = chunk.choices[0].delta;
      if (delta && delta.content) return delta.content;
      // delta 可能存在但 content 为空字符串（流式传输中的空 chunk）
      // 不要丢弃 — 记录但跳过
      if (delta && delta.content === '' && _debug.streamEvents.length < 300) {
        _debug.streamEvents.push({ type: 'empty_content', delta: JSON.stringify(delta).substring(0, 100), ts: Date.now() });
      }
    }

    if (typeof chunk.v === 'string') {
      if (chunk.p) {
        if (chunk.p === 'response/fragments/-1/content') {
          return chunk.v;
        }
        return null;
      }
      return chunk.v;
    }

    if (chunk.p === 'response/fragments' && chunk.o === 'APPEND' && Array.isArray(chunk.v)) {
      var texts = [];
      for (var i = 0; i < chunk.v.length; i++) {
        var f = chunk.v[i];
        if (f.type === 'RESPONSE' && f.content) texts.push(f.content);
        if (f.type === 'THINK' && f.content) texts.push('[思考]' + f.content);
      }
      return texts.length > 0 ? texts.join('') : null;
    }

    return null;
  }

  function isDSStreamEnd(chunk) {
    if (!chunk) return null;

    if (chunk.p === 'response/status' && chunk.o === 'SET' && chunk.v === 'FINISHED') {
      return 'finished';
    }

    if (chunk.choices && chunk.choices.length > 0) {
      var fr = chunk.choices[0].finish_reason;
      if (fr) return fr;
    }

    return null;
  }

  function isDSEventClose(eventType, chunk) {
    if (eventType === 'close') return 'close';
    return null;
  }

  var _lastStreamContext = null;

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
      // 如果上一次流异常结束（active 卡在 true），先强制结束
      if (_streamState.active) {
        _streamState.active = false;
      }

      ctx.started = true;
      ctx.fullText = '';
      ctx.chunkCount = 0;
      _streamState.active = true;
      _streamState.accumulatedText = '';
      _streamState.lastChunkTime = Date.now();
      _streamState.finishReason = null;
      postSSEMessage('__ds_stream_start', {
        requestCount: _streamState.requestCount
      });
    }

    ctx.chunkCount++;
    ctx.fullText += content;
    _streamState.accumulatedText = ctx.fullText;
    _streamState.lastChunkTime = Date.now();

    // 调试：记录每个 chunk 的内容
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
        text: content,
        fullText: ctx.fullText,
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
    // 清理 _lastStreamContext，防止下次复用旧 context
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

        var endReason = isDSStreamEnd(chunk);
        if (endReason) {
          onStreamEnd(endReason, ctx);
          return;
        }

        var content = getContentFromDSChunk(chunk);
        if (content) {
          onStreamContent(content, ctx);
        }
      } catch(e) {}

      var closeReason = isDSEventClose(currentEventType || eventTypeOverride, null);
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

  function parseSSEStream(stream) {
    var reader = stream.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var streamCtx = createStreamContext();

    function processChunk(result) {
      if (result.done) {
        // 流结束但可能没有收到 [DONE] 标记，必须触发 onStreamEnd
        // 否则 Monitor 永远收不到 __ds_stream_end 事件
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

      _debug.wrapperCalledMatchingUrl++;

      var fetchPromise = baseFetch.apply(this, arguments);

      return fetchPromise.then(function(response) {
        if (!response.ok || !response.body) return response;

        var contentType = response.headers.get('content-type') || '';
        if (contentType.indexOf(SSEContentType) === -1) return response;

        _streamState.requestCount++;
        _streamState.requestUrl = url;

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