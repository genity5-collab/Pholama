# Pholama v2 Upgrade: MCP Tool Framework + Dual Studio (PC & Web)

## Executive Summary
Integrating **Marcel-MSC's local-llm-mcp-tool** for enhanced MCP server support and **totalumlabs' ai-app-builder-open** for unified studio code generation across PC and Web platforms. Authentication via Base64 (upgrading to OAuth2 later).

---

## Core Integration Architecture

### Stack
```
┌─────────────────────────────────────────────────────────────┐
│                    Pholama v0.10.0                          │
├─────────────────────────────────────────────────────────────┤
│  PC Studio (React/HTML Builder)  │  Web Studio (Site Builder)│
├──────────────────────────────────┼──────────────────────────┤
│  Code Generation Engine          │  Page Template System    │
│  Live Preview Server             │  GitHub Pages Deployer   │
├──────────────────────────────────┴──────────────────────────┤
│         MCP Tool Framework (Enhanced)                        │
│  ├─ Tool Discovery & Registry                              │
│  ├─ Execution Pipeline                                     │
│  ├─ Dependency Resolution                                  │
│  └─ Environment-Aware Routing                              │
├──────────────────────────────────────────────────────────────┤
│              Credential Management (Base64→OAuth2)          │
├──────────────────────────────────────────────────────────────┤
│  Agent System  │  Local LLMs  │  Tool Execution  │  Storage │
└──────────────────────────────────────────────────────────────┘
```

---

## Phase 1: MCP Framework Enhancement

### 1.1 New Dependencies (Add to package.json)
```json
{
  "@modelcontextprotocol/sdk": "^1.0.0",
  "axios": "^1.6.0",
  "dotenv": "^16.0.0",
  "mime-types": "^2.1.35",
  "ejs": "^3.1.9"
}
```

### 1.2 New Files

#### `server/mcp-core.js` - MCP Engine
```javascript
/**
 * Enhanced MCP Tool Framework
 * - Discovers MCP servers (HTTP/stdio)
 * - Manages tool registry
 * - Routes tool calls with dependency resolution
 * - Logs all executions for debugging
 */

class MCPEngine {
  constructor(options = {}) {
    this.servers = new Map();      // name → {url, tools, headers}
    this.toolCache = new Map();    // tool_name → {server, schema}
    this.executionLog = [];
    this.maxLogSize = options.maxLogSize || 10000;
  }

  async discover(serverUrl, headers = {}) {
    // Fetch tool list from MCP server
    // Validate schema
    // Cache tool metadata
  }

  async execute(toolName, args, context) {
    // Find tool in registry
    // Validate arguments
    // Execute via server
    // Log execution
    // Return result
  }

  async resolveDependencies(tools) {
    // Analyze tool dependencies
    // Check for conflicts
    // Return execution order
  }

  getExecutionLog(limit = 50) {
    // Return recent executions with timing
  }
}

module.exports = MCPEngine;
```

#### `server/mcp-tools.js` - Tool Registry & Discovery
```javascript
/**
 * Tool Registry Management
 * - Built-in tool definitions
 * - MCP server tool discovery
 * - Tool capability matrix
 * - Compatibility checking
 */

const BUILTIN_TOOLS = [
  // Existing 19 tools
  { name: 'web_search', category: 'web', tier: 'free' },
  { name: 'fetch_page', category: 'web', tier: 'free' },
  { name: 'run_command', category: 'system', tier: 'paid' },
  // ... add all 19
];

async function discoverMCPTools(serverUrl, headers) {
  // POST to {serverUrl}/mcp/tools/list
  // Parse response
  // Validate each tool schema
  // Return tool list
}

function validateToolCall(toolName, args, registry) {
  // Check tool exists
  // Validate argument schema
  // Check user permissions
  // Return validation result
}

module.exports = { BUILTIN_TOOLS, discoverMCPTools, validateToolCall };
```

#### `server/tool-executor.js` - Unified Executor
```javascript
/**
 * Routes tool execution to correct engine
 * - Built-in tools
 * - MCP HTTP servers
 * - System commands
 * - Remote APIs (OpenAI, Groq, etc.)
 */

async function executeTool(toolName, args, context) {
  const { agent, mcp, power } = context;
  
  // Determine tool type
  if (isBuiltin(toolName)) {
    return executeBuiltin(toolName, args, context);
  } else if (isMCPTool(toolName)) {
    return executeMCP(toolName, args, context);
  } else if (isCommand(toolName)) {
    return executeCommand(toolName, args, context);
  }
  
  throw new Error(`Unknown tool: ${toolName}`);
}

module.exports = { executeTool };
```

### 1.3 API Endpoints (Add to server.js)

```javascript
// GET /api/mcp/discover - Auto-discover MCP servers on network
// POST /api/mcp/add - Add new MCP server
// DELETE /api/mcp/remove - Remove MCP server
// GET /api/mcp/tools - List all available tools
// GET /api/mcp/tools/:name - Get tool details
// POST /api/mcp/tools/:name/execute - Execute a tool
// GET /api/mcp/log - Get execution log
```

---

## Phase 2: PC Studio Builder

### 2.1 New Files

#### `server/studio/pc-builder.js` - PC Studio Core
```javascript
/**
 * PC Studio: Generate React/HTML projects locally
 * 
 * Features:
 * - Component templates (form, dashboard, settings, wizard)
 * - Code generation with AI
 * - Live preview on local dev server
 * - Auto-dependency installation
 * - Webpack/Vite config generation
 */

class PCStudioBuilder {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.manifest = {};
  }

  async createProject(name, template = 'blank') {
    // Create project folder structure
    // Initialize package.json
    // Create initial files from template
    // Install dependencies
  }

  async generateComponent(prompt, style = 'tailwind') {
    // Call AI to generate component code
    // Validate output
    // Save to project
    // Update imports
  }

  async previewProject() {
    // Start dev server on dynamic port
    // Return preview URL
    // Watch for file changes
  }

  async buildProject() {
    // Run webpack/vite build
    // Generate static files
    // Create distribution folder
  }
}

module.exports = PCStudioBuilder;
```

#### `server/studio/code-generators.js` - Code Generation
```javascript
/**
 * Multi-framework code generation
 * - React components (Hooks, Context)
 * - HTML/CSS/JS
 * - Vue 3
 * - Tailwind integration
 */

const templates = {
  'form': `
    import React, { useState } from 'react';
    
    export default function Form() {
      const [data, setData] = useState({});
      
      // Form implementation
    }
  `,
  'dashboard': `
    import React from 'react';
    
    export default function Dashboard() {
      // Dashboard charts and widgets
    }
  `,
  'settings': `
    import React, { useState } from 'react';
    
    export default function Settings() {
      const [settings, setSettings] = useState({});
      // Settings panel
    }
  `,
  'wizard': `
    import React, { useState } from 'react';
    
    export default function Wizard() {
      const [step, setStep] = useState(0);
      // Multi-step wizard
    }
  `,
};

async function generateFromPrompt(prompt, framework = 'react') {
  // Send prompt to AI model
  // Parse response for component code
  // Validate syntax
  // Return component
}

module.exports = { templates, generateFromPrompt };
```

#### `server/studio/dependencies.js` - Dependency Manager
```javascript
/**
 * Smart dependency management
 * - Detects existing node_modules
 * - Resolves version conflicts
 * - Auto-installs missing packages
 * - Rollback on failure
 */

async function checkDependencies(projectPath) {
  // Read package.json
  // Check actual node_modules
  // Compare versions
  // Return missing/outdated list
}

async function installDependencies(projectPath, deps = null) {
  // Use npm or pnpm
  // Show progress
  // Validate install success
  // Return results
}

async function resolveDependencyConflict(pkg1, pkg2) {
  // Analyze dependency tree
  // Find common version
  // Recommend solution
}

module.exports = {
  checkDependencies,
  installDependencies,
  resolveDependencyConflict
};
```

### 2.2 Studio API Endpoints (Add to server.js)

```javascript
// POST /api/studio/pc/create - Create new PC project
// GET /api/studio/pc/projects - List PC projects
// POST /api/studio/pc/generate - AI generate component
// POST /api/studio/pc/preview - Start preview server
// POST /api/studio/pc/build - Build for production
// POST /api/studio/pc/deps/check - Check dependencies
// POST /api/studio/pc/deps/install - Install missing deps
// DELETE /api/studio/pc/:project - Delete project
```

---

## Phase 3: Web Site Studio

### 3.1 New Files

#### `server/studio/web-builder.js` - Web Site Builder
```javascript
/**
 * Web Studio: Generate websites deployable to GitHub Pages
 * 
 * Features:
 * - Page templates (landing, blog, portfolio, docs)
 * - Static site generation
 * - GitHub Pages auto-deploy
 * - SEO optimization
 * - Dark mode support
 */

class WebStudioBuilder {
  constructor(projectPath) {
    this.projectPath = projectPath;
  }

  async createSite(name, template = 'landing') {
    // Create site structure
    // Initialize git repo
    // Create GitHub Pages config
    // Setup domain settings
  }

  async generatePage(prompt, template = 'section') {
    // AI generates page content
    // Convert to HTML/Markdown
    // Apply site styling
  }

  async deploySite(githubToken, repo) {
    // Build static files
    // Push to gh-pages branch
    // Update GitHub Pages settings
  }
}

module.exports = WebStudioBuilder;
```

#### `server/studio/site-templates.js` - Page Templates
```javascript
/**
 * Pre-built page templates for web sites
 * All use Tailwind CSS + responsive design
 */

const templates = {
  'landing': `
    <!-- Hero section -->
    <!-- Features section -->
    <!-- CTA section -->
  `,
  'blog-post': `
    <!-- Article header -->
    <!-- Content -->
    <!-- Comments -->
  `,
  'portfolio': `
    <!-- Project grid -->
    <!-- Case studies -->
  `,
  'docs': `
    <!-- Sidebar nav -->
    <!-- Content with code blocks -->
    <!-- Search -->
  `,
};

module.exports = { templates };
```

#### `web/site-studio.js` - Web Studio Frontend
```javascript
/**
 * Browser UI for web site builder
 * - Visual site editor
 * - Page manager
 * - Deployment controls
 * - Preview
 */

class WebStudioUI {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  async loadProjects() {
    // Fetch projects from server
    // Display in list
  }

  async createPage() {
    // Show page creation modal
    // Get template choice
    // Call API to create
  }

  async previewSite() {
    // Open site preview in modal
    // Real-time sync with editor
  }

  async deploySite() {
    // Ask for GitHub token
    // Show deployment progress
    // Link to deployed site
  }
}

module.exports = WebStudioUI;
```

### 3.2 Web Studio API Endpoints (Add to server.js)

```javascript
// POST /api/studio/web/create - Create new web site
// GET /api/studio/web/sites - List web sites
// POST /api/studio/web/page - Add page
// POST /api/studio/web/build - Build static site
// POST /api/studio/web/deploy - Deploy to GitHub Pages
// DELETE /api/studio/web/:site - Delete site
```

---

## Phase 4: Authentication & Credentials

### 4.1 Base64 Credential Storage (Temporary)

#### `server/auth-credentials.js`
```javascript
/**
 * Base64-based credential storage (temporary solution)
 * Format: base64(provider:key:secret)
 * 
 * IMPORTANT: Upgrade to OAuth2/JWT in production
 * This is for rapid development and testing
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CREDS_FILE = path.join(process.env.HOME, '.pholama', 'credentials.base64');

function storeCredential(provider, key, secret) {
  const cred = `${provider}:${key}:${secret}`;
  const encoded = Buffer.from(cred).toString('base64');
  
  // Load existing
  let creds = {};
  try {
    const data = fs.readFileSync(CREDS_FILE, 'utf8');
    creds = JSON.parse(data);
  } catch {}
  
  // Add new
  creds[provider] = encoded;
  
  // Save
  fs.mkdirSync(path.dirname(CREDS_FILE), { recursive: true });
  fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
  
  return true;
}

function getCredential(provider) {
  try {
    const data = fs.readFileSync(CREDS_FILE, 'utf8');
    const creds = JSON.parse(data);
    const encoded = creds[provider];
    if (!encoded) return null;
    
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const [prov, key, secret] = decoded.split(':');
    
    return { provider: prov, key, secret };
  } catch {
    return null;
  }
}

function deleteCredential(provider) {
  try {
    const data = fs.readFileSync(CREDS_FILE, 'utf8');
    const creds = JSON.parse(data);
    delete creds[provider];
    fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  storeCredential,
  getCredential,
  deleteCredential
};
```

### 4.2 Provider Integration

#### `server/providers-extended.js`
```javascript
/**
 * Extended provider support for AI models
 * - OpenAI (GPT-4, GPT-3.5)
 * - Claude (Anthropic)
 * - Groq (fast open models)
 * - Local models (Ollama, llama.cpp)
 */

const auth = require('./auth-credentials');

async function getProviderModels(provider) {
  const cred = auth.getCredential(provider);
  if (!cred) throw new Error(`No credentials for ${provider}`);
  
  switch (provider) {
    case 'openai':
      return getOpenAIModels(cred.key);
    case 'anthropic':
      return getClaudeModels(cred.key);
    case 'groq':
      return getGroqModels(cred.key);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

module.exports = { getProviderModels };
```

### 4.3 API Endpoints for Credentials

```javascript
// POST /api/auth/creds - Store credential
// GET /api/auth/creds/:provider - Get credential (masked)
// DELETE /api/auth/creds/:provider - Delete credential
// POST /api/auth/providers - List available providers
// POST /api/auth/test - Test credential validity
```

---

## Phase 5: Installation & Auto-Setup

### 5.1 New Files

#### `install/auto-setup.js` - Smart Installation
```javascript
/**
 * Automated setup for Pholama dependencies
 * - Detects missing tools
 * - Installs with progress
 * - Validates installation
 * - Provides helpful error messages
 */

const os = require('os');
const { execSync } = require('child_process');

async function checkRequirements() {
  return {
    node: checkNode(),
    python: checkPython(),
    git: checkGit(),
    npm: checkNpm(),
    llamaCpp: checkLlamaCpp(),
  };
}

async function installMissing(requirements) {
  const missing = Object.entries(requirements)
    .filter(([_, status]) => !status.installed)
    .map(([tool, _]) => tool);
  
  for (const tool of missing) {
    console.log(`Installing ${tool}...`);
    await installTool(tool);
  }
}

async function installTool(tool) {
  if (process.platform === 'win32') {
    // Windows: use winget or scoop
  } else if (process.platform === 'darwin') {
    // macOS: use homebrew
  } else {
    // Linux: use apt/yum/pacman
  }
}

module.exports = { checkRequirements, installMissing };
```

#### `install/deps-resolver.js` - Dependency Resolver
```javascript
/**
 * Analyzes and resolves package dependencies
 * - Detects conflicts
 * - Suggests compatible versions
 * - Creates lock files
 * - Validates installations
 */

async function analyzeDependencies(packageJson) {
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  
  return {
    total: Object.keys(deps).length,
    outdated: await checkOutdated(deps),
    conflicts: detectConflicts(deps),
    security: await checkSecurity(deps),
  };
}

module.exports = { analyzeDependencies };
```

### 5.2 Auto-Setup Flow

```javascript
// In server.js, on first startup:

async function autoSetup() {
  const setupFile = path.join(os.homedir(), '.pholama', 'setup-done.json');
  const prior = readSetupStatus(setupFile);
  
  if (!prior || prior.version < CURRENT_VERSION) {
    console.log('🚀 Pholama First-Time Setup\n');
    
    // Check requirements
    const reqs = await checkRequirements();
    
    // Install missing
    await installMissing(reqs);
    
    // Install npm deps
    execSync('npm install', { cwd: ROOT });
    
    // Initialize directories
    initializeDirectories();
    
    // Mark complete
    writeSetupStatus(setupFile, {
      version: CURRENT_VERSION,
      timestamp: Date.now(),
      success: true,
    });
    
    console.log('✅ Setup complete!\n');
  }
}
```

---

## Files to Update

### 1. `server/server.js` - Add New Endpoints

```javascript
// Add new route handlers before the static file serving

// MCP Framework
if (p === '/api/mcp/discover' && req.method === 'POST') { /* ... */ }
if (p === '/api/mcp/tools' && req.method === 'GET') { /* ... */ }

// PC Studio
if (p.startsWith('/api/studio/pc/')) { /* ... */ }

// Web Studio
if (p.startsWith('/api/studio/web/')) { /* ... */ }

// Credentials
if (p === '/api/auth/creds' && req.method === 'POST') { /* ... */ }
```

### 2. `package.json` - Add Dependencies & Scripts

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "axios": "^1.6.0",
    "ejs": "^3.1.9"
  },
  "scripts": {
    "studio:pc:preview": "node server/studio/pc-builder.js preview",
    "studio:web:build": "node server/studio/web-builder.js build",
    "setup:check": "node install/auto-setup.js check",
    "setup:install": "node install/auto-setup.js install"
  }
}
```

### 3. `web/app.js` - Add Studio UI

```javascript
// Add Studio section to navigation
// Add project management modal
// Add live preview modal
```

### 4. `.v0/README.md` - Add Migration Notes

```markdown
## v0.10.0 Changes (MCP & Studio Upgrade)

### MCP Framework
- Enhanced tool discovery
- MCP server auto-discovery
- Improved tool execution logging
- New tool capability matrix

### PC Studio
- Code generation with AI
- Live preview server
- Auto-dependency installation
- Support for React, HTML, Vue

### Web Studio
- Static site generator
- GitHub Pages deployment
- SEO optimization
- Dark mode templates

### Credentials
- Base64 credential storage (temporary)
- Multi-provider support
- Secure local storage

### Setup
- Auto-install dependencies
- Check system requirements
- Provide setup status
```

---

## Dependency Installation Checklist

After pulling code, run:

```bash
# Check system requirements
npm run setup:check

# Install any missing system tools
npm run setup:install

# Install npm dependencies
npm install

# Test everything works
npm test

# Start Pholama
npm start
```

---

## Testing Plan

### Unit Tests
- [ ] MCP tool discovery
- [ ] Code generation
- [ ] Dependency resolution
- [ ] Credential storage

### Integration Tests
- [ ] Create PC project → Generate → Preview → Build
- [ ] Create Web site → Add pages → Deploy
- [ ] Add MCP server → Discover tools → Execute

### E2E Tests
- [ ] Full PC Studio workflow
- [ ] Full Web Studio workflow
- [ ] Tool execution in agent loop

---

## Rollout Plan

### v0.10.0-beta
1. Deploy MCP framework (Phase 1)
2. Internal testing with PC Studio
3. Gather feedback

### v0.10.0-rc
1. Complete Web Studio
2. Add credential system
3. Performance optimization

### v0.10.0 (Release)
1. Full documentation
2. Production-ready
3. GitHub Release with assets

---

## Future Roadmap

- **v0.11**: OAuth2 credential management
- **v0.12**: Database persistence (Supabase)
- **v0.13**: Team collaboration features
- **v0.14**: Custom tool marketplace
- **v0.15**: AI training on custom data

---

## Documentation Files to Create

- `docs-md/STUDIO.md` - Studio user guide
- `docs-md/MCP.md` - MCP framework guide
- `docs-md/API.md` - Updated with new endpoints
- `docs-md/CREDENTIALS.md` - Credential management
