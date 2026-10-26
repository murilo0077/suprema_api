const db = require('./db');

async function criarTabelas() {
    try {
        console.log("Iniciando a migração do banco de dados...");

        await db.pool.query(`
            CREATE TABLE IF NOT EXISTS cliente (
                id INT AUTO_INCREMENT PRIMARY KEY,
                nome VARCHAR(100) NOT NULL,
                cpf VARCHAR(14) NOT NULL UNIQUE,
                nascimento DATE NULL,
                cep VARCHAR(9) NULL,
                rua VARCHAR(150) NULL,
                numero VARCHAR(20) NULL,
                bairro VARCHAR(100) NULL,
                cidade VARCHAR(100) NULL,
                uf CHAR(2) NULL,
                celular VARCHAR(20) NOT NULL,
                email VARCHAR(100) NOT NULL UNIQUE,
                senha VARCHAR(512) NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
        `);
        console.log("✅ Tabela 'cliente' criada com sucesso!");

        // Cada cliente pode ter no máximo UMA loja (cliente_id UNIQUE)
        await db.pool.query(`
            CREATE TABLE IF NOT EXISTS loja (
                id INT AUTO_INCREMENT PRIMARY KEY,
                cliente_id INT NOT NULL UNIQUE,
                nome VARCHAR(100) NOT NULL,
                descricao VARCHAR(255) NULL,
                criada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (cliente_id) REFERENCES cliente(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
        `);
        console.log("✅ Tabela 'loja' criada com sucesso!");

        await db.pool.query(`
            CREATE TABLE IF NOT EXISTS produto (
                id INT AUTO_INCREMENT PRIMARY KEY,
                loja_id INT NOT NULL,
                nome VARCHAR(120) NOT NULL,
                descricao VARCHAR(255) NULL,
                categoria VARCHAR(60) NULL,
                preco DECIMAL(10,2) NOT NULL,
                estoque INT NOT NULL DEFAULT 0,
                criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (loja_id) REFERENCES loja(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
        `);
        console.log("✅ Tabela 'produto' criada com sucesso!");

        // Atualiza bancos já criados (adiciona a coluna categoria)
        try {
            await db.pool.query(`ALTER TABLE produto ADD COLUMN categoria VARCHAR(60) NULL AFTER descricao`);
            console.log("✅ Coluna 'categoria' adicionada à tabela 'produto'!");
        } catch (error) {
            if (error.code !== 'ER_DUP_FIELDNAME') {
                throw error;
            }
            console.log("ℹ️ Coluna 'categoria' já existe na tabela 'produto'.");
        }

        process.exit(0);
    } catch (error) {
        console.error("❌ Erro durante a migration:", error.message);
        process.exit(1);
    }
}

criarTabelas();
