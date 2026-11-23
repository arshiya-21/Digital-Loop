/*! SandMan Process Flowsheet — 27z-props-keep-scroll.js
 *  v9.89 — the Properties panel keeps its scroll position when it redraws after a change (it used to jump to the top
 *  after every click). It starts at the top only when you open another item, another tab or another card.
 *  Loads last, so it wraps every other renderProps addition. */
{
  const _rp = renderProps;
  let lastKey = null;
  renderProps = function () {
    const P = document.getElementById('props'),
      key = [SEL ? SEL.t + ':' + SEL.id : '', typeof PTAB !== 'undefined' ? PTAB : '', typeof LBL_CSEL !== 'undefined' && LBL_CSEL ? LBL_CSEL.b + ':' + LBL_CSEL.key : ''].join('|'),
      keep = P && key === lastKey ? P.scrollTop : null;
    const r = _rp.apply(this, arguments);
    lastKey = key;
    if (keep != null) {
      const P2 = document.getElementById('props');
      if (P2) P2.scrollTop = keep;
    }
    return r;
  };
}
