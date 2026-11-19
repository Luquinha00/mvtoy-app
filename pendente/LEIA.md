# Pendente de publicar (19/11/2026)
Branch `pendente-produtos`: app com cadastro de produtos/insumos e composição do prêmio por máquina.
1. Aplicar no Supabase (projeto koxormltidkmdwxgqbsm) a migration `mvt_produtos_e_composicao` = conteúdo de pendente/mvt_produtos_e_composicao.sql (precisa da aprovação do Lucas no pedido do Supabase).
2. Depois: `git checkout main && git merge pendente-produtos && git push origin main` (GitHub Pages publica em mvtoy.mundovirtualfranchising.com.br).
3. Conferir no ar (Chrome Mundo Virtual Franchising): aba Estoque › Produtos e Editar máquina › "O que sai em cada prêmio".
Não publique o app sem a migration: a edição de máquina chama mvt_admin_itens.
