# CubeVision

> Experiência 3D holográfica no navegador, controlada pelas mãos via webcam.
> A pessoa encontra um artefato numa mesa de projeção, mergulha nele e descobre mundos dentro de mundos, até voltar ao ponto de partida.

Peça de portfólio para **mnstech.com.br**. É uma demonstração técnica, sem venda e sem login.

---

## 1. Visão

- **Inspiração:** a cena da maquete holográfica do *Homem de Ferro 2*, no mesmo nível ou melhor. **Não é cópia:** sem personagens, marcas ou elementos do filme.
- **O que tem que impressionar:** o **efeito de revelar detalhe**. O gesto é o controle e o mergulho é o show.
- **Sensação:** "infinito, mas não infinito". São camadas finitas que se encaixam num loop.
- **Plataforma:** **PC** com webcam comum (referência: Logitech C920) é o alvo principal. **Celular** recebe uma versão por toque (ver seção 3).

### Estilo visual (decidido)

| Elemento | Uso |
|---|---|
| **Wireframe holográfico** | Base de todos os objetos: linhas brilhantes, ciano, translúcido |
| **Mesa de projeção** | Cena fixa inicial, que é o "palco" do holograma |
| **Nuvem de partículas** | Só nas transições: o objeto se desmancha e se remonta como o próximo mundo |
| Pós-processamento | Bloom, scanlines sutis, leve aberração cromática, flicker de holograma |

Não é realista nem cartoon. O detalhe vem da **densidade de linhas e partículas geradas por código**, não de texturas.

---

## 2. A história: camadas

```
[0] Oficina escura → mesa de projeção acende → um cubo estranho flutua
 └─[1] Girando o cubo, aparece uma fresta brilhando → mergulho
     └─[2] Dentro do cubo: uma CIDADE inteira em wireframe
         └─[3] Um prédio → uma sala → outra mesa de projeção
             └─[4] Na mesa: uma MÁQUINA gigante
                 └─[5] O núcleo da máquina: um CRISTAL
                     └─[6] Dentro do cristal: uma GALÁXIA
                         └─[7] Uma estrela da galáxia… é o MESMO CUBO do início → loop
```

- **Cada camada esconde uma pista**: um alvo brilhando fraco, que é onde dá pra mergulhar.
- **Revelação final** (ao completar o loop): o cubo se remonta como o **logotipo da MNS Tech em wireframe**, com uma frase curta e link para mnstech.com.br.
- **MVP:** camadas 0 → 1 → 2 → 3. As demais entram depois de validar a transição.

### Direção de arte dos cenários (revisada em 2026-11-18 após teste do dono)

Regra geral: cada camada é um **lugar completo**, reconhecível de primeira, nunca "um objeto em cima de um pedestal". A câmera chega com um plano de estabelecimento (você vê onde está), o alvo fica **escondido** (nunca de frente para quem chega) e há uma pista visual de longe. Escala humana (silhuetas de pessoas em wireframe) onde fizer sentido. Cada chegada mostra um título: nome do lugar + uma frase do que procurar.

| Camada | Lugar | Elementos obrigatórios | Alvo e pista |
|---|---|---|---|
| Oficina | Oficina de inventor, à noite | 4 paredes com janelas (luzes da cidade lá fora), teto com vigas e luminária pendente, bancadas com ferramentas, estantes com peças, quadro com esboços do cubo, braço robótico, cabos no chão, porta, cadeira | Fresta atrás do cubo; luz vazando pelas laterais |
| Cidade | Metrópole noturna vista do alto | Centro com arranha-céus, bairros residenciais, rio com pontes, porto com guindastes, parque, estádio, trem elevado, trânsito, janelas acesas | Um prédio longe do ponto de chegada; feixe âmbar fraco subindo ao céu |
| Sala | Andar executivo alto, dentro daquele prédio | Mesas, cadeiras, telas, sala de reunião, plantas, elevador, janelões com a cidade, pessoas trabalhando | Laboratório envidraçado no fundo, com a mesa de projeção e a máquina em holograma |
| Máquina | Reator gigante num hangar | Piso, paredes, passarelas, escadas, guindaste, andaimes, pessoas minúsculas para escala, turbinas, pistões, engrenagens, tubos | Núcleo visível só por uma abertura lateral |
| Cristal | Caverna de cristais | Paredes de rocha, estalactites, cristais saindo das paredes e do chão, raios de luz, poeira | Centelha no fundo do cristal principal |
| Galáxia | Galáxia espiral | (aprovada como está) | Estrela-farol num braço |

---

## 3. Gestos

Fluxo: **câmera → MediaPipe (21 pontos por mão) → filtro de suavização → máquina de estados de gestos → ação na cena**

| Gesto (uma mão) | Ação |
|---|---|
| Mão **fechada** + arrastar para qualquer lado | Move o mapa (o mundo segue a mão) |
| Mão **aberta** levantada um pouco e segurada / abaixada | Continua aproximando / afastando, como um joystick (mais alto = mais rápido) |
| Ponto que brilha na mira + aproximar até o limite e **continuar segurando ~0,8 s** | Entra nele (a mira enche). Um toque rápido não entra, nem logo ao chegar num mundo |
| Agarrar e puxar rápido | O leitor perde a mão, mas o mundo continua girando (arremesso) |
| Abaixar a mão | Descansa (a mão só age depois de parar um instante ao entrar na imagem) |

O rastreador roda na thread da página com GPU, lendo o `<video>` direto (como a demo do Google; ~1,75× mais rápido que no worker, medido); o worker fica só de reserva. Um painel no canto da tela mostra esses controles e acende, ao vivo, o estado da mão (aberta/fechada). Calibrado com uma gravação real (`test/fixtures/cubevision-maos.json`, reproduzida em `src/input/replay.test.ts`): aberta × fechada é bimodal e limpa; a palma treme ~1,3% da imagem por quadro (filtrado por uma "folga" de 4%); o tamanho da mão treme ±5% (inútil para zoom); ao reencontrar a mão o rastreador pode pular até 30% (ignorado).

> Histórico (2026-11-18), testado com webcam real e rejeitado: pinça, "parar em cima" (dwell), cursor nas bordas, punho fechado para agarrar e gestos de duas mãos. Motivos: o detector do MediaPipe acha a **palma**; punho e duas mãos fazem a mão "sumir", e mirar cansa o braço. Também rejeitado: mira automática (tira o controle). Diagnóstico: `?debug` mostra fps do rastreador, % de quadros com mão e resolução real da câmera; `?gravar` salva só os números dos pontos da mão.

- **Profundidade:** webcam não mede profundidade; aproximar/afastar a mão é lido pelo **tamanho da mão na imagem** (palma + largura), que é estável com a palma aberta.
- **Suavização:** filtro *One Euro* nos pontos, senão a cena treme junto com a mão.
- **Feedback imediato:** cursor holográfico da mão sempre visível, que reage antes da ação concluir.
- **Modo sem câmera (obrigatório):** mouse, trackpad e **toque** pelo mesmo código de *Pointer Events* (arrastar = girar, soltar em movimento = inércia, scroll/pinça de dois dedos = zoom, clique/toque no alvo = mergulhar). Muita gente vai negar a câmera e a experiência não pode morrer aí. No celular é o modo padrão.

---

## 4. Arquitetura

### Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Build | **Vite + TypeScript** | Rápido, estático, sem servidor |
| 3D | **Three.js** (`WebGPURenderer`, que cai pra WebGL2 sozinho) | Padrão da web 3D; TSL para shaders |
| Mãos | **MediaPipe Tasks Vision — HandLandmarker** (`@mediapipe/tasks-vision`) | Roda no navegador, 2 mãos, tempo real |
| UI | HTML/CSS puro, mínimo | A interface é a cena; framework seria peso morto |
| Hospedagem | **Vercel** (deploy automático do GitHub) | CDN, HTTPS (obrigatório para câmera), grátis |

### Conceitos centrais

1. **Camadas como dados:** cada camada é um módulo com `cena`, `alvos` e `próxima camada`. Adicionar um mundo = adicionar um módulo, sem mexer no motor.
2. **Só 2 camadas na memória:** a atual e a próxima. A seguinte é pré-carregada em segundo plano e a anterior é descartada.
3. **Reset de escala (floating origin):** ao concluir o mergulho, a nova camada passa a ser escala 1 e a câmera volta à origem. Sem isso, o 3D perde precisão numérica depois de alguns níveis.
4. **Transição esconde a emenda:** câmera voa até o alvo → o alvo vira partículas → as partículas se remontam como a nova cena. **Se der pra ver a costura, a mágica quebra.**
5. **Procedural primeiro:** cidade, máquina, galáxia, estrelas e partículas são **geradas por código** com *instancing*. Peças únicas (cubo, núcleo) vêm de modelo pronto ou gerado por IA (Meshy/Tripo) e são convertidas para wireframe.
6. **Trabalho pesado fora da thread principal:** detecção de mãos e geração procedural em **Web Workers**.

### Fluxo de um mergulho

```
Cena atual ─(pinça no alvo)→ câmera voa até o alvo
          ─(mãos se afastam)→ alvo se desmancha em partículas
          ─→ próxima camada (já carregada) aparece minúscula dentro do alvo
          ─→ cresce até ocupar tudo, cena antiga é descartada
          ─→ reset de escala → nova cena vira a atual → pré-carrega a seguinte
```

---

## 5. Privacidade e LGPD

**Princípio:** a imagem da câmera **nunca sai do computador da pessoa**.

- [ ] Frames da câmera processados **só no navegador**, sem envio, gravação ou armazenamento. Só os pontos da mão ficam em memória, durante o uso.
- [ ] **Tela de consentimento antes de pedir a câmera**, explicando isso em linguagem simples, com a opção "usar mouse".
- [ ] Botão sempre visível para **desligar a câmera**. Câmera pausa quando a aba fica oculta.
- [ ] **Aviso de Privacidade** (pt/en): quem é o controlador (MNS Tech + CNPJ), o que é tratado (nada da câmera sai do dispositivo), **Vercel Speed Insights + Web Analytics** (sem cookies, dados agregados), contato.
- [ ] **Sem cookies não essenciais** e sem scripts de rastreamento de terceiros. Se algo assim entrar depois, reavaliar a necessidade de banner.
- [ ] Modelo e arquivos WASM do MediaPipe **servidos pelo próprio site** (não por CDN de terceiros, que veria o IP do visitante).
- [ ] Fontes **hospedadas no próprio site** (sem Google Fonts).
- [ ] Headers: `Content-Security-Policy` restritiva, `Permissions-Policy: camera=(self)`, `Referrer-Policy`, `X-Content-Type-Options`.

> O Claude não é advogado. Revisar o Aviso de Privacidade final com quem entenda de LGPD, se for o caso.

---

## 6. Desempenho: checklist adaptado

O projeto é **100% estático, sem backend, banco ou API**. Itens de servidor não se aplicam, mas vários têm um **equivalente em 3D**.

### ✅ Aplica

| # | Item | Como fica aqui |
|---|---|---|
| 1 | Esqueletos de carregamento | Tela de boot holográfica ("inicializando projetor") com **progresso real** dos assets |
| 2 | WebP/AVIF | Imagens de UI em AVIF/WebP; **texturas 3D em KTX2/Basis** (comprimidas para GPU) |
| 6 | CDN para estáticos | Vercel Edge, automático |
| 9 | Brotli/Gzip | Vercel, automático; malhas com **Meshopt/Draco** |
| 11 | Remover dependências sem uso | `knip` no CI; o Ponytail já segura isso na origem |
| 16 | Requisições em paralelo | Câmera + modelo de mãos + cena 0 carregam juntos |
| 20 | Render no build | Aviso de privacidade e páginas estáticas geradas no build; a experiência é client-only |
| 21 | Scripts de terceiros depois | Speed Insights e Web Analytics carregam depois da cena |
| 22 | Dividir JS | **Cada camada é um chunk** com `import()` dinâmico |
| 26 | Evitar renders desnecessários | Pausar o loop com a aba oculta; zero alocação por frame; não recriar materiais |
| 27 | Cache no navegador | Arquivos com hash + `Cache-Control: immutable` |
| 29 | Fontes próprias, poucos pesos | 1 família mono/técnica, 2 pesos, `woff2`, subset |
| 30 | Medir usuários reais | Vercel Speed Insights + medidor de FPS próprio (modo debug) |
| 31 | Testar em máquinas e redes fracas | Testar em PC com GPU integrada, celular intermediário e rede 3G simulada (para o carregamento) |

### 🔄 Equivalente em 3D

| # | Item original | Equivalente aqui |
|---|---|---|
| 3 | Chamadas duplicadas à API | **Loader único com cache**: nenhum asset é baixado ou processado duas vezes |
| 4 | Debounce na busca | **Filtro One Euro** nos gestos |
| 5 | Paginar resultados | **Streaming de camadas**: só 2 na memória |
| 7 | Fila de jobs | **Web Workers** para mãos e geração procedural |
| 8 | Consultas N+1 | **Draw calls**: *instancing* e *merge*, nunca 1 draw call por prédio ou estrela |
| 12 | Timeout em APIs externas | Timeout na câmera e no modelo de mãos → **cai pro modo mouse/toque** |
| 14 | UI otimista | Cursor da mão reage na hora, antes da ação concluir |
| 15 | Lazy loading | Próxima camada pré-carregada só quando a atual está pronta |
| 23 | Virtualizar listas | **Frustum culling + LOD**: só desenha o que está na tela, no detalhe necessário |
| 25 | Pool de conexões | **Object pool** de partículas: reutilizar em vez de criar e destruir |

### ❌ Não se aplica (sem servidor/banco)

10 Redis · 13 streaming de IA · 17 índices · 18 OpenTelemetry · 19 servidor perto do banco · 24 colunas necessárias · 28 balanceamento (a Vercel já faz)

### ➕ Extras deste projeto

- **Qualidade adaptativa:** se o FPS cair, reduz partículas, bloom e resolução sozinho. Celular começa num degrau mais baixo.
- **Orçamento:** 60 FPS em GPU intermediária, 30 FPS mínimo em GPU integrada e celular intermediário; carga inicial **< 5 MB** antes da cena 0 aparecer.
- **`prefers-reduced-motion`:** versão com transições mais suaves e sem flicker.
- **Celular:** versão por toque (Pointer Events, mesmo código do modo mouse), sem câmera por padrão.

---

## 7. Skills

| Skill | Para quê | Quando |
|---|---|---|
| **Ponytail** (`DietrichGebert/ponytail`) | Faz o agente escrever só o código necessário e reaproveitar o que existe, **sem cortar validação, segurança ou acessibilidade** | Ativa desde o início, em modo `full` (instalada) |
| **Graphify** (`Graphify-Labs/graphify`) | Mapa do projeto em grafo, para os agentes consultarem em vez de ler tudo (menos tokens) | **A partir da Fase 1** (repo vazio não tem o que mapear); regerar a cada fase (instalada) |

---

## 8. Perfis de agentes

Cada agente faz só a sua parte. Modelo e esforço conforme a dificuldade real. **xhigh só onde errar custa caro.**

| Agente | Responsabilidade | Modelo | Esforço |
|---|---|---|---|
| **Arquiteto** | Arquitetura inicial, sistema de camadas, reset de escala, contratos entre módulos | Opus 5.5 | **xhigh** (só na Fase 0/1) → high |
| **Revisor de arquitetura** | Revisão contínua: no início, a cada função nova e sempre que envolver segurança. **Explica o porquê** de cada ponto | Opus 5.5 | high |
| **Engenheiro gráfico** | Shaders do holograma (TSL), pós-processamento, **transições de partículas** | Opus 5.5 | high |
| **Engenheiro de mundos** | Geração procedural: cidade, máquina, galáxia, cubo, instancing, LOD | Sonnet 5.5 | high |
| **Engenheiro de gestos** | MediaPipe, Web Worker, filtro One Euro, máquina de estados, modo mouse/toque | Sonnet 5.5 | high |
| **Engenheiro de performance** | Orçamentos, profiling, qualidade adaptativa, draw calls, carregamento | Sonnet 5.5 | medium |
| **Privacidade e segurança** | Consentimento, Aviso de Privacidade, CSP e headers | Sonnet 5.5 | medium (revisão final pelo Revisor, high) |
| **UI e textos** | Tela de boot, consentimento, overlays, textos pt/en | Sonnet 5.5 | medium |
| **QA** | Checklists de teste, testes da lógica (gestos, camadas), teste em máquina fraca | Sonnet 5.5 | medium |
| **Tarefas mecânicas** | Configs, renomear, i18n, documentação, correções de lint | Haiku 5.5 | low |

---

## 9. Fases

| Fase | Entrega | Critério para seguir |
|---|---|---|
| **0. Kickoff** ✅ | Repo, Vercel, skills, decisões pendentes respondidas | Tudo da seção 10 decidido |
| **1. Protótipo cinza** ✅ | Gestos + modo mouse/toque + 2 camadas com cubos cinza + transição | **A transição convence?** Se não, nada segue |
| **2. Visual holograma** ✅ | Shader wireframe, bloom, partículas, mesa de projeção | Parece holograma de filme |
| **3. MVP** ✅ | Camadas 0 → 3 completas | Roda a 60 FPS na máquina de referência |
| **4. Loop completo** ✅ | Camadas 4 → 7 + loop + revelação final | O loop surpreende |
| **5. Privacidade e acabamento** ✅ | Consentimento, aviso pt/en, headers, versão por toque no celular, reduced motion | Checklist da seção 5 completo |
| **6. Publicação** 🔄 | Passada de performance, testes em máquina fraca e celular, link no mnstech.com.br | Checklist da seção 6 completo |

---

## 10. Decisões (fechadas no kickoff, 2026-11-18)

- [x] **Nome:** `cubevision` (projeto e repositório)
- [x] **GitHub:** conta `mnstechbr`, repositório `mnstechbr/cubevision` (público). Autor dos commits **Jean Vitor**, e-mail noreply do GitHub
- [x] **Modo:** aberto (agente cria repo, faz push e configura a Vercel)
- [x] **Endereço:** projeto próprio na Vercel (`cubevision.vercel.app`)
- [x] **Revelação final:** logotipo da MNS Tech em wireframe + frase curta + link para mnstech.com.br
- [x] **Celular:** versão por toque
- [x] **Analytics:** Vercel Speed Insights + Web Analytics

---

## 11. Estado atual (2026-11-18)

### Rodar

```bash
npm install          # também copia o WASM do MediaPipe para public/mediapipe
npm run dev          # http://localhost:5173
npm test             # filtro One Euro, gestos, os 6 mundos e o loop completo de mergulhos
npm run build && npm run preview   # build de produção com os mesmos headers (CSP) da Vercel
```

Parâmetros de depuração: `?debug` (FPS, draw calls, estado; expõe `window.cv`), `?q=0..3` (fixa a qualidade), `?layer=city` (começa num mundo), `?lang=en`.

### Mapa do código

| Pasta | O quê |
|---|---|
| `src/engine/layers.ts` | Contrato da camada, ordem do loop, carregamento por chunk |
| `src/engine/dive.ts` | Máquina de estados do mergulho, reset de escala, revelação final |
| `src/engine/orbit.ts` | Câmera orbital amortecida; `rebase()` é o floating origin |
| `src/engine/particles.ts` | Pool único de partículas, morph na GPU |
| `src/engine/holo.ts`, `stage.ts` | Materiais de holograma (TSL), bloom, scanlines, qualidade adaptativa |
| `src/layers/*.ts` | Os 6 mundos procedurais (oficina, cidade, sala, máquina, cristal, galáxia) |
| `src/input/` | Mouse/toque/teclado, gestos, One Euro, worker do MediaPipe |

### Pendências

- [x] **CNPJ da MNS Tech** no Aviso de Privacidade (69.668.730/0001-61, mesma redação da Quitéria).
- [ ] **Logotipo da MNS Tech** na revelação: o logo ainda não existe (o dono vai criar). Hoje as partículas formam o texto "MNS TECH" (`src/engine/text.ts`); quando houver o SVG, amostrar o contorno dele.
- [x] Gestos com webcam real: calibrados com duas gravações do dono e aprovados por ele ("agora ficou bom").
- [ ] Testar **WebGPU** numa GPU de verdade e o **celular** num aparelho real (só emulação até agora).
- [ ] Ativar **Speed Insights** e **Web Analytics** no painel da Vercel (projeto cubevision).
- [ ] Geração procedural roda na thread principal (cada mundo leva poucos ms); mover para Worker se passar de ~16 ms.
- [ ] `knip` no CI e link no mnstech.com.br.

## 12. Regras de trabalho

- **Perguntar antes de construir:** mostrar o que vai fazer em cada fase e esperar concordância.
- Respostas curtas; processos explicados em fluxo: **de onde vem → para onde vai → por quê**.
- Git: conferir se está na `main` (e, se não, por quê) → criar branch nova antes de alterar código → commits locais no formato `feat:` / `fix:` → push agrupando commits do mesmo assunto.
- Branches e commits **em inglês**, profissionais, sem "Claude", "Codex" ou "GitHub" no nome.
- Interface em **pt e en**.
- Manter este arquivo e o mapa do Graphify atualizados ao fim de cada fase.
