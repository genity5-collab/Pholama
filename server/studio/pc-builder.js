/**
 * PC Studio Builder
 * Generates React/HTML projects locally with AI assistance.
 * 
 * Based on Totalum's ai-app-builder-open architecture.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TEMPLATES = {
  'react-blank': {
    files: {
      'package.json': (name) => JSON.stringify({
        name,
        version: '0.1.0',
        private: true,
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          'react-router-dom': '^6.0.0',
        },
        devDependencies: {
          vite: '^5.0.0',
          '@vitejs/plugin-react': '^4.0.0',
          tailwindcss: '^3.0.0',
        },
        scripts: {
          dev: 'vite',
          build: 'vite build',
          preview: 'vite preview',
        },
      }, null, 2),
      'src/App.jsx': () => `import React from 'react';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-900">{PROJECT_NAME}</h1>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        <p className="text-gray-600">Start building here...</p>
      </main>
    </div>
  );
}`,
      'src/index.css': () => '@tailwind base;\n@tailwind components;\n@tailwind utilities;',
      'vite.config.js': () => `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: 'localhost', port: 5173 },
});`,
    },
  },
  'html-blank': {
    files: {
      'package.json': (name) => JSON.stringify({
        name,
        version: '0.1.0',
        scripts: {
          dev: 'live-server .',
        },
        devDependencies: {
          'live-server': '^1.2.1',
        },
      }, null, 2),
      'index.html': () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{PROJECT_NAME}</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body>
  <div id="app" class="min-h-screen bg-gray-100">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-6">
        <h1 class="text-3xl font-bold text-gray-900">{PROJECT_NAME}</h1>
      </div>
    </header>
    <main class="max-w-7xl mx-auto px-4 py-6">
      <p class="text-gray-600">Start building here...</p>
    </main>
  </div>
</body>
</html>`,
    },
  },
};

class PCStudioBuilder {
  constructor(baseDir = path.join(require('os').homedir(), '.pholama', 'studio')) {
    this.baseDir = baseDir;
    this.projects = new Map();
    fs.mkdirSync(baseDir, { recursive: true });
  }

  /**
   * Create a new project
   */
  async createProject(name, template = 'react-blank') {
    if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
      throw new Error('Project name must contain only alphanumeric chars, dashes, and underscores');
    }

    const projectDir = path.join(this.baseDir, name);
    if (fs.existsSync(projectDir)) {
      throw new Error(`Project already exists: ${name}`);
    }

    const spec = TEMPLATES[template];
    if (!spec) throw new Error(`Unknown template: ${template}`);

    // Create project structure
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });

    // Write template files
    for (const [filePath, generator] of Object.entries(spec.files)) {
      const fullPath = path.join(projectDir, filePath);
      const content = typeof generator === 'function' 
        ? generator(name) 
        : generator;
      
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }

    // Create manifest
    const manifest = {
      name,
      template,
      created: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      status: 'initialized',
    };
    fs.writeFileSync(
      path.join(projectDir, '.studio.json'),
      JSON.stringify(manifest, null, 2)
    );

    this.projects.set(name, { dir: projectDir, manifest });
    return manifest;
  }

  /**
   * List all projects
   */
  listProjects() {
    const projects = [];
    for (const dir of fs.readdirSync(this.baseDir)) {
      const manifestPath = path.join(this.baseDir, dir, '.studio.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        projects.push({ ...manifest, dir });
      }
    }
    return projects;
  }

  /**
   * Generate a component from AI prompt
   */
  async generateComponent(projectName, prompt, style = 'tailwind') {
    const project = this.getProject(projectName);
    
    // Placeholder: In real implementation, call AI model here
    // For now, return a template component
    return {
      name: 'GeneratedComponent',
      code: `import React from 'react';

// Generated from: ${prompt}
export default function GeneratedComponent() {
  return (
    <div className="p-4 bg-white rounded shadow">
      <p className="text-gray-600">Component: ${prompt}</p>
    </div>
  );
}`,
      filePath: 'src/components/Generated.jsx',
    };
  }

  /**
   * Start dev preview server
   */
  async previewProject(projectName) {
    const project = this.getProject(projectName);
    
    // Install dependencies if needed
    const nodeModulesPath = path.join(project.dir, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      console.log('Installing dependencies...');
      this.installDependencies(projectName);
    }

    // Start dev server
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(project.dir, 'package.json'), 'utf8')
    );
    
    const devScript = packageJson.scripts?.dev || 'npm run dev';
    return {
      projectName,
      devCommand: devScript,
      workingDirectory: project.dir,
      status: 'ready',
    };
  }

  /**
   * Install dependencies
   */
  async installDependencies(projectName) {
    const project = this.getProject(projectName);
    
    try {
      execSync('npm install', { cwd: project.dir, stdio: 'inherit' });
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to install dependencies: ${error.message}`);
    }
  }

  /**
   * Build project for production
   */
  async buildProject(projectName) {
    const project = this.getProject(projectName);
    
    try {
      execSync('npm run build', { cwd: project.dir, stdio: 'inherit' });
      const distPath = path.join(project.dir, 'dist');
      return {
        success: true,
        distPath,
        size: this.getDirectorySize(distPath),
      };
    } catch (error) {
      throw new Error(`Build failed: ${error.message}`);
    }
  }

  /**
   * Get project details
   */
  getProject(name) {
    const cached = this.projects.get(name);
    if (cached) return cached;

    const projectDir = path.join(this.baseDir, name);
    const manifestPath = path.join(projectDir, '.studio.json');
    
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Project not found: ${name}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return { dir: projectDir, manifest };
  }

  // Utility
  getDirectorySize(dir) {
    let size = 0;
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        size += this.getDirectorySize(fullPath);
      } else {
        size += fs.statSync(fullPath).size;
      }
    }
    return size;
  }
}

module.exports = PCStudioBuilder;
