/* Token Radar dashboard: renders window.RADAR (written by main.ts) with no network.
   Tabs: Board | Live tokens | Sandbox | Methodology. The board is searchable, filterable,
   sortable (headers or dropdown), pinnable, comparable, exportable as CSV, and every row
   opens a tabbed detail drawer (Model | Farm plan | Evidence). Ctrl/⌘K opens the palette. */
(function () {
  'use strict';
  var R = window.RADAR;
  var rows = R.rows;
  var live = R.live;
  var maxImplied = rows.length ? rows[0].implied_value_usd : 1;
  var minImplied = rows.length ? rows[rows.length - 1].implied_value_usd : 1;

  var state = { tab: 'board', q: '', cat: 'all', chain: 'all', watchOnly: false, sort: 'implied', dir: 1, selected: null, dtab: 'model', pins: {}, cmp: {} };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function dec(n, d) {
    var p = Math.pow(10, d);
    var s = (Math.round(n * p) / p).toFixed(d);
    if (s.indexOf('.') >= 0) { s = s.replace(/0+$/, '').replace(/\.$/, ''); }
    return s;
  }
  function fmtMoney(v) {
    if (v >= 1e9) return '$' + dec(v / 1e9, 2) + 'B';
    if (v >= 1e6) return '$' + dec(v / 1e6, 1) + 'M';
    if (v >= 1e3) return '$' + dec(v / 1e3, 1) + 'K';
    return '$' + Math.round(v);
  }
  function fmtPct(v) {
    if (v === null || v === undefined) return '<span class="flat">—</span>';
    var cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    var shown = Math.abs(v) < 0.05 && v !== 0 ? dec(v, 2) : dec(v, 1);
    return '<span class="' + cls + '">' + (v > 0 ? '+' : '') + shown + '%</span>';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return dec(days / 365, 1) + 'y';
    return days + 'd';
  }
  function fmtRatio(r) { return dec(r, 3) + '×'; }
  function chainLabel(chains) {
    if (!chains || chains.length === 0) return '—';
    if (chains.length <= 3) return chains.join(', ');
    return chains.slice(0, 3).join(', ') + ' +' + (chains.length - 3);
  }
  /* Log-scale bar: values span orders of magnitude, so a linear bar hides the small ones. */
  function logPct(v, lo, hi) {
    if (hi <= lo || v <= 0 || lo <= 0) return 100;
    var p = (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * 100;
    return Math.max(6, Math.round(p));
  }
  function bySlug(slug) {
    var found = null;
    rows.forEach(function (r) { if (r.slug === slug) found = r; });
    return found;
  }
  function multEntry(cat) {
    var found = null;
    R.multiples.by_category.forEach(function (e) { if (e.category === (cat || 'Uncategorized')) found = e; });
    return found;
  }

  /* ---- header stats ---- */
  $('meta-asof').textContent = R.as_of;
  $('source-line').textContent = 'Snapshot: ' + R.source + ' · Floor: ' + fmtMoney(R.floor_usd) + ' · Model ' + R.model_version + '.';
  var stats = [
    { n: R.watchlist_size + '/' + R.watchlist_size, l: 'watchlist protocols covered' },
    { n: String(R.board_size), l: 'rows on the board (' + R.watchlist_size + ' watchlist + ' + R.early_size + ' early)' },
    { n: String(R.multiples.live_count), l: 'live-token comparables' },
    { n: dec(R.multiples.global_median, 3) + '×', l: 'global median mcap / TVL' },
  ];
  $('stats').innerHTML = stats.map(function (s) {
    return '<div class="stat"><div class="num">' + esc(s.n) + '</div><div class="lbl">' + esc(s.l) + '</div></div>';
  }).join('');

  /* ---- category value strip: top 8 categories by total implied value, log scale ---- */
  (function renderCatStrip() {
    var totals = {};
    var grand = 0;
    rows.forEach(function (r) {
      var c = r.category || 'Uncategorized';
      totals[c] = (totals[c] || 0) + r.implied_value_usd;
      grand += r.implied_value_usd;
    });
    var top = Object.keys(totals).map(function (c) {
      var mult = R.multiples.global_median;
      R.multiples.by_category.forEach(function (e) { if (e.category === c) mult = e.multiple; });
      return { category: c, total: totals[c], multiple: mult };
    }).sort(function (a, b) { return b.total - a.total; }).slice(0, 8);
    var max = top.length ? top[0].total : 1;
    var min = top.length ? top[top.length - 1].total : 1;
    $('catstrip').innerHTML =
      '<div class="catstrip-head"><b>Implied value by category</b><span>top 8 of ' + Object.keys(totals).length +
      ' categories · ' + fmtMoney(grand) + ' total · multiple used · bars are log scale</span></div>' +
      '<div class="catgrid">' + top.map(function (t) {
        return '<div><div class="catline"><span class="catname">' + esc(t.category) + '</span>' +
          '<span class="catval"><b>' + fmtMoney(t.total) + '</b> · ' + dec(t.multiple, 3) + '×</span></div>' +
          '<div class="catbar"><i style="width:' + logPct(t.total, min, max) + '%"></i></div></div>';
      }).join('') + '</div>';
  })();

  /* ---- filter options ---- */
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('cat').innerHTML += cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
  $('chain').innerHTML += chains.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');

  /* ---- board ---- */
  var SORTS = {
    implied: function (a, b) { return a.rank - b.rank; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
    change: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d) || a.rank - b.rank; },
    age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days) || a.rank - b.rank; },
    name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : a.rank - b.rank; },
  };
  function filtered() {
    var q = state.q.toLowerCase();
    var out = rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var by = SORTS[state.sort] || SORTS.implied;
    var dir = state.dir;
    return out.sort(function (a, b) { return by(a, b) * dir; });
  }
  /* Display order: pinned rows first (they stay on top), then the rest, both in sort order. */
  function displayOrder() {
    var list = filtered();
    var pinned = list.filter(function (r) { return state.pins[r.slug]; });
    var rest = list.filter(function (r) { return !state.pins[r.slug]; });
    return { list: list, pinned: pinned, rest: rest };
  }
  function cmpCount() {
    return Object.keys(state.cmp).filter(function (k) { return state.cmp[k]; }).length;
  }
  function pinCount() {
    return Object.keys(state.pins).filter(function (k) { return state.pins[k]; }).length;
  }

  function rowHtml(r) {
    var pinned = !!state.pins[r.slug];
    var checked = !!state.cmp[r.slug];
    return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="sel"' : '') + '>' +
      '<td class="num rank">' + r.rank + '</td>' +
      '<td><button type="button" class="pinbtn' + (pinned ? ' on' : '') + '" data-pin="' + esc(r.slug) + '" title="' + (pinned ? 'Unpin' : 'Pin to top') + '">📌</button></td>' +
      '<td><input type="checkbox" class="cmpbox" data-cmp="' + esc(r.slug) + '"' + (checked ? ' checked' : '') + ' aria-label="Compare ' + esc(r.name) + '"></td>' +
      '<td><div class="pname">' + esc(r.name) + (r.watchlist ? '<span class="tag">Watchlist</span>' : '') + (pinned ? '<span class="tag pin">Pinned</span>' : '') + '</div>' +
      '<div class="psub">' + esc(r.category || 'Uncategorized') + ' · ' + esc(chainLabel(r.chains)) + '</div></td>' +
      '<td class="num">' + fmtMoney(r.tvl_usd) + '</td>' +
      '<td class="num">' + fmtPct(r.change_7d) + '</td>' +
      '<td class="num">' + fmtAge(r.age_days) + '</td>' +
      '<td><div class="imp">' + fmtMoney(r.implied_value_usd) + '</div><div class="bar"><i style="width:' + logPct(r.implied_value_usd, minImplied, maxImplied) + '%"></i></div></td>' +
      '<td class="tok">no token on record</td></tr>';
  }

  function renderBoard() {
    var d = displayOrder();
    $('count').textContent = 'Showing ' + d.list.length + ' of ' + rows.length + ' rows' + (d.pinned.length ? ' · ' + d.pinned.length + ' pinned' : '');
    var html = '';
    if (d.pinned.length) {
      html += '<tr class="pinsec"><td colspan="9">📌 Pinned — kept on top</td></tr>' + d.pinned.map(rowHtml).join('');
    }
    html += d.rest.map(rowHtml).join('');
    $('rows').innerHTML = html;
    var btn = $('compare-btn');
    btn.textContent = 'Compare (' + cmpCount() + ')';
    btn.disabled = cmpCount() < 2;
    document.querySelectorAll('th[data-sort]').forEach(function (th) {
      var key = th.getAttribute('data-sort');
      var arr = th.querySelector('.arr');
      if (!arr) return;
      arr.textContent = key === state.sort ? (state.dir === 1 ? (key === 'name' ? ' ▲' : ' ▼') : (key === 'name' ? ' ▼' : ' ▲')) : '';
    });
    if (state.selected) {
      var sel = bySlug(state.selected);
      if (sel) renderDrawer(sel); else closeDrawer();
    }
  }

  function setSort(key) {
    if (state.sort === key) state.dir = -state.dir;
    else { state.sort = key; state.dir = 1; }
    $('sort').value = state.sort;
    renderBoard();
  }
  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () { setSort(th.getAttribute('data-sort')); });
  });

  /* ---- detail drawer: Model | Farm plan | Evidence ---- */
  function stepHtml(step) {
    var m = step.match(/^(.*?) Cost: (.*?)\. Time: (.*?)\.?$/);
    if (!m) return esc(step);
    return esc(m[1]) + ' <b>Cost:</b> ' + esc(m[2]) + '. <b>Time:</b> ' + esc(m[3]) + '.';
  }
  function evidenceText(r) {
    var m = r.model;
    var mult = multEntry(r.category);
    if (mult && mult.live_n < 3) {
      return 'Category <b>' + esc(r.category || 'Uncategorized') + '</b>: only <b>' + mult.live_n + '</b> live protocol' +
        (mult.live_n === 1 ? ' trades' : 's trade') + ' (median mcap/TVL <b>' + dec(mult.live_median, 3) +
        '×</b>), too few for a category multiple of their own — at least 3 are needed — so the ' +
        'global median <b>' + dec(R.multiples.global_median, 3) + '×</b> is used as the multiple <b>' +
        dec(m.category_multiple, 3) + '×</b>.';
    } else if (mult) {
      return 'Category <b>' + esc(r.category || 'Uncategorized') + '</b>: <b>' + mult.live_n + '</b> live protocol' +
        (mult.live_n === 1 ? ' trades' : 's trade') + ' at a median mcap/TVL of <b>' + dec(mult.live_median, 3) +
        '×</b>; shrunk toward the global median <b>' + dec(R.multiples.global_median, 3) + '×</b> with a prior of 3, ' +
        'the multiple used is <b>' + dec(m.category_multiple, 3) + '×</b>.';
    }
    return 'No live protocol in the <b>' + esc(r.category || 'Uncategorized') + '</b> category trades yet, so the ' +
      'global median <b>' + dec(R.multiples.global_median, 3) + '×</b> is used as the multiple.';
  }
  function drawerBody(r) {
    var m = r.model;
    if (state.dtab === 'farm') {
      return '<h3>Farm plan — seven steps</h3>' +
        '<ol class="steps">' + r.farm_steps.map(function (s) { return '<li>' + stepHtml(s) + '</li>'; }).join('') + '</ol>' +
        '<p class="note">Token status: <b>no token on record</b> — DefiLlama records no market cap, no CoinGecko id and no ' +
        'symbol for this protocol. That is what the record says, not proof it has no token. ' +
        'DefiLlama slug: <code>' + esc(r.slug) + '</code></p>';
    }
    if (state.dtab === 'evidence') {
      var mult = multEntry(r.category);
      var h = '<h3>Category multiple — the evidence</h3><p class="evidence">' + evidenceText(r) + '</p>';
      if (mult && mult.top && mult.top.length) {
        h += '<p class="evidence">The largest live comparables behind this multiple, by market cap — the ' +
          'multiple itself is the median of all ' + mult.live_n + ' live protocols in the category, shrunk toward the global median:</p>' +
          '<table class="mini"><thead><tr><th>Live comparable</th><th class="num">mcap / TVL</th></tr></thead><tbody>' +
          mult.top.map(function (t) {
            return '<tr><td>' + esc(t.name) + '</td><td class="num"><b>' + fmtRatio(t.ratio) + '</b></td></tr>';
          }).join('') + '</tbody></table>';
      } else {
        h += '<p class="evidence">No live protocol in this category trades yet — the full live set is on the Live tab.</p>';
      }
      return h;
    }
    var eq = [
      ['TVL', fmtMoney(r.tvl_usd)],
      ['multiple', dec(m.category_multiple, 3) + '×'],
      ['growth', dec(m.growth_multiplier, 3) + '×'],
      ['maturity', dec(m.maturity_multiplier, 3) + '×'],
      ['chains', dec(m.chain_multiplier, 3) + '×'],
    ];
    var eqHtml = eq.map(function (c, i) {
      return (i ? '<span class="op">×</span>' : '') +
        '<div class="cell"><div class="k">' + esc(c[0]) + '</div><div class="v">' + esc(c[1]) + '</div></div>';
    }).join('') + '<span class="op">=</span><div class="cell result"><div class="k">Implied value</div><div class="v">' +
      fmtMoney(r.implied_value_usd) + '</div></div>';
    return '<div class="eq">' + eqHtml + '</div>' +
      '<p class="evidence">' + evidenceText(r) + ' Growth is the 7-day TVL change (' +
      (r.change_7d === null ? 'unreported, counted as 0%' : dec(m.growth_pct, 1) + '%') +
      '); maturity counts ' + (m.age_days === null ? '365 days (listed date unknown)' : m.age_days + ' days') +
      '; the chain factor counts ' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + '.</p>';
  }
  function renderDrawer(r) {
    $('drawer-title').textContent = '#' + r.rank + ' ' + r.name;
    $('drawer-sub').textContent = (r.category || 'Uncategorized') + ' · ' + ((r.chains || []).join(', ') || '—') +
      ' · TVL ' + fmtMoney(r.tvl_usd) + ' · 7d ' + (r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + dec(r.change_7d, 1) + '%') +
      ' · listed ' + (r.listed_at || 'unknown') + ' (' + fmtAge(r.age_days) + ' old)' + (r.watchlist ? ' · Watchlist' : '');
    document.querySelectorAll('.dtab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-dtab') === state.dtab);
    });
    $('drawer-body').innerHTML = drawerBody(r);
  }
  function openDrawer(r) {
    state.selected = r.slug;
    renderDrawer(r);
    $('drawer').hidden = false;
    $('backdrop').hidden = false;
    renderBoard();
  }
  function closeDrawer() {
    state.selected = null;
    $('drawer').hidden = true;
    $('backdrop').hidden = true;
    renderBoard();
  }
  $('drawer-close').addEventListener('click', closeDrawer);
  $('backdrop').addEventListener('click', closeDrawer);
  document.querySelectorAll('.dtab').forEach(function (t) {
    t.addEventListener('click', function () {
      state.dtab = t.getAttribute('data-dtab');
      var sel = state.selected ? bySlug(state.selected) : null;
      if (sel) renderDrawer(sel);
    });
  });

  $('rows').addEventListener('click', function (e) {
    var pin = e.target.closest ? e.target.closest('.pinbtn') : null;
    if (pin) {
      var slug = pin.getAttribute('data-pin');
      if (state.pins[slug]) delete state.pins[slug]; else state.pins[slug] = true;
      renderBoard();
      return;
    }
    var box = e.target.closest ? e.target.closest('.cmpbox') : null;
    if (box) {
      var s2 = box.getAttribute('data-cmp');
      if (box.checked && cmpCount() >= 3) { box.checked = false; return; }
      if (box.checked) state.cmp[s2] = true; else delete state.cmp[s2];
      renderBoard();
      return;
    }
    var tr = e.target.closest ? e.target.closest('tr[data-slug]') : null;
    if (!tr) return;
    var r = bySlug(tr.getAttribute('data-slug'));
    if (r) openDrawer(r);
  });

  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('watch-only').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderBoard(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; state.dir = 1; renderBoard(); });

  /* ---- compare dialog ---- */
  function openCompare() {
    var picked = Object.keys(state.cmp).filter(function (k) { return state.cmp[k]; }).map(bySlug).filter(Boolean);
    if (picked.length < 2) return;
    var metricRows = [
      ['Implied value', function (r) { return '<b>' + fmtMoney(r.implied_value_usd) + '</b>'; }],
      ['TVL', function (r) { return fmtMoney(r.tvl_usd); }],
      ['Category multiple', function (r) { return dec(r.model.category_multiple, 3) + '×'; }],
      ['7-day growth', function (r) { return r.change_7d === null ? '—' : (r.change_7d > 0 ? '+' : '') + dec(r.change_7d, 1) + '%'; }],
      ['Maturity', function (r) { return dec(r.model.maturity_multiplier, 3) + '× (' + fmtAge(r.age_days) + ')'; }],
      ['Chains', function (r) { return esc((r.chains || []).join(', ') || '—'); }],
      ['Farm plan', function (r) {
        return '<ol class="mini-steps">' + r.farm_steps.slice(0, 2).map(function (s) { return '<li>' + esc(s.length > 110 ? s.slice(0, 107) + '…' : s) + '</li>'; }).join('') +
          '</ol><span class="muted">+ ' + (r.farm_steps.length - 2) + ' more steps in the drawer</span>';
      }],
    ];
    $('compare-body').innerHTML =
      '<table class="cmp"><thead><tr><th></th>' + picked.map(function (r) {
        return '<th>#' + r.rank + ' ' + esc(r.name) + (r.watchlist ? ' <span class="tag">Watchlist</span>' : '') + '<br><span class="psub">' + esc(r.category || 'Uncategorized') + '</span></th>';
      }).join('') + '</tr></thead><tbody>' +
      metricRows.map(function (mr) {
        return '<tr><td class="metric">' + mr[0] + '</td>' + picked.map(function (r) { return '<td>' + mr[1](r) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    $('compare-modal').hidden = false;
  }
  $('compare-btn').addEventListener('click', openCompare);
  $('compare-close').addEventListener('click', function () { $('compare-modal').hidden = true; });
  $('compare-modal').addEventListener('click', function (e) { if (e.target === $('compare-modal')) $('compare-modal').hidden = true; });

  /* ---- CSV export: the board as currently filtered and sorted, pinned first ---- */
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv() {
    var d = displayOrder();
    var lines = [['rank', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'implied_value_usd', 'watchlist', 'pinned']];
    d.pinned.concat(d.rest).forEach(function (r) {
      lines.push([r.rank, r.name, r.category || '', (r.chains || []).join(';'), r.tvl_usd, r.change_7d === null ? '' : r.change_7d, r.age_days === null ? '' : r.age_days, r.implied_value_usd, r.watchlist ? 'yes' : 'no', state.pins[r.slug] ? 'yes' : 'no']);
    });
    var csv = lines.map(function (row) { return row.map(csvCell).join(','); }).join('\n') + '\n';
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'token-radar-board.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  $('csv-btn').addEventListener('click', exportCsv);

  /* ---- model sandbox: what-if knobs on the same formula ---- */
  var sbProto = $('sb-proto');
  sbProto.innerHTML = rows.map(function (r) { return '<option value="' + esc(r.slug) + '">#' + r.rank + ' ' + esc(r.name) + '</option>'; }).join('');
  function sbRow() { return bySlug(sbProto.value) || rows[0]; }
  function sbLoad() {
    var r = sbRow();
    $('sb-mult').value = r.model.category_multiple;
    /* The exact 7-day change, not the rounded breakdown figure: the model's growth
       multiplier is computed from this value, so the default knobs reproduce the
       official implied value exactly. */
    var g = r.change_7d === null ? 0 : Math.min(R.model.growth_cap, Math.max(R.model.growth_floor, r.change_7d));
    $('sb-growth').value = g;
    $('sb-age').value = r.model.age_days === null ? R.model.unknown_age_days : Math.min(r.model.age_days, 1095);
    $('sb-chains').value = Math.min((r.chains || []).length || 1, 5);
    sbCalc();
  }
  function sbCalc() {
    var r = sbRow();
    var M = R.model;
    var mult = parseFloat($('sb-mult').value);
    var growth = parseFloat($('sb-growth').value);
    var age = parseInt($('sb-age').value, 10);
    var nchains = parseInt($('sb-chains').value, 10);
    var growthMult = 1 + (growth / 100) * M.growth_weight;
    var maturityMult = M.maturity_floor + (Math.min(Math.max(age, 0), M.maturity_days) / M.maturity_days) * M.maturity_range;
    var chainMult = 1 + Math.min(Math.max(nchains - 1, 0), M.chain_max_extra) * M.chain_step;
    var whatif = Math.round(r.tvl_usd * mult * growthMult * maturityMult * chainMult);
    $('sb-mult-val').textContent = dec(mult, 3) + '×';
    $('sb-growth-val').textContent = (growth > 0 ? '+' : '') + dec(growth, 1) + '% → ' + dec(growthMult, 3) + '×';
    $('sb-age-val').textContent = age + 'd → ' + dec(maturityMult, 3) + '×';
    $('sb-chain-val').textContent = nchains + ' chain' + (nchains === 1 ? '' : 's') + ' → ' + dec(chainMult, 3) + '×';
    $('sb-tvl').textContent = fmtMoney(r.tvl_usd);
    $('sb-result').textContent = fmtMoney(whatif) + '  (what-if)';
    $('sb-official').textContent = fmtMoney(r.implied_value_usd);
    var delta = r.implied_value_usd ? (whatif - r.implied_value_usd) / r.implied_value_usd * 100 : 0;
    $('sb-delta').textContent = (delta > 0 ? '+' : '') + dec(delta, 1) + '% vs official';
    $('sb-formula').textContent = 'what-if = ' + fmtMoney(r.tvl_usd) + ' × ' + dec(mult, 3) + ' × ' + dec(growthMult, 3) + ' × ' + dec(maturityMult, 3) + ' × ' + dec(chainMult, 3) + ' — a what-if, not the model’s official value.';
  }
  sbProto.addEventListener('change', sbLoad);
  ['sb-mult', 'sb-growth', 'sb-age', 'sb-chains'].forEach(function (id) {
    $(id).addEventListener('input', sbCalc);
  });
  sbLoad();

  /* ---- command palette ---- */
  var palIdx = 0, palItems = [];
  function palActions() {
    var acts = [
      { label: 'Toggle watchlist only', run: function () { state.watchOnly = !state.watchOnly; $('watch-only').checked = state.watchOnly; renderBoard(); } },
      { label: 'Sort: implied value', run: function () { state.sort = 'implied'; state.dir = 1; $('sort').value = 'implied'; renderBoard(); } },
      { label: 'Sort: TVL', run: function () { state.sort = 'tvl'; state.dir = 1; $('sort').value = 'tvl'; renderBoard(); } },
      { label: 'Sort: 7-day change', run: function () { state.sort = 'change'; state.dir = 1; $('sort').value = 'change'; renderBoard(); } },
      { label: 'Sort: age', run: function () { state.sort = 'age'; state.dir = 1; $('sort').value = 'age'; renderBoard(); } },
      { label: 'Sort: name', run: function () { state.sort = 'name'; state.dir = 1; $('sort').value = 'name'; renderBoard(); } },
      { label: 'Export board as CSV', run: exportCsv },
      { label: 'Open model sandbox', run: function () { showTab('sandbox'); } },
    ];
    if (cmpCount() >= 2) acts.push({ label: 'Compare selected (' + cmpCount() + ')', run: openCompare });
    if (pinCount() > 0) acts.push({ label: 'Clear pins (' + pinCount() + ')', run: function () { state.pins = {}; renderBoard(); } });
    return acts;
  }
  function palRender() {
    var q = $('palette-input').value.toLowerCase();
    var items = [];
    rows.forEach(function (r) {
      if (items.length >= 8) return;
      if (!q || r.name.toLowerCase().indexOf(q) >= 0) items.push({ kind: 'proto', label: '#' + r.rank + ' ' + r.name + ' — ' + fmtMoney(r.implied_value_usd), run: function () { openDrawer(r); } });
    });
    palActions().forEach(function (a) {
      if (!q || a.label.toLowerCase().indexOf(q) >= 0) items.push({ kind: 'action', label: '▸ ' + a.label, run: a.run });
    });
    palItems = items;
    if (palIdx >= items.length) palIdx = 0;
    $('palette-list').innerHTML = items.length ? items.map(function (it, i) {
      return '<div class="pal-item' + (i === palIdx ? ' active' : '') + '" data-i="' + i + '">' + esc(it.label) + '</div>';
    }).join('') : '<div class="pal-empty">No match.</div>';
  }
  function palOpen() {
    $('palette').hidden = false;
    $('palette-input').value = '';
    palIdx = 0;
    palRender();
    $('palette-input').focus();
  }
  function palClose() { $('palette').hidden = true; }
  $('palette-btn').addEventListener('click', palOpen);
  $('palette-input').addEventListener('input', function () { palIdx = 0; palRender(); });
  $('palette-input').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palIdx + 1, palItems.length - 1); palRender(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(palIdx - 1, 0); palRender(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      var it = palItems[palIdx];
      if (it) { palClose(); it.run(); }
    } else if (e.key === 'Escape') { palClose(); }
  });
  $('palette-list').addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('.pal-item') : null;
    if (!el) return;
    var it = palItems[parseInt(el.getAttribute('data-i'), 10)];
    if (it) { palClose(); it.run(); }
  });
  $('palette').addEventListener('click', function (e) { if (e.target === $('palette')) palClose(); });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('palette').hidden ? palOpen() : palClose(); }
    else if (e.key === 'Escape') {
      if (!$('palette').hidden) palClose();
      else if (!$('compare-modal').hidden) $('compare-modal').hidden = true;
      else if (!$('drawer').hidden) closeDrawer();
    }
  });

  /* ---- live tab (all 119 live comparables, by market cap) ---- */
  $('live-rows').innerHTML = live.map(function (p, i) {
    return '<tr><td class="num rank">' + (i + 1) + '</td>' +
      '<td><div class="pname">' + esc(p.name) + '</div><div class="psub">' + esc(p.category || 'Uncategorized') + ' · ' + esc(chainLabel(p.chains)) + '</div></td>' +
      '<td class="num">' + fmtMoney(p.tvl_usd) + '</td>' +
      '<td class="num">' + fmtMoney(p.mcap_usd) + '</td>' +
      '<td class="num"><b>' + fmtRatio(p.ratio) + '</b></td></tr>';
  }).join('');

  /* ---- methodology tab ---- */
  $('mult-rows').innerHTML = R.multiples.by_category.map(function (e) {
    return '<tr><td>' + esc(e.category) + '</td><td class="num">' + e.live_n + '</td>' +
      '<td class="num">' + dec(e.live_median, 3) + '×</td><td class="num"><b>' + dec(e.multiple, 3) + '×</b></td></tr>';
  }).join('') +
    '<tr><td><b>Global median (all live protocols)</b></td><td class="num">' + R.multiples.live_count + '</td>' +
    '<td class="num">' + dec(R.multiples.global_median, 3) + '×</td><td class="num"><b>' + dec(R.multiples.global_median, 3) + '×</b></td></tr>';

  /* ---- tabs ---- */
  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === tab); });
    $('panel-board').hidden = tab !== 'board';
    $('panel-live').hidden = tab !== 'live';
    $('panel-sandbox').hidden = tab !== 'sandbox';
    $('panel-method').hidden = tab !== 'method';
  }
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
  });

  renderBoard();
})();
