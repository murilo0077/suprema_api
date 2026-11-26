// Permite abrir as páginas pelo arquivo .html (file://) ou pelo Live Server
// e continuar chamando a API que roda em http://localhost:3000.
window.API_BASE = (location.protocol === 'file:' || location.port !== '3000')
    ? 'http://localhost:3000'
    : '';
