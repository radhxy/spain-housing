/* Spain Housing Monitor – renders data/dashboard.json (built by scripts/build_data.py). */
(function () {
  "use strict";

  // ------------------------------------------------------------------ palette
  // Validated categorical slots (light / dark steps of the same hues).
  const SERIES = {
    light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
    dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  };
  const SEQ = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
  const DIV_LIGHT = ["#184f95", "#3987e5", "#9ec5f4", "#f0efec", "#f3b0ae", "#e34948", "#a92e2e"];
  const DIV_DARK = ["#5598e7", "#2a78d6", "#1c3f6b", "#383835", "#6b2a2a", "#d04545", "#f08a8a"];
  const PARTY = { PP: 0, PSOE: 7, Vox: 5, Sumar: 6 }; // slot index per party

  const isDark = () => {
    const t = document.documentElement.getAttribute("data-theme");
    if (t) return t === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const S = (i) => (isDark() ? SERIES.dark : SERIES.light)[i];
  const ink = () => ({
    primary: tok("--ink"), secondary: tok("--ink-2"), muted: tok("--muted"),
    grid: tok("--line"), axis: tok("--line-strong"), surface: tok("--surface"),
  });

  // ------------------------------------------------------------------ helpers
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, html = "") => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (html) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v, signed = true, d = 1) => v == null || isNaN(v) ? "—" : (signed && v > 0 ? "+" : v < 0 ? "−" : "") + (d === 2 ? nf2 : nf1).format(Math.abs(v)) + "%";
  const eur = (v) => v == null ? "—" : "€" + nf0.format(v);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = (t) => {
    if (/^\d{4}Q\d$/.test(t)) return `Q${t[5]} ${t.slice(0, 4)}`;
    if (/^\d{4}-\d{2}$/.test(t)) return `${MONTHS[+t.slice(5) - 1]} ${t.slice(0, 4)}`;
    return t;
  };
  const shortDate = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
  const last = (s) => ({ t: s.t[s.t.length - 1], v: s.v[s.v.length - 1] });
  const at = (s, t) => { if (!s) return null; const i = s.t.indexOf(t); return i < 0 ? null : s.v[i]; };
  const shiftQ = (t, n) => { let y = +t.slice(0, 4), q = +t[5] - 1 + n; y += Math.floor(q / 4); q = ((q % 4) + 4) % 4; return `${y}Q${q + 1}`; };
  const shiftM = (t, n) => { let y = +t.slice(0, 4), m = +t.slice(5) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return `${y}-${String(m + 1).padStart(2, "0")}`; };
  const sum12 = (s, t) => { if (!s) return null; const i = s.t.indexOf(t); if (i < 11) return null; let a = 0; for (let k = i - 11; k <= i; k++) a += s.v[k]; return a; };
  const yoy = (now, before) => (now == null || before == null || before === 0) ? null : (now / before - 1) * 100;
  const daysTo = (iso) => Math.ceil((new Date(iso + "T00:00:00+01:00") - new Date()) / 864e5);
  const quarterEnd = (t) => `${t.slice(0, 4)}-${["03-31", "06-30", "09-30", "12-31"][+t[5] - 1]}`;

  let D, GEO;
  const charts = {};
  const renderers = [];

  function chart(id) {
    if (charts[id]) return charts[id];
    const node = document.getElementById(id);
    const c = echarts.init(node, null, { renderer: "canvas" });
    charts[id] = c;
    return c;
  }
  const register = (fn) => { renderers.push(fn); fn(); };

  // Shared ECharts chrome built from the theme tokens.
  function base(extra = {}) {
    const c = ink();
    return Object.assign({
      backgroundColor: "transparent",
      textStyle: { fontFamily: "Source Sans 3, system-ui, sans-serif", color: c.secondary },
      animationDuration: 500,
      grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis", confine: true,
        backgroundColor: c.surface, borderColor: c.axis, borderWidth: 1,
        textStyle: { color: c.primary, fontSize: 13 },
        axisPointer: { type: "line", lineStyle: { color: c.muted, width: 1 } },
      },
      legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 14, itemHeight: 4, textStyle: { color: c.secondary, fontSize: 12 } },
    }, extra);
  }
  function axisX(type = "category", extra = {}) {
    const c = ink();
    return Object.assign({
      type, boundaryGap: type === "category" ? false : undefined,
      axisLine: { lineStyle: { color: c.axis } }, axisTick: { show: false },
      axisLabel: { color: c.muted, fontSize: 11, hideOverlap: true },
      splitLine: { show: false },
    }, extra);
  }
  function axisY(extra = {}) {
    const c = ink();
    return Object.assign({
      type: "value", axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: c.muted, fontSize: 11 },
      splitLine: { lineStyle: { color: c.grid, width: 1 } },
    }, extra);
  }
  const line = (name, data, color, extra = {}) => Object.assign({
    name, type: "line", data, showSymbol: false, symbolSize: 8, smooth: false,
    lineStyle: { width: 2, color }, itemStyle: { color, borderColor: ink().surface, borderWidth: 2 },
    emphasis: { focus: "series" },
  }, extra);

  // ------------------------------------------------------------------ overview
  function renderOverview() {
    const P = D.politics, M = D.market;
    $("#genStamp").textContent = "data refreshed " + shortDate(D.generated);
    $("#footStamp").textContent = `Dataset generated ${D.generated.replace("T", " ").replace("Z", " UTC")}. Political tracker updated ${P.updated}. Portal figures as of ${M.as_of}.`;
    const ipv = last(D.ipv.ES.all_yoy);
    $("#heroYoy").textContent = pct(ipv.v, false);
    $("#politicsHeadline").textContent = P.headline;
    $("#cdElection").textContent = Math.max(0, daysTo(P.election.date));
    const vote = P.upcoming.find((u) => /Diputación Permanente/.test(u.title));
    $("#cdVote").textContent = vote ? Math.max(0, daysTo(vote.date)) : "—";

    const dec = $("#decrees");
    dec.innerHTML = "";
    for (const d of P.decrees || []) {
      dec.append(el("div", { class: "decree" }, `<div class="decree-top"><b>${esc(d.id)}</b><span class="pill ${d.level}"><span class="dot"></span>${esc(d.status)}</span></div><p>${esc(d.summary)}</p>`));
    }
  }

  function kpis() {
    const box = $("#kpis");
    box.innerHTML = "";
    const ipvY = D.ipv.ES.all_yoy, ipvL = last(ipvY), ipvPrev = ipvY.v[ipvY.v.length - 2];
    const ap = D.appraisal.ES, apL = last(ap), apY = yoy(apL.v, at(ap, shiftQ(apL.t, -4)));
    const sales = D.sales.ES.all, sL = last(sales), sY = yoy(sL.v, at(sales, shiftM(sL.t, -12)));
    const s12 = sum12(sales, sL.t), s12y = yoy(s12, sum12(sales, shiftM(sL.t, -12)));
    const eu = D.euribor, eL = last(eu), e12 = at(eu, shiftM(eL.t, -12));
    const R = D.market.rent.national, Y = D.yields;
    const ys = Object.entries(Y.by_province).sort((a, b) => b[1].gross_yield - a[1].gross_yield);
    const pn = (c) => D.provinces[c].name;
    const fc = D.market.other_indicators.find((o) => /Fotocasa/.test(o.label));

    const tiles = [
      { label: "House prices", value: pct(ipvL.v), unit: "y/y", delta: `${label(ipvL.t)} · was ${pct(ipvPrev)} the quarter before`, dir: ipvL.v > ipvPrev ? "up" : "", src: "INE house price index", spark: ipvY.v.slice(-24), sparkT: ipvY.t.slice(-24) },
      { label: "Appraised value", value: eur(apL.v), unit: "/m²", delta: `${pct(apY)} y/y · ${label(apL.t)}`, dir: apY > 0 ? "up" : "down", src: "Ministry of Housing appraisals", spark: ap.v.slice(-32), sparkT: ap.t.slice(-32) },
      { label: "Asking rent", value: "€" + nf1.format(R.eur_m2), unit: "/m²·month", delta: `${pct(R.yoy)} y/y · ${pct(R.qoq)} q/q`, dir: R.yoy > 0 ? "up" : "down", src: `idealista, ${D.market.as_of}` + (fc ? ` · Fotocasa ${fc.value}` : "") },
      { label: "Gross rental yield", value: nf1.format(Y.national.gross_yield) + "%", unit: "Spain", delta: `${pn(ys[0][0])} ${nf1.format(ys[0][1].gross_yield)}% → ${pn(ys[ys.length - 1][0])} ${nf1.format(ys[ys.length - 1][1].gross_yield)}%`, src: "Asking rent ÷ asking price" },
      { label: "Home sales", value: nf0.format(sL.v), unit: label(sL.t), delta: `${pct(sY)} y/y · 12 m: ${nf0.format(s12)} (${pct(s12y)})`, dir: sY < 0 ? "down" : "up", neutral: true, src: "INE registered sales", spark: sales.v.slice(-36), sparkT: sales.t.slice(-36) },
      { label: "12-month Euribor", value: nf2.format(eL.v) + "%", unit: label(eL.t), delta: `${e12 == null ? "" : (eL.v - e12 >= 0 ? "+" : "−") + nf2.format(Math.abs(eL.v - e12)) + " pp in a year"}`, dir: eL.v > e12 ? "up" : "down", src: "ECB monthly average", spark: eu.v.slice(-48), sparkT: eu.t.slice(-48) },
    ];
    tiles.forEach((k, i) => {
      const n = el("div", { class: "kpi" }, `<span class="kpi-label">${esc(k.label)}</span><span class="kpi-value">${esc(k.value)}<small>${esc(k.unit)}</small></span><span class="kpi-delta ${k.neutral ? "" : k.dir || ""}">${esc(k.delta)}</span><span class="kpi-src">${esc(k.src)}</span>${k.spark ? `<div class="kpi-spark" id="spark${i}"></div>` : ""}`);
      box.append(n);
    });
    tiles.forEach((k, i) => {
      if (!k.spark) return;
      const c = chart("spark" + i), col = S(0);
      c.setOption({
        backgroundColor: "transparent", animation: false,
        grid: { left: 2, right: 6, top: 4, bottom: 2 },
        xAxis: { type: "category", show: false, data: k.sparkT, boundaryGap: false },
        yAxis: { type: "value", show: false, scale: true },
        tooltip: { trigger: "axis", confine: true, backgroundColor: ink().surface, borderColor: ink().axis, textStyle: { color: ink().primary, fontSize: 12 }, formatter: (p) => `${label(p[0].name)}: <b>${nf1.format(p[0].value)}</b>`, axisPointer: { lineStyle: { color: ink().muted } } },
        series: [{
          type: "line", data: k.spark, showSymbol: false, lineStyle: { width: 1.5, color: col },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: col + "40" }, { offset: 1, color: col + "00" }]) },
          markPoint: { symbol: "circle", symbolSize: 6, itemStyle: { color: col }, label: { show: false }, data: [{ coord: [k.sparkT.length - 1, k.spark[k.spark.length - 1]] }] },
        }],
      }, true);
    });
  }

  // ------------------------------------------------------------------ map
  const codes = () => Object.keys(D.provinces);
  const yieldOf = (c) => D.yields.by_province[c];
  let mapState = { metric: "price", idx: 0, selected: "28", timer: null };

  const METRICS = {
    price: {
      kind: "quarter", scale: "seq", unit: "€/m²",
      periods: () => D.appraisal.ES.t.filter((t) => t >= "2005Q1"),
      value: (c, t) => at(D.appraisal["p" + c], t),
      fmt: (v) => eur(v) + "/m²",
      note: "Average appraised value of free-market homes (Ministry of Housing). Appraisals run about 20% below asking prices.",
    },
    priceYoy: {
      kind: "quarter", scale: "div", cap: 20, unit: "%",
      periods: () => D.appraisal.ES.t.filter((t) => t >= "2006Q1"),
      value: (c, t) => yoy(at(D.appraisal["p" + c], t), at(D.appraisal["p" + c], shiftQ(t, -4))),
      fmt: (v) => pct(v),
      note: "Annual change in appraised €/m². Red = rising, blue = falling.",
    },
    sales: {
      kind: "month", scale: "seq", log: true, unit: "homes",
      periods: () => D.sales.ES.all.t.filter((t) => t >= "2007-12"),
      value: (c, t) => sum12(D.sales["p" + c]?.all, t),
      fmt: (v) => nf0.format(v) + " homes",
      note: "Registered home purchases in the 12 months to the selected month (INE). Colour uses a log scale.",
    },
    salesYoy: {
      kind: "month", scale: "div", cap: 40, unit: "%",
      periods: () => D.sales.ES.all.t.filter((t) => t >= "2008-12"),
      value: (c, t) => yoy(sum12(D.sales["p" + c]?.all, t), sum12(D.sales["p" + c]?.all, shiftM(t, -12))),
      fmt: (v) => pct(v),
      note: "12-month sales vs the 12 months before. Red = more sales, blue = fewer.",
    },
    yield: {
      kind: null, scale: "seq", unit: "%",
      value: (c) => yieldOf(c)?.gross_yield, fmt: (v) => nf2.format(v) + "%",
      note: "Gross yield = 12 × asking rent ÷ asking price. Provinces without a published rent are modelled (see Yields).",
    },
    rent: {
      kind: null, scale: "seq", unit: "€/m²",
      value: (c) => yieldOf(c)?.rent_m2, fmt: (v) => "€" + nf1.format(v) + "/m²",
      note: "Asking rent per m² per month (idealista, latest month). Modelled where idealista doesn't publish the province.",
    },
    rentYoy: {
      kind: null, scale: "div", cap: 12, unit: "%",
      value: (c) => yieldOf(c)?.rent_yoy, fmt: (v) => pct(v),
      note: "Annual change in asking rent. The province figure where published, otherwise its region's.",
    },
  };

  function metricRange(m) {
    const vals = [];
    const ps = m.periods ? m.periods() : [null];
    for (const t of ps) for (const c of codes()) { const v = m.value(c, t); if (v != null && isFinite(v)) vals.push(v); }
    vals.sort((a, b) => a - b);
    const q = (p) => vals[Math.floor(p * (vals.length - 1))];
    if (m.scale === "div") { const a = Math.min(m.cap, Math.max(Math.abs(q(0.02)), Math.abs(q(0.98)))); return [-a, a]; }
    return [q(0.01), q(0.99)];
  }

  function setupMap() {
    echarts.registerMap("es", GEO);
    const sel = $("#mapMetric"), slider = $("#timeSlider");
    sel.addEventListener("change", () => { stopPlay(); mapState.metric = sel.value; configureSlider(true); drawMap(); });
    slider.addEventListener("input", () => { mapState.idx = +slider.value; drawMap(); });
    $("#playBtn").addEventListener("click", () => (mapState.timer ? stopPlay() : startPlay()));
    configureSlider(true);
    chart("mapChart").on("click", (p) => { if (p.name) { mapState.selected = p.name; drawDetail(); } });
    register(drawMap);
    register(drawDetail);
  }
  function configureSlider(toEnd) {
    const m = METRICS[mapState.metric], box = $("#timelineBox"), slider = $("#timeSlider");
    if (!m.periods) { box.classList.add("is-off"); $("#timeLabel").textContent = "Latest"; return; }
    box.classList.remove("is-off");
    const ps = m.periods();
    slider.max = ps.length - 1;
    if (toEnd) mapState.idx = ps.length - 1;
    slider.value = mapState.idx;
    m._range = metricRange(m);
  }
  function startPlay() {
    const m = METRICS[mapState.metric];
    if (!m.periods) return;
    const n = m.periods().length;
    if (mapState.idx >= n - 1) mapState.idx = 0;
    $("#playBtn").textContent = "❚❚ Pause";
    const step = m.kind === "month" ? 3 : 1;
    mapState.timer = setInterval(() => {
      mapState.idx = Math.min(n - 1, mapState.idx + step);
      $("#timeSlider").value = mapState.idx;
      drawMap();
      if (mapState.idx >= n - 1) stopPlay();
    }, 260);
  }
  function stopPlay() {
    clearInterval(mapState.timer); mapState.timer = null;
    $("#playBtn").textContent = "▶ Play";
  }

  function drawMap() {
    const m = METRICS[mapState.metric], c = ink(), dark = isDark();
    const t = m.periods ? m.periods()[mapState.idx] : null;
    if (!m._range) m._range = metricRange(m);
    $("#timeLabel").textContent = t ? label(t) : "Latest";
    $("#mapNote").textContent = m.note;
    const data = codes().map((code) => {
      const v = m.value(code, t);
      return { name: code, value: v == null || !isFinite(v) ? null : (m.log ? Math.log10(v) : v), raw: v };
    });
    const [lo, hi] = m._range;
    const colors = m.scale === "div" ? (dark ? DIV_DARK : DIV_LIGHT) : (dark ? SEQ.slice().reverse() : SEQ);
    chart("mapChart").setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item", confine: true, backgroundColor: c.surface, borderColor: c.axis, textStyle: { color: c.primary },
        formatter: (p) => {
          const d = data.find((x) => x.name === p.name);
          return `<b>${esc(D.provinces[p.name]?.name || p.name)}</b><br>${d && d.raw != null ? m.fmt(d.raw) : "no data"}${t ? `<br><span style="color:${c.muted}">${label(t)}</span>` : ""}`;
        },
      },
      visualMap: {
        type: "continuous", min: m.log ? Math.log10(lo) : lo, max: m.log ? Math.log10(hi) : hi,
        calculable: false, orient: "horizontal", left: "center", bottom: 0, itemWidth: 12, itemHeight: 220,
        text: [fmtLegend(m, hi), fmtLegend(m, lo)], textStyle: { color: c.secondary, fontSize: 11 },
        inRange: { color: colors }, outOfRange: { color: [c.grid] },
        formatter: (v) => fmtLegend(m, m.log ? 10 ** v : v),
      },
      geo: {
        map: "es", nameProperty: "code", roam: false, top: 8, bottom: 40, left: 8, right: 8,
        selectedMode: false,
        itemStyle: { areaColor: c.grid, borderColor: c.surface, borderWidth: 1 },
        emphasis: { label: { show: false }, itemStyle: { areaColor: null, borderColor: c.primary, borderWidth: 2 } },
      },
      series: [
        {
          type: "map", geoIndex: 0, data,
          select: { disabled: true },
        },
        {
          // frame around the Canary Islands inset
          type: "lines", coordinateSystem: "geo", polyline: true, silent: true, z: 1,
          lineStyle: { color: c.axis, width: 1, opacity: 1 },
          data: [{ coords: [[-13.4, 33.85], [-7.75, 33.85], [-7.75, 36.45], [-13.4, 36.45], [-13.4, 33.85]] }],
        },
      ],
    }, true);
  }
  function fmtLegend(m, v) {
    if (v == null || !isFinite(v)) return "";
    if (m.unit === "%") return (m.scale === "div" && v > 0 ? "+" : "") + nf1.format(v) + "%";
    if (m.unit === "€/m²") return v < 100 ? "€" + nf1.format(v) : "€" + nf0.format(v);
    return nf0.format(v);
  }

  function drawDetail() {
    const code = mapState.selected, p = D.provinces[code], y = yieldOf(code) || {};
    const ap = D.appraisal["p" + code], apL = ap ? last(ap) : null;
    const apY = apL ? yoy(apL.v, at(ap, shiftQ(apL.t, -4))) : null;
    const sales = D.sales["p" + code]?.all, sL = sales ? last(sales) : null;
    const s12 = sL ? sum12(sales, sL.t) : null, s12y = sL ? yoy(s12, sum12(sales, shiftM(sL.t, -12))) : null;
    const ri = D.rent_index["p" + code], riL = ri?.yoy ? last(ri.yoy) : null;
    const ranks = Object.entries(D.yields.by_province).sort((a, b) => b[1].gross_yield - a[1].gross_yield).map((e) => e[0]);
    const tag = y.rent_method === "modelled" ? '<span class="tag">modelled</span>' : '<span class="tag">idealista</span>';
    $("#provDetail").innerHTML = `
      <div><h3>${esc(p.name)}</h3><p class="sub">${esc(D.ccaa[p.ccaa])} · INE code ${code}</p></div>
      <dl class="dl">
        <dt>Appraised value${apL ? ` (${label(apL.t)})` : ""}</dt><dd>${apL ? eur(apL.v) + "/m²" : "—"}</dd>
        <dt>Change y/y</dt><dd>${pct(apY)}</dd>
        <dt>Asking-price equivalent</dt><dd>${eur(y.price_m2)}/m²</dd>
        <dt>Asking rent ${tag}</dt><dd>${y.rent_m2 ? "€" + nf1.format(y.rent_m2) + "/m²" : "—"}</dd>
        <dt>Rent change y/y</dt><dd>${pct(y.rent_yoy)}</dd>
        <dt>Gross yield</dt><dd>${y.gross_yield ? nf2.format(y.gross_yield) + "%" : "—"} <span class="tag">#${ranks.indexOf(code) + 1} of 52</span></dd>
        <dt>Sales, 12 m to ${sL ? label(sL.t) : "—"}</dt><dd>${s12 ? nf0.format(s12) : "—"}</dd>
        <dt>Sales change</dt><dd>${pct(s12y)}</dd>
        ${riL ? `<dt>INE rent index (${riL.t}, tax data)</dt><dd>${pct(riL.v)}</dd>` : ""}
      </dl>
      <div><p class="sub">Appraised €/m² since 2005: ${esc(p.name)} vs Spain</p><div id="detailChart" class="detail-chart"></div></div>`;
    if (charts.detailChart) { charts.detailChart.dispose(); delete charts.detailChart; }
    if (!ap) return;
    const ts = D.appraisal.ES.t.filter((t) => t >= "2005Q1");
    const c = ink();
    chart("detailChart").setOption(base({
      grid: { left: 4, right: 12, top: 24, bottom: 4, containLabel: true },
      legend: Object.assign(base().legend, { data: [p.name, "Spain"] }),
      tooltip: Object.assign(base().tooltip, { valueFormatter: (v) => eur(v) }),
      xAxis: axisX("category", { data: ts, axisLabel: { color: c.muted, fontSize: 10, formatter: (v) => v.slice(0, 4), interval: 19 } }),
      yAxis: axisY({ axisLabel: { color: c.muted, fontSize: 10, formatter: (v) => nf0.format(v) } }),
      series: [line(p.name, ts.map((t) => at(ap, t)), S(0)), line("Spain", ts.map((t) => at(D.appraisal.ES, t)), c.muted, { lineStyle: { width: 1.5, color: c.muted } })],
    }), true);
  }

  // ------------------------------------------------------------------ prices & sales
  function ipvChart() {
    const E = D.ipv.ES, ts = E.all_yoy.t.filter((t) => t >= "2008Q1"), c = ink();
    const pick = (s) => ts.map((t) => at(s, t));
    chart("ipvChart").setOption(base({
      tooltip: Object.assign(base().tooltip, { valueFormatter: (v) => pct(v) }),
      xAxis: axisX("category", { data: ts, axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => v.slice(0, 4), interval: 7 } }),
      yAxis: axisY({ axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => v + "%" } }),
      grid: { left: 8, right: 64, top: 28, bottom: 8, containLabel: true },
      series: [
        line("All homes", pick(E.all_yoy), S(0), { endLabel: { show: true, color: c.secondary, formatter: (p) => pct(p.value) } }),
        line("New", pick(E.new_yoy), S(1), { lineStyle: { width: 1.5, color: S(1) } }),
        line("Second-hand", pick(E.used_yoy), S(2), { lineStyle: { width: 1.5, color: S(2) } }),
      ],
    }), true);
  }

  function regionChart() {
    const rows = Object.entries(D.ipv).map(([k, v]) => ({ k, name: k === "ES" ? "Spain" : D.ccaa[k.slice(1)], v: last(v.all_yoy).v, t: last(v.all_yoy).t }))
      .sort((a, b) => a.v - b.v);
    $("#ipvRegionPeriod").textContent = label(rows[0].t);
    const c = ink();
    chart("regionChart").setOption(base({
      legend: { show: false },
      grid: { left: 8, right: 48, top: 4, bottom: 4, containLabel: true },
      tooltip: Object.assign(base().tooltip, { axisPointer: { type: "shadow", shadowStyle: { color: c.grid + "66" } }, valueFormatter: (v) => pct(v) }),
      xAxis: axisY({ axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => v + "%" } }),
      yAxis: { type: "category", data: rows.map((r) => r.name), axisLine: { lineStyle: { color: c.axis } }, axisTick: { show: false }, axisLabel: { color: c.secondary, fontSize: 12 } },
      series: [{
        type: "bar", barWidth: "62%",
        data: rows.map((r) => ({
          value: r.v,
          itemStyle: { color: r.k === "ES" ? c.primary : S(0), borderRadius: [0, 4, 4, 0] },
          label: r.k === "ES" ? { show: true, position: "right", color: c.primary, fontWeight: 700, formatter: (p) => pct(p.value) } : { show: false },
        })),
      }],
    }), true);
  }

  let salesRange = 96;
  function salesChart() {
    const E = D.sales.ES, all = E.all.t, ts = all.slice(-Math.min(salesRange, all.length)), c = ink();
    const ma = ts.map((t) => { const s = sum12(E.all, t); return s == null ? null : Math.round(s / 12); });
    chart("salesChart").setOption(base({
      tooltip: Object.assign(base().tooltip, { valueFormatter: (v) => v == null ? "—" : nf0.format(v) }),
      xAxis: axisX("category", { boundaryGap: true, data: ts, axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => label(v), hideOverlap: true } }),
      yAxis: axisY({ axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => nf0.format(v / 1000) + "k" } }),
      series: [
        { name: "Second-hand", type: "bar", stack: "s", data: ts.map((t) => at(E.used, t)), itemStyle: { color: S(0) }, barCategoryGap: "18%" },
        { name: "New", type: "bar", stack: "s", data: ts.map((t) => at(E.new, t)), itemStyle: { color: S(1), borderRadius: [3, 3, 0, 0] } },
        line("12-month average", ma, c.primary, { lineStyle: { width: 2, color: c.primary } }),
      ],
    }), true);
  }

  function divergeChart() {
    const idx = D.ipv.ES.all_index, ri = D.rent_index.ES?.index;
    const years = [];
    for (let y = 2015; y <= 2025; y++) years.push(String(y));
    const avg = (y) => { const v = [1, 2, 3, 4].map((q) => at(idx, `${y}Q${q}`)); return v.every((x) => x != null) ? v.reduce((a, b) => a + b) / 4 : null; };
    const p15 = avg(2015), r15 = at(ri, "2015");
    const c = ink();
    const price = years.map((y) => { const a = avg(y); return a == null ? null : +(a / p15 * 100).toFixed(1); });
    const rent = years.map((y) => { const v = at(ri, y); return v == null ? null : +(v / r15 * 100).toFixed(1); });
    chart("divergeChart").setOption(base({
      tooltip: Object.assign(base().tooltip, { valueFormatter: (v) => v == null ? "—" : nf1.format(v) }),
      grid: { left: 8, right: 70, top: 28, bottom: 8, containLabel: true },
      xAxis: axisX("category", { data: years }),
      yAxis: axisY({ min: 90 }),
      series: [
        line("Sale prices", price, S(0), { showSymbol: true, endLabel: { show: true, color: c.secondary, formatter: (p) => nf0.format(p.value) } }),
        line("Rents (tax data)", rent, S(1), { showSymbol: true, connectNulls: false, endLabel: { show: true, color: c.secondary, formatter: (p) => nf0.format(p.value) } }),
      ],
    }), true);
  }

  function euChart() {
    const E = D.eu_hpi, ts = E.ES.t, c = ink();
    const names = { ES: "Spain", EU27_2020: "EU-27", PT: "Portugal", DE: "Germany", FR: "France", IT: "Italy", NL: "Netherlands", IE: "Ireland" };
    const series = Object.keys(names).filter((g) => E[g]).map((g) => {
      const d = ts.map((t) => at(E[g], t));
      if (g === "ES") return line(names[g], d, S(0), { lineStyle: { width: 2.5, color: S(0) }, z: 5, endLabel: { show: true, color: c.primary, fontWeight: 700, formatter: (p) => "Spain " + pct(p.value) } });
      if (g === "EU27_2020") return line(names[g], d, c.primary, { lineStyle: { width: 1.5, color: c.primary }, endLabel: { show: true, color: c.secondary, formatter: (p) => "EU " + pct(p.value) } });
      return line(names[g], d, c.muted, { lineStyle: { width: 1, color: c.axis }, itemStyle: { color: c.muted } });
    });
    chart("euChart").setOption(base({
      legend: Object.assign(base().legend, { data: ["Spain", "EU-27"] }),
      tooltip: Object.assign(base().tooltip, { valueFormatter: (v) => pct(v) }),
      grid: { left: 8, right: 96, top: 28, bottom: 8, containLabel: true },
      xAxis: axisX("category", { data: ts, axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => v.slice(0, 4), interval: 3 } }),
      yAxis: axisY({ axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => v + "%" } }),
      series,
    }), true);
  }

  function euriborChart() {
    const E = D.euribor, c = ink(), col = S(0);
    chart("euriborChart").setOption(base({
      legend: { show: false },
      tooltip: Object.assign(base().tooltip, { valueFormatter: (v) => nf2.format(v) + "%" }),
      grid: { left: 8, right: 56, top: 16, bottom: 8, containLabel: true },
      xAxis: axisX("category", { data: E.t, axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => v.slice(0, 4), hideOverlap: true } }),
      yAxis: axisY({ axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => v + "%" } }),
      series: [line("Euribor 12 m", E.v, col, {
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: col + "33" }, { offset: 1, color: col + "00" }]) },
        endLabel: { show: true, color: c.primary, fontWeight: 700, formatter: (p) => nf2.format(p.value) + "%" },
        markLine: { silent: true, symbol: "none", lineStyle: { color: c.axis, type: "solid" }, label: { color: c.muted, formatter: "0%" }, data: [{ yAxis: 0 }] },
      })],
    }), true);
  }

  // ------------------------------------------------------------------ yields
  function yieldBars() {
    const rows = Object.entries(D.yields.by_province).sort((a, b) => a[1].gross_yield - b[1].gross_yield);
    const c = ink(), col = S(0);
    chart("yieldBars").setOption(base({
      legend: { show: false },
      grid: { left: 8, right: 52, top: 8, bottom: 8, containLabel: true },
      tooltip: Object.assign(base().tooltip, {
        axisPointer: { type: "shadow", shadowStyle: { color: c.grid + "66" } },
        formatter: (ps) => {
          const [code, y] = rows[ps[0].dataIndex];
          return `<b>${esc(D.provinces[code].name)}</b><br>Gross yield <b>${nf2.format(y.gross_yield)}%</b><br>Rent €${nf1.format(y.rent_m2)}/m² (${y.rent_method})<br>Price ${eur(y.price_m2)}/m²`;
        },
      }),
      xAxis: axisY({ axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => v + "%" } }),
      yAxis: { type: "category", data: rows.map(([k]) => D.provinces[k].name), axisLine: { lineStyle: { color: c.axis } }, axisTick: { show: false }, axisLabel: { color: c.secondary, fontSize: 12, interval: 0 } },
      series: [{
        type: "bar", barWidth: "64%",
        label: { show: true, position: "right", color: c.muted, fontSize: 11, formatter: (p) => nf1.format(p.value) },
        data: rows.map(([, y]) => ({
          value: y.gross_yield,
          itemStyle: y.rent_method === "published"
            ? { color: col, borderRadius: [0, 4, 4, 0] }
            : { color: col + "55", borderRadius: [0, 4, 4, 0], decal: { symbol: "rect", symbolSize: 1, dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: Math.PI / 4, color: col + "cc" } },
        })),
        markLine: { silent: true, symbol: "none", lineStyle: { color: c.primary, width: 1, type: "solid" }, label: { show: false }, data: [{ xAxis: D.yields.national.gross_yield }] },
      }],
    }), true);
    const Y = D.yields;
    const nPub = Object.values(Y.by_province).filter((v) => v.rent_method === "published").length;
    $("#yieldMethod").innerHTML = [
      `<b>Rent:</b> idealista asking rent (${esc(D.market.as_of)}). ${nPub} provinces use a published figure, either their own or their single-province region's.`,
      `<b>Modelled rent:</b> region rent × (province price ÷ region price)<sup>β</sup>, with β = ${nf2.format(Y.beta)} fitted on the published provinces. Rents rise less than proportionally with prices, which is why cheap provinces yield more.`,
      `<b>Price:</b> Ministry of Housing appraised €/m², scaled by ${nf2.format(Y.asking_over_appraisal)} so the national level matches idealista's asking price (€${nf0.format(Y.national.price_m2)}/m²). As a check, the model gives Madrid €${nf0.format(Y.by_province["28"].price_m2)}/m² against idealista's published €${nf0.format(D.market.sale.ccaa["13"]?.eur_m2 || 0)}/m².`,
      `<b>Caveats:</b> these are gross, portal-level estimates. Net yields after IBI, community fees, vacancy, maintenance and tax typically run 1.5–2.5 pp lower. Capital cities differ from province averages.`,
    ].map((s) => `<li>${s}</li>`).join("");
  }

  function yieldScatter() {
    const c = ink(), col = S(0);
    const pts = Object.entries(D.yields.by_province).map(([code, y]) => {
      const s = D.sales["p" + code]?.all;
      return { code, name: D.provinces[code].name, x: y.price_m2, y: y.gross_yield, s: s ? sum12(s, last(s).t) : 0, m: y.rent_method };
    });
    const byY = pts.slice().sort((a, b) => b.y - a.y);
    const show = new Set([...byY.slice(0, 3), ...byY.slice(-3)].map((p) => p.code).concat(["28", "08", "29"]));
    const maxS = Math.max(...pts.map((p) => p.s));
    chart("yieldScatter").setOption(base({
      legend: { show: false },
      grid: { left: 8, right: 24, top: 18, bottom: 26, containLabel: true },
      tooltip: { trigger: "item", confine: true, backgroundColor: c.surface, borderColor: c.axis, textStyle: { color: c.primary }, formatter: (p) => { const d = pts[p.dataIndex]; return `<b>${esc(d.name)}</b><br>Price ${eur(d.x)}/m²<br>Yield ${nf2.format(d.y)}%<br>Sales (12 m) ${nf0.format(d.s)}`; } },
      xAxis: axisX("value", { name: "Asking-equivalent price, €/m²", nameLocation: "middle", nameGap: 26, nameTextStyle: { color: c.muted, fontSize: 11 }, axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => nf0.format(v) }, splitLine: { show: true, lineStyle: { color: c.grid } }, scale: true }),
      yAxis: axisY({ scale: true, axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => v + "%" } }),
      series: [{
        type: "scatter",
        data: pts.map((p) => ({
          value: [p.x, p.y],
          symbolSize: 8 + 30 * Math.sqrt(p.s / maxS),
          itemStyle: { color: col + (p.m === "published" ? "cc" : "66"), borderColor: c.surface, borderWidth: 2 },
          label: { show: show.has(p.code), formatter: p.name, position: "right", color: c.secondary, fontSize: 11 },
        })),
        labelLayout: { hideOverlap: true },
      }],
    }), true);
  }

  // ------------------------------------------------------------------ outlook
  function forecastChart() {
    const F = D.projections.forecasts, c = ink();
    const ipv = D.ipv.ES.all_yoy;
    const actual = ipv.t.map((t, i) => [quarterEnd(t), ipv.v[i]]).filter(([d]) => d >= "2025-09-01");
    const pt = (f) => ({ value: [f.published, f.value], src: f.source, f });
    const short = (s) => s.replace(" Research", "").replace(" Global", "");
    const s26 = F.filter((f) => f.year === 2026).map(pt), s27 = F.filter((f) => f.year === 2027).map(pt);
    chart("forecastChart").setOption(base({
      tooltip: {
        trigger: "item", confine: true, backgroundColor: c.surface, borderColor: c.axis, textStyle: { color: c.primary },
        formatter: (p) => p.data.f
          ? `<b>${esc(p.data.f.source)}</b> · ${shortDate(p.data.f.published)}<br>Forecast for ${p.data.f.year}: <b>${pct(p.data.f.value)}</b>${p.data.f.note ? `<br><span style="color:${c.muted}">${esc(p.data.f.note)}</span>` : ""}`
          : `INE actual, y/y to ${shortDate(p.value[0])}: <b>${pct(p.value[1])}</b>`,
      },
      grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
      xAxis: axisX("time", { min: "2025-10-01", max: "2026-12-31", axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => { const d = new Date(v); return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; } } }),
      yAxis: axisY({ min: 0, max: 16, axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => v + "%" } }),
      series: [
        line("INE actual (y/y)", actual, c.primary, { showSymbol: true, symbolSize: 9, step: false, lineStyle: { width: 2, color: c.primary }, endLabel: { show: true, color: c.primary, fontWeight: 700, offset: [-40, 22], formatter: (p) => "Actual " + pct(p.value[1]) } }),
        { name: "Forecast for 2026", type: "scatter", data: s26, symbolSize: 11, itemStyle: { color: S(0), borderColor: c.surface, borderWidth: 2 }, label: { show: true, position: "right", color: c.secondary, fontSize: 11, formatter: (p) => short(p.data.src) }, labelLayout: { hideOverlap: true } },
        { name: "Forecast for 2027", type: "scatter", data: s27, symbolSize: 10, symbol: "diamond", itemStyle: { color: S(1), borderColor: c.surface, borderWidth: 2 } },
      ],
    }), true);
  }

  function pulse() {
    const P = D.projections, B = P.scenarios.baseline;
    const qoq = D.ipv.ES.all_qoq ? last(D.ipv.ES.all_qoq) : null;
    const implied = (Math.pow(1 + B["2026"] / 100, 0.25) - 1) * 100;
    const y26 = D.ipv.ES.all_yoy.t.map((t, i) => [t, D.ipv.ES.all_yoy.v[i]]).filter(([t]) => t.startsWith("2026"));
    const avg26 = y26.reduce((a, [, v]) => a + v, 0) / (y26.length || 1);
    const latestBy = {};
    for (const f of P.forecasts.filter((f) => f.year === 2026)) if (!latestBy[f.source] || latestBy[f.source].published < f.published) latestBy[f.source] = f;
    const latestF = Object.values(latestBy).filter((f) => f.published >= "2026-06-01");
    const cons = latestF.reduce((a, f) => a + f.value, 0) / (latestF.length || 1);
    const rentY = D.market.rent.national.yoy, priceY = last(D.ipv.ES.all_yoy).v;
    const eu = D.euribor, eL = last(eu), e12 = at(eu, shiftM(eL.t, -12)), dE = eL.v - e12;
    const sales = D.sales.ES.all, sL = last(sales);
    const ytd = (y) => { let a = 0; for (let m = 1; m <= +sL.t.slice(5); m++) a += at(sales, `${y}-${String(m).padStart(2, "0")}`) || 0; return a; };
    const sYtd = yoy(ytd(+sL.t.slice(0, 4)), ytd(+sL.t.slice(0, 4) - 1));
    const salesF = (P.sales_forecasts || []).find((f) => f.year === 2026);
    const rows = [
      qoq && { v: (qoq.v - implied >= 0 ? "+" : "−") + nf1.format(Math.abs(qoq.v - implied)) + "pp", hot: qoq.v > implied, t: `<b>Quarterly pace vs baseline.</b> Prices rose ${pct(qoq.v)} q/q in ${label(qoq.t)}. The ${nf1.format(B["2026"])}% baseline implies ${pct(implied)} a quarter, so the market is running ${qoq.v > implied ? "hotter" : "cooler"} than the model.` },
      { v: (avg26 - cons >= 0 ? "+" : "−") + nf1.format(Math.abs(avg26 - cons)) + "pp", hot: avg26 > cons, t: `<b>2026 so far vs forecasts.</b> Year-on-year growth has averaged ${pct(avg26, false)} across ${y26.length} INE release${y26.length === 1 ? "" : "s"}. Forecasts published since June average ${pct(cons, false)}.` },
      { v: (rentY - priceY >= 0 ? "+" : "−") + nf1.format(Math.abs(rentY - priceY)) + "pp", hot: false, cool: rentY < priceY, t: `<b>Rents vs prices.</b> Asking rents are up ${pct(rentY, false)} y/y and prices ${pct(priceY, false)}. With rents growing more slowly, gross yields keep compressing.` },
      { v: (dE >= 0 ? "+" : "−") + nf2.format(Math.abs(dE)) + "pp", hot: dE < 0, cool: dE > 0, t: `<b>Mortgage costs.</b> 12-month Euribor is ${nf2.format(eL.v)}% (${label(eL.t)}), ${dE >= 0 ? "up" : "down"} from ${nf2.format(e12)}% a year ago. By the model's rule of thumb that ${dE >= 0 ? "takes" : "adds"} about ${nf1.format(Math.abs(dE * P.scenarios.macro.euribor_sensitivity))}pp ${dE >= 0 ? "off" : "to"} price growth.` },
      { v: pct(sYtd), hot: sYtd > 0, cool: sYtd < 0, t: `<b>Sales.</b> Registered sales from January to ${MONTHS[+sL.t.slice(5) - 1]} are ${pct(sYtd)} on the same period last year.${salesF ? ` BBVA expects ${pct(salesF.value)} for the full year.` : ""}` },
    ].filter(Boolean);
    $("#pulse").innerHTML = `<h3>Real-time check</h3>` + rows.map((r) => `<div class="pulse-row"><span class="pulse-badge ${r.hot ? "hot" : r.cool ? "cool" : ""}">${esc(r.v)}</span><p>${r.t}</p></div>`).join("") +
      `<p class="note">Recomputed from the latest INE, ECB and portal data on every refresh. Red = upward pressure on prices, green = cooling.</p>`;
  }

  // Scenario model
  const SC = { probs: null, euribor: 0, base27: null };
  function setupScenario() {
    const P = D.projections.scenarios;
    SC.probs = Object.fromEntries(P.list.map((s) => [s.id, Math.round(s.prior * 100)]));
    SC.base27 = P.baseline["2027"];
    const box = $("#scenarioControls");
    const colorOf = (i) => S(i + 1);
    box.innerHTML = `
      <div class="sc-group"><span>Election outcome probabilities</span>
        ${P.list.map((s, i) => `<div class="sc-slider"><label for="p_${s.id}"><span><i class="sc-swatch" style="background:${colorOf(i)}"></i>${esc(s.name)}</span><b id="pv_${s.id}"></b></label><input type="range" id="p_${s.id}" min="0" max="100" step="5" value="${SC.probs[s.id]}"><span class="sc-why">${esc(s.rationale)}</span></div>`).join("")}
      </div>
      <div class="sc-group"><span>Macro assumptions, 2027–28</span>
        <div class="sc-slider"><label for="scBase"><span>Baseline price growth 2027</span><b id="scBaseV"></b></label><input type="range" id="scBase" min="2" max="10" step="0.1" value="${SC.base27}"><span class="sc-why">Default is the average of the latest published 2027 forecasts.</span></div>
        <div class="sc-slider"><label for="scEur"><span>Euribor vs today</span><b id="scEurV"></b></label><input type="range" id="scEur" min="-1.5" max="2" step="0.25" value="0"><span class="sc-why">Each +1pp takes about ${Math.abs(P.macro.euribor_sensitivity)}pp off annual price growth.</span></div>
      </div>
      <button type="button" class="btn" id="scReset">Reset to defaults</button>`;
    box.addEventListener("input", (e) => {
      const id = e.target.id;
      if (id.startsWith("p_")) SC.probs[id.slice(2)] = +e.target.value;
      if (id === "scEur") SC.euribor = +e.target.value;
      if (id === "scBase") SC.base27 = +e.target.value;
      scenarioChart();
    });
    $("#scReset").addEventListener("click", () => {
      P.list.forEach((s) => { SC.probs[s.id] = Math.round(s.prior * 100); $("#p_" + s.id).value = SC.probs[s.id]; });
      SC.euribor = 0; SC.base27 = P.baseline["2027"]; $("#scEur").value = 0; $("#scBase").value = SC.base27;
      scenarioChart();
    });
    register(scenarioChart);
  }

  function scenarioChart() {
    const P = D.projections.scenarios, B = P.baseline, sens = P.macro.euribor_sensitivity, c = ink();
    const total = Object.values(SC.probs).reduce((a, b) => a + b, 0) || 1;
    const w = Object.fromEntries(Object.entries(SC.probs).map(([k, v]) => [k, v / total]));
    P.list.forEach((s) => { $("#pv_" + s.id).textContent = Math.round(w[s.id] * 100) + "%"; });
    $("#scEurV").textContent = (SC.euribor > 0 ? "+" : SC.euribor < 0 ? "−" : "±") + nf2.format(Math.abs(SC.euribor)) + " pp";
    $("#scBaseV").textContent = nf1.format(SC.base27) + "%";

    const idx = D.ipv.ES.all_index, lastA = last(idx);
    const hist = idx.t.filter((t) => t >= "2023Q1");
    const future = [];
    for (let t = shiftQ(lastA.t, 1); t <= "2028Q4"; t = shiftQ(t, 1)) future.push(t);
    const axis = hist.concat(future);
    const base28 = B["2028"] + (SC.base27 - B["2027"]) * 0.5;
    const growth = (s, year) => {
      if (year <= 2026) return B["2026"];
      const b = year === 2027 ? SC.base27 : base28;
      return b + (s ? s.price_adj[String(year)] || 0 : 0) + sens * SC.euribor;
    };
    const path = (s) => {
      let v = lastA.v;
      const out = {};
      for (const t of future) { v *= Math.pow(1 + growth(s, +t.slice(0, 4)) / 100, 0.25); out[t] = v; }
      return out;
    };
    const paths = P.list.map((s) => path(s));
    const weighted = {};
    for (const t of future) weighted[t] = P.list.reduce((a, s, i) => a + w[s.id] * paths[i][t], 0);
    const toSeries = (p) => axis.map((t) => t === lastA.t ? +lastA.v.toFixed(2) : p[t] != null ? +p[t].toFixed(2) : null);
    const lo = axis.map((t) => t === lastA.t ? lastA.v : future.includes(t) ? Math.min(...paths.map((p) => p[t])) : null);
    const hi = axis.map((t) => t === lastA.t ? lastA.v : future.includes(t) ? Math.max(...paths.map((p) => p[t])) : null);
    const endLbl = (name, color) => ({ show: true, color, fontSize: 11, formatter: (p) => `${name} ${nf0.format(p.value)}` });

    chart("scenarioChart").setOption(base({
      legend: Object.assign(base().legend, { type: "scroll", right: 0, data: ["INE actual", "Probability-weighted", ...P.list.map((s) => s.name)] }),
      tooltip: Object.assign(base().tooltip, { valueFormatter: (v) => v == null ? "—" : nf1.format(v) }),
      grid: { left: 8, right: 84, top: 36, bottom: 8, containLabel: true },
      xAxis: axisX("category", { data: axis, axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => label(v), hideOverlap: true } }),
      yAxis: axisY({ scale: true, axisLabel: { color: c.muted, fontSize: 11 } }),
      series: [
        { name: "range", type: "line", data: lo, stack: "band", lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } },
        { name: "range2", type: "line", data: hi.map((h, i) => h == null ? null : h - lo[i]), stack: "band", lineStyle: { opacity: 0 }, showSymbol: false, silent: true, areaStyle: { color: S(0) + "1f" }, tooltip: { show: false } },
        line("INE actual", toSeries({}).map((v, i) => i < hist.length ? at(idx, axis[i]) : null), c.primary, { lineStyle: { width: 2.5, color: c.primary } }),
        ...P.list.map((s, i) => line(s.name, toSeries(paths[i]), S(i + 1), { lineStyle: { width: 1.5, type: [6, 4], color: S(i + 1) } })),
        line("Probability-weighted", toSeries(weighted), S(0), { lineStyle: { width: 3, color: S(0) }, z: 6, endLabel: Object.assign(endLbl("Weighted", c.primary), { fontWeight: 700 }) }),
      ],
    }), true);

    const end = (p) => p["2028Q4"];
    const wRent = (s) => B.rent_2027 + (s ? s.rent_adj["2027"] : 0);
    const row = (name, wt, s, p, swatch) => `<tr><td>${swatch ? `<i class="sc-swatch" style="background:${swatch}"></i>` : ""}${esc(name)}</td><td class="num">${wt}</td><td class="num">${pct(growth(s, 2027))}</td><td class="num">${pct(growth(s, 2028))}</td><td class="num">${pct(wRent(s))}</td><td class="num">${s ? pct(s.sales_adj, true, 1).replace(".0", "") : "—"}</td><td class="num">${nf1.format(end(p))}</td></tr>`;
    const wGrowth = (y) => P.list.reduce((a, s) => a + w[s.id] * growth(s, y), 0);
    const wRentAvg = P.list.reduce((a, s) => a + w[s.id] * wRent(s), 0);
    $("#scenarioTable").innerHTML = `<thead><tr><th>Scenario</th><th class="num">Weight</th><th class="num">Prices 2027</th><th class="num">Prices 2028</th><th class="num">Rents 2027</th><th class="num">Sales vs base</th><th class="num">Index Q4 2028</th></tr></thead><tbody>` +
      P.list.map((s, i) => row(s.name, Math.round(w[s.id] * 100) + "%", s, paths[i], S(i + 1))).join("") +
      `<tr><td><b>Probability-weighted</b></td><td class="num">100%</td><td class="num"><b>${pct(wGrowth(2027))}</b></td><td class="num"><b>${pct(wGrowth(2028))}</b></td><td class="num"><b>${pct(wRentAvg)}</b></td><td class="num">—</td><td class="num"><b>${nf1.format(end(weighted))}</b></td></tr></tbody>`;
  }

  // ------------------------------------------------------------------ politics
  let tlFilter = "all";
  function timeline() {
    const P = D.politics, today = new Date().toISOString().slice(0, 10);
    const cats = [["all", "All"], ["law", "Laws"], ["parliament", "Parliament"], ["election", "Election"], ["protest", "Protest"], ["market", "Market"], ["upcoming", "Upcoming"]];
    const fbox = $("#timelineFilter");
    fbox.innerHTML = cats.map(([k, n]) => `<button type="button" class="chip ${k === tlFilter ? "is-on" : ""}" data-k="${k}">${n}</button>`).join("");
    fbox.onclick = (e) => { const k = e.target.dataset?.k; if (k) { tlFilter = k; timeline(); } };
    const items = P.timeline.map((x) => Object.assign({ past: true }, x))
      .concat(P.upcoming.filter((u) => u.date >= today).map((u) => ({ date: u.date, title: u.title, cat: "upcoming", past: false })));
    items.sort((a, b) => a.date.localeCompare(b.date));
    const show = items.filter((x) => tlFilter === "all" || x.cat === tlFilter);
    const ol = $("#timeline");
    ol.innerHTML = "";
    let markerDone = false;
    for (const x of show) {
      if (!markerDone && !x.past) { ol.append(el("li", { class: "tl-today" }, `<span>Today</span><span></span><span></span>`)); markerDone = true; }
      const catName = { law: "Law", parliament: "Parliament", election: "Election", protest: "Protest", market: "Market", upcoming: "Upcoming" }[x.cat] || x.cat;
      ol.append(el("li", { class: `tl-item cat-${x.cat} ${x.past ? "" : "upcoming"}` },
        `<span class="tl-date">${shortDate(x.date + "T12:00:00Z")}</span><span class="tl-rail"></span><div class="tl-body"><span class="tl-cat">${esc(catName)}</span><b>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title)}</b>${x.detail ? `<p>${esc(x.detail)}</p>` : ""}</div>`));
    }
  }

  function pollChart() {
    const P = D.politics.polls, c = ink(), parties = ["Sumar", "Vox", "PSOE", "PP"];
    const avg = (p) => { const v = P.rows.map((r) => r[p]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b) / v.length : null; };
    const dots = [];
    P.rows.forEach((r) => parties.forEach((p, yi) => { if (r[p] != null) dots.push({ value: [r[p], yi], r, p, itemStyle: { color: S(PARTY[p]), borderColor: c.surface, borderWidth: 2 } }); }));
    chart("pollChart").setOption(base({
      legend: { show: false },
      grid: { left: 8, right: 20, top: 10, bottom: 24, containLabel: true },
      tooltip: { trigger: "item", confine: true, backgroundColor: c.surface, borderColor: c.axis, textStyle: { color: c.primary }, formatter: (p) => p.data.r ? `<b>${esc(p.data.p)}</b> ${nf1.format(p.data.value[0])}%<br>${esc(p.data.r.pollster)} · ${shortDate(p.data.r.date + "T12:00:00Z")}` : `${esc(p.data.p)}: ${nf1.format(p.data.value[0])}% in July 2023` },
      xAxis: axisY({ min: 0, max: 40, axisLabel: { color: c.muted, fontSize: 11, formatter: (v) => v + "%" } }),
      yAxis: { type: "category", data: parties.map((p) => { const a = avg(p); return `${p}${a ? `  avg ${nf1.format(a)}%` : ""}`; }), axisLine: { lineStyle: { color: c.axis } }, axisTick: { show: false }, axisLabel: { color: c.primary, fontWeight: 600, fontSize: 12 }, splitLine: { show: true, lineStyle: { color: c.grid } } },
      series: [
        { name: "2023 result", type: "scatter", symbol: "circle", symbolSize: 16, z: 1, data: parties.map((p, yi) => ({ value: [P.result_2023[p], yi], p, itemStyle: { color: "transparent", borderColor: c.muted, borderWidth: 2 } })) },
        { name: "Polls", type: "scatter", symbolSize: 11, z: 3, data: dots },
      ],
    }), true);
  }

  function parties() {
    const L = D.politics.parties;
    $("#spectrum").innerHTML = `<div class="spectrum-axis"></div><span class="spectrum-end">More intervention</span><span class="spectrum-end r">More liberalisation</span>` +
      L.map((p, i) => `<span class="spectrum-chip" style="left:${((p.score + 3) / 6) * 92 + 4}%; top:${i % 2 ? 4 : 2}px">${esc(p.party)}</span>`).join("");
    $("#partyTable").innerHTML = `<thead><tr><th>Party</th><th>Stance</th><th>Housing position</th></tr></thead><tbody>` +
      L.map((p) => `<tr><td><b>${esc(p.party)}</b></td><td>${esc(p.stance)}</td><td>${esc(p.housing)}</td></tr>`).join("") + `</tbody>`;
  }

  // ------------------------------------------------------------------ news & sources
  let newsTopic = "all";
  function news() {
    const N = D.news;
    if (!N || !N.items?.length) { $("#newsList").innerHTML = `<li>No headlines yet. Run <code>python3 scripts/fetch_news.py</code>.</li>`; return; }
    $("#newsStamp").textContent = `Google News, fetched ${N.fetched.replace("T", " ").replace("Z", " UTC")}. Refreshes with every data update.`;
    const topics = ["all", "policy", "election", "rent", "prices", "tourism", "other"];
    const counts = Object.fromEntries(topics.map((t) => [t, t === "all" ? N.items.length : N.items.filter((i) => i.topic === t).length]));
    $("#newsFilter").innerHTML = topics.filter((t) => counts[t]).map((t) => `<button type="button" class="chip ${t === newsTopic ? "is-on" : ""}" data-t="${t}">${t[0].toUpperCase() + t.slice(1)} · ${counts[t]}</button>`).join("");
    $("#newsFilter").onclick = (e) => { const t = e.target.dataset?.t; if (t) { newsTopic = t; news(); } };
    const ago = (iso) => { const h = (Date.now() - new Date(iso.replace("Z", ":00Z"))) / 36e5; return h < 1 ? "just now" : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`; };
    $("#newsList").innerHTML = N.items.filter((i) => newsTopic === "all" || i.topic === newsTopic).slice(0, 40).map((i) =>
      `<li><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a><span class="news-meta"><span class="news-topic">${esc(i.topic)}</span><span>${esc(i.outlet)}</span><span>${ago(i.date)}</span>${i.lang === "en" ? "<span>EN</span>" : ""}</span></li>`).join("");
  }

  function sources() {
    const badge = { auto: "Auto", curated: "Curated", candidate: "Candidate" };
    $("#sourcesTable").innerHTML = `<thead><tr><th>Source</th><th>Publisher</th><th>What it tracks</th><th>Geography</th><th>Frequency</th><th>Access</th><th>In dashboard</th></tr></thead><tbody>` +
      D.sources.map((s) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a><br><span class="note">${esc(s.kind)}</span></td><td>${esc(s.publisher)}</td><td>${esc(s.metrics)}</td><td>${esc(s.geo)}</td><td>${esc(s.freq)}</td><td>${esc(s.access)}</td><td><span class="badge ${s.used}">${badge[s.used] || s.used}</span></td></tr>`).join("") + `</tbody>`;
  }

  // ------------------------------------------------------------------ boot
  function navSpy() {
    const links = [...document.querySelectorAll(".nav a")];
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === "#" + e.target.id));
    }, { rootMargin: "-40% 0px -55% 0px" });
    document.querySelectorAll("main section[id]").forEach((s) => io.observe(s));
  }

  function rerender() { renderers.forEach((fn) => fn()); }

  async function boot() {
    try {
      const [d, g] = await Promise.all([fetch("data/dashboard.json").then((r) => r.json()), fetch("data/geo/provinces.geojson").then((r) => r.json())]);
      D = d; GEO = g;
    } catch (e) {
      $("#loadError").hidden = false;
      throw e;
    }
    renderOverview();
    register(kpis);
    setupMap();
    register(ipvChart); register(regionChart); register(salesChart); register(divergeChart); register(euChart); register(euriborChart);
    register(yieldBars); register(yieldScatter);
    register(forecastChart); pulse(); setupScenario();
    timeline(); register(pollChart); parties();
    news(); sources();
    navSpy();

    document.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => {
      document.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("is-on", x === b));
      salesRange = +b.dataset.range; salesChart();
    }));
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerender);
    new MutationObserver(rerender).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    let rt;
    window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => Object.values(charts).forEach((c) => c.resize()), 120); });
  }
  boot();
})();
