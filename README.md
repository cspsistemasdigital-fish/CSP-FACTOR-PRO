# FACTOR PRO — Gestão Financeira Inteligente

Sistema profissional de gestão de **factoring**: cadastro de clientes, cheques e
boletos, com controle de limites, alertas de vencimento e divergência de valores,
auditoria completa e interface PWA responsiva (temas claro e escuro).

> **Regra soberana:** o sistema **nunca** calcula juros, descontos, taxas ou encargos.
> Todo valor é informado pelo usuário e gravado exatamente como digitado. O sistema
> apenas **compara** valores e exibe **alertas** (divergência, vencimento, limite).

Este repositório entrega as **cinco etapas** do escopo: estrutura, banco,
autenticação, clientes, cheques e boletos (Etapa 1); operações, recebimentos e recibos
(Etapa 2); relatórios, exportações PDF/planilha, WhatsApp e dashboard completo (Etapa 3);
produção com e-mail de recuperação e throttling distribuído (Etapa 4); filtros de
relatório por usuário e carregamento otimizado do SPA (Etapa 5). A varredura final
acrescentou **identidade configurável** (nome/logo da empresa no app e no PWA), **tema claro
marfim/executivo**, **alerta de inadimplentes na abertura** e **bloqueio manual e auditado**
de clientes com títulos vencidos.

---

## Stack

- **Backend:** Python 3 · Flask · SQLAlchemy · Flask-Migrate · Flask-JWT-Extended · Flask-Cors
- **Exportações:** ReportLab (PDF) · openpyxl (planilha XLSX)
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
.\.venv\Scripts\flask.exe db upgrade   # aplica todas as migrações (inclui bloqueio/brand)
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

### Identidade, tema e inadimplência

- Administradores: **Configurações → Dados da empresa → Identidade do aplicativo** para trocar o
  **nome exibido** e enviar/remover o **logotipo** (PNG/JPEG/WebP, até 10 MB). O nome institucional
  continua em **Razão social** para recibos, relatórios e mensagens.
- O nome/logo aparecem no login, no menu, no título da aba e no aplicativo instalado (PWA).
  O manifesto é dinâmico: o service worker nunca guarda `/manifest.webmanifest` nem `/brand/logo` em cache.
- Tema claro marfim/papel com acento latão e verde profundo; o tema escuro permanece disponível.
- Ao abrir o app, um banner (e um aviso único) resume clientes com títulos vencidos. O sistema
  **informa** a inadimplência; em **Clientes**, o responsável decide bloquear manualmente o cliente
  (motivo obrigatório e auditoria). Bloqueados não recebem novos cheques/boletos/operações, mas ainda
  podem quitar dívidas e ter títulos existentes editados.

---

## Testes

```powershell
# Backend — 124 testes
cd backend; .\.venv\Scripts\python.exe -m pytest -q

# Interface — smoke + acessibilidade (89 checagens) e fluxos (37 checagens)
# Requer o backend no ar em http://127.0.0.1:5000 e o Chrome instalado.
node scripts/browser_smoke.mjs
node scripts/browser_flows.mjs

# Tudo de uma vez: pytest + build + smoke + fluxos
node scripts/verify_all.mjs
```

Os scripts de interface são auto-limpantes e restauram o estado de primeiro acesso do
administrador ao final. Screenshots em `scripts/screenshots/`.

---

## Estrutura

```
backend/    API Flask (app factory, blueprints, models, services, migrations, tests)
frontend/   SPA React (pages, components, contexts, PWA) + build em dist/
scripts/    Verificação headless (CDP): smoke, fluxos e geração de ícones
AGENTS.md   Memória técnica do projeto (leia antes de contribuir)
```

---

## Produção (resumo)

1. Configure `backend/.env` com `FLASK_ENV=production`, `DATABASE_URL` PostgreSQL,
   `SECRET_KEY`/`JWT_SECRET_KEY` fortes, `FRONTEND_BASE_URL` público e o SMTP
   (`MAIL_SERVER`, `MAIL_PORT`, `MAIL_USE_TLS`, `MAIL_USERNAME`, `MAIL_PASSWORD`,
   `MAIL_DEFAULT_SENDER`) para a recuperação de senha por e-mail.
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
