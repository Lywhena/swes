# SWES: prova de conceito
[![DOI](https://zenodo.org/badge/1462045890.svg)](https://doi.org/10.5281/zenodo.24397037)

Material de apoio ao Projeto de Conclusão de Curso **"SWES: Middleware Orientado pelo OWASP ASVS para Autorização Contínua em Servidores Socket.IO"** (Ciência da Computação, URI Santo Ângelo, 2026). Contém os dois experimentos preliminares citados no PCC. O middleware SWES em si será desenvolvido na etapa seguinte (TCC).

O código, os comentários e as saídas dos scripts estão em inglês; este README está em português.

## Requisitos

- Node.js 18 ou superior (os resultados abaixo foram obtidos com Node 22.23.5, em Linux: Ubuntu 26.04.1 LTS no WSL2).
- Versões fixadas no `package-lock.json`: socket.io 4.8.4, socket.io-client 4.8.1, jsonwebtoken 9.0.2.

## Como executar

Todos os comandos rodam de dentro da pasta `proof-of-concept`, onde fica o `package.json`:

```bash
cd proof-of-concept
npm ci                  # instala exatamente as versões do package-lock.json
npm run window          # experimento 1, como no PCC: 10 repetições, limite de 20 s (cerca de 10 min)
npm run window:quick    # experimento 1 em versão curta, só para conferir (cerca de 1 min)
npm run sid             # experimento 2 (alguns segundos)
```

Os dois scripts sobem servidor e cliente próprios em `127.0.0.1` e não fazem nenhuma requisição externa. Não use estes scripts contra sistemas de terceiros.

## Experimento 1: janela de autorização residual (`residual-window.js`)

Mede por quanto tempo uma conexão Socket.IO continua trocando eventos depois que a credencial deixa de valer.

- **Configuração A (documentação):** o token JWT é verificado só no handshake, como a documentação oficial ensina.
- **Configuração B (protótipo do Portão 2):** acrescenta temporizador de expiração, canal de revogação e verificação a cada evento.
- **Cenários:** token válido por 5 s (`expiration`) ou revogado 3 s após a conexão (`revocation`). Servidor e cliente trocam um evento por segundo em cada sentido. `t0` é o instante em que a credencial deixa de valer: na expiração, o `exp` do token; na revogação, o instante em que a revogação de fato ocorre (um eventual atraso do temporizador do próprio teste não entra na janela).
- **Uso direto:** `node residual-window.js [repetições] [limite em segundos]`. Com `DETAIL=1` antes do comando, o script mostra também cada rodada.

Resultado obtido (`results/residual-window-linux.txt`, 10 repetições, limite de 20 s, Node 22.23.5, Ubuntu 26.04.1 LTS no WSL2):

| Configuração | Janela residual (mediana; máximo) | Eventos entregues ao cliente após t0 | Eventos aceitos pelo servidor após t0 |
|---|---|---|---|
| A (documentação) | > 20 s em 10/10 (conexão ativa no limite) | 20 | 20 |
| B (protótipo do Portão 2) | 2 ms; 4 ms (expiração) · 1 ms; 2 ms (revogação) | 0 | 0 |

Em A, expiração e revogação tiveram o mesmo resultado; em B, a conexão foi encerrada em até 4 ms nos dois cenários. Na revogação, o encerramento é imediato, pelo canal de revogação; na expiração, depende da precisão do temporizador do sistema. Por isso os milissegundos variam de execução para execução e de máquina para máquina; o padrão (A ativa no limite, B encerrada em poucos milissegundos) é o que se repete.

## Experimento 2: identificador de sessão na URL (`sid-in-url.js`)

Verifica se o identificador da sessão de transporte (`sid`) do Engine.IO aparece nas URLs registradas pelo servidor e se, no long-polling, quem conhece apenas o `sid`, sem o JWT, consegue enviar eventos na sessão autenticada.

Resultado obtido (`results/sid-in-url-linux.txt`, socket.io 4.8.4, engine.io 6.6.11, Node 22.23.5, Ubuntu 26.04.1 LTS no WSL2):

- **Transporte padrão** (long-polling seguido de WebSocket): 3 de 4 URLs levam o `sid` (todas depois da primeira, a do handshake). Depois da promoção para WebSocket, a injeção apenas com o `sid` foi recusada (HTTP 400).
- **Cliente só em long-polling:** 3 de 4 URLs levam o `sid`, e a injeção apenas com o `sid` foi aceita (HTTP 200) e processada como o usuário autenticado.
- **Só WebSocket:** nenhuma URL leva o `sid`.

`SHOW=1 node sid-in-url.js` exibe as URLs registradas, com o `sid` mascarado.

## Licença e citação

Código sob licença MIT (ver `LICENSE`).

## Como citar

Se usar este material, cite a versão arquivada no Zenodo:

> Veltri, H. P. (2026). *SWES: proof of concept of the residual authorization window in Socket.IO* (versão pcc-2026) [Software]. Zenodo. https://doi.org/10.5281/zenodo.24397038

A versão citada no PCC corresponde à tag [`pcc-2026`](https://github.com/Lywhena/swes/tree/pcc-2026). O DOI do selo acima (10.5281/zenodo.24397037) reúne todas as versões e aponta sempre para a mais recente.
