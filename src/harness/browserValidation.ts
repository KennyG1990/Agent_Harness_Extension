import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { chromium, Browser } from 'playwright-core';

export interface BrowserValidationEvidence {
  id: string;
  status: 'pass' | 'fail';
  requestedUrl: string;
  finalUrl: string;
  title: string;
  expectedText?: string;
  expectedTextFound?: boolean;
  visibleTextExcerpt: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  screenshotPath?: string;
  reportPath: string;
  browserExecutable?: string;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  failureReason?: string;
}

export interface BrowserValidationResult {
  success: boolean;
  output: string;
  evidence: BrowserValidationEvidence;
}

export interface BrowserValidationOptions {
  url: string;
  expectedText?: string;
  timeoutMs?: number;
}

const MAX_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_DIAGNOSTICS = 20;
const MAX_EXCERPT_CHARS = 4_000;

export function validateBrowserUrl(rawUrl: string): { valid: boolean; normalizedUrl?: string; reason?: string } {
  const value = String(rawUrl || '').trim();
  if (!value) return { valid: false, reason: 'browser_validate requires a non-empty url.' };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { valid: false, reason: 'browser_validate url must be an absolute http(s) URL.' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, reason: `Browser policy rejected scheme '${parsed.protocol}'. Only http(s) loopback URLs are allowed.` };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'Browser policy rejects credentials embedded in URLs.' };
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    return { valid: false, reason: `Browser policy rejected non-loopback host '${parsed.hostname}'.` };
  }
  if (parsed.port) {
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { valid: false, reason: `Browser policy rejected invalid port '${parsed.port}'.` };
    }
  }
  parsed.hash = '';
  return { valid: true, normalizedUrl: parsed.toString() };
}

export class BrowserValidationRunner {
  public constructor(private readonly workspaceRoot: string) {}

  public async run(options: BrowserValidationOptions): Promise<BrowserValidationResult> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const id = `browser-${started}-${crypto.randomBytes(3).toString('hex')}`;
    const runDir = path.join(this.workspaceRoot, '.forge', 'browser-runs');
    fs.mkdirSync(runDir, { recursive: true });
    const reportPath = path.join(runDir, `${id}.json`);
    const screenshotPath = path.join(runDir, `${id}.png`);
    const policy = validateBrowserUrl(options.url);
    if (!policy.valid || !policy.normalizedUrl) {
      const evidence = this.failureEvidence(id, options.url, started, startedAt, reportPath, policy.reason || 'Browser URL rejected.');
      this.persist(evidence);
      return { success: false, output: evidence.failureReason!, evidence };
    }

    const executablePath = detectBrowserExecutable();
    if (!executablePath) {
      const evidence = this.failureEvidence(id, policy.normalizedUrl, started, startedAt, reportPath, 'No supported host browser found. Install Microsoft Edge or Google Chrome.');
      this.persist(evidence);
      return { success: false, output: evidence.failureReason!, evidence };
    }

    const timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Number(options.timeoutMs) || 15_000));
    const expectedText = String(options.expectedText || '').trim().slice(0, 1_000);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ executablePath, headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const failedRequests: string[] = [];
      page.on('console', message => {
        if (message.type() === 'error' && consoleErrors.length < MAX_DIAGNOSTICS) consoleErrors.push(message.text().slice(0, 1_000));
      });
      page.on('pageerror', error => {
        if (pageErrors.length < MAX_DIAGNOSTICS) pageErrors.push(error.message.slice(0, 1_000));
      });
      page.on('requestfailed', request => {
        if (failedRequests.length < MAX_DIAGNOSTICS) failedRequests.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText || 'failed'}`.slice(0, 1_000));
      });
      const response = await page.goto(policy.normalizedUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
      const title = (await page.title()).slice(0, 500);
      const visibleText = (await page.locator('body').innerText({ timeout: timeoutMs })).replace(/\s+/g, ' ').trim();
      const expectedTextFound = expectedText ? visibleText.toLocaleLowerCase().includes(expectedText.toLocaleLowerCase()) : undefined;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const failures: string[] = [];
      if (!response || response.status() >= 400) failures.push(`Navigation returned HTTP ${response?.status() ?? 'no response'}.`);
      if (expectedText && !expectedTextFound) failures.push(`Expected visible text was not found: ${expectedText}`);
      if (consoleErrors.length) failures.push(`${consoleErrors.length} error-level console message(s) captured.`);
      if (pageErrors.length) failures.push(`${pageErrors.length} uncaught page error(s) captured.`);
      const completedAt = new Date().toISOString();
      const evidence: BrowserValidationEvidence = {
        id,
        status: failures.length ? 'fail' : 'pass',
        requestedUrl: policy.normalizedUrl,
        finalUrl: page.url(),
        title,
        expectedText: expectedText || undefined,
        expectedTextFound,
        visibleTextExcerpt: visibleText.slice(0, MAX_EXCERPT_CHARS),
        consoleErrors,
        pageErrors,
        failedRequests,
        screenshotPath: path.relative(this.workspaceRoot, screenshotPath).replace(/\\/g, '/'),
        reportPath: path.relative(this.workspaceRoot, reportPath).replace(/\\/g, '/'),
        browserExecutable: executablePath,
        durationMs: Date.now() - started,
        startedAt,
        completedAt,
        failureReason: failures.join(' ') || undefined
      };
      this.persist(evidence);
      return {
        success: evidence.status === 'pass',
        output: evidence.status === 'pass'
          ? `Browser validation passed: ${evidence.title || evidence.finalUrl}. Screenshot: ${evidence.screenshotPath}`
          : `Browser validation failed: ${evidence.failureReason} Screenshot: ${evidence.screenshotPath}`,
        evidence
      };
    } catch (error: any) {
      const evidence = this.failureEvidence(id, policy.normalizedUrl, started, startedAt, reportPath, `Browser validation failed: ${String(error?.message || error).slice(0, 2_000)}`, executablePath);
      this.persist(evidence);
      return { success: false, output: evidence.failureReason!, evidence };
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  private failureEvidence(id: string, requestedUrl: string, started: number, startedAt: string, reportPath: string, failureReason: string, browserExecutable?: string): BrowserValidationEvidence {
    return {
      id,
      status: 'fail',
      requestedUrl,
      finalUrl: '',
      title: '',
      visibleTextExcerpt: '',
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      reportPath: path.relative(this.workspaceRoot, reportPath).replace(/\\/g, '/'),
      browserExecutable,
      durationMs: Date.now() - started,
      startedAt,
      completedAt: new Date().toISOString(),
      failureReason
    };
  }

  private persist(evidence: BrowserValidationEvidence): void {
    const reportPath = path.join(this.workspaceRoot, evidence.reportPath);
    const runDir = path.dirname(reportPath);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(evidence, null, 2), 'utf8');
    fs.copyFileSync(reportPath, path.join(runDir, 'latest-browser-validation.json'));
    if (evidence.screenshotPath) {
      const screenshot = path.join(this.workspaceRoot, evidence.screenshotPath);
      if (fs.existsSync(screenshot)) fs.copyFileSync(screenshot, path.join(runDir, 'latest-browser-validation.png'));
    }
  }
}

export function detectBrowserExecutable(): string | undefined {
  const local = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const candidates = process.platform === 'win32'
    ? [
        path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
}
