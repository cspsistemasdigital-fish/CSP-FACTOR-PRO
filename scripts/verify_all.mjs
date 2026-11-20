#!/usr/bin/env node
/**
 * FACTOR PRO — verificação completa (Etapa 6).
 *
 * Encadeia: testes do backend, build do frontend, smoke de interface, fluxos
 * funcionais e fluxo do módulo de empréstimos. O backend precisa estar no ar
 * em http://127.0.0.1:5000 para as etapas de navegador. Retorna código de saída
 * diferente de zero na primeira falha, para uso local ou em CI.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = path.join(ROOT, 'backend')
const FRONTEND = path.join(ROOT, 'frontend')
const WINDOWS = process.platform === 'win32'
const PYTHON = path.join(BACKEND, '.venv', 'Scripts', WINDOWS ? 'python.exe' : 'python')
const NPM = WINDOWS ? 'npm.cmd' : 'npm'
const BASE = process.env.VERIFY_BASE_URL || 'http://127.0.0.1:5000'

function run(label, command, args, cwd, shell = false) {
  console.log(`\n=== ${label} ===`)
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell })
  if (result.error) {
    console.error(`Falha ao iniciar "${label}": ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`\n${label} falhou (código ${result.status}).`)
    process.exit(result.status || 1)
  }
}

async function requireBackend() {
  try {
    const response = await fetch(`${BASE}/api/health`)
    if (!response.ok) throw new Error(`status ${response.status}`)
    const body = await response.json()
    console.log(`Backend OK: ${body.app} ${body.version} (${BASE})`)
  } catch (error) {
    console.error(
      `\nBackend indisponível em ${BASE} (${error.message}).\n` +
        'Inicie com: cd backend; .\\.venv\\Scripts\\flask.exe run --port 5000',
    )
    process.exit(1)
  }
}

console.log('FACTOR PRO — verificação completa')
run('Testes do backend', PYTHON, ['-m', 'pytest', '-q'], BACKEND)
run('Build do frontend', NPM, ['run', 'build'], FRONTEND, WINDOWS)
await requireBackend()
run('Smoke de interface e acessibilidade', process.execPath, ['scripts/browser_smoke.mjs'], ROOT)
run('Fluxos funcionais de ponta a ponta', process.execPath, ['scripts/browser_flows.mjs'], ROOT)
run('Fluxo de empréstimos', process.execPath, ['scripts/browser_loans.mjs'], ROOT)

console.log('\nVerificação completa concluída com sucesso.')
