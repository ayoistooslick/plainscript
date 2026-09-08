(() => {
  "use strict";

  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── three.js animated background ──────────────────────────────────────
  function mountBackground() {
    const canvas = document.getElementById("bg-canvas");
    if (!canvas || !window.WebGLRenderingContext) return;

    let context;
    try {
      context = canvas.getContext("webgl", { alpha: true, antialias: true });
    } catch (error) {
      return;
    }
    if (!context) return;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
    } catch (error) {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
    camera.position.z = 16;

    const group = new THREE.Group();
    scene.add(group);

    // Distant particle field
    const starCount = prefersReduced ? 0 : 800;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 34;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 22;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0x46e6b4,
      size: 0.09,
      transparent: true,
      opacity: 0.55,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const stars = new THREE.Points(starGeo, starMat);
    group.add(stars);

    // Two soft wireframe rings for structure
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x46e6b4,
      wireframe: true,
      transparent: true,
      opacity: 0.12,
    });
    for (const [radius, tilt, speed] of [[9.5, 0.4, 0.22], [6.5, -0.25, -0.16]]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.05, 8, 96), ringMat);
      ring.rotation.x = tilt;
      ring.rotation.y = 0.6;
      group.add(ring);
      ring.userData.speed = speed;
    }

    let mouseX = 0;
    let mouseY = 0;
    window.addEventListener("pointermove", (event) => {
      mouseX = (event.clientX / window.innerWidth) * 2 - 1;
      mouseY = (event.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });

    function resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);

    const clock = new THREE.Clock();
    function tick() {
      const elapsed = clock.getElapsedTime();
      group.rotation.y = elapsed * 0.06;
      group.children.forEach((child) => {
        if (child.userData.speed) {
          child.rotation.z += child.userData.speed * 0.004;
        }
      });
      // Parallax toward the cursor
      const targetY = elapsed * 0.06 + mouseX * 0.15;
      group.rotation.x += (mouseY * 0.12 - group.rotation.x) * 0.04;
      group.rotation.y += (targetY - group.rotation.y) * 0.04;
      camera.position.x += (mouseX * 1.1 - camera.position.x) * 0.03;
      camera.position.y += (mouseY * 0.7 - camera.position.y) * 0.03;
      camera.lookAt(scene.position);
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }
    if (!prefersReduced) tick();
  }
  mountBackground();

  // ── GSAP entrance + scroll reveals ────────────────────────────────────
  const gsapOk = window.gsap && !prefersReduced;

  if (gsapOk) {
    gsap.registerPlugin(window.ScrollTrigger);

    // Hero entrance
    gsap.from(".hero-badge", { opacity: 0, y: 18, duration: 0.7, ease: "power2.out" });
    gsap.from(".hero-title", {
      opacity: 0, y: 30, duration: 0.9, ease: "power3.out", delay: 0.1,
    });
    gsap.from(".hero-lead", { opacity: 0, y: 22, duration: 0.8, ease: "power2.out", delay: 0.22 });
    gsap.from(".hero-actions .button", {
      opacity: 0, y: 18, duration: 0.6, ease: "power2.out", delay: 0.32, stagger: 0.08,
    });
    gsap.from(".hero .code-window", { opacity: 0, y: 26, duration: 0.8, ease: "power2.out", delay: 0.44 });

    // Scroll reveals for cards and blocks
    gsap.utils.toArray("[data-reveal]").forEach((el) => {
      gsap.from(el, {
        opacity: 0,
        y: 28,
        duration: 0.7,
        ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
      });
    });

    // Stagger card grids
    gsap.utils.toArray(".three-column, .feature-grid").forEach((grid) => {
      gsap.from(grid.children, {
        opacity: 0,
        y: 30,
        duration: 0.6,
        ease: "power2.out",
        stagger: 0.08,
        scrollTrigger: { trigger: grid, start: "top 86%", once: true },
      });
    });
  } else {
    // No-JS / reduced-motion fallback: keep everything visible
    document.querySelectorAll("[data-reveal]").forEach((el) => el.style.opacity = 1);
    document.querySelectorAll(".hero-badge, .hero-title, .hero-lead, .hero .code-window").forEach((el) => {
      el.style.opacity = 1;
    });
  }

  // Nav blur once scrolled
  const nav = document.getElementById("site-nav");
  const onScroll = () => nav && nav.classList.toggle("is-scrolled", window.scrollY > 10);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Mobile nav toggle
  const navToggle = document.getElementById("nav-toggle");
  const navLinks = document.getElementById("nav-links");
  if (navToggle && navLinks) {
    navToggle.addEventListener("click", () => {
      const expanded = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!expanded));
      navLinks.classList.toggle("is-open", !expanded);
    });
    navLinks.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        navToggle.setAttribute("aria-expanded", "false");
        navLinks.classList.remove("is-open");
      });
    });
  }

  // ── Copy controls for every code block ─────────────────────────────────
  const syntaxGroups = {
    declaration: new Set(["remember", "let", "make", "define", "function", "use", "import", "export", "database", "postgres", "record", "list", "create", "websocket", "bot", "whatsapp", "ocr"]),
    web: new Set(["web", "route", "start", "listen", "reply", "respond", "serve", "allow", "cors", "status", "redirect", "param", "query", "header", "upload", "uploads"]),
    database: new Set(["database", "postgres", "query", "insert", "update", "delete", "execute", "transaction", "native", "wasm"]),
    error: new Set(["try", "recover", "finally", "retry", "throw", "raise", "raises", "catch", "catches"]),
    test: new Set(["test", "check", "equals", "contains", "raises"]),
    comparison: new Set(["contains", "starts", "ends", "between", "is", "same", "different", "more", "fewer", "at", "least", "most"]),
    keyword: new Set(["if", "otherwise", "else", "for", "each", "every", "index", "from", "to", "while", "in", "when", "on", "done", "give", "return", "yield", "break", "continue", "with", "and", "or", "not", "field", "instanceof", "show", "print", "display", "accept", "require", "enable", "limit", "cache", "schedule", "background", "socket", "message", "broadcast", "send"])
  };

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character]));
  }

  function highlightPlainScript(source) {
    const tokenPattern = /\/\/[^\n]*|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?n?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|\?\?|\?\.|\*\*|->|===|!==|==|!=|<=|>=|[+\-*\/%=<>]/g;
    let highlighted = "";
    let lastIndex = 0;
    let match;

    while ((match = tokenPattern.exec(source))) {
      highlighted += escapeHtml(source.slice(lastIndex, match.index));
      const token = match[0];
      let className = "";
      if (token.startsWith("//")) className = "comment";
      else if (token.startsWith('"')) className = "string";
      else if (token.startsWith("`")) className = "template";
      else if (/^\d/.test(token)) className = "number";
      else if (/^(true|false|null|undefined)$/.test(token)) className = "constant";
      else if (/^(?:\?\?|\?\.|\*\*|->|===|!==|==|!=|<=|>=|[+\-*\/%=<>])$/.test(token)) className = token === "=" ? "assignment" : "operator";
      else if (syntaxGroups.database.has(token)) className = "database";
      else if (syntaxGroups.comparison.has(token)) className = "comparison";
      else if (syntaxGroups.declaration.has(token)) className = "declaration";
      else if (syntaxGroups.web.has(token)) className = "web";
      else if (syntaxGroups.error.has(token)) className = "error";
      else if (syntaxGroups.test.has(token)) className = "test";
      else if (syntaxGroups.keyword.has(token)) className = "keyword";
      else if (/\s*\(/.test(source.slice(match.index + token.length))) className = "function";
      if (token === "becomes") className = "assignment";
      highlighted += className ? `<span class="code-token code-token--${className}">${escapeHtml(token)}</span>` : escapeHtml(token);
      lastIndex = match.index + token.length;
    }
    return highlighted + escapeHtml(source.slice(lastIndex));
  }

  function enhanceCodeBlock(pre) {
    if (!pre || pre.querySelector(".copy-button")) return;
    const code = pre.querySelector("code");
    if (!code) return;
    code.innerHTML = highlightPlainScript(code.textContent);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-button";
    copyButton.textContent = "Copy";
    copyButton.setAttribute("aria-label", "Copy code to clipboard");
    copyButton.addEventListener("click", async () => {
      const originalLabel = "Copy";
      let copied = false;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(code.textContent);
          copied = true;
        } else {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(code);
          selection.removeAllRanges();
          selection.addRange(range);
          copied = document.execCommand("copy");
          selection.removeAllRanges();
        }
      } catch (error) {
        copied = false;
      }
      if (!copied) return;
      copyButton.textContent = "Copied";
      copyButton.classList.add("is-copied");
      copyButton.setAttribute("aria-label", "Code copied to clipboard");
      window.setTimeout(() => {
        copyButton.textContent = originalLabel;
        copyButton.classList.remove("is-copied");
        copyButton.setAttribute("aria-label", "Copy code to clipboard");
      }, 1600);
    });
    pre.appendChild(copyButton);
  }

  document.querySelectorAll("pre").forEach(enhanceCodeBlock);

  // ── Feature library (search + filter) ─────────────────────────────────
  const examples = [
    { category: "core", name: "Variables", description: "Store and update values.", source: 'remember name as "Ada"\nremember count as 3\ncount becomes count + 1\nshow `Hello, ${name}!`' },
    { category: "core", name: "Conditions", description: "Compare values in plain words.", source: 'if score is at least 80 and name contains "A"\n    show "accepted"\notherwise\n    show "review"\ndone' },
    { category: "core", name: "Loops", description: "Go through lists and ranges.", source: 'for each item in list with "one", "two"\n    show item\ndone\n\nfor index i from 0 to 2\n    show i\ndone' },
    { category: "core", name: "Functions", description: "Create reusable functions.", source: 'make add(a, b)\n    give a + b\ndone\n\nshow add(2, 3)' },
    { category: "core", name: "Modules", description: "Share code across files.", source: 'bring circleArea from "./math.pln"\nbring button from "@/components/button.pln"\nexport circleArea and squareArea' },
    { category: "data", name: "Records", description: "Define the shape of your data.", source: 'define a kind called "Player" with\n    name is ""\n    goals is 0\ndone\nremember player as create a Player with name "Ada" and goals 4' },
    { category: "data", name: "JSON", description: "Work with JSON data.", source: 'remember payload as {ok: true, count: 2}\nremember encoded as jsonEncode(payload)\nshow encoded' },
    { category: "data", name: "Compound Types", description: "Use dictionaries, sets, and tuples.", source: 'remember userMap as dictionary with "name" is "Ada" and "role" is "admin" done\nremember tags as set with "admin", "editor" done\nremember point as tuple with 10, 20, 30 done' },
    { category: "data", name: "SQLite", description: "Run safe SQL queries.", source: 'database "app.db" using "wasm"\nexecute\n    CREATE TABLE items (name TEXT)\ndone\nremember items as query\n    SELECT name FROM items\ndone' },
    { category: "web", name: "Web routes", description: "Build an HTTP app with JSON routes.", source: 'web app\nroute get "/health"\n    reply json\n        ok is true\n    done\ndone\nstart 3000' },
    { category: "web", name: "HTTP client", description: "Fetch data from a URL.", source: 'remember response as get "https://example.com/data" timeout 5000\nshow response.status' },
    { category: "web", name: "Auth and sessions", description: "Protect routes and track visitors.", source: 'web app\nenable sessions "session-secret"\nrequire api key from env("API_KEY")\nroute get "/me"\n    reply json\n        user is user of session of request\n    done\ndone' },
    { category: "runtime", name: "Async errors", description: "Handle errors gracefully.", source: 'try\n    remember result as get "https://example.com" timeout 5000\nrecover as error\n    show message of error\nfinally\n    show "finished"' },
    { category: "runtime", name: "Concurrency", description: "Run several tasks at once.", source: 'remember results as allOf(list with firstJob(), secondJob())\nremember quick as withTimeout(firstJob(), 1000)\nshow results' },
    { category: "runtime", name: "WebSockets", description: "Chat and push updates live.", source: 'websocket server on 8080\n    when socket connects\n        send socket "connected"\n    done\n    when socket sends message\n        broadcast message\n    done\ndone' },
    { category: "runtime", name: "Cache", description: "Keep values ready with a TTL.", source: 'cache env("REDIS_URL")\ncacheSet("status", "ready", 60)\nremember status as cacheGet("status")' },
    { category: "integrations", name: "Telegram", description: "Build a Telegram bot.", source: 'bot env("TELEGRAM_BOT_TOKEN")\nwhen someone sends "/start"\n    reply "Welcome"\ndone\nstart telegram bot' },
    { category: "integrations", name: "WhatsApp", description: "Build a WhatsApp bot.", source: 'whatsapp bot\n    auth "session"\n    login pairing "2348012345678"\n    on message\n        if message.text is "/start"\n            reply "Welcome!"\n        done\n        if message.type is "image"\n            download "media/photo.jpg"\n            reply "Saved your photo!"\n        done\n    done\ndone' },
    { category: "integrations", name: "Groq AI", description: "Get AI replies in your code.", source: 'remember answer as chatWith("groq", "llama-3.3-70b-versatile", "Hello")\nshow answer' },
    { category: "integrations", name: "OCR uploads", description: "Read text from uploaded images.", source: 'web app\naccept uploads limit "5 MB" allow list with "image/png" folder "uploads"\nroute post "/scan"\n    remember file as upload("document")\n    ocr path of file as text\n    reply text\ndone' },
    { category: "tooling", name: "Native tests", description: "Check that your code works.", source: 'test "addition works"\n    check add(2, 3) equals 5\ndone' },
    { category: "tooling", name: "Source Maps", description: "Debug right in your .pln files.", source: 'plainscript build src/main.pln --sourcemap\n\n// or in code:\n// plainscript run src/main.pln --sourcemap' }
  ];

  const grid = document.getElementById("lib-grid");
  const empty = document.getElementById("lib-empty");
  const search = document.getElementById("lib-search");
  const filters = document.getElementById("lib-filters");
  if (!grid || !empty || !search || !filters) return;

  const categories = ["all", ...new Set(examples.map((item) => item.category))];
  let activeCategory = "all";

  categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lib-filter" + (category === "all" ? " is-active" : "");
    button.textContent = category;
    button.addEventListener("click", () => {
      activeCategory = category;
      filters.querySelectorAll("button").forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      render();
    });
    filters.appendChild(button);
  });

  function render() {
    const query = search.value.trim().toLowerCase();
    const visible = examples.filter((item) => {
      const matchesCategory = activeCategory === "all" || item.category === activeCategory;
      const haystack = `${item.name} ${item.description} ${item.source}`.toLowerCase();
      return matchesCategory && (!query || haystack.includes(query));
    });
    grid.replaceChildren();
    visible.forEach((item) => {
      const card = document.createElement("article");
      card.className = "library-card";
      card.innerHTML = `<div class="library-card-top"><span class="library-category">${item.category}</span><h3>${item.name}</h3><p>${item.description}</p></div><pre><code></code></pre>`;
      card.querySelector("code").textContent = item.source;
      enhanceCodeBlock(card.querySelector("pre"));
      grid.appendChild(card);
    });
    empty.hidden = visible.length !== 0;
  }

  search.addEventListener("input", render);
  render();
})();