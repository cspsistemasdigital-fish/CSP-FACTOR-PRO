# Plano de varredura, correções e novos recursos

> Checkpoint de trabalho. Atualizar ao concluir cada etapa. Se a geração de código
> pausar, retome pela primeira etapa marcada como `[ ]` — todo o progresso fica
> commitado no repositório.

## Linha de base (antes das alterações)
- Data: 2026-11-17
- Commit: `ff0c432`
- Backend: `112 passed` (`python -m pytest -q`)
- Frontend: `npm run build` OK — bundle inicial ~92 kB
- Git: árvore limpa

## Etapas

### [x] 0. Diagnóstico
- Auditoria de backend (settings, clients, documentos, dashboard, arquivos estáticos).
- Auditoria de frontend (PWA, tema, responsividade, Settings, clientes, bootstrap).
- Bug hunt documentado abaixo.

### [x] 1. Backend — identidade (nome do app + logo) e endpoints públicos
- [x] `services/settings.py` com leitura canônica de configurações (quebrar inversão services→api).
- [x] Novas chaves: `app_name`, `logo_path`, `logo_name`, `logo_version`.
- [x] `GET /api/settings/brand` público (nome + logo + cores) para login/boot/PWA.
- [x] `POST /api/settings/logo` e `DELETE /api/settings/logo` (ADMIN), com validação de tipo/tamanho e auditoria.
- [x] Rota `/brand/logo` e `/manifest.webmanifest` dinâmicos, registradas antes do SPA fallback.
- [x] `PUT /api/settings/company` aceitando `app_name`.
- [x] Testes backend (`tests/test_settings.py`, 5 testes).

### [x] 2. Backend — cliente inadimplente/bloqueado e alertas globais
- [x] Coluna `is_blocked`, `blocked_reason`, `blocked_at`, `blocked_by_id` + migração `a7c19d4e8b52`.
- [x] `PATCH /api/clients/<id>/block` (ADMIN/OPERATOR) com motivo obrigatório ao bloquear + auditoria.
- [x] Bloqueio **servidor** de novos cheques/boletos/oper para cliente bloqueado (recebimentos continuam permitidos para quitar a dívida; edição de títulos existentes permitida).
- [x] Filtro `blocked=1` em `GET /api/clients` + `totals.blocked`.
- [x] `GET /api/alerts` com inadimplentes (valor vencido, nº de títulos, sinalização de bloqueio).
- [x] Testes backend (`tests/test_alerts.py`, 5 testes).
- Resultado: **122 passed**.

### [ ] 3. Frontend — identidade, nome e logo
- [ ] `BrandContext` + fetch público no boot (inclusive login).
- [ ] `Logo.jsx` com logo enviada pelo admin (fallback para marca padrão).
- [ ] Substituir textos fixos "FACTOR PRO" por `appName` / "o sistema" onde fizer sentido.
- [ ] Configurações: campo "Nome do aplicativo", upload/remoção de logo com preview.
- [ ] Manifest dinâmico pelo backend + SW sem cache stale de logo/manifest.

### [ ] 4. Frontend — paleta clara mais quente/executiva e responsividade mobile
- [ ] Tokens claros: marfim/warm white + verde profundo + acento latão; AA mantido.
- [ ] Atualizar meta theme-color, previews de tema, cores de gráficos e manifest.
- [ ] Viewport com `viewport-fit=cover`, safe-area, alvos de toque ≥44px, inputs 16px (sem zoom iOS).
- [ ] Revisar breakpoints existentes (1280/1100/991/767/420) e corrigir problemas reais.

### [ ] 5. Frontend — cliente inadimplente e notificação global
- [ ] `ClientForm`: botão "Bloquear por inadimplência" + motivo + aviso.
- [ ] `ClientDetail` e `ClientsList`: badge/banner de inadimplente/bloqueado, filtro.
- [ ] Banner global no `AppLayout` + toast único na abertura do app com resumo dos inadimplentes.

### [ ] 6. Correções de bugs encontrados na varredura
- [ ] `Field` com children: rótulo não associado ao controle (label htmlFor) e `aria-describedby`.
- [ ] iOS `navigator.standalone` no `useInstallPrompt`; `id` no manifest; apple-touch-icon.
- [ ] `download_attachment` sem guard de traversal (consistência com delete).
- [ ] Textos de versão/etapa desatualizados.
- [ ] Outros bugs encontrados durante a implementação.

### [ ] 7. Verificação final
- [ ] pytest (backend)
- [ ] `npm run build`
- [ ] `node scripts/browser_smoke.mjs`
- [ ] `node scripts/browser_flows.mjs`
- [ ] Atualizar `AGENTS.md`, `README.md`, `.env.example` se necessário.
- [ ] Commit final + relatório ao usuário.

## Decisões de produto (tomadas para destravar o trabalho)
1. **Nome do app**: novo campo `app_name` controla toda a interface/PWA (padrão `FACTOR PRO`).
   `company_name` continua sendo o nome institucional de recibos/relatórios/WhatsApp.
   Se `app_name` estiver vazio, usa `company_name`. Assim o admin pode usar o nome usual
   da empresa em um único campo sem perder a razão social dos documentos.
2. **Bloqueio**: manual e auditável (respeita a regra de ouro "o sistema não altera status
   sozinho"). O sistema **detecta e avisa** automaticamente sobre atrasos; o bloqueio de
   novos lançamentos depende de decisão explícita do operador/admin.
3. **Notificação**: banner persistente no topo do app (visível em todas as telas) +
   um toast único na abertura, com total e quantidade de títulos vencidos. Dispensável
   apenas durante a sessão; reaparece na próxima abertura do aplicativo.
4. **Logo**: PNG/JPEG/WebP (SVG não é aceito por segurança XSS). Arquivo público de leitura
   (logotipo não é dado sensível), com URL versionada para evitar cache antigo no PWA.

## Bugs/observações da varredura (para correção)
- PWA: SW registrado só em PROD (correto), mas `useInstallPrompt` ignora `navigator.standalone` no iOS;
  manifest sem `id`; `apple-touch-icon.png` existe mas não é referenciado; fallback offline com nome fixo.
- Acessibilidade: `Field` com `children` não associa `<label htmlFor>` nem `aria-describedby`;
  botões de ícone sem `aria-label` em `ClientsList`.
- Settings: `company_signature` vazia é silenciosamente substituída pelo padrão; "Recarregar"
  não considera `companyLoading`.
- Serviços importam `get_company_settings` da camada de API (inversão de dependência).
- `download_attachment` sem guard de traversal (ao contrário de `delete_attachment`).
- Textos de versão/etapa desatualizados (`v1.3 · Etapa 3`, `v1.0 · Etapa 1`).
- `company_name` e demais defaults de settings não são persistidos no banco de produção
  por `flask db upgrade` (apenas por `flask seed`).
- `Topbar` usa "FACTOR PRO" como título fallback de rotas desconhecidas.
