/**
 * MCP Framework Engine
 * Extends Pholama's existing MCP support with enhanced tool discovery,
 * execution pipeline, and dependency resolution.
 * 
 * Based on patterns from Marcel-MSC/local-llm-mcp-tool
 */

const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

class MCPEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.servers = new Map();      // name → {url, tools, headers, capabilities}
    this.toolCache = new Map();    // tool_name → {server, schema, lastUpdated}
    this.executionLog = [];        // [{tool, args, result, timestamp, duration}]
    this.maxLogSize = options.maxLogSize || 10000;
    this.discoveryInterval = options.discoveryInterval || 30000; // 30s
  }

  /**
   * Discover MCP server and register its tools
   * @param {string} name - Server name
   * @param {string} url - Server HTTP endpoint
   * @param {object} headers - Optional auth headers
   */
  async discover(name, url, headers = {}) {
    try {
      const response = await this.fetch(url + '/mcp/tools/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      
      if (!Array.isArray(data.tools)) {
        throw new Error('Invalid tool list response');
      }

      // Register server
      const serverInfo = {
        name,
        url,
        headers,
        tools: data.tools,
        capabilities: data.capabilities || {},
        discovered: new Date(),
        status: 'online',
      };
      
      this.servers.set(name, serverInfo);

      // Cache tools
      for (const tool of data.tools) {
        const toolKey = `${name}:${tool.name}`;
        this.toolCache.set(toolKey, {
          server: name,
          schema: tool,
          lastUpdated: new Date(),
        });
      }

      this.emit('server-discovered', { name, tools: data.tools.length });
      return serverInfo;
    } catch (error) {
      this.servers.set(name, { name, url, headers, status: 'error', error: error.message });
      this.emit('discovery-error', { name, error: error.message });
      throw error;
    }
  }

  /**
   * Execute a tool via MCP server
   * @param {string} toolName - Full tool name or {server}:{tool} format
   * @param {object} args - Tool arguments
   * @param {object} context - Execution context (user, session, etc.)
   */
  async executeTool(toolName, args, context = {}) {
    const startTime = Date.now();
    const logEntry = { tool: toolName, args, timestamp: new Date(), context };

    try {
      const [serverName, name] = toolName.includes(':') 
        ? toolName.split(':', 2) 
        : [null, toolName];

      let server;
      if (serverName) {
        server = this.servers.get(serverName);
        if (!server) throw new Error(`Server not found: ${serverName}`);
      } else {
        // Auto-find first server with this tool
        for (const [srvName, srv] of this.servers) {
          if (srv.tools && srv.tools.some(t => t.name === name)) {
            server = srv;
            break;
          }
        }
      }

      if (!server) throw new Error(`No server found for tool: ${toolName}`);
      if (server.status !== 'online') throw new Error(`Server offline: ${server.name}`);

      // Call the tool
      const response = await this.fetch(server.url + '/mcp/tools/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...server.headers },
        body: JSON.stringify({ name, arguments: args }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Tool error: ${error}`);
      }

      const result = await response.json();
      logEntry.result = result;
      logEntry.status = 'success';
    } catch (error) {
      logEntry.result = error.message;
      logEntry.status = 'error';
      logEntry.error = error;
    }

    logEntry.duration = Date.now() - startTime;
    this._addToLog(logEntry);
    this.emit('tool-executed', logEntry);

    if (logEntry.status === 'error') throw logEntry.error;
    return logEntry.result;
  }

  /**
   * Get all available tools
   * @returns {array} Tools grouped by server
   */
  listTools() {
    const tools = [];
    for (const [name, server] of this.servers) {
      if (server.tools) {
        for (const tool of server.tools) {
          tools.push({
            id: `${name}:${tool.name}`,
            name: tool.name,
            server: name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        }
      }
    }
    return tools;
  }

  /**
   * Validate a tool call
   * @returns {object} {valid: bool, errors: []}
   */
  validateToolCall(toolName, args) {
    const errors = [];
    let found = false;

    for (const [srvName, server] of this.servers) {
      const toolSpec = server.tools?.find(t => t.name === toolName);
      if (!toolSpec) continue;
      
      found = true;
      // Validate schema if provided
      if (toolSpec.inputSchema && toolSpec.inputSchema.required) {
        for (const required of toolSpec.inputSchema.required) {
          if (!(required in args)) {
            errors.push(`Missing required argument: ${required}`);
          }
        }
      }
    }

    if (!found) errors.push(`Tool not found: ${toolName}`);
    return { valid: errors.length === 0, errors };
  }

  /**
   * Get execution log
   * @param {number} limit - Number of entries to return
   */
  getExecutionLog(limit = 50) {
    return this.executionLog.slice(-limit).map(e => ({
      tool: e.tool,
      status: e.status,
      duration: e.duration,
      timestamp: e.timestamp,
      error: e.error?.message,
    }));
  }

  /**
   * Get server status
   */
  getStatus() {
    const servers = [];
    for (const [name, server] of this.servers) {
      servers.push({
        name,
        url: server.url,
        status: server.status || 'unknown',
        tools: server.tools?.length || 0,
        capabilities: server.capabilities,
      });
    }
    return { servers, totalTools: this.toolCache.size };
  }

  // Private helpers
  _addToLog(entry) {
    this.executionLog.push(entry);
    if (this.executionLog.length > this.maxLogSize) {
      this.executionLog.shift();
    }
  }

  async fetch(url, options) {
    return new Promise((resolve, reject) => {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.request(url, options, resolve);
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }
}

module.exports = MCPEngine;
