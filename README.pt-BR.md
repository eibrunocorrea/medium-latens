# Medium Latens

English version: [README.md](README.md).

[![CI](https://github.com/eibrunocorrea/medium-latens/actions/workflows/ci.yml/badge.svg)](https://github.com/eibrunocorrea/medium-latens/actions/workflows/ci.yml) [![Segurança](https://github.com/eibrunocorrea/medium-latens/actions/workflows/seguranca.yml/badge.svg)](https://github.com/eibrunocorrea/medium-latens/actions/workflows/seguranca.yml)

O Medium Latens é um editor assistente que trabalha dentro do Adobe Premiere Pro. Você conversa com ele num painel e ele executa na sua timeline: corta, move e rotula, monta o Brief Criativo como markers coloridos e aplica Auto Zoom em sequências multicam.

Criado por Bruno Correa. Software livre sob a [AGPL-3.0](LICENSE).

## Estado

Alpha. A versão `0.1.0-alpha.1` está em preparação. Os instaladores para macOS e Windows serão publicados na página de Releases; até lá, rode a partir do fonte (abaixo). A alpha coleta dados de uso conforme os [termos de uso](TERMOS.md).

Limitações conhecidas desta alpha: a transcrição do motor opcional só roda em Macs Apple Silicon (o caminho para Windows e Intel ainda não está ligado); no Windows ARM64 as ferramentas de mídia rodam sob emulação x64; o instalador guarda as ferramentas de linha de comando de IA numa pasta própria (`~/.medium-latens/npm/bin` ou `%APPDATA%\Medium Latens\npm`) e não as adiciona ao seu shell no macOS.

## O que ele faz

- **Edição por prompt.** Peça em linguagem natural; o assistente planeja e executa na sequência aberta pela ponte de scripting do Premiere, mostrando cada chamada de ferramenta enquanto acontece.
- **Brief Criativo.** A partir da transcrição da sua narração ele propõe um plano por trecho e planta isso como markers coloridos na timeline, para a edição seguir a história.
- **Auto Zoom em multicam.** Detecta momentos que merecem ênfase e aplica zooms dinâmicos com tracking, seguindo as regras de edição gravadas nos presets.
- **Motor opcional.** Um motor Python transcreve, corrige a transcrição com o seu glossário, propõe cortes e gera FCPXML; geradores de imagem e voz entram com as suas próprias chaves de API.

## Requisitos

- Adobe Premiere Pro 22 ou mais novo, no macOS ou no Windows.
- Uma conta de IA: Claude ou ChatGPT por assinatura, ou uma chave de API própria. O assistente de conta no painel configura tudo; você nunca toca em terminal.
- Só para build do fonte: Node.js 22 ou mais novo.

## Instalação

**Instalador oficial (em breve):** baixe o `.pkg` ou o `.exe` na página de Releases e execute. O instalador resolve o Node.js, o painel do Premiere, o serviço de fundo e o motor opcional, passo a passo, com uma página de status que você abre a qualquer momento. Os instaladores ainda não são assinados; a primeira abertura pede confirmação ("Abrir mesmo assim" no macOS, "Executar assim mesmo" no Windows).

**A partir do fonte:**

```sh
git clone https://github.com/eibrunocorrea/medium-latens.git
cd medium-latens
node --test test/*.test.js
bash installer/bootstrap.sh "$PWD"          # macOS; no Windows: powershell -ExecutionPolicy Bypass -File installer\bootstrap.ps1 -AppDir "$PWD"
```

Detalhes, inclusive como desligar a coleta de uso num build do fonte, em [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md).

## Como funciona

1. Um painel CEP dentro do Premiere fala com um servidor local em `127.0.0.1:8765`, autenticado por um token que vive na sua pasta de usuário.
2. O servidor roda o turno do assistente pela CLI do seu provedor (Claude, Codex ou Gemini) e devolve o resultado em fluxo, por server-sent events.
3. As chamadas de ferramenta chegam ao Premiere por uma ponte de scripting; as alterações na timeline são registradas para o resumo da sessão.
4. O motor Python (transcrição, cortes, FCPXML) e o módulo Remotion (motion graphics) são opcionais e vivem fora do processo do servidor.
5. Os arquivos do programa ficam na pasta da aplicação; tudo que é seu (chaves, configurações, workspaces, fila) fica na pasta de usuário, que atualização e desinstalação nunca tocam.
6. Os eventos de uso vão para uma fila local que você pode ler, e são enviados em lotes. Veja abaixo.

## Coleta de uso e privacidade

O build oficial registra o que você faz dentro do Medium Latens (prompts, respostas, ferramentas, decisões, alterações na timeline) e envia para o servidor do autor, para aperfeiçoar o produto e treinar modelos de IA. Cada evento tem teto de 4 KB. Bytes de mídia nunca saem da sua máquina, e credenciais são removidas antes do envio por reconhecimento de formato mais uma heurística de aleatoriedade; nenhuma das duas proteções tem interruptor, e os limites da heurística estão no SECURITY.pt-BR.md. A fila é um arquivo comum que você pode abrir antes de qualquer envio, e a página de status mostra o caminho, a quantidade pendente, o seu identificador anônimo de instalação e se a coleta está obrigatória, ativa ou desligada.

- Os instaladores oficiais mantêm a coleta obrigatória, aceita na tela de termos.
- Builds do fonte podem desligá-la com `MEDIUM_LATENS_COLETA=desligada`.
- O código do receptor não é publicado, para reduzir o risco de vazamento dos dados coletados. Os dados coletados serão periodicamente higienizados e publicados neste repositório.

Texto completo: [TERMOS.md](TERMOS.md) (versão que governa) e [docs/coleta.md](docs/coleta.md) (o que é capturado e como é filtrado, bilíngue).

## Origem

O Medium Latens descende do AutoCutClone, uma ferramenta de cortes, e de um assistente de edição pessoal que Bruno Correa construiu para o próprio canal do YouTube entre 2025 e 2026, para dar conta de um acervo de centenas de vídeos gravados. Em agosto de 2026 o assistente foi extraído para este produto independente: isolado de qualquer dado pessoal, endurecido com token local e redação de segredos, com instaladores para os dois sistemas e um programa de coleta de uso para aprender com o jeito real de editar. O [CHANGELOG](CHANGELOG.md) conta essa história fase a fase.

## Como contribuir

Issues e pull requests são bem-vindos. Leia antes o [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md): como rodar do fonte, como os testes funcionam, o que não aceitamos, e o [Acordo de Licença de Contribuidor](CLA.md) que o bot vai pedir para assinar. Problemas de segurança vão pelo [SECURITY.pt-BR.md](SECURITY.pt-BR.md), nunca por issue pública. O projeto segue o [Contributor Covenant](CODE_OF_CONDUCT.pt-BR.md).

## Licença

Copyright (c) 2026 Bruno Correa.

O Medium Latens é software livre: você pode usar, estudar, modificar e redistribuir sob a GNU Affero General Public License, versão 3. Quem distribuir uma versão modificada, ou a oferecer como serviço pela rede, precisa publicar o código dela sob a mesma licença. Veja [LICENSE](LICENSE).

Criado por Bruno Correa.
