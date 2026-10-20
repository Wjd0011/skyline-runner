// A ~150-line Chrome DevTools Protocol client.
//
// No Puppeteer, no Playwright, no node_modules: Node 24 ships a global
// WebSocket, and Edge is already installed on Windows. This keeps the
// repository's "zero dependencies" promise true for its tests as well.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export async function findBrowser(explicit) {
  const { access } = await import('node:fs/promises');
  const list = explicit ? [explicit] : CANDIDATES;
  for (const p of list) {
    try {
      await access(p);
      return p;
    } catch { /* keep looking */ }
  }
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  throw new Error('no Chrome/Edge binary found; set CHROME_PATH');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

export class Browser {
  constructor(proc, ws, profile, port) {
    this.proc = proc;
    this.ws = ws;
    this.profile = profile;
    this.port = port;
  }

  static async launch({ port = 9333, binary, gpu = false } = {}) {
    const exe = await findBrowser(binary);
    const profile = await mkdtemp(join(tmpdir(), 'skyline-e2e-'));
    const args = [
      '--headless=new',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--window-size=1280,800',
    ];
    // Software raster keeps CI deterministic; real-device numbers come from
    // gpu:true, which is what the SLO is actually about.
    if (!gpu) args.unshift('--disable-gpu');
    args.push('about:blank');
    const proc = spawn(exe, args, { stdio: 'ignore' });

    const deadline = Date.now() + 15000;
    let version = null;
    while (Date.now() < deadline) {
      try {
        version = await getJson(`http://127.0.0.1:${port}/json/version`);
        break;
      } catch {
        await sleep(150);
      }
    }
    if (!version) throw new Error('browser did not expose a debugging port');

    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });

    return new Browser(proc, ws, profile, port);
  }

  /** Open a new tab and attach to it. */
  async newPage() {
    let target = null;
    try {
      target = await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`, { method: 'PUT' })
        .then((r) => (r.ok ? r.json() : null));
    } catch { /* older builds only allow GET */ }
    if (!target) {
      const list = await getJson(`http://127.0.0.1:${this.port}/json/list`);
      target = list.find((t) => t.type === 'page');
    }
    return new Page(target.webSocketDebuggerUrl);
  }

  async close() {
    try { this.ws.close(); } catch { /* ignore */ }
    try { this.proc.kill(); } catch { /* ignore */ }
    await sleep(300);
    try { await rm(this.profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export class Page {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.logs = [];
    this.errors = [];
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (ev) => this._onMessage(ev));
  }

  _onMessage(ev) {
    const msg = JSON.parse(ev.data);
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data || '')})`));
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params.exceptionDetails?.exception?.description || 'exception');
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        this.errors.push(msg.params.entry.text);
      }
      for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
    }
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 20000);
    });
  }

  once(method, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const list = this.listeners.get(method) || [];
      const fn = (params) => {
        clearTimeout(timer);
        this.listeners.set(method, list.filter((f) => f !== fn));
        resolve(params);
      };
      list.push(fn);
      this.listeners.set(method, list);
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeout);
    });
  }

  async init() {
    await this.ready;
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
  }

  async goto(url) {
    const loaded = this.once('Page.loadEventFired');
    await this.send('Page.navigate', { url });
    await loaded;
    await sleep(250);
  }

  async eval(expression, { awaitPromise = false } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result.value;
  }

  async waitFor(expression, { timeout = 8000, interval = 60 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await this.eval(expression)) return true;
      } catch { /* page may still be loading */ }
      await sleep(interval);
    }
    throw new Error(`waitFor timed out: ${expression}`);
  }

  async key(key, { down = true, code, vk, text } = {}) {
    const type = down ? 'keyDown' : 'keyUp';
    await this.send('Input.dispatchKeyEvent', {
      type,
      key,
      code: code || key,
      windowsVirtualKeyCode: vk || 0,
      nativeVirtualKeyCode: vk || 0,
      text: text || '',
    });
  }

  async press(key, opts = {}) {
    await this.key(key, { ...opts, down: true });
    await sleep(30);
    await this.key(key, { ...opts, down: false });
  }

  async hold(key, ms, opts = {}) {
    await this.key(key, { ...opts, down: true });
    await sleep(ms);
    await this.key(key, { ...opts, down: false });
  }

  async touch(x, y) {
    await this.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1 }],
    });
    await sleep(60);
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  async touchHold(x, y, ms) {
    await this.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1 }],
    });
    await sleep(ms);
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  async mobile(width = 390, height = 844, dpr = 3) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: dpr, mobile: true,
    });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }

  async screenshot(path) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, Buffer.from(data, 'base64'));
  }

  async close() {
    try { this.ws.close(); } catch { /* ignore */ }
  }
}
