/** 要素を作る小さな道具。h('a', { href, class: 'x' }, '文字', 子要素…) */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

/** 別タブで開くリンク。 */
export const ext = (href, text, cls) => h('a', { href, target: '_blank', rel: 'noopener', class: cls }, text);
