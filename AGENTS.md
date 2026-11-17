# FACTOR PRO — Memória Técnica do Projeto

> **Leia este arquivo no início de cada sessão e atualize-o ao final de cada etapa.**
> Ele é a fonte de verdade sobre arquitetura, regras de negócio, convenções, comandos
> e pendências do FACTOR PRO — Gestão Financeira Inteligente.

Última atualização: **Etapas 4 e 5 concluídas** (produção: e-mail de recuperação, throttling com Redis e verificação completa; experiência: filtros de relatório por usuário, code-splitting e revisão final). Escopo de cinco etapas finalizado.

---

## 1. Visão geral

Sistema profissional de gestão de factoring. As **cinco etapas** do escopo estão concluídas.

| Etapa | Escopo | Situação |
|-------|--------|----------|
| **1** | Estrutura, banco de dados, autenticação, **Clientes**, **Cheques**, **Boletos** | ✅ Concluída |
| **2** | **Operações**, **Recebimentos**, limites aplicados, recibos | ✅ Concluída |
| **3** | Dashboard completo, **Relatórios**, exportações (PDF/planilha), WhatsApp | ✅ Concluída |
| **4** | Produção: e-mail de recuperação, throttling com Redis, verificação completa | ✅ Concluída |
| **5** | Experiência: filtros de relatório por usuário, code-splitting, revisão final | ✅ Concluída |

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
  (soma de `net_amount` com status `EM_ABERTO`/`DEVOLVIDO`). É derivado, não armazenado.
  Ultrapassar o limite é **aviso**, não bloqueio.

---

## 2. Stack e estrutura

### Stack obrigatória
- **Backend**: Python + Flask + SQLAlchemy + Flask-Migrate + Flask-JWT-Extended + Flask-Cors.
- **Exportações**: ReportLab (PDF A4 paisagem) + openpyxl (planilha com 5 abas).
- **Frontend**: React (JS) + Bootstrap 5 + ApexCharts + React Router + Axios (PWA).
- **Banco**: PostgreSQL em produção. **SQLite apenas em desenvolvimento/testes.**

### Árvore do repositório

```
FACTOR PRO/
├── AGENTS.md                  ← este arquivo (memória técnica)
├── README.md                  ← como instalar e rodar
├── .gitignore
├── backend/
│   ├── app/
│   │   ├── __init__.py        ← app factory, error handlers, headers, SPA fallback
│   │   ├── config.py          ← Config/Development/Testing/Production
│   │   ├── extensions.py      ← db, migrate, jwt, cors
│   │   ├── cli.py             ← seed, seed-demo, reset-admin-password, create-db
│   │   ├── api/               ← blueprints REST
│   │   │   ├── auth.py  users.py  clients.py  cheques.py  boletos.py
│   │   │   ├── operations.py  receipts.py  reports.py
│   │   │   ├── dashboard.py  settings.py  documents_utils.py
│   │   ├── models/            ← user, client, cheque, boleto, operation, receipt, document, audit, setting, reset_token, report_filter, base
│   │   ├── services/          ← regras de negócio: clients, documents, operations, receipts, reports, report_filters, dashboard, audit, email
│   │   └── utils/             ← validators, responses, security (throttling), files
│   ├── migrations/versions/   ← c9dc603b0320_initial_schema.py + 544a723c1e04_operations_and_receipts.py + 3746194c79fe_report_filters_per_user.py
│   ├── tests/                 ← pytest (auth, clients, documents, operations, receipts, reports, report_filters, dashboard, users, production)
│   ├── instance/              ← factorpro.db + uploads/ (NÃO versionar)
│   ├── requirements.txt  wsgi.py  .flaskenv  .env.example
├── frontend/
│   ├── src/
│   │   ├── App.jsx            ← árvore de rotas + guardas (páginas com React.lazy)
│   │   ├── main.jsx  styles/app.css
│   │   ├── api/               ← client.js (axios + refresh), index.js (endpoints)
│   │   ├── context/           ← AuthContext, ThemeContext, ToastContext
│   │   ├── hooks/             ← useDebouncedValue, useInstallPrompt
│   │   ├── components/        ← layout/, ui/, form/, documents/, Logo.jsx
│   │   ├── pages/             ← auth/, clients/, cheques/, boletos/, operacoes/, recebimentos/, recibos/, relatorios/, Dashboard, Settings, Admin
│   │   └── utils/format.js
│   ├── public/                ← manifest.webmanifest, sw.js, favicon.svg, icons/
│   ├── dist/                  ← build servido pelo Flask (single deployment)
│   ├── package.json  vite.config.js  index.html
└── scripts/
    ├── lib/cdp.mjs            ← cliente Chrome DevTools Protocol (sem dependências)
    ├── browser_smoke.mjs      ← smoke + auditoria de acessibilidade (89 checagens)
    ├── browser_flows.mjs      ← teste funcional de ponta a ponta (37 checagens)
    ├── verify_all.mjs         ← pytest + build + smoke + fluxos (código de saída para CI)
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

# Testes (112 testes)
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
npm run verify   # pytest + build + smoke + fluxos (backend precisa estar no ar)
```

### Verificação de interface (headless Chrome via CDP)

Requer backend no ar em `http://127.0.0.1:5000`, Chrome em
`C:\Program Files\Google\Chrome\Application\chrome.exe` e Node v22 (WebSocket global).

```powershell
node scripts/browser_smoke.mjs   # 89/89 — telas, temas, responsivo, acessibilidade
node scripts/browser_flows.mjs   # 37/37 — CRUD real, divergência, auditoria, relatórios, filtros salvos e exportações
```

Ambos são **auto-limpantes**: os fluxos criam e removem os próprios dados
(marcador `FLUXO-UI-TESTE`, cliente `Cliente Teste Fluxo UI`), removem o filtro de
relatório salvo usado no teste e **restauram** o estado de primeiro acesso do
administrador ao final. São reexecutáveis.
Screenshots em `scripts/screenshots/`; saída em `scripts/*-output.txt`.

`node scripts/verify_all.mjs` (ou `npm run verify` em `frontend/`) encadeia
**pytest → build → smoke → fluxos** e retorna código de saída adequado para CI.

---

## 4. Configuração e ambiente

Variáveis em `backend/.env` (copiar de `.env.example`; **nunca versionar** `.env`):

| Variável | Padrão dev | Observação |
|----------|-----------|------------|
| `FLASK_ENV` | `development` | `production` exige PostgreSQL + secrets próprios |
| `SECRET_KEY` / `JWT_SECRET_KEY` | inseguros | obrigatórios fortes em produção |
| `DATABASE_URL` | `sqlite:///instance/factorpro.db` | produção: `postgresql+psycopg2://...` |
| `JWT_ACCESS_TOKEN_MINUTES` / `JWT_REFRESH_TOKEN_DAYS` | 120 / 7 | |
| `UPLOAD_FOLDER` / `MAX_UPLOAD_MB` | `instance/uploads` / 10 | extensões: pdf, png, jpg, jpeg, webp |
| `ADMIN_NAME/EMAIL/PASSWORD` | Administrador / admin@factorpro.com.br / Admin@12345 | criados por `flask seed` |
| `EXPOSE_RESET_TOKEN` | `true` (dev) | em produção o token **não** é retornado |
| `FRONTEND_BASE_URL` | `http://127.0.0.1:5000` | base do link de recuperação (`/redefinir-senha?token=...`) |
| `MAIL_SERVER` / `MAIL_PORT` / `MAIL_USE_TLS` | vazio / 587 / true | **obrigatório em produção**; sem ele nenhum e-mail é enviado |
| `MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_DEFAULT_SENDER` | vazio / vazio / FACTOR PRO `<no-reply@…>` | credenciais SMTP e remetente |
| `MAIL_TIMEOUT_SECONDS` | 10 | tempo máximo de conexão SMTP |
| `RATE_LIMIT_STORAGE_URL` | vazio (memória) | `redis://…` para throttling compartilhado entre instâncias |

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

### Credenciais de desenvolvimento
- **Administrador**: `admin@factorpro.com.br` / `Admin@12345`
- O administrador semeado nasce com `must_change_password = True` → o primeiro login no
  navegador redireciona para `/trocar-senha` (comportamento intencional).

---

## 5. Modelo de dados

Todas as tabelas de domínio têm `TimestampMixin` (created/updated + `created_by_id`/
`updated_by_id`) e as entidades de negócio têm `SoftDeleteMixin` (`is_deleted`,
`deleted_at`, `deleted_by_id`). **Exclusão é sempre lógica; nunca física.**

| Tabela | Campos-chave |
|--------|--------------|
| `users` | name, email (único), password_hash, role, is_active, must_change_password, last_login_at |
| `clients` | code (`CLI-0001`), name, person_type (PF/PJ), document (normalizado), contatos/endereço, registered_at, operational_limit, status (ATIVO/INATIVO) |
| `cheques` | code (`CHQ-00001`), number, bank, agency, account, identifier, client_id, issuer_document/name, nominal_amount, discount_amount, interest_amount, other_expenses, **net_amount**, applied_limit, issue/due/operation_date, status, attachment_* |
| `boletos` | code (`BOL-00001`), identifier, barcode, bank, client_id, beneficiary_document/name, original_amount, discount_amount, other_expenses, **net_amount**, applied_limit, issue/due/operation_date, status, **operation_id**, attachment_* |
| `operations` | code (`OPR-00001`), client_id, operation_date, description, status (ABERTA/FECHADA), notes — totais **derivados** dos documentos vinculados |
| `receipts` | code (`REC-00001`), document_kind (CHEQUE/BOLETO), document_id, client_id, receipt_date, amount, notes, attachment_* — baixa **manual** e auditada |
| `audit_logs` | user_id/user_email, action, entity, entity_id, description, changes (JSON), ip_address, created_at |
| `settings` | key/value (dados da empresa) |
| `password_reset_tokens` | user_id, token_hash, expires_at, used_at |
| `report_filters` | user_id, name, filters (JSON canônico), timestamps + **soft delete** — preferência **pessoal** do usuário (máx. 20 ativos) |

### Enums
- **Role**: `ADMIN` (Administrador), `OPERATOR` (Operador), `VIEWER` (Consultor/Visualizador).
- **ClientStatus**: `ATIVO`, `INATIVO`.
- **DocumentStatus**: `EM_ABERTO`, `LIQUIDADO`, `DEVOLVIDO`, `CANCELADO`
  (`PENDING = (EM_ABERTO, DEVOLVIDO)` = ainda representa valor devido).
- **OperationStatus**: `ABERTA`, `FECHADA`.
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
`GET /api/health` é público.

| Recurso | Rotas |
|---------|-------|
| **auth** | `POST /login` `POST /refresh` `POST /logout` `GET /me` `POST /change-password` `POST /forgot-password` `POST /reset-password` |
| **users** (ADMIN) | `GET/POST /` `PUT /<id>` `POST /<id>/reset-password` `GET /audit-logs` (filtros: entity, action, user_id, search, date_from, date_to) |
| **clients** | `GET /` (search, status, page, per_page) `GET /options` `GET /<id>` `GET /<id>/history` `POST /` `PUT /<id>` `DELETE /<id>` (ADMIN) |
| **cheques** | `GET /` `GET /banks` `GET /<id>` `POST /` `PUT /<id>` `PATCH /<id>/status` `DELETE /<id>` (ADMIN) + `POST/GET/DELETE /<id>/attachment` |
| **boletos** | idem cheques |
| **operations** | `GET /` `GET /available-documents?client_id=` `GET /<id>` `POST /` `PUT /<id>` `PATCH /<id>/status` `DELETE /<id>` (ADMIN) |
| **receipts** | `GET /` `GET /open-documents` `GET /<id>` `GET /<id>/recibo` `POST /` `PUT /<id>` `DELETE /<id>` (estorno, ADMIN) + `POST/GET/DELETE /<id>/attachment` |
| **reports** | `GET /summary` `GET /whatsapp?client_id=` `GET /export/pdf` `GET /export/xlsx` (filtros: date_from, date_to, client_id, kind, status, overdue, search) · `GET /filters` `POST /filters` `DELETE /filters/<id>` (filtros salvos do próprio usuário) |
| **dashboard** | `GET /summary` (filtros: date_from, date_to, client_id) |
| **settings** | `GET /company` (todos) `PUT /company` (ADMIN) |

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
  documents: [{kind: CHEQUE|BOLETO, id}]`. Só aceita documentos do **mesmo cliente**,
  não excluídos, não cancelados e ainda sem outra operação.
- Chaves de recebimento: `document_kind, document_id, receipt_date, amount, notes`.
  A baixa é **manual**; o valor é gravado exatamente como informado (aviso se exceder
  o saldo). Ao atingir o líquido, o título vira `LIQUIDADO`; o estorno reverte.
- **Relatórios**: filtros `date_from, date_to, client_id, kind, status, overdue, search`.
  Títulos são filtrados por `operation_date`; recebimentos por `receipt_date`.
  A resposta de `/summary` traz `cards, by_kind, by_status, by_month, clients,
  documents, operations, receipts, counts, filters, period_label, generated_at`.
  `/whatsapp` devolve `{item:{client, company, message, phone, url, documents_count,
  total, documents}}` com texto **editável** (nada é enviado automaticamente).
  Exportações registram `AuditAction.EXPORT` com entidade `report`.
- **Filtros salvos**: `POST /reports/filters` recebe `{name, filters:{date_from,
  date_to, client_id, client_name, client_code, kind, status, overdue, search}}`;
  o servidor valida e **canonicaliza** (descarta chaves desconhecidas, `client_name/code`
  são apenas rótulos de exibição). Máximo de **20** filtros ativos por usuário.
  `GET` devolve `{items}`; `DELETE` faz exclusão **lógica** e responde `{message}`.

---

## 7. Autenticação e segurança

- **Access token em memória** (nunca em localStorage) + **refresh cookie httpOnly**
  (`/api/auth`, `SameSite=Lax` dev / `Strict` prod, `Secure` em prod).
- `client.js`: intercepta 401, renova via `/auth/refresh` (fila única) e repete a chamada;
  `bootstrapSession()` restaura a sessão silenciosamente ao carregar o app.
- CSRF **não** se aplica: autenticação por header `Bearer` (cookie CSRF desabilitado).
- Cabeçalhos de segurança em todas as respostas: `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`; `/api/*` com `no-store`.
- Anexos acessados por **blob autenticado** (não há URL pública de arquivo).

### Papéis e permissões
| Ação | ADMIN | OPERATOR | VIEWER |
|------|:---:|:---:|:---:|
| Ver tudo | ✅ | ✅ | ✅ |
| Criar/editar clientes, cheques, boletos, operações e recebimentos; alterar status | ✅ | ✅ | ❌ |
| Excluir clientes/documentos/operações e estornar recebimentos (lógica) | ✅ | ❌ | ❌ |
| Exportar relatórios (PDF/planilha) e gerar mensagem de WhatsApp | ✅ | ✅ | ✅ |
| Salvar/remover **os próprios** filtros de relatório | ✅ | ✅ | ✅ |
| Administração (usuários + auditoria) | ✅ | ❌ | ❌ |
| Configurações da empresa (editar) | ✅ | ❌ | ❌ |

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
  verde-escuro `#123D32`, verde `#16845B`, verde-claro `#DDF4E8`,
  azul-petróleo `#173B57`, fundo claro `#F4F7F6`, fundo escuro `#101B1A`.
  Temas **claro/escuro** com preferência salva; sidebar recolhível; responsivo.
- **Contraste WCAG AA** garantido por tokens de texto dedicados: `--fp-green-text`,
  `--fp-petroleum-text`, `--fp-danger-text`, `--fp-warning-text` e `--tone-text`
  (por tom de card/toast). Manter ao adicionar novas cores de texto.
- **Listas**: filtros e paginação nos **search params da URL** (compartilhável/voltar).
- **Dashboard**: filtros em rascunho com botão **Aplicar** (presets aplicam na hora).
- **Relatórios** (`/relatorios`): filtros em rascunho com **Aplicar**, presets de período,
  5 abas (Visão geral, Clientes e limites, Títulos, Operações, Recebimentos), paginação
  local de 25 linhas, exportação por **blob autenticado** e modal de WhatsApp por cliente.
  **Filtros salvos** ficam na conta do usuário (API `/reports/filters`, até 20),
  disponíveis em qualquer dispositivo; o rótulo da área é “Filtros salvos na sua conta”.
  Tabelas usam `.report-table` dentro de `.fp-table-wrap`.
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
  Service worker registrado **apenas em produção**.

---

## 9. Testes e verificação

| Suíte | Comando | Resultado atual |
|-------|---------|-----------------|
| Backend (pytest) | `cd backend; .\.venv\Scripts\python.exe -m pytest -q` | **112 passed** |
| Smoke UI + acessibilidade | `node scripts/browser_smoke.mjs` | **89/89** |
| Fluxos funcionais UI | `node scripts/browser_flows.mjs` | **37/37** |
| Verificação completa | `node scripts/verify_all.mjs` | pytest → build → smoke → fluxos |

O smoke cobre: todas as telas (claro/escuro/mobile), overflow horizontal, texto cortado,
alvos de toque, contraste AA, tema persistente, 404, logout/login, sem erros de console,
além das telas de operações, recebimentos e relatórios (5 abas e resumo derivado).
Os fluxos cobrem: login + troca obrigatória, cadastro/edição de cliente, CPF/CNPJ
duplicado (422), cheque com divergência, boleto coerente, exclusão bloqueada, mudança de
status, exclusão lógica, **auditoria conferida via API**, relatório consolidado,
exportações PDF/planilha, registro `EXPORT` na auditoria, **filtro de relatório salvo**
(criação, listagem na interface, aplicação e remoção).
Os testes de backend incluem e-mail de recuperação (conteúdo, envio, falha de SMTP),
throttling com Redis (janela deslizante, fallback), exigência de `MAIL_SERVER` em
produção e CRUD/limite/isolamento dos filtros salvos por usuário.

> Os 422 **intencionais** (duplicidade e exclusão bloqueada) são erros esperados no
> console do navegador e já são ignorados pelo `browser_flows.mjs`.

O modelo de IA **não enxerga imagens**: a verificação visual é feita por asserções de
DOM/estilo computado; os screenshots ficam para conferência humana.

---

## 10. Estado atual, pendências e próximos passos

**Todas as cinco etapas planejadas estão entregues e verificadas.** O sistema roda em
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

### Pendências conhecidas / observações
- O envio real de e-mail **não foi testado contra um provedor SMTP externo** (sem
  credenciais no ambiente); a construção da mensagem, o caminho de envio e a tolerância
  a falhas estão cobertos por testes.
- Redis **não está em execução** localmente; o caminho Redis é exercitado por testes com
  um cliente simulado e o fallback em memória é o padrão em dev.
- Repositório Git **local** já iniciado (commit `em andamento`, sem remote); as alterações
  desta etapa estão no working tree, prontas para revisão/commit.
- Sem linter/formatter configurado no frontend (`npm run lint` é um placeholder).
- WhatsApp: o sistema apenas **gera o texto revisável** e abre o `wa.me` — não há
  disparo automático nem armazenamento de conversas (decisão intencional).
- Filtros salvos: limite de 20 por usuário, sem compartilhamento entre usuários e sem
  auditoria dedicada (a remoção é lógica). Não há agendamento de envio de relatórios.
- A implantação em PostgreSQL/Alembic foi validada apenas no SQLite de desenvolvimento;
  rodar `flask db upgrade` no banco de produção antes do primeiro acesso.

### Próximos passos recomendados (melhorias futuras, mediante autorização)
1. **Validar SMTP real** com um provedor transacional (SPF/DKIM, bounce handling) e
   testar o fluxo completo de recuperação em produção.
2. **Redis gerenciado** em produção multi-instância (throttling e, se necessário,
   sessões/refresh tokens compartilhados).
3. **CI** executando `scripts/verify_all.mjs` (pytest + build + smoke + fluxos) com
   relatório de acessibilidade.
4. **Agendamento de relatórios** por e-mail (envio periódico dos filtros salvos).
5. **Compartilhamento de filtros** entre usuários ou por equipe, com auditoria.
6. **Code-splitting adicional** por componente e compressão Brotli/CDN, se o volume
   de usuários justificar.

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
