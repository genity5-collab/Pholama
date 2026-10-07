/**
 * Web Site Studio Builder
 * Generates static sites deployable to GitHub Pages.
 * 
 * Based on Totalum architecture, adapted for static sites.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WEB_TEMPLATES = {
  'landing': {
    description: 'Simple landing page',
    sections: ['hero', 'features', 'cta'],
    files: {
      'index.html': () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body>
  <nav class="bg-white shadow">
    <div class="max-w-7xl mx-auto px-4 py-4">
      <h2 class="text-2xl font-bold">My Site</h2>
    </div>
  </nav>
  
  <section class="hero bg-gradient-to-r from-blue-500 to-purple-600 text-white py-20">
    <div class="max-w-7xl mx-auto px-4 text-center">
      <h1 class="text-5xl font-bold mb-4">Welcome</h1>
      <p class="text-xl mb-8">Your landing page content here</p>
      <button class="bg-white text-blue-600 px-8 py-3 rounded font-bold hover:bg-gray-100">
        Get Started
      </button>
    </div>
  </section>
  
  <section class="features py-20">
    <div class="max-w-7xl mx-auto px-4">
      <h2 class="text-3xl font-bold mb-12 text-center">Features</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div class="p-6 bg-gray-50 rounded">
          <h3 class="text-xl font-bold mb-2">Feature 1</h3>
          <p class="text-gray-600">Description here</p>
        </div>
        <div class="p-6 bg-gray-50 rounded">
          <h3 class="text-xl font-bold mb-2">Feature 2</h3>
          <p class="text-gray-600">Description here</p>
        </div>
        <div class="p-6 bg-gray-50 rounded">
          <h3 class="text-xl font-bold mb-2">Feature 3</h3>
          <p class="text-gray-600">Description here</p>
        </div>
      </div>
    </div>
  </section>
  
  <section class="cta bg-gray-900 text-white py-20">
    <div class="max-w-7xl mx-auto px-4 text-center">
      <h2 class="text-3xl font-bold mb-4">Ready to get started?</h2>
      <button class="bg-blue-600 px-8 py-3 rounded font-bold hover:bg-blue-700">
        Sign Up Now
      </button>
    </div>
  </section>
</body>
</html>`,
      'style.css': () => `/* Custom styles */
body { font-family: system-ui, sans-serif; }
`,
    },
  },
  'blog': {
    description: 'Blog with multiple posts',
    sections: ['header', 'post-list', 'footer'],
    files: {
      'index.html': () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Blog</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body class="bg-gray-50">
  <header class="bg-white shadow">
    <div class="max-w-4xl mx-auto px-4 py-8">
      <h1 class="text-4xl font-bold">My Blog</h1>
      <p class="text-gray-600 mt-2">Thoughts on web development</p>
    </div>
  </header>
  
  <main class="max-w-4xl mx-auto px-4 py-12">
    <article class="bg-white p-8 rounded shadow mb-8">
      <h2 class="text-2xl font-bold mb-2">First Post</h2>
      <p class="text-gray-500 text-sm mb-4">Published on Jan 1, 2024</p>
      <p class="text-gray-700 mb-4">Your blog post content goes here...</p>
      <a href="#" class="text-blue-600 hover:underline">Read more →</a>
    </article>
  </main>
</body>
</html>`,
    },
  },
};

class WebStudioBuilder {
  constructor(baseDir = path.join(require('os').homedir(), '.pholama', 'web-sites')) {
    this.baseDir = baseDir;
    fs.mkdirSync(baseDir, { recursive: true });
  }

  /**
   * Create a new web site
   */
  async createSite(name, template = 'landing') {
    if (!/^[a-z0-9-]+$/.test(name)) {
      throw new Error('Site name must be lowercase alphanumeric with dashes only');
    }

    const siteDir = path.join(this.baseDir, name);
    if (fs.existsSync(siteDir)) {
      throw new Error(`Site already exists: ${name}`);
    }

    const spec = WEB_TEMPLATES[template];
    if (!spec) throw new Error(`Unknown template: ${template}`);

    // Create site structure
    fs.mkdirSync(siteDir, { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(siteDir, 'assets'), { recursive: true });

    // Write template files
    for (const [filePath, generator] of Object.entries(spec.files)) {
      const fullPath = path.join(siteDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, typeof generator === 'function' ? generator() : generator);
    }

    // Create manifest
    const manifest = {
      name,
      template,
      created: new Date().toISOString(),
      domain: null,
      deployed: false,
      pages: ['index'],
    };
    fs.writeFileSync(
      path.join(siteDir, 'site.json'),
      JSON.stringify(manifest, null, 2)
    );

    return manifest;
  }

  /**
   * List all sites
   */
  listSites() {
    const sites = [];
    for (const dir of fs.readdirSync(this.baseDir)) {
      const manifestPath = path.join(this.baseDir, dir, 'site.json');
      if (fs.existsSync(manifestPath)) {
        sites.push(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
      }
    }
    return sites;
  }

  /**
   * Add a new page to site
   */
  async addPage(siteName, pageName, title = null) {
    const siteDir = path.join(this.baseDir, siteName);
    if (!fs.existsSync(siteDir)) throw new Error(`Site not found: ${siteName}`);

    const pageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || pageName}</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body>
  <div class="max-w-4xl mx-auto px-4 py-12">
    <h1 class="text-4xl font-bold mb-4">${title || pageName}</h1>
    <p class="text-gray-600">Page content here...</p>
  </div>
</body>
</html>`;

    const pagePath = path.join(siteDir, 'pages', `${pageName}.html`);
    fs.writeFileSync(pagePath, pageHtml);

    // Update manifest
    const manifestPath = path.join(siteDir, 'site.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest.pages) manifest.pages = [];
    manifest.pages.push(pageName);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    return { pageName, url: `/${pageName}.html` };
  }

  /**
   * Build site for deployment
   */
  async buildSite(siteName) {
    const siteDir = path.join(this.baseDir, siteName);
    const distDir = path.join(siteDir, 'dist');
    
    if (fs.existsSync(distDir)) {
      fs.rmSync(distDir, { recursive: true });
    }

    // Copy all files to dist
    fs.mkdirSync(distDir, { recursive: true });
    this.copyDir(siteDir, distDir, ['.git', 'node_modules', 'dist', '.env', 'site.json']);

    return {
      siteName,
      distPath: distDir,
      size: this.getDirectorySize(distDir),
      ready: true,
    };
  }

  /**
   * Deploy to GitHub Pages
   */
  async deployToGitHub(siteName, githubToken, repo) {
    // Build first
    const build = await this.buildSite(siteName);
    const siteDir = path.join(this.baseDir, siteName);

    try {
      // Initialize git if needed
      const gitDir = path.join(siteDir, '.git');
      if (!fs.existsSync(gitDir)) {
        execSync('git init', { cwd: siteDir });
        execSync(`git remote add origin https://github.com/${repo}.git`, { cwd: siteDir });
      }

      // Configure git
      execSync('git config user.email "builder@pholama.local"', { cwd: siteDir });
      execSync('git config user.name "Pholama Builder"', { cwd: siteDir });

      // Add and commit
      execSync('git add .', { cwd: siteDir });
      execSync('git commit -m "Deploy from Pholama Studio" || true', { cwd: siteDir });

      // Create/switch to gh-pages branch
      execSync('git checkout -b gh-pages || git checkout gh-pages', { cwd: siteDir });
      execSync('git push -u origin gh-pages --force', { cwd: siteDir });

      return {
        success: true,
        url: `https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}`,
      };
    } catch (error) {
      throw new Error(`Deployment failed: ${error.message}`);
    }
  }

  // Utilities
  copyDir(src, dest, ignore = []) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const file of fs.readdirSync(src)) {
      if (ignore.includes(file)) continue;
      const srcFile = path.join(src, file);
      const destFile = path.join(dest, file);
      if (fs.statSync(srcFile).isDirectory()) {
        this.copyDir(srcFile, destFile, ignore);
      } else {
        fs.copyFileSync(srcFile, destFile);
      }
    }
  }

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

module.exports = WebStudioBuilder;
