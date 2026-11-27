// Permite abrir as páginas pelo arquivo .html (file://) ou pelo Live Server
// e continuar chamando a API que roda em http://localhost:3000.
window.API_BASE = (location.protocol === 'file:' || location.port !== '3000')
    ? 'http://localhost:3000'
    : '';

// NetworkError no fetch quase sempre significa: API não está rodando/porta errada.
window.erroFetch = function (erro) {
    if (erro instanceof TypeError) {
        return 'Não foi possível conectar à API. Confira se "npm start" está rodando em http://localhost:3000.';
    }
    return erro && erro.message ? erro.message : 'Erro de conexão com a API.';
};
