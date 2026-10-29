require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// ----------------- MIDDLEWARE DE AUTENTICAÇÃO -----------------
function autenticar(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({
            erro: "Token não enviado, usar Authorization: Bearer <token>"
        });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, usuario) => {
        if (err) {
            return res.status(403).json({ erro: "Token inválido ou expirado" });
        }
        req.usuario = usuario;
        next();
    });
}

// ----------------- ROTAS DA ATIVIDADE -----------------

// 1. Cadastro
app.post("/cliente", async (req, res) => {
    try {
        const cliente = req.body;

        if (!cliente.email || !cliente.senha || !cliente.cpf || !cliente.nome) {
            return res.status(400).json({ erro: "Nome, CPF, e-mail e senha são obrigatórios." });
        }

        const senhaCript = await bcrypt.hash(cliente.senha, 10);

        const [resultado] = await db.pool.query(
            `INSERT INTO cliente (
                nome, cpf, nascimento, cep, rua, numero, bairro, cidade, uf, celular, email, senha
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                cliente.nome,
                cliente.cpf,
                cliente.nascimento || null,
                cliente.cep || null,
                cliente.rua || null,
                cliente.numero || null,
                cliente.bairro || null,
                cliente.cidade || null,
                cliente.uf || null,
                cliente.celular || '',
                cliente.email,
                senhaCript
            ]
        );

        res.status(201).json({ msg: "Cliente cadastrado, ID = " + resultado.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ erro: "CPF ou E-mail já cadastrado no sistema." });
        }
        res.status(500).json({ erro: error.message });
    }
});

// 2. Login (gera JWT)
app.post("/login", async (req, res) => {
    try {
        const { email, senha } = req.body;

        if (!email || !senha) {
            return res.status(400).json({ erro: "Informe email e senha." });
        }

        const [linhas] = await db.pool.query(
            "SELECT id, nome, email, senha FROM cliente WHERE email = ?",
            [email]
        );

        const dados_bd = linhas[0];
        if (!dados_bd) {
            return res.status(401).json({ msg: "Email não cadastrado!" });
        }

        const senha_valida = await bcrypt.compare(senha, dados_bd.senha);
        if (!senha_valida) {
            return res.status(401).json({ msg: "Credenciais inválidas!" });
        }

        const payload = { id: dados_bd.id, email: dados_bd.email };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

        return res.status(200).json({ nome: dados_bd.nome, token: token });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// 3. Perfil (protegida)
app.get("/cliente/perfil", autenticar, async (req, res) => {
    try {
        const [linhas] = await db.pool.query("SELECT * FROM cliente WHERE id = ?", [req.usuario.id]);

        if (linhas.length === 0) {
            return res.status(404).json({ erro: "Cliente não encontrado" });
        }

        const perfil = { ...linhas[0] };
        delete perfil.senha;

        res.status(200).json(perfil);
    } catch (err) {
        res.status(500).json({ erro: "Erro interno no servidor" });
    }
});

// ----------------- LOJA -----------------

// Vitrine pública: todos os produtos de todas as lojas
// Filtros e paginação aceitos via query string:
//   ?busca=termo                  -> busca por nome do produto (ou loja)
//   ?ordenar=menor_preco          -> ordena do menor preço para o maior
//   ?ordenar=maior_preco          -> ordena do maior preço para o menor
//   ?categoria=processador        -> filtra pela categoria do produto
//   ?preco_min=200&preco_max=700  -> filtra pela faixa de preço
//   ?pagina=1                     -> página da consulta (10 produtos por página)
const PRODUTOS_POR_PAGINA = 10;

async function listarProdutos(req, res) {
    try {
        const busca = (req.query.busca || '').trim();
        const categoria = (req.query.categoria || '').trim();
        const ordenar = (req.query.ordenar || '').trim();
        // Vazio ("?preco_min=") é tratado como não informado
        const preco_min = req.query.preco_min ? Number(req.query.preco_min) : NaN;
        const preco_max = req.query.preco_max ? Number(req.query.preco_max) : NaN;
        const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);

        let sql = `SELECT p.id, p.nome, p.descricao, p.preco, p.estoque, p.categoria,
                          l.id AS loja_id, l.nome AS loja_nome
                   FROM produto p JOIN loja l ON l.id = p.loja_id`;
        const filtros = [];
        const params = [];

        if (busca) {
            filtros.push(`(p.nome LIKE ? OR l.nome LIKE ?)`);
            params.push(`%${busca}%`, `%${busca}%`);
        }
        if (categoria) {
            filtros.push(`p.categoria = ?`);
            params.push(categoria);
        }
        if (Number.isFinite(preco_min)) {
            filtros.push(`p.preco >= ?`);
            params.push(preco_min);
        }
        if (Number.isFinite(preco_max)) {
            filtros.push(`p.preco <= ?`);
            params.push(preco_max);
        }
        if (filtros.length > 0) {
            sql += ` WHERE ` + filtros.join(` AND `);
        }

        if (ordenar === 'menor_preco') {
            sql += ` ORDER BY p.preco ASC, p.id DESC`;
        } else if (ordenar === 'maior_preco') {
            sql += ` ORDER BY p.preco DESC, p.id DESC`;
        } else {
            sql += ` ORDER BY p.id DESC`;
        }

        sql += ` LIMIT ? OFFSET ?`;
        params.push(PRODUTOS_POR_PAGINA, (pagina - 1) * PRODUTOS_POR_PAGINA);

        const [linhas] = await db.pool.query(sql, params);
        res.status(200).json(linhas);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
}

app.get("/produtos", listarProdutos);
app.get("/produto", listarProdutos);

// Lojas existentes (pública)
app.get("/lojas", async (req, res) => {
    try {
        const [linhas] = await db.pool.query(
            `SELECT l.id, l.nome, l.descricao, c.nome AS dono,
                    (SELECT COUNT(*) FROM produto p WHERE p.loja_id = l.id) AS total_produtos
             FROM loja l JOIN cliente c ON c.id = l.cliente_id
             ORDER BY l.id DESC`
        );
        res.status(200).json(linhas);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Minha loja (retorna { loja: null } se ainda não criou)
app.get("/loja/minha", autenticar, async (req, res) => {
    try {
        const [linhas] = await db.pool.query(
            "SELECT id, nome, descricao, criada_em FROM loja WHERE cliente_id = ?",
            [req.usuario.id]
        );
        res.status(200).json({ loja: linhas[0] || null });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Criar loja (uma por cliente)
app.post("/loja", autenticar, async (req, res) => {
    try {
        const nome = (req.body.nome || '').trim();
        const descricao = (req.body.descricao || '').trim();

        if (!nome) {
            return res.status(400).json({ erro: "Informe o nome da loja." });
        }

        const [resultado] = await db.pool.query(
            "INSERT INTO loja (cliente_id, nome, descricao) VALUES (?, ?, ?)",
            [req.usuario.id, nome, descricao || null]
        );

        res.status(201).json({ msg: "Loja criada!", id: resultado.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ erro: "Você já possui uma loja." });
        }
        res.status(500).json({ erro: error.message });
    }
});

// Editar minha loja
app.put("/loja/minha", autenticar, async (req, res) => {
    try {
        const nome = (req.body.nome || '').trim();
        const descricao = (req.body.descricao || '').trim();
        if (!nome) return res.status(400).json({ erro: "Informe o nome da loja." });

        const [r] = await db.pool.query(
            "UPDATE loja SET nome = ?, descricao = ? WHERE cliente_id = ?",
            [nome, descricao || null, req.usuario.id]
        );
        if (r.affectedRows === 0) return res.status(404).json({ erro: "Você ainda não tem loja." });
        res.status(200).json({ msg: "Loja atualizada!" });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Produtos da minha loja
app.get("/loja/produtos", autenticar, async (req, res) => {
    try {
        const [linhas] = await db.pool.query(
            `SELECT p.id, p.nome, p.descricao, p.categoria, p.preco, p.estoque
             FROM produto p JOIN loja l ON l.id = p.loja_id
             WHERE l.cliente_id = ? ORDER BY p.id DESC`,
            [req.usuario.id]
        );
        res.status(200).json(linhas);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Adicionar produto à minha loja
app.post("/loja/produtos", autenticar, async (req, res) => {
    try {
        const nome = (req.body.nome || '').trim();
        const descricao = (req.body.descricao || '').trim();
        const categoria = (req.body.categoria || '').trim();
        const preco = Number(req.body.preco);
        const estoque = parseInt(req.body.estoque, 10) || 0;

        if (!nome || !Number.isFinite(preco) || preco < 0) {
            return res.status(400).json({ erro: "Informe nome e um preço válido." });
        }
        if (estoque < 0) {
            return res.status(400).json({ erro: "Estoque não pode ser negativo." });
        }

        const [lojas] = await db.pool.query("SELECT id FROM loja WHERE cliente_id = ?", [req.usuario.id]);
        if (lojas.length === 0) {
            return res.status(400).json({ erro: "Crie sua loja antes de cadastrar produtos." });
        }

        const [r] = await db.pool.query(
            "INSERT INTO produto (loja_id, nome, descricao, categoria, preco, estoque) VALUES (?, ?, ?, ?, ?, ?)",
            [lojas[0].id, nome, descricao || null, categoria || null, preco, estoque]
        );
        res.status(201).json({ msg: "Produto adicionado!", id: r.insertId });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Remover produto (só o dono da loja)
app.delete("/loja/produtos/:id", autenticar, async (req, res) => {
    try {
        const [r] = await db.pool.query(
            `DELETE p FROM produto p JOIN loja l ON l.id = p.loja_id
             WHERE p.id = ? AND l.cliente_id = ?`,
            [req.params.id, req.usuario.id]
        );
        if (r.affectedRows === 0) {
            return res.status(404).json({ erro: "Produto não encontrado na sua loja." });
        }
        res.status(200).json({ msg: "Produto removido!" });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.listen(port, () => {
    console.log(`API rodando na porta ${port}`);
});
