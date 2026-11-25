/**
 * FACTOR PRO - teste funcional de ponta a ponta pela interface (Chrome headless/CDP).
 *
 * Diferente do smoke (que percorre telas), este script EXECUTA operações reais
 * pela interface e confere o resultado tanto na tela quanto na API:
 *   - cadastro de cliente e bloqueio de CPF/CNPJ duplicado;
 *   - edição de cliente;
 *   - cadastro de cheque com divergência de valores (alerta, não bloqueio);
 *   - cadastro de boleto coerente;
 *   - exclusão de cliente bloqueada por documentos em aberto;
 *   - alteração de status de documento;
 *   - exclusão lógica de documento e de cliente;
 *   - trilha de auditoria conferida via API.
 *
 * O teste cria os próprios dados e remove tudo ao final, podendo ser reexecutado.
 *
 * Uso:  node scripts/browser_flows.mjs
 * Requer: backend servindo o SPA em http://127.0.0.1:5000
 */
import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluate, gotoRoute, launchChrome, waitFor, PAGE_HELPERS } from './lib/cdp.mjs'

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:5000'
const CHROME =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const DEBUG_PORT = Number(process.env.SMOKE_CDP_PORT || 9300 + Math.floor(Math.random() * 500))
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = path.join(HERE, 'screenshots')
const PROFILE = path.join(os.tmpdir(), `factorpro-flows-${process.pid}`)

const ADMIN_EMAIL = 'admin@factorpro.com.br'
const ADMIN_PASSWORD = 'Admin@12345'
const NEW_PASSWORD = 'FpFlow@2026'

// Dados do teste (unicos o bastante para nao colidir com a base de demonstracao).
const MARKER = 'FLUXO-UI-TESTE'
const CLIENT_NAME = 'Cliente Teste Fluxo UI'
const CLIENT_NAME_EDITED = 'Cliente Teste Fluxo UI Editado'
const CLIENT_DOC = '11144477735' // CPF valido (digitos verificadores conferidos)
const CLIENT_DOC_FORMATTED = '111.444.777-35'
const ISSUER_DOC = '52998224725' // CPF valido reutilizado como emitente
const BENEFICIARY_DOC = '11222333000181' // CNPJ valido reutilizado como beneficiario
const CLIENT_LIMIT = '5000.00'

/* ------------------------------------------------------------------ helpers */

let failures = 0
const results = []

function check(label, ok, detail = '') {
  results.push({ label, ok, detail })
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -> ${detail}` : ''}`)
}

const goto = (cdp, route, options) => gotoRoute(cdp, BASE, route, options)

async function screenshot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`SHOT  ${name}`)
}

async function api(token, method, route, body) {
  const options = { method, headers: { Authorization: `Bearer ${token}` } }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(`${BASE}/api${route}`, options)
  let data = null
  try {
    data = await response.json()
  } catch {
    /* resposta sem corpo JSON */
  }
  return { status: response.status, data }
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
  return response.json()
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return
    } catch {
      /* servidor ainda reiniciando */
    }
    await sleep(250)
  }
  throw new Error(`Servidor nao respondeu em ${BASE} apos ${timeoutMs}ms.`)
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

/** Garante o estado de primeiro acesso para o roteiro de login do teste. */
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
  // O Flask em modo debug recarrega o processo ao trocar o banco via CLI.
  // Aguarda o servidor estabilizar antes de autenticar novamente.
  await waitForServer()
  return await apiLogin()
}

/** Remove eventuais sobras de execucoes anteriores que foram interrompidas. */
async function cleanup(token) {
  let removed = 0
  for (const base of ['/cheques', '/boletos']) {
    const list = await api(token, 'GET', `${base}?search=${encodeURIComponent(MARKER)}&per_page=100`)
    for (const item of list.data?.items || []) {
      const res = await api(token, 'DELETE', `${base}/${item.id}`)
      if (res.status === 200) removed += 1
    }
  }
  const clients = await api(
    token,
    'GET',
    `/clients?search=${encodeURIComponent(CLIENT_NAME)}&per_page=100`,
  )
  for (const item of clients.data?.items || []) {
    const res = await api(token, 'DELETE', `/clients/${item.id}`)
    if (res.status === 200) removed += 1
  }
  if (removed) console.log(`Limpeza inicial: ${removed} registro(s) de teste removido(s).`)
}

async function auditActions(token, entity, search) {
  const response = await api(
    token,
    'GET',
    `/users/audit-logs?entity=${entity}&search=${encodeURIComponent(search)}&per_page=100`,
  )
  return (response.data?.items || []).map((entry) => entry.action)
}

/* --------------------------------------------------------------------- main */

async function main() {
  await fs.rm(PROFILE, { recursive: true, force: true })
  await fs.mkdir(OUT, { recursive: true })

  console.log(`Base: ${BASE}`)
  const apiSession = await ensureAdmin()
  const token = apiSession.access_token
  await cleanup(token)

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
        const text = params.entry.text || ''
        // Erros esperados: refresh sem cookie (401) e as validacoes negativas
        // que o proprio roteiro provoca de proposito (422 em /api/clients).
        const expected =
          (url.includes('/api/auth/refresh') && /401/.test(text)) ||
          (/\/api\/clients(\/\d+)?$/.test(url) && /422/.test(text))
        if (!expected) consoleErrors.push(`LOG: ${text} ${url}`)
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

    /* --------------------------------------------------------------- login */
    await goto(cdp, '/login', {
      authenticated: false,
      ready: '!!document.querySelector("#field-email")',
    })
    await evaluate(cdp, `__setValue("#field-email", "${ADMIN_EMAIL}")`)
    await evaluate(cdp, `__setValue("#field-password", "${ADMIN_PASSWORD}")`)
    await evaluate(cdp, '__click(\'button[type="submit"]\')')
    await waitFor(cdp, "location.pathname === '/trocar-senha'", 'troca de senha obrigatoria', 20000)
    await waitFor(cdp, '!!document.querySelector("#field-current_password")', 'form de troca de senha')
    await evaluate(cdp, `__setValue("#field-current_password", "${ADMIN_PASSWORD}")`)
    await evaluate(cdp, `__setValue("#field-new_password", "${NEW_PASSWORD}")`)
    await evaluate(cdp, `__setValue("#field-confirm_password", "${NEW_PASSWORD}")`)
    await evaluate(cdp, '__click(\'button[type="submit"]\')')
    await waitFor(cdp, "location.pathname === '/dashboard'", 'entrada no dashboard', 20000)
    check('login e troca de senha concluidos', true)

    /* -------------------------------------------------- 1. cadastrar cliente */
    await goto(cdp, '/clientes/novo', { ready: '!!document.querySelector("#client-form")' })
    await evaluate(cdp, `__setValue("#field-name", "${CLIENT_NAME}")`)
    await evaluate(cdp, `__setByLabel("CPF / CNPJ", "${CLIENT_DOC}")`)
    await evaluate(cdp, `__setValue("#field-email", "fluxo.ui@exemplo.com.br")`)
    await evaluate(cdp, '__setByLabel("Telefone", "11987654321")')
    await evaluate(cdp, `__setByLabel("Limite operacional", "${CLIENT_LIMIT}")`)
    const clientDocValue = await evaluate(cdp, '__labelValue("CPF / CNPJ")')
    check('documento do cliente formatado no campo', clientDocValue === CLIENT_DOC_FORMATTED, clientDocValue)
    await evaluate(cdp, '__click(\'button[form="client-form"]\')')
    await waitFor(cdp, '/^\\/clientes\\/\\d+$/.test(location.pathname)', 'cliente criado', 20000)
    await waitFor(cdp, '!!document.querySelector(".detail-main")', 'detalhe do cliente')
    await sleep(400)
    const clientId = Number((await evaluate(cdp, 'location.pathname')).split('/').pop())
    const clientResponse = await api(token, 'GET', `/clients/${clientId}`)
    const clientCode = clientResponse.data?.item?.code
    check('cliente criado com codigo automatico', /^CLI-\d{4}$/.test(clientCode || ''), clientCode)
    check(
      'cliente salvo com os dados informados',
      clientResponse.data?.item?.document === CLIENT_DOC &&
        Number(clientResponse.data?.item?.operational_limit) === Number(CLIENT_LIMIT) &&
        clientResponse.data?.item?.status === 'ATIVO',
      JSON.stringify({
        document: clientResponse.data?.item?.document,
        limit: clientResponse.data?.item?.operational_limit,
      }),
    )
    await screenshot(cdp, '30-fluxo-cliente-criado')

    /* ------------------------------------ 2. CPF/CNPJ duplicado (bloqueado) */
    const duplicateApi = await api(token, 'POST', '/clients', {
      name: 'Cliente Duplicado',
      document: CLIENT_DOC,
    })
    check('API bloqueia CPF/CNPJ duplicado (422)', duplicateApi.status === 422, `status ${duplicateApi.status}`)
    check(
      'mensagem de duplicidade aponta o cliente existente',
      /Já existe um cliente com este CPF\/CNPJ/.test(duplicateApi.data?.errors?.document || ''),
      duplicateApi.data?.errors?.document,
    )

    await goto(cdp, '/clientes/novo', { ready: '!!document.querySelector("#client-form")' })
    await evaluate(cdp, '__setValue("#field-name", "Cliente Duplicado UI")')
    await evaluate(cdp, `__setByLabel("CPF / CNPJ", "${CLIENT_DOC}")`)
    await evaluate(cdp, '__click(\'button[form="client-form"]\')')
    await waitFor(
      cdp,
      '/Já existe um cliente com este CPF\\/CNPJ/.test(document.body.innerText)',
      'erro de duplicidade na tela',
      20000,
    )
    check('interface exibe o erro de CPF/CNPJ duplicado', true)
    const duplicateList = await api(token, 'GET', `/clients?search=${CLIENT_DOC}&per_page=100`)
    check(
      'nenhum cliente duplicado foi persistido',
      (duplicateList.data?.items || []).length === 1,
      `${(duplicateList.data?.items || []).length} registro(s)`,
    )
    await screenshot(cdp, '31-fluxo-cliente-duplicado')

    /* --------------------------------------------------- 3. editar cliente */
    await goto(cdp, `/clientes/${clientId}/editar`, {
      ready: '!!document.querySelector("#client-form")',
    })
    await waitFor(cdp, `document.querySelector("#field-name").value === "${CLIENT_NAME}"`, 'form preenchido')
    await evaluate(cdp, `__setValue("#field-name", "${CLIENT_NAME_EDITED}")`)
    await evaluate(cdp, '__setByLabel("Telefone", "1133224455")')
    await evaluate(cdp, '__click(\'button[form="client-form"]\')')
    await waitFor(cdp, '/^\\/clientes\\/\\d+$/.test(location.pathname)', 'cliente atualizado', 20000)
    await waitFor(
      cdp,
      `document.body.innerText.includes("${CLIENT_NAME_EDITED}")`,
      'nome atualizado na tela',
    )
    const editedClient = await api(token, 'GET', `/clients/${clientId}`)
    check(
      'cliente editado persistiu o novo nome',
      editedClient.data?.item?.name === CLIENT_NAME_EDITED,
      editedClient.data?.item?.name,
    )
    check(
      'telefone do cliente atualizado',
      editedClient.data?.item?.phone === '1133224455',
      editedClient.data?.item?.phone,
    )

    /* ------------------------------- 4. cadastrar cheque com divergencia */
    await goto(cdp, '/cheques/novo', { ready: '!!document.querySelector("#cheque-form")' })
    await evaluate(cdp, '__click("#client-select-input")')
    await evaluate(cdp, `__setValue("#client-select-input", "${CLIENT_NAME_EDITED}")`)
    await waitFor(cdp, 'document.querySelectorAll(\'[role="option"]\').length > 0', 'opcoes de cliente')
    await evaluate(cdp, '__click(\'[role="option"]\')')
    await waitFor(cdp, '!!document.querySelector(".client-selected-meta")', 'cliente selecionado')
    await evaluate(cdp, '__setValue("#field-number", "990011")')
    await evaluate(cdp, '__setValue("#field-bank", "Banco do Brasil")')
    await evaluate(cdp, `__setValue("#field-identifier", "${MARKER}")`)
    await evaluate(cdp, `__setByLabel("CPF / CNPJ do emitente", "${ISSUER_DOC}")`)
    await evaluate(cdp, '__setValue("#field-issuer_name", "Emitente Teste Fluxo")')
    await evaluate(cdp, '__setByLabel("Valor nominal", "1000.00")')
    await evaluate(cdp, '__setByLabel("Valor líquido pago ao cliente", "950.00")')
    await evaluate(cdp, '__setByLabel("Desconto", "100.00")')
    await evaluate(cdp, '__setValue("#field-issue_date", "2026-01-10")')
    await evaluate(cdp, '__setValue("#field-due_date", "2026-02-10")')
    await sleep(300)
    await evaluate(cdp, '__click(\'button[form="cheque-form"]\')')
    await waitFor(cdp, '/^\\/cheques\\/\\d+$/.test(location.pathname)', 'cheque criado', 20000)
    await waitFor(cdp, '!!document.querySelector(".detail-main")', 'detalhe do cheque')
    await sleep(400)
    const chequeId = Number((await evaluate(cdp, 'location.pathname')).split('/').pop())
    const cheque = (await api(token, 'GET', `/cheques/${chequeId}`)).data?.item
    check('cheque criado com codigo automatico', /^CHQ-\d{5}$/.test(cheque?.code || ''), cheque?.code)
    check(
      'cheque gravou exatamente os valores informados',
      Number(cheque?.nominal_amount) === 1000 &&
        Number(cheque?.net_amount) === 950 &&
        Number(cheque?.discount_amount) === 100 &&
        Number(cheque?.interest_amount) === 0,
      JSON.stringify({
        nominal: cheque?.nominal_amount,
        net: cheque?.net_amount,
        discount: cheque?.discount_amount,
      }),
    )
    check(
      'divergencia calculada apenas como alerta',
      cheque?.has_divergence === true && Math.abs(Number(cheque?.divergence_amount)) === 50,
      `divergencia ${cheque?.divergence_amount}`,
    )
    const chequeToasts = await evaluate(cdp, '__toasts()')
    check(
      'interface alertou a divergencia do cheque',
      chequeToasts.some((toast) => /Divergência/.test(toast.text)),
      JSON.stringify(chequeToasts),
    )
    check(
      'detalhe do cheque destaca a divergencia',
      /Divergência entre os valores informados/.test(await evaluate(cdp, 'document.body.innerText')),
    )
    await screenshot(cdp, '32-fluxo-cheque-divergencia')

    /* ------------------------------------------- 5. cadastrar boleto coerente */
    await goto(cdp, '/boletos/novo', { ready: '!!document.querySelector("#boleto-form")' })
    await evaluate(cdp, '__click("#client-select-input")')
    await evaluate(cdp, `__setValue("#client-select-input", "${CLIENT_NAME_EDITED}")`)
    await waitFor(cdp, 'document.querySelectorAll(\'[role="option"]\').length > 0', 'opcoes de cliente')
    await evaluate(cdp, '__click(\'[role="option"]\')')
    await waitFor(cdp, '!!document.querySelector(".client-selected-meta")', 'cliente selecionado')
    await evaluate(cdp, `__setValue("#field-identifier", "${MARKER}")`)
    await evaluate(cdp, '__setValue("#field-bank", "Itaú")')
    await evaluate(cdp, `__setByLabel("CPF / CNPJ do beneficiário", "${BENEFICIARY_DOC}")`)
    await evaluate(cdp, '__setValue("#field-beneficiary_name", "Beneficiario Teste Fluxo")')
    await evaluate(cdp, '__setByLabel("Valor original", "2000.00")')
    await evaluate(cdp, '__setByLabel("Valor líquido pago ao cliente", "1800.00")')
    await evaluate(cdp, '__setByLabel("Juros / desconto", "200.00")')
    await evaluate(cdp, '__setValue("#field-issue_date", "2026-01-15")')
    await evaluate(cdp, '__setValue("#field-due_date", "2026-03-15")')
    await sleep(300)
    await evaluate(cdp, '__click(\'button[form="boleto-form"]\')')
    await waitFor(cdp, '/^\\/boletos\\/\\d+$/.test(location.pathname)', 'boleto criado', 20000)
    await waitFor(cdp, '!!document.querySelector(".detail-main")', 'detalhe do boleto')
    await sleep(400)
    const boletoId = Number((await evaluate(cdp, 'location.pathname')).split('/').pop())
    const boleto = (await api(token, 'GET', `/boletos/${boletoId}`)).data?.item
    check('boleto criado com codigo automatico', /^BOL-\d{5}$/.test(boleto?.code || ''), boleto?.code)
    check(
      'boleto gravou os valores e sem divergencia',
      Number(boleto?.original_amount) === 2000 &&
        Number(boleto?.net_amount) === 1800 &&
        Number(boleto?.discount_amount) === 200 &&
        boleto?.has_divergence === false,
      JSON.stringify({ original: boleto?.original_amount, net: boleto?.net_amount }),
    )
    await screenshot(cdp, '33-fluxo-boleto-criado')

    /* ------------------------- 6. exclusao do cliente bloqueada por documentos */
    await goto(cdp, `/clientes/${clientId}`, { ready: '!!document.querySelector(".detail-main")' })
    await evaluate(cdp, '__click("[data-testid=client-delete-button]")')
    await waitFor(cdp, '!!document.querySelector(".fp-modal-foot")', 'confirmacao de exclusao')
    await evaluate(cdp, '__click(".fp-modal-foot .btn-danger")')
    await waitFor(cdp, '!!document.querySelector(".fp-toast-danger")', 'toast de bloqueio', 20000)
    await sleep(300)
    const blockToast = await evaluate(cdp, '__toasts()')
    check(
      'exclusao do cliente bloqueada por documentos em aberto',
      blockToast.some((toast) => /documento\(s\) em aberto/.test(toast.text)),
      JSON.stringify(blockToast),
    )
    const stillThere = await api(token, 'GET', `/clients/${clientId}`)
    check('cliente permanece ativo apos tentativa bloqueada', stillThere.status === 200)
    await screenshot(cdp, '34-fluxo-cliente-bloqueado')

    /* ----------------------------------- 7. alterar status do cheque via tela */
    await goto(cdp, `/cheques/${chequeId}`, { ready: '!!document.querySelector(".detail-main")' })
    await evaluate(cdp, '__setSelect(\'[aria-label="Novo status"]\', "LIQUIDADO")')
    await sleep(250)
    await evaluate(cdp, '__clickByText("button", "Aplicar status")')
    await waitFor(
      cdp,
      '__toasts().some((toast) => /Status atualizado/.test(toast.text))',
      'confirmacao de status',
      20000,
    )
    await sleep(300)
    const statusCheque = (await api(token, 'GET', `/cheques/${chequeId}`)).data?.item
    check(
      'status do cheque alterado para LIQUIDADO',
      statusCheque?.status === 'LIQUIDADO',
      statusCheque?.status,
    )
    await screenshot(cdp, '35-fluxo-status-liquidado')

    /* ------------------------------------------- 8. excluir documentos (UI) */
    await goto(cdp, `/boletos/${boletoId}`, { ready: '!!document.querySelector(".detail-main")' })
    await evaluate(cdp, '__click("button.btn-outline-danger")')
    await waitFor(cdp, '!!document.querySelector(".fp-modal-foot")', 'confirmacao de exclusao do boleto')
    await evaluate(cdp, '__click(".fp-modal-foot .btn-danger")')
    await waitFor(cdp, "location.pathname === '/boletos'", 'boleto excluido', 20000)
    check(
      'boleto excluido logicamente (nao encontrado na API)',
      (await api(token, 'GET', `/boletos/${boletoId}`)).status === 404,
    )

    await goto(cdp, `/cheques/${chequeId}`, { ready: '!!document.querySelector(".detail-main")' })
    await evaluate(cdp, '__click("button.btn-outline-danger")')
    await waitFor(cdp, '!!document.querySelector(".fp-modal-foot")', 'confirmacao de exclusao do cheque')
    await evaluate(cdp, '__click(".fp-modal-foot .btn-danger")')
    await waitFor(cdp, "location.pathname === '/cheques'", 'cheque excluido', 20000)
    check(
      'cheque excluido logicamente (nao encontrado na API)',
      (await api(token, 'GET', `/cheques/${chequeId}`)).status === 404,
    )

    /* --------------------------- 9. excluir cliente agora sem documentos abertos */
    await goto(cdp, `/clientes/${clientId}`, { ready: '!!document.querySelector(".detail-main")' })
    await evaluate(cdp, '__click("button.btn-outline-danger")')
    await waitFor(cdp, '!!document.querySelector(".fp-modal-foot")', 'confirmacao de exclusao do cliente')
    await evaluate(cdp, '__click(".fp-modal-foot .btn-danger")')
    await waitFor(cdp, "location.pathname === '/clientes'", 'cliente excluido', 20000)
    check(
      'cliente excluido logicamente apos remover os documentos',
      (await api(token, 'GET', `/clients/${clientId}`)).status === 404,
    )

    /* ------------------------------------------------------- 10. auditoria */
    const clientActions = await auditActions(token, 'client', clientCode)
    check(
      'auditoria registrou criacao, edicao e exclusao do cliente',
      ['CREATE', 'UPDATE', 'DELETE'].every((action) => clientActions.includes(action)),
      clientActions.join(','),
    )
    const chequeActions = await auditActions(token, 'cheque', cheque.code)
    check(
      'auditoria registrou criacao, status e exclusao do cheque',
      ['CREATE', 'STATUS_CHANGE', 'DELETE'].every((action) => chequeActions.includes(action)),
      chequeActions.join(','),
    )
    const boletoActions = await auditActions(token, 'boleto', boleto.code)
    check(
      'auditoria registrou criacao e exclusao do boleto',
      ['CREATE', 'DELETE'].every((action) => boletoActions.includes(action)),
      boletoActions.join(','),
    )

    /* ---------------------------------------------------- 11. relatorios */
    await goto(cdp, '/relatorios', {
      ready: 'document.querySelectorAll(".fp-tabs .fp-tab").length >= 5',
    })
    const reportSummary = await fetch(`${BASE}/api/reports/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((response) => response.json())
    check(
      'relatorio consolidado retorna dados reais',
      Array.isArray(reportSummary.documents) &&
        Array.isArray(reportSummary.clients) &&
        Boolean(reportSummary.cards),
      `${reportSummary.documents?.length ?? 0} titulo(s)`,
    )
    const pdfExport = await fetch(`${BASE}/api/reports/export/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const xlsxExport = await fetch(`${BASE}/api/reports/export/xlsx`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    check(
      'exportacao PDF responde com arquivo',
      pdfExport.status === 200 && /pdf/i.test(pdfExport.headers.get('content-type') || ''),
      `status ${pdfExport.status}`,
    )
    check(
      'exportacao de planilha responde com arquivo',
      xlsxExport.status === 200 && /sheet|excel|officedocument/i.test(xlsxExport.headers.get('content-type') || ''),
      `status ${xlsxExport.status}`,
    )
    const reportActions = await auditActions(token, 'report', '')
    check(
      'exportacoes ficaram registradas na auditoria',
      reportActions.filter((action) => action === 'EXPORT').length >= 2,
      reportActions.join(','),
    )
    await screenshot(cdp, '36-fluxo-relatorios')
    await evaluate(cdp, 'document.querySelectorAll(\'[role="tab"]\')[1].click()')
    await waitFor(
      cdp,
      '!!document.querySelector(".report-table") || !!document.querySelector(".empty-state")',
      'aba de clientes do relatorio',
      20000,
    )
    await sleep(400)
    check(
      'aba de clientes do relatorio renderiza',
      /uso do limite|sem limite definido/i.test(await evaluate(cdp, 'document.querySelector(".tab-body").innerText')),
    )
    await screenshot(cdp, '37-fluxo-relatorio-clientes')

    /* ------------------------------------- 12. filtros salvos (Etapa 5) */
    const savedFilterName = `${MARKER} vencidos`
    const createdFilter = await api(token, 'POST', '/reports/filters', {
      name: savedFilterName,
      filters: { status: 'EM_ABERTO', overdue: true, search: MARKER },
    })
    check(
      'filtro de relatorio salvo na conta',
      createdFilter.status === 201 && createdFilter.data?.item?.filters?.overdue === true,
      `status ${createdFilter.status}`,
    )
    await goto(cdp, '/relatorios')
    await waitFor(
      cdp,
      `document.body.innerText.includes("${savedFilterName}")`,
      'filtro salvo carregado na tela',
      20000,
    )
    check(
      'interface lista o filtro salvo',
      await evaluate(
        cdp,
        `document.querySelector(".report-saved-list")?.innerText.includes("${savedFilterName}") === true`,
      ),
      'chip na tela de relatorios',
    )
    await evaluate(
      cdp,
      `[...document.querySelectorAll(".report-saved-apply")].find((el) => el.innerText.includes("${savedFilterName}"))?.click()`,
    )
    await sleep(600)
    check(
      'aplicar filtro salvo restaura os criterios',
      (await evaluate(
        cdp,
        'document.querySelector(\'input[aria-label="Buscar no relatório"]\')?.value',
      )) === MARKER,
      'busca restaurada',
    )
    await screenshot(cdp, '38-fluxo-filtro-salvo')

    const removedFilter = await api(
      token,
      'DELETE',
      `/reports/filters/${createdFilter.data.item.id}`,
    )
    const remainingFilters = await api(token, 'GET', '/reports/filters')
    check(
      'filtro salvo pode ser removido',
      removedFilter.status === 200 &&
        !(remainingFilters.data?.items || []).some((item) => item.name === savedFilterName),
      `status ${removedFilter.status}`,
    )

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
  console.error('\nTESTE DE FLUXOS FALHOU:', error.message)
  process.exitCode = 1
})
