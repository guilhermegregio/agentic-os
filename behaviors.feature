# language: pt
# Contrato do Jarvis agenticOS — plano jarvis-agenticos (vault pessoal).
# Escrito ANTES do merge do código. Depois de `kb dev freeze`, cenário quebrando = código errado.

Funcionalidade: Sessões persistentes e multi-device
  O estado de uma sessão vive no servidor (events.jsonl + meta.json), nunca no browser.

  Cenário: Recarregar a página não perde a sessão
    Dado uma sessão viva com 3 turnos concluídos
    Quando o usuário recarrega a página e abre a mesma sessão
    Então o histórico completo (mensagens, tool calls, resultados) reaparece na mesma ordem
    E o estado mostrado é o estado atual do servidor

  Cenário: A mesma sessão aberta em dois devices
    Dado a sessão aberta no notebook e no celular
    Quando o agente emite um evento (texto, tool call, permissão)
    Então os dois devices recebem o evento
    E uma permissão decidida no celular some do notebook com a decisão registrada

  Cenário: Sessão fechada revive ao receber mensagem
    Dado uma sessão gravada em disco cujo processo não existe mais
    Quando o usuário envia uma mensagem nela
    Então o servidor cria o processo de novo com `resume` no id do CLI
    E a sequência de eventos continua do último `seq` gravado, sem duplicar histórico

  Cenário: Reiniciar o servidor mantém a lista
    Dado 2 sessões gravadas
    Quando o servidor reinicia
    Então `GET /api/sessions` lista as 2 com estado `closed` e o mesmo título, cwd e custo

Funcionalidade: Controle da sessão viva
  Cenário: Trocar o modo de permissão durante a sessão
    Dado uma sessão viva em modo `default`
    Quando o usuário escolhe `acceptEdits` na UI
    Então o próximo `system/init` do CLI reporta `permissionMode: acceptEdits`
    E a UI mostra o modo reportado pelo CLI, não o que foi pedido

  Cenário: Trocar o modelo durante a sessão
    Dado uma sessão viva no modelo padrão
    Quando o usuário escolhe outro modelo da lista `supportedModels`
    Então o próximo turno roda no modelo escolhido e o custo por modelo passa a contá-lo

  Cenário: Limite de agentes em paralelo
    Dado `maxRunning = 1` e uma sessão A no meio de um turno
    Quando o usuário envia mensagem na sessão B
    Então B fica no estado `queued` e a mensagem aparece como enviada
    E quando A termina o turno, B entra em `running` sem intervenção

  Cenário: Aumentar o limite libera a fila
    Dado 2 sessões em `queued` com `maxRunning = 1`
    Quando o usuário muda `maxRunning` para 3
    Então as 2 entram em `running` por ordem de chegada

Funcionalidade: Handoff entre web e CLI
  Cenário: Levar a sessão para o terminal
    Dado uma sessão viva com id do CLI conhecido
    Quando o usuário pede "abrir no CLI"
    Então o processo da web é encerrado (estado `handed-off`)
    E a UI mostra `claude --resume <id>` pronto para copiar
    E, dentro do herdr, um pane novo já roda esse comando no cwd da sessão

  Cenário: Trazer uma sessão do terminal para a web
    Dado uma sessão do Claude Code em ~/.claude/projects que não existe no Jarvis
    Quando o usuário a importa pela lista "sessões do CLI"
    Então o histórico do transcript aparece no chat antes de qualquer evento novo
    E a próxima mensagem continua a mesma sessão (`resume`), não uma nova

Funcionalidade: Dashboard
  Cenário: Janelas da subscription
    Dado login claude.ai (Max) no CLI
    Quando o dashboard carrega
    Então mostra a janela de 5h e a semanal com % usado e horário de reset
    E mostra as janelas por modelo quando o endpoint as devolve

  Cenário: Dashboard degrada sem janelas
    Dado uma conta por API key (sem rate limits de plano)
    Quando o dashboard carrega
    Então o widget diz "janelas indisponíveis" e o resto do dashboard funciona

  Cenário: Custo por período
    Dado transcripts em ~/.claude/projects
    Quando o dashboard carrega
    Então mostra custo estimado de hoje, da semana (desde segunda) e do mês (desde o dia 1), por modelo
    E rotula como "equivalente API" quando a conta é subscription

Funcionalidade: Projetos e worktrees
  Cenário: Abrir sessão num projeto do kb
    Dado os projetos de ~/.config/kb/config.json
    Quando o usuário toca em "nova sessão" num projeto
    Então a sessão nasce com `cwd` = path do projeto e carrega o CLAUDE.md dele

  Cenário: Criar worktree
    Dado um projeto git com branch `main`
    Quando o usuário cria o worktree `feat-x`
    Então existe `~/code/worktrees/<repo>-feat-x` na branch `feat-x`
    E os arquivos `.env*` do repo foram copiados
    E o usuário pode abrir uma sessão com esse cwd

Funcionalidade: Console do devflow
  Cenário: Ler o plano
    Dado um plano em <vault>/30-plans/<slug>/
    Quando o usuário abre o plano
    Então vê o `_plan.md` renderizado (wikilinks como texto), as tasks com status/deps/ready e o log de execução

  Cenário: Aprovar o protótipo
    Dado a task TP com `gate: human` e status `todo`
    Quando o usuário toca em "aprovar protótipo"
    Então TP fica `done` com o checkbox ⛔ marcado
    E `kb dev check` passa a listar TB como pronta

  Cenário: Congelar o contrato só via kb
    Dado `contracts:` apontando para um behaviors.feature existente
    Quando o usuário toca em "congelar"
    Então o Jarvis executa `kb dev freeze <slug>` e mostra a saída
    E `kb dev frozen --slug <slug>` lista o arquivo

  Cenário: Descongelar exige motivo
    Dado um contrato congelado
    Quando o usuário pede "descongelar" sem motivo
    Então o Jarvis recusa
    E com motivo executa `kb dev unfreeze <slug> --reason "<motivo>"`

  Cenário: Aprovar o plano
    Dado um plano `ready-for-review`
    Quando o usuário toca em "aprovar plano"
    Então o `_plan.md` fica `status: approved` com `approved_by` e `approved_at` preenchidos

  Cenário: Abrir o protótipo
    Dado `prototype_url` no frontmatter do plano
    Quando o usuário abre o plano
    Então vê o link do protótipo e se ele está no ar

Funcionalidade: Layout
  Cenário: Mobile-first
    Dado uma tela de 400px
    Quando qualquer página carrega
    Então não há scroll horizontal, a navegação é uma barra inferior e os alvos de toque têm ≥ 44px

  Cenário: Desktop
    Dado uma tela de 1440px
    Quando o usuário abre uma sessão
    Então a lista de sessões fica ao lado do chat e a navegação vira barra lateral
