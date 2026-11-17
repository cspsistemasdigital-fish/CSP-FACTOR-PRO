# Etapa 6 — Módulo de Empréstimos (CONCLUÍDA)

> Arquivo de retomada. Etapa entregue e verificada em 17/11/2026.
> Em caso de interrupção em trabalho futuro, ler este arquivo e o `AGENTS.md`.

**Status final:** backend + frontend + verificação + documentação concluídos.
Alterações consolidadas em um único commit nesta etapa (ver `git log`).

## Decisões confirmadas pelo usuário
- Parcelas **geradas** a partir de quantidade/1º vencimento/periodicidade e **editáveis** antes de salvar. Nenhum juro é calculado; a divisão igual é apenas sugestão.
- Limite: **o saldo em aberto das parcelas entra na exposição do cliente** (junto com cheques/boletos), alimentando limite disponível, relatórios e dashboard; ultrapassar apenas avisa.
- Duplicata: **documento para impressão/PDF**, com dados do cadastro do cliente e da empresa — sem gravar registro novo.
- Lucro: **informado pelo usuário** e gravado exatamente como digitado (regra de ouro).
- E-mail: usa os filtros do relatório como query string e texto editável; sem SMTP configurado, avisa e mantém o texto para conferência.

## Checklist

### Backend
- [x] Explorar padrões e alinhar regras de negócio
- [x] Modelos `Loan` e `Installment` + relationship no `Client` + registros em `models/__init__.py`
- [x] Serviço `services/loans.py` (CRUD, parcelas, filtros, totais, limite, auditoria)
- [x] Serviço `services/loans_report.py` (relatório, PDF, XLSX, WhatsApp, e-mail; `received_amount` no gráfico mensal)
- [x] Blueprint `api/loans.py` + registro no app factory
- [x] Exposição do cliente inclui parcelas de empréstimos (`services/clients.py`)
- [x] Função genérica de e-mail em `services/email.py`
- [x] Migração Alembic (`269e70536ab9`, aplicada no SQLite de dev)
- [x] Testes pytest (`tests/test_loans.py` — 9 testes)

### Frontend
- [x] Correção das setas múltiplas em `Tipo`, `Situação`, `Status`, `Ordenar por` (CSS global em `app.css`)
- [x] `loansApi` em `api/index.js` (downloads autenticados e `sendEmail(payload, params)`)
- [x] Rotas em `App.jsx`, menu no `Sidebar.jsx`, títulos no `Topbar.jsx`
- [x] `EmprestimosList.jsx`, `EmprestimoForm.jsx`, `EmprestimoDetail.jsx`
- [x] `EmprestimoPrint.jsx` (duplicata) + CSS de impressão
- [x] `RelatorioEmprestimos.jsx` (filtros, cards, gráficos, exportações, WhatsApp, e-mail, impressão)
- [x] CSS das novas telas (`styles/emprestimos.css`, importado em `main.jsx`)
- [x] Contraste AA dos textos contextuais (`text-danger`, `text-warning`, `text-success`) nos dois temas

### Verificação e documentação
- [x] `npm run build` sem erros
- [x] pytest: **121 passed**
- [x] Smoke UI: **101/101** (inclui telas de empréstimos e checagem de seta única)
- [x] Fluxos funcionais: **37/37**
- [x] Fluxo de empréstimos: **23/23** (`scripts/browser_loans.mjs`, auto-limpante)
- [x] `node scripts/verify_all.mjs`: todas as etapas OK
- [x] Atualizar `AGENTS.md`, `README.md`, `PROGRESSO.md` e `.env.example`
- [x] Commit das alterações da Etapa 6 (push pendente se credencial não tiver escrita)

## Notas de execução
- O servidor Flask precisa ser **reiniciado** depois de registrar um novo blueprint;
  uma instância antiga responde 404/405 em `/api/loans`.
- `browser_loans.mjs` cria um empréstimo com marcador `EMPRESTIMO-UI-TESTE`,
  valida listagem/formulário/detalhe/duplicata/relatório/API e remove tudo ao final.
- O smoke exige dados de demonstração (`flask seed-demo --force`).
- Todos os scripts restauram a senha provisória do administrador ao final.

## Próximo passo
Fazer push do commit da Etapa 6 para `main` (autenticar como
`cspsistemasdigital-fish` no Git Credential Manager, se a conta atual não tiver
permissão de escrita). Após o push, conferir o repositório remoto.
