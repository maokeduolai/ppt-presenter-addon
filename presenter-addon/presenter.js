/* HTML Presenter Addon 2.0.0 | MIT License */
(() => {
  'use strict';
  if (window.HTMLPresenter || new URL(location.href).searchParams.has('print-pdf')) return;
  const directory = new URL('.', document.currentScript.src);
  const audienceToken = new URL(location.href).searchParams.get('__presenter_audience');
  const channel = 'html-presenter-v2';
  const events = ['slidechanged', 'fragmentshown', 'fragmenthidden', 'paused', 'resumed'];
  const defaults = {deckGlobal: 'deck', notes: null, notesFile: null, notesGlobal: 'HTMLPresenterNotes',
    defaultFontSize: 22, locale: 'zh-CN', hideElements: [], autoStart: true};
  const translations = {
    'zh': {launch:'演讲者模式 ↗', console:'演讲者模式', clock:'当前时间', timer:'演讲计时', start:'开始计时', resume:'继续', pause:'暂停', reset:'清零', projection:'投影窗口', reopen:'重新打开投影', exit:'结束演示', connected:'投影窗口已连接', closed:'投影窗口已关闭', connecting:'正在连接投影窗口…', previous:'上一步', next:'下一步', preview:'逐页预览', keys:'点击跳转 · ← / → / 空格翻步', notes:'讲稿备注', font:'备注字号', smaller:'缩小备注字号', larger:'放大备注字号', empty:'本页暂无备注。', step:'分步', fullscreen:'全屏', leaveFullscreen:'退出全屏', fullscreenHint:'双击画面或按 F 全屏', fullscreenError:'请使用浏览器的全屏命令', popupBlocked:'浏览器拦截了投影窗口，请允许弹窗后重试。', deckMissing:'未找到已初始化的 Reveal.js 实例，请检查 deckGlobal 或调用 HTMLPresenter.init(deck)。', failed:'演讲者插件启动失败：', orphan:'演讲者窗口已断开；可以继续独立放映。', loadFailed:'无法加载备注文件，已改用页面内备注。'},
    'en': {launch:'Presenter mode ↗', console:'Presenter mode', clock:'Local time', timer:'Elapsed time', start:'Start timer', resume:'Resume', pause:'Pause', reset:'Reset', projection:'Audience window', reopen:'Reopen audience', exit:'End presentation', connected:'Audience connected', closed:'Audience window closed', connecting:'Connecting…', previous:'Previous step', next:'Next step', preview:'Slide previews', keys:'Click to jump · ← / → / Space to advance', notes:'Speaker notes', font:'Notes font size', smaller:'Smaller notes', larger:'Larger notes', empty:'No notes for this slide.', step:'Step', fullscreen:'Fullscreen', leaveFullscreen:'Exit fullscreen', fullscreenHint:'Double-click or press F for fullscreen', fullscreenError:'Use your browser’s fullscreen command', popupBlocked:'The audience window was blocked. Allow popups and try again.', deckMissing:'No ready Reveal.js instance found. Check deckGlobal or call HTMLPresenter.init(deck).', failed:'Presenter initialization failed: ', orphan:'Presenter disconnected; standalone playback is still available.', loadFailed:'Could not load external notes. Using inline notes instead.'}
  };
  let config = {...defaults, ...window.HTMLPresenterConfig};
  let words, adapter, root, styles, notes = [], preferences, initPromise;
  let active = false, applying = false, audienceWindow = null, sessionToken = '', connected = false;
  let consoleRoot, stage, launchButton, originalPlace, originalConfig, hiddenElements = [];
  let resizeObserver, thumbnailObserver, lifecycleTimer, syncFrame, handshake;
  let elapsed = 0, timerStarted = null;
  const refs = {};
  const origin = location.protocol === 'file:' ? '*' : location.origin;
  const t = key => words[key];
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const button = (label, action, className) => {
    const element = node('button', className, label);
    element.type = 'button';
    element.addEventListener('click', action);
    return element;
  };
  function toast(message) {
    document.querySelector('.pp-toast')?.remove();
    const element = node('div', 'pp-toast', message);
    element.setAttribute('role', 'alert');
    document.body.append(element);
    window.setTimeout(() => element.remove(), 9000);
  }
  // All engine-specific operations live here; other engines need a new adapter.
  function revealAdapter(deck) {
    const slides = () => deck.getSlides();
    const indices = slide => deck.getIndices(slide);
    return {
      slides, root: () => deck.getRevealElement(), current: () => deck.getCurrentSlide(),
      title: slide => slide.dataset.title || slide.querySelector('h1,h2,h3')?.textContent.trim() || '',
      previous: () => deck.prev(), next: () => deck.next(),
      jump: slide => { const i = indices(slide); deck.slide(i.h, i.v, -1); },
      layout: () => deck.layout(), getConfig: () => deck.getConfig(), configure: value => deck.configure(value),
      subscribe: handler => events.forEach(event => deck.on(event, handler)),
      unsubscribe: handler => events.forEach(event => deck.off(event, handler)),
      state: () => {
        const s = deck.getState();
        return {indexh:s.indexh, indexv:s.indexv, indexf:Number.isInteger(s.indexf) ? s.indexf : -1, paused:!!s.paused};
      },
      valid: value => {
        if (!value || !Number.isInteger(value.indexh) || !Number.isInteger(value.indexv) ||
            !Number.isInteger(value.indexf) || typeof value.paused !== 'boolean') return false;
        const slide = slides().find(slide => {
          const i = indices(slide); return i.h === value.indexh && (i.v ?? 0) === value.indexv;
        });
        if (!slide) return false;
        const last = Math.max(-1, ...[...slide.querySelectorAll('.fragment')].map((f, i) => Number(f.dataset.fragmentIndex ?? i)));
        return value.indexf >= -1 && value.indexf <= last;
      },
      apply: state => deck.setState({...state, overview:false}),
      dimensions: () => {
        const cfg = deck.getConfig(), element = deck.getSlidesElement();
        return {width:parseFloat(element.style.width) || Number(cfg.width) || 960,
          height:parseFloat(element.style.height) || Number(cfg.height) || 700};
      }
    };
  }
  function post(target, type, payload = {}) {
    if (target && !target.closed) target.postMessage({channel, token:sessionToken, type, ...payload}, origin);
  }
  function isMessage(event, source) {
    return source && event.source === source && (origin === '*' ? event.origin === 'null' : event.origin === origin) &&
      event.data?.channel === channel && event.data.token === sessionToken;
  }
  function applyState(value) {
    if (!adapter.valid(value)) return;
    applying = true;
    try { adapter.apply(value); } finally { applying = false; }
    if (active) updateSlide();
  }
  function publish() {
    if (applying || (!active && !audienceToken)) return;
    cancelAnimationFrame(syncFrame);
    syncFrame = requestAnimationFrame(() => {
      post(audienceToken ? window.opener : audienceWindow, 'state', {state:adapter.state()});
      if (active) updateSlide();
    });
  }
  function preferencesKey() { return 'html-presenter-v2:' + location.pathname; }
  function readPreferences() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(preferencesKey())) || {}; } catch { /* optional storage */ }
    return {fontSize:Math.min(40, Math.max(14, Number(saved.fontSize) || Number(config.defaultFontSize) || 22))};
  }
  function applyPreferences() {
    consoleRoot.style.setProperty('--pp-notes-size', preferences.fontSize + 'px');
    refs.fontRange.value = preferences.fontSize;
    refs.fontValue.textContent = preferences.fontSize + 'px';
    try { localStorage.setItem(preferencesKey(), JSON.stringify(preferences)); } catch { /* optional storage */ }
  }
  function changeFont(amount) {
    preferences.fontSize = Math.min(40, Math.max(14, preferences.fontSize + amount)); applyPreferences();
  }
  function formatElapsed(ms) {
    const total = Math.floor(ms / 1000), minutes = Math.floor(total / 60);
    return (minutes >= 60 ? String(Math.floor(minutes / 60)).padStart(2,'0') + ':' : '') +
      String(minutes >= 60 ? minutes % 60 : minutes).padStart(2,'0') + ':' + String(total % 60).padStart(2,'0');
  }
  function updateClock() {
    if (!active) return;
    refs.clock.textContent = new Intl.DateTimeFormat(config.locale, {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false}).format(new Date());
    refs.timer.textContent = formatElapsed(elapsed + (timerStarted === null ? 0 : performance.now() - timerStarted));
    refs.timerToggle.textContent = timerStarted === null ? (elapsed ? t('resume') : t('start')) : t('pause');
  }
  function toggleTimer() {
    if (timerStarted === null) timerStarted = performance.now();
    else { elapsed += performance.now() - timerStarted; timerStarted = null; }
    updateClock();
  }
  function resetTimer() { elapsed = 0; timerStarted = null; updateClock(); }
  function setConnection(value) {
    connected = value;
    if (!refs.status) return;
    refs.status.dataset.connected = String(value);
    refs.status.textContent = t(value ? 'connected' : audienceWindow?.closed ? 'closed' : 'connecting');
    refs.projectionButton.textContent = t(audienceWindow?.closed ? 'reopen' : 'projection');
  }
  function timeBlock(label, key) {
    const wrapper = node('div', 'pp-time-block');
    refs[key] = node('div', 'pp-digits', key === 'timer' ? '00:00' : '--:--:--');
    wrapper.append(node('span', 'pp-label', label), refs[key]); return wrapper;
  }
  function stageBackground() {
    // Transparent decks normally show the document/ancestor backgrounds. Keep
    // those layers behind the deck when it moves into the opaque console UI.
    // The deck itself and Reveal's per-slide backgrounds remain above them.
    const background = node('div','pp-deck-background');
    background.setAttribute('aria-hidden','true');
    background.style.colorScheme = getComputedStyle(document.documentElement).colorScheme;
    background.style.backgroundColor = 'Canvas';
    const ancestors = [];
    for (let parent = root.parentElement; parent; parent = parent.parentElement) ancestors.unshift(parent);
    let layer = background;
    for (const ancestor of ancestors) {
      const next = node('div','pp-deck-background');
      next.style.background = getComputedStyle(ancestor).background;
      layer.append(next); layer = next;
    }
    return background;
  }
  function buildConsole() {
    consoleRoot = node('div'); consoleRoot.id = 'pp-console';
    consoleRoot.setAttribute('role','region'); consoleRoot.setAttribute('aria-label',t('console'));
    consoleRoot.lang = config.locale;
    const topbar = node('header','pp-topbar');
    const brand = node('div','pp-brand',t('console')); brand.append(node('small','','PRESENTER CONSOLE'));
    const timerTools = node('div','pp-timer-tools');
    refs.timerToggle = button(t('start'),toggleTimer,'pp-primary');
    timerTools.append(refs.timerToggle,button(t('reset'),resetTimer));
    const sessionTools = node('div','pp-session-tools');
    refs.status = node('span','pp-status'); refs.status.setAttribute('role','status');
    refs.projectionButton = button(t('projection'),openAudience);
    sessionTools.append(refs.status,refs.projectionButton,button(t('exit'),exit));
    topbar.append(brand,timeBlock(t('clock'),'clock'),timeBlock(t('timer'),'timer'),timerTools,sessionTools);
    const body = node('div','pp-body'), visual = node('main','pp-visual-column');
    const toolbar = node('div','pp-slide-toolbar');
    refs.slideTitle = node('div','pp-slide-title'); refs.slideCount = node('span','pp-slide-count');
    const steps = node('div','pp-step-tools');
    const previous = button('←',()=>adapter.previous()), next = button('→',()=>adapter.next());
    previous.setAttribute('aria-label',t('previous')); next.setAttribute('aria-label',t('next')); steps.append(previous,next);
    toolbar.append(refs.slideTitle,refs.slideCount,steps);
    stage = node('div','pp-stage');
    stage.append(stageBackground());
    const filmstrip = node('nav','pp-filmstrip'); filmstrip.setAttribute('aria-label',t('preview'));
    const heading = node('div','pp-filmstrip-heading'); heading.append(node('span','',t('preview')),node('span','',t('keys')));
    refs.thumbnails = node('div','pp-thumbnails'); filmstrip.append(heading,refs.thumbnails);
    visual.append(toolbar,stage,filmstrip);
    const notePanel = node('aside','pp-notes'), tools = node('div','pp-notes-tools'), fontTools = node('div','pp-font-tools');
    refs.fontRange = node('input'); Object.assign(refs.fontRange,{type:'range',min:'14',max:'40',step:'1'});
    refs.fontRange.setAttribute('aria-label',t('font'));
    refs.fontRange.addEventListener('input',()=>{preferences.fontSize = Number(refs.fontRange.value); applyPreferences();});
    refs.fontValue = node('span','pp-font-value');
    const smaller = button('A−',()=>changeFont(-2)), larger = button('A+',()=>changeFont(2));
    smaller.setAttribute('aria-label',t('smaller')); larger.setAttribute('aria-label',t('larger'));
    fontTools.append(smaller,refs.fontRange,larger,refs.fontValue); tools.append(node('h2','',t('notes')),fontTools);
    refs.notesScroll = node('div','pp-notes-scroll'); refs.notesScroll.tabIndex = 0;
    refs.notesScroll.setAttribute('aria-label',t('notes'));
    notePanel.append(tools,refs.notesScroll); body.append(visual,notePanel); consoleRoot.append(topbar,body);
    // Let focused form controls and note scrolling use their normal keys.
    consoleRoot.addEventListener('keydown',event=>{
      if (event.target.closest('input,textarea,select,[contenteditable="true"]') ||
          ([' ','Enter'].includes(event.key) && event.target.closest('button,a')) ||
          (['ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key) && refs.notesScroll.contains(event.target))) event.stopPropagation();
    });
    document.body.append(consoleRoot); buildThumbnails(); applyPreferences();
  }
  function escapeAttribute(value) { return value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
  function buildThumbnails() {
    const {width,height} = adapter.dimensions();
    thumbnailObserver = new IntersectionObserver(entries=>{
      entries.forEach(item=>{
        if (!item.isIntersecting) return;
        const frame = item.target; frame.srcdoc = frame._preview; delete frame._preview;
        thumbnailObserver.unobserve(frame);
      });
    },{root:refs.thumbnails,rootMargin:'200px'});
    adapter.slides().forEach((slide,index)=>{
      const title = slideTitle(slide,index) || 'Slide ' + (index + 1);
      const thumb = button('',()=>{adapter.jump(slide); publish(); thumb.blur();},'pp-thumb');
      thumb.setAttribute('aria-label',`${index + 1}. ${title}`); thumb.title = `${index + 1}. ${title}`;
      const viewport = node('span','pp-thumb-frame'); viewport.style.height = (158 * height / width) + 'px';
      const frame = node('iframe'); frame.tabIndex = -1; frame.title = title; frame.setAttribute('aria-hidden','true');
      frame.setAttribute('sandbox','allow-same-origin'); frame.style.width = width + 'px'; frame.style.height = height + 'px'; frame.style.transform = `scale(${158 / width})`;
      const clone = slide.cloneNode(true);
      clone.querySelectorAll('script,aside.notes,iframe,object,embed').forEach(e=>e.remove());
      clone.querySelectorAll('[autoplay]').forEach(e=>e.removeAttribute('autoplay'));
      clone.classList.remove('past','future'); clone.classList.add('present');
      const override = `html,body{margin:0!important;overflow:hidden!important;width:${width}px!important;height:${height}px!important}.reveal{width:${width}px!important;height:${height}px!important}.reveal .slides{width:${width}px!important;height:${height}px!important;inset:0!important;margin:0!important;transform:none!important;perspective:none!important}.reveal .slides>section{display:block!important;position:absolute!important;inset:0!important;opacity:1!important;visibility:visible!important;transform:none!important}.reveal .fragment{opacity:1!important;visibility:visible!important;transform:none!important;filter:none!important}*{animation:none!important;transition:none!important}`;
      frame._preview = '<!doctype html><html><head><meta charset="utf-8"><base href="' + escapeAttribute(document.baseURI) + '">' + styles + '<style>' + override + '</style></head><body><div class="reveal"><div class="slides">' + clone.outerHTML + '</div></div></body></html>';
      viewport.append(frame);
      const caption = node('span','pp-thumb-caption'); caption.append(node('span','pp-thumb-number',String(index+1).padStart(2,'0')),document.createTextNode(title));
      thumb.append(viewport,caption); refs.thumbnails.append(thumb); thumbnailObserver.observe(frame);
    });
  }
  function noteFor(slide,index) {
    return notes.find(note=>note?.id && note.id === slide.id) || (notes[index]?.id ? null : notes[index]);
  }
  function slideTitle(slide,index) { return noteFor(slide,index)?.title || adapter.title(slide); }
  // Copy only basic authored formatting. Notes never execute scripts or event handlers.
  function appendNoteContent(source,target) {
    const allowed = new Set(['P','BR','STRONG','B','EM','I','U','S','UL','OL','LI','BLOCKQUOTE','PRE','CODE','H1','H2','H3','H4','HR','A','SPAN','DIV','SUB','SUP']);
    for (const child of source.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) { target.append(document.createTextNode(child.textContent)); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE || ['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM'].includes(child.tagName)) continue;
      if (!allowed.has(child.tagName)) { appendNoteContent(child,target); continue; }
      const element = node(child.tagName.toLowerCase());
      if (child.lang) element.lang = child.lang;
      if (child.tagName === 'A') {
        try {
          const url = new URL(child.getAttribute('href'),document.baseURI);
          if (['http:','https:','mailto:'].includes(url.protocol)) {
            element.href = url.href; element.target = '_blank'; element.rel = 'noopener noreferrer';
          }
        } catch { /* plain label */ }
      }
      appendNoteContent(child,element); target.append(element);
    }
  }
  function renderNotes(index,slide) {
    refs.notesScroll.replaceChildren();
    refs.notesScroll.append(node('h3','pp-notes-heading',`${String(index+1).padStart(2,'0')} / ${slideTitle(slide,index)}`));
    const content = node('div','pp-note-content'), note = noteFor(slide,index);
    if (note && typeof note.text === 'string') { content.classList.add('pp-note-text'); content.textContent = note.text; }
    else {
      // Do not include notes from nested slides on a vertical stack.
      const source = [...slide.querySelectorAll('aside.notes')].find(e=>e.closest('section') === slide);
      if (source) appendNoteContent(source,content);
    }
    refs.notesScroll.append(content.textContent.trim() ? content : node('p','pp-empty',t('empty')));
    refs.notesScroll.scrollTop = 0;
  }
  function updateSlide() {
    if (!active) return;
    const slide = adapter.current(), slides = adapter.slides(), index = slides.indexOf(slide);
    refs.slideTitle.textContent = slideTitle(slide,index);
    const current = adapter.state();
    refs.slideCount.textContent = `${String(index+1).padStart(2,'0')} / ${String(slides.length).padStart(2,'0')}` +
      (slide.querySelector('.fragment') ? ` · ${t('step')} ${current.indexf + 1}` : '');
    if (refs.notesScroll.dataset.page !== String(index)) {
      refs.notesScroll.dataset.page = String(index); renderNotes(index,slide);
      [...refs.thumbnails.children].forEach((thumb,i)=>thumb.setAttribute('aria-current',String(i === index)));
      centerThumbnail();
    }
  }
  function centerThumbnail() {
    const selected = refs.thumbnails.querySelector('[aria-current="true"]'); if (!selected) return;
    const strip = refs.thumbnails.getBoundingClientRect(), bounds = selected.getBoundingClientRect();
    refs.thumbnails.scrollTo({left:Math.max(0,refs.thumbnails.scrollLeft + bounds.left - strip.left - strip.width/2 + bounds.width/2),behavior:'auto'});
  }
  function openAudience() {
    if (audienceWindow && !audienceWindow.closed) { audienceWindow.focus(); return true; }
    const url = new URL(location.href), state = adapter.state();
    url.searchParams.set('__presenter_audience',sessionToken); url.hash = `/${state.indexh}/${state.indexv}`;
    audienceWindow = window.open(url.href,'html-presenter-' + sessionToken,'popup=yes,width=1280,height=720');
    if (!audienceWindow) { toast(t('popupBlocked')); return false; }
    setConnection(false); return true;
  }
  function hideHostElements() {
    hiddenElements = [];
    for (const selector of config.hideElements) {
      try {
        document.querySelectorAll(selector).forEach(element=>{
          if (element === root || element.contains(root) || element === consoleRoot || element.closest('#pp-console') || hiddenElements.some(([e])=>e === element)) return;
          hiddenElements.push([element,element.hidden]); element.hidden = true;
        });
      } catch { console.warn('[HTML Presenter] Invalid hideElements selector:',selector); }
    }
  }
  function enter() {
    if (!adapter || audienceToken) return false;
    if (active) return openAudience();
    sessionToken = Array.from(crypto.getRandomValues(new Uint32Array(3)),n=>n.toString(16)).join('-');
    if (!openAudience()) return false;
    active = true;
    originalConfig = {overview:adapter.getConfig().overview};
    adapter.apply({...adapter.state(),overview:false}); adapter.configure({overview:false});
    buildConsole();
    originalPlace = document.createComment('HTML Presenter original position'); root.before(originalPlace); stage.append(root);
    document.body.classList.add('pp-presenting'); hideHostElements();
    adapter.subscribe(publish);
    resizeObserver = new ResizeObserver(()=>{adapter.layout(); centerThumbnail();}); resizeObserver.observe(stage);
    adapter.layout(); updateSlide(); updateClock(); setConnection(false);
    lifecycleTimer = window.setInterval(()=>{updateClock(); if (audienceWindow?.closed && connected) setConnection(false);},250);
    window.focus(); return true;
  }
  function exit() {
    if (!active) return;
    if (timerStarted !== null) { elapsed += performance.now() - timerStarted; timerStarted = null; }
    active = false; clearInterval(lifecycleTimer); cancelAnimationFrame(syncFrame);
    resizeObserver.disconnect(); thumbnailObserver.disconnect(); adapter.unsubscribe(publish);
    originalPlace.replaceWith(root); consoleRoot.remove(); document.body.classList.remove('pp-presenting');
    hiddenElements.forEach(([element,hidden])=>{element.hidden = hidden;}); hiddenElements = [];
    adapter.configure(originalConfig); adapter.layout();
    if (audienceWindow && !audienceWindow.closed) audienceWindow.close();
    audienceWindow = null; connected = false; launchButton.focus();
  }
  function mainMessage(event) {
    if (!active || !isMessage(event,audienceWindow)) return;
    if (event.data.type === 'ready') { setConnection(true); post(audienceWindow,'state',{state:adapter.state()}); }
    else if (event.data.type === 'state') applyState(event.data.state);
  }
  function audienceMode() {
    sessionToken = audienceToken; document.body.classList.add('pp-audience');
    root.classList.add('pp-audience-deck'); document.body.append(root);
    adapter.configure({controls:false,progress:false,overview:false,showNotes:false});
    hideHostElements();
    const controls = node('div'); controls.id = 'pp-audience-tools'; controls.lang = config.locale;
    const hint = node('span','',t('fullscreenHint'));
    const fullscreen = button(t('fullscreen'),async()=>{
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch { hint.textContent = t('fullscreenError'); showControls(); }
    });
    controls.append(hint,fullscreen); document.body.append(controls);
    let hideTimer;
    function showControls() {
      controls.classList.add('pp-visible'); clearTimeout(hideTimer);
      hideTimer = setTimeout(()=>controls.classList.remove('pp-visible'),2500);
    }
    document.addEventListener('mousemove',showControls);
    root.addEventListener('dblclick',()=>fullscreen.click());
    // Own F only in this window; avoid a second fullscreen request from Reveal.
    document.addEventListener('keydown',event=>{
      if (event.key.toLowerCase() === 'f' && !event.target.closest('input,textarea,select,[contenteditable="true"]') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); event.stopImmediatePropagation(); fullscreen.click();
      }
    },true);
    fullscreen.addEventListener('keydown',event=>{if ([' ','Enter'].includes(event.key)) event.stopPropagation();});
    document.addEventListener('fullscreenchange',()=>{fullscreen.textContent = t(document.fullscreenElement ? 'leaveFullscreen' : 'fullscreen'); adapter.layout();});
    window.addEventListener('message',event=>{
      if (!isMessage(event,window.opener)) return;
      if (event.data.type === 'state' && adapter.valid(event.data.state)) { clearInterval(handshake); applyState(event.data.state); }
    });
    adapter.subscribe(publish);
    handshake = setInterval(()=>{
      if (!window.opener || window.opener.closed) { clearInterval(handshake); toast(t('orphan')); }
      else post(window.opener,'ready');
    },500);
    post(window.opener,'ready'); showControls(); adapter.layout();
  }
  async function loadNotes() {
    if (config.notesFile) {
      try {
        await new Promise((resolve,reject)=>{
          const script = node('script'); script.src = new URL(config.notesFile,document.baseURI).href;
          script.onload = resolve; script.onerror = reject; document.head.append(script);
        });
      } catch { console.warn('[HTML Presenter]',t('loadFailed')); toast(t('loadFailed')); }
    }
    const data = config.notes ?? window[config.notesGlobal];
    const slides = Array.isArray(data) ? data : data?.slides;
    if (slides !== undefined && !Array.isArray(slides)) console.warn('[HTML Presenter] External notes must be an array or { slides: [] }.');
    notes = Array.isArray(slides) ? slides.map(note=>typeof note === 'string' ? {text:note} : note && typeof note === 'object' ? note : null) : [];
  }
  async function initialize(instance) {
    words = translations[config.locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'];
    if (!Array.isArray(config.hideElements)) throw new Error('hideElements must be an array of CSS selectors');
    // Validate the clock locale before opening any windows.
    new Intl.DateTimeFormat(config.locale);
    const link = node('link'); link.rel = 'stylesheet'; link.href = new URL('presenter.css',directory).href; document.head.append(link);
    let deck = instance;
    for (let attempt = 0; attempt < 200; attempt++) {
      deck = deck || window[config.deckGlobal];
      if (deck?.isReady?.()) break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    if (!deck?.isReady?.()) throw new Error(t('deckMissing'));
    adapter = revealAdapter(deck); root = adapter.root();
    if (audienceToken) { audienceMode(); return api; }
    await loadNotes();
    styles = [...document.querySelectorAll('link[rel="stylesheet"],style')].filter(e=>e !== link).map(e=>e.outerHTML).join('\n');
    preferences = readPreferences();
    launchButton = button(t('launch'),enter,'pp-launch'); document.body.append(launchButton);
    window.addEventListener('message',mainMessage);
    window.addEventListener('pagehide',()=>{if (audienceWindow && !audienceWindow.closed) audienceWindow.close();});
    return api;
  }
  const api = window.HTMLPresenter = {
    version:'2.0.0', enter, exit,
    get active() { return active; },
    init(instance,options = {}) {
      if (initPromise) return initPromise;
      config = {...config,...options};
      initPromise = initialize(instance).catch(error=>{
        console.error('[HTML Presenter]',error); toast((words?.failed || 'Presenter initialization failed: ') + error.message);
        initPromise = null; adapter = null; throw error;
      });
      return initPromise;
    }
  };
  if (config.autoStart !== false) api.init().catch(()=>{});
})();
