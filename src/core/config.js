var DS_CONFIG = {
  serverUrl: 'http://localhost:3002',
  globalPermissions: false,
  endpoints: {
    health: '/health',
    tool: '/api/tool',
    exec: '/exec',
    config: '/api/config'
  },
  monitor: {
    pollInterval: 200,
    stableThreshold: 5,
    stableThresholdExtra: 15,
    autoResumeTimeout: 5000,
    maxToolIterations: 20
  },
  circuitBreaker: {
    maxConsecutiveFails: 3,
    cooldownMs: 60000
  }
};

function getServerUrl() {
  return DS_CONFIG.serverUrl;
}

function getEndpoint(name) {
  return DS_CONFIG.serverUrl + (DS_CONFIG.endpoints[name] || '');
}

function loadConfigFromStorage(callback) {
  chrome.storage.local.get(['dsConfig'], function(result) {
    if (result.dsConfig) {
      if (result.dsConfig.serverUrl) DS_CONFIG.serverUrl = result.dsConfig.serverUrl;
      if (result.dsConfig.globalPermissions !== undefined) DS_CONFIG.globalPermissions = result.dsConfig.globalPermissions;
      if (result.dsConfig.monitor) {
        if (result.dsConfig.monitor.pollInterval) DS_CONFIG.monitor.pollInterval = result.dsConfig.monitor.pollInterval;
        if (result.dsConfig.monitor.stableThreshold) DS_CONFIG.monitor.stableThreshold = result.dsConfig.monitor.stableThreshold;
        if (result.dsConfig.monitor.maxToolIterations) DS_CONFIG.monitor.maxToolIterations = result.dsConfig.monitor.maxToolIterations;
        if (result.dsConfig.monitor.autoResumeTimeout) DS_CONFIG.monitor.autoResumeTimeout = result.dsConfig.monitor.autoResumeTimeout;
      }
      if (result.dsConfig.circuitBreaker) {
        if (result.dsConfig.circuitBreaker.maxConsecutiveFails) DS_CONFIG.circuitBreaker.maxConsecutiveFails = result.dsConfig.circuitBreaker.maxConsecutiveFails;
      }
    }
    if (callback) callback();
  });
}

function saveConfigToStorage(configOverride, callback) {
  var toSave = {
    serverUrl: configOverride.serverUrl || DS_CONFIG.serverUrl,
    globalPermissions: configOverride.globalPermissions !== undefined ? configOverride.globalPermissions : DS_CONFIG.globalPermissions,
    monitor: {
      pollInterval: configOverride.pollInterval || DS_CONFIG.monitor.pollInterval,
      stableThreshold: configOverride.stableThreshold || DS_CONFIG.monitor.stableThreshold,
      maxToolIterations: configOverride.maxToolIterations || DS_CONFIG.monitor.maxToolIterations,
      autoResumeTimeout: configOverride.autoResumeTimeout || DS_CONFIG.monitor.autoResumeTimeout
    },
    circuitBreaker: {
      maxConsecutiveFails: configOverride.maxConsecutiveFails || DS_CONFIG.circuitBreaker.maxConsecutiveFails
    }
  };

  chrome.storage.local.set({ dsConfig: toSave }, function() {
    DS_CONFIG.serverUrl = toSave.serverUrl;
    DS_CONFIG.globalPermissions = toSave.globalPermissions;
    DS_CONFIG.monitor.pollInterval = toSave.monitor.pollInterval;
    DS_CONFIG.monitor.stableThreshold = toSave.monitor.stableThreshold;
    DS_CONFIG.monitor.maxToolIterations = toSave.monitor.maxToolIterations;
    DS_CONFIG.monitor.autoResumeTimeout = toSave.monitor.autoResumeTimeout;
    DS_CONFIG.circuitBreaker.maxConsecutiveFails = toSave.circuitBreaker.maxConsecutiveFails;
    if (callback) callback();
  });
}