# Como contribuir com o Medium Latens

English version: [CONTRIBUTING.md](CONTRIBUTING.md).

O Medium Latens é um editor assistente que roda dentro do Adobe Premiere Pro. Código, identificadores, comentários e testes são escritos em português; a documentação é bilíngue. Contribuições em qualquer dos dois idiomas são bem-vindas. Mensagens de commit são em inglês.

## Antes de começar

- Leia o [README](README.pt-BR.md), os [termos de uso](TERMOS.md) e [docs/coleta.md](docs/coleta.md), que explica o que a coleta de uso registra e como desligá-la num build do fonte.
- Procure nas issues abertas. Se nenhuma corresponder, abra uma descrevendo o problema antes de escrever uma mudança grande.
- Todo pull request exige a assinatura do [Acordo de Licença de Contribuidor](CLA.md). O bot pede no seu primeiro PR; uma assinatura vale para as contribuições seguintes.

## Rodando a partir do fonte

Requisitos: Node.js 22 ou mais novo, Adobe Premiere Pro 22 ou mais novo, Python 3.10 ou mais novo para o motor de cortes opcional.

```sh
git clone https://github.com/eibrunocorrea/medium-latens.git
cd medium-latens
node --test test/*.test.js          # a suíte precisa estar verde antes de qualquer mudança
node server.js                      # servidor local em 127.0.0.1:8765
```

Na primeira inicialização, o servidor grava `mcp-config.json` na pasta do usuário apontando para o pacote `premiere-pro-mcp` que o bootstrap instala em `npm/`; sem rodar o bootstrap, você precisa instalar esse pacote ali por conta própria antes, caso contrário o assistente não consegue alcançar o Premiere.

Para instalar o painel do Premiere, o LaunchAgent ou o serviço do Windows, o ambiente Python e as ferramentas de mídia exatamente como o instalador faz, rode o bootstrap apontando para o seu checkout:

```sh
bash installer/bootstrap.sh "$PWD"                                                  # macOS
powershell -ExecutionPolicy Bypass -File installer\bootstrap.ps1 -AppDir "$PWD"      # Windows
```

O instalador guarda as ferramentas de linha de comando de IA numa pasta própria (~/.medium-latens/npm/bin no macOS, %APPDATA%\Medium Latens\npm no Windows) e não as adiciona ao seu shell.

O bootstrap grava o estado do usuário em `~/.medium-latens` (macOS) ou `%APPDATA%\Medium Latens` (Windows), nunca dentro do repositório.

### Coleta de uso num build do fonte

Um checkout não tem o carimbo `BUILD`, portanto é um build do fonte. Para desligar a coleta, acrescente esta linha ao arquivo `.env` da sua pasta de usuário e reinicie o servidor:

```
MEDIUM_LATENS_COLETA=desligada
```

A página de status (`status/abrir.sh` ou o atalho na bandeja) mostra qual estado está valendo. Os instaladores oficiais carregam o carimbo `BUILD` e mantêm a coleta obrigatória, como dizem os termos.

## Testes

- Diagnóstico primeiro: `node --check lib/*.js server.js`, depois `node --test test/*.test.js`. O glob é obrigatório.
- Escreva o teste que falha antes da correção. Testes específicos de plataforma declaram a plataforma com a opção `skip` do `node:test` e um motivo; nunca pule um teste que falha para deixar a CI verde.
- Nunca coloque chave, token ou senha de verdade num teste, nem expirada. Monte chaves falsas por partes, como os testes existentes fazem; o verificador de segredos roda em todo push.

## Pull requests

- Crie a branch a partir da `main`; um assunto por PR.
- Commits convencionais em inglês: `feat(escopo): ...`, `fix(escopo): ...`, `docs: ...`, `test: ...`, `chore: ...`.
- Preencha o template do PR: o que mudou, por quê, como você testou, e uma linha para o `CHANGELOG.md` em `Unreleased`.
- A CI roda a suíte em Ubuntu, macOS e Windows com Node 22, 24 e 26, mais gitleaks e `npm audit`. Tudo precisa passar.
- O mantenedor revisa todo PR. Espere perguntas sobre casos de borda e sobre o que os testes não cobrem.

## O que não aceitamos

- Mudanças que enviem bytes de mídia ou credenciais para qualquer lugar. Os guardas em `lib/telemetria.js` e `lib/status.js` existem para isso e têm testes.
- Caminhos que subam acima da pasta da aplicação (veja `test/isolation.test.js`).
- Dependências adicionadas ao servidor local. Ele roda só com a biblioteca padrão do Node.
- Nomes de modelo fixados no código. O provedor lista os modelos em tempo de execução.

## Problemas de segurança

Não abra issue pública. Siga o [SECURITY.pt-BR.md](SECURITY.pt-BR.md).
