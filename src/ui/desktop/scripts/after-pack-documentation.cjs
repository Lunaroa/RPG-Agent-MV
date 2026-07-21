const fs = require('node:fs');
const path = require('node:path');

const LANGUAGES = ['zh-CN', 'en-US'];
const LOCAL_RESOURCE_EXTENSIONS = new Set(['.md', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

function requiredFile(filePath, description) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`Packaged documentation is incomplete: missing ${description} (${filePath}).`);
  }
}

function confinedPath(root, baseRelative, reference) {
  const referencePath = String(reference || '').split('#')[0].split('?')[0].replaceAll('\\', '/');
  if (!referencePath || /^(?:[a-z]+:|\/|[A-Za-z]:)/i.test(referencePath)) return null;
  const target = path.resolve(root, path.dirname(baseRelative), referencePath);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!target.startsWith(prefix)) throw new Error(`Packaged documentation reference leaves the docs directory: ${reference}`);
  return target;
}

function visitTokens(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) visitTokens(item, visit);
    return;
  }
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) visitTokens(child, visit);
}

async function verifyPageReferences(docsRoot, relativePage) {
  const { marked } = await import('marked');
  const pagePath = path.join(docsRoot, relativePage);
  const tokens = marked.lexer(fs.readFileSync(pagePath, 'utf8'));
  const references = [];
  visitTokens(tokens, (token) => {
    if ((token.type === 'image' || token.type === 'link') && typeof token.href === 'string') references.push(token.href);
  });
  for (const reference of references) {
    if (/^(?:https?:|mailto:|data:|#)/i.test(reference)) continue;
    const extension = path.extname(reference.split('#')[0].split('?')[0]).toLowerCase();
    if (!LOCAL_RESOURCE_EXTENSIONS.has(extension)) continue;
    const target = confinedPath(docsRoot, relativePage, reference);
    if (target) requiredFile(target, `resource referenced by ${relativePage}`);
  }
}

async function verifyPackagedDocumentation(appRoot) {
  const docsRoot = path.join(appRoot, 'docs');
  const navigationPath = path.join(docsRoot, 'navigation.json');
  requiredFile(navigationPath, 'docs/navigation.json');
  requiredFile(path.join(appRoot, 'src', 'ui', 'desktop', 'dist', 'documentation.html'), 'documentation renderer entry');
  requiredFile(path.join(appRoot, 'src', 'ui', 'desktop', 'dist-electron', 'documentation-preload.js'), 'documentation preload');
  const navigation = JSON.parse(fs.readFileSync(navigationPath, 'utf8'));
  for (const language of LANGUAGES) {
    const sections = navigation[language];
    if (!Array.isArray(sections) || !sections.length) throw new Error(`Packaged documentation navigation is empty for ${language}.`);
    for (const section of sections) {
      if (!Array.isArray(section.pages) || !section.pages.length) throw new Error(`Packaged documentation section is empty for ${language}.`);
      for (const page of section.pages) {
        const relative = String(page.path || '').replaceAll('\\', '/');
        const pagePath = confinedPath(docsRoot, 'navigation.json', relative);
        if (!pagePath || path.extname(pagePath).toLowerCase() !== '.md') throw new Error(`Invalid packaged documentation page: ${relative}`);
        requiredFile(pagePath, `${language} page ${relative}`);
        await verifyPageReferences(docsRoot, relative);
      }
    }
  }
}

async function afterPack(context) {
  await verifyPackagedDocumentation(path.join(context.appOutDir, 'resources', 'app'));
}

module.exports = afterPack;
module.exports.verifyPackagedDocumentation = verifyPackagedDocumentation;
