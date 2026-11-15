// Standard library: std/dom
// The factory behind PlainScript's `render` blocks when React is not in use.
// React users import `createElement` from "react" instead; the compiler makes
// no assumption about which one is in scope.

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      append(parent, child);
      continue;
    }
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function createElement(tag, props, ...children) {
  if (typeof tag === 'function') {
    return tag({ ...(props || {}), children });
  }

  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }
    if (key === 'className') {
      element.className = String(value);
      continue;
    }
    if (key === 'style' && typeof value === 'object') {
      Object.assign(element.style, value);
      continue;
    }
    if (key === 'value' && 'value' in element) {
      element.value = value;
      continue;
    }
    element.setAttribute(key, value === true ? '' : String(value));
  }

  append(element, children);
  return element;
}

export function mount(node, container) {
  const target = typeof container === 'string' ? document.querySelector(container) : container;
  if (!target) throw new Error('mount target not found');
  target.replaceChildren(node);
  return node;
}
