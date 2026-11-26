require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const EMAIL_DEMO = 'demo@byteforge.com';
const SENHA_DEMO = '123456';

const produtos = [
    { nome: 'Placa de Vídeo RTX 4060', descricao: '8GB GDDR6, PCIe 4.0', categoria: 'Hardware', preco: 2299.90, estoque: 8, texto: 'RTX 4060' },
    { nome: 'Processador Ryzen 5 7600', descricao: '6 núcleos / 12 threads, AM5', categoria: 'Hardware', preco: 1299.00, estoque: 12, texto: 'Ryzen 5' },
    { nome: 'Memória DDR5 16GB 6000MHz', descricao: 'Kit com 2 pentes de 8GB', categoria: 'Hardware', preco: 389.90, estoque: 20, texto: 'DDR5 16GB' },
    { nome: 'Teclado Mecânico RGB', descricao: 'Switch blue, layout ABNT2', categoria: 'Periféricos', preco: 249.90, estoque: 15, texto: 'Teclado RGB' },
    { nome: 'Mouse Gamer 26K DPI', descricao: 'Sensor óptico, 7 botões programáveis', categoria: 'Periféricos', preco: 179.90, estoque: 25, texto: 'Mouse Gamer' },
    { nome: 'Monitor 27" 165Hz', descricao: 'IPS, 1ms, resolução 1440p', categoria: 'Periféricos', preco: 1699.00, estoque: 6, texto: 'Monitor 165Hz' },
    { nome: 'Fonte 650W 80 Plus Gold', descricao: 'Certificação 80 Plus Gold, modular', categoria: 'Hardware', preco: 459.00, estoque: 10, texto: 'Fonte 650W' },
    { nome: 'SSD NVMe 1TB', descricao: 'PCIe 3.0, leitura até 3500 MB/s', categoria: 'Armazenamento', preco: 429.90, estoque: 18, texto: 'SSD 1TB' }
];

function imagemExterna(texto) {
    // Imagem hospedada fora do GitHub; a API faz o proxy em /produtos/:id/imagem.
    return `https://placehold.co/600x400/0f172a/38bdf8?text=${encodeURIComponent(texto)}`;
}

async function seed() {
    try {
        console.log('Iniciando seed de demonstração...');

        let clienteId;
        const [clientes] = await db.pool.query('SELECT id FROM cliente WHERE email = ?', [EMAIL_DEMO]);

        if (clientes.length > 0) {
            clienteId = clientes[0].id;
            console.log('ℹ️ Cliente de demonstração já existe.');
        } else {
            const senhaCript = await bcrypt.hash(SENHA_DEMO, 10);
            const [resultado] = await db.pool.query(
                `INSERT INTO cliente (nome, cpf, nascimento, cep, rua, numero, bairro, cidade, uf, celular, email, senha)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    'Loja Demonstração', '123.456.789-09', '2000-01-01', '01001-000',
                    'Av. Paulista', '1000', 'Bela Vista', 'São Paulo', 'SP',
                    '(11) 99999-0000', EMAIL_DEMO, senhaCript
                ]
            );
            clienteId = resultado.insertId;
            console.log("✅ Cliente 'demo@byteforge.com' criado.");
        }

        let lojaId;
        const [lojas] = await db.pool.query('SELECT id FROM loja WHERE cliente_id = ?', [clienteId]);

        if (lojas.length > 0) {
            lojaId = lojas[0].id;
            console.log('ℹ️ Loja de demonstração já existe.');
        } else {
            const [resultado] = await db.pool.query(
                'INSERT INTO loja (cliente_id, nome, descricao) VALUES (?, ?, ?)',
                [clienteId, 'ByteForge Demo', 'Peças e periféricos para montar seu PC.']
            );
            lojaId = resultado.insertId;
            console.log("✅ Loja 'ByteForge Demo' criada.");
        }

        let criados = 0;
        for (const produto of produtos) {
            const [existentes] = await db.pool.query(
                'SELECT id FROM produto WHERE loja_id = ? AND nome = ?',
                [lojaId, produto.nome]
            );
            if (existentes.length > 0) continue;

            await db.pool.query(
                `INSERT INTO produto (loja_id, nome, descricao, categoria, preco, estoque, imagem_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    lojaId, produto.nome, produto.descricao, produto.categoria,
                    produto.preco, produto.estoque, imagemExterna(produto.texto)
                ]
            );
            criados++;
        }
        console.log(`✅ ${criados} produto(s) criado(s).`);
        console.log('\nLogin de demonstração:');
        console.log(`  E-mail: ${EMAIL_DEMO}`);
        console.log(`  Senha:  ${SENHA_DEMO}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Erro durante o seed:', error.stack || error.message);
        process.exit(1);
    }
}

seed();
