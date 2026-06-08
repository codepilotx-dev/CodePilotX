#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, 'src');
const INCLUDED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP_DIRS = new Set(['dist', 'node_modules', 'src/types/generated']);
const MAP_COMMENT_RE =
  /(?:\/\/|\/\/@) sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([A-Za-z0-9+/=]+)/;

const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run') || flags.has('-n');
const verify = flags.has('--verify');
const applyMode = !dryRun && !verify;

function usage() {
  console.log(`
Usage:
  bun scripts/restore-from-sourcemap.mjs --dry-run
  bun scripts/restore-from-sourcemap.mjs
  bun scripts/restore-from-sourcemap.mjs --verify
`);
}

if (flags.has('-h') || flags.has('--help')) {
  usage();
  process.exit(0);
}

if (flags.size > 0 && !dryRun && !verify) {
  const mode = [...flags][0];
  console.log(`Unsupported option: ${mode}`);
  usage();
  process.exit(1);
}

async function walkFiles(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const next = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const rel = path.relative(ROOT, next).replace(/\\/g, '/');
      if (SKIP_DIRS.has(rel) || SKIP_DIRS.has(entry.name)) {
        continue;
      }

      await walkFiles(next, files);
      continue;
    }

    if (!INCLUDED_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }

    files.push(next);
  }

  return files;
}

function decodeSourcemap(text) {
  const match = text.match(MAP_COMMENT_RE);
  if (!match || !match[1]) {
    return { ok: false, reason: 'no_sourcemap', mapContent: null };
  }

  try {
    const sourcemap = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'));
    const { sourcesContent } = sourcemap;
    if (!Array.isArray(sourcesContent) || sourcesContent.length === 0) {
      return {
        ok: false,
        reason: sourcesContent ? `unexpected_sources_content_${sourcesContent.length}` : 'missing_sources_content',
        mapContent: null
      };
    }

    if (sourcesContent.length > 1) {
      return { ok: false, reason: `multi_sources_content_${sourcesContent.length}`, mapContent: null };
    }

    return { ok: true, source: sourcesContent[0], mapContent: sourcemap };
  } catch {
    return { ok: false, reason: 'invalid_sourcemap_json', mapContent: null };
  }
}

async function main() {
  const targetFiles = await walkFiles(SOURCE_DIR);

  if (verify) {
    let totalChecked = 0;
    let mapLeft = 0;
    let compilerLeft = 0;
    let cacheLeft = 0;
    const samples = { map: [], compiler: [], cache: [] };

    for (const file of targetFiles) {
      const text = await fs.readFile(file, 'utf8');
      totalChecked += 1;

      if (/sourceMappingURL=data:application\/json/.test(text)) {
        mapLeft += 1;
        if (samples.map.length < 10) {
          samples.map.push(path.relative(ROOT, file));
        }
      }

      if (text.includes('react/compiler-runtime')) {
        compilerLeft += 1;
        if (samples.compiler.length < 10) {
          samples.compiler.push(path.relative(ROOT, file));
        }
      }

      if (/const\s+\$\s*=\s*_c/.test(text)) {
        cacheLeft += 1;
        if (samples.cache.length < 10) {
          samples.cache.push(path.relative(ROOT, file));
        }
      }
    }

    console.log('verify result:');
    console.log(`  total files: ${totalChecked}`);
    console.log(`  sourceMappingURL left: ${mapLeft}`);
    console.log(`  react/compiler-runtime left: ${compilerLeft}`);
    console.log(`  const $ = _c left: ${cacheLeft}`);
    if (samples.map.length) console.log('  sourceMappingURL samples:\n    - ' + samples.map.join('\n    - '));
    if (samples.compiler.length) console.log('  compiler-runtime samples:\n    - ' + samples.compiler.join('\n    - '));
    if (samples.cache.length) console.log('  _c cache variable samples:\n    - ' + samples.cache.join('\n    - '));
    return;
  }

  const stats = {
    total: targetFiles.length,
    restored: 0,
    unchanged: 0,
    skipped: {
      noSourcemap: 0,
      invalid: 0,
      noSourcesContent: 0,
      multiSource: 0
    }
  };

  for (const file of targetFiles) {
    const text = await fs.readFile(file, 'utf8');
    const result = decodeSourcemap(text);

    if (!result.ok) {
      if (result.reason === 'no_sourcemap') {
        stats.skipped.noSourcemap += 1;
      } else if (result.reason === 'invalid_sourcemap_json') {
        stats.skipped.invalid += 1;
      } else if (result.reason === 'missing_sources_content' || result.reason === 'unexpected_sources_content_0') {
        stats.skipped.noSourcesContent += 1;
      } else if (result.reason.startsWith('multi_sources_content_')) {
        stats.skipped.multiSource += 1;
      }
      continue;
    }

    const source = result.source ?? '';
    if (text === source) {
      stats.unchanged += 1;
      continue;
    }

    if (dryRun) {
      stats.restored += 1;
      continue;
    }

    if (applyMode) {
      await fs.writeFile(file, source);
    }
    stats.restored += 1;
  }

  console.log('Summary:');
  console.log(`  total files: ${stats.total}`);
  console.log(`  restored: ${stats.restored}`);
  console.log(`  unchanged: ${stats.unchanged}`);
  console.log(`  skipped(no sourcemap): ${stats.skipped.noSourcemap}`);
  console.log(`  skipped(invalid sourcemap): ${stats.skipped.invalid}`);
  console.log(`  skipped(no sourcesContent): ${stats.skipped.noSourcesContent}`);
  console.log(`  skipped(multi sourcesContent): ${stats.skipped.multiSource}`);
  console.log(`  mode: ${dryRun ? 'dry-run' : 'apply'}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
