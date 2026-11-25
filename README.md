# FACTOR PRO — Gestão Financeira Inteligente

Sistema profissional de gestão de **factoring**: cadastro de clientes, cheques,
boletos e **empréstimos com parcelas**, com controle de limites, alertas de
vencimento e divergência de valores, auditoria completa e interface PWA responsiva
(tema claro executivo e escuro), alertas de inadimplência e bloqueio manual/auditado
de clientes, com homepage institucional e Agenda compartilhada para compromissos.

> **Regra soberana:** o sistema **nunca** calcula juros, descontos, taxas ou encargos.
> Todo valor é informado pelo usuário e gravado exatamente como digitado. O sistema
> apenas **compara** valores e exibe **alertas** (divergência, vencimento, limite).

Este repositório entrega as **oito etapas** do escopo: estrutura, banco,
autenticação, clientes, cheques e boletos (Etapa 1); operações, recebimentos e recibos
(Etapa 2); relatórios, exportações PDF/planilha, WhatsApp e dashboard completo (Etapa 3);
produção com e-mail de recuperação e throttling distribuído (Etapa 4); filtros de
relatório por usuário e carregamento otimizado do SPA (Etapa 5); **módulo de
empréstimos** com parcelas editáveis, exposição do cliente, relatório dedicado,
duplicata para impressão e correção das setas dos selects (Etapa 6); **Relatório
Geral unificado** (cheques, boletos e empréstimos) com **identidade visual
personalizável** — nome e logo do aplicativo em todas as exportações (Etapa 7); e
**Excel nas listagens, backup diário, atendente virtual por texto/voz, situação única
no Relatório Geral e múltiplas fotos** em cheques/boletos/recebimentos (Etapa 8).
Também inclui a homepage pública, a Agenda compartilhada (visões mensal, semanal e
diária), a reorganização de navegação e os ajustes recentes em Operações, inadimplência,
Relatório Geral e cadastro/impressão de empréstimos.

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

- Homepage: <http://127.0.0.1:5000> (ou <http://localhost:5173> em modo dev)
- Login: botão **Acessar sistema** na homepage; área autenticada: `/dashboard`.
- **Administrador:** `admin@factorpro.com.br` / `Admin@12345`
- No primeiro acesso o sistema **exige a troca da senha** (comportamento intencional).

### Abrir rapidamente no navegador (Windows / VS Code)

No terminal integrado do VS Code, execute:

```powershell
cd frontend
npm run abrir
```

O comando inicia o Flask em segundo plano quando necessário, verifica se a API
responde e abre `http://127.0.0.1:5000` no navegador padrão do computador. Para
acessar pelo celular ou compartilhar pelo WhatsApp, é necessário publicar o sistema
em um endereço HTTPS acessível pela internet; `127.0.0.1`/`localhost` só funcionam
no próprio dispositivo.

---

## Empréstimos (Etapa 6)

- Menu **Cadastros → Empréstimos**; o relatório permanece em **Financeiro → Rel. Empréstimos**.
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
- O lucro começa oculto no formulário, com controle para mostrar/ocultar. O cadastro
  contextual de cliente retorna ao empréstimo mantendo os valores digitados.
- **Minuta de promissória**: usa cliente, valor emprestado e parcelas para gerar folha
  imprimível com local e assinatura. É uma minuta operacional, não um modelo homologado;
  confirme os requisitos com assessoria jurídica antes de utilizar.
- API: `/api/loans` (CRUD, status e parcelas), `/api/loans/report/summary`,
  `/api/loans/report/export/pdf|xlsx`, `/api/loans/report/whatsapp`,
  `/api/loans/report/email` e `/api/loans/<id>/duplicata`.

---

## Operações, inadimplência e homepage

- **Operações** pode vincular cheques, boletos e empréstimos ativos do mesmo cliente.
  Os valores dos empréstimos são exibidos em grupo separado dos totais de títulos; um
  empréstimo só pode pertencer a uma operação.
- A lista de clientes aceita `overdue=1` e considera títulos e parcelas de empréstimo
  vencidos. O atalho global de inadimplência abre a lista filtrada. WhatsApp prepara
  uma mensagem e e-mail abre um rascunho para revisão: nenhum lembrete é enviado sem
  confirmação manual.
- O **Relatório Geral** abre por padrão com o mês atual até hoje. A homepage tem
  controle para alternar entre tema claro e escuro, respeitando a preferência salva.
- Para atualizar banco existente, execute `cd backend; .\.venv\Scripts\flask.exe db upgrade`.
  A migração `2a9c6d1e4f80_link_loans_to_operations.py` adiciona o vínculo de empréstimos
  às operações.

---

## Agenda compartilhada

- Disponível em **Visão geral → Agenda**, com navegação por mês, semana e dia,
  seleção de data, compromissos com horário, local, descrição e cor.
- Os compromissos são compartilhados entre os usuários. ADMIN e OPERATOR podem criar
  e editar; somente ADMIN pode excluir. Consultores podem visualizar.
- As exclusões são lógicas e as alterações são registradas na auditoria.
- API: `GET /api/agenda?start=AAAA-MM-DD&end=AAAA-MM-DD`, `POST /api/agenda`,
  `PUT /api/agenda/<id>` e `DELETE /api/agenda/<id>`.
- A migração `1f4b8c2d9a30_shared_agenda_events.py` cria a tabela `agenda_events`.
  Aplique migrações pendentes com `cd backend; .\.venv\Scripts\flask.exe db upgrade`.

---

## Relatório Geral e sua marca (Etapa 7)

- Menu **Relatórios → Relatório Geral**: uma única tela para analisar **cheques,
  boletos e empréstimos**. Filtre por período, cliente, tipo (`CHEQUE`, `BOLETO`,
  `EMPRESTIMO`), **um único controle “Situação”** (situações de título e de empréstimo
  combinadas), vencidos e busca livre. A API continua separando `status` e
  `loan_status`, inclusive nos filtros salvos e exportações.
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

## Recursos da Etapa 8

### Excel nas listagens

- Botão **Exportar Excel** em Clientes, Cheques, Boletos, Operações, Recebimentos,
  Empréstimos, Usuários e Auditoria (estes dois últimos, ADMIN).
- A planilha aplica **os mesmos filtros da tela** (busca, situação, período etc.), sem
  paginação, e usa o nome/logo configurados em Configurações. Cabeçalho verde, moeda em
  `R$`, filtro automático e linha congelada; cada download registra `EXPORT` na auditoria.
- API: `GET /api/export/<resource>/xlsx` e `GET /api/export/resources`. O download é
  feito por blob autenticado, com o nome de arquivo enviado pelo servidor.

### Backup diário

- Em **Configurações → Backup diário** (ADMIN): ativar/desativar, horário (`HH:MM`),
  retenção em dias, incluir ou não os uploads, status do agendador, último backup/erro,
  criar backup manual, baixar e remover arquivos.
- O ZIP contém o banco (SQLite via API online; PostgreSQL via `pg_dump`), `uploads/`
  opcional e `manifest.json`. O agendador roda em `threading` e relê as preferências
  periodicamente; backups manuais funcionam mesmo com o agendador desligado.
- Variáveis de ambiente: `BACKUP_FOLDER` (`instance/backups`), `BACKUP_SCHEDULER_ENABLED`
  (`true`, desligue em `TestingConfig`), `BACKUP_CHECK_INTERVAL_SECONDS` (`60`),
  `BACKUP_PG_DUMP_PATH` (`pg_dump`) e `BACKUP_PG_DUMP_TIMEOUT_SECONDS` (`120`).
- CLI: `.\.venv\Scripts\flask.exe backup --now`.
- API: `GET/PUT /api/settings/backup`, `POST /api/settings/backup/run`,
  `GET /api/settings/backup/<name>/download` e `DELETE /api/settings/backup/<name>`.

### Atendente virtual

- Botão flutuante disponível em todas as telas autenticadas. Digite ou fale (Web Speech
  API, `pt-BR`) comandos como “cheques”, “boletos”, “clientes”, “relatórios” ou
  “emprestimos” para abrir a página correspondente do menu lateral.
- Sugestões e histórico ficam no próprio widget. Se o navegador não oferecer
  reconhecimento de voz (Chrome/Edge são necessários), o campo de texto continua
  funcionando; a permissão de microfone é solicitada apenas quando o usuário ativa a voz.

### Múltiplas fotos

- Em **Cheques, Boletos e Recebimentos**, o painel de fotos permite capturar uma imagem
  por vez pela câmera do celular/tablet (`capture="environment"`), acumular várias na
  fila e enviar todas depois. O envio é sequencial para respeitar o limite por arquivo.
- A galeria mostra as fotos por blob autenticado, com visualizar, baixar e remover. O
  anexo único antigo continua visível; novas fotos usam a tabela `document_attachments`
  (migração `a7c4e1b9d2f3_document_attachments.py`) com exclusão lógica e auditoria.
- API: `GET/POST /api/<cheques|boletos|receipts>/<id>/photos` e
  `GET/DELETE /api/<cheques|boletos|receipts>/<id>/photos/<attachment_id>`.

### Alertas e bloqueio manual de clientes

- O sistema sinaliza clientes com títulos vencidos no início da sessão e oferece um
  filtro dedicado na lista de clientes. O alerta é informativo: nenhum cliente é
  bloqueado automaticamente.
- ADMIN/OPERATOR podem bloquear ou desbloquear um cliente manualmente, com motivo
  obrigatório ao bloquear e registro na auditoria. O bloqueio impede novos cheques,
  boletos e operações, mas não impede recebimentos nem a edição de títulos existentes.
- API: `GET /api/alerts`, filtro `blocked` em `/api/clients` e
  `PATCH /api/clients/<id>/block`.

### Identidade e aparência

- O administrador configura nome e logotipo do aplicativo em **Configurações**. A
  identidade alimenta o título, favicon, manifest PWA e telas/exportações. O tema
  claro usa tons quentes de marfim e latão; o tema escuro e a preferência do usuário
  continuam disponíveis.

---

## Testes

```powershell
# Backend — 161 testes
cd backend; .\.venv\Scripts\python.exe -m pytest -q

# Interface — smoke + acessibilidade (119), fluxos (37) e empréstimos (31)
# Requer o backend no ar em http://127.0.0.1:5000 e o Chrome instalado.
node scripts/browser_smoke.mjs
node scripts/browser_flows.mjs
node scripts/browser_loans.mjs

# Tudo de uma vez: pytest + build + smoke + fluxos + empréstimos
node scripts/verify_all.mjs
```

Execute os scripts de interface somente contra uma base local descartável/de teste:
eles criam e removem dados e redefinem a senha do administrador de teste. Use
`SMOKE_BASE` se o servidor isolado não estiver em `http://127.0.0.1:5000` e defina
`DATABASE_URL` no terminal dos scripts com o mesmo banco usado pelo servidor, pois o
fluxo de recuperação da senha administrativa chama a CLI do Flask.
`SMOKE_OUTPUT_DIR` permite salvar screenshots fora de `scripts/screenshots/`.

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
3. Configure o backup: `BACKUP_FOLDER`, `BACKUP_SCHEDULER_ENABLED=true` em **um único**
   nó (se houver múltiplas instâncias, use um agendador externo) e, com PostgreSQL,
   `BACKUP_PG_DUMP_PATH`/`BACKUP_PG_DUMP_TIMEOUT_SECONDS`. O horário, a retenção e a
   inclusão de uploads são ajustados na interface (tabela `settings`).
4. `flask db upgrade` para aplicar as migrações (inclui
   `269e70536ab9_loans_and_installments.py` e
   `a7c4e1b9d2f3_document_attachments.py`).
5. `flask seed` para criar o administrador inicial.
6. `npm run build` no frontend (o Flask serve `frontend/dist`).
7. Sirva com um WSGI server (waitress/gunicorn) atrás de HTTPS.

Em produção o app **recusa** iniciar com SQLite, com secrets de desenvolvimento ou
sem `MAIL_SERVER`. Defina `EXPOSE_RESET_TOKEN=false` (padrão em produção).

---

## Licença

Projeto privado. Todos os direitos reservados.
