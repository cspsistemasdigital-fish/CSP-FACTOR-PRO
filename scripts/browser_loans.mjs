/**
 * FACTOR PRO - verificacao funcional do modulo de emprestimos (Chrome headless/CDP).
 *
 * Cobre as telas e as regras do modulo pela interface e pela API:
 *   - lista, formulario (cliente, limites, parcelas editaveis) e detalhe;
 *   - duplicata para impressao (sem gravar registro novo);
 *   - relatorio comCards, abas, filtros, WhatsApp, e-mail, PDF e XLSX;
 *   - exposicao do cliente e exclusao logica.
 *
 * O teste cria o proprio emprestimo com marcador e remove tudo ao final,
 * podendo ser reexecutado. Exige backend servindo o SPA em :5000.
 *
 * Uso: node scripts/browser_loans.mjs
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
const DEBUG_PORT = Number(process.env.SMOKE_CDP_PORT || 9500 + Math.floor(Math.random() * 400))
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = process.env.SMOKE_OUTPUT_DIR || path.join(HERE, 'screenshots')
const PROFILE = path.join(os.tmpdir(), `factorpro-loans-${process.pid}`)

const ADMIN_EMAIL = 'admin@factorpro.com.br'
const ADMIN_PASSWORD = 'Admin@12345'
const NEW_PASSWORD = 'FpLoans@2026'
const MARKER = 'EMPRESTIMO-UI-TESTE'
const NOTES = `${MARKER} - verificacao funcional da interface`
const QUICK_CLIENT_NAME = `${MARKER} Cliente rapido`
const QUICK_CLIENT_DOCUMENT = '111.444.777-35'

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
    /* resposta binaria ou sem corpo */
  }
  return { status: response.status, data }
}

async function apiLogin() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  if (!response.ok) throw new Error(`Login de API falhou (${response.status}).`)
  return response.json()
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

async function ensureAdmin() {
  let session = null
  try {
    session = await apiLogin()
  } catch (error) {
    console.log(`Login inicial falhou (${error.message}).`)
  }
  if (session?.user?.must_change_password) return session
  console.log('Restaurando o estado de primeiro acesso do administrador via CLI do Flask...')
  resetAdminCli()
  return await apiLogin()
}

async function cleanup(token) {
  const list = await api(token, 'GET', `/loans?search=${encodeURIComponent(MARKER)}&per_page=100`)
  let removed = 0
  for (const item of list.data?.items || []) {
    const response = await api(token, 'DELETE', `/loans/${item.id}`)
    if (response.status === 200) removed += 1
  }
  if (removed) console.log(`Limpeza inicial: ${removed} emprestimo(s) de teste removido(s).`)

  const clients = await api(token, 'GET', `/clients?search=${encodeURIComponent(QUICK_CLIENT_NAME)}&per_page=100`)
  for (const item of clients.data?.items || []) {
    if (item.name === QUICK_CLIENT_NAME) await api(token, 'DELETE', `/clients/${item.id}`)
  }
}

const caretsAudit = `(() => {
  const selects = [...document.querySelectorAll('select.form-select')];
  return {
    total: selects.length,
    bad: selects.filter((el) => {
      const style = getComputedStyle(el);
      const images = (style.backgroundImage.match(/url\\(/g) || []).length;
      return style.appearance !== 'none' || images !== 1;
    }).map((el) => el.outerHTML.slice(0, 90)),
  };
})()`

/* --------------------------------------------------------------------- main */

async function main() {
  await fs.rm(PROFILE, { recursive: true, force: true })
  await fs.mkdir(OUT, { recursive: true })

  console.log(`Base: ${BASE}`)
  const apiSession = await ensureAdmin()
  const token = apiSession.access_token
  await cleanup(token)

  let session
  try {
    session = await launchChrome({
      chromePath: CHROME,
      port: DEBUG_PORT,
      profileDir: PROFILE,
      width: 1440,
      height: 960,
    })
    const cdp = session.cdp

    const consoleErrors = []
    const failedRequests = []
    const requestUrls = new Map()
    cdp.on((message) => {
      const { method, params } = message
      if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        consoleErrors.push(params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '))
      }
      if (method === 'Runtime.exceptionThrown') {
        consoleErrors.push(
          `EXCEPTION: ${params.exceptionDetails.exception?.description || params.exceptionDetails.text}`,
        )
      }
      if (method === 'Log.entryAdded' && params.entry.level === 'error') {
        const url = params.entry.url || ''
        const text = params.entry.text || ''
        const expected = url.includes('/api/auth/refresh') && /401/.test(text)
        if (!expected) consoleErrors.push(`LOG: ${text} ${url}`)
      }
      if (method === 'Network.requestWillBeSent') requestUrls.set(params.requestId, params.request.url)
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
    await waitFor(cdp, "location.pathname === '/trocar-senha'", 'troca de senha', 20000)
    await waitFor(cdp, '!!document.querySelector("#field-current_password")', 'form de troca de senha')
    await evaluate(cdp, `__setValue("#field-current_password", "${ADMIN_PASSWORD}")`)
    await evaluate(cdp, `__setValue("#field-new_password", "${NEW_PASSWORD}")`)
    await evaluate(cdp, `__setValue("#field-confirm_password", "${NEW_PASSWORD}")`)
    await evaluate(cdp, '__click(\'button[type="submit"]\')')
    await waitFor(cdp, "location.pathname === '/dashboard'", 'entrada no dashboard', 20000)
    check('login e troca de senha concluidos', true)

    /* ------------------------------------------------ 1. lista e formulario */
    await goto(cdp, '/emprestimos', { ready: '!!document.querySelector(".stats-strip")' })
    const listText = await evaluate(cdp, 'document.body.innerText')
    check('lista de emprestimos renderiza', /emprest/i.test(listText))

    await goto(cdp, '/emprestimos/novo', { ready: '!!document.querySelector("#loan-form")' })
    const profitInputType = await evaluate(cdp, 'document.querySelector(".loan-profit-field input")?.type')
    check('lucro inicia oculto no formulario', profitInputType === 'password', profitInputType)
    await evaluate(cdp, '__click(".loan-profit-toggle")')
    check(
      'botao de lucro permite revelar o valor',
      (await evaluate(cdp, 'document.querySelector(".loan-profit-field input")?.type')) === 'text',
    )
    await evaluate(cdp, '__click(".loan-profit-toggle")')
    check(
      'botao de lucro permite ocultar novamente',
      (await evaluate(cdp, 'document.querySelector(".loan-profit-field input")?.type')) === 'password',
    )
    check(
      'formulario oferece cadastro de cliente e geracao de promissoria',
      /Cadastrar cliente/.test(await evaluate(cdp, 'document.body.innerText')) &&
        /Gerar promissória/.test(await evaluate(cdp, 'document.body.innerText')),
    )
    const carets = await evaluate(cdp, caretsAudit)
    check(
      'selects exibem uma unica seta',
      carets.total > 0 && carets.bad.length === 0,
      `${carets.total} select(s) - ${JSON.stringify(carets.bad.slice(0, 2))}`,
    )

    await evaluate(cdp, '__setByLabel("Valor do empréstimo", "3000.00")')
    await evaluate(cdp, '__setByLabel("Valor recebido pelo cliente", "2700.00")')
    await evaluate(cdp, '__click(".loan-profit-toggle")')
    const calculatedProfit = await evaluate(
      cdp,
      '({ value: document.querySelector(".loan-profit-field input").value, readOnly: document.querySelector(".loan-profit-field input").readOnly })',
    )
    check(
      'lucro e calculado ao revelar e fica somente leitura no novo emprestimo',
      calculatedProfit.value.replace(/\D/g, '') === '30000' && calculatedProfit.readOnly,
      JSON.stringify(calculatedProfit),
    )
    await evaluate(cdp, `__setByLabel("Observações", "${NOTES}")`)
    await evaluate(cdp, '__setValue(\'.loan-installment-config input[type="number"]\', "3")')
    await waitFor(
      cdp,
      'document.querySelectorAll(".loan-installments-table tbody tr").length === 3',
      'parcelas geradas',
    )
    const parcelRows = await evaluate(
      cdp,
      'document.querySelectorAll(".loan-installments-table tbody tr").length',
    )
    check('parcelas geradas a partir da quantidade informada', parcelRows === 3, `${parcelRows} parcelas`)

    await evaluate(
      cdp,
      '[...document.querySelectorAll("button")].find((button) => button.textContent.includes("Cadastrar cliente"))?.click()',
    )
    await waitFor(cdp, "location.pathname === '/clientes/novo'", 'cadastro rapido de cliente')
    await waitFor(cdp, '!!document.querySelector("#client-form")', 'formulario de novo cliente')
    check(
      'cadastro rapido oferece retorno ao emprestimo',
      /Voltar para o empréstimo/.test(await evaluate(cdp, 'document.body.innerText')),
    )
    await evaluate(cdp, `__setValue("#field-name", "${QUICK_CLIENT_NAME}")`)
    await evaluate(cdp, `__setByLabel("CPF / CNPJ", "${QUICK_CLIENT_DOCUMENT}")`)
    await evaluate(cdp, '__setByLabel("Limite operacional", "5000.00")')
    await evaluate(cdp, '__setByLabel("WhatsApp", "11988881001")')
    await evaluate(cdp, '__click(\'button[form="client-form"]\')')
    await waitFor(cdp, "location.pathname === '/emprestimos/novo'", 'retorno apos cadastrar cliente')
    await waitFor(
      cdp,
      `document.querySelector("#client-select-input")?.value === "${QUICK_CLIENT_NAME}"`,
      'novo cliente selecionado no emprestimo',
    )
    await waitFor(cdp, '!!document.querySelector(".loan-limit-box")', 'limite do novo cliente')
    check(
      'cadastro rapido retorna ao emprestimo com valores preservados',
      (await evaluate(cdp, 'document.querySelector(".loan-profit-field input")?.value'))?.includes('300') &&
        (await evaluate(cdp, 'document.querySelectorAll(".loan-installments-table tbody tr").length')) === 3,
    )

    await evaluate(
      cdp,
      '[...document.querySelectorAll("button")].find((button) => button.textContent.includes("Gerar promissória"))?.click()',
    )
    await waitFor(cdp, "location.pathname === '/emprestimos/promissoria'", 'minuta da promissoria')
    await waitFor(cdp, '!!document.querySelector(".promissory-sheet")', 'minuta carregada')
    const promissoryText = (await evaluate(cdp, 'document.body.innerText')).replace(/\s+/g, ' ')
    const promissoryValid =
      /NOTA PROMISSÓRIA/.test(promissoryText) &&
      !/DOCUMENTO PARA CONFERÊNCIA|MINUTA|Este arquivo é uma minuta/i.test(promissoryText) &&
      promissoryText.includes('Valor do empréstimo') &&
      promissoryText.includes('Quantidade de parcelas') &&
      promissoryText.includes('Data do empréstimo') &&
      promissoryText.includes('R$ 3.000,00') &&
      promissoryText.includes('3')
    check('nota promissoria exibe titulo e dados sem textos extras', promissoryValid)
    const metricColumns = await evaluate(
      cdp,
      'getComputedStyle(document.querySelector(".promissory-values")).gridTemplateColumns.split(" ").length',
    )
    check('valor, parcelas e data ocupam a mesma linha', metricColumns === 3, `${metricColumns} colunas`)
    const printable = await cdp.send('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
    })
    const printedPages = (
      Buffer.from(printable.data, 'base64').toString('latin1').match(/\/Type\s*\/Page\b/g) || []
    ).length
    check('nota promissoria imprime em uma pagina', printedPages === 1, `${printedPages} pagina(s)`)
    await cdp.send('Emulation.setEmulatedMedia', { media: 'print' })
    await screenshot(cdp, '44-nota-promissoria-print')
    await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' })
    await evaluate(
      cdp,
      '[...document.querySelectorAll("button")].find((button) => button.textContent.includes("Voltar ao formulário"))?.click()',
    )
    await waitFor(cdp, "location.pathname === '/emprestimos/novo'", 'retorno ao formulario do emprestimo')
    await waitFor(cdp, '!!document.querySelector("#loan-form")', 'formulario preservado')
    await waitFor(
      cdp,
      `document.querySelector("#client-select-input")?.value.includes("${QUICK_CLIENT_NAME}") && document.querySelector(".loan-profit-field input")?.value.includes("300")`,
      'dados do formulario restaurados',
    )
    check(
      'voltar da minuta preserva cliente e valores informados',
      Boolean(await evaluate(cdp, 'document.querySelector("#client-select-input")?.value')) &&
        (await evaluate(cdp, 'document.querySelector(".loan-profit-field input")?.value'))?.includes('300'),
    )
    await screenshot(cdp, '40-fluxo-emprestimo-formulario')

    await evaluate(cdp, '__click(\'button[form="loan-form"]\')')
    await waitFor(cdp, '/^\\/emprestimos\\/\\d+$/.test(location.pathname)', 'emprestimo criado', 20000)
    await waitFor(cdp, '!!document.querySelector(".detail-main")', 'detalhe do emprestimo')
    const loanId = Number((await evaluate(cdp, 'location.pathname')).split('/').pop())
    const created = await api(token, 'GET', `/loans/${loanId}`)
    const loan = created.data?.item
    check('emprestimo gravou exatamente os valores informados',
      Number(loan?.loan_amount) === 3000 &&
        Number(loan?.received_amount) === 2700 &&
        Number(loan?.profit_amount) === 300,
      JSON.stringify({
        loan: loan?.loan_amount,
        received: loan?.received_amount,
        profit: loan?.profit_amount,
      }))
    check('codigo do emprestimo gerado automaticamente', /^EMP-\d+$/.test(loan?.code || ''), loan?.code)
    check('tres parcelas persistidas', (loan?.installments || []).length === 3,
      `${(loan?.installments || []).length} parcelas`)
    check('lucro salvo corresponde ao valor emprestado menos o recebido',
      Number(loan?.profit_amount) === 300 && Number(loan?.loan_amount) - Number(loan?.received_amount) === 300)
    await goto(cdp, '/emprestimos', { ready: '!!document.querySelector("#loans-saved-data")' })
    const loanListControl = 'button[aria-controls="loans-saved-data"]'
    const loanListInitiallyHidden = await evaluate(
      cdp,
      'document.querySelector(\'button[aria-controls="loans-saved-data"]\')?.getAttribute("aria-expanded") === "false" && document.querySelector("#loans-saved-data")?.hidden',
    )
    check('lista de emprestimos inicia com os registros ocultos', loanListInitiallyHidden)
    await evaluate(cdp, `__click('${loanListControl}')`)
    await waitFor(
      cdp,
      'document.querySelector(\'button[aria-controls="loans-saved-data"]\')?.getAttribute("aria-expanded") === "true" && !document.querySelector("#loans-saved-data")?.hidden',
      'exibir registros de emprestimos',
    )
    check('lista de emprestimos permite exibir os registros', true)
    await evaluate(cdp, `__click('${loanListControl}')`)
    await waitFor(
      cdp,
      'document.querySelector(\'button[aria-controls="loans-saved-data"]\')?.getAttribute("aria-expanded") === "false" && document.querySelector("#loans-saved-data")?.hidden',
      'ocultar registros de emprestimos',
    )
    check('lista de emprestimos permite ocultar os registros', true)
    await goto(cdp, `/emprestimos/${loanId}`, { ready: '!!document.querySelector(".detail-main")' })
    await screenshot(cdp, '41-fluxo-emprestimo-detalhe')

    /* --------------------------------------------- 2. exposicao e duplicata */
    const beforeExposure = Number(loan?.limit?.open_amount || 0)
    check('saldo em parcelas entra na exposicao do cliente', beforeExposure >= 3000,
      `exposicao ${beforeExposure}`)

    const firstInstallment = loan?.installments?.[0]
    const settled = await api(
      token,
      'PATCH',
      `/loans/${loanId}/installments/${firstInstallment.id}/status`,
      { status: 'LIQUIDADO' },
    )
    const afterSettled = await api(token, 'GET', `/loans/${loanId}`)
    check('baixa de parcela reduz a exposicao',
      settled.status === 200 &&
        Number(afterSettled.data?.item?.limit?.open_amount) < beforeExposure,
      `${beforeExposure} -> ${afterSettled.data?.item?.limit?.open_amount}`)
    await api(token, 'PATCH', `/loans/${loanId}/installments/${firstInstallment.id}/status`,
      { status: 'EM_ABERTO' })

    const duplicate = await api(token, 'GET', `/loans/${loanId}/duplicata`)
    check('duplicata devolve dados do cliente e da empresa sem gravar registro',
      duplicate.status === 200 &&
        !!duplicate.data?.company &&
        duplicate.data?.item?.client?.name === loan?.client?.name,
      duplicate.data?.item?.client?.name)
    // A duplicata e uma vista de impressao: nao tem topbar nem formulario.
    await cdp.send('Page.navigate', { url: `${BASE}/emprestimos/${loanId}/duplicata` })
    await waitFor(cdp, "document.readyState === 'complete'", 'load duplicata')
    await waitFor(cdp, '!!document.querySelector(".print-sheet")', 'duplicata renderizada')
    const printText = await evaluate(cdp, 'document.querySelector(".print-sheet").innerText')
    check('duplicata abre para impressao com dados preenchidos',
      /duplicata/i.test(printText) && printText.includes(loan?.client?.name || '@@@'),
      printText.slice(0, 60).replace(/\s+/g, ' '))
    await screenshot(cdp, '42-fluxo-emprestimo-duplicata')

    /* --------------------------------------------------------- 3. relatorio */
    await goto(cdp, '/emprestimos/relatorio', { ready: 'document.querySelectorAll(".stat-grid > *").length >= 6' })
    const tabCount = await evaluate(cdp, 'document.querySelectorAll(\'[role="tab"]\').length')
    check('relatorio de emprestimos exibe os cards e as abas', tabCount === 4, `${tabCount} abas`)

    const reportCarets = await evaluate(cdp, caretsAudit)
    check('selects do relatorio exibem uma unica seta',
      reportCarets.total > 0 && reportCarets.bad.length === 0,
      `${reportCarets.total} select(s) - ${JSON.stringify(reportCarets.bad.slice(0, 2))}`)

    await evaluate(cdp, `__setValue('input[placeholder="Buscar por cliente, código, CPF/CNPJ…"]', "${MARKER}")`)
    await evaluate(cdp, '__clickByText("button", "Aplicar")')
    await evaluate(cdp, '__clickByText(\'[role="tab"]\', "Empréstimos")')
    await waitFor(cdp, `document.body.innerText.includes("${loan.code}")`, 'emprestimo filtrado no relatorio', 20000)
    check('relatorio reflete o filtro aplicado', true)
    await screenshot(cdp, '43-fluxo-emprestimo-relatorio')

    const summary = await api(token, 'GET', `/loans/report/summary?search=${encodeURIComponent(MARKER)}`)
    check('resumo da API deriva dos lancamentos reais',
      Number(summary.data?.cards?.loans_count) === 1 &&
        Number(summary.data?.cards?.loan_amount_total) === 3000,
      JSON.stringify({
        count: summary.data?.cards?.loans_count,
        total: summary.data?.cards?.loan_amount_total,
      }))

    const pdf = await api(token, 'GET', `/loans/report/export/pdf?search=${encodeURIComponent(MARKER)}`)
    const xlsx = await api(token, 'GET', `/loans/report/export/xlsx?search=${encodeURIComponent(MARKER)}`)
    check('exportacoes PDF e XLSX respondem com arquivo', pdf.status === 200 && xlsx.status === 200,
      `pdf ${pdf.status} / xlsx ${xlsx.status}`)

    const whatsapp = await api(
      token,
      'GET',
      `/loans/report/whatsapp?client_id=${loan.client_id}&search=${encodeURIComponent(MARKER)}`,
    )
    check('WhatsApp gera texto editavel sem enviar automaticamente',
      whatsapp.status === 200 && !!whatsapp.data?.item?.message && !!whatsapp.data?.item?.url,
      whatsapp.data?.item?.url)

    const email = await api(
      token,
      'POST',
      `/loans/report/email?search=${encodeURIComponent(MARKER)}`,
      { to: 'relatorio@exemplo.com.br', message: `Texto revisado ${MARKER}` },
    )
    check('e-mail aceita filtros e texto editavel',
      email.status === 200 && (email.data?.preview || '').includes(MARKER),
      email.data?.message)

    /* ------------------------------------------------------- 4. exclusao */
    const deleted = await api(token, 'DELETE', `/loans/${loanId}`)
    const afterDelete = await api(token, 'GET', `/loans/${loanId}`)
    check('emprestimo removido por exclusao logica',
      deleted.status === 200 && afterDelete.status === 404,
      `delete ${deleted.status} / get ${afterDelete.status}`)
    const quickClientList = await api(
      token,
      'GET',
      `/clients?search=${encodeURIComponent(QUICK_CLIENT_NAME)}&per_page=100`,
    )
    const quickClient = quickClientList.data?.items?.find((item) => item.name === QUICK_CLIENT_NAME)
    const quickClientDeleted = quickClient
      ? await api(token, 'DELETE', `/clients/${quickClient.id}`)
      : { status: 404 }
    check('cliente temporario do fluxo removido', quickClientDeleted.status === 200)

    check('sem erros de console', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '))
    const relevantFailures = failedRequests.filter((entry) => !/favicon/i.test(entry))
    check('sem requisicoes falhas', relevantFailures.length === 0, relevantFailures.slice(0, 4).join(' | '))

    console.log('\nRestaurando senha provisoria do administrador...')
    resetAdminCli()
  } finally {
    await session?.close()
    await sleep(500)
    await fs.rm(PROFILE, { recursive: true, force: true }).catch(() => {})
  }

  console.log('\n================ RESUMO ================')
  const passed = results.filter((entry) => entry.ok).length
  console.log(`${passed}/${results.length} verificacoes OK`)
  if (failures) {
    console.log('Falhas:')
    for (const entry of results.filter((item) => !item.ok)) console.log(` - ${entry.label} ${entry.detail}`)
  }
  console.log(`Screenshots em ${OUT}`)
  process.exitCode = failures ? 1 : 0
}

main().catch((error) => {
  console.error('\nTESTE DE EMPRESTIMOS FALHOU:', error.message)
  process.exitCode = 1
})
