import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluate,
  gotoRoute,
  launchChrome,
  waitFor,
  PAGE_HELPERS,
} from './lib/cdp.mjs'

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:5000'
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.SMOKE_CDP_PORT || 9300 + Math.floor(Math.random() * 500))
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = path.join(HERE, 'screenshots')
const PROFILE = path.join(os.tmpdir(), `factorpro-smoke-${process.pid}`)

const ADMIN_EMAIL = 'admin@factorpro.com.br'
const ADMIN_PASSWORD = 'Admin@12345'
const NEW_PASSWORD = 'FpSmoke@2026'

/* ------------------------------------------------------------------ helpers */

let failures = 0
const results = []

function check(label, ok, detail = '') {
  results.push({ label, ok, detail })
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`)
}

const goto = (cdp, route, options) => gotoRoute(cdp, BASE, route, options)

const AUDIT_JS = `(() => {
  function parseColor(value) {
    if (!value || value === 'transparent') return [0, 0, 0, 0];
    const m = value.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const parts = m[1].split(',').map((n) => parseFloat(n));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  function over(fg, bg) {
    const a = fg[3];
    return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
  }
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function ratio(a, b) {
    const l1 = lum(a), l2 = lum(b);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function backgroundOf(el) {
    const layers = [];
    let node = el;
    let gradient = false;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== 'none') gradient = true;
      const c = parseColor(style.backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 0.99) break;
      }
      node = node.parentElement;
    }
    let base = [255, 255, 255, 1];
    const rootBg = parseColor(getComputedStyle(document.body).backgroundColor);
    if (rootBg && rootBg[3] > 0.99) base = rootBg;
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return { color: base, gradient };
  }
  const out = { contrast: [], clipped: [], tap: [] };
  const seen = new Set();
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,p,span,strong,small,a,button,td,th,label,li,dt,dd')) {
    if (seen.has(el)) continue;
    seen.add(el);
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    if (parseFloat(style.opacity || '1') < 0.3) continue;
    if (!el.offsetParent && style.position !== 'fixed') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.right < 0 || rect.left > window.innerWidth) continue;
    const text = (el.innerText || '').trim();
    if (!text || text.length < 2) continue;
    if ([...el.children].some((child) => (child.innerText || '').trim().length > 1)) continue;
    const bg = backgroundOf(el);
    if (bg.gradient) continue;
    const fgRaw = parseColor(style.color);
    if (!fgRaw) continue;
    const fg = over(fgRaw, bg.color);
    const value = ratio(fg, bg.color);
    const size = parseFloat(style.fontSize);
    const weight = parseInt(style.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const min = large ? 3 : 4.5;
    if (value < min - 0.05) {
      out.contrast.push({
        text: text.slice(0, 48).replace(/\\s+/g, ' '),
        ratio: Math.round(value * 100) / 100,
        min,
        size,
        weight,
        color: style.color,
        bg: 'rgb(' + bg.color.slice(0, 3).map(Math.round).join(',') + ')',
        cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
        tag: el.tagName,
      });
    }
    if (
      el.scrollWidth > el.clientWidth + 4 &&
      style.overflowX === 'hidden' &&
      style.textOverflow !== 'ellipsis' &&
      !el.title
    ) {
      out.clipped.push({
        text: text.slice(0, 40).replace(/\\s+/g, ' '),
        cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
        tag: el.tagName,
        delta: el.scrollWidth - el.clientWidth,
      });
    }
  }
  if (window.innerWidth < 700) {
    for (const el of document.querySelectorAll('.icon-btn,.btn,.side-link,.fp-tab,.user-trigger,.page-link')) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || rect.right < 0 || rect.left > window.innerWidth) continue;
      if (rect.height < 32) {
        out.tap.push({
          text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 28),
          height: Math.round(rect.height),
          cls: typeof el.className === 'string' ? el.className.slice(0, 50) : '',
        });
      }
    }
  }
  return {
    contrastCount: out.contrast.length,
    clippedCount: out.clipped.length,
    tapCount: out.tap.length,
    contrast: out.contrast.slice(0, 60),
    clipped: out.clipped.slice(0, 10),
    tap: out.tap.slice(0, 10),
  };
})()`

async function audit(cdp, name) {
  const report = await evaluate(cdp, AUDIT_JS)
  const summary = `contraste=${report.contrastCount} corte=${report.clippedCount} toque=${report.tapCount}`
  console.log(`AUDIT ${name}: ${summary}`)
  if (report.contrastCount) {
    const groups = new Map()
    for (const item of report.contrast) {
      const key = `${item.cls || item.tag}|${item.color}|${item.bg}|${item.min}`
      if (!groups.has(key)) groups.set(key, { ...item, count: 0 })
      groups.get(key).count += 1
    }
    for (const group of groups.values()) {
      console.log(
        `  CONTRASTE ${group.ratio}:1 (min ${group.min}) ${group.cls || group.tag} ` +
          `cor=${group.color} fundo=${group.bg} ${group.size}px/${group.weight} x${group.count} :: ${group.text}`,
      )
    }
  }
  if (report.clippedCount) {
    for (const item of report.clipped) {
      console.log(`  CORTE ${item.tag}.${item.cls} +${item.delta}px :: ${item.text}`)
    }
  }
  if (report.tapCount) {
    for (const item of report.tap) {
      console.log(`  TOQUE ${item.height}px ${item.cls} :: ${item.text}`)
    }
  }
  check(`contraste AA em ${name}`, report.contrastCount === 0, `${report.contrastCount} violacoes`)
  check(`sem texto cortado em ${name}`, report.clippedCount === 0, `${report.clippedCount} casos`)
  if (report.tapCount) check(`alvos de toque >= 32px em ${name}`, false, `${report.tapCount} abaixo`)
  return report
}

async function shot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(OUT, `${name}.png`)
  await fs.writeFile(file, Buffer.from(data, 'base64'))
  const info = await evaluate(
    cdp,
    `(() => ({
      path: location.pathname,
      w: window.innerWidth,
      h: window.innerHeight,
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      theme: document.documentElement.getAttribute('data-theme')
    }))()`,
  )
  const overflow = info.scrollW > info.w + 1
  check(`sem overflow horizontal em ${name}`, !overflow, JSON.stringify(info))
  console.log(`SHOT  ${name}  (${info.path}, ${info.w}x${info.h}, ${info.theme})`)
  return info
}

async function shotFull(cdp, name) {
  const height = await evaluate(cdp, 'document.documentElement.scrollHeight')
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1440, height: Math.min(height, 6000), scale: 1 },
  })
  await fs.writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`SHOT  ${name} (full, altura ${height}px)`)
}

async function apiLogin() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  if (!response.ok) {
    throw new Error(
      `Login de API falhou (${response.status}). Rode "flask reset-admin-password --email ${ADMIN_EMAIL} --password ${ADMIN_PASSWORD}".`,
    )
  }
  const data = await response.json()
  return data
}

async function apiGet(token, route) {
  const response = await fetch(`${BASE}/api${route}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`GET ${route} -> ${response.status}`)
  return response.json()
}

/**
 * O teste altera a senha do administrador. Para poder ser reexecutado, se a
 * senha esperada nao funcionar o script redefine o admin via CLI do Flask
 * (o que tambem devolve o estado de primeiro acesso).
 */
async function ensureAdmin() {
  let session = null
  try {
    session = await apiLogin()
  } catch (error) {
    console.log(`Login inicial falhou (${error.message.split('\n')[0]}).`)
  }
  if (session?.user?.must_change_password) return session
  console.log('Restaurando o estado de primeiro acesso do administrador via CLI do Flask...')
  resetAdminCli()
  return await apiLogin()
}

function resetAdminCli() {
  const cli = path.join(ROOT, 'backend', '.venv', 'Scripts', 'flask.exe')
  const result = spawnSync(
    cli,
    ['reset-admin-password', '--email', ADMIN_EMAIL, '--password', ADMIN_PASSWORD],
    { cwd: path.join(ROOT, 'backend'), encoding: 'utf8' },
  )
  console.log(`${result.stdout || ''}${result.stderr || ''}`.trim())
}

/* --------------------------------------------------------------------- main */

async function main() {
  await fs.rm(PROFILE, { recursive: true, force: true })
  await fs.mkdir(OUT, { recursive: true })

  console.log(`Base: ${BASE}`)
  console.log('Coletando ids via API...')
  const apiSession = await ensureAdmin()
  const token = apiSession.access_token
  const clients = await apiGet(token, '/clients?per_page=1')
  const cheques = await apiGet(token, '/cheques?per_page=1')
  const boletos = await apiGet(token, '/boletos?per_page=1')
  const clientId = clients.items[0]?.id
  const chequeId = cheques.items[0]?.id
  const boletoId = boletos.items[0]?.id
  console.log(`ids: cliente=${clientId} cheque=${chequeId} boleto=${boletoId}`)
  check('dados de demonstracao disponiveis', Boolean(clientId && chequeId && boletoId))

  let session
  let cdp
  try {
    session = await launchChrome({
      chromePath: CHROME,
      port: DEBUG_PORT,
      profileDir: PROFILE,
      width: 1440,
      height: 960,
    })
    cdp = session.cdp

    const consoleErrors = []
    const failedRequests = []
    const requestUrls = new Map()
    cdp.on((message) => {
      const { method, params } = message
      if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        consoleErrors.push(
          params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '),
        )
      }
      if (method === 'Runtime.exceptionThrown') {
        consoleErrors.push(
          `EXCEPTION: ${
            params.exceptionDetails.exception?.description || params.exceptionDetails.text
          }`,
        )
      }
      if (method === 'Log.entryAdded' && params.entry.level === 'error') {
        const url = params.entry.url || ''
        // Boot sem sessao: o app consulta /api/auth/refresh e recebe 401 de
        // proposito (visitante nao autenticado). Nao e erro de aplicacao.
        const expected = url.includes('/api/auth/refresh') && /401/.test(params.entry.text)
        if (!expected) consoleErrors.push(`LOG: ${params.entry.text} ${url}`)
      }
      if (method === 'Network.requestWillBeSent') {
        requestUrls.set(params.requestId, params.request.url)
      }
      if (method === 'Network.loadingFailed' && !/ERR_ABORTED/.test(params.errorText)) {
        failedRequests.push(`${params.errorText} ${requestUrls.get(params.requestId) || ''}`)
      }
    })

    await cdp.send('Page.navigate', { url: `${BASE}/` })
    await waitFor(cdp, "document.readyState === 'complete'", 'primeiro load')
    await sleep(900)
    await evaluate(cdp, PAGE_HELPERS)

    /* ---------------------------------------------------------------- login */
    await goto(cdp, '/login', { authenticated: false, ready: '!!document.querySelector("#field-email")' })
    check('login exibe titulo do produto', /FACTOR PRO/.test(await evaluate(cdp, 'document.body.innerText')))
    await shot(cdp, '01-login-claro')
    await audit(cdp, 'login')

    await evaluate(cdp, '__setValue("#field-email", "admin@factorpro.com.br")')
    await evaluate(cdp, '__setValue("#field-password", "Admin@12345")')
    await evaluate(cdp, '__click(\'button[type="submit"]\')')
    await waitFor(cdp, "location.pathname === '/trocar-senha'", 'redirecionamento para troca de senha', 20000)
    await waitFor(cdp, '!!document.querySelector("#field-current_password")', 'form de troca de senha')
    await sleep(400)
    await shot(cdp, '02-troca-de-senha-obrigatoria')

    await evaluate(cdp, '__setValue("#field-current_password", "Admin@12345")')
    await evaluate(cdp, '__setValue("#field-new_password", "FpSmoke@2026")')
    await evaluate(cdp, '__setValue("#field-confirm_password", "FpSmoke@2026")')
    await evaluate(cdp, '__click(\'button[type="submit"]\')')
    await waitFor(cdp, "location.pathname === '/'", 'entrada no dashboard', 20000)
    await waitFor(cdp, "document.querySelectorAll('.stat-grid > *').length >= 4", 'cards do dashboard', 20000)
    await sleep(900)
    check('dashboard mostra o nome do usuario', /Administrador/.test(await evaluate(cdp, 'document.querySelector(".topbar").innerText')))
    await shot(cdp, '03-dashboard-claro')
    await shotFull(cdp, '03b-dashboard-claro-full')
    await audit(cdp, 'dashboard-claro')

    /* ---------------------------------------------------------------- tema */
    await evaluate(cdp, '__click(\'button[aria-label="Ativar tema escuro"]\')')
    await sleep(700)
    check(
      'tema escuro aplicado',
      (await evaluate(cdp, 'document.documentElement.getAttribute("data-theme")')) === 'dark',
    )
    await shot(cdp, '04-dashboard-escuro')
    await audit(cdp, 'dashboard-escuro')

    await goto(cdp, '/', { ready: "document.querySelectorAll('.stat-grid > *').length >= 4" })
    check(
      'preferencia de tema persiste apos recarregar',
      (await evaluate(cdp, 'document.documentElement.getAttribute("data-theme")')) === 'dark',
    )

    /* --------------------------------------------------------------- listas */
    await goto(cdp, '/clientes', {
      ready: "document.querySelectorAll('tbody tr').length > 0",
    })
    const clientRows = await evaluate(cdp, "document.querySelectorAll('tbody tr').length")
    check('lista de clientes renderiza linhas', clientRows >= 3, `${clientRows} linhas`)
    await shot(cdp, '05-clientes-escuro')
    await audit(cdp, 'clientes-escuro')
    await evaluate(cdp, '__click(\'button[aria-label="Ativar tema claro"]\')')
    await sleep(600)
    await shot(cdp, '05b-clientes-claro')
    await audit(cdp, 'clientes-claro')

    await goto(cdp, `/clientes/${clientId}`, { ready: '!!document.querySelector(".detail-main")' })
    check('detalhe do cliente exibe codigo', /CLI-/.test(await evaluate(cdp, 'document.body.innerText')))
    await shot(cdp, '06-cliente-detalhe')
    await shotFull(cdp, '06b-cliente-detalhe-full')

    await goto(cdp, `/clientes/${clientId}/editar`, {
      ready: '!!document.querySelector("#client-form")',
    })
    check(
      'formulario de cliente preenchido',
      (await evaluate(cdp, 'document.querySelector("#field-name").value.length')) > 0,
    )
    await shot(cdp, '07-cliente-editar')

    await goto(cdp, '/clientes/novo', { ready: '!!document.querySelector("#client-form")' })
    await shot(cdp, '08-cliente-novo')
    await audit(cdp, 'cliente-novo')

    await goto(cdp, '/cheques', { ready: "document.querySelectorAll('tbody tr').length > 0" })
    await shot(cdp, '09-cheques')
    await goto(cdp, `/cheques/${chequeId}`, { ready: '!!document.querySelector(".detail-main")' })
    check(
      'detalhe do cheque exibe integridade dos valores',
      /valor nominal/i.test(await evaluate(cdp, 'document.body.innerText')) &&
        /integridade dos valores/i.test(await evaluate(cdp, 'document.body.innerText')),
    )
    await shot(cdp, '10-cheque-detalhe')
    await shotFull(cdp, '10b-cheque-detalhe-full')
    await audit(cdp, 'cheque-detalhe')
    await goto(cdp, `/cheques/${chequeId}/editar`, { ready: '!!document.querySelector("#cheque-form")' })
    await shot(cdp, '11-cheque-editar')
    await goto(cdp, '/cheques/novo', { ready: '!!document.querySelector("#cheque-form")' })
    await shot(cdp, '12-cheque-novo')
    await shotFull(cdp, '12b-cheque-novo-full')
    await audit(cdp, 'cheque-novo')

    await goto(cdp, '/boletos', { ready: "document.querySelectorAll('tbody tr').length > 0" })
    await shot(cdp, '13-boletos')
    await goto(cdp, `/boletos/${boletoId}`, { ready: '!!document.querySelector(".detail-main")' })
    await shot(cdp, '14-boleto-detalhe')
    await audit(cdp, 'boleto-detalhe')
    await goto(cdp, '/boletos/novo', { ready: '!!document.querySelector("#boleto-form")' })
    await shot(cdp, '15-boleto-novo')

    /* ------------------------------------------- modulos das etapas 2 e 3 */
    await goto(cdp, '/operacoes', { ready: '!!document.querySelector(".filter-bar")' })
    check(
      'operacoes exibe a tela implementada',
      /operações/i.test(await evaluate(cdp, 'document.querySelector(".page").innerText')),
    )
    await shot(cdp, '16-operacoes')
    await shotFull(cdp, '16b-operacoes-full')
    await audit(cdp, 'operacoes')

    await goto(cdp, '/recebimentos', { ready: '!!document.querySelector(".filter-bar")' })
    check(
      'recebimentos exibe a tela implementada',
      /recebimentos/i.test(await evaluate(cdp, 'document.querySelector(".page").innerText')),
    )
    await shot(cdp, '17-recebimentos')
    await audit(cdp, 'recebimentos')

    await goto(cdp, '/relatorios', {
      ready: 'document.querySelectorAll(".fp-tabs .fp-tab").length >= 5',
    })
    const reportTabs = await evaluate(cdp, 'document.querySelectorAll(".fp-tabs .fp-tab").length')
    check('relatorios exibe as cinco secoes', reportTabs >= 5, `${reportTabs} abas`)
    check(
      'relatorios mostra resumo derivado',
      /títulos no período/i.test(await evaluate(cdp, 'document.querySelector(".page").innerText')),
    )
    await shot(cdp, '18-relatorios')
    await shotFull(cdp, '18b-relatorios-full')
    await audit(cdp, 'relatorios')

    await goto(cdp, '/configuracoes', { ready: '!!document.querySelector(".topbar")' })
    await shot(cdp, '19-configuracoes')
    await shotFull(cdp, '19b-configuracoes-full')
    await audit(cdp, 'configuracoes')
    await evaluate(cdp, '__click(\'button[aria-label="Ativar tema escuro"]\')')
    await sleep(700)
    await shot(cdp, '19c-configuracoes-escuro')
    await audit(cdp, 'configuracoes-escuro')
    await evaluate(cdp, '__click(\'button[aria-label="Ativar tema claro"]\')')
    await sleep(700)

    await goto(cdp, '/administracao', {
      ready: 'document.querySelectorAll(".user-card").length > 0',
    })
    check(
      'administracao lista o usuario administrador',
      /Administrador/i.test(await evaluate(cdp, 'document.body.innerText')),
    )
    await shot(cdp, '20-administracao')
    await shotFull(cdp, '20b-administracao-full')
    await audit(cdp, 'administracao')

    // Aba de auditoria (registros reais das acoes do teste)
    await evaluate(cdp, 'document.querySelectorAll(\'[role="tab"]\')[1].click()')
    await waitFor(cdp, 'document.querySelectorAll(".audit-row").length > 0', 'lista de auditoria', 20000)
    await sleep(400)
    await shot(cdp, '20c-administracao-auditoria')
    await audit(cdp, 'administracao-auditoria')

    await goto(cdp, '/rota-inexistente', { ready: '!!document.querySelector(".topbar")' })
    const notFoundText = await evaluate(cdp, 'document.body.innerText')
    check('rota inexistente mostra 404', /404|não encontrada|nao encontrada/i.test(notFoundText))
    await shot(cdp, '21-404')
    await audit(cdp, '404')

    /* ---------------------------------------------------------------- mobile */
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    })
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    await goto(cdp, '/', { ready: "document.querySelectorAll('.stat-grid > *').length >= 4" })
    check(
      'menu mobile recolhido por padrao',
      !(await evaluate(cdp, '!!document.querySelector(".sidebar.mobile-open")')),
    )
    await shot(cdp, '22-mobile-dashboard')
    await audit(cdp, 'mobile-dashboard')
    await evaluate(cdp, '__click(\'button[aria-label="Abrir menu"]\')')
    await waitFor(cdp, '!!document.querySelector(".sidebar.mobile-open")', 'menu mobile aberto')
    await sleep(500)
    await shot(cdp, '23-mobile-menu')
    await audit(cdp, 'mobile-menu')
    await evaluate(cdp, '__click(".sidebar-backdrop")')
    await sleep(500)
    await goto(cdp, '/clientes', { ready: "document.querySelectorAll('tbody tr').length > 0" })
    await shot(cdp, '24-mobile-clientes')
    await audit(cdp, 'mobile-clientes')
    await goto(cdp, '/cheques/novo', { ready: '!!document.querySelector("#cheque-form")' })
    await shot(cdp, '25-mobile-cheque-novo')
    await shotFull(cdp, '25b-mobile-cheque-novo-full')
    await audit(cdp, 'mobile-cheque-novo')

    /* ---------------------------------------------------------------- logout */
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await goto(cdp, '/', { ready: "document.querySelectorAll('.stat-grid > *').length >= 4" })
    await evaluate(cdp, '__click(".user-trigger")')
    await waitFor(cdp, '!!document.querySelector(".user-menu")', 'menu do usuario')
    await evaluate(cdp, '__click(\'.user-menu-item.danger\')')
    await waitFor(cdp, "location.pathname === '/login'", 'logout redireciona para login', 20000)
    await shot(cdp, '26-logout-login')

    const relevantFailures = failedRequests.filter((entry) => !/favicon/i.test(entry))
    check('sem erros de console', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '))
    check('sem requisicoes falhas', relevantFailures.length === 0, relevantFailures.slice(0, 5).join(' | '))

    console.log('\nRestaurando senha provisoria do administrador...')
    resetAdminCli()
  } finally {
    await session?.close()
    await sleep(600)
    await fs.rm(PROFILE, { recursive: true, force: true }).catch(() => {})
  }

  console.log('\n================ RESUMO ================')
  const passed = results.filter((entry) => entry.ok).length
  console.log(`${passed}/${results.length} verificacoes OK`)
  if (failures) {
    console.log('Falhas:')
    for (const entry of results.filter((item) => !item.ok)) {
      console.log(` - ${entry.label} ${entry.detail}`)
    }
  }
  console.log(`Screenshots em ${OUT}`)
  process.exitCode = failures ? 1 : 0
}

main().catch((error) => {
  console.error('\nSMOKE TEST FALHOU:', error.message)
  process.exitCode = 1
})
