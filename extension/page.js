// Serialized into a DevTools isolated world, once per frame/document.
export function pageCommand(command, payload = {}) {
  try {
    const key = '__jevCompanionState';
    let state = globalThis[key];
    if (!state) {
      state = globalThis[key] = {nodes: new Map(), sequence: 0, stopped: false, host: null, armedUntil: 0, revision: 0, watched: new WeakSet()};
      const takeover = event => {
        if (!event.isTrusted || !state.host || Date.now() < state.armedUntil) return;
        state.stopped = true; state.host.remove(); state.host = null;
        if (typeof globalThis.__jev_takeover === 'function') globalThis.__jev_takeover(JSON.stringify({type:event.type,armedUntil:state.armedUntil,now:Date.now()}));
        else globalThis.chrome?.runtime?.sendMessage({type: 'takeover'}).catch(() => {});
      };
      for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(name, takeover, true);
    }
    const roots = [document];
    for (let i = 0; i < roots.length; i++) for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot && el !== state.host) roots.push(el.shadowRoot);
    const relevantMutation=record=>{
      const target=record.target.nodeType===1?record.target:record.target.parentElement;
      if(target?.closest?.('#jev-companion-indicator'))return false;
      if(record.type==='childList'&&[...record.addedNodes,...record.removedNodes].length&&[...record.addedNodes,...record.removedNodes].every(n=>n.id==='jev-companion-indicator'))return false;
      return true;
    };
    for(const root of roots)if(!state.watched.has(root)){state.watched.add(root);const observer=new MutationObserver(records=>{if(records.some(relevantMutation))state.revision++;});observer.observe(root,{subtree:true,childList:true,attributes:true,characterData:true});}
    const all = selector => roots.flatMap(root => [...root.querySelectorAll(selector)]);
    const nameOf = node => {
      const root = node.getRootNode();
      const labelled = (node.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => root.getElementById?.(id)?.textContent || '').join(' ');
      return (node.getAttribute('aria-label') || labelled.trim() || [...(node.labels || [])].map(l => l.innerText || l.textContent).join(' ') || node.innerText || node.getAttribute('placeholder') || node.getAttribute('name') || node.getAttribute('title') || node.tagName).trim().slice(0, 180);
    };
    const guard = node => JSON.stringify([node.tagName, nameOf(node), node.getAttribute('href'), node.type, node.value, node.disabled, node.readOnly, node.getAttribute('aria-disabled')]);
    const rendered = node => {const r = node.getBoundingClientRect(), s = getComputedStyle(node); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';};
    const visible = node => {const r = node.getBoundingClientRect(); return rendered(node) && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;};
    const deepHit = (x, y) => {let hit = document.elementFromPoint(x, y); while (hit?.shadowRoot) {const next = hit.shadowRoot.elementFromPoint?.(x, y); if (!next || next === hit) break; hit = next;} return hit;};
    const epoch = () => JSON.stringify([location.href, innerWidth, innerHeight, scrollX, scrollY, state.revision]);
    function overlay(message, color = '#8b5cf6', target, point) {
      if (!state.host) {
        state.host = document.createElement('div'); state.host.id = 'jev-companion-indicator';
        state.host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
        document.documentElement.append(state.host); state.shadow = state.host.attachShadow({mode: 'closed'});
      }
      const root = state.shadow; root.replaceChildren();
      const frame = document.createElement('div'); frame.style.cssText = `position:fixed;inset:3px;border:3px solid ${color};border-radius:9px;pointer-events:none;box-shadow:inset 0 0 25px ${color}22`; root.append(frame);
      const badge = document.createElement('div'); badge.textContent = '● JEV · ' + message + ' · Interact to take over';
      badge.style.cssText = `position:fixed;top:14px;right:14px;background:#181425;color:white;border:1px solid ${color};border-radius:20px;padding:10px 16px;font:12px system-ui;box-shadow:0 3px 20px #0003`; root.append(badge);
      if (target) {const r = target.getBoundingClientRect(); const box = document.createElement('div'); box.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:3px solid ${color};border-radius:7px;box-sizing:border-box;background:${color}18`; root.append(box); point ||= {x: r.left + r.width / 2, y: r.top + r.height / 2};}
      if (point) {const dot = document.createElement('div'); dot.style.cssText = `position:fixed;left:${point.x - 8}px;top:${point.y - 8}px;width:16px;height:16px;background:${color};border:3px solid white;border-radius:50%;box-shadow:0 0 0 8px ${color}44`; root.append(dot);}
    }
    if (command === 'release') {state.host?.remove(); state.host = null; state.stopped = true; state.armedUntil = 0; state.nodes.clear(); return {ok: true};}
    if (command === 'start') {state.stopped = false; overlay('Observing'); return {ok: true};}
    if (command === 'disarm') {state.armedUntil = 0; return {ok: true};}
    if (state.stopped) throw Error('Paused: user took over this tab.');
    if (document.hasFocus() && !payload.nativeInput) throw Error('Paused: target tab is in use. Switch away before continuing.');
    if (command === 'arm') {state.armedUntil = Date.now() + 30000; return {ok: true};}
    if (command === 'mark') {state.actionLabel=String(payload.message||'Working').slice(0,180);state.actionTarget=state.nodes.get(payload.target)?.node;state.actionColor=payload.color||'#8b5cf6';overlay(state.actionLabel,state.actionColor,state.actionTarget,payload.point);return {ok:true};}
    if (command === 'pointer') {overlay(state.actionLabel||'Moving pointer',state.actionColor||'#8b5cf6',state.actionTarget?.isConnected?state.actionTarget:null,payload.point);return {ok:true};}
    if (command === 'register') {
      const node=payload.node;
      if(!node?.tagName||[...state.nodes.values()].some(value=>value.node===node)||!rendered(node)||node.disabled||node.readOnly||['password','hidden'].includes(node.type))return null;
      const kind=node.type==='file'?'upload':node.tagName==='SELECT'?'select':node.tagName==='TEXTAREA'||node.getAttribute('role')==='textbox'||node.isContentEditable||node.tagName==='INPUT'&&!['checkbox','radio','button','submit','range','color'].includes(node.type)?'type':'click';
      // Native select options are already represented by the regular DOM observer.
      if(kind==='select')return null;
      const id=payload.id;state.nodes.set(id,{node,guard:guard(node)});const r=node.getBoundingClientRect();
      return {id,kind,name:nameOf(node),tag:node.tagName,role:node.getAttribute('role'),value:node.value||'',checked:node.checked||false,inViewport:visible(node),href:node.href||undefined,rect:{x:r.left,y:r.top,width:r.width,height:r.height}};
    }
    if (command === 'observe') {
      overlay('Observing'); state.nodes.clear(); const elements = [], links = [];
      const selectors = 'a[href],button,input,textarea,select,[role="button"],[role="combobox"],[role="textbox"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[role="option"],[role="slider"],[contenteditable="true"],[tabindex],[draggable="true"],canvas,summary,video,iframe';
      for (const node of all(selectors)) {
        if (elements.length >= 230) break;
        if ((!rendered(node) && node.type !== 'file') || node.disabled || node.getAttribute('aria-disabled') === 'true' || ['hidden', 'password'].includes(node.type) || node.readOnly) continue;
        const kind = node.type === 'file' ? 'upload' : node.tagName === 'SELECT' ? 'select' : node.isContentEditable || (node.tagName === 'TEXTAREA' || node.getAttribute('role') === 'textbox') || node.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(node.type) ? 'type' : 'click';
        const id = 'e' + (++state.sequence), r = node.getBoundingClientRect(); state.nodes.set(id, {node, guard: guard(node)});
        const item = {id, kind, name: nameOf(node), tag: node.tagName, role: node.getAttribute('role'), value: node.value || '', checked: node.checked || false, inViewport: visible(node), href: node.href || undefined, draggable: node.draggable || false, rect: {x: r.left, y: r.top, width: r.width, height: r.height}};
        if (kind === 'upload') item.accept = node.accept;
        if (kind === 'select') {
          for (const option of [...node.options].slice(0, 60)) if (!option.disabled && option.value !== node.value && elements.length < 230) {const oid = id + 'o' + option.index; state.nodes.set(oid, {node, guard: guard(node), option: option.value}); elements.push({...item, id: oid, name: item.name + ' → ' + option.text, value: option.value});}
        } else elements.push(item);
        if (node.href && /^https?:/.test(node.href)) links.push({id, text: item.name, url: node.href});
      }
      // Offer nested scroll areas independently of the main viewport.
      for (const node of all('*')) {
        if (elements.length >= 240) break;
        const s = getComputedStyle(node);
        if (visible(node) && /(auto|scroll)/.test(s.overflowY + s.overflowX) && (node.scrollHeight > node.clientHeight + 20 || node.scrollWidth > node.clientWidth + 20)) {
          const id = 'e' + (++state.sequence); state.nodes.set(id, {node, guard: guard(node)}); elements.push({id, kind: 'scroll', name: nameOf(node), inViewport: true, scrollTop: node.scrollTop, scrollLeft: node.scrollLeft});
        }
      }
      const texts = [];
      for (const root of roots) {const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode()) && texts.join('').length < 18000) {const p = node.parentElement; if (!p || p.closest('script,style,noscript,[hidden],#jev-companion-indicator') || !visible(p)) continue; const text = node.textContent.trim(); if (text) texts.push(text);}}
      const dialogs = all('[role="dialog"],dialog[open]').filter(visible).map(el => nameOf(el));
      return {url: location.href, title: document.title, text: texts.join('\n').slice(0, 18000), elements, links, dialogs, tables:all('table').slice(0,30).map(t=>({columns:[...(t.rows[0]?.cells||[])].map(c=>c.innerText||c.textContent),rows:t.rows.length,inViewport:visible(t)})), viewport: {width: innerWidth, height: innerHeight}, epoch: epoch()};
    }
    if(command==='selection'){
      const saved=payload.target&&state.nodes.get(payload.target);const node=saved?.node;
      if(node?.type==='password')throw Error('Password values cannot be copied');
      return {text:node&&typeof node.selectionStart==='number'?node.value.slice(node.selectionStart,node.selectionEnd):String(window.getSelection()||'')};
    }
    if(command==='find'){overlay('Finding text','#f59e0b');return {found:window.find(payload.text,false,false,true,false,false,false)};}
    if (command === 'extract') {
      overlay('Extracting', '#10b981');
      return {url: location.href, title: document.title, capturedAt: new Date().toISOString(), headings:all('h1,h2,h3,[role="heading"]').filter(visible).slice(0,100).map(n=>({text:nameOf(n),url:n.closest('a')?.href||n.querySelector('a')?.href||location.href})), text: roots.map(root => (root === document ? document.body?.innerText : root.textContent) || '').join('\n').slice(0, 100000), links: all('a[href]').filter(visible).slice(0, 500).map(n => ({text: nameOf(n), url: n.href})), tables: all('table').slice(0, 20).map(t => [...t.rows].slice(0, 500).map(r => [...r.cells].map(c => c.innerText)))};
    }
    if (command === 'visual') {
      if (payload.epoch !== epoch()) throw Error('Visual target is stale after navigation, resize or scrolling.');
      const {x, y} = payload;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) throw Error('Visual coordinates are outside the page viewport.');
      const hit = deepHit(x, y);
      if (!hit || ['password', 'file'].includes(hit.type)) throw Error('This visual target requires a DOM target or manual takeover.');
      overlay('Visual interaction', '#f59e0b', null, {x, y}); return {x, y};
    }
    if (command === 'inspect' || command === 'act' || command === 'node') {
      const action = payload.action || payload;
      if (action.operation === 'WAIT') {overlay('Waiting'); return {ok: true};}
      if (action.operation.startsWith('SCROLL_') && !action.target) {overlay('Scrolling'); window.scrollBy(0, (action.operation === 'SCROLL_DOWN' ? 1 : -1) * innerHeight * .75); return {ok: true};}
      const saved = state.nodes.get(action.target);
      if (!saved || !saved.node.isConnected || saved.guard !== guard(saved.node) || (!rendered(saved.node) && saved.node.type !== 'file') || saved.node.disabled || saved.node.readOnly) throw Error('STALE: Page control changed. Observe again before interacting.');
      const node = saved.node;
      if (command === 'node') return node;
      if (action.operation === 'SCROLL_TO') {node.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'}); overlay('Scrolling to control', '#8b5cf6', node); return {ok: true};}
      if (action.operation.startsWith('SCROLL_')) {node.scrollBy(0, (action.operation === 'SCROLL_DOWN' ? 1 : -1) * node.clientHeight * .75); overlay('Scrolling', '#8b5cf6', node); return {ok: true};}
      if(action.operation==='UPLOAD'&&command==='inspect'){overlay('Uploading','#10b981');return {tag:node.tagName,kind:node.type,accept:node.accept,multiple:node.multiple};}
      if (!visible(node)) throw Error('STALE: Control is offscreen. Scroll to it first.');
      const rect = node.getBoundingClientRect(), x = Math.max(1, Math.min(innerWidth - 2, rect.left + rect.width / 2)), y = Math.max(1, Math.min(innerHeight - 2, rect.top + rect.height / 2));
      let hit = deepHit(x, y);
      const nodeRoot=node.getRootNode();
      if(nodeRoot.host){let outer=nodeRoot;while(outer.host?.getRootNode()?.host)outer=outer.host.getRootNode();if(hit===outer.host||outer.host.contains(hit))hit=nodeRoot.elementFromPoint?.(x,y)||hit;}
      if (hit !== node && !node.contains(hit)) throw Error('STALE: Target is covered by another element.');
      overlay(action.operation === 'TYPE' ? 'Typing' : action.operation, action.operation === 'TYPE' ? '#3b82f6' : '#8b5cf6', node);
      if (command === 'inspect') return {x, y, tag: node.tagName, kind: node.type, href: node.href, option: saved.option, accept: node.accept, multiple: node.multiple, viewport: {width: innerWidth, height: innerHeight}};
      // Only native SELECT uses a DOM mutation; pointer and text input use DevTools.
      if (action.operation === 'SELECT') {if (saved.option === undefined) throw Error('Missing select option'); node.value = saved.option; node.dispatchEvent(new Event('input', {bubbles: true})); node.dispatchEvent(new Event('change', {bubbles: true}));}
      else throw Error('This action requires native browser input.');
      return {ok: true};
    }
    throw Error('Unknown page command');
  } catch (error) {return {__jevError: error.message};}
}

export function pageFocusGuard(command) {
  const key = '__jevFocusGuard';
  if (command === 'release') {const guard = window[key]; if (guard) {window.open = guard.open; window.focus = guard.focus; document.removeEventListener('click', guard.click, true); document.removeEventListener('submit', guard.submit, true); delete window[key];} return {ok: true};}
  if (window[key]) return {ok: true};
  const redirect = event => {
    const node = event.composedPath().find(n => n?.tagName === 'A' || n?.tagName === 'FORM');
    if (!node) return;
    const target = node.getAttribute('target'); node.setAttribute('target', '_self');
    setTimeout(() => {if (target === null) node.removeAttribute('target'); else node.setAttribute('target', target);}, 0);
  };
  window[key] = {open: window.open, focus: window.focus, click: redirect, submit: redirect};
  document.addEventListener('click', redirect, true); document.addEventListener('submit', redirect, true);
  window.open = () => null; window.focus = () => {}; return {ok: true};
}
