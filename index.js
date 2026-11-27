require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const port = process.env.PORT || 3000;
const PRODUTOS_POR_PAGINA = 10;
const TAMANHO_MAXIMO_IMAGEM = 12 * 1024 * 1024; // 12 MB
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Imagens ficam em uploads/ (fora do repositório), nunca em public/.
const MIME_IMAGENS = Object.freeze({
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
});
const TIPOS_IMAGEM = Object.freeze({
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp'
});
const FORMAS_PAGAMENTO = ['PIX', 'CARTAO', 'BOLETO'];
const COOKIE_SESSAO = 'bf_sessao';
const VALIDADE_TOKEN_MS = 60 * 60 * 1000; // 1 hora

app.use(express.json());
app.use(cors({
    origin: true,
    credentials: true,
    exposedHeaders: ['X-Total-Count', 'X-Total-Pages', 'X-Pagina']
}));

// A tela principal é a vitrine; cadastro e login continuam em /index.html e /login.html
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'loja.html')));
app.use(express.static(path.join(__dirname, 'public')));

function tokenDoCookie(req) {
    const cookie = String(req.headers.cookie || '');
    const encontrado = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_SESSAO}=([^;]+)`));
    if (!encontrado) return null;
    try {
        return decodeURIComponent(encontrado[1]);
    } catch (error) {
        return encontrado[1];
    }
}

function tokensDaRequisicao(req) {
    const authHeader = String(req.headers['authorization'] || '');
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    // Cookie primeiro: funciona mesmo se o localStorage estiver em outra origem/porta.
    return [tokenDoCookie(req), bearer].filter(Boolean);
}

function verificarToken(token) {
    return new Promise((resolve) => {
        jwt.verify(token, process.env.JWT_SECRET, (erro, usuario) => resolve(erro ? null : usuario));
    });
}

async function autenticar(req, res, next) {
    if (!process.env.JWT_SECRET) {
        return res.status(500).json({ erro: "JWT_SECRET não configurado." });
    }

    const tokens = tokensDaRequisicao(req);
    if (tokens.length === 0) {
        return res.status(401).json({
            erro: "Token não enviado. Entre na conta ou use Authorization: Bearer <token>"
        });
    }

    for (const token of tokens) {
        const usuario = await verificarToken(token);
        if (usuario) {
            req.usuario = usuario;
            return next();
        }
    }

    return res.status(403).json({ erro: "Token inválido ou expirado. Entre novamente." });
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

function idGoogleDrive(valor) {
    try {
        const url = new URL(valor);
        const hosts = ['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com'];
        if (!hosts.includes(url.hostname)) return null;

        const trecho = url.pathname.match(/\/(?:file\/d|open|uc|download)\/([^/?#]+)/);
        const id = (trecho && trecho[1]) || url.searchParams.get('id');
        return id && /^[\w-]+$/.test(id) ? id : null;
    } catch (error) {
        return null;
    }
}

function urlImagemDireta(valor) {
    const id = idGoogleDrive(valor);
    if (id) {
        // link público de download direto do Drive (o /uc?export=view retorna HTML em muitos casos)
        return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=view&authuser=0`;
    }
    return valor;
}

function urlComConfirmacao(valor) {
    try {
        const url = new URL(valor);
        url.searchParams.set('confirm', 't');
        return url.toString();
    } catch (error) {
        return valor;
    }
}

function normalizarFormaPagamento(valor) {
    const texto = String(valor === undefined || valor === null ? 'PIX' : valor)
        .trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[\s_-]/g, '');

    if (!texto) return 'PIX';
    if (['CARTAODECREDITO', 'CARTAODEDEBITO', 'CREDITO', 'DEBITO'].includes(texto)) {
        return 'CARTAO';
    }
    return FORMAS_PAGAMENTO.includes(texto) ? texto : null;
}

function imagemValida(buffer, tipo) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;

    if (tipo === 'image/jpeg') {
        return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    if (tipo === 'image/png') {
        return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (tipo === 'image/gif') {
        return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
    }
    if (tipo === 'image/webp') {
        return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
            && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    }
    return false;
}

function caminhoImagemLocal(arquivo) {
    // basename impede que um valor do banco acesse arquivos fora de uploads/.
    return path.join(UPLOAD_DIR, path.basename(String(arquivo)));
}

function imagemPadrao(nome) {
    const texto = String(nome || 'Sem imagem')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>&"']/g, ' ')
        .slice(0, 30);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
  <rect width="600" height="400" fill="#e5e7eb"/>
  <rect x="120" y="120" width="360" height="160" rx="12" fill="#cbd5e1"/>
  <circle cx="230" cy="175" r="24" fill="#94a3b8"/>
  <path d="M150 255l80-80 55 55 45-40 120 65z" fill="#94a3b8"/>
  <text x="300" y="330" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#475569">${texto}</text>
</svg>`;
    return Buffer.from(svg);
}

function enviarImagemPadrao(res, nome) {
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'public, max-age=60');
    return res.status(200).send(imagemPadrao(nome));
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
            let tamanho = 0;
            resposta.on('data', (parte) => {
                tamanho += parte.length;
                if (tamanho > TAMANHO_MAXIMO_IMAGEM) {
                    requisicao.destroy(new Error('Imagem muito grande'));
                    return;
                }
                partes.push(parte);
            });
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
        const cliente = req.body || {};

        if (!cliente.email || !cliente.senha || !cliente.cpf || !cliente.nome) {
            return res.status(400).json({ erro: "Nome, CPF, e-mail e senha são obrigatórios." });
        }
        if (String(cliente.senha).length < 4) {
            return res.status(400).json({ erro: "A senha deve ter pelo menos 4 caracteres." });
        }
        if (String(cliente.cpf).replace(/\D/g, '').length !== 11) {
            return res.status(400).json({ erro: "Informe um CPF com 11 dígitos." });
        }

        const email = String(cliente.email).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ erro: "E-mail inválido." });
        }

        if (cliente.nascimento && Number.isNaN(new Date(cliente.nascimento).getTime())) {
            return res.status(400).json({ erro: "Data de nascimento inválida." });
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
                email,
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
        const { email, senha } = req.body || {};

        if (!email || !senha) {
            return res.status(400).json({ erro: "Informe email e senha." });
        }
        if (!process.env.JWT_SECRET) {
            return res.status(500).json({ erro: "JWT_SECRET não configurado." });
        }

        const [linhas] = await db.pool.query(
            "SELECT id, nome, email, senha FROM cliente WHERE email = ?",
            [String(email).trim().toLowerCase()]
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

        // Cookie complementa o localStorage: a sessão sobrevive se a loja abrir em outra origem/porta.
        res.cookie(COOKIE_SESSAO, token, {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: VALIDADE_TOKEN_MS,
            path: '/'
        });

        return res.status(200).json({ nome: dados_bd.nome, token: token });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Consulta leve de sessão: usada pelo front para saber se está logado mesmo sem localStorage.
app.get("/cliente/sessao", async (req, res) => {
    if (!process.env.JWT_SECRET) {
        return res.status(200).json({ autenticado: false });
    }

    for (const token of tokensDaRequisicao(req)) {
        const usuario = await verificarToken(token);
        if (usuario) {
            const [linhas] = await db.pool.query("SELECT nome FROM cliente WHERE id = ?", [usuario.id]);
            return res.status(200).json({
                autenticado: true,
                nome: linhas.length > 0 ? linhas[0].nome : null
            });
        }
    }

    return res.status(200).json({ autenticado: false });
});

app.post("/logout", (req, res) => {
    res.clearCookie(COOKIE_SESSAO, { path: '/' });
    res.status(200).json({ msg: "Sessão encerrada." });
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
        const whereSql = filtros.length > 0 ? ` WHERE ${filtros.join(' AND ')}` : '';

        if (whereSql) {
            sql += whereSql;
        }

        const [contagem] = await db.pool.query(
            `SELECT COUNT(*) AS total FROM produto p JOIN loja l ON l.id = p.loja_id${whereSql}`,
            params
        );
        const totalProdutos = Number(contagem[0].total);

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
        res.set('X-Total-Count', String(totalProdutos));
        res.set('X-Total-Pages', String(Math.max(1, Math.ceil(totalProdutos / PRODUTOS_POR_PAGINA))));
        res.set('X-Pagina', String(pagina));
        res.status(200).json(produtos);
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
}

app.get("/produtos", listarProdutos);
app.get("/produto", listarProdutos);

app.get("/categorias", async (req, res) => {
    try {
        const [linhas] = await db.pool.query(
            `SELECT DISTINCT categoria FROM produto
             WHERE categoria IS NOT NULL AND categoria <> '' ORDER BY categoria`
        );
        res.status(200).json(linhas.map((linha) => linha.categoria));
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

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
            "SELECT nome, imagem_url, imagem_arquivo FROM produto WHERE id = ?",
            [id]
        );

        if (linhas.length === 0) {
            return res.status(404).json({ erro: "Produto não encontrado." });
        }

        const produto = linhas[0];

        // Prioridade: arquivo salvo no servidor (upload). Depois, URL externa (ex.: Drive).
        let imagemUrl = produto.imagem_url;
        if (produto.imagem_arquivo) {
            try {
                const arquivo = caminhoImagemLocal(produto.imagem_arquivo);
                const conteudo = await fs.promises.readFile(arquivo);
                const extensao = path.extname(arquivo).toLowerCase();
                res.set('Content-Type', MIME_IMAGENS[extensao] || 'application/octet-stream');
                res.set('Cache-Control', 'public, max-age=300');
                return res.status(200).send(conteudo);
            } catch (error) {
                // Arquivo removido: tenta a URL externa ou entrega a imagem padrão.
                imagemUrl = null;
            }
        }

        if (!imagemUrl) {
            return enviarImagemPadrao(res, produto.nome);
        }

        const destino = urlImagemDireta(imagemUrl);
        let resposta = await buscarImagem(destino);
        let tipo = resposta.headers['content-type'] || '';

        // O Drive pode devolver uma página de confirmação ( HTML ) antes da imagem.
        if ((resposta.status < 200 || resposta.status >= 300 || !tipo.startsWith('image/'))
            && idGoogleDrive(imagemUrl)) {
            resposta = await buscarImagem(urlComConfirmacao(destino));
            tipo = resposta.headers['content-type'] || '';
        }

        // Link externo quebrado não deve deixar o catálogo sem imagem.
        if (resposta.status < 200 || resposta.status >= 300 || !tipo.startsWith('image/')) {
            return enviarImagemPadrao(res, produto.nome);
        }

        res.set('Content-Type', tipo);
        res.set('Cache-Control', 'public, max-age=300');
        res.status(200).send(resposta.body);
    } catch (error) {
        return enviarImagemPadrao(res, 'Sem imagem');
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

        // affectedRows conta apenas linhas ALTERADAS; se os dados forem iguais ele é 0.
        const [lojas] = await db.pool.query("SELECT id FROM loja WHERE cliente_id = ?", [req.usuario.id]);
        if (lojas.length === 0) return res.status(404).json({ erro: "Você ainda não tem loja." });

        await db.pool.query(
            "UPDATE loja SET nome = ?, descricao = ? WHERE cliente_id = ?",
            [nome, descricao || null, req.usuario.id]
        );
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

        const [produtos] = await db.pool.query(
            `SELECT p.id FROM produto p JOIN loja l ON l.id = p.loja_id
             WHERE p.id = ? AND l.cliente_id = ?`,
            [id, req.usuario.id]
        );
        if (produtos.length === 0) {
            return res.status(404).json({ erro: "Produto não encontrado na sua loja." });
        }

        await db.pool.query(
            "UPDATE produto SET imagem_url = ?, imagem_arquivo = NULL WHERE id = ?",
            [imagem_url, id]
        );
        res.status(200).json({ msg: "Imagem atualizada!", imagem_url });
    } catch (error) {
        res.status(500).json({ erro: error.message });
    }
});

// Upload binário: o arquivo fica em uploads/ (fora do Git) e é servido por /produtos/:id/imagem.
app.post(
    "/loja/produtos/:id/imagem",
    autenticar,
    express.raw({ type: Object.values(TIPOS_IMAGEM), limit: TAMANHO_MAXIMO_IMAGEM }),
    async (req, res) => {
        const id = numeroInteiro(req.params.id);
        if (!id || id <= 0) {
            return res.status(400).json({ erro: "ID inválido." });
        }

        const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const extensao = TIPOS_IMAGEM[tipo];
        if (!extensao || !imagemValida(req.body, tipo)) {
            return res.status(400).json({
                erro: "Envie uma imagem JPEG, PNG, GIF ou WebP no corpo da requisição."
            });
        }

        try {
            const [produtos] = await db.pool.query(
                `SELECT p.id FROM produto p JOIN loja l ON l.id = p.loja_id
                 WHERE p.id = ? AND l.cliente_id = ?`,
                [id, req.usuario.id]
            );
            if (produtos.length === 0) {
                return res.status(404).json({ erro: "Produto não encontrado na sua loja." });
            }

            const nomeArquivo = crypto.randomBytes(12).toString('hex') + extensao;
            const caminho = caminhoImagemLocal(nomeArquivo);
            await fs.promises.writeFile(caminho, req.body);

            try {
                await db.pool.query(
                    "UPDATE produto SET imagem_arquivo = ?, imagem_url = NULL WHERE id = ?",
                    [nomeArquivo, id]
                );
            } catch (erroBanco) {
                await fs.promises.unlink(caminho).catch(() => {});
                throw erroBanco;
            }

            return res.status(200).json({
                msg: "Imagem salva no servidor!",
                arquivo: nomeArquivo,
                imagem: `/produtos/${id}/imagem`
            });
        } catch (error) {
            console.error('Erro ao salvar imagem:', error);
            return res.status(500).json({ erro: "Não foi possível salvar a imagem." });
        }
    }
);

app.delete("/loja/produtos/:id", autenticar, async (req, res) => {
    try {
        const id = numeroInteiro(req.params.id);
        if (!id || id <= 0) {
            return res.status(400).json({ erro: "ID inválido." });
        }

        const [produtos] = await db.pool.query(
            `SELECT p.id, p.imagem_arquivo FROM produto p JOIN loja l ON l.id = p.loja_id
             WHERE p.id = ? AND l.cliente_id = ?`,
            [id, req.usuario.id]
        );
        if (produtos.length === 0) {
            return res.status(404).json({ erro: "Produto não encontrado na sua loja." });
        }

        await db.pool.query("DELETE FROM produto WHERE id = ?", [id]);
        if (produtos[0].imagem_arquivo) {
            await fs.promises.unlink(caminhoImagemLocal(produtos[0].imagem_arquivo)).catch(() => {});
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

    const formaPagamento = normalizarFormaPagamento(
        req.body && req.body.forma_pagamento !== undefined
            ? req.body.forma_pagamento
            : (req.body && req.body.pagamento)
    );
    if (!formaPagamento) {
        return res.status(400).json({ erro: "Forma de pagamento inválida. Use PIX, CARTAO ou BOLETO." });
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
            "INSERT INTO compra (cliente_id, total, forma_pagamento) VALUES (?, ?, ?)",
            [req.usuario.id, total, formaPagamento]
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
            forma_pagamento: formaPagamento,
            pagamento_simulado: true,
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
        console.error('Erro ao registrar compra:', error);
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
            `SELECT c.id AS compra_id, c.total, c.criado_em, c.forma_pagamento,
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
                    forma_pagamento: linha.forma_pagamento || 'PIX',
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

// Erros do express.raw (upload) também viram JSON.
app.use((erro, req, res, next) => {
    if (erro.type === 'entity.too.large') {
        return res.status(413).json({ erro: "Imagem muito grande. Limite: 12 MB." });
    }
    console.error('Erro na API:', erro);
    return res.status(500).json({ erro: "Erro interno no servidor." });
});

if (require.main === module) {
    const servidor = app.listen(port, () => {
        console.log(`API rodando na porta ${port}`);
    });

    servidor.on('error', (erro) => {
        if (erro.code === 'EADDRINUSE') {
            console.error(`❌ A porta ${port} já está em uso.`);
            console.error('   Rode: ss -ltnp | grep 3000  (ou lsof -i :3000) para ver o processo.');
            console.error('   Encerre a instância antiga com: kill <PID> e rode npm start novamente.');
            process.exit(1);
        }
        throw erro;
    });
}

module.exports = app;
