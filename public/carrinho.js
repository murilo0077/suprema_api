/* ============================================================
   carrinho.js — carrinho persistido no LocalStorage
   A chave byteforge_carrinho guarda apenas dados do produto
   (id, nome, preço, estoque e quantidade). Nenhuma imagem é
   salva no navegador: ela vem sempre da API (/produtos/:id/imagem).
   ============================================================ */
(function () {
  'use strict';

  const CHAVE = 'byteforge_carrinho';
  let itens = new Map(carregar());

  function carregar() {
    try {
      const bruto = JSON.parse(localStorage.getItem(CHAVE) || '[]');
      if (!Array.isArray(bruto)) return [];

      return bruto
        .filter(item => item && Number(item.id) > 0)
        .map(item => [Number(item.id), {
          id: Number(item.id),
          nome: String(item.nome || ''),
          preco: Number(item.preco) || 0,
          estoque: Number(item.estoque) || 0,
          quantidade: Math.max(1, parseInt(item.quantidade, 10) || 1)
        }]);
    } catch (erro) {
      return [];
    }
  }

  function salvar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(Array.from(itens.values())));
    } catch (erro) {
      /* navegador com armazenamento bloqueado: carrinho funciona na memória */
    }
  }

  window.Carrinho = {
    todos() {
      return Array.from(itens.values());
    },

    obter(id) {
      return itens.get(Number(id));
    },

    adicionar(produto, quantidade) {
      const id = Number(produto && produto.id);
      const qtd = Math.max(1, parseInt(quantidade, 10) || 1);
      const estoque = Number(produto.estoque) || 0;

      if (!id || estoque <= 0) return { erro: 'Produto esgotado.' };

      const atual = itens.get(id);
      const total = (atual ? atual.quantidade : 0) + qtd;
      if (total > estoque) {
        return { erro: `Quantidade indisponível. Estoque máximo: ${estoque}.` };
      }

      itens.set(id, {
        id,
        nome: String(produto.nome || ''),
        preco: Number(produto.preco) || 0,
        estoque,
        quantidade: total
      });
      salvar();
      return { ok: true };
    },

    definirQuantidade(id, valor) {
      const item = itens.get(Number(id));
      if (!item) return;

      let qtd = Math.max(1, parseInt(valor, 10) || 1);
      if (item.estoque > 0) qtd = Math.min(qtd, item.estoque);

      item.quantidade = qtd;
      salvar();
    },

    remover(id) {
      itens.delete(Number(id));
      salvar();
    },

    limpar() {
      itens.clear();
      salvar();
    },

    total() {
      return Array.from(itens.values())
        .reduce((soma, item) => soma + item.preco * item.quantidade, 0);
    },

    quantidadeItens() {
      return Array.from(itens.values())
        .reduce((soma, item) => soma + item.quantidade, 0);
    }
  };
})();
