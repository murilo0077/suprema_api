require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const https = require('https');
const db = require('./db');

const app = express();
const port = process.env.PORT || 3000;
const PRODUTOS_POR_PAGINA = 10;

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

function autenticar(req, res, next) {
    if (!process.env.JWT_SECRET) {
        return res.status(500).json({ erro: "JWT_SECRET não configurado." });
    }

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

function numeroInteiro(valor) {
    const n = Number(valor);
    return Number.isInteger(n) ? n : null;
}

function normalizarImagemUrl(valor) {
    const texto = String(valor || '').trim();
    if (!texto) return null;

    try {
        const url = new URL(texto);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        return url.toString();
    } catch (error) {
        return null;
    }
}

function urlImagemDireta(valor) {
    try {
        const url = new URL(valor);
        if (url.hostname === 'drive.google.com') {
            const fileId = (url.pathname.match(/\/file\/d\/([^/]+)/) || [])[1]
                || url.searchParams.get('id');

            if (fileId) {
                return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
            }
        }
        return valor;
    } catch (error) {
        return valor;
    }
}

function buscarImagem(url, redirecionamentos = 0) {
    return new Promise((resolve, reject) => {
        if (redirecionamentos > 4) {
            return reject(new Error('Muitos redirecionamentos'));
        }

        let destino;
        try {
            destino = new URL(url);
        } catch (error) {
            return reject(new Error('URL inválida'));
        }

        if (!['http:', 'https:'].includes(destino.protocol)) {
            return reject(new Error('Protocolo inválido'));
        }

        const cliente = destino.protocol === 'https:' ? https : http;
        const requisicao = cliente.get(destino, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        }, (resposta) => {
            const status = resposta.statusCode || 0;

            if (status >= 300 && status < 400 && resposta.headers.location) {
                resposta.resume();
                const proxima = new URL(resposta.headers.location, destino).toString();
                return buscarImagem(proxima, redirecionamentos + 1).then(resolve, reject);
            }

            const partes = [];
            resposta.on('data', (parte) => partes.push(parte));
            resposta.on('error', reject);
            resposta.on('end', () => resolve({
                status,
                headers: resposta.headers,
                body: Buffer.concat(partes)
            }));
        });

        requisicao.setTimeout(10000, () => requisicao.destroy(new Error('Tempo esgotado')));
        requisicao.on('error', reject);
    });
}

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

async function listarProdutos(req, res) {
    try {
        const busca = (req.query.busca || '').trim();
        const categoria = (req.query.categoria || '').trim();
        const ordenar = (req.query.ordenar || '').trim();
        const lojaId = numeroInteiro(req.query.loja);
        const precoMin = req.query.preco_min === '' || req.query.preco_min === undefined
            ? NaN : Number(req.query.preco_min);
        const precoMax = req.query.preco_max === '' || req.query.preco_max === undefined
            ? NaN : Number(req.query.preco_max);
        const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);

        let sql = `SELECT p.id, p.nome, p.descricao, p.categoria, p.preco, p.estoque,
                          p.imagem_url, l.id AS loja_id, l.nome AS loja_nome
                   FROM produto p JOIN loja l ON l.id = p.loja_id`;
        const filtros = [];
        const params = [];

        if (busca) {
            filtros.push(`(p.nome LIKE ? OR p.descricao LIKE ? OR l.nome LIKE ?)`);
            params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
        }
        if (categoria) {
            filtros.push(`p.categoria = ?`);
            params.push(categoria);
        }
        if (lojaId && lojaId > 0) {
            filtros.push(`l.id = ?`);
            params.push(lojaId);
        }
        if (Number.isFinite(precoMin) && precoMin >= 0) {
            filtros.push(`p.preco >= ?`);
            params.push(precoMin);
        }
        if (Number.isFinite(precoMax) && precoMax >= 0) {
            filtros.push(`p.preco <= ?`);
            params.push(precoMax);
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
        const produtos = linhas.map((produto) => ({
            ...produto,
            imagem: `/produtos/${produto.id}/imagem`
        }));
        res.status(200).json(produtos);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
}

app.get("/produtos", listarProdutos);
app.get("/produto", listarProdutos);

app.get("/produtos/:id", async (req, res) => {
    try {
        const id = numeroInteiro(req.params.id);
        if (!id || id <= 0) {
            return res.status(400).json({ erro: "ID inválido." });
        }

        const [linhas] = await db.pool.query(
            `SELECT p.id, p.nome, p.descricao, p.categoria, p.preco, p.estoque,
                    p.imagem_url, l.id AS loja_id, l.nome AS loja_nome
             FROM produto p JOIN loja l ON l.id = p.loja_id
             WHERE p.id = ?`,
            [id]
        );

        if (linhas.length === 0) {
            return res.status(404).json({ erro: "Produto não encontrado." });
        }

        res.status(200).json({
            ...linhas[0],
            imagem: `/produtos/${linhas[0].id}/imagem`
        });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

async function enviarImagemProduto(req, res) {
    try {
        const id = numeroInteiro(req.params.id);
        if (!id || id <= 0) {
            return res.status(400).json({ erro: "ID inválido." });
        }

        const [linhas] = await db.pool.query(
            "SELECT imagem_url FROM produto WHERE id = ?",
            [id]
        );

        if (linhas.length === 0 || !linhas[0].imagem_url) {
            return res.status(404).json({ erro: "Produto sem imagem cadastrada." });
        }

        const destino = urlImagemDireta(linhas[0].imagem_url);
        const resposta = await buscarImagem(destino);

        if (resposta.status < 200 || resposta.status >= 300) {
            return res.status(502).json({ erro: "Não foi possível carregar a imagem." });
        }

        const tipo = resposta.headers['content-type'] || 'image/jpeg';
        if (!tipo.startsWith('image/')) {
            return res.status(502).json({ erro: "O endereço informado não retornou uma imagem." });
        }

        res.set('Content-Type', tipo);
        res.set('Cache-Control', 'public, max-age=300');
        res.status(200).send(resposta.body);
    } catch (error) {
        res.status(502).json({ erro: "Não foi possível carregar a imagem." });
    }
}

app.get("/produtos/:id/imagem", enviarImagemProduto);
app.get("/produto/:id/imagem", enviarImagemProduto);

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

app.get("/loja/produtos", autenticar, async (req, res) => {
    try {
        const [linhas] = await db.pool.query(
            `SELECT p.id, p.nome, p.descricao, p.categoria, p.preco, p.estoque, p.imagem_url
             FROM produto p JOIN loja l ON l.id = p.loja_id
             WHERE l.cliente_id = ? ORDER BY p.id DESC`,
            [req.usuario.id]
        );
        res.status(200).json(linhas);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.post("/loja/produtos", autenticar, async (req, res) => {
    try {
        const nome = (req.body.nome || '').trim();
        const descricao = (req.body.descricao || '').trim();
        const categoria = (req.body.categoria || '').trim();
        const preco = Number(req.body.preco);
        const estoque = parseInt(req.body.estoque, 10) || 0;
        const imagemInformada = req.body.imagem_url || req.body.imagem || '';
        const imagem_url = normalizarImagemUrl(imagemInformada);

        if (!nome || !Number.isFinite(preco) || preco < 0) {
            return res.status(400).json({ erro: "Informe nome e um preço válido." });
        }
        if (estoque < 0) {
            return res.status(400).json({ erro: "Estoque não pode ser negativo." });
        }
        if (imagemInformada && !imagem_url) {
            return res.status(400).json({ erro: "URL da imagem inválida." });
        }

        const [lojas] = await db.pool.query("SELECT id FROM loja WHERE cliente_id = ?", [req.usuario.id]);
        if (lojas.length === 0) {
            return res.status(400).json({ erro: "Crie sua loja antes de cadastrar produtos." });
        }

        const [r] = await db.pool.query(
            "INSERT INTO produto (loja_id, nome, descricao, categoria, preco, estoque, imagem_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [lojas[0].id, nome, descricao || null, categoria || null, preco, estoque, imagem_url]
        );
        res.status(201).json({ msg: "Produto adicionado!", id: r.insertId });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

app.put("/loja/produtos/:id/imagem", autenticar, async (req, res) => {
    try {
        const id = numeroInteiro(req.params.id);
        if (!id || id <= 0) {
            return res.status(400).json({ erro: "ID inválido." });
        }

        const imagemInformada = req.body.imagem_url || req.body.imagem || '';
        const imagem_url = normalizarImagemUrl(imagemInformada);

        if (imagemInformada && !imagem_url) {
            return res.status(400).json({ erro: "URL da imagem inválida." });
        }

        const [r] = await db.pool.query(
            `UPDATE produto p JOIN loja l ON l.id = p.loja_id
             SET p.imagem_url = ?
             WHERE p.id = ? AND l.cliente_id = ?`,
            [imagem_url, id, req.usuario.id]
        );

        if (r.affectedRows === 0) {
            return res.status(404).json({ erro: "Produto não encontrado na sua loja." });
        }

        res.status(200).json({ msg: "Imagem atualizada!", imagem_url });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

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
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ erro: "Este produto já foi comprado e não pode ser removido." });
        }
        res.status(500).json({ erro: error.message });
    }
});

function validarItensCompra(corpo) {
    let bruto = null;

    if (!corpo || typeof corpo !== 'object') {
        return { erro: 'Envie a lista de produtos em "itens".' };
    }

    if (Array.isArray(corpo)) {
        bruto = corpo;
    } else if (Array.isArray(corpo.itens)) {
        bruto = corpo.itens;
    } else if (Array.isArray(corpo.produtos)) {
        bruto = corpo.produtos;
    }

    if (!bruto) {
        return { erro: 'Envie a lista de produtos em "itens".' };
    }
    if (bruto.length === 0) {
        return { erro: 'A lista de produtos não pode estar vazia.' };
    }

    const mapa = new Map();

    for (const item of bruto) {
        if (!item || typeof item !== 'object') {
            return { erro: 'Cada item deve ser um objeto com produto_id e quantidade.' };
        }

        const produtoBruto = item.produto_id !== undefined
            ? item.produto_id
            : (item.produtoId !== undefined ? item.produtoId : item.id);
        const quantidadeBruta = item.quantidade !== undefined
            ? item.quantidade
            : (item.qtd !== undefined ? item.qtd : item.quantity);
        const produto_id = numeroInteiro(produtoBruto);
        const quantidade = numeroInteiro(quantidadeBruta);

        if (!produto_id || produto_id <= 0) {
            return { erro: 'Informe um produto_id válido em todos os itens.' };
        }
        if (!quantidade || quantidade <= 0) {
            return { erro: 'Informe uma quantidade inteira maior que zero em todos os itens.' };
        }

        mapa.set(produto_id, (mapa.get(produto_id) || 0) + quantidade);
    }

    return { mapa };
}

app.post("/compras", autenticar, async (req, res) => {
    const { mapa, erro } = validarItensCompra(req.body);
    if (erro) {
        return res.status(400).json({ erro });
    }

    let conexao = null;

    try {
        conexao = await db.pool.getConnection();
        await conexao.beginTransaction();

        const ids = Array.from(mapa.keys());
        const placeholders = ids.map(() => '?').join(',');
        const [produtos] = await conexao.query(
            `SELECT id, nome, preco, estoque FROM produto WHERE id IN (${placeholders}) FOR UPDATE`,
            ids
        );

        const porId = new Map(produtos.map((produto) => [produto.id, produto]));
        const itens = [];
        let total = 0;

        for (const [produto_id, quantidade] of mapa) {
            const produto = porId.get(produto_id);

            if (!produto) {
                await conexao.rollback();
                return res.status(404).json({ erro: `Produto ${produto_id} não encontrado.` });
            }

            if (Number(produto.estoque) < quantidade) {
                await conexao.rollback();
                return res.status(409).json({ erro: `Estoque insuficiente para ${produto.nome}.` });
            }

            const preco = Number(produto.preco);
            const subtotal = Number((preco * quantidade).toFixed(2));
            total += subtotal;

            itens.push({
                produto_id,
                nome_produto: produto.nome,
                preco_unitario: preco,
                quantidade,
                subtotal
            });
        }

        total = Number(total.toFixed(2));

        const [compra] = await conexao.query(
            "INSERT INTO compra (cliente_id, total) VALUES (?, ?)",
            [req.usuario.id, total]
        );

        const compra_id = compra.insertId;

        for (const item of itens) {
            await conexao.query(
                `INSERT INTO compra_item
                 (compra_id, produto_id, nome_produto, preco_unitario, quantidade, subtotal)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [compra_id, item.produto_id, item.nome_produto, item.preco_unitario, item.quantidade, item.subtotal]
            );

            await conexao.query(
                "UPDATE produto SET estoque = estoque - ? WHERE id = ?",
                [item.quantidade, item.produto_id]
            );
        }

        await conexao.commit();

        return res.status(201).json({
            id: compra_id,
            total,
            itens
        });
    } catch (error) {
        if (conexao) {
            try {
                await conexao.rollback();
            } catch (rollbackError) {
                void rollbackError;
            }
        }
        return res.status(500).json({ erro: "Não foi possível registrar a compra." });
    } finally {
        if (conexao) conexao.release();
    }
});

async function consultarCompras(req, res, compraId) {
    try {
        const params = compraId ? [req.usuario.id, compraId] : [req.usuario.id];
        const filtro = compraId ? " AND c.id = ?" : "";

        const [linhas] = await db.pool.query(
            `SELECT c.id AS compra_id, c.total, c.criado_em,
                    ci.id AS item_id, ci.produto_id, ci.nome_produto,
                    ci.quantidade, ci.preco_unitario, ci.subtotal,
                    p.imagem_url
             FROM compra c
             JOIN compra_item ci ON ci.compra_id = c.id
             LEFT JOIN produto p ON p.id = ci.produto_id
             WHERE c.cliente_id = ?${filtro}
             ORDER BY c.id DESC, ci.id ASC`,
            params
        );

        if (compraId && linhas.length === 0) {
            return res.status(404).json({ erro: "Compra não encontrada." });
        }

        const compras = new Map();

        for (const linha of linhas) {
            if (!compras.has(linha.compra_id)) {
                compras.set(linha.compra_id, {
                    id: linha.compra_id,
                    total: Number(linha.total),
                    criado_em: linha.criado_em,
                    itens: []
                });
            }

            compras.get(linha.compra_id).itens.push({
                id: linha.item_id,
                produto_id: linha.produto_id,
                nome_produto: linha.nome_produto,
                quantidade: linha.quantidade,
                preco_unitario: Number(linha.preco_unitario),
                subtotal: Number(linha.subtotal),
                imagem_url: linha.imagem_url || null,
                imagem: `/produtos/${linha.produto_id}/imagem`
            });
        }

        return res.status(200).json(Array.from(compras.values()));
    } catch (error) {
        return res.status(500).json({ erro: error.message });
    }
}

app.get("/compras", autenticar, (req, res) => consultarCompras(req, res, null));
app.get("/compras/:id", autenticar, (req, res) => {
    const id = numeroInteiro(req.params.id);
    if (!id || id <= 0) {
        return res.status(400).json({ erro: "ID inválido." });
    }
    return consultarCompras(req, res, id);
});

app.listen(port, () => {
    console.log(`API rodando na porta ${port}`);
});
