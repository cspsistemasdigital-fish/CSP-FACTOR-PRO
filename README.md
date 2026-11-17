# FACTOR PRO — Gestão Financeira Inteligente

Sistema profissional de gestão de **factoring**: cadastro de clientes, cheques,
boletos e **empréstimos com parcelas**, com controle de limites, alertas de
vencimento e divergência de valores, auditoria completa e interface PWA responsiva
(temas claro e escuro).

> **Regra soberana:** o sistema **nunca** calcula juros, descontos, taxas ou encargos.
> Todo valor é informado pelo usuário e gravado exatamente como digitado. O sistema
> apenas **compara** valores e exibe **alertas** (divergência, vencimento, limite).

Este repositório entrega as **sete etapas** do escopo: estrutura, banco,
autenticação, clientes, cheques e boletos (Etapa 1); operações, recebimentos e recibos
(Etapa 2); relatórios, exportações PDF/planilha, WhatsApp e dashboard completo (Etapa 3);
produção com e-mail de recuperação e throttling distribuído (Etapa 4); filtros de
relatório por usuário e carregamento otimizado do SPA (Etapa 5); **módulo de
empréstimos** com parcelas editáveis, exposição do cliente, relatório dedicado,
duplicata para impressão e correção das setas dos selects (Etapa 6); e **Relatório
Geral unificado** (cheques, boletos e empréstimos) com **identidade visual
personalizável** — nome e logo do aplicativo em todas as exportações (Etapa 7).

---

## Stack

- **Backend:** Python 3 · Flask · SQLAlchemy · Flask-Migrate · Flask-JWT-Extended · Flask-Cors
- **Exportações:** ReportLab (PDF) · openpyxl (planilha XLSX) · Pillow (ícones PWA do logo)
- **Frontend:** React · Bootstrap 5 · ApexCharts · React Router · Axios · PWA
- **Banco:** PostgreSQL em produção · SQLite apenas em desenvolvimento/testes

---

## Requisitos

- Python 3.11+
- Node.js 20+ (recomendado 22)
- PostgreSQL (apenas para produção)

---

## Como rodar (desenvolvimento)

### 1. Backend

```powershell
cd backend

# Ambiente virtual + dependências
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

# Configuração (copie e ajuste se necessário)
Copy-Item .env.example .env

# Banco + administrador + dados de demonstração (opcional)
.\.venv\Scripts\flask.exe seed
.\.venv\Scripts\flask.exe seed-demo    # opcional: dados [DEMO]

# Subir o servidor (serve também o SPA compilado, se existir)
.\.venv\Scripts\flask.exe run --port 5000
```

### 2. Frontend

```powershell
cd frontend
npm install

# Modo desenvolvimento (proxy /api -> 127.0.0.1:5000)
npm run dev            # http://localhost:5173

# Build de produção (gerado em dist/, servido pelo Flask)
npm run build
```

### 3. Acesso

- URL: <http://127.0.0.1:5000> (ou <http://localhost:5173> em modo dev)
- **Administrador:** `admin@factorpro.com.br` / `Admin@12345`
- No primeiro acesso o sistema **exige a troca da senha** (comportamento intencional).

---

## Empréstimos (Etapa 6)

- Menu **Financeiro → Empréstimos** e **Rel. Empréstimos**.
- Cadastro com busca do cliente pelo próprio cadastro, limite/exposição projetados,
  valor emprestado, valor recebido e **lucro informado** (nunca calculado).
- Parcelas e vencimentos gerados por quantidade/1º vencimento/periodicidade e
  **editáveis um a um** antes de salvar; situação de cada parcela alterável depois.
- O saldo em parcelas em aberto entra na **exposição do cliente**; estourar o limite
  apenas avisa.
- Relatório com cards, gráficos, abas (Visão geral, Clientes e limites, Empréstimos,
  Parcelas), filtros, exportações **PDF/XLSX**, mensagem de **WhatsApp** editável,
  **e-mail** com filtros aplicados e visão de **impressão profissional** com quebras
  de página.
- **Duplicata** em `/emprestimos/:id/duplicata`: documento para impressão com dados
  do cliente e da empresa, sem criar registro novo.
- API: `/api/loans` (CRUD, status e parcelas), `/api/loans/report/summary`,
  `/api/loans/report/export/pdf|xlsx`, `/api/loans/report/whatsapp`,
  `/api/loans/report/email` e `/api/loans/<id>/duplicata`.

---

## Relatório Geral e sua marca (Etapa 7)

- Menu **Relatórios → Relatório Geral**: uma única tela para analisar **cheques,
  boletos e empréstimos**. Filtre por período, cliente, tipo (`CHEQUE`, `BOLETO`,
  `EMPRESTIMO`), **situação do título** e **situação do empréstimo** (controles
  separados), vencidos e busca livre.
- Abas: **Visão geral**, **Clientes e limites**, **Títulos**, **Empréstimos**,
  **Operações** e **Recebimentos**. A aba Empréstimos reúne cards, gráfico e resumo
  por situação, tabela de empréstimos e tabela de parcelas (clique numa linha para
  abrir o detalhe). Nenhum valor é recalculado.
- Filtros salvos ficam na conta do usuário, com `loan_status` incluído; os filtros
  também podem ser enviados por e-mail/WhatsApp com texto revisável.
- **Sua marca no sistema**: em **Configurações** (ADMIN) informe o **nome do
  aplicativo** e envie/remova o **logotipo** (PNG, JPG, JPEG ou WEBP). O mesmo arquivo
  é usado como ícone do app, favicon, manifest PWA, logo do menu/telas e marca de
  **todos os PDFs, XLSX, recibos e duplicatas** — inclusive no nome dos arquivos
  baixados. Sem logo, o favicon é gerado a partir da inicial do nome.
- API: `PUT /api/settings/company` (`app_name`), `POST/DELETE /api/settings/company/logo`
  (ADMIN) e, para o navegador, `GET /api/settings/brand`,
  `/api/settings/brand/logo`, `/api/settings/brand/favicon` e
  `/api/settings/brand/manifest.webmanifest` (públicos e somente leitura — `<img>`,
  favicon e manifest não enviam Bearer).

---

## Testes

```powershell
# Backend — 128 testes
cd backend; .\.venv\Scripts\python.exe -m pytest -q

# Interface — smoke + acessibilidade (101), fluxos (37) e empréstimos (23)
# Requer o backend no ar em http://127.0.0.1:5000 e o Chrome instalado.
node scripts/browser_smoke.mjs
node scripts/browser_flows.mjs
node scripts/browser_loans.mjs

# Tudo de uma vez: pytest + build + smoke + fluxos + empréstimos
node scripts/verify_all.mjs
```

Os scripts de interface são auto-limpantes e restauram o estado de primeiro acesso do
administrador ao final. Screenshots em `scripts/screenshots/`.

---

## Estrutura

```
backend/    API Flask (app factory, blueprints, models, services, migrations, tests)
frontend/   SPA React (pages, components, contexts, PWA) + build em dist/
scripts/    Verificação headless (CDP): smoke, fluxos, empréstimos e ícones
AGENTS.md   Memória técnica do projeto (leia antes de contribuir)
```

---

## Produção (resumo)

1. Configure `backend/.env` com `FLASK_ENV=production`, `DATABASE_URL` PostgreSQL,
   `SECRET_KEY`/`JWT_SECRET_KEY` fortes, `FRONTEND_BASE_URL` público e o SMTP
   (`MAIL_SERVER`, `MAIL_PORT`, `MAIL_USE_TLS`, `MAIL_USERNAME`, `MAIL_PASSWORD`,
   `MAIL_DEFAULT_SENDER`) para a recuperação de senha e o envio do relatório de
   empréstimos por e-mail.
2. Opcional: `RATE_LIMIT_STORAGE_URL=redis://...` para throttling de login compartilhado
   entre instâncias (sem Redis, usa memória com fallback automático).
3. `flask db upgrade` para aplicar as migrações.
4. `flask seed` para criar o administrador inicial.
5. `npm run build` no frontend (o Flask serve `frontend/dist`).
6. Sirva com um WSGI server (waitress/gunicorn) atrás de HTTPS.

Em produção o app **recusa** iniciar com SQLite, com secrets de desenvolvimento ou
sem `MAIL_SERVER`. Defina `EXPOSE_RESET_TOKEN=false` (padrão em produção).

---

## Licença

Projeto privado. Todos os direitos reservados.
