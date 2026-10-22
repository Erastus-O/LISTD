/* ===================== Inspection report PDF (LISTD Inventory layout) ===================== */
var JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
function loadJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = JSPDF_URL; s.onload = function () { window.jspdf ? res(window.jspdf.jsPDF) : rej(new Error('jsPDF missing')); }; s.onerror = rej; document.head.appendChild(s); });
}
function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(iso) { var d = new Date(iso); return MONTHS[d.getMonth()] + ' ' + ordinal(d.getDate()) + ' ' + d.getFullYear(); }
function cropImage(src, w, h) {
  return new Promise(function (res) {
    var im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = function () { var c = document.createElement('canvas'); c.width = w; c.height = h; var r = Math.max(w / im.width, h / im.height), sw = w / r, sh = h / r; c.getContext('2d').drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, 0, 0, w, h); try { res(c.toDataURL('image/jpeg', 0.8)); } catch (e) { res(null); } };
    im.onerror = function () { res(null); }; im.src = src;
  });
}
function companyInfo() { var c = settings().company || {}; return { name: c.name || 'LISTD Inventory', address: c.address || 'Suite 41, 14-15 Triangle South, Clifton, Bristol', phone: c.phone || '07413065681', email: c.email || 'hello@listdinventory.co.uk' }; }

async function buildInspectionPdf(j, r) {
  var JsPDF = await loadJsPDF();
  var s = r.sections, k = svcKey(j), p = j.propSnapshot || {}, c = D.clients[j.clientId] || {}, pro = D.pros[j.proId] || {}, co = companyInfo();
  var ev = evFor({ jobId: j.id }).filter(function (e) { return e.type !== 'pdf' && e.stage !== 'ATTEND'; }), IMG = {};
  for (var i = 0; i < ev.length; i++) IMG[ev[i].id] = await cropImage(fileSrc(ev[i]), 640, 480);
  var coverEv = ev.filter(function (e) { return e.item === 'room' && s.rooms[0] && e.area === s.rooms[0].id; })[0] || ev.filter(function (e) { return e.item === 'room'; })[0] || ev[0];
  var coverImg = coverEv ? await cropImage(fileSrc(coverEv), 1068, 800) : null;

  var doc = new JsPDF({ unit: 'pt', format: 'a4' }), W = 595.28, H = 841.89, M = 14.4, CW = W - 2 * M, BOTTOM = 800;
  var GREEN = [104, 205, 154], CORAL = [222, 84, 72], ORANGE = [245, 166, 35], TXT = [62, 62, 62], GREY = [120, 120, 120], LINE = [226, 228, 232], ROW = [249, 249, 252], CELL = [246, 247, 249];
  var addr = (p.address || '') + (p.postcode ? ', ' + p.postcode : '');
  var y = 0, sec = null, toc = [];
  function fill(rgb) { doc.setFillColor(rgb[0], rgb[1], rgb[2]); } function stroke(rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]); } function color(rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }
  function font(style, size) { doc.setFont('helvetica', style); doc.setFontSize(size); }
  function pageHeader() { font('normal', 8.5); color(GREY); doc.text(addr, M, 17); }
  function newPage() { doc.addPage(); pageHeader(); y = 41; if (sec) bar(sec + ' (CONT.)', true); }
  function ensure(h) { if (y + h > BOTTOM) newPage(); }
  function bar(title, small) { fill(GREEN); doc.rect(M, y, CW, small ? 25 : 29, 'F'); color([255, 255, 255]); font('bold', small ? 7.5 : 11); doc.text(title, M + 7, y + (small ? 16 : 19)); y += small ? 25 : 29; }
  function section(title, tocName, level) { ensure(130); y += 14; sec = title; toc.push([tocName || title, doc.getNumberOfPages(), level || 1]); bar(title, true); }
  function endSection() { stroke(LINE); doc.setLineWidth(0.6); sec = null; y += 6; }
  function wrap(t, w, size, style) { font(style || 'normal', size); return doc.splitTextToSize(String(t || ''), w); }
  function camIcon(x, yy) { fill([70, 70, 70]); doc.roundedRect(x, yy, 9, 6.5, 1.2, 1.2, 'F'); doc.rect(x + 2.2, yy - 1.3, 3, 1.4, 'F'); fill([255, 255, 255]); doc.circle(x + 4.5, yy + 3.3, 1.7, 'F'); fill([70, 70, 70]); doc.circle(x + 4.5, yy + 3.3, 0.9, 'F'); }
  function tag(text, x, yy) { font('normal', 8.5); var tw = doc.getTextWidth(text) + 10; fill(ORANGE); doc.roundedRect(x, yy, tw, 15, 3, 3, 'F'); color([255, 255, 255]); doc.text(text, x + 5, yy + 10.5); return 17; }
  function tableHead(cols) { ensure(60); fill(GREEN); doc.rect(M, y, CW, 22, 'F'); color([255, 255, 255]); font('bold', 9); var x = M; cols.forEach(function (cl) { doc.text(cl[0], x + 7, y + 14.5); x += cl[1]; }); y += 22; }
  /* row: cells = [{t, style, size, tag}] */
  function row(cols, cells, shade, refIcon) {
    var lines = cells.map(function (cl, ix) { return wrap(cl.t, cols[ix][1] - 14, cl.size || 9, cl.style); });
    var hgt = Math.max.apply(null, lines.map(function (l, ix) { return l.length * 11.6 + (cells[ix].tag ? 19 : 0); })) + 18;
    if (refIcon) hgt = Math.max(hgt, 38);
    ensure(hgt); if (shade) { fill(ROW); doc.rect(M, y, CW, hgt, 'F'); }
    stroke(LINE); doc.setLineWidth(0.6); doc.line(M, y + hgt, M + CW, y + hgt); doc.line(M, y, M, y + hgt); doc.line(M + CW, y, M + CW, y + hgt);
    var x = M;
    cells.forEach(function (cl, ix) { if (ix) doc.line(x, y, x, y + hgt); font(cl.style || 'normal', cl.size || 9); color(cl.color || TXT); doc.text(lines[ix], x + 7, y + 15, { lineHeightFactor: 1.29 }); if (cl.tag) tag(cl.tag, x + 7, y + 15 + lines[ix].length * 11.6 - 4); x += cols[ix][1]; });
    if (refIcon) camIcon(M + 7, y + 22);
    y += hgt;
  }
  function photos(list_, ref, per) {
    list_ = list_.filter(function (e) { return IMG[e.id]; }); if (!list_.length) return;
    per = per || 3; var gap = 7, cw = (CW - 14 - gap * (per - 1)) / per, ih = cw * 0.75, rh = ih + 22;
    for (var i2 = 0; i2 < list_.length; i2 += per) {
      ensure(rh + 12); stroke(LINE); doc.setLineWidth(0.6); doc.line(M, y, M, y + rh + 12); doc.line(M + CW, y, M + CW, y + rh + 12);
      list_.slice(i2, i2 + per).forEach(function (e, ix) {
        var x = M + 7 + ix * (cw + gap), yy = y + 7; fill(CELL); doc.rect(x, yy, cw, rh, 'F');
        doc.addImage(IMG[e.id], 'JPEG', x + 4, yy + 4, cw - 8, ih - 8, undefined, 'FAST');
        var ts = tsFmt(e.at); font('italic', per > 3 ? 6.2 : 6.8); var tw = doc.getTextWidth(ts) + 8; fill([0, 0, 0]); doc.rect(x + cw - 4 - tw, yy + ih - 4 - 11, tw, 11, 'F'); color([255, 255, 255]); doc.text(ts, x + cw - 4 - tw + 4, yy + ih - 4 - 3);
        font('italic', 8); color(GREY); doc.text('Ref #' + ref, x + cw / 2, yy + ih + 9, { align: 'center' });
      });
      y += rh + 12; doc.line(M, y, M + CW, y);
    }
  }

  /* ---- cover ---- */
  fill(GREEN); doc.rect(0, 0, W, H, 'F');
  fill([255, 255, 255]); doc.rect(13, 13, 177, 88, 'F');
  font('bold', 15); color([84, 196, 120]); doc.text(co.name, 26, 42);
  [co.address, co.phone, co.email].forEach(function (t, ix) { fill([84, 196, 120]); doc.circle(29.5, 53.5 + ix * 13.3, 3.4, 'F'); font('normal', 6.3); color([40, 40, 40]); doc.text(t, 38, 55.6 + ix * 13.3); });
  var dIso = (j.attendance && j.attendance.inAt) || r.submittedAt || now();
  font('bold', 12); color(CORAL); doc.text(longDate(dIso), W - 13, 62, { align: 'right' });
  var title = k === 'CHECK_OUT' ? 'Check Out & Schedule of Condition' : 'Inventory & Schedule of Condition';
  font('bold', 15); doc.text(title, W / 2, 133, { align: 'center' });
  font('bold', 10); doc.text(addr, W / 2, 165, { align: 'center' });
  if (coverImg) doc.addImage(coverImg, 'JPEG', 81, 182, 434, 325, undefined, 'FAST');
  font('bold', 10); color(CORAL); doc.text('Prepared By ' + (pro.name || 'LISTD Clerk'), W / 2, 539, { align: 'center' });
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.8); doc.line(162, 559, 433, 559);
  doc.text('On Behalf of ' + (c.orgName || c.name || ''), W / 2, 584, { align: 'center' });
  doc.line(162, 646, 433, 646);

  /* ---- contents placeholder (page 2) ---- */
  doc.addPage(); pageHeader(); var tocPage = doc.getNumberOfPages();
  /* ---- executive summary ---- */
  doc.addPage(); pageHeader(); y = 41; bar('Executive Summary'); y += 14;
  if (k === 'CHECK_OUT') { var bl = r.baselineId && D.jobs[r.baselineId] ? 'Compared with the check-in report ' + D.jobs[r.baselineId].ref + '. Observations are not liability findings or deposit deductions.' : 'Comparison unavailable: no baseline check-in report was on record for this property.'; font('bold', 9.5); color(TXT); var bll = doc.splitTextToSize(bl, CW - 16); doc.text(bll, M + 8, y + 8); y += bll.length * 12 + 12; }
  if (s.summary) { font('normal', 9.5); color(TXT); var sl = doc.splitTextToSize(s.summary, CW - 16); doc.text(sl, M + 8, y + 8, { lineHeightFactor: 1.35 }); }
  /* ---- interpretations ---- */
  doc.addPage(); pageHeader(); y = 41; toc.push(['Interpretations', doc.getNumberOfPages(), 0]); bar('Interpretations'); y += 26;
  function rich(boldT, normT, underline) {
    var x0 = M + 6, w = CW - 12; font('bold', 9); var bw = doc.getTextWidth(boldT); color(TXT);
    if (underline) { var ul = doc.splitTextToSize(boldT, w); doc.text(ul, x0, y, { lineHeightFactor: 1.35 }); ul.forEach(function (ln, ix) { var lw = doc.getTextWidth(ln); doc.setLineWidth(0.5); doc.setDrawColor(62, 62, 62); doc.line(x0, y + 1.5 + ix * 12.2, x0 + lw, y + 1.5 + ix * 12.2); }); y += ul.length * 12.2 + 7; return; }
    doc.text(boldT, x0, y); font('normal', 9); var rest = doc.splitTextToSize(normT, w - bw); var first = rest[0] || '', more = doc.splitTextToSize(rest.slice(1).join(' '), w);
    doc.text(first, x0 + bw, y); if (rest.length > 1) doc.text(more, x0, y + 12.2, { lineHeightFactor: 1.35 }); y += (rest.length > 1 ? more.length + 1 : 1) * 12.2 + 6.6;
  }
  rich(INTERP_HEAD, '', true); rich(INTERP_ACCESS[0], INTERP_ACCESS[1]);
  INTERP.forEach(function (x) { rich(x[0], ' – ' + x[1]); });
  /* ---- disclaimer ---- */
  doc.addPage(); pageHeader(); y = 41; toc.push([co.name + '’s Disclaimer', doc.getNumberOfPages(), 0]); bar(co.name + '’s Disclaimer'); y += 26;
  rich(co.name + '’s Disclaimer', '', true); y += 4;
  DISCLAIMER.forEach(function (para) { font('normal', 9); color(TXT); var pl = doc.splitTextToSize(para.replace(/LISTD Inventory/g, co.name), CW - 12); doc.text(pl, M + 6, y, { lineHeightFactor: 1.35 }); y += pl.length * 12.2 + 9; });

  /* ---- areas ---- */
  doc.addPage(); pageHeader(); y = 27; toc.push(['Areas', doc.getNumberOfPages(), 0]);
  section('1. SCHEDULE OF CONDITION', 'Schedule of Condition');
  var SC = [['Ref', 33], ['Name', 133], ['Condition', CW - 166]];
  tableHead(SC); s.schedule.forEach(function (rw, ix) { row(SC, [{ t: '1.' + (ix + 1), style: 'bold', size: 7 }, { t: rw.name }, { t: schedText(rw) }], ix % 2 === 1); }); endSection();
  section('2. METER READINGS', 'Meter Readings'); photos(ev.filter(function (e) { return e.area === 'meters' && e.item === 'room'; }), '2', 4);
  var MC = [['Ref', 28], ['Name', 108], ['Serial No.', 108], ['Reading', 108], ['Location', 108], ['Supplier', CW - 460]];
  tableHead(MC); s.meters.forEach(function (m, ix) { var ph = ev.filter(function (e) { return e.item === m.id; }); row(MC, [{ t: '2.' + (ix + 1), style: 'bold', size: 7 }, { t: m.name }, { t: m.na ? NA_TEXT : m.serial }, { t: m.na ? NA_TEXT : m.reading }, { t: m.na ? NA_TEXT : m.location }, { t: m.na ? '' : m.supplier }], false, ph.length > 0); photos(ph, '2.' + (ix + 1)); }); endSection();
  section('3. ALARMS', 'Alarms'); photos(ev.filter(function (e) { return e.area === 'alarms' && e.item === 'room'; }), '3', 4);
  var AC = [['Ref', 35], ['Name', 107], ['Location Room & Floor', 212], ['Test Result', CW - 354]];
  tableHead(AC); s.alarms.forEach(function (a, ix) { var ph = ev.filter(function (e) { return e.item === a.id; }); row(AC, [{ t: '3.' + (ix + 1), style: 'bold', size: 7 }, { t: a.name }, { t: a.location }, { t: a.result }], ix % 2 === 1, ph.length > 0); photos(ph, '3.' + (ix + 1)); }); endSection();
  var IC = [['Ref', 35], ['Name', 107], ['Description', 212], ['Condition', CW - 354]];
  var bmap = {}; var base = r.baselineId && D.jobs[r.baselineId] ? releasedReport(D.jobs[r.baselineId]) : null; if (base && base.sections.v3) base.sections.rooms.forEach(function (rm) { rm.items.forEach(function (it) { bmap[rm.name + '|' + it.name] = it; }); });
  s.rooms.forEach(function (rm, ri) {
    var n = secNo(s, 'room', ri); section(n + '. ' + rm.name.toUpperCase(), rm.name.toUpperCase());
    photos(ev.filter(function (e) { return e.area === rm.id && e.item === 'room'; }), String(n), 4);
    tableHead(IC);
    if (!rm.items.length) row([['', CW]], [{ t: 'No items associated with this room.' }], false);
    rm.items.forEach(function (it, ii) {
      var ref = n + '.' + (ii + 1), ph = ev.filter(function (e) { return e.item === it.id; }), cond = it.condNote || '';
      if (k === 'CHECK_OUT' && it.find && it.find !== 'none') cond += (cond ? ' ' : '') + 'Compared with check-in: ' + FIND[it.find] + '.';
      var b = bmap[rm.name + '|' + it.name]; if (b && b.condNote) cond += (cond ? '\n\n' : '') + 'At check-in: ' + b.condNote;
      row(IC, [{ t: ref, style: 'bold', size: 7 }, { t: it.name }, { t: it.desc }, { t: cond, tag: it.action ? ACTIONS[it.action] + ' - Investigate' : '' }], ii % 2 === 0, ph.length > 0);
      photos(ph, ref);
    });
    endSection();
  });
  var kn = secNo(s, 'keys'); section(kn + '. KEYS', 'KEYS'); photos(ev.filter(function (e) { return e.area === 'keys' && e.item === 'room'; }), String(kn), 4);
  var KC = [['Ref', 35], ['Name', 125], ['Description', CW - 160]];
  tableHead(KC); s.keys.forEach(function (kk, ix) { var ph = ev.filter(function (e) { return e.item === kk.id; }); row(KC, [{ t: kn + '.' + (ix + 1), style: 'bold', size: 7 }, { t: kk.name }, { t: kk.desc }], ix % 2 === 1, ph.length > 0); photos(ph, kn + '.' + (ix + 1)); }); endSection();
  var acts = inspActions(s);
  ensure(120); y += 14; toc.push(['Actions', doc.getNumberOfPages(), 0]); sec = 'Investigate Responsibilities'; bar('Investigate Responsibilities', true);
  var XC = [['Ref', 141], ['Action Required', 68], ['Comments', CW - 209]];
  fill(GREEN); doc.rect(M, y, CW, 34, 'F'); color([255, 255, 255]); font('bold', 9); doc.text('Ref', M + 7, y + 20); doc.text(['Action', 'Required'], M + 148, y + 14); doc.text('Comments', M + 216, y + 20); y += 34;
  if (!acts.length) row([['', CW]], [{ t: 'No actions recorded.' }], false);
  acts.forEach(function (a, ix) { row(XC, [{ t: a[0] + ' ' + a[1] + ' » ' + a[2] }, { t: ACTIONS[a[3]] }, { t: a[4] }], ix % 2 === 0); }); sec = null;
  /* declaration */
  doc.addPage(); pageHeader(); y = 41; toc.push(['Declaration', doc.getNumberOfPages(), 0]); bar('Declaration'); y += 22;
  font('normal', 9); color(TXT); doc.text(doc.splitTextToSize(DECLARATION, CW - 12), M + 6, y, { lineHeightFactor: 1.35 });
  var anyAi = s.rooms.some(function (rm) { return rm.items.some(function (it) { return it.source; }); });
  if (anyAi) { font('italic', 7.5); color(GREY); doc.text('Some descriptions were drafted with AI from the clerk’s photos and checked and confirmed by the clerk on site.', M + 6, y + 40); }

  /* contents */
  var total = doc.getNumberOfPages();
  doc.setPage(tocPage); y = 41; bar('Contents'); y += 30;
  var areaItems = toc.filter(function (t) { return t[2] === 1; });
  var main = toc.filter(function (t) { return t[2] === 0; });
  function tocLine(name, pg, indent) { font('normal', 9.5); color(TXT); var x = M + 6 + (indent ? 20 : 0), num = String(pg - 1); doc.text(name, x, y); var nw = doc.getTextWidth(num), start = x + doc.getTextWidth(name) + 3, end = M + CW - 6 - nw - 3; font('normal', 9.5); var dotW = doc.getTextWidth('.'), dots = ''; for (var d = start; d < end; d += dotW) dots += '.'; color([150, 150, 150]); doc.text(dots, start, y); color(TXT); doc.text(num, M + CW - 6, y, { align: 'right' }); y += 21.5; }
  main.forEach(function (t) { tocLine(t[0], t[1], false); if (t[0] === 'Areas') areaItems.forEach(function (a) { tocLine(a[0], a[1], true); }); });
  /* footers */
  for (var pg = 2; pg <= total; pg++) { doc.setPage(pg); font('normal', 8.5); color(GREY); doc.text('Page ' + (pg - 1) + ' of ' + (total - 1), M, H - 18); doc.text('Tenant Initials: ', W - M - 52, H - 18, { align: 'right' }); doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.5); doc.line(W - M - 52, H - 17, W - M, H - 17); }
  return doc.output('blob');
}
async function downloadInspectionPdf(j, r) {
  toast('Building the PDF report…');
  try {
    var blob = await buildInspectionPdf(j, r), p = j.propSnapshot || {}, name = (p.address || j.ref).replace(/[^\w\s-]/g, '').trim().slice(0, 60) + ' - ' + (svcKey(j) === 'CHECK_OUT' ? 'CHECK OUT' : 'INVENTORY') + ' REPORT v' + r.v + '.pdf';
    if (ENV.downloads) { try { await ENV.downloads.save({ filename: name, data: blob }); return; } catch (e) { if (e && e.code === 'declined') return; } }
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  } catch (e) { toast('Couldn’t build the PDF. Check your connection and try again.'); }
}
