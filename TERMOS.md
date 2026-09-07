# Termos de uso do Medium Latens (versão 2.0)

## Versão alpha e gratuidade

O Medium Latens está em versão alpha. Ele é gratuito e pode mudar, apresentar falhas ou ter recursos incompletos.

## Software livre e o que estes termos regem

O Medium Latens é software livre, distribuído sob a GNU Affero General Public License, versão 3 (AGPL-3.0). O código-fonte está em https://github.com/eibrunocorrea/medium-latens.

Estes termos regem o uso do build oficial, que é o instalador distribuído pelo autor, e a coleta de uso descrita abaixo. A licença do código é a AGPL-3.0 e vale para qualquer cópia, oficial ou não.

## O que é coletado

Tudo que você faz dentro do Medium Latens é registrado e enviado para aperfeiçoar o produto. Isso inclui o que você digita, as respostas do assistente, as ferramentas acionadas, as decisões que você toma e as alterações feitas na edição.

Os dados enviados contêm texto e estrutura das ações. Cada evento tem no máximo 4 KB.

Arquivos de mídia nunca são enviados. O programa remove dados binários da coleta, e arquivos de mídia também não cabem no limite de 4 KB de cada evento.

Credenciais, senhas, tokens e chaves de API são removidos antes de qualquer envio, e essa proteção não pode ser desligada. Ela reconhece os formatos de chave dos provedores conhecidos, endereços de webhook e qualquer valor com aparência de segredo (sequências longas e aleatórias). Um segredo em formato inédito, sem essas características, pode passar. Por isso, não cole senhas nem chaves no assistente: ele não precisa delas para trabalhar.

## Como os dados são usados

Os dados são usados para entender o uso, encontrar falhas, aperfeiçoar o Medium Latens e treinar modelo de inteligência artificial.

Os dados são enviados para `coleta.torremaster.com` e ficam em servidor do autor.

## Código aberto e receptor de coleta

O código do editor é público. Qualquer pessoa pode ler o que é coletado, como é filtrado e para onde vai.

O código do receptor que recebe e guarda os dados não é publicado. Ele guarda os dados de todas as pessoas que usam o programa, e expor a sua implementação aumentaria o risco de vazamento desses dados.

Os dados coletados serão periodicamente higienizados e publicados no repositório público do projeto, para que qualquer pessoa veja o que a ferramenta aprende. Higienizar significa remover nomes, caminhos de arquivo, identificadores de instalação e qualquer informação que identifique pessoa, cliente ou projeto. Trechos de prompts, respostas e decisões podem aparecer nessa publicação em forma anonimizada. O formato, a periodicidade e o local exato da publicação serão anunciados no repositório antes da primeira publicação.

## Builds a partir do código-fonte

Quem compila o programa a partir do código-fonte pode desligar a coleta com a variável de ambiente `MEDIUM_LATENS_COLETA=desligada`, gravada no arquivo `.env` da pasta de configuração. Estes termos não se aplicam a esse build. A AGPL-3.0 sim.

## Resumo automático da sessão

O Medium Latens gera um resumo automático uma vez por sessão. Esse resumo é produzido pela conta de inteligência artificial da própria pessoa, consome a cota dela e usa o modelo mais barato disponível nessa conta.

## Confidencialidade

Você é responsável pelos compromissos de confidencialidade que tenha com clientes, empregadores, parceiros ou outros terceiros ao usar o programa.

## Fila local e transparência

Antes do envio, os eventos ficam em uma fila local que você pode abrir e ler.

No macOS, a fila fica em `~/.medium-latens/telemetria/`.

No Windows, a fila fica em `%APPDATA%\Medium Latens\telemetria\`.

A página de status mostra o caminho exato do arquivo, a quantidade de itens aguardando envio, o identificador anônimo da instalação e se a coleta está obrigatória, ativa ou desligada. Ela nunca mostra o conteúdo da fila.

## Exclusão dos dados

Para pedir a exclusão dos dados já coletados, escreva para `contato@mediumlatens.com` e informe o identificador anônimo que aparece na página de status.

A exclusão remove os seus dados brutos do servidor do autor e de toda publicação higienizada feita a partir daí. Publicações feitas antes do pedido não são retiradas, porque já não contêm informação que identifique você.

## Licença de uso

O Medium Latens é distribuído sob a AGPL-3.0. Você pode usar, estudar, modificar e redistribuir o programa, inclusive em trabalho profissional. Quem distribuir uma versão modificada, ou a oferecer como serviço pela rede, precisa publicar o código dessa versão sob a mesma licença. O texto completo está no arquivo `LICENSE`.

Ao prosseguir com a instalação, você declara que leu e aceitou estes termos.

---

ENGLISH SUMMARY (the Portuguese text above is the governing version)

Medium Latens is free software under the GNU AGPL-3.0; source at https://github.com/eibrunocorrea/medium-latens. These terms govern the official build (the installer distributed by the author) and its usage collection. Everything you do inside the official build is recorded and sent to `coleta.torremaster.com` to improve the product and train AI models: prompts, assistant replies, tools used, decisions and timeline changes, each event capped at 4 KB. Media files are never sent. Credentials are removed before upload by format recognition plus a randomness heuristic, and that protection cannot be turned off; a secret in an unknown format may still pass, so do not paste passwords or keys into the assistant. The collector's source is not published, to reduce the risk of leaking the collected data; collected data will be periodically sanitized (names, paths, installation ids and anything identifying a person, client or project removed) and published in the public repository, and anonymized excerpts of prompts and decisions may appear there. Builds made from source may disable collection with `MEDIUM_LATENS_COLETA=desligada`; these terms do not apply to such builds. A once-per-session summary is generated by your own AI account, using its cheapest model. You remain responsible for confidentiality duties toward third parties. The local queue can be read before upload; the status page shows its path, the pending count, your anonymous id and the collection state. To request deletion, email `contato@mediumlatens.com` with your anonymous id; deletion removes your raw data and excludes you from later publications, while earlier publications, which no longer identify you, are not withdrawn. By proceeding with the installation you confirm you have read and accepted these terms.
