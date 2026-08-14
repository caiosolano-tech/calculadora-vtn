import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// IMPORTANTE: troque 'calculadora-vtn' pelo nome EXATO do seu repositório
// no GitHub, caso seja diferente. Isso é necessário para o GitHub Pages
// encontrar os arquivos corretamente.
export default defineConfig({
  plugins: [react()],
  base: '/calculadora-vtn/',
});
