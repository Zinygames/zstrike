# ZStrike (demo v1)

Shooter en primera persona estilo bloques/pixel (inspirado en Pixel Gun 3D) que se juega en el navegador del celular.
Hecho solo con herramientas gratis: HTML + JavaScript + Three.js (incluido en `vendor/`), servidor Node.js + `ws`.

> ⚠️ **Esta versión funciona SOLO en Solana DEVNET (SOL de prueba, sin dinero real).**

## Cómo jugar

**Celular (horizontal):** joystick izquierdo para moverte · arrastra en la mitad derecha para apuntar ·
🔫 disparar (mantén y arrastra para apuntar mientras disparas) · ⤒ saltar · ⇄ cambiar arma · TIENDA arriba a la derecha.

**Computadora:** WASD moverte · clic para capturar el ratón y apuntar · clic disparar · Espacio saltar · Q o 1-3 arma · B tienda.

### Modos
- **SOLO vs BOTS:** oleadas de bots que te persiguen y disparan. Cada kill da monedas 🪙 (headshot = bono). Funciona sin servidor y sin wallet.
- **ONLINE 💰 (deathmatch):** lobby de 10 jugadores. Gana quien tenga más kills al acabar el tiempo (5 min).
  - **Partida pagada:** entrada de $2 en SOL (precio de CoinGecko, con precio de respaldo). Bote de 10 × $2 = $20 → **$10 al ganador** y **$10 a la tesorería** (Ziny).
  - **Prueba gratis:** entra sin pagar; si alguien más pulsa "prueba" en los siguientes 4 s entran al mismo lobby, y bots llenan el resto. Sin premio.

### Menú
Menú cinematográfico a pantalla completa: escena 3D girando de fondo, lista vertical a la izquierda
(**JUGAR SOLO, ONLINE, TIENDA, ARMAS, AJUSTES**), barra superior con tu nombre y wallet, mapas en tarjetas.
En **ARMAS** el arma seleccionada gira en 3D. En **AJUSTES** cambias tu nombre, la sensibilidad y la calidad gráfica.

### Armas
- **Pistola de Plasma** (gratis): acero cepillado, núcleo de energía con anillos rojos, empuñadura curva de cuero. Disparo de plasma rojo.
- **SMG de Plasma**: cuerpo gunmetal, núcleo azul brillante, 6 cañones con puntas azules, aletas y celdas azules, mira con lente azul. Ráfagas de plasma azul.
- **Lanzacohetes SOL**: daño en área.
Todos los modelos son geometría propia hecha con Three.js (no se usó ningún modelo ni logo con derechos de autor).

### Kill feed
Arriba a la derecha: `Asesino [icono de arma] Víctima` (💀 = headshot), desaparece en ~5 s.
Online usa los nombres que manda el servidor; tu nombre se elige antes de entrar (por defecto tu wallet corta o "Jugador123"). En solo, los bots se llaman "Bot Alpha", "Bot Bravo", etc.

### Votación de mapa (online)
En la sala de espera aparecen los 5 mapas como tarjetas con votos en vivo. Cuando el lobby se llena empieza una cuenta regresiva (10 s, `VOTE_SECONDS`).
El **servidor** cuenta los votos (solo jugadores humanos), gana la mayoría y los empates se rompen al azar. La partida empieza en ese mapa.

### Mapas (3 carriles, lineales, para PvP de habilidad)
- **Tres Carriles:** 3 carriles con 3 cruces, casi sin cobertura.
- **Puente Neon:** carril central largo y abierto, laterales con muros bajos que se pueden saltar.
- **Zigzag:** carriles más estrechos con cruces alternados.
- **Fortaleza Ámbar** (naranja/ámbar): fuerte central elevado (1.5 m) con escaleras al norte y al sur, parapetos y bloque de cobertura arriba; plataformas de 1 m en los carriles laterales; pasillos de flanqueo detrás de muros con puertas; cajas de alturas variadas.
- **Ciudadela Carmesí** (carmesí/cian): foso central, carriles laterales altos (1 m), pasarelas de 2 m sobre los muros con escaleras y rampas hacia el foso, flancos estrechos tras muros con aberturas, pilares y cajas en el foso.

Los bots usan un flow field que respeta alturas (suben escalones de 0.5 m, bajan de cualquier altura), así que suben a plataformas y pasarelas.

Los spawns están en los dos extremos. En solo se escoge en el menú; online se vota en el lobby.

## Tienda "pay to win" (devnet)
- **Con monedas del juego:** SMG, Daño Nv1, Vida Nv1 (para que se pueda jugar sin wallet).
- **Solo con SOL:** Lanzacohetes, Armadura, Daño Nv2/Nv3, Vida Nv2.
- Todo tiene precio y premio fijo: **no hay cajas de botín ni premios al azar**.
- El pago va a la dirección `TREASURY` en `config.js`. El juego **espera a que la transacción se confirme y la verifica** antes de desbloquear. Los desbloqueos se guardan en el navegador (localStorage) por wallet.
- En la partida online todos tienen las mismas armas (el servidor no puede confiar en lo que guarda el navegador, y un premio en dinero con ventajas pagadas aumenta el riesgo legal).
- **Nunca** pedimos frase semilla ni llave privada. Todo se firma dentro de Phantom.

### Phantom en el celular
Phantom solo funciona **dentro del navegador de la app Phantom**. Si abres el juego en Safari/Chrome, aparece el botón **"Abrir en Phantom"**, que usa
`https://phantom.app/ul/browse/<url>?ref=<url>`.
En Phantom: Configuración → Ajustes de desarrollador → activa **Testnet mode** y elige **Devnet**.
SOL de prueba: https://faucet.solana.com (el airdrop por RPC de devnet ya no funciona).

## Archivos
```
index.html, style.css     interfaz
game.js                   juego (solo + cliente online + tienda)
wallet.js                 Phantom + pagos (devnet), verificación on-chain
map.js, ai.js             mapas, colisiones, IA (compartidos con el servidor)
config.js                 TREASURY, red, armas y precios
vendor/                   three.js, @solana/web3.js, polyfill de Buffer
server/server.js          servidor: archivos + lobbies + escrow
server/test/              pruebas con clientes simulados (sim.js, map-sim.js, paid-reject.js)
manifest.webmanifest, sw.js, icons/   app instalable (PWA)
tools/make-icons.py       genera los íconos desde la portada
```

## Instalar como app (PWA)
ZStrike se puede instalar en la pantalla de inicio y abre a pantalla completa, en horizontal:
- **iPhone (Safari):** botón Compartir → *Agregar a pantalla de inicio*.
- **Android (Chrome):** menú ⋮ → *Instalar app* (o *Agregar a pantalla principal*).

Incluye `manifest.webmanifest` (fullscreen, landscape, tema morado oscuro/cian), íconos de 192/512 (más uno *maskable*), `apple-touch-icon` y un service worker (`sw.js`)
que guarda los archivos estáticos para que cargue rápido y el modo solo funcione sin internet. **No** toca `/ws`, `/health`, el RPC de Solana ni otros dominios.
Usa "red primero": cuando hay internet siempre baja la versión nueva. Si cambias la lista de archivos, sube `CACHE` en `sw.js`.
Solo funciona en HTTPS (Render, GitHub Pages, itch.io) o en `localhost`.

## Correr en tu compu
```bash
cd server
npm install
cp .env.example .env     # opcional
npm start                # http://localhost:8080
npm run sim              # prueba con 2 clientes simulados + bots
```
La primera vez el servidor crea `server/secrets/escrow.json` (llave del escrow). **Ese archivo es privado**: no se sube a GitHub (está en `.gitignore`) y nunca llega al navegador.
El escrow necesita un poco de SOL de devnet (≈0.01) para pagar comisiones: cópialo de la consola del servidor y llénalo en https://faucet.solana.com.

### Cómo funciona el pago online (devnet)
1. El cliente pide una cotización. El servidor responde con los lamports de $2 y un **memo único** para esa conexión.
2. El jugador paga al **escrow** desde Phantom (transferencia + memo).
3. El servidor busca la transacción en la blockchain y verifica: quién paga, que va al escrow, el monto, el memo y que esa firma no se haya usado antes. Solo entonces lo sienta en el lobby.
4. El servidor decide los disparos, impactos, kills y el marcador (los clientes solo mandan movimiento y "disparé hacia aquí"; se rechazan teletransportes y disparos más rápidos que el arma).
5. Al final, el escrow firma una transacción: 50% del bote al ganador y el resto a `TREASURY` (menos la comisión de red).
6. Si alguien sale antes de empezar, o el lobby no se llena en 15 min, se le **reembolsa** la entrada (menos la comisión).
Todo queda registrado en `server/data/ledger.jsonl`.

## Publicar gratis
- **Solo el juego (modo SOLO + tienda):** la carpeta funciona como sitio estático.
  - **GitHub Pages:** sube la carpeta (sin `server/secrets` ni `server/data`) a un repo → Settings → Pages → rama `main`, carpeta `/`.
  - **itch.io:** comprime en ZIP `index.html`, `style.css`, `*.js`, `vendor/` → nuevo proyecto → tipo HTML → "This file will be played in the browser".
- **En vivo ahora (devnet):** https://zstrike.onrender.com (Render, plan gratis). El servidor sirve el juego y el WebSocket (`wss://zstrike.onrender.com/ws`).
  - El plan gratis **se duerme tras ~15 min sin uso**: la primera carga tarda ~30–60 s.
  - El servicio se conectó con la URL pública del repo, así que **un push no redespliega solo**: usa "Manual Deploy" en el dashboard de Render (o conecta el repo con la app de GitHub de Render para auto-deploy).
  - La llave del escrow está solo en la variable `ESCROW_SECRET_KEY` del servicio (nunca en el repo).
- **Con online (servidor Node):**
  - **Render** (plan gratis, se duerme si no hay uso): nuevo Web Service → Root Directory `server` → Build `npm install` → Start `node server.js`. Pon la llave del escrow en la variable de entorno `ESCROW_SECRET_KEY` (no en el repo).
  - **Fly.io**, **Railway** o **Koyeb** también tienen planes gratis o de prueba (los límites cambian, revisa antes).
  - Si el juego está en itch.io/GitHub Pages, el botón ONLINE usa `PUBLIC_SERVER_URL` de `config.js` (ahora `wss://zstrike.onrender.com/ws`). `SERVER_URL` fuerza un servidor fijo.
- **Demo rápida:** túnel gratis de Cloudflare: `cloudflared tunnel --url http://localhost:8080` (el enlace cambia cada vez).

## Pasar a mainnet (dinero real) — leer antes
**No lo hagas sin hablar con un abogado.**
- ⚖️ **Legal:** pagar una entrada con dinero real para ganar un premio en dinero puede considerarse **apuesta/juego de azar** en EE.UU. y Puerto Rico (aunque sea "de habilidad", las reglas cambian por estado y territorio). También puede requerir licencias, verificación de edad (18+/21+), KYC y bloquear jurisdicciones. **Consulta a un abogado antes de mainnet.**
- 💸 Las compras y premios serían **dinero real** y no se pueden revertir. Un error en el código o en la llave del escrow = pérdida de fondos.
- 🧾 **Impuestos:** las ventas de la tienda y la parte de la tesorería son ingresos. Los premios pueden ser ingreso gravable para los jugadores. Habla con un contador.
- 📱 **Tiendas de apps:** Apple y Google tienen reglas estrictas sobre cripto y compras dentro de la app (normalmente exigen su sistema de pago para contenido digital y prohíben o limitan juegos con dinero real). Por eso conviene **mantenerlo como juego web**.
- 🔐 Mover el escrow a un servicio de llaves seguro (no un archivo), auditar el código, añadir límites de pago y monitoreo.
- Técnicamente: en `config.js` cambia `CLUSTER`, `RPC_URL` y `ALLOW_MAINNET`; en el servidor `CLUSTER`/`RPC_URL`. El servidor se niega a arrancar fuera de devnet a menos que pongas `ALLOW_MAINNET=I_HAVE_LEGAL_ADVICE`.

## Limitaciones conocidas (v1)
- No se probó una firma real de Phantom ni un pago real en devnet (no se puede en un navegador automático y el airdrop por RPC está cerrado).
- Sin compensación de lag: con mala conexión los disparos pueden fallar aunque se vean bien.
- Si te desconectas a mitad de una partida pagada no puedes volver, pero tus kills cuentan y, si ganas, el premio llega igual a tu wallet.
- Sin sonido todavía.
