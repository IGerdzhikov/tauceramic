/*
 * TAU ceramic — малък runtime за страниците.
 * Чете шаблона в <x-dc>, логиката в <script type="text/x-dc"> и рисува страницата.
 * Поддържа {{стойности}}, <sc-for>, <sc-if> и събития (onClick, onMouseEnter, onChange…).
 * При промяна на състоянието обновява само разликите в DOM, за да работят анимациите и фокусът.
 */
(function () {
  'use strict';

  var style = document.createElement('style');
  style.textContent = 'x-dc{display:block}x-dc:not([data-ready]){visibility:hidden}';
  document.head.appendChild(style);

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (patch) {
    var next = typeof patch === 'function' ? patch(this.state, this.props) : patch;
    Object.assign(this.state, next);
    if (this.__render) this.__render();
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__render) this.__render(); };
  window.DCLogic = DCLogic;

  var WHOLE = /^\{\{([^}]+)\}\}$/;
  var ANY = /\{\{([^}]+)\}\}/g;

  function lookup(path, scope) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var v = scope;
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function str(v) { return v == null ? '' : String(v); }
  function interpolate(text, scope) { return text.replace(ANY, function (_, p) { return str(lookup(p, scope)); }); }

  function eventName(attr, el) {
    var ev = attr.slice(2).toLowerCase();
    if (ev === 'change' && el.tagName === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio') ev = 'input';
    if (ev === 'doubleclick') ev = 'dblclick';
    return ev;
  }

  function process(node, scope) {
    if (node.nodeType === 3) {
      if (node.nodeValue.indexOf('{{') !== -1) node.nodeValue = interpolate(node.nodeValue, scope);
      return;
    }
    if (node.nodeType !== 1) return;
    var tag = node.tagName.toLowerCase();

    if (tag === 'sc-for') {
      var list = lookup(node.getAttribute('list').replace(/[{}]/g, ''), scope) || [];
      var as = node.getAttribute('as') || 'item';
      var frag = document.createDocumentFragment();
      list.forEach(function (item, i) {
        var copy = node.cloneNode(true);
        var sub = Object.assign({}, scope);
        sub[as] = item; sub.$index = i;
        Array.prototype.slice.call(copy.childNodes).forEach(function (ch) { process(ch, sub); });
        while (copy.firstChild) frag.appendChild(copy.firstChild);
      });
      node.replaceWith(frag);
      return;
    }
    if (tag === 'sc-if') {
      var ok = lookup(node.getAttribute('value').replace(/[{}]/g, ''), scope);
      if (!ok) { node.remove(); return; }
      Array.prototype.slice.call(node.childNodes).forEach(function (ch) { process(ch, scope); });
      node.replaceWith.apply(node, Array.prototype.slice.call(node.childNodes));
      return;
    }

    Array.prototype.slice.call(node.attributes).forEach(function (a) {
      var m = a.value.match(WHOLE);
      if (a.name.indexOf('on') === 0 && m) {
        var fn = lookup(m[1], scope);
        node.removeAttribute(a.name);
        if (typeof fn === 'function') { node.__h = node.__h || {}; node.__h[eventName(a.name, node)] = fn; }
        return;
      }
      if (m) {
        var v = lookup(m[1], scope);
        if (v === false || v == null) {
          node.removeAttribute(a.name);
          if (a.name.indexOf('aria-') === 0 && v === false) node.setAttribute(a.name, 'false');
        } else node.setAttribute(a.name, v === true ? (a.name.indexOf('aria-') === 0 ? 'true' : '') : str(v));
        return;
      }
      if (a.value.indexOf('{{') !== -1) node.setAttribute(a.name, interpolate(a.value, scope));
    });
    Array.prototype.slice.call(node.childNodes).forEach(function (ch) { process(ch, scope); });
  }

  // --- DOM patching -------------------------------------------------------
  function bind(el) {
    if (!el.__h) return;
    el.__bound = el.__bound || {};
    Object.keys(el.__h).forEach(function (ev) {
      if (el.__bound[ev]) return;
      el.__bound[ev] = true;
      el.addEventListener(ev, function (e) { if (el.__h && el.__h[ev]) el.__h[ev](e); });
    });
  }
  function morph(oldN, newN) {
    if (oldN.nodeType !== newN.nodeType || (oldN.nodeType === 1 && oldN.tagName !== newN.tagName)) {
      oldN.replaceWith(newN);
      return;
    }
    if (oldN.nodeType === 3 || oldN.nodeType === 8) {
      if (oldN.nodeValue !== newN.nodeValue) oldN.nodeValue = newN.nodeValue;
      return;
    }
    if (oldN.nodeType !== 1) return;
    Array.prototype.slice.call(oldN.attributes).forEach(function (a) { if (!newN.hasAttribute(a.name)) oldN.removeAttribute(a.name); });
    Array.prototype.slice.call(newN.attributes).forEach(function (a) { if (oldN.getAttribute(a.name) !== a.value) oldN.setAttribute(a.name, a.value); });
    oldN.__h = newN.__h;
    if (oldN.tagName === 'INPUT') {
      if (oldN.type === 'checkbox' || oldN.type === 'radio') oldN.checked = newN.hasAttribute('checked');
      else if (document.activeElement !== oldN && newN.hasAttribute('value')) oldN.value = newN.getAttribute('value');
    }
    var oc = Array.prototype.slice.call(oldN.childNodes);
    var nc = Array.prototype.slice.call(newN.childNodes);
    for (var i = 0; i < nc.length; i++) {
      if (i < oc.length) morph(oc[i], nc[i]);
      else oldN.appendChild(nc[i]);
    }
    for (var j = nc.length; j < oc.length; j++) oc[j].remove();
  }

  function mount() {
    var host = document.querySelector('x-dc');
    var script = document.querySelector('script[data-dc-script]');
    if (!host || !script) return;

    var helmet = host.querySelector('helmet');
    if (helmet) {
      Array.prototype.slice.call(helmet.children).forEach(function (n) { document.head.appendChild(n); });
      helmet.remove();
    }
    var template = host.innerHTML;
    host.innerHTML = '';

    var Component = new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic);
    var instance = new Component({});

    function build() {
      var tpl = document.createElement('template');
      tpl.innerHTML = template;
      var vals = instance.renderVals();
      Array.prototype.slice.call(tpl.content.childNodes).forEach(function (n) { process(n, vals); });
      return tpl.content;
    }
    var first = true;
    instance.__render = function () {
      var content = build();
      if (first) { host.appendChild(content); first = false; }
      else {
        var wrap = document.createElement('div');
        wrap.appendChild(content);
        var oc = Array.prototype.slice.call(host.childNodes);
        var nc = Array.prototype.slice.call(wrap.childNodes);
        for (var i = 0; i < nc.length; i++) { if (i < oc.length) morph(oc[i], nc[i]); else host.appendChild(nc[i]); }
        for (var j = nc.length; j < oc.length; j++) oc[j].remove();
      }
      Array.prototype.slice.call(host.querySelectorAll('*')).forEach(bind);
    };
    instance.__render();
    if (typeof instance.componentDidMount === 'function') instance.componentDidMount();
    host.setAttribute('data-ready', '');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
