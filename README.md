# Articulador Virtual

Simulador de oclusão estática para escaneamentos intraorais. Roda inteiro no navegador: nenhum arquivo é enviado a servidor.

## Uso
1. Solte o STL/PLY do arco superior (upper) e do inferior (lower).
2. Em **Posição do lower**, use **Automático** (busca o melhor encaixe sem penetração) ou **Manual** (gizmo e passos finos).
3. Confira no **Mapa de contatos**: penetração máxima, área de contato e folga média.
4. **Baixar ZIP** traz o upper intacto, o lower na posição corrigida (mesmo sistema de coordenadas) e a matriz 4x4.

## Limites
- Sem bite scan, o automático estima o melhor encaixe geométrico; não substitui o registro de mordida real.
- Assume unidades em mm.

## Estrutura
- `index.html`, `css/style.css`: interface
- `js/core.js`: leitura/escrita STL e PLY, BVH, otimizador de oclusão (Levenberg-Marquardt com restrição de não penetração)
- `js/app.js`: cena 3D (three.js r128), manual/automático, mapa de contatos, exportação
- `vendor/`: three.js r128 (MIT)

Site estático: `npx serve .` ou qualquer hospedagem estática (Vercel, GitHub Pages).
