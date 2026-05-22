// Example openclaw-compatible plugin
// Demonstrates the plugin registration API

module.exports = function register(api) {
  api.logger.info('[example-plugin] Initializing...');

  // Register a simple tool
  api.registerTool(function(ctx) {
    return {
      name: 'example_hello',
      label: 'Example Hello',
      description: 'A simple example tool that says hello. No parameters needed.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
      execute: async function(toolCallId, args) {
        return [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Hello from example plugin v1.0.0!',
              plugin: api.name,
              timestamp: new Date().toISOString(),
              workspaceDir: ctx.workspaceDir
            })
          }
        ];
      }
    };
  });

  api.logger.info('[example-plugin] Tool "example_hello" registered');
};