# FACTOR PRO — Memória Técnica do Projeto

> **Leia este arquivo no início de cada sessão e atualize-o ao final de cada etapa.**
> Ele é a fonte de verdade sobre arquitetura, regras de negócio, convenções, comandos
> e pendências do FACTOR PRO — Gestão Financeira Inteligente.

Última atualização: **Listas com dados ocultos por padrão**. Clientes, Cheques, Boletos, Empréstimos, Operações e Recebimentos agora exibem os registros somente após acionar o botão de olho; o controle inclui tabela, cartões mobile e paginação, e volta ao estado oculto ao sair da página. Build OK; smoke verificou os controles em listas populadas e no mobile, mas registrou duas falhas preexistentes fora do escopo (título do login e contraste na Agenda); fluxo de empréstimos 36/36.

---

## 1. Visão geral

Sistema profissional de gestão de factoring. As **oito etapas** do escopo estão concluídas; a homepage, a Agenda compartilhada e os ajustes pós-Etapa 8 foram autorizados e adicionados como melhorias posteriores.

| Etapa | Escopo                                                                                                                                                                     | Situação     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **1** | Estrutura, banco de dados, autenticação, **Clientes**, **Cheques**, **Boletos**                                                                                            | ✅ Concluída |
| **2** | **Operações**, **Recebimentos**, limites aplicados, recibos                                                                                                                | ✅ Concluída |
| **3** | Dashboard completo, **Relatórios**, exportações (PDF/planilha), WhatsApp                                                                                                   | ✅ Concluída |
| **4** | Produção: e-mail de recuperação, throttling com Redis, verificação completa                                                                                                | ✅ Concluída |
| **5** | Experiência: filtros de relatório por usuário, code-splitting, revisão final                                                                                               | ✅ Concluída |
| **6** | **Empréstimos**: parcelas, exposição, relatório, duplicata, e-mail/WhatsApp e selects com seta única                                                                       | ✅ Concluída |
| **7** | **Relatório Geral unificado** (cheques, boletos e empréstimos) e **identidade visual personalizável** (nome/ícone do app e logo real em todas as exportações)              | ✅ Concluída |
| **8** | **Excel nas listagens**, **backup diário**, **atendente virtual** (texto/voz), **situação única** no Relatório Geral e **múltiplas fotos** em cheques/boletos/recebimentos | ✅ Concluída |

### Atalho local de inicialização (Windows)

- No terminal integrado do VS Code: `cd frontend; npm run abrir`.
- O script `scripts/abrir-factorpro.ps1` inicia o Flask em segundo plano se necessário,
  verifica `/api/health` e abre o app no navegador padrão em `http://127.0.0.1:5000`.
- Esse endereço é local. Para compartilhar pelo WhatsApp com celulares/outros
  computadores, é obrigatório usar um domínio público com HTTPS (ou uma rede/VPN
  configurada para acesso externo); nunca compartilhar `localhost` como destino.

> **Novas etapas ou módulos só começam com autorização explícita do usuário.**
> Módulos ainda não construídos exibem uma página informativa honesta
> (`PendingModule`) — nunca dados falsos.

### Regra de negócio soberana

**O sistema NUNCA calcula juros, descontos, taxas ou encargos automaticamente.**
Todo valor monetário é **informado pelo usuário** e gravado **exatamente** como digitado.
Os únicos valores derivados são **comparações** usadas para alertas:

- **Divergência**: `(valor nominal − custos informados) − valor líquido informado`.
  Se `|divergência| > 0,01` → alerta (não bloqueia). Bloqueia apenas se o líquido
  ou os custos ultrapassarem o valor nominal.
- **Vencido**: `due_date < hoje` e status em `EM_ABERTO`/`DEVOLVIDO`. Apenas alerta —
  o sistema não altera status sozinho.
- **Limite disponível** = `limite operacional − exposição em aberto`
  (soma de `net_amount` de cheques/boletos com status `EM_ABERTO`/`DEVOLVIDO`
  **mais o saldo das parcelas de empréstimos em aberto**). É derivado, não armazenado.
  Ultrapassar o limite é **aviso**, não bloqueio.
- **Empréstimos**: valor emprestado, recebido e lucro são informados e gravados
  exatamente como digitados. Parcelas são uma **sugestão editável** de divisão do
  principal — nunca há cálculo de juros, taxas ou encargos.

---

## 2. Stack e estrutura

### Stack obrigatória

- **Backend**: Python + Flask + SQLAlchemy + Flask-Migrate + Flask-JWT-Extended + Flask-Cors.
- **Exportações**: ReportLab (PDF A4 paisagem) + openpyxl (planilha com 5 abas) + Pillow (ícones PWA a partir do logo enviado).
- **Frontend**: React (JS) + Bootstrap 5 + ApexCharts + React Router + Axios (PWA).
- **Banco**: PostgreSQL em produção. **SQLite apenas em desenvolvimento/testes.**

### Árvore do repositório

```
FACTOR PRO/
├── AGENTS.md                  ← este arquivo (memória técnica)
├── README.md                  ← como instalar e rodar
├── PROGRESSO.md               ← memo de retomada das etapas concluídas (até Etapa 7; Etapa 8 neste arquivo)
├── .gitignore
├── backend/
│   ├── app/
│   │   ├── __init__.py        ← app factory, error handlers, headers, SPA fallback
│   │   ├── config.py          ← Config/Development/Testing/Production
│   │   ├── extensions.py      ← db, migrate, jwt, cors
│   │   ├── cli.py             ← seed, seed-demo, reset-admin-password, create-db, backup
│   │   ├── api/               ← blueprints REST
│   │   │   ├── auth.py  users.py  clients.py  cheques.py  boletos.py
│   │   │   ├── operations.py  receipts.py  reports.py  loans.py  agenda.py
│   │   │   ├── dashboard.py  settings.py  documents_utils.py  list_exports.py
│   │   ├── models/            ← user, client, cheque, boleto, operation, receipt, loan, installment, agenda_event, document, document_attachment, audit, setting, reset_token, report_filter, base
│   │   ├── services/          ← regras de negócio: clients, documents, operations, receipts, reports, report_filters, dashboard, audit, email, loans, loans_report, branding, backup, list_exports
│   │   └── utils/             ← validators, responses, security (throttling), files
│   ├── migrations/versions/   ← migrações até a7c4e1b9d2f3_document_attachments.py + 1f4b8c2d9a30_shared_agenda_events.py + 2a9c6d1e4f80_link_loans_to_operations.py
│   ├── tests/                 ← pytest (inclui agenda, auth, clientes, documentos, operações, relatórios, empréstimos, backup, fotos e exportações)
│   ├── instance/              ← factorpro.db + uploads/ + backups/ (NÃO versionar)
│   ├── requirements.txt  wsgi.py  .flaskenv  .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx            ← árvore de rotas + guardas (páginas com React.lazy)
│   │   ├── main.jsx  styles/app.css  styles/emprestimos.css  styles/home.css  styles/agenda.css
│   │   ├── api/               ← client.js (axios + refresh), index.js (endpoints)
│   │   ├── context/           ← AuthContext, ThemeContext, ToastContext, BrandContext
│   │   ├── hooks/             ← useDebouncedValue, useInstallPrompt
│   │   ├── components/        ← layout/ (AssistantWidget), ui/ (ExportXlsxButton, ProtectedImage), form/, documents/ (PhotoCapture), Logo.jsx
│   │   ├── pages/             ← HomePage pública, Agenda, Dashboard, auth/, clients/, cheques/, boletos/, operacoes/, recebimentos/, recibos/, relatorios/, emprestimos/, Settings, Admin
│   │   └── utils/format.js
│   ├── public/                ← manifest.webmanifest, sw.js, favicon.svg, icons/
│   ├── dist/                  ← build servido pelo Flask (single deployment)
│   ├── package.json  vite.config.js  index.html
└── scripts/
    ├── lib/cdp.mjs            ← cliente Chrome DevTools Protocol (sem dependências)
    ├── browser_smoke.mjs      ← smoke + auditoria de acessibilidade (101 checagens)
    ├── browser_flows.mjs      ← teste funcional de ponta a ponta (37 checagens)
    ├── browser_loans.mjs      ← fluxo de empréstimos (23 checagens, auto-limpante)
    ├── verify_all.mjs         ← pytest + build + smoke + fluxos + empréstimos (CI)
    ├── generate_icons.py
    ├── screenshots/  smoke-output.txt  flows-output.txt
```

---

## 3. Comandos

### Backend (Windows / PowerShell)

```powershell
cd backend
# Servidor de desenvolvimento (serve também o SPA compilado)
.\.venv\Scripts\flask.exe run --port 5000

# Preparar banco + administrador
.\.venv\Scripts\flask.exe seed
# Dados de demonstração [DEMO] (opcional)
.\.venv\Scripts\flask.exe seed-demo

# Redefinir a senha do administrador (deixa must_change_password=True)
.\.venv\Scripts\flask.exe reset-admin-password --email admin@factorpro.com.br --password Admin@12345

# Criar um backup manual (o agendador diário roda sozinho com BACKUP_SCHEDULER_ENABLED=true)
.\.venv\Scripts\flask.exe backup --now

# Testes (141 testes)
.\.venv\Scripts\python.exe -m pytest -q

# Migrações
.\.venv\Scripts\flask.exe db upgrade
.\.venv\Scripts\flask.exe db migrate -m "descrição"
```

### Frontend

```powershell
cd frontend
npm install
npm run dev      # Vite em http://localhost:5173 (proxy /api -> 127.0.0.1:5000)
npm run build    # gera dist/ servido pelo Flask
npm run verify   # pytest + build + smoke + fluxos + empréstimos (backend no ar)
```

### Verificação de interface (headless Chrome via CDP)

Requer backend no ar em `http://127.0.0.1:5000`, Chrome em
`C:\Program Files\Google\Chrome\Application\chrome.exe` e Node v22 (WebSocket global).

```powershell
node scripts/browser_smoke.mjs   # 112/112 — telas, temas, responsivo, AA, homepage, agenda e menu
node scripts/browser_flows.mjs   # 37/37 — CRUD real, divergência, auditoria, relatórios, filtros salvos e exportações
node scripts/browser_loans.mjs   # 23/23 — empréstimos: parcelas, limite, duplicata, relatório e exportações
```

Todos são **auto-limpantes**: os fluxos criam e removem os próprios dados
(marcadores `FLUXO-UI-TESTE` e `EMPRESTIMO-UI-TESTE`, cliente `Cliente Teste Fluxo UI`),
removem o filtro de relatório salvo usado no teste e **restauram** o estado de
primeiro acesso do administrador ao final. São reexecutáveis.
Screenshots em `scripts/screenshots/`; saída em `scripts/*-output.txt`.

> O smoke exige dados de demonstração (`flask seed-demo --force`).
> Após adicionar/registrar um blueprint é preciso **reiniciar o Flask**: uma
> instância antiga responde 404/405 em `/api/loans` ou `/api/settings/brand`.

`node scripts/verify_all.mjs` (ou `npm run verify` em `frontend/`) encadeia
**pytest → build → smoke → fluxos → empréstimos** e retorna código de saída
adequado para CI.

---

## 4. Configuração e ambiente

Variáveis em `backend/.env` (copiar de `.env.example`; **nunca versionar** `.env`):

| Variável                                                  | Padrão dev                                           | Observação                                                   |
| --------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `FLASK_ENV`                                               | `development`                                        | `production` exige PostgreSQL + secrets próprios             |
| `SECRET_KEY` / `JWT_SECRET_KEY`                           | inseguros                                            | obrigatórios fortes em produção                              |
| `DATABASE_URL`                                            | `sqlite:///instance/factorpro.db`                    | produção: `postgresql+psycopg2://...`                        |
| `JWT_ACCESS_TOKEN_MINUTES` / `JWT_REFRESH_TOKEN_DAYS`     | 120 / 7                                              |                                                              |
| `UPLOAD_FOLDER` / `MAX_UPLOAD_MB`                         | `instance/uploads` / 10                              | extensões: pdf, png, jpg, jpeg, webp                         |
| `ADMIN_NAME/EMAIL/PASSWORD`                               | Administrador / admin@factorpro.com.br / Admin@12345 | criados por `flask seed`                                     |
| `EXPOSE_RESET_TOKEN`                                      | `true` (dev)                                         | em produção o token **não** é retornado                      |
| `FRONTEND_BASE_URL`                                       | `http://127.0.0.1:5000`                              | base do link de recuperação (`/redefinir-senha?token=...`)   |
| `MAIL_SERVER` / `MAIL_PORT` / `MAIL_USE_TLS`              | vazio / 587 / true                                   | **obrigatório em produção**; sem ele nenhum e-mail é enviado |
| `MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_DEFAULT_SENDER` | vazio / vazio / FACTOR PRO `<no-reply@…>`            | credenciais SMTP e remetente                                 |
| `MAIL_TIMEOUT_SECONDS`                                    | 10                                                   | tempo máximo de conexão SMTP                                 |
| `RATE_LIMIT_STORAGE_URL`                                  | vazio (memória)                                      | `redis://…` para throttling compartilhado entre instâncias   |
| `BACKUP_FOLDER`                                           | `instance/backups`                                   | pasta dos arquivos ZIP (não versionar)                       |
| `BACKUP_SCHEDULER_ENABLED`                                | `true`                                               | `false` em testes; preferências diárias ficam em `settings`  |
| `BACKUP_CHECK_INTERVAL_SECONDS`                           | `60`                                                 | frequência com que o agendador relê as preferências          |
| `BACKUP_PG_DUMP_PATH` / `BACKUP_PG_DUMP_TIMEOUT_SECONDS`  | `pg_dump` / `120`                                    | usado apenas quando `DATABASE_URL` é PostgreSQL              |

- Em `production`, `create_app()` **recusa** iniciar com SQLite, com `SECRET_KEY` de dev
  ou sem `MAIL_SERVER` configurado.
- `TestingConfig` usa `TEST_DATABASE_URL` (SQLite em memória por padrão) e PBKDF2 com
  custo reduzido (`PASSWORD_HASH_METHOD`) para testes rápidos.
- Hash de senha: `pbkdf2:sha256:600000` (configurável por `PASSWORD_HASH_METHOD`).
- **Throttling de login**: 6 tentativas / 300s por e-mail + IP. Com
  `RATE_LIMIT_STORAGE_URL` usa janela deslizante no Redis; se o Redis estiver
  indisponível, cai automaticamente para memória (sem bloquear o login).
- **Recuperação de senha**: com SMTP configurado o link é enviado por e-mail; em dev,
  com `EXPOSE_RESET_TOKEN=true`, a API também devolve o token para testes. Falhas de
  SMTP são registradas e **não** revelam se o e-mail existe.
- **Relatório de empréstimos por e-mail**: usa a mesma configuração SMTP; os filtros
  vão na query string e o texto é editável. Sem `MAIL_SERVER`, a API responde
  `email_sent: false` com o texto para conferência (não revela dados do destinatário).
- **Backup diário**: o agendador em `threading` lê as preferências de `settings` a cada
  tick e cria um ZIP em `BACKUP_FOLDER` no horário escolhido. SQLite usa a API online
  de backup; PostgreSQL usa `pg_dump`. A retenção remove apenas arquivos antigos;
  backups manuais funcionam mesmo com o agendador desligado.

### Credenciais de desenvolvimento

- **Administrador**: `admin@factorpro.com.br` / `Admin@12345`
- O administrador semeado nasce com `must_change_password = True` → o primeiro login no
  navegador redireciona para `/trocar-senha` (comportamento intencional).

---

## 5. Modelo de dados

Todas as tabelas de domínio têm `TimestampMixin` (created/updated + `created_by_id`/
`updated_by_id`) e as entidades de negócio têm `SoftDeleteMixin` (`is_deleted`,
`deleted_at`, `deleted_by_id`). **Exclusão é sempre lógica; nunca física.**

| Tabela                  | Campos-chave                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`                 | name, email (único), password_hash, role, is_active, must_change_password, last_login_at                                                                                                                                                         |
| `clients`               | code (`CLI-0001`), name, person_type (PF/PJ), document (normalizado), contatos/endereço, registered_at, operational_limit, status (ATIVO/INATIVO)                                                                                                |
| `cheques`               | code (`CHQ-00001`), number, bank, agency, account, identifier, client*id, issuer_document/name, nominal_amount, discount_amount, interest_amount, other_expenses, **net_amount**, applied_limit, issue/due/operation_date, status, attachment*\* |
| `boletos`               | code (`BOL-00001`), identifier, barcode, bank, client*id, beneficiary_document/name, original_amount, discount_amount, other_expenses, **net_amount**, applied_limit, issue/due/operation_date, status, **operation_id**, attachment*\*          |
| `operations`            | code (`OPR-00001`), client_id, operation_date, description, status (ABERTA/FECHADA), notes — cheques/boletos e empréstimos vinculados; totais derivados por grupo                                                                                                               |
| `receipts`              | code (`REC-00001`), document*kind (CHEQUE/BOLETO), document_id, client_id, receipt_date, amount, notes, attachment*\* — baixa **manual** e auditada                                                                                              |
| `document_attachments`  | document*kind (`CHEQUE`/`BOLETO`/`RECEIPT`), document_id, path, name, size, content_type — **várias fotos** por documento, com soft delete; coluna legada `attachment*\*` preservada                                                             |
| `loans`                 | code (`EMP-00001`), client_id, **operation_id** nullable, loan_date, **loan_amount**, **received_amount**, **profit_amount** (informados), status (ABERTA/QUITADA/CANCELADA), notes, totais derivados; **soft delete**                                                      |
| `installments`          | loan_id, number, due_date, **amount**, status (`DocumentStatus`), notes — parcelas **editáveis**; `EM_ABERTO`/`DEVOLVIDO` entram na exposição                                                                                                    |
| `audit_logs`            | user_id/user_email, action, entity, entity_id, description, changes (JSON), ip_address, created_at                                                                                                                                               |
| `settings`              | key/value (dados da empresa + branding: `app_name`, `brand_logo_path`, `brand_logo_name`; backup: `backup_enabled`, `backup_time`, `backup_retention_days`, `backup_include_uploads`, `backup_last_at`, `backup_last_error`)                     |
| `password_reset_tokens` | user_id, token_hash, expires_at, used_at                                                                                                                                                                                                         |
| `report_filters`        | user_id, name, filters (JSON canônico), timestamps + **soft delete** — preferência **pessoal** do usuário (máx. 20 ativos)                                                                                                                       |
| `agenda_events`         | title, start_at, end_at, location, description, color + timestamps/auditoria e **soft delete** — compromissos **compartilhados** entre usuários                                                                                                  |

### Enums

- **Role**: `ADMIN` (Administrador), `OPERATOR` (Operador), `VIEWER` (Consultor/Visualizador).
- **ClientStatus**: `ATIVO`, `INATIVO`.
- **DocumentStatus**: `EM_ABERTO`, `LIQUIDADO`, `DEVOLVIDO`, `CANCELADO`
  (`PENDING = (EM_ABERTO, DEVOLVIDO)` = ainda representa valor devido).
- **OperationStatus**: `ABERTA`, `FECHADA`.
- **LoanStatus**: `ABERTA`, `QUITADA`, `CANCELADA` (`ALL` para filtros).
- **DocumentKind**: `CHEQUE`, `BOLETO` (discriminador usado por `receipts`).
- **AuditAction**: `CREATE, UPDATE, DELETE, LOGIN, LOGIN_FAILED, LOGOUT,
STATUS_CHANGE, PASSWORD_CHANGE, PASSWORD_RESET, EXPORT`.

### Índices e integridade

- `uq_clients_document_active`: documento **único entre clientes não excluídos**
  (índice parcial — `WHERE is_deleted = 0/false`), somado à validação na aplicação.
- Valores monetários: `Numeric(15,2)` (nunca float). Serializados como string `"0.00"`.
- Documentos usam `person_type`/normalização **alfanumérica maiúscula** (aceita o
  **novo CNPJ alfanumérico** da Receita: `ord(char) − 48`).

---

## 6. API REST (prefixo `/api`)

Todas as rotas exigem `Authorization: Bearer <access_token>`, exceto as de auth.
Respostas: `{item}` · `{items, meta:{page,per_page,total,pages}, totals}` ·
`{message, errors:{campo:msg}}`. Erros: **422** validação, **401/403/404/429**.
`GET /api/health` é público. A homepage pública fica em `/`; login em `/login` e
Dashboard autenticado em `/dashboard`.

| Recurso           | Rotas                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **auth**          | `POST /login` `POST /refresh` `POST /logout` `GET /me` `POST /change-password` `POST /forgot-password` `POST /reset-password`                                                                                                                                                                                                                 |
| **users** (ADMIN) | `GET/POST /` `PUT /<id>` `POST /<id>/reset-password` `GET /audit-logs` (filtros: entity, action, user_id, search, date_from, date_to)                                                                                                                                                                                                         |
| **clients**       | `GET /` (search, status, blocked, overdue, page, per_page) `GET /options` `GET /<id>` `GET /<id>/history` `POST /` `PUT /<id>` `PATCH /<id>/block` (ADMIN/OPERATOR, motivo obrigatório) `DELETE /<id>` (ADMIN)                                                                                                                                    |
| **cheques**       | `GET /` `GET /banks` `GET /<id>` `POST /` `PUT /<id>` `PATCH /<id>/status` `DELETE /<id>` (ADMIN) + `POST/GET/DELETE /<id>/attachment` + `GET/POST /<id>/photos`, `GET/DELETE /<id>/photos/<attachment_id>` (upload/remoção: ADMIN/OPERATOR)                                                                                                  |
| **boletos**       | idem cheques                                                                                                                                                                                                                                                                                                                                  |
| **operations**    | `GET /` `GET /available-documents?client_id=` `GET /available-loans?client_id=` `GET /<id>` `POST /` `PUT /<id>` `PATCH /<id>/status` `DELETE /<id>` (ADMIN)                                                                                                                                                                                   |
| **receipts**      | `GET /` `GET /open-documents` `GET /<id>` `GET /<id>/recibo` `POST /` `PUT /<id>` `DELETE /<id>` (estorno, ADMIN) + `POST/GET/DELETE /<id>/attachment` + `GET/POST /<id>/photos`, `GET/DELETE /<id>/photos/<attachment_id>` (upload/remoção: ADMIN/OPERATOR)                                                                                  |
| **loans**         | `GET /` (search, status, client_id, date_from/to, sort, order) `GET /<id>` `GET /<id>/duplicata` `POST /` `PUT /<id>` `PATCH /<id>/status` `PATCH /<id>/installments/<id>/status` `DELETE /<id>` (ADMIN) · `GET /report/summary` `GET /report/export/pdf` `GET /report/export/xlsx` `GET /report/whatsapp?client_id=` `POST /report/email`    |
| **reports**       | `GET /summary` `GET /whatsapp?client_id=` `GET /export/pdf` `GET /export/xlsx` (filtros: date_from, date_to, client_id, kind=CHEQUE\|BOLETO\|EMPRESTIMO, status, loan_status, overdue, search) · `GET /filters` `POST /filters` `DELETE /filters/<id>` (filtros salvos do próprio usuário)                                                    |
| **list exports**  | `GET /export/<resource>/xlsx` · `GET /export/resources` — resource: `clients`, `cheques`, `boletos`, `operations`, `receipts`, `loans` (todos os autenticados) e `users`, `audit` (ADMIN); mesmos filtros da listagem, sem paginação                                                                                                          |
| **dashboard**     | `GET /summary` (filtros: date_from, date_to, client_id)                                                                                                                                                                                                                                                                                       |
| **alerts**        | `GET /alerts` (autenticado) — clientes inadimplentes, títulos e parcelas de empréstimo vencidos e total em atraso; apenas informativo                                                                                                                                                                                                           |
| **agenda**        | `GET /?start=AAAA-MM-DD&end=AAAA-MM-DD` (todos os autenticados) · `POST /` e `PUT /<id>` (ADMIN/OPERATOR) · `DELETE /<id>` (ADMIN, exclusão lógica); todos os eventos são compartilhados e auditados                                                                                                                                          |
| **settings**      | `GET /company` (todos) `PUT /company` (ADMIN) · `POST/DELETE /company/logo` (ADMIN) · **backup**: `GET /backup` (todos) `PUT /backup` `POST /backup/run` `GET /backup/<name>/download` `DELETE /backup/<name>` (ADMIN) · **público e somente leitura**: `GET /brand` `GET /brand/logo` `GET /brand/favicon` `GET /brand/manifest.webmanifest` |

### Convenções de payload

- Valores monetários aceitam `"1.234,56"` ou `"1234.56"`; gravados exatos.
- Datas em ISO `YYYY-MM-DD`. `operation_date > due_date` é permitido (registro tardio);
  `due_date < issue_date` é bloqueado.
- Chaves de cheque: `number, bank, agency, account, identifier, client_id,
issuer_document, issuer_name, nominal_amount, discount_amount, interest_amount,
other_expenses, net_amount, applied_limit, issue_date, due_date, operation_date,
status, notes`.
- Chaves de boleto: `identifier, barcode, bank, client_id, beneficiary_document,
beneficiary_name, original_amount, discount_amount, other_expenses, net_amount,
applied_limit, issue_date, due_date, operation_date, status, notes`.
- Chaves de operação: `client_id, operation_date, description, status, notes,
documents: [{kind: CHEQUE|BOLETO, id}], loan_ids: [id]`. Só aceita documentos e
  empréstimos ativos do **mesmo cliente**, não excluídos, não cancelados e ainda sem
  outra operação. Os totais de empréstimos são separados dos totais de títulos.
- Chaves de recebimento: `document_kind, document_id, receipt_date, amount, notes`.
  A baixa é **manual**; o valor é gravado exatamente como informado (aviso se exceder
  o saldo). Ao atingir o líquido, o título vira `LIQUIDADO`; o estorno reverte.
- Chaves de empréstimo: `client_id, loan_date, loan_amount, received_amount,
profit_amount, status, notes, installments:[{due_date, amount, notes}]`. O array
  de parcelas enviado pelo formulário tem prioridade sobre `installments_config`.
  Valores são gravados exatamente como informados; a soma das parcelas é apenas
  conferência informativa. `GET /<id>` inclui `limit` e `history` (auditoria).
- **Relatório de empréstimos**: filtros `date_from, date_to, client_id, status,
search`. `/summary` devolve `cards, by_month (com received_amount), by_status,
clients, loans, installments, counts, filters, period_label, generated_at`.
  `POST /report/email` recebe `{to, message}` e os filtros na **query string**; responde
  `email_sent, subject, preview`. A duplicata `/<id>/duplicata` devolve `item,
company, generated_at` **sem gravar nada**.
- **Relatório Geral unificado**: filtros `date_from, date_to, client_id,
kind=CHEQUE|BOLETO|EMPRESTIMO, status (do título), loan_status (do empréstimo),
overdue, search`. Títulos são filtrados por `operation_date`/`loan_date`;
  recebimentos por `receipt_date`. `/summary` traz `cards, by_kind, by_status,
by_loan_status, by_month, clients, documents, loans, installments, operations,
receipts, counts, filters, period_label, generated_at`. `/whatsapp` devolve
  `{item:{client, company, message, phone, url, documents_count, loans_count,
installments_count, total, documents}}` com texto **editável** (nada é enviado
  automaticamente). Exportações registram `AuditAction.EXPORT` com entidade `report`.
- **Filtros salvos**: `POST /reports/filters` recebe `{name, filters:{date_from,
date_to, client_id, client_name, client_code, kind, status, loan_status, overdue,
search}}`; o servidor valida e **canonicaliza** (descarta chaves desconhecidas,
  `client_name/code` são apenas rótulos de exibição). Máximo de **20** filtros ativos
  por usuário. `GET` devolve `{items}`; `DELETE` faz exclusão **lógica** e responde
  `{message}`.
- **Branding**: `PUT /settings/company` aceita `app_name` (nome do aplicativo);
  `POST /settings/company/logo` (multipart `file`, png/jpg/jpeg/webp) e
  `DELETE /settings/company/logo` trocam o logotipo (um único arquivo, usado também
  como ícone do app). `GET /settings/brand*` é **público e somente leitura** porque
  `<img>`, favicon e manifest PWA não enviam Bearer — os dados completos da empresa
  continuam autenticados. O logo aparece em PDFs, XLSX, recibos e duplicatas; o nome
  exibido é o `app_name` personalizado (ou `company_name` quando não personalizado).
- **Bloqueio manual de cliente**: `PATCH /clients/<id>/block` recebe `{blocked: bool,
reason: string}`. O motivo é obrigatório ao bloquear e a alteração é auditada.
  Clientes bloqueados não recebem novos cheques, boletos ou operações; recebimentos e
  edição de lançamentos existentes continuam permitidos. O bloqueio nunca é automático.
- **Excel das listagens**: `GET /api/export/<resource>/xlsx` aplica os mesmos filtros
  da tela (search, status, período etc.) e **ignora a paginação**. Cada recurso gera
  uma aba estilizada com o nome/logo da marca, cabeçalho verde `#123D32`, moeda em
  `R$`, filtro automático e linha congelada. O download usa blob autenticado e
  registra `AuditAction.EXPORT` com entidade `<resource>_list`. Nenhum valor é
  recalculado — apenas copiado como está gravado.
- **Múltiplas fotos**: `POST /<id>/photos` recebe multipart `files` (ou `file` legado)
  em png/jpg/jpeg/webp; cada arquivo é salvo como `DocumentAttachment` independente,
  com limite individual de `MAX_UPLOAD_MB`. A listagem inclui o anexo legado como
  primeiro item; `GET /<id>/photos/<attachment_id>` devolve a imagem por blob
  autenticado e `DELETE` faz soft delete + auditoria. Coluna antiga `attachment_*`
  continua funcionando para compatibilidade.
- **Backup**: `GET /api/settings/backup` devolve `{settings, backups, scheduler_enabled}`;
  `PUT` aceita `backup_enabled` (bool), `backup_time` (`HH:MM`), `backup_retention_days`
  (1–90) e `backup_include_uploads` (bool). `POST /backup/run` cria um ZIP imediato;
  `GET /backup/<name>/download` e `DELETE /backup/<name>` (ADMIN) operam sobre arquivos
  dentro de `BACKUP_FOLDER`. O ZIP contém `database.sql`/`database.sqlite` (ou dump
  `pg_dump` em PostgreSQL) e, opcionalmente, `uploads/`. O agendador em `threading`
  relê as preferências a cada `BACKUP_CHECK_INTERVAL_SECONDS` e grava
  `backup_last_at`/`backup_last_error` em `settings`.

---

## 7. Autenticação e segurança

- **Access token em memória** (nunca em localStorage) + **refresh cookie httpOnly**
  (`/api/auth`, `SameSite=Lax` dev / `Strict` prod, `Secure` em prod).
- `client.js`: intercepta 401, renova via `/auth/refresh` (fila única) e repete a chamada;
  `bootstrapSession()` restaura a sessão silenciosamente ao carregar o app.
- CSRF **não** se aplica: autenticação por header `Bearer` (cookie CSRF desabilitado).
- Cabeçalhos de segurança em todas as respostas: `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`
  (`microphone=(self)` para o atendente por voz; `camera=()` porque a captura usa
  `<input type="file" capture="environment">`); `/api/*` com `no-store`.
- Anexos e fotos acessados por **blob autenticado** (não há URL pública de arquivo).

### Papéis e permissões

| Ação                                                                                               | ADMIN | OPERATOR | VIEWER |
| -------------------------------------------------------------------------------------------------- | :---: | :------: | :----: |
| Ver tudo (inclui **empréstimos** e seu relatório)                                                  |  ✅   |    ✅    |   ✅   |
| Criar/editar clientes, cheques, boletos, operações, recebimentos e **empréstimos**; alterar status |  ✅   |    ✅    |   ❌   |
| Excluir clientes/documentos/operações/**empréstimos** e estornar recebimentos (lógica)             |  ✅   |    ❌    |   ❌   |
| Exportar relatórios (PDF/planilha), gerar mensagem de WhatsApp e **enviar relatório por e-mail**   |  ✅   |    ✅    |   ✅   |
| Exportar **Excel das listagens** (exceto usuários/auditoria, ADMIN)                                |  ✅   |    ✅    |   ✅   |
| Enviar/remover **fotos extras** em cheques, boletos e recebimentos (leitura para VIEWER)           |  ✅   |    ✅    |   ❌   |
| Ver status/configuração do backup (edição, execução, download e remoção só ADMIN)                  |  ✅   |    ✅    |   ✅   |
| Salvar/remover **os próprios** filtros de relatório                                                |  ✅   |    ✅    |   ✅   |
| Administração (usuários + auditoria)                                                               |  ✅   |    ❌    |   ❌   |
| Configurações da empresa e **identidade visual** (nome/logo do app) — editar                       |  ✅   |    ❌    |   ❌   |
| Criar/editar compromissos na Agenda compartilhada                                                  |  ✅   |    ✅    |   ❌   |
| Excluir compromissos da Agenda (lógica + auditoria)                                                |  ✅   |    ❌    |   ❌   |

### Regras de proteção

- Excluir cliente é **bloqueado** se houver documentos em aberto/devolvidos (422).
- Documento/cliente excluído deixa de aparecer (`is_deleted`) e é registrado na auditoria.
- LGPD: dados mínimos, exclusão lógica, auditoria de acesso/alteração, sem exposição pública.

### Guardas de rota (frontend)

`RequireAuth` (manda `must_change_password` para `/trocar-senha`) · `RequireGuest` ·
`RequirePasswordChange` · `WriteOnly` · `AdminOnly`.

---

## 8. Frontend — convenções

- **Identidade visual** (tokens em `styles/app.css`):
  verde-escuro `#123D32`, verde `#16845B`, verde-claro `#E4F0E7`, latão `#A9813C`,
  azul-petróleo `#173B57`, tema claro marfim `#F5F1E8`/superfície `#FFFDF8` e fundo
  escuro `#101B1A`.
  Temas **claro/escuro** com preferência salva; sidebar recolhível; responsivo.
- **Marca do usuário (white-label)**: `BrandContext` (`useBrand()`) carrega
  `GET /api/settings/brand` no boot e expõe `app_name`/`logo_url`/`refreshBrand()`.
  `Logo.jsx`, menu, login, `NotFound` e formulários usam essa marca; o `<title>`, o
  favicon e o manifest PWA são dinâmicos. Em **Configurações** o ADMIN informa o nome
  do aplicativo e envia/remove o logotipo (prévia imediata). O mesmo arquivo de logo
  aparece em PDFs, XLSX, recibos e duplicatas — nunca um "FACTOR PRO" fixo.
- **Alerta de inadimplência**: `GlobalAlerts` consulta `/api/alerts` ao abrir a área
  autenticada, apresenta banner dispensável e um toast por sessão; o link filtra
  clientes com títulos ou parcelas de empréstimo vencidos. Em `/clientes?overdue=1`,
  WhatsApp abre texto revisável e e-mail abre rascunho; ambos exigem confirmação manual.
  A decisão de bloquear segue manual, com motivo e auditoria.
- **Contraste WCAG AA** garantido por tokens de texto dedicados: `--fp-green-text`,
  `--fp-petroleum-text`, `--fp-danger-text`, `--fp-warning-text` e `--tone-text`
  (por tom de card/toast). Manter ao adicionar novas cores de texto. Os avisos de
  divergência, limite e vencimento usam esses tokens (nunca a cor de fundo do tema).
- **Selects com seta única**: estilo global em `styles/app.css` remove as setas
  duplicadas de `<select>` (nativo + Bootstrap) em **Tipo, Situação, Status e
  Ordenador por**. Novos selects devem seguir o mesmo padrão — uma única seta,
  alinhada como os demais campos. O smoke verifica essa checagem.
- **Listas**: filtros e paginação nos **search params da URL** (compartilhável/voltar).
  Os registros de Clientes, Cheques, Boletos, Empréstimos, Operações e Recebimentos
  começam ocultos; o botão de olho acessível mostra/esconde tabela, cartões mobile e
  paginação. O estado é local à página e não persiste ao sair dela.
- **Homepage e navegação**: `/` é a homepage pública institucional, com CTA para
  `/login`; a área autenticada inicia em `/dashboard`. No menu, Visão geral contém
  Dashboard e Agenda; há atalho de tema claro/escuro na homepage e Cadastros segue
  Clientes, Empréstimos, Cheques, Boletos.
- **Agenda** (`/agenda`): eventos compartilhados, visualizações mês/semana/dia,
  horário, local, descrição e cor; ADMIN/OPERATOR criam e editam, ADMIN exclui.
  A tabela `agenda_events` usa exclusão lógica e auditoria; estilos em `styles/agenda.css`.
- **Dashboard**: filtros em rascunho com botão **Aplicar** (presets aplicam na hora).
- **Relatório Geral** (`/relatorios`): filtros em rascunho com **Aplicar**, presets de
  período, tipo (**Cheques, Boletos, Empréstimos** — `kind`) e **um único filtro
  “Situação”** (`COMBINED_STATUS_OPTIONS`) que combina situações de título e de
  empréstimo em `doc:<status>` / `loan:<status>`; a API continua recebendo `status` e
  `loan_status` separados. Ao abrir sem filtros explícitos, o período inicial é o mês
  atual até hoje. 6 abas (Visão geral, Clientes e limites, Títulos,
  **Empréstimos**, Operações, Recebimentos), paginação local de 25 linhas, exportação
  por **blob autenticado** e modal de WhatsApp por cliente. A aba Empréstimos traz
  cards, gráfico/sumário por situação, tabela de empréstimos e de parcelas (clicáveis,
  levando ao detalhe). **Filtros salvos** ficam na conta do usuário (API
  `/reports/filters`, até 20), disponíveis em qualquer dispositivo; o rótulo da área é
  “Filtros salvos na sua conta”. Tabelas usam `.report-table` dentro de `.fp-table-wrap`.
- **Empréstimos** (`/emprestimos`): formulário com busca automática do cliente
  (`ClientSelect`), valores informados (emprestado/recebido/lucro), parcelas geradas
  como **sugestão editável** (quantidade, 1º vencimento e periodicidade), lucro oculto
  por padrão com controle para mostrar/ocultar, atalho de cadastro rápido do cliente
  com retorno preservando o formulário e aviso de limite sem bloqueio. A minuta de
  promissória usa os dados informados e imprime em uma página A4, com título único,
  dados principais na mesma linha, parcelas compactas e espaço de assinatura. A folha
  não inclui cabeçalho, selo ou texto de minuta. Estilos em `styles/emprestimos.css`.
  A **duplicata**
  (`/emprestimos/:id/duplicata`) é somente visão de impressão — não grava nada.
  O relatório (`/emprestimos/relatorio`) usa as mesmas convenções de filtros,
  gráficos ApexCharts, exportações por blob autenticado, WhatsApp (texto editável) e
  formulário de e-mail com os filtros atuais.
- **Operações com empréstimos**: cada operação pode vincular documentos e empréstimos
  ativos do mesmo cliente; cada empréstimo pertence a no máximo uma operação. Os
  valores de empréstimos ficam em totais separados dos cheques/boletos. A migração
  `2a9c6d1e4f80_link_loans_to_operations.py` cria o vínculo opcional em `loans`.
- **Inadimplência e lembretes**: o filtro `overdue=1` considera títulos e parcelas de
  empréstimos vencidos. O botão global direciona à lista filtrada; WhatsApp abre texto
  revisável e e-mail abre rascunho, sempre com confirmação manual e sem envio automático.
- **Code-splitting**: `App.jsx` carrega as páginas com `React.lazy` + `Suspense`
  (fallback `BootScreen`); layout, guardas e tema permanecem no bundle inicial.
  `vite.config.js` separa `react-vendor` e `charts-vendor` (ApexCharts só é baixado
  nas telas de Dashboard/Relatórios).
- **Formulários**: `Field` gera id `#field-<name>`; `CurrencyField`, `DocumentField`,
  `PhoneField`, `ZipField` e `ClientSelect` **não** têm `name` → não têm id de campo
  (os testes os localizam pelo rótulo). Painel "Conferência dos valores" é **informativo**
  (não recalcula). `ClientSelect` usa `#client-select-input` + `[role="option"]`.
- **Feedback**: `ToastContext` (`.fp-toast-<variant>`), `ConfirmDialog`/`Modal`
  (`.fp-modal-foot`, `.btn-danger`), `EmptyState`, `Feedback` (Error/Loading).
- **PWA**: `sw.js` cacheia **somente** o shell estático; `/api/*` é sempre rede.
  Service worker registrado **apenas em produção**. O manifest é servido em
  `/api/settings/brand/manifest.webmanifest` (nome/ícone dinâmicos) e o fallback
  offline é neutro; downloads por blob preferem o nome de arquivo enviado pelo
  servidor no `Content-Disposition` (slug da marca).
- **Excel nas listagens**: `ExportXlsxButton` é compartilhado por Clientes, Cheques,
  Boletos, Operações, Recebimentos, Empréstimos e Administração (usuários/auditoria).
  Ele monta a query string com os filtros já aplicados na URL e baixa via blob
  autenticado — sem nova dependência npm (`openpyxl` renderiza no backend).
- **Múltiplas fotos**: `PhotoCapture` usa `<input type="file" accept="image/*"
capture="environment">` para tirar uma foto por vez em celular/tablet e acumula
  uma fila; o envio é sequencial para respeitar `MAX_CONTENT_LENGTH`. `ProtectedImage`
  mostra a galeria por blob autenticado, com visualizar, baixar e remover. Integrado
  em `DocumentDetailPage` (cheques/boletos) e `RecebimentoDetail`.
- **Backup diário** (`/configuracoes`, aba “Backup diário”, ADMIN): status do
  agendador, último backup/erro, horário, retenção (dias), inclusão de uploads,
  botão “Criar backup agora” e lista com download/remoção. Preferências salvas via
  `/api/settings/backup`; indicadores e botões seguem os tokens AA do tema.
- **Atendente virtual**: `AssistantWidget` é um FAB disponível em todas as telas
  autenticadas (`AppLayout`). Aceita texto e voz (Web Speech API, `pt-BR`, somente
  Chrome/Edge), normaliza acentos/sinônimos e navega pelas rotas do menu lateral;
  sugestões e histórico ficam no widget. Quando o reconhecimento de fala não está
  disponível, o campo de texto continua funcional. O rodapé exibe **v1.6 · Etapa 8**.

---

## 9. Testes e verificação

| Suíte                     | Comando                                               | Resultado atual                               |
| ------------------------- | ----------------------------------------------------- | --------------------------------------------- |
| Backend (pytest)          | `cd backend; .\.venv\Scripts\python.exe -m pytest -q` | **161 passed**                                |
| Smoke UI + acessibilidade | `node scripts/browser_smoke.mjs`                      | **137/139** (2 falhas preexistentes fora do escopo) |
| Fluxos funcionais UI      | `node scripts/browser_flows.mjs`                      | **37/37**                                     |
| Fluxo de empréstimos UI   | `node scripts/browser_loans.mjs`                      | **36/36**                                     |
| Verificação completa      | `node scripts/verify_all.mjs`                         | pytest → build → smoke → fluxos → empréstimos |

O smoke cobre: todas as telas (claro/escuro/mobile), overflow horizontal, texto cortado,
alvos de toque, contraste AA, tema persistente, 404, logout/login, sem erros de console,
além das telas de operações, recebimentos, **Relatório Geral (6 abas, inclusive
Empréstimos, e resumo derivado)**, **empréstimos (lista/formulário/detalhe/relatório),
lucro oculto, alternância de tema, acesso ao cadastro rápido e minuta de promissória**,
a alternância de dados salvos nas listagens, cartões de clientes revelados no celular,
a checagem de seta única dos selects, a homepage pública e a Agenda (mês/semana/dia).
Os fluxos cobrem: login + troca obrigatória, cadastro/edição de cliente, CPF/CNPJ
duplicado (422), cheque com divergência, boleto coerente, exclusão bloqueada, mudança de
status, exclusão lógica, **auditoria conferida via API**, relatório consolidado,
exportações PDF/planilha, registro `EXPORT` na auditoria, **filtro de relatório salvo**
(criação, listagem na interface, aplicação e remoção).
O fluxo de empréstimos cobre: parcelas geradas/editáveis, cadastro rápido e retorno ao
formulário, lucro oculto, preservação do rascunho, minuta de promissória com impressão
PDF comprovada em uma página A4, exposição e aviso de limite, duplicata para impressão,
relatório com gráficos/cards e exportações PDF/XLSX — com limpeza automática dos dados
marcados `EMPRESTIMO-UI-TESTE`.
Os testes de backend incluem e-mail de recuperação (conteúdo, envio, falha de SMTP),
throttling com Redis (janela deslizante, fallback), exigência de `MAIL_SERVER` em
produção, CRUD/limite/isolamento dos filtros salvos por usuário, o módulo de
empréstimos (`tests/test_loans.py`: parcelas, limites, exposição, relatório, WhatsApp,
e-mail e duplicata) e a Etapa 7 (`tests/test_etapa7.py`: filtro `EMPRESTIMO`/`loan_status`
no Relatório Geral, resumo/cards/by_kind com empréstimos, PDF/XLSX com marca, endpoints
públicos de branding, upload/remoção de logo e manifest dinâmico). A Etapa 8 acrescenta
`tests/test_backup.py` (preferências, agendamento, manual, retenção, download e
remoção), `tests/test_photos.py` (múltiplas fotos, isolamento por documento, blob e
soft delete) e `tests/test_list_exports.py` (recursos, filtros, permissões e XLSX).

> Os 422 **intencionais** (duplicidade e exclusão bloqueada) são erros esperados no
> console do navegador e já são ignorados pelo `browser_flows.mjs`.

O modelo de IA **não enxerga imagens**: a verificação visual é feita por asserções de
DOM/estilo computado; os screenshots ficam para conferência humana.

---

## 10. Estado atual, pendências e próximos passos

**Todas as oito etapas planejadas estão entregues e verificadas.** A homepage pública,
a Agenda compartilhada e a reorganização de navegação também foram entregues por
solicitação explícita. O sistema roda em
desenvolvimento em `http://127.0.0.1:5000` (Flask servindo o build do SPA) e está pronto
para uso; a lista abaixo registra o que foi entregue em cada etapa.

### Entregue na Etapa 1 ✅

- Estrutura completa (backend + frontend), migração inicial Alembic.
- Autenticação JWT (access em memória + refresh httpOnly), troca/recuperação de senha,
  primeiro acesso obrigatório, throttling, auditoria de login.
- **Clientes**: CRUD, validação de CPF/CNPJ (incl. alfanumérico), bloqueio de duplicidade,
  histórico, resumo de limite/exposição/vencimento, exclusão lógica com bloqueio.
- **Cheques** e **Boletos**: CRUD, status, anexos, filtros, totais, alerta de divergência
  e de vencimento, geração de código automática, exclusão lógica (ADMIN).
- **Dashboard** (Etapa 1): cards, gráficos ApexCharts e listas derivados de dados reais.
- **Administração** (ADMIN): usuários e trilha de auditoria filtrável.
- **Configurações**: dados da empresa (base para recibos/relatórios futuros).
- PWA instalável, temas claro/escuro, acessibilidade AA auditada.

### Entregue na Etapa 2 ✅

- **Migração** `544a723c1e04_operations_and_receipts.py` (tabelas `operations` e
  `receipts`, vínculo `operation_id` em cheques e boletos).
- **Operações (borderô)**: CRUD, vínculo de cheques/boletos do **mesmo cliente**,
  totais sempre **derivados** dos documentos, seleção de documentos disponíveis,
  mudança de situação (ABERTA/FECHADA), histórico e exclusão lógica (ADMIN).
- **Recebimentos**: baixa **manual** (data e valor informados), parciais/totais,
  saldo em aberto comparativo, anexo comprobatório, estorno lógico (ADMIN),
  liquidação/reversão do título como consequência explícita do recebimento.
- **Recibos**: impressão institucional em `/recibos/:id/imprimir` com dados da
  empresa (`settings`) + dados reais do recebimento, sem cálculo automático.
- **Dashboard**: cards de operações/recebimentos, ganhos realizados e últimos
  recebimentos; listas e gráficos de dados reais.
- **Frontend**: telas de operações, recebimentos e recibo; navegação e permissões.
- **Testes**: `tests/test_operations.py` e `tests/test_receipts.py` (92 no total).

### Entregue na Etapa 3 ✅

- **Relatórios** (`/api/reports`, `/relatorios`): consolidação por período, cliente, tipo,
  situação, vencidos e busca livre. Títulos filtrados por `operation_date`; recebimentos
  por `receipt_date`. Totais **derivados** dos lançamentos reais, sem recálculo de juros,
  descontos ou encargos.
- **Abas**: Visão geral (gráficos de movimento mensal e composição por situação, resumos
  por tipo/situação), Clientes e limites (limite, exposição, disponível, uso percentual,
  recebido), Títulos, Operações e Recebimentos — todas com paginação local de 25 linhas.
- **Exportações**: PDF A4 paisagem (ReportLab) e planilha XLSX com abas Resumo, Clientes,
  Documentos, Operações e Recebimentos (openpyxl), baixadas por blob autenticado e
  registradas na auditoria como `EXPORT`/entidade `report`.
- **WhatsApp**: modal por cliente com títulos em aberto, total, telefone, texto editável,
  cópia para a área de transferência e link `wa.me`. **Nada é enviado automaticamente.**
- **Filtros salvos** por período/cliente (primeira versão local, evoluída na Etapa 5).
- **Dashboard completo**: movimento mensal (área), carteira por cliente, últimos
  recebimentos, além dos cards e gráficos das etapas anteriores.
- **Dependências**: `reportlab==4.2.5` e `openpyxl==3.1.5` em `requirements.txt`.
- **Testes**: `tests/test_reports.py` (relatórios, dashboard, WhatsApp, PDF e XLSX) —
  suíte total **101 passed** naquela etapa. Smoke **89/89** e fluxos **33/33**.

### Entregue na Etapa 4 ✅

- **E-mail transacional** (`app/services/email.py`): SMTP configurável por `MAIL_SERVER`,
  `MAIL_PORT`, `MAIL_USE_TLS`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_DEFAULT_SENDER` e
  `MAIL_TIMEOUT_SECONDS`; mensagem em texto puro com link `/redefinir-senha?token=...`
  montado a partir de `FRONTEND_BASE_URL`. Falha de SMTP é registrada e não altera a
  resposta genérica (não revela se o e-mail existe).
- **Token em dev**: `EXPOSE_RESET_TOKEN=true` devolve `reset_token`, `reset_url` e
  `email_sent`; em produção o token **nunca** é retornado.
- **Produção**: `create_app()` recusa iniciar sem `MAIL_SERVER` além de exigir PostgreSQL
  e secrets próprios.
- **Throttling distribuído** (`app/utils/security.py`): janela deslizante em Redis via
  sorted set quando `RATE_LIMIT_STORAGE_URL` está configurado; fallback automático para
  memória se o Redis falhar. Mesmo limite (6/300s) por e-mail + IP.
- **Verificação completa**: `scripts/verify_all.mjs` (`npm run verify`) encadeia pytest,
  build, smoke e fluxos com código de saída para CI.
- **Dependência**: `redis==5.2.1` em `requirements.txt`.
- **Testes**: `tests/test_production.py` (6) + ajustes em auth — suíte **107 passed**
  naquela etapa.

### Entregue na Etapa 5 ✅

- **Filtros de relatório por usuário no servidor**: modelo `ReportFilter` (soft delete,
  máximo 20 ativos), migração `3746194c79fe_report_filters_per_user.py`,
  `app/services/report_filters.py` (validação/canonicalização) e rotas
  `GET/POST /api/reports/filters` + `DELETE /api/reports/filters/<id>`.
  Isolamento por usuário garantido na consulta; `client_name/client_code` são apenas
  rótulos de exibição; chaves desconhecidas são descartadas.
- **Interface**: `/relatorios` carrega, salva e remove filtros pela API (substitui o
  `localStorage`); aplicar um filtro restaura período, cliente, tipo, situação, vencidos
  e busca. Área rotulada “Filtros salvos na sua conta”.
- **Code-splitting**: páginas com `React.lazy` + `Suspense` em `App.jsx`; `vite.config.js`
  separa `react-vendor` e `charts-vendor`. Bundle inicial caiu de ~580 kB para
  ~92 kB (+166 kB de React compartilhado); ApexCharts (~580 kB) só carrega em
  Dashboard/Relatórios, sem aviso de chunk grande.
- **Verificação**: fluxo de UI cobre filtro salvo (criar, listar, aplicar, remover) —
  fluxos **37/37**; suíte total **112 passed**.
- **Revisão final**: textos, acessibilidade AA, responsividade e documentação
  (`AGENTS.md`, `README.md`, `.env.example`) atualizados.

### Entregue na Etapa 6 ✅

- **Empréstimos**: modelos `Loan`/`Installment`, migração
  `269e70536ab9_loans_and_installments.py`, serviços `loans.py`/`loans_report.py`,
  blueprint `/api/loans` e `tests/test_loans.py` (9 testes). Valores emprestado,
  recebido e lucro são **informados e gravados exatamente como digitados** — nenhum
  juro, taxa ou encargo é calculado. Parcelas são uma **sugestão editável** de divisão
  do principal (quantidade, 1º vencimento e periodicidade).
- **Limite e exposição**: o saldo das parcelas `EM_ABERTO`/`DEVOLVIDO` entra na
  exposição do cliente; ultrapassar o limite é **aviso**, nunca bloqueio. A busca do
  cliente é automática pelo cadastro (`ClientSelect`).
- **Interface**: lista, formulário, detalhe e visão de impressão da duplicata em
  `/emprestimos`; estilos dedicados em `styles/emprestimos.css`. A **duplicata**
  (`/emprestimos/:id/duplicata`) apenas apresenta dados reais do cliente e da empresa
  (**não grava registro novo**) e usa quebras de página para impressão profissional.
- **Relatório de empréstimos** (`/emprestimos/relatorio`): filtros (período, cliente,
  situação e busca), cards, gráficos de valores/ganhos/quantidade (`by_month` inclui
  `received_amount`), exportações PDF/XLSX por blob autenticado, WhatsApp com texto
  editável e envio por e-mail com os filtros atuais na query string.
- **Correção visual**: selects de Tipo, Situação, Status e Ordenador por passaram a
  exibir **uma única seta**, igual aos demais campos; textos contextuais usam tokens
  AA. O smoke verifica a checagem de seta única.
- **Verificação**: `node scripts/verify_all.mjs` → pytest **121 passed**, build OK,
  smoke **101/101**, fluxos **37/37**, fluxo de empréstimos **23/23**. Novo script
  auto-limpante `scripts/browser_loans.mjs` integrado à verificação completa.
- **Documentação**: `PROGRESSO.md`, `README.md`, `backend/.env.example` e este
  `AGENTS.md` atualizados com o módulo, rotas, credenciais de teste e contagens.

### Entregue na Etapa 7 ✅

- **Relatório Geral unificado** (`/relatorios`): o mesmo relatório agora cobre
  **cheques, boletos e empréstimos**. Novo filtro `kind=EMPRESTIMO` e filtro
  `loan_status` independente de `status`; constantes `REPORT_KINDS`/`REPORT_KIND_LABELS`
  em `app/services/reports.py`. `build_report()` passou a devolver `loans`,
  `installments`, `by_loan_status` e a estender `cards`, `counts`, `by_month` (com
  `loan_amount`/`received_amount`/`profit`) e `by_kind`. WhatsApp passou a informar
  `loans_count`/`installments_count`; filtros salvos aceitam `loan_status` no payload
  canônico (`app/services/report_filters.py`).
- **Interface**: aba **Empréstimos** no Relatório Geral com cards, gráfico de
  situação, resumo por situação e tabelas de empréstimos/parcelas (linhas clicáveis);
  selects separados “Situação do título” e “Situação do empréstimo”. Nenhum valor é
  recalculado — a regra soberana continua intacta.
- **Identidade visual personalizável**: `app_name` e o logotipo passaram a fazer
  parte de `settings` (`PUT /settings/company`, `POST/DELETE /settings/company/logo`,
  ADMIN). Um único arquivo de imagem é reaproveitado como ícone do app, favicon,
  manifest PWA, logo do menu/telas e marca em **todos os PDFs, XLSX, recibos e
  duplicatas** (`app/services/branding.py` + `loans_report.py` + `reports.py`). Sem
  logo configurado, o favicon é gerado a partir da inicial do nome; `company_display_name()`
  usa o `app_name` personalizado, senão o `company_name`.
- **Endpoints públicos de branding**: `GET /api/settings/brand`, `/brand/logo`,
  `/brand/favicon` e `/brand/manifest.webmanifest` — somente leitura e sem dados
  sigilosos, necessários porque `<img>`/favicon/manifest não enviam Bearer. O frontend
  usa `BrandContext` + `useBrand()` para atualizar título, favicon, manifest, menu e
  prévia em Configurações (`refreshBrand()`).
- **Exportações com a marca do usuário**: nomes de arquivos usam o slug do nome
  personalizado via `Content-Disposition`, e downloads por blob respeitam esse nome.
  Nenhum texto “FACTOR PRO” fixo permanece nos relatórios/duplicatas.
- **Dependência**: `Pillow>=11.0.0` em `requirements.txt`.
- **Testes**: `tests/test_etapa7.py` (7 testes) — suíte **128 passed**. Build OK,
  smoke **101/101**, fluxos **37/37**, fluxo de empréstimos **23/23** via
  `node scripts/verify_all.mjs`.

### Entregue na Etapa 8 ✅

- **Excel em todas as listagens**: botão “Exportar Excel” em Clientes, Cheques,
  Boletos, Operações, Recebimentos, Empréstimos, Usuários e Auditoria. Novo blueprint
  `/api/export`, serviço `list_exports.py` (openpyxl) e componente `ExportXlsxButton`.
  Os mesmos filtros da tela são aplicados sem paginação; a planilha usa o nome/logo da
  marca, formatação de moeda/percentual, filtro automático e linha congelada. Cada
  exportação registra `EXPORT` na auditoria.
- **Backup diário**: modelo de preferências em `settings`, serviço `backup.py` com
  agendador em `threading`, SQLite via API online / PostgreSQL via `pg_dump`, ZIP com
  banco + uploads opcionais + `manifest.json`, retenção configurável e CLI
  `flask backup --now`. A aba “Backup diário” em Configurações (ADMIN) mostra status,
  permite salvar preferências, criar, baixar e remover backups. Novas variáveis
  `BACKUP_*` em `config.py` e `.env.example`.
- **Atendente virtual**: `AssistantWidget` com FAB, texto e voz (`pt-BR` via Web Speech
  API), sugestões, histórico e comandos que abrem as páginas do menu lateral. A permissão
  `microphone=(self)` foi adicionada ao `Permissions-Policy`; sem suporte a voz, o texto
  continua funcional. Rodapé atualizado para **v1.6 · Etapa 8**.
- **Situação única no Relatório Geral**: os dois selects (“Situação do título” e
  “Situação do empréstimo”) foram mesclados em um único controle “Situação”, com valores
  `doc:`/`loan:`; a API mantém `status` e `loan_status` separados, preservando filtros
  salvos e exportações.
- **Múltiplas fotos**: novo modelo `DocumentAttachment` e migração
  `a7c4e1b9d2f3_document_attachments.py`. Em Cheques, Boletos e Recebimentos o painel
  captura uma foto por vez (`capture="environment"`) e envia a fila sequencialmente;
  galeria com visualização, download e remoção por blob autenticado. O anexo legado
  continua aparecendo e os arquivos antigos seguem válidos.
- **Verificação**: `tests/test_backup.py` (6), `tests/test_photos.py` (4) e
  `tests/test_list_exports.py` (3) — suíte **141 passed**. `node scripts/verify_all.mjs`
  → build OK, smoke **101/101**, fluxos **37/37**, fluxo de empréstimos **23/23**.
  A migração `a7c4e1b9d2f3` foi aplicada no banco de desenvolvimento.

### Entregue na varredura de integração ✅

- **Identidade e PWA**: nome e logotipo configuráveis, favicon/manifest dinâmicos,
  metadados atualizados sem recarregar e compatibilidade de rotas antigas de logo.
- **Tema executivo**: fundo claro quente em marfim, superfícies claras e acento latão,
  mantendo tema escuro, tokens de contraste e responsividade.
- **Inadimplência**: alerta global no início da sessão, filtro de clientes bloqueados e
  bloqueio/desbloqueio manual com motivo obrigatório e registro de auditoria. Nenhuma
  decisão de bloqueio é tomada automaticamente.
- **Integração**: atualização das etapas 6–8 do GitHub conciliada com as alterações
  locais de branding, alertas, acessibilidade e identidade visual.

### Ajustes pós-Etapa 8 ✅

- **Operações** agora permite selecionar empréstimos disponíveis do cliente, exibir
  vínculos no detalhe e manter os totais de empréstimos separados dos títulos. Nova
  migração `2a9c6d1e4f80_link_loans_to_operations.py`, aplicada no banco local após
  criar backup SQLite.
- **Inadimplência** inclui parcelas vencidas de empréstimos; o atalho “Ver clientes”
  aplica o filtro de atraso e os lembretes abrem mensagem de WhatsApp ou rascunho de
  e-mail para revisão e confirmação manual.
- **Relatório Geral** inicia com o primeiro dia do mês atual até hoje. A homepage
  oferece alternância claro/escuro respeitando a preferência persistida do usuário.
- **Formulário de empréstimo** oculta o lucro por padrão, oferece cadastro contextual
  de cliente com retorno e preservação do rascunho, além de uma promissória para impressão
  em página única, sem textos complementares de minuta ou conferência.
- **Validação desta entrega**: 161 testes backend, build, smoke 119/119, fluxos 37/37 e
  empréstimos 33/33, estes três últimos executados contra base descartável isolada.

### Pendências conhecidas / observações

- O envio real de e-mail **não foi testado contra um provedor SMTP externo** (sem
  credenciais no ambiente); a construção da mensagem, o caminho de envio e a tolerância
  a falhas estão cobertos por testes.
- Redis **não está em execução** localmente; o caminho Redis é exercitado por testes com
  um cliente simulado e o fallback em memória é o padrão em dev.
- Repositório publicado no GitHub: `https://github.com/cspsistemasdigital-fish/CSP-FACTOR-PRO`
  (branch `main`). A Etapa 7 (`2bf6bf1`) e a Etapa 8 (`a349770`) já foram **enviadas**
  ao `origin/main`. O push usa Git Credential Manager; a conta `ClaudionorPeixinho`
  não tem escrita no repositório — é preciso autenticar como
  `cspsistemasdigital-fish` (`git credential-manager github login --force --username
cspsistemasdigital-fish`).
- Sem linter/formatter configurado no frontend (`npm run lint` é um placeholder).
- WhatsApp: o sistema apenas **gera o texto revisável** e abre o `wa.me` — não há
  disparo automático nem armazenamento de conversas (decisão intencional).
- Filtros salvos: limite de 20 por usuário, sem compartilhamento entre usuários e sem
  auditoria dedicada (a remoção é lógica). Não há agendamento de envio de relatórios.
- Empréstimos: o e-mail do relatório usa o mesmo SMTP (também não testado com provedor
  externo); sem `MAIL_SERVER` a API responde `email_sent: false` com o texto para
  conferência. A duplicata é apenas para impressão — não gera PDF no servidor nem
  grava registro, e o navegador é responsável pela impressão/PDF.
- A implantação em PostgreSQL/Alembic foi validada apenas no SQLite de desenvolvimento;
  rodar `flask db upgrade` no banco de produção antes do primeiro acesso
  (inclui `269e70536ab9_loans_and_installments.py` e
  `a7c4e1b9d2f3_document_attachments.py`, `1f4b8c2d9a30_shared_agenda_events.py` e
  `2a9c6d1e4f80_link_loans_to_operations.py`). A Etapa 7 não criou migração: `app_name`
  e logo são chaves da tabela `settings` já existente.
- Branding: o logo enviado vira favicon e ícone “any” do manifest; os ícones fixos
  `192/512` e `maskable` permanecem os do tema para garantir a instalação do PWA.
  Não há auditoria dedicada para troca de logo (o upload/remoção registra `UPDATE` em
  `settings`, como as demais configurações).
- Backup: o caminho SQLite e o agendador são exercitados por testes; `pg_dump` e a
  **restauração completa** ainda não foram validados contra PostgreSQL real nem com
  um teste de restore ponta a ponta. Em instâncias múltiplas, cada processo executa
  seu próprio agendador — use um único nó com `BACKUP_SCHEDULER_ENABLED=true`.
- Atendente virtual: o reconhecimento de voz depende de Chrome/Edge e da permissão de
  microfone, e não é coberto pelos scripts headless; o comando por texto e a navegação
  pelas rotas do menu seguem o mesmo código e foram verificados na interface.
- Múltiplas fotos: a captura real pela câmera (`capture="environment"`) depende do
  dispositivo e não é exercitada pelos testes; o upload sequencial, a galeria protegida,
  o isolamento por documento e o soft delete são cobertos por `tests/test_photos.py`.
- Excel das listagens: as rotas, permissões e o conteúdo do XLSX são validados por
  `tests/test_list_exports.py`; o smoke atual também cobre a homepage e os controles da Agenda.

### Próximos passos recomendados (melhorias futuras, mediante autorização)

1. **Validar SMTP real** com um provedor transacional (SPF/DKIM, bounce handling) e
   testar em produção tanto a recuperação de senha quanto o envio do relatório de
   empréstimos.
2. **Redis gerenciado** em produção multi-instância (throttling e, se necessário,
   sessões/refresh tokens compartilhados).
3. **CI** executando `scripts/verify_all.mjs` (pytest + build + smoke + fluxos +
   empréstimos) com relatório de acessibilidade.
4. **Agendamento de relatórios** por e-mail (envio periódico dos filtros salvos e do
   relatório de empréstimos).
5. **Compartilhamento de filtros** entre usuários ou por equipe, com auditoria.
6. **Code-splitting adicional** por componente e compressão Brotli/CDN, se o volume
   de usuários justificar.
7. **PDF da duplicata no servidor** (ReportLab), se houver necessidade de download
   além da impressão pelo navegador — decisão atual é não gravar nada.
8. **Teste de restauração** periódico do ZIP (SQLite e `pg_dump`) em ambiente de
   staging, com check de integridade e registro do resultado.
9. **Checagens de UI para a Etapa 8** no smoke/fluxos (botões de Excel, aba de backup,
   assistente por texto e fila de fotos), hoje cobertos apenas por testes de API.
10. **Agendador de backup externo** (cron/Kubernetes CronJob) se a operação migrar
    para múltiplas instâncias, evitando backups duplicados por processo.

---

## 11. Regras de ouro (não violar)

1. **Nunca** calcular juros, descontos, taxas ou encargos automaticamente.
2. **Nunca** inventar dados: módulos não construídos mostram `PendingModule`.
3. **Nunca** exclusão física: sempre soft delete + auditoria.
4. **Nunca** versionar `.env`, `instance/`, `node_modules/`, `dist/` ou `__pycache__/`.
5. **Nunca** guardar o access token em localStorage.
6. **Nunca** iniciar novas etapas ou módulos sem autorização explícita.
7. Manter consistência de estilo, tokens de cor e o padrão de resposta da API.
8. Ao final de cada etapa: apresentar o que foi construído, arquivos, testes,
   pendências e o próximo passo recomendado — e **atualizar este AGENTS.md**.
