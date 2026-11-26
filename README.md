# ByteForge Hardware — API + Front-end de e-commerce

Projeto de avaliação com **Node.js + Express + MySQL**, autenticação **JWT** e front-end estático em `public/`.

## Instalação

```bash
npm install
npm run migrate   # cria o banco lucas_epstein e as tabelas (se não existir)
npm run seed      # opcional: dados de demonstração
npm start         # API em http://localhost:3000
```

A tela principal (`/`) é a vitrine. Cadastro em `/index.html`, login em `/login.html`.

### Login de demonstração (após `npm run seed`)

| E-mail | Senha |
| --- | --- |
| `demo@byteforge.com` | `123456` |

## Ver o banco na extensão Database Client (VS Code)

1. Abra a extensão **Database Client** (Weijan Chen) no VS Code.
2. Use a **conexão da escola** que já existe nela (não precisa criar outra).
3. Ela aponta para `127.0.0.1:3306`, usuário `root`.
4. Clique no botão **Refresh** da conexão.
5. Vai aparecer `lucas_epstein` na lista — expanda → **Tables** → botão direito na tabela → **Open Table / Select Rows**.
6. Use **New Query** para rodar `test/consultas.sql`.

> O banco `lucas_epstein` foi criado por `npm run migrate` dentro dessa mesma conexão (porta 3306). Se não aparecer, rode `npm run migrate` no terminal e clique em **Refresh** na extensão.

## `.env`

```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=escola
DB_NAME=lucas_epstein
JWT_SECRET=troque_esta_chave_por_uma_chave_bem_longa
```

## Rotas da API

### Públicas

| Método | Rota | Descrição | AV |
| --- | --- | --- | --- |
| `POST` | `/cliente` | Cadastro de cliente | AV1 |
| `POST` | `/login` | Login; retorna `{ nome, token }` | AV1 |
| `GET` | `/produtos` | Produtos com filtros e paginação | AV2 |
| `GET` | `/produtos/:id` | Detalhes do produto | AV2 |
| `GET` | `/produtos/:id/imagem` | Imagem servida pela API | AV3 |
| `GET` | `/categorias` | Categorias | AV2 |
| `GET` | `/lojas` | Lojas | AV3 |

Filtros: `busca`, `categoria`, `loja`, `preco_min`, `preco_max`, `ordenar`, `pagina`.  
Cabeçalhos: `X-Total-Count`, `X-Total-Pages`, `X-Pagina`.

### Protegidas (`Authorization: Bearer <token>`)

| Método | Rota | Descrição | AV |
| --- | --- | --- | --- |
| `GET` | `/cliente/perfil` | Perfil sem senha | AV1 |
| `POST` | `/compras` | Compra com vários produtos | AV3 |
| `GET` | `/compras` | Histórico do usuário | AV3 |
| `GET` | `/compras/:id` | Uma compra | AV3 |
| `GET` | `/loja/minha` | Loja do usuário | — |
| `POST` | `/loja` | Cria loja | — |
| `PUT` | `/loja/minha` | Atualiza loja | — |
| `GET` | `/loja/produtos` | Produtos da loja | — |
| `POST` | `/loja/produtos` | Cadastra produto | AV3 |
| `PUT` | `/loja/produtos/:id/imagem` | Atualiza imagem | AV3 |
| `DELETE` | `/loja/produtos/:id` | Remove produto | — |

Exemplo de compra:

```bash
curl -X POST http://localhost:3000/compras \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"itens":[{"produto_id":1,"quantidade":2},{"produto_id":2,"quantidade":1}]}'
```

Transação com `FOR UPDATE`, baixa de estoque e rollback em caso de erro. Sem token → `401`.

## Imagens

Salvas fora do repositório (ex.: Google Drive). A API faz proxy em `/produtos/:id/imagem`; o front-end usa essa rota.

## Front-end

`index.html` (cadastro), `login.html`, `loja.html` (vitrine + filtros + carrinho LocalStorage + compra), `perfil.html`, `carrinho.js`, `endereco.js`.

## Scripts

| Comando | Função |
| --- | --- |
| `npm run migrate` | cria/atualiza o banco |
| `npm run seed` | dados de demonstração |
| `npm start` | inicia a API |
| `npm run test:smoke` | testa as rotas (com a API rodando) |
