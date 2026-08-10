/**
 * Roda no <head>, antes da primeira pintura.
 *
 * Marca o documento como "tem JavaScript" para que o CSS possa esconder os
 * elementos que serão revelados na rolagem. Se este arquivo falhar, a classe
 * .no-js permanece e todo o conteúdo aparece normalmente — sem tela em branco.
 */
document.documentElement.classList.replace('no-js', 'js');
