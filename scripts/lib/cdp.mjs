/**
 * Cliente mínimo do Chrome DevTools Protocol, sem dependências externas.
 *
 * Usado pelos scripts de verificação de interface (smoke e fluxos). Requer o
 * Chrome/Edge instalado e o backend servindo o SPA.
 */
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

export async function waitJson(url, timeout = 20000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch {
      /* processo ainda subindo */
    }
    await sleep(120)
  }
  throw new Error(`Timeout aguardando ${url}`)
}

export class CDP {
  constructor(url) {
    this.seq = 0
    this.pending = new Map()
    this.listeners = []
    this.ws = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve())
      this.ws.addEventListener('error', () => reject(new Error('Falha no WebSocket do CDP')))
    })
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) reject(new Error(message.error.message))
        else resolve(message.result)
      } else if (message.method) {
        for (const listener of this.listeners) listener(message)
      }
    })
  }

  async send(method, params = {}) {
    await this.ready
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  on(listener) {
    this.listeners.push(listener)
  }

  close() {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

export async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  })
  if (result.exceptionDetails) {
    const description =
      result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'erro'
    throw new Error(`Erro JS: ${description.split('\n')[0]} :: ${expression.slice(0, 160)}`)
  }
  return result.result.value
}

export async function waitFor(cdp, expression, label, timeout = 15000) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    try {
      last = await evaluate(cdp, expression)
      if (last) return last
    } catch (error) {
      last = error.message
    }
    await sleep(150)
  }
  throw new Error(`Timeout aguardando "${label}" (${expression}) - ultimo: ${JSON.stringify(last)}`)
}

export function killChromeTree(child) {
  if (!child?.pid) return
  // No Windows, child.kill() mata apenas o processo lançador; a árvore
  // inteira precisa ser encerrada para liberar a porta de depuração.
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

/**
 * Sobe um Chrome headless isolado, conecta ao primeiro target de página e
 * prepara os domínios usados pelas verificações.
 */
export async function launchChrome({
  chromePath,
  port,
  profileDir,
  width = 1440,
  height = 960,
  mobile = false,
}) {
  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${width},${height}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  await waitJson(`http://127.0.0.1:${port}/json/version`)
  let targets = await waitJson(`http://127.0.0.1:${port}/json/list`)
  let page = targets.find((entry) => entry.type === 'page')
  if (!page) {
    await fetch(`http://127.0.0.1:${port}/json/new?url=about:blank`, { method: 'PUT' })
    targets = await waitJson(`http://127.0.0.1:${port}/json/list`)
    page = targets.find((entry) => entry.type === 'page')
  }
  if (!page) throw new Error('Nenhum target de pagina no Chrome')

  const cdp = new CDP(page.webSocketDebuggerUrl)
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Log.enable'),
    cdp.send('Network.enable'),
  ])
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
  })
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  })

  return {
    cdp,
    async close() {
      cdp.close()
      killChromeTree(chrome)
      await sleep(600)
    },
  }
}

/** Helpers injetados na página para preencher campos e clicar em elementos. */
export const PAGE_HELPERS = `
window.__setValue = function (selector, value) {
  const el = document.querySelector(selector);
  if (!el) throw new Error('campo nao encontrado: ' + selector);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};
window.__click = function (selector) {
  const el = document.querySelector(selector);
  if (!el) throw new Error('elemento nao encontrado: ' + selector);
  el.scrollIntoView({ block: 'center' });
  el.click();
  return true;
};
window.__text = function (selector) {
  return (document.querySelector(selector)?.textContent || '').trim();
};
window.__check = function (selector) {
  const el = document.querySelector(selector);
  if (!el) throw new Error('checkbox nao encontrado: ' + selector);
  if (!el.checked) el.click();
  return el.checked;
};
window.__setSelect = function (selector, value) {
  const el = document.querySelector(selector);
  if (!el) throw new Error('select nao encontrado: ' + selector);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
};
// Normaliza o texto do rotulo (remove asterisco de obrigatorio e espacos extras).
window.__normLabel = function (text) {
  return String(text || '').replace(/\\s+/g, ' ').replace(/\\*/g, '').trim();
};
// Localiza o controle de um campo pelo texto do rotulo (para campos sem id).
window.__labelField = function (labelText) {
  const target = window.__normLabel(labelText);
  const labels = Array.from(document.querySelectorAll('label.fp-label'));
  const label =
    labels.find((item) => window.__normLabel(item.textContent) === target) ||
    labels.find((item) => window.__normLabel(item.textContent).includes(target));
  if (!label) throw new Error('label nao encontrado: ' + labelText);
  const field = label.closest('.fp-field');
  if (!field) throw new Error('campo do label nao encontrado: ' + labelText);
  const el = field.querySelector('input, textarea, select');
  if (!el) throw new Error('controle nao encontrado para: ' + labelText);
  return el;
};
window.__setByLabel = function (labelText, value) {
  const el = window.__labelField(labelText);
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
};
window.__labelValue = function (labelText) {
  try {
    return window.__labelField(labelText).value;
  } catch {
    return null;
  }
};
window.__clickByText = function (selector, text) {
  const target = window.__normLabel(text);
  const el = Array.from(document.querySelectorAll(selector)).find(
    (node) => window.__normLabel(node.innerText).includes(target),
  );
  if (!el) throw new Error('elemento por texto nao encontrado: ' + selector + ' :: ' + text);
  el.scrollIntoView({ block: 'center' });
  el.click();
  return true;
};
window.__toasts = function () {
  return Array.from(document.querySelectorAll('.fp-toast')).map((node) => ({
    variant: (node.className.match(/fp-toast-(\\w+)/) || [])[1] || '',
    text: window.__normLabel(node.innerText),
  }));
};
true;
`

/** Navega para uma rota do SPA e aguarda o shell e o conteúdo esperado. */
export async function gotoRoute(
  cdp,
  base,
  route,
  { authenticated = true, ready, timeout = 20000 } = {},
) {
  await cdp.send('Page.navigate', { url: `${base}${route}` })
  await waitFor(cdp, "document.readyState === 'complete'", `load ${route}`, timeout)
  const shell = authenticated ? "!!document.querySelector('.topbar')" : '!!document.querySelector("form")'
  await waitFor(cdp, shell, `shell ${route}`, timeout)
  if (ready) await waitFor(cdp, ready, `conteudo ${route}`, timeout)
  await evaluate(cdp, PAGE_HELPERS)
  await sleep(450)
}
