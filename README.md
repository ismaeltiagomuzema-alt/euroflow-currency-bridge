# Euroflow Currency Bridge

https://jeovanisim9-design.github.io/Triple-bank-/

Amigo, tenho aqui arquitetura do meu site, eu quero que me ajudes com a segurança e deixa-lo mais profissional. 

Aqui alguns pontos:

1. HTTPS obrigatório, com cabeçalhos de segurança (HSTS, CSP, X-Frame-Options).

Palavras-passe guardadas com hash forte (Argon2id ou bcrypt), nunca em texto simples. Exigir um tamanho mínimo e bloquear palavras-passe comuns.

2. Autenticação

Verificação em dois passos (2FA) por app autenticadora, e não só por SMS.

Sessões com tokens de curta duração (JWT ou cookies HttpOnly + Secure + SameSite) e expiração por inatividade.

Limite de tentativas de login e bloqueio temporário contra força bruta.

Verificação do email e recuperação de palavra-passe segura (link com validade curta e uso único).

3. Transações

Confirmação extra (PIN ou 2FA) para enviar dinheiro.

Limites por transação e por dia, e alertas para comportamento estranho.

Idempotência, para um clique duplo não enviar o dinheiro duas vezes.

Registo imutável de todas as operações, com data, utilizador e IP.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/875657f2-b529-400f-b713-15ea6725e18a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
