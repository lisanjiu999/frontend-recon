/*
 * Browser bootstrap: resolve playwright-core, find an installed Chrome/Edge when
 * Playwright's own browser bundle is unavailable, and report which strategy won.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const skillRoot = path.resolve(here, '..', '..');

export async function loadPlaywright({ install = true } = {}) {
  try {
    return await import('playwright-core');
  } catch (first) {
    if (!install) throw first;
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    process.stderr.write('[frontend-recon] installing playwright-core…\n');
    try {
      execFileSync(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
        cwd: skillRoot,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
    } catch (e) {
      throw new Error(
        `playwright-core is not installed and "npm install" failed (${e.message}). Run it manually in ${skillRoot}.`,
      );
    }
    try {
      return await import('playwright-core');
    } catch {
      const alt = path.join(skillRoot, 'node_modules', 'playwright-core', 'index.js');
      if (existsSync(alt)) return import(pathToFileURL(alt).href);
      throw new Error(`playwright-core still unresolved after install; expected ${alt}`);
    }
  }
}

function findBundledChromium() {
  const bases = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    process.env.HOME ? path.join(process.env.HOME, 'Library', 'Caches', 'ms-playwright') : null,
    process.env.HOME ? path.join(process.env.HOME, '.cache', 'ms-playwright') : null,
  ].filter(Boolean);

  const candidates = [];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    let entries = [];
    try { entries = readdirSync(base); } catch { continue; }
    for (const dir of entries.sort().reverse()) {
      if (!/^chromium-\d+$/.test(dir)) continue;
      const roots = [
        path.join(base, dir, 'chrome-win64', 'chrome.exe'),
        path.join(base, dir, 'chrome-win', 'chrome.exe'),
        path.join(base, dir, 'chrome-linux', 'chrome'),
        path.join(base, dir, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(base, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      ];
      for (const r of roots) if (existsSync(r)) candidates.push(r);
    }
  }
  return candidates[0] || null;
}

export function launchArgs() {
  return [
    '--autoplay-policy=no-user-gesture-required',
    '--force-color-profile=srgb',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
  ];
}

export async function launchBrowser({ headless = true, slowMo = 0 } = {}) {
  const { chromium } = await loadPlaywright();
  const base = { headless, slowMo, args: launchArgs(), timeout: 45000 };
  const attempts = [];
  const envPath = process.env.CHROME_PATH || process.env.EDGE_PATH;
  if (envPath && existsSync(envPath)) attempts.push({ label: `env:${path.basename(envPath)}`, opts: { executablePath: envPath } });
  attempts.push({ label: 'channel:chrome', opts: { channel: 'chrome' } });
  attempts.push({ label: 'channel:msedge', opts: { channel: 'msedge' } });
  const bundled = findBundledChromium();
  if (bundled) attempts.push({ label: `cache:${path.basename(path.dirname(path.dirname(bundled)))}`, opts: { executablePath: bundled } });
  attempts.push({ label: 'playwright-default', opts: {} });

  const failures = [];
  for (const a of attempts) {
    try {
      const browser = await chromium.launch({ ...base, ...a.opts });
      return { browser, strategy: a.label, attempts: [...failures, a.label] };
    } catch (e) {
      failures.push(`${a.label}: ${String(e.message).split('\n')[0].slice(0, 160)}`);
    }
  }
  throw new Error('No usable Chromium found.\n' + failures.join('\n') + '\nSet CHROME_PATH to a chrome.exe path.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.includes('--install')) {
    await loadPlaywright({ install: true });
    const { chromium } = await loadPlaywright();
    process.stdout.write(`playwright-core ready; bundled chromium: ${chromium.executablePath()}\n`);
  } else {
    const { browser, strategy, attempts } = await launchBrowser();
    process.stdout.write(`launched via ${strategy} (attempts: ${attempts.join(', ')})\n`);
    await browser.close();
  }
}