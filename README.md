# Calculadora de VTN — Gestão Fundiária

Aplicação web para cálculo do VTN ponderado e do ITR estimado, a partir da
tabela oficial da Receita Federal (Exercício 2026).

## Rodar localmente

```bash
npm install
npm run dev
```

Acesse http://localhost:5173

## Publicar no GitHub Pages

Veja o passo a passo completo na conversa com o Claude, ou resumidamente:

1. Crie um repositório no GitHub chamado `calculadora-vtn` (ou ajuste o `base`
   em `vite.config.js` para o nome que você escolher).
2. Suba este código para o repositório (`git init`, `git add .`,
   `git commit`, `git push`).
3. Em **Settings → Pages**, em "Build and deployment", selecione
   **GitHub Actions** como fonte.
4. Faça um push para a branch `main` — o workflow em
   `.github/workflows/deploy.yml` builda e publica automaticamente.
5. O site fica disponível em `https://SEU-USUARIO.github.io/calculadora-vtn/`.

## Atualizar a tabela de VTN em anos futuros

Troque o conteúdo de `src/vtn_2026.json` por uma nova extração da tabela da
Receita Federal (mesmo formato: array de arrays
`[UF, Município, LavouraBoa, LavouraRegular, LavouraRestrita, PastagemPlantada, SilviculturaOuPastagemNatural, Preservação, Fonte]`).
