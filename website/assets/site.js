/* Site behavior: language switch, mobile menu, the hero's network demo, and the technical page's table of contents. */
(function () {
  'use strict';

  var root = document.documentElement;
  var STORAGE_KEY = 'llmd-lang';
  var titleEl = document.querySelector('title');
  var titleEn = titleEl ? titleEl.textContent : document.title;
  var listeners = [];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function currentLang() { return root.getAttribute('data-lang') === 'zh' ? 'zh' : 'en'; }

  function setLang(lang, remember) {
    lang = lang === 'zh' ? 'zh' : 'en';
    root.setAttribute('data-lang', lang);
    root.lang = lang === 'zh' ? 'zh-CN' : 'en';
    if (titleEl) document.title = lang === 'zh' && titleEl.dataset.titleZh ? titleEl.dataset.titleZh : titleEn;
    document.querySelectorAll('[data-set-lang]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-set-lang') === lang));
    });
    document.querySelectorAll('[data-aria-en]').forEach(function (el) {
      el.setAttribute('aria-label', lang === 'zh' ? el.getAttribute('data-aria-zh') : el.getAttribute('data-aria-en'));
    });
    if (remember) {
      try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* storage unavailable */ }
      try {
        var url = new URL(location.href);
        if (url.searchParams.has('lang')) { url.searchParams.set('lang', lang); history.replaceState(null, '', url); }
      } catch (e) { /* ignore */ }
    }
    listeners.forEach(function (fn) { fn(lang); });
  }

  document.querySelectorAll('[data-set-lang]').forEach(function (b) {
    b.addEventListener('click', function () { setLang(b.getAttribute('data-set-lang'), true); });
  });

  // Mobile menu
  var menuBtn = document.querySelector('.menu-btn');
  var nav = document.getElementById('site-nav');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) { nav.classList.remove('is-open'); menuBtn.setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) { nav.classList.remove('is-open'); menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.focus(); }
    });
  }

  // Hero demo: the list follows whichever network the laptop has joined.
  var list = document.getElementById('svc-list');
  if (list) {
    var T = {
      none: { en: 'No API key required', zh: '无需 API key' },
      required: { en: 'API key required', zh: '需要 API key' },
      saved: { en: 'API key saved', zh: 'API key 已保存' },
      image: { en: 'Image input', zh: '图像输入' },
      tools: { en: 'Tool calling', zh: '工具调用' },
      discovering: { en: 'Discovering', zh: '正在发现' },
      waiting: { en: 'Waiting for network', zh: '等待网络' },
      emptyTitle: { en: 'Waiting for a network', zh: '正在等待网络' },
      emptyBody: { en: 'Services from the previous network were cleared. When the laptop joins a network, its services appear here.', zh: '上一个网络的服务已清除。笔记本接入网络后，该网络的服务会出现在这里。' },
      pending: { en: 'Details after the key is verified', zh: '验证 key 后显示详情' }
    };
    var ws = { en: 'Shared workstation', zh: '共享工作站' };
    var NETS = {
      office: [
        { name: 'DeepSeek-R1-Distill-Qwen-32B', host: ws, url: 'https://ws-a.local:8443/text/v1', spec: '32B · Q4_K_M', key: 'none', tags: [] },
        { name: 'Studio Vision', host: ws, url: 'https://ws-a.local:8443/vision/v1', spec: null, key: 'required', tags: [] },
        { name: 'GLM-4-9B-Chat', host: { en: 'Team server', zh: '团队服务器' }, url: 'https://node-b.local:8443/v1', spec: '9B · INT4', key: 'saved', tags: ['tools'] }
      ],
      home: [
        { name: 'Qwen3-8B', host: { en: 'Home workstation', zh: '家庭工作站' }, url: 'https://home-pc.local:8443/v1', spec: '8B · Q8_0', key: 'none', tags: [] }
      ],
      lab: [
        { name: 'Qwen2.5-72B-Instruct', host: { en: 'Lab GPU server', zh: '实验室 GPU 服务器' }, url: 'https://lab-gpu.local:8443/qwen/v1', spec: '72B · AWQ', key: 'saved', tags: ['tools'] },
        { name: 'Lab Llama 70B', host: { en: 'Lab GPU server', zh: '实验室 GPU 服务器' }, url: 'https://lab-gpu.local:8443/llama/v1', spec: null, key: 'required', tags: [] }
      ],
      none: null
    };
    var ORDER = ['office', 'none', 'home', 'lab'];
    var current = 'office';
    var demo = document.querySelector('.hero-demo');
    var statusEl = document.getElementById('picker-status');
    var countEl = document.getElementById('picker-count');
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-net]'));
    var serverIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.01M8 16.5h.01"/></svg>';

    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    function render(animate) {
      var lang = currentLang();
      var services = NETS[current];
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-net') === current)); });
      if (demo) demo.classList.toggle('is-offline', !services);
      statusEl.textContent = services ? T.discovering[lang] : T.waiting[lang];
      statusEl.classList.toggle('is-waiting', !services);
      if (!services) {
        countEl.textContent = lang === 'zh' ? '0 个服务' : '0 services';
        list.innerHTML = '<li class="empty"><strong>' + esc(T.emptyTitle[lang]) + '</strong><span>' + esc(T.emptyBody[lang]) + '</span></li>';
        return;
      }
      countEl.textContent = lang === 'zh' ? services.length + ' 个服务' : services.length + (services.length === 1 ? ' service' : ' services');
      list.innerHTML = services.map(function (s, i) {
        var tags = s.tags.map(function (t) { return '<span class="chip cap">' + esc(T[t][lang]) + '</span>'; }).join('');
        var delay = animate ? ' style="animation-delay:' + (i * 90) + 'ms"' : ' style="animation:none"';
        return '<li class="svc"' + delay + '>' +
          '<span class="svc-icon">' + serverIcon + '</span>' +
          '<div class="svc-body">' +
            '<span class="svc-name">' + esc(s.name) + '</span>' +
            '<span class="svc-host">' + esc(s.host[lang]) + ' · ' + (s.spec ? '<span class="spec">' + esc(s.spec) + '</span>' : '<span class="pending">' + esc(T.pending[lang]) + '</span>') + '</span>' +
            '<span class="svc-url">' + esc(s.url) + '</span>' +
            '<span class="svc-meta"><span class="chip key-' + s.key + '">' + esc(T[s.key][lang]) + '</span>' + tags + '</span>' +
          '</div></li>';
      }).join('');
    }

    var timer = null;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function stopAuto() { if (timer) { clearTimeout(timer); timer = null; } }
    function scheduleNext() {
      if (reduce) return;
      var wait = current === 'none' ? 2200 : 4200;
      timer = setTimeout(function () {
        if (document.hidden) { scheduleNext(); return; }
        current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
        render(true);
        scheduleNext();
      }, wait);
    }
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        stopAuto();
        var next = b.getAttribute('data-net');
        if (next === current) return;
        current = next;
        render(true);
      });
    });
    var picker = document.getElementById('picker');
    if (picker) {
      picker.addEventListener('mouseenter', function () { if (timer) { clearTimeout(timer); timer = 'paused'; } });
      picker.addEventListener('mouseleave', function () { if (timer === 'paused') { timer = null; scheduleNext(); } });
      picker.addEventListener('focusin', stopAuto);
    }
    listeners.push(function () { render(false); });
    render(false);
    scheduleNext();
  }

  // ---------- Diagram helpers ----------
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var SVGNS = 'http://www.w3.org/2000/svg';
  function boxIn(el, scene) {
    var r = el.getBoundingClientRect(), s = scene.getBoundingClientRect();
    return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
  }
  function edgePoint(b, toward, pad) {
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = toward.x - cx, dy = toward.y - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    var hw = b.w / 2 + pad, hh = b.h / 2 + pad;
    var t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    return { x: cx + dx * t, y: cy + dy * t };
  }
  // wires: [{ from, to, cls, label: { en, zh } }]
  function drawWires(scene, svg, wires) {
    var lang = currentLang();
    var s = scene.getBoundingClientRect();
    svg.setAttribute('viewBox', '0 0 ' + s.width + ' ' + s.height);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    wires.forEach(function (w) {
      if (!w.from || !w.to) return;
      var a = boxIn(w.from, scene), b = boxIn(w.to, scene);
      var ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      var p1 = edgePoint(a, bc, 3), p2 = edgePoint(b, ac, 4);
      var line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', p1.x); line.setAttribute('y1', p1.y);
      line.setAttribute('x2', p2.x); line.setAttribute('y2', p2.y);
      line.setAttribute('class', 'wire ' + w.cls);
      svg.appendChild(line);
      // arrowhead at the target end
      var ang = Math.atan2(p2.y - p1.y, p2.x - p1.x), L = 9, W = 5;
      var bx = p2.x - L * Math.cos(ang), by = p2.y - L * Math.sin(ang);
      var head = document.createElementNS(SVGNS, 'polygon');
      head.setAttribute('points', [p2.x + ',' + p2.y,
        (bx + W * Math.sin(ang)) + ',' + (by - W * Math.cos(ang)),
        (bx - W * Math.sin(ang)) + ',' + (by + W * Math.cos(ang))].join(' '));
      head.setAttribute('class', 'wire-head ' + w.cls);
      svg.appendChild(head);
      if (w.label) {
        var g = document.createElementNS(SVGNS, 'g');
        g.setAttribute('class', 'wire-label ' + w.cls);
        var rect = document.createElementNS(SVGNS, 'rect');
        var text = document.createElementNS(SVGNS, 'text');
        var mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        text.setAttribute('x', mx); text.setAttribute('y', my + 4); text.setAttribute('text-anchor', 'middle');
        text.textContent = w.label[lang];
        g.appendChild(rect); g.appendChild(text); svg.appendChild(g);
        var bb = text.getBBox();
        var len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        var along = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? bb.width : bb.height;
        if (along + 24 > len) { svg.removeChild(g); return; }
        rect.setAttribute('x', bb.x - 6); rect.setAttribute('y', bb.y - 3);
        rect.setAttribute('width', bb.width + 12); rect.setAttribute('height', bb.height + 6); rect.setAttribute('rx', 4);
      }
    });
  }
  function whenVisible(el, onShow, onHide) {
    if (!('IntersectionObserver' in window)) { onShow(); return; }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) onShow(); else if (onHide) onHide(); });
    }, { threshold: 0.35 }).observe(el);
  }

  // ---------- Roaming scene: the laptop moves between two networks ----------
  var roam = document.getElementById('roam');
  if (roam) {
    var rScene = roam.querySelector('.roam-scene');
    var rSvg = document.getElementById('r-wires');
    var laptop = document.getElementById('r-laptop');
    var rList = document.getElementById('r-list');
    var rStatus = document.getElementById('r-status');
    var rButtons = Array.prototype.slice.call(roam.querySelectorAll('[data-roam]'));
    var playBtn = roam.querySelector('[data-roam-play]');
    var RSTATES = {
      a: { items: [['deepseek', 'DeepSeek-R1-Distill-Qwen-32B'], ['vision', 'Studio Vision'], ['glm', 'GLM-4-9B-Chat']], wires: [['r-ws', true], ['r-team', false]] },
      between: { items: null, wires: [] },
      b: { items: [['qwen3', 'Qwen3-8B']], wires: [['r-home', true]] }
    };
    var RT = {
      waitItem: { en: 'Waiting for a network', zh: '正在等待网络' },
      mdns: { en: 'mDNS', zh: 'mDNS 公告' }
    };
    var rState = 'a', moveTimer = null;

    function placeLaptop(instant) {
      var slot = roam.querySelector('[data-slot="' + rState + '"]');
      var sb = boxIn(slot, rScene), lw = laptop.offsetWidth, lh = laptop.offsetHeight;
      var x = sb.x + sb.w / 2 - lw / 2, y = sb.y + sb.h / 2 - lh / 2;
      if (instant) laptop.style.transition = 'none';
      laptop.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      if (instant) { void laptop.offsetWidth; laptop.style.transition = ''; }
    }
    function renderList() {
      var lang = currentLang(), st = RSTATES[rState];
      rStatus.textContent = st.items ? String(st.items.length) : '0';
      rList.innerHTML = st.items
        ? st.items.map(function (it, i) { return '<li data-svc="' + it[0] + '" style="animation-delay:' + (i * 80) + 'ms">' + esc(it[1]) + '</li>'; }).join('')
        : '<li class="wait">' + esc(RT.waitItem[lang]) + '</li>';
    }
    function renderWires() {
      var lang = currentLang();
      drawWires(rScene, rSvg, RSTATES[rState].wires.map(function (w) {
        return { from: document.getElementById(w[0]), to: laptop.querySelector('.laptop-list'), cls: 'mdns', label: w[1] ? RT.mdns : null };
      }));
    }
    function setRoam(next, instant) {
      rState = next;
      roam.setAttribute('data-state', next);
      rButtons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-roam') === next)); });
      while (rSvg.firstChild) rSvg.removeChild(rSvg.firstChild);
      if (next === 'between') renderList();
      placeLaptop(instant || reduceMotion);
      clearTimeout(moveTimer);
      moveTimer = setTimeout(function () { renderList(); renderWires(); }, (instant || reduceMotion) ? 0 : 1150);
    }
    var ORDER_R = ['a', 'between', 'b', 'between'], rIdx = 0, rTimer = null, rPlaying = false;
    function setPlaying(on) {
      rPlaying = on;
      playBtn.setAttribute('aria-pressed', String(on));
      playBtn.querySelector('.lbl-play').hidden = on;
      playBtn.querySelector('.lbl-pause').hidden = !on;
      playBtn.querySelector('path').setAttribute('d', on ? 'M2 1h3v10H2zM7 1h3v10H7z' : 'M2 1l9 5-9 5z');
      clearTimeout(rTimer);
      if (on) tick();
    }
    function tick() {
      rTimer = setTimeout(function () {
        if (!rPlaying) return;
        rIdx = (rIdx + 1) % ORDER_R.length;
        setRoam(ORDER_R[rIdx]);
        tick();
      }, ORDER_R[rIdx] === 'between' ? 2600 : 3800);
    }
    rButtons.forEach(function (b) {
      if (b === playBtn) return;
      b.addEventListener('click', function () {
        setPlaying(false);
        var next = b.getAttribute('data-roam');
        rIdx = ORDER_R.indexOf(next);
        setRoam(next);
      });
    });
    playBtn.addEventListener('click', function () { setPlaying(!rPlaying); });
    // Hovering a service highlights the same service in the node and in the list.
    var linkSvc = function (id) {
      roam.querySelectorAll('[data-svc]').forEach(function (e) { e.classList.toggle('is-linked', !!id && e.getAttribute('data-svc') === id); });
    };
    roam.addEventListener('mouseover', function (e) { var t = e.target.closest('[data-svc]'); linkSvc(t ? t.getAttribute('data-svc') : null); });
    roam.addEventListener('mouseleave', function () { linkSvc(null); });
    var started = false;
    whenVisible(roam, function () { if (!started && !reduceMotion) { started = true; setPlaying(true); } });
    var rResize;
    window.addEventListener('resize', function () { clearTimeout(rResize); rResize = setTimeout(function () { placeLaptop(true); renderWires(); }, 120); });
    listeners.push(function () { renderList(); renderWires(); });
    setRoam('a', true);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { placeLaptop(true); renderWires(); });
  }

  // ---------- Two paths: discovery over mDNS, use over HTTPS ----------
  var paths = document.getElementById('paths');
  if (paths) {
    var pScene = paths.querySelector('.paths-scene');
    var pSvg = document.getElementById('p-wires');
    var pList = document.getElementById('p-list');
    var pSteps = Array.prototype.slice.call(paths.querySelectorAll('.phase-steps li'));
    var el = function (id) { return document.getElementById(id); };
    var PT = {
      announce: { en: 'announce', zh: '公告' },
      records: { en: 'records', zh: '记录' },
      list: { en: 'list', zh: '列表' },
      https: { en: 'HTTPS, direct', zh: 'HTTPS 直连' },
      empty: { en: 'No services yet', zh: '暂无服务' }
    };
    var phase = 1;
    function renderPaths() {
      var lang = currentLang();
      paths.setAttribute('data-phase', String(phase));
      pSteps.forEach(function (li) {
        var on = Number(li.getAttribute('data-phase')) === phase;
        li.classList.toggle('is-active', on);
        li.querySelector('button').setAttribute('aria-pressed', String(on));
      });
      ['p-api', 'p-adv', 'p-bus', 'p-app', 'p-core'].forEach(function (id) { el(id).classList.remove('is-hot'); });
      var hot = phase === 1 ? ['p-adv', 'p-bus'] : phase === 2 ? ['p-core', 'p-app'] : ['p-app', 'p-api'];
      hot.forEach(function (id) { el(id).classList.add('is-hot'); });
      pList.innerHTML = phase >= 2
        ? '<li>Studio Qwen3 8B</li>'
        : '<li class="empty-row">' + esc(PT.empty[lang]) + '</li>';
      var dim = phase === 3 ? ' dim' : '';
      var wires = [{ from: el('p-adv'), to: el('p-bus'), cls: 'mdns' + dim, label: PT.announce }];
      if (phase >= 2) {
        wires.push({ from: el('p-bus'), to: el('p-core'), cls: 'mdns' + dim, label: PT.records });
        wires.push({ from: el('p-core'), to: el('p-app'), cls: 'mdns' + dim, label: PT.list });
      }
      if (phase === 3) wires.push({ from: el('p-app'), to: el('p-api'), cls: 'https', label: PT.https });
      drawWires(pScene, pSvg, wires);
    }
    var pTimer = null, pAuto = false;
    function pTick() { pTimer = setTimeout(function () { if (!pAuto) return; phase = phase % 3 + 1; renderPaths(); pTick(); }, 3600); }
    pSteps.forEach(function (li) {
      li.addEventListener('click', function () {
        pAuto = false; clearTimeout(pTimer);
        phase = Number(li.getAttribute('data-phase'));
        renderPaths();
      });
    });
    var pStarted = false;
    whenVisible(paths, function () { if (!pStarted && !reduceMotion) { pStarted = true; pAuto = true; pTick(); } });
    var pResize;
    window.addEventListener('resize', function () { clearTimeout(pResize); pResize = setTimeout(renderPaths, 120); });
    listeners.push(renderPaths);
    renderPaths();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderPaths);
  }

  // ---------- "The server behind the API can change" ----------
  var archSrv = Array.prototype.slice.call(document.querySelectorAll('.arch .srv'));
  if (archSrv.length) {
    var ai = 0;
    var showArch = function () { archSrv.forEach(function (s, i) { s.classList.toggle('is-on', i === ai); }); };
    showArch();
    if (!reduceMotion) setInterval(function () { if (!document.hidden) { ai = (ai + 1) % archSrv.length; showArch(); } }, 2200);
  }

  // Technical page: highlight the section in view.
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
  if (tocLinks.length) {
    var sections = tocLinks.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
    var ticking = false;
    var updateToc = function () {
      ticking = false;
      var line = window.innerHeight * 0.3;
      var active = 0;
      sections.forEach(function (sec, i) { if (sec && sec.getBoundingClientRect().top <= line) active = i; });
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = sections.length - 1;
      tocLinks.forEach(function (a, i) { a.classList.toggle('is-active', i === active); });
    };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(updateToc); } }, { passive: true });
    updateToc();
  }

  setLang(currentLang(), false);
})();
