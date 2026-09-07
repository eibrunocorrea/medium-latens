# Política de segurança

English version: [SECURITY.md](SECURITY.md).

## Versões com suporte

O Medium Latens está em alpha. Só a versão mais recente da branch `main` recebe correções.

## Como reportar uma vulnerabilidade

Não abra issue pública para problema de segurança.

1. Preferencial: use o reporte privado de vulnerabilidade do GitHub neste repositório ("Report a vulnerability", na aba Security).
2. Alternativa: escreva para `contato@mediumlatens.com` com o assunto `[security] Medium Latens`.

Inclua o que encontrou, como reproduzir, a versão (arquivo `VERSION` ou página de status) e o sistema operacional. Você recebe uma primeira resposta em até 7 dias. Quando a correção sair, o reporte e a correção são creditados no `CHANGELOG.md`, a menos que você peça o contrário.

## Escopo

Dentro: o servidor local (`server.js`, `lib/`), o painel do Premiere (`panel/`), os instaladores (`installer/`, `status/`, `windows/`), o cliente de coleta de uso (`lib/telemetria.js`, `lib/envio.js`) e o motor Python (`engine/`).

Fora: o receptor de coleta (código fechado, hospedado pelo autor; reporte problemas dele por e-mail), os serviços dos provedores de IA e o próprio Adobe Premiere Pro.

## O que o desenho garante

- O servidor local escuta só em `127.0.0.1` e exige um token local em toda rota exceto `/health`; origens de navegador diferentes de loopback ou `null` são recusadas.
- Toda rota do servidor local valida o cabeçalho Host (421 fora de loopback) e o cabeçalho Origin (403 fora do painel).
- Bytes de mídia nunca entram na coleta de uso, e cada evento tem teto de 4 KB. Credenciais e tokens são removidos antes de qualquer coisa entrar na fila por reconhecimento de formato mais uma heurística de aleatoriedade; veja em Limitações conhecidas o que isso não cobre.
- O instalador confere o download do Node.js contra a lista oficial de SHA-256, instala as quatro dependências Python diretas em versões fixadas e roda o npm só como usuário, com versões de pacote fixadas.
- Nenhum caminho do código sobe acima da pasta da aplicação; atualização e desinstalação nunca tocam a pasta do usuário.

## Limitações conhecidas

- **Redação de segredos na coleta é reconhecimento de formatos mais heurística, não garantia absoluta (F4.1, F4.4, Médio).** O cliente remove formatos conhecidos de chave, endereços de webhook, blocos PEM e valores com aparência de token aleatório (entropia, alternância de caixa e dígitos entremeados) antes de gravar qualquer evento. Um segredo em formato inédito, só em minúsculas ou sem dígitos entremeados pode passar. Mitigação: não cole senhas nem chaves no assistente; a fila local pode ser lida antes do envio. Planejado: revisar a lista de formatos a cada release.
- **Linhas base64 órfãs de chave privada podem escapar em parte (F4.1, Baixo).** Um bloco PEM completo é removido inteiro (até 16 KB de corpo). Fragmentos de base64 sem cabeçalho, sem `+` e sem `=`, com poucas alternâncias de caixa, sobrevivem em cerca de um em cada cinco casos. Mitigação: a regra de bloco e a rede de entropia cobrem o caso real; não cole chaves privadas no assistente.
- **Dependências Python transitivas não têm versão nem hash fixados (F6.5, Médio).** `engine/requirements.txt` fixa os quatro pacotes diretos; as dezenas de dependências indiretas resolvem para a versão mais nova compatível na hora da instalação. Mitigação: `pip-audit` na CI a cada push e Dependabot semanal para `pip`. Planejado: lockfile com hashes por plataforma quando o motor sair de opcional.
- **O identificador de instalação vem do cliente (F7.8, Médio).** O cabeçalho `x-instalacao` é um UUID gerado localmente; quem controla o cliente pode forjar quantos quiser, então a taxa por instalação no receptor não é um controle de abuso, só de erro. Mitigação: taxa por IP, corpo de 1 MB e teto de 20 GB no receptor. O dataset higienizado que será publicado terá spec própria com detecção de envenenamento antes da primeira publicação.
- **O gitleaks não varre `test/` (F7.16, Baixo).** As fixtures de chave falsa dos testes são montadas por partes e o diretório está no allowlist do `.gitleaks.toml`. Mitigação: o secret scanning e o push protection do GitHub varrem tudo, inclusive `test/`.
- **A URL com o token do status fica no histórico do navegador (F3.6, residual Baixo).** O launcher abre `/status?t=<token>`; o servidor troca o token por um cookie `HttpOnly; SameSite=Lax` e redireciona, mas a URL original fica no histórico da máquina. O token só vale em loopback. Mitigação planejada: código de uso único no lugar do token.
- **A CSP do painel foi verificada estaticamente, não no Premiere (F2.1).** O painel CEP carrega a política por `<meta>`; se o CEF ignorá-la, o painel funciona como antes (sem a defesa extra); se ela bloquear `token.js`, o painel não autentica. A fonte `file:` foi incluída para o segundo caso. Pendente: carregar o painel no Premiere uma vez antes do primeiro release.
- **No Windows ARM64 o ffmpeg roda sob emulação x64 (F6.2).** O release do ffmpeg-static não publica binário ARM64 para Windows; o instalador baixa o x64 e confere o SHA-256. Funciona, mais devagar.
- **A transcrição do motor Python só funciona em macOS Apple Silicon (pré-existente, encontrado na Task 9).** `engine/transcribe.py` importa `mlx_whisper` sem ramo para `faster_whisper`, apesar de o instalador Windows instalar `faster-whisper`. O restante do produto funciona; a transcrição no Windows e em Mac Intel é trabalho futuro (issue pública depois da abertura).
- **Rede de entropia não pega token aleatório só em minúsculas ou com dígitos só nas pontas (F4.1, Baixo).** Os três sinais (entropia, alternância de caixa, dígitos entremeados) foram escolhidos para preservar nomes de arquivo, caminhos e identificadores camelCase. Formatos conhecidos continuam cobertos por regra própria.
- **Perfil de login que imprime texto depois do comando (`~/.zlogout`) faz o instalador não encontrar o Node do usuário (F3.3, Baixo).** O caminho é validado como absoluto e executável; em caso de dúvida o instalador baixa o Node oficial. Efeito: um segundo Node, nunca um caminho errado no serviço.
- **Executar `installer/bootstrap.sh` sem root não honra o PATH de quem chamou (F3.3).** O fluxo suportado é o pacote `.pkg`; quem roda do fonte deve ter o Node visível pelo perfil de login do próprio shell.
- **O token do SSE viaja na query string de `/stream` (F2.5, Informativo).** O EventSource do navegador não envia cabeçalhos; o token só vale em loopback e a rota exige origem do painel.

## Permissões dos workflows

`.github/workflows/cla.yml` usa `pull_request_target` para que o check do CLA consiga comentar em pull requests vindos de forks. Ele faz checkout só da branch `cla-signatures` deste repositório, busca o próprio script da `main` protegida, nunca faz checkout nem executa código do pull request, e usa só o token do workflow, cuja escrita se limita a branches sem proteção (`cla-signatures`).
