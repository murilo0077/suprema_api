// ============================================================
// endereco.js — CEP automático (ViaCEP) + UF/Cidade (IBGE)
// Usa os campos: #cep #rua #bairro #uf #cidade
// ============================================================
(function () {
  const cepInput    = document.getElementById('cep');
  const ruaInput    = document.getElementById('rua');
  const bairroInput = document.getElementById('bairro');
  const ufSelect    = document.getElementById('uf');
  const cidadeSel   = document.getElementById('cidade');

  if (!cepInput || !ufSelect || !cidadeSel) return;

  const cacheCidades = {};

  const normalizar = s => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function opcao(valor, texto, extra) {
    const o = document.createElement('option');
    o.value = valor;
    o.textContent = texto;
    if (extra) Object.assign(o, extra);
    return o;
  }

  // Carrega as cidades da UF (API do IBGE) e, se informado, seleciona uma.
  async function carregarCidades(uf, selecionar) {
    cidadeSel.disabled = true;
    cidadeSel.innerHTML = '';
    cidadeSel.appendChild(opcao('', 'Carregando...', { disabled: true, selected: true }));

    try {
      if (!cacheCidades[uf]) {
        const r = await fetch(
          `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`
        );
        if (!r.ok) throw new Error('IBGE indisponível');
        const dados = await r.json();
        cacheCidades[uf] = dados.map(m => m.nome);
      }

      cidadeSel.innerHTML = '';
      cidadeSel.appendChild(opcao('', 'Selecione a cidade', { disabled: true, selected: true }));
      cacheCidades[uf].forEach(nome => cidadeSel.appendChild(opcao(nome, nome)));
      cidadeSel.disabled = false;

      if (selecionar) {
        const alvo = normalizar(selecionar);
        const achada = cacheCidades[uf].find(n => normalizar(n) === alvo);
        if (achada) cidadeSel.value = achada;
      }
    } catch (e) {
      // Sem internet/IBGE: deixa só a cidade vinda do CEP (se houver)
      cidadeSel.innerHTML = '';
      if (selecionar) {
        cidadeSel.appendChild(opcao(selecionar, selecionar, { selected: true }));
        cidadeSel.disabled = false;
      } else {
        cidadeSel.appendChild(opcao('', 'Não foi possível carregar as cidades', { disabled: true, selected: true }));
      }
    }
  }

  ufSelect.addEventListener('change', () => carregarCidades(ufSelect.value));

  // Máscara + busca do CEP
  cepInput.addEventListener('input', async () => {
    const n = cepInput.value.replace(/\D/g, '').slice(0, 8);
    cepInput.value = n.length > 5 ? n.slice(0, 5) + '-' + n.slice(5) : n;
    if (n.length !== 8) return;

    try {
      const r = await fetch(`https://viacep.com.br/ws/${n}/json/`);
      const d = await r.json();
      if (d.erro) return;

      if (ruaInput)    ruaInput.value    = d.logradouro || '';
      if (bairroInput) bairroInput.value = d.bairro || '';
      if (d.uf) {
        ufSelect.value = d.uf;
        await carregarCidades(d.uf, d.localidade);
      }
    } catch (e) { /* o usuário preenche manualmente */ }
  });
})();
