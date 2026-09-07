<div align="center">

# Medium Latens

**Um editor assistente que vive dentro do Adobe Premiere Pro.**

Você descreve a edição. Ele trabalha na sequência aberta, um passo visível de cada vez. Quem edita continua sendo você.

[![CI](https://github.com/eibrunocorrea/medium-latens/actions/workflows/ci.yml/badge.svg)](https://github.com/eibrunocorrea/medium-latens/actions/workflows/ci.yml)
[![Segurança](https://github.com/eibrunocorrea/medium-latens/actions/workflows/seguranca.yml/badge.svg)](https://github.com/eibrunocorrea/medium-latens/actions/workflows/seguranca.yml)
[![Licença: AGPL-3.0](https://img.shields.io/badge/licen%C3%A7a-AGPL--3.0-blue)](LICENSE)
[![Estado: alpha](https://img.shields.io/badge/estado-alpha-orange)](#estado)

English version: [README.md](README.md)

</div>

> [!WARNING]
> Isto é uma alpha, feita por um desenvolvedor independente que ainda está aprendendo. Tem bugs de verdade, alguns vão morder, e algumas funções só funcionam numa plataforma. Leia [Estado](#estado) antes de instalar e abra uma issue quando algo quebrar.

Criado por Bruno Correa. Software livre sob a [AGPL-3.0](LICENSE).

## O que ele faz

| Recurso | O que acontece |
|---|---|
| **Edição por prompt** | Peça em linguagem natural. O assistente planeja, executa na sequência aberta pela ponte de scripting do Premiere e mostra cada chamada de ferramenta enquanto acontece. |
| **Brief Criativo** | A partir da transcrição da sua narração ele propõe um plano por trecho e planta isso como markers coloridos na timeline, para o corte seguir a história. |
| **Auto Zoom em multicam** | Encontra os momentos que merecem ênfase e aplica zooms dinâmicos com tracking, seguindo as regras de edição guardadas nos seus presets. |
| **Motor opcional** | Um motor Python transcreve, corrige a transcrição com o seu glossário, propõe cortes e gera FCPXML. Geradores de imagem e voz entram com as suas próprias chaves de API. |

## Princípios

- **Quem edita é você.** Nada roda sem você pedir, e cada ação é uma chamada de ferramenta que dá para acompanhar. O assistente faz a parte mecânica; o gosto, a história e a última palavra são seus.
- **Feito para o seu nicho.** Presets, regras e glossários existem para serem ajustados ao seu jeito de editar. A meta é ajudar o seu tipo de edição, não picar todo vídeo em frases de impacto.
- **Local antes de tudo.** O servidor só escuta na sua máquina, mídia nunca sai dela, e tudo que é seu fica na sua pasta de usuário.

## Estado

A versão `0.1.0-alpha.1` está em preparação. Os instaladores para macOS e Windows serão publicados na página de Releases; até lá, rode a partir do fonte. A alpha coleta dados de uso conforme os [termos de uso](TERMOS.md).

Limitações conhecidas:

- A transcrição do motor opcional só roda em Macs Apple Silicon; o caminho para Windows e Intel ainda não está ligado.
- No Windows ARM64 as ferramentas de mídia rodam sob emulação x64.
- O instalador guarda as ferramentas de linha de comando de IA numa pasta própria (`~/.medium-latens/npm/bin` ou `%APPDATA%\Medium Latens\npm`) e não as adiciona ao seu shell no macOS.
- Muita coisa ainda precisa de conserto antes de ficar confortável para o dia a dia. A [página de issues](https://github.com/eibrunocorrea/medium-latens/issues) é a lista honesta.

## Requisitos

- Adobe Premiere Pro 22 ou mais novo, no macOS ou no Windows.
- Uma conta de IA: Claude ou ChatGPT por assinatura, ou uma chave de API própria. O assistente de conta no painel configura tudo; você nunca toca em terminal.
- Só para build do fonte: Node.js 22 ou mais novo.

## Instalação

### Instalador oficial (em breve)

Baixe o `.pkg` ou o `.exe` na página de Releases e execute. O instalador resolve o Node.js, o painel do Premiere, o serviço de fundo e o motor opcional, passo a passo, com uma página de status que você abre a qualquer momento. Os instaladores ainda não são assinados; a primeira abertura pede confirmação ("Abrir mesmo assim" no macOS, "Executar assim mesmo" no Windows).

### A partir do fonte

```sh
git clone https://github.com/eibrunocorrea/medium-latens.git
cd medium-latens
node --test test/*.test.js
bash installer/bootstrap.sh "$PWD"
```

No Windows, a última linha é:

```powershell
powershell -ExecutionPolicy Bypass -File installer\bootstrap.ps1 -AppDir "$PWD"
```

Detalhes, inclusive como desligar a coleta de uso num build do fonte, em [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md).

## Como funciona

| Peça | Onde roda | O que faz |
|---|---|---|
| Painel CEP | Dentro do Premiere | Abas de Chat, Brief Criativo e Auto Zoom. Fala com o servidor local usando um token por instalação, guardado na sua pasta de usuário. |
| Servidor local | `127.0.0.1:8765` | Roda o turno do assistente pela CLI do seu provedor (Claude, Codex ou Gemini) e devolve o resultado em fluxo, por server-sent events. |
| Ponte de scripting | Premiere | Executa as chamadas de ferramenta na sequência aberta e registra as alterações da timeline para o resumo da sessão. |
| Motor Python | Sua máquina, opcional | Transcrição, correção por glossário, propostas de corte, FCPXML. |
| Módulo Remotion | Sua máquina, opcional | Motion graphics. |
| Pasta de usuário | Sua máquina | Chaves, configurações, workspaces e a fila de uso. Atualização e desinstalação nunca tocam nela. |

## Coleta de uso e privacidade

O build oficial registra o que você faz dentro do Medium Latens (prompts, respostas, ferramentas, decisões, alterações na timeline) e envia para o servidor do autor, para aperfeiçoar o produto e treinar modelos de IA. Cada evento tem teto de 4 KB. Bytes de mídia nunca saem da sua máquina, e credenciais são removidas antes do envio por reconhecimento de formato mais uma heurística de aleatoriedade; nenhuma das duas proteções tem interruptor, e os limites da heurística estão no SECURITY.pt-BR.md. A fila é um arquivo comum que você pode abrir antes de qualquer envio, e a página de status mostra o caminho, a quantidade pendente, o seu identificador anônimo de instalação e se a coleta está obrigatória, ativa ou desligada.

- Os instaladores oficiais mantêm a coleta obrigatória, aceita na tela de termos.
- Builds do fonte podem desligá-la com `MEDIUM_LATENS_COLETA=desligada`.
- O código do receptor não é publicado, para reduzir o risco de vazamento dos dados coletados. Os dados coletados serão periodicamente higienizados e publicados neste repositório.

Texto completo: [TERMOS.md](TERMOS.md) (versão que governa) e [docs/coleta.md](docs/coleta.md) (o que é capturado e como é filtrado, bilíngue).

## Origem

O Medium Latens nasceu numa mesa de edição, não num laboratório.

Bruno Correa grava mais do que consegue editar. Em algum momento a pilha de vídeos sem edição passou de algumas centenas, e a pergunta mudou. Deixou de ser "como eu edito mais rápido" e virou "quanto desse trabalho precisa mesmo de mim". A resposta honesta: o gosto, a história e a escolha do que fica precisam de um editor. Tirar silêncio, caçar o segundo em que o convidado ri, colocar o vigésimo zoom numa carta sendo virada: isso não.

Então ele construiu um assistente para si mesmo. Uma coisa que vive dentro do Premiere, entende a sequência que está aberta, faz a parte mecânica quando pedem e mostra cada passo, para o editor ficar com a última palavra. Ele cortou os vídeos do próprio canal por um ano. Em 2026 saiu do fluxo pessoal, perdeu tudo que era do autor e veio parar aqui, para que outros editores possam usar, quebrar e melhorar.

A intenção não mudou. O Medium Latens não está aqui para substituir um editor, e nem tenta. Ele existe para dar liberdade e acessibilidade a quem já edita: devolver as noites, transformar um corte de dois dias num corte de um dia, deixar uma equipe pequena render como uma grande. Ferramentas que só picam o vídeo em frases de impacto deixam todo canal com a mesma cara. Esta foi feita para ser ajustada a nichos diferentes, cada um com as suas regras de edição, para ajudar o seu jeito de trabalhar em vez de impor um.

É também, sem rodeio, o trabalho de um desenvolvedor independente com pouca experiência, aprendendo em público. Tem bugs, e alguns vão dar vergonha. Se você achar um, abrir uma issue é a coisa mais gentil que dá para fazer. O [CHANGELOG](CHANGELOG.md) conta como ele foi construído até aqui.

## Como contribuir

Issues e pull requests são bem-vindos. Leia antes o [CONTRIBUTING.pt-BR.md](CONTRIBUTING.pt-BR.md): como rodar do fonte, como os testes funcionam, o que não aceitamos, e o [Acordo de Licença de Contribuidor](CLA.md) que o bot vai pedir para assinar. Problemas de segurança vão pelo [SECURITY.pt-BR.md](SECURITY.pt-BR.md), nunca por issue pública. O projeto segue o [Contributor Covenant](CODE_OF_CONDUCT.pt-BR.md).

## Licença

Copyright (c) 2026 Bruno Correa.

O Medium Latens é software livre: você pode usar, estudar, modificar e redistribuir sob a GNU Affero General Public License, versão 3. Quem distribuir uma versão modificada, ou a oferecer como serviço pela rede, precisa publicar o código dela sob a mesma licença. Veja [LICENSE](LICENSE).

Criado por Bruno Correa.
