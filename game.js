'use strict';

/* ================================================================
   Rummy — Steine-Variante von Rommé
   106 Steine: 1–13 in vier Farben, je doppelt, plus 2 Joker.
   ================================================================ */

/* ---------------- Steine ---------------- */

const T = [];                       // T[id] = {id, c, n, joker}
(function buildTiles() {
  let id = 0;
  for (let copy = 0; copy < 2; copy++)
    for (let c = 0; c < 4; c++)
      for (let n = 1; n <= 13; n++)
        T.push({ id: id++, c, n, joker: false });
  T.push({ id: id++, c: 0, n: 0, joker: true });
  T.push({ id: id++, c: 3, n: 0, joker: true });
})();

// Jede Farbe trägt zusätzlich ein eigenes Symbol — so bleiben die Steine
// auch bei Rot-Grün-Schwäche eindeutig unterscheidbar.
const PIPS = ['◆', '●', '▲', '■'];

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------------- Spielzustand ---------------- */

let S = null;          // {pool, players, board, cur, passes, over, swap, stale}
let snap = null;       // Zustand bei Zugbeginn (für "Zug zurücksetzen")
let playedIds = null;  // Steine, die der Mensch in diesem Zug aus der Ablage gelegt hat
let discardMode = false; // Tauschregel: gezogen, jetzt darf ein Stein zurück in den Beutel
let freedJokers = new Set(); // in diesem Zug ausgelöste Joker — müssen wieder auf den Tisch
let aiCount = 2;
let swapRule = false;
let jokerRule = false;

const AI_NAMES = ['Konrad', 'Beatrix', 'Wilhelm'];

function newGame(numAI, swap, joker) {
  const pool = shuffle(T.map(t => t.id));
  const players = [{ name: 'Du', ai: false, rack: pool.splice(0, 14), opened: false }];
  for (let i = 0; i < numAI; i++)
    players.push({ name: AI_NAMES[i], ai: true, rack: pool.splice(0, 14), opened: false });
  S = { pool, players, board: [], cur: 0, passes: 0, over: false, swap, jokerSwap: joker, stale: 0 };
  beginTurn();
}

function beginTurn() {
  discardMode = false;
  freedJokers = new Set();
  snap = {
    board: S.board.map(s => s.slice()),
    rack: S.players[S.cur].rack.slice(),
    opened: S.players[S.cur].opened,
  };
  playedIds = new Set();
  renderAll();
  const p = S.players[S.cur];
  if (p.ai) {
    msg(p.name + ' überlegt …');
    setTimeout(aiTurn, 900 + Math.random() * 600);
  } else {
    msg('Du bist am Zug.');
  }
}

function finishTurn() {
  const p = S.players[S.cur];
  if (p.rack.length === 0) { gameOver(p); return; }
  // Patt-Sicherung: mit Tauschregel leert sich der Beutel nie —
  // wenn sehr lange niemand legt, wird nach Punkten gewertet.
  if (S.swap && S.stale >= S.players.length * 12) { gameOverByPoints(true); return; }
  S.cur = (S.cur + 1) % S.players.length;
  beginTurn();
}

/* ---------------- Regeln: Gültigkeit & Wert einer Reihe ----------------
   Gruppe: 3–4 gleiche Zahlen, verschiedene Farben.
   Reihe:  mind. 3 aufeinanderfolgende Zahlen einer Farbe (Reihenfolge im Array).
   Joker zählen als der ersetzte Stein.                                    */

function setInfoT(ts) {
  if (ts.length < 3) return { valid: false, value: 0 };
  const nonJ = ts.filter(t => !t.joker);
  let group = null, run = null;

  if (ts.length <= 4 && nonJ.length >= 1) {
    const nums = new Set(nonJ.map(t => t.n));
    const cols = new Set(nonJ.map(t => t.c));
    if (nums.size === 1 && cols.size === nonJ.length)
      group = { valid: true, value: nonJ[0].n * ts.length };
  }

  const cols = new Set(nonJ.map(t => t.c));
  if (cols.size <= 1 && nonJ.length >= 1) {
    let base = null, ok = true;
    ts.forEach((t, i) => {
      if (t.joker) return;
      const b = t.n - i;
      if (base === null) base = b;
      else if (b !== base) ok = false;
    });
    if (ok && base >= 1 && base + ts.length - 1 <= 13) {
      let v = 0;
      for (let i = 0; i < ts.length; i++) v += base + i;
      run = { valid: true, value: v };
    }
  }

  if (group && run) return { valid: true, value: Math.max(group.value, run.value) };
  return group || run || { valid: false, value: 0 };
}

function setInfo(ids) { return setInfoT(ids.map(id => T[id])); }

// Wofür ist der Joker an Position i eingesprungen? Passt der Stein dorthin,
// ohne dass eine Farbe doppelt vorkommt oder die Reihe bricht?
function canReplaceJoker(s, i, id) {
  if (T[id].joker || !T[s[i]].joker) return false;
  const ts = s.map(x => T[x]);
  ts[i] = T[id];
  return setInfoT(ts).valid;
}

function canAppend(s, id) {
  for (const pos of [s.length, 0]) {
    const test = s.slice();
    test.splice(pos, 0, id);
    if (setInfo(test).valid) return pos;
  }
  return -1;
}

function boardAllValid() {
  return S.board.every(s => setInfo(s).valid);
}

function tileValue(id) { return T[id].joker ? 30 : T[id].n; }

/* ---------------- Zug des Menschen ---------------- */

function boardChanged() {
  if (S.board.length !== snap.board.length) return true;
  return JSON.stringify(S.board) !== JSON.stringify(snap.board);
}

function currentMeldPoints() {
  // Punkte der komplett neu gelegten Reihen (nur eigene Steine)
  let pts = 0;
  for (const s of S.board)
    if (s.length >= 3 && s.every(id => playedIds.has(id)))
      pts += setInfo(s).valid ? setInfo(s).value : 0;
  return pts;
}

function undoTurn() {
  S.board = snap.board.map(s => s.slice());
  S.players[S.cur].rack = snap.rack.slice();
  playedIds = new Set();
  freedJokers = new Set();
  renderAll();
  msg('Zug zurückgesetzt.');
}

function drawTile() {
  const p = S.players[S.cur];
  if (playedIds.size > 0 || boardChanged()) {
    undoTurn();
    msg('Änderungen zurückgenommen — du ziehst einen Stein.');
  }
  if (S.pool.length === 0) {
    S.passes++;
    S.stale++;
    msg('Der Beutel ist leer — du setzt aus.');
    if (S.passes >= S.players.length) { gameOverByPoints(); return; }
    setTimeout(finishTurn, 700);
    return;
  }
  S.passes = 0;
  S.stale++;
  const id = S.pool.pop();
  p.rack.push(id);
  if (S.swap) {
    discardMode = true;
    renderAll();
    const el = document.querySelector(`#rack .tile[data-id="${id}"]`);
    if (el) el.classList.add('fresh');
    msg('Stein gezogen — ziehe einen Stein ins goldene Feld oder behalte alle.');
    return;
  }
  renderAll();
  const el = document.querySelector(`#rack .tile[data-id="${id}"]`);
  if (el) el.classList.add('fresh');
  msg('Stein gezogen.');
  setTimeout(finishTurn, 700);
}

function discardTile(id) {
  const p = S.players[0];
  p.rack.splice(p.rack.indexOf(id), 1);
  S.pool.splice(Math.floor(Math.random() * (S.pool.length + 1)), 0, id);
  discardMode = false;
  renderAll();
  msg('Stein in den Beutel zurückgelegt.');
  setTimeout(finishTurn, 500);
}

function keepAll() {
  discardMode = false;
  renderAll();
  finishTurn();
}

function endTurn() {
  const p = S.players[S.cur];
  const bad = S.board.findIndex(s => !setInfo(s).valid);
  if (bad >= 0) {
    err('Auf dem Tisch liegt eine ungültige Reihe.');
    renderBoard();
    return;
  }
  for (const jid of freedJokers) {
    if (p.rack.includes(jid)) {
      err('Der ausgelöste Joker muss noch in diesem Zug wieder auf den Tisch.');
      return;
    }
  }
  if (playedIds.size === 0) {
    if (boardChanged()) { err('Du hast nur umgebaut — lege mindestens einen eigenen Stein oder setze zurück.'); return; }
    err('Lege Steine an oder ziehe einen Stein.');
    return;
  }
  if (!p.opened) {
    for (const s of S.board) {
      const mine = s.filter(id => playedIds.has(id)).length;
      if (mine > 0 && mine < s.length) {
        err('Vor deiner ersten Auslage darfst du nur komplett neue Reihen legen.');
        return;
      }
    }
    const pts = currentMeldPoints();
    if (pts < 30) {
      err(`Die erste Auslage braucht mindestens 30 Punkte — du hast erst ${pts}.`);
      return;
    }
    p.opened = true;
    msg(`Ausgelegt mit ${pts} Punkten!`);
  }
  S.passes = 0;
  S.stale = 0;
  finishTurn();
}

/* ---------------- Computer-Gegner ---------------- */

function genMelds(rack, allowJoker) {
  const cands = [];
  const tiles = rack.map(id => T[id]);
  const jokers = tiles.filter(t => t.joker).map(t => t.id);

  // Gruppen: pro Zahl je Farbe ein Vertreter
  for (let n = 1; n <= 13; n++) {
    const byColor = {};
    for (const t of tiles)
      if (!t.joker && t.n === n && byColor[t.c] === undefined) byColor[t.c] = t.id;
    const ids = Object.values(byColor);
    if (ids.length >= 3) {
      cands.push({ ids: ids.slice(), value: n * ids.length });
      if (ids.length === 4)
        for (let skip = 0; skip < 4; skip++)
          cands.push({ ids: ids.filter((_, i) => i !== skip), value: n * 3 });
    }
    if (allowJoker && jokers.length) {
      if (ids.length === 2)
        cands.push({ ids: [...ids, jokers[0]], value: n * 3 });
      if (ids.length === 3)
        cands.push({ ids: [...ids, jokers[0]], value: n * 4 });
    }
  }

  // Reihen: pro Farbe fortlaufende Abschnitte
  for (let c = 0; c < 4; c++) {
    const byNum = {};
    for (const t of tiles)
      if (!t.joker && t.c === c && byNum[t.n] === undefined) byNum[t.n] = t.id;
    const nums = Object.keys(byNum).map(Number).sort((a, b) => a - b);
    // maximale Abschnitte finden
    const stretches = [];
    let start = 0;
    for (let i = 1; i <= nums.length; i++) {
      if (i === nums.length || nums[i] !== nums[i - 1] + 1) {
        stretches.push(nums.slice(start, i));
        start = i;
      }
    }
    for (const st of stretches) {
      const L = st.length;
      for (let len = 3; len <= L; len++)
        for (let s0 = 0; s0 + len <= L; s0++) {
          const win = st.slice(s0, s0 + len);
          cands.push({
            ids: win.map(n => byNum[n]),
            value: win.reduce((a, b) => a + b, 0),
          });
        }
    }
    if (allowJoker && jokers.length) {
      // Joker überbrückt eine Lücke von genau 1
      for (let i = 0; i + 1 < stretches.length; i++) {
        const a = stretches[i], b = stretches[i + 1];
        if (b[0] - a[a.length - 1] === 2) {
          const win = [...a, null, ...b];
          if (win.length >= 3 && win.length <= 6) {
            const gapNum = a[a.length - 1] + 1;
            cands.push({
              ids: win.map(n => n === null ? jokers[0] : byNum[n]),
              value: [...a, gapNum, ...b].reduce((x, y) => x + y, 0),
            });
          }
        }
      }
      // Joker verlängert ein Paar
      for (const st of stretches) {
        if (st.length === 2) {
          const hi = st[1];
          if (hi < 13)
            cands.push({ ids: [byNum[st[0]], byNum[hi], jokers[0]], value: st[0] + hi + hi + 1 });
          else
            cands.push({ ids: [jokers[0], byNum[st[0]], byNum[hi]], value: st[0] - 1 + st[0] + hi });
        }
      }
    }
  }
  return cands.slice(0, 140);
}

// Beste disjunkte Kombination von Reihen aus der Hand (für die 30er-Auslage)
function bestCombo(rack, allowJoker) {
  const cands = genMelds(rack, allowJoker).sort((a, b) => b.value - a.value);
  let best = null, bestV = 0, nodes = 0;
  (function rec(i, used, cur, v) {
    if (v > bestV) { bestV = v; best = cur.map(m => m.slice()); }
    if (nodes++ > 6000 || i >= cands.length) return;
    for (let j = i; j < cands.length; j++) {
      const m = cands[j];
      if (m.ids.some(id => used.has(id))) continue;
      m.ids.forEach(id => used.add(id));
      cur.push(m.ids);
      rec(j + 1, used, cur, v + m.value);
      cur.pop();
      m.ids.forEach(id => used.delete(id));
    }
  })(0, new Set(), [], 0);
  return { melds: best || [], value: bestV };
}

function aiTurn() {
  const p = S.players[S.cur];
  const before = p.rack.length;
  const fresh = [];

  const playMeld = (ids) => {
    p.rack = p.rack.filter(id => !ids.includes(id));
    S.board.push(ids.slice());
    fresh.push(...ids);
  };

  if (!p.opened) {
    let combo = bestCombo(p.rack, false);
    if (combo.value < 30) combo = bestCombo(p.rack, true);
    if (combo.value >= 30) {
      combo.melds.forEach(playMeld);
      p.opened = true;
    }
  } else {
    // 0) Joker vom Tisch auslösen, wenn er sofort wieder verwendet werden kann
    const gotJoker = S.jokerSwap ? aiTryJokerSwap(p, fresh) : false;
    // 1) komplette Reihen aus der Hand legen (Joker nur bei kleiner Hand)
    let go = true;
    while (go) {
      go = false;
      const allowJ = gotJoker || p.rack.length <= 5;
      const cands = genMelds(p.rack, allowJ).sort((a, b) => b.value - a.value);
      if (cands.length) { playMeld(cands[0].ids); go = true; }
    }
    // 2) einzelne Steine an Tischreihen anlegen
    go = true;
    while (go) {
      go = false;
      const tryTiles = p.rack.filter(id => !T[id].joker || p.rack.length <= 3);
      outer:
      for (const id of tryTiles) {
        for (const s of S.board) {
          for (const pos of [s.length, 0]) {
            const test = s.slice();
            test.splice(pos, 0, id);
            if (setInfo(test).valid) {
              s.splice(pos, 0, id);
              p.rack = p.rack.filter(x => x !== id);
              fresh.push(id);
              go = true;
              break outer;
            }
          }
        }
      }
    }
  }

  const played = p.rack.length < before;
  if (played) {
    S.passes = 0;
    S.stale = 0;
    msg(`${p.name} legt ${before - p.rack.length} Stein${before - p.rack.length > 1 ? 'e' : ''}.`);
  } else if (S.pool.length > 0) {
    S.passes = 0;
    S.stale++;
    p.rack.push(S.pool.pop());
    const swapped = S.swap ? aiMaybeDiscard(p) : false;
    msg(swapped ? `${p.name} zieht und tauscht einen Stein.` : `${p.name} zieht einen Stein.`);
  } else {
    S.passes++;
    S.stale++;
    msg(`${p.name} setzt aus.`);
    if (S.passes >= S.players.length) { renderAll(); gameOverByPoints(); return; }
  }

  renderAll();
  for (const id of fresh) {
    const el = document.querySelector(`#board .tile[data-id="${id}"]`);
    if (el) el.classList.add('fresh');
  }
  setTimeout(finishTurn, played ? 1300 : 900);
}

// Joker-Regel: einen Joker vom Tisch holen — aber nur, wenn er im selben Zug
// sofort wieder untergebracht werden kann. Sonst wird der Tausch zurückgenommen.
function aiTryJokerSwap(p, fresh) {
  for (const s of S.board) {
    for (let i = 0; i < s.length; i++) {
      const jokerId = s[i];
      if (!T[jokerId].joker) continue;
      for (const id of p.rack) {
        if (!canReplaceJoker(s, i, id)) continue;
        s[i] = id;                                   // testweise auslösen
        const rackAfter = p.rack.filter(x => x !== id);
        let placed = false;

        for (const t of S.board) {                   // Joker woanders anlegen
          const pos = canAppend(t, jokerId);
          if (pos >= 0) { t.splice(pos, 0, jokerId); placed = true; break; }
        }
        if (!placed) {                               // oder neue Reihe damit
          const m = genMelds(rackAfter.concat(jokerId), true)
            .filter(x => x.ids.includes(jokerId))
            .sort((a, b) => b.value - a.value)[0];
          if (m) {
            S.board.push(m.ids.slice());
            for (const x of m.ids)
              if (x !== jokerId) rackAfter.splice(rackAfter.indexOf(x), 1);
            fresh.push(...m.ids);
            placed = true;
          }
        }

        if (placed) {
          p.rack = rackAfter;
          fresh.push(id, jokerId);
          return true;
        }
        s[i] = jokerId;                              // rückgängig
      }
    }
  }
  return false;
}

// Tauschregel: den nutzlosesten Stein zurück in den Beutel legen,
// aber nur, wenn er wirklich kaum Kombinationschancen hat.
function aiMaybeDiscard(p) {
  let worst = null, worstScore = Infinity;
  for (const id of p.rack) {
    const t = T[id];
    if (t.joker) continue;
    let score = 0;
    for (const other of p.rack) {
      if (other === id) continue;
      const o = T[other];
      if (o.joker) { score += 0.5; continue; }
      if (o.n === t.n && o.c !== t.c) score += 2;              // Gruppen-Partner
      if (o.c === t.c && Math.abs(o.n - t.n) === 1) score += 2; // Reihen-Nachbar
      if (o.c === t.c && Math.abs(o.n - t.n) === 2) score += 1; // Lücken-Nachbar
      if (o.n === t.n && o.c === t.c) score -= 0.5;             // Duplikat
    }
    if (p.opened) {
      for (const s of S.board) {
        let fits = false;
        for (const pos of [0, s.length]) {
          const test = s.slice();
          test.splice(pos, 0, id);
          if (setInfo(test).valid) { fits = true; break; }
        }
        if (fits) { score += 3; break; }
      }
    }
    score -= t.n * 0.05; // hohe Steine im Zweifel lieber abgeben
    if (score < worstScore) { worstScore = score; worst = id; }
  }
  if (worst === null || worstScore >= 2) return false;
  p.rack.splice(p.rack.indexOf(worst), 1);
  S.pool.splice(Math.floor(Math.random() * (S.pool.length + 1)), 0, worst);
  return true;
}

/* ---------------- Spielende ---------------- */

function rackPoints(p) { return p.rack.reduce((a, id) => a + tileValue(id), 0); }

function gameOver(winner) {
  S.over = true;
  showEnd(
    winner.ai ? `${winner.name} gewinnt` : 'Du gewinnst!',
    winner,
  );
}

function gameOverByPoints(stale) {
  S.over = true;
  let winner = S.players[0];
  for (const p of S.players) if (rackPoints(p) < rackPoints(winner)) winner = p;
  showEnd(
    (stale ? 'Festgefahren — ' : '') + (winner.ai ? `${winner.name} gewinnt` : 'Du gewinnst') + ' nach Punkten',
    winner,
  );
}

function showEnd(title, winner) {
  document.getElementById('end-title').textContent = title;
  const det = document.getElementById('end-detail');
  det.innerHTML = '';
  for (const p of S.players) {
    const row = document.createElement('div');
    row.className = 'row' + (p === winner ? ' winner' : '');
    const pts = rackPoints(p);
    row.innerHTML = `<span>${p.name}</span><span>${p.rack.length === 0 ? 'alle Steine abgelegt' : '−' + pts + ' Punkte'}</span>`;
    det.appendChild(row);
  }
  document.getElementById('start-panel').classList.add('hidden');
  document.getElementById('end-panel').classList.remove('hidden');
  document.getElementById('overlay').classList.add('show');
}

/* ---------------- Darstellung ---------------- */

const boardEl = document.getElementById('board');
const rackEl = document.getElementById('rack');

function tileEl(id, mine) {
  const t = T[id];
  const el = document.createElement('div');
  el.className = `tile c${t.c}` + (t.joker ? ' joker' : '') + (mine ? ' mine' : '');
  el.dataset.id = id;
  el.innerHTML = t.joker
    ? `<span class="num">☺</span>`
    : `<span class="num">${t.n}</span><span class="pip">${PIPS[t.c]}</span>`;
  return el;
}

function renderBoard() {
  boardEl.innerHTML = '';
  if (S.board.length === 0) {
    const h = document.createElement('div');
    h.className = 'hint';
    h.textContent = 'Ziehe Steine aus deiner Ablage hierher, um eine neue Reihe zu beginnen.';
    boardEl.appendChild(h);
  }
  S.board.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'bset' + (setInfo(s).valid ? '' : ' invalid');
    el.dataset.idx = i;
    for (const id of s) el.appendChild(tileEl(id, playedIds && playedIds.has(id)));
    boardEl.appendChild(el);
  });
}

function renderRack() {
  rackEl.innerHTML = '';
  for (const id of S.players[0].rack) {
    const el = tileEl(id, false);
    if (freedJokers.has(id)) el.classList.add('freed');
    rackEl.appendChild(el);
  }
}

function renderTop() {
  document.getElementById('poolcount').textContent = S.pool.length;
  const opp = document.getElementById('opponents');
  opp.innerHTML = '';
  S.players.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'opp' + (i === S.cur && !S.over ? ' active' : '') + (p.opened ? ' opened' : '');
    el.innerHTML = `<span>${p.name}</span><span class="cnt">${p.rack.length}</span>`;
    el.title = p.opened ? 'hat ausgelegt' : 'noch nicht ausgelegt';
    opp.appendChild(el);
  });
}

function renderControls() {
  const my = S.cur === 0 && !S.over;
  document.getElementById('btn-undo').disabled = !my || discardMode || (!boardChanged() && playedIds.size === 0);
  document.getElementById('btn-draw').disabled = !my || discardMode;
  document.getElementById('btn-end').disabled = !my || discardMode;
  document.getElementById('btn-keep').classList.toggle('hidden', !discardMode);
  document.body.classList.toggle('discard', discardMode);
  positionDropzone();
  const p = S.players[0];
  const endBtn = document.getElementById('btn-end');
  if (my && !p.opened && playedIds.size > 0)
    endBtn.textContent = `Zug beenden (${currentMeldPoints()} P.)`;
  else
    endBtn.textContent = 'Zug beenden';
}

function renderAll() { renderBoard(); renderRack(); renderTop(); renderControls(); }

// Wegwerf-Feld (Tauschregel) großzügig über das Spielfeld legen
function positionDropzone() {
  if (!discardMode) return;
  const dz = document.getElementById('dropzone');
  const r = boardEl.getBoundingClientRect();
  dz.style.left = (r.left + 12) + 'px';
  dz.style.top = (r.top + 8) + 'px';
  dz.style.width = (r.width - 24) + 'px';
  dz.style.height = (r.height - 16) + 'px';
}
window.addEventListener('resize', positionDropzone);

let msgTimer = null;
function msg(text, isErr) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.classList.toggle('err', !!isErr);
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { el.textContent = ''; }, 5000);
}
function err(text) { msg(text, true); }

/* ---------------- Drag & Drop ---------------- */

let drag = null; // {id, src:'rack'|setArray, ghost, moved}

function findTileAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return {};
  return {
    tile: el.closest('.tile:not(.ghost)'),
    bset: el.closest('.bset'),
    rack: el.closest('#rackwrap'),
    board: el.closest('#board'),
    dropzone: el.closest('#dropzone'),
  };
}

document.addEventListener('pointerdown', (e) => {
  if (!S || S.over || S.cur !== 0) return;
  const tEl = e.target.closest('.tile');
  if (!tEl || tEl.classList.contains('ghost')) return;
  const id = +tEl.dataset.id;
  const inRack = !!tEl.closest('#rack');
  const p = S.players[0];

  let src;
  if (discardMode) {
    if (!inRack) return;   // im Tausch-Moment sind nur Ablage-Steine beweglich
    src = 'discard';
  } else if (inRack) src = 'rack';
  else {
    const setIdx = +tEl.closest('.bset').dataset.idx;
    src = S.board[setIdx];
    // Vor der ersten Auslage: fremde Tischsteine bleiben liegen
    if (!p.opened && !playedIds.has(id)) {
      err('Erst nach deiner 30-Punkte-Auslage darfst du den Tisch umbauen.');
      return;
    }
  }

  const r = tEl.getBoundingClientRect();
  const ghost = tEl.cloneNode(true);
  ghost.classList.add('ghost');
  ghost.classList.remove('mine', 'fresh');
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  ghost.style.left = r.left + 'px';
  ghost.style.top = r.top + 'px';
  document.body.appendChild(ghost);
  tEl.classList.add('dragging');

  drag = { id, src, ghost, el: tEl, dx: e.clientX - r.left, dy: e.clientY - r.top };
  markJokerHints(id, src);
  e.preventDefault();
});

// Joker auf dem Tisch aufleuchten lassen, die dieser Stein auslösen könnte
function markJokerHints(id, src) {
  if (!S.jokerSwap || src !== 'rack' || !S.players[0].opened) return;
  S.board.forEach((s, si) => {
    s.forEach((tid, i) => {
      if (!T[tid].joker || !canReplaceJoker(s, i, id)) return;
      const el = document.querySelector(`#board .bset[data-idx="${si}"] .tile[data-id="${tid}"]`);
      if (el) el.classList.add('jokerhint');
    });
  });
}

function clearJokerHints() {
  document.querySelectorAll('.jokerhint').forEach(el => el.classList.remove('jokerhint'));
}

document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
  drag.ghost.style.top = (e.clientY - drag.dy) + 'px';

  document.querySelectorAll('.droptarget').forEach(el => el.classList.remove('droptarget'));
  const hit = findTileAt(e.clientX, e.clientY);
  if (drag.src === 'discard') {
    if (hit.dropzone) hit.dropzone.classList.add('droptarget');
    return;
  }
  if (hit.bset) hit.bset.classList.add('droptarget');
  else if (hit.rack) document.getElementById('rack').classList.add('droptarget');
  else if (hit.board) boardEl.classList.add('droptarget');
});

document.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const { id, src } = drag;
  drag.ghost.remove();
  drag.el.classList.remove('dragging');
  document.querySelectorAll('.droptarget').forEach(el => el.classList.remove('droptarget'));
  clearJokerHints();

  const hit = findTileAt(e.clientX, e.clientY);
  const p = S.players[0];

  if (src === 'discard') {
    drag = null;
    if (hit.dropzone) discardTile(id);
    else renderAll();
    return;
  }

  const removeFromSrc = () => {
    if (src === 'rack') p.rack.splice(p.rack.indexOf(id), 1);
    else src.splice(src.indexOf(id), 1);
  };
  const insertIndex = (containerEl, arr) => {
    // Einfügeposition anhand der X-Mitte der vorhandenen Steine
    const tiles = [...containerEl.querySelectorAll('.tile:not(.dragging)')];
    let idx = 0;
    for (const el of tiles) {
      const r = el.getBoundingClientRect();
      if (e.clientY > r.bottom) { idx++; continue; }         // frühere Zeile (umgebrochene Ablage)
      if (e.clientY >= r.top - 6 && e.clientX > r.left + r.width / 2) idx++;
      else if (e.clientY >= r.top - 6) break;
    }
    return Math.min(idx, arr.length);
  };

  // Joker auslösen: eigenen Stein auf den Joker ziehen, für den er einsprang
  if (S.jokerSwap && src === 'rack' && hit.bset && hit.tile) {
    const target = S.board[+hit.bset.dataset.idx];
    const jid = +hit.tile.dataset.id;
    const jidx = target.indexOf(jid);
    if (jidx >= 0 && T[jid].joker) {
      if (!p.opened) {
        err('Erst nach deiner ersten Auslage darfst du einen Joker auslösen.');
      } else if (!canReplaceJoker(target, jidx, id)) {
        err('Dafür ist dieser Joker nicht eingesprungen — Farbe oder Zahl passt nicht.');
      } else {
        p.rack.splice(p.rack.indexOf(id), 1);
        target[jidx] = id;
        playedIds.add(id);
        p.rack.push(jid);
        freedJokers.add(jid);
        msg('Joker ausgelöst — er muss noch in diesem Zug wieder auf den Tisch.');
      }
      drag = null;
      renderAll();
      return;
    }
  }

  let done = false;

  if (hit.bset) {
    const target = S.board[+hit.bset.dataset.idx];
    if (!p.opened && src === 'rack' && !target.every(x => playedIds.has(x))) {
      err('Vor der ersten Auslage darfst du nur an deine eigenen neuen Reihen anlegen.');
    } else {
      removeFromSrc();
      const filtered = target === src ? target : target;
      const idx = insertIndex(hit.bset, filtered);
      target.splice(idx, 0, id);
      if (src === 'rack') playedIds.add(id);
      done = true;
    }
  } else if (hit.rack) {
    if (src === 'rack') {
      removeFromSrc();
      p.rack.splice(insertIndex(rackEl, p.rack), 0, id);
      done = true;
    } else if (playedIds.has(id)) {
      removeFromSrc();
      p.rack.push(id);
      playedIds.delete(id);
      done = true;
    } else {
      err('Steine vom Tisch dürfen nicht zurück auf die Ablage.');
    }
  } else if (hit.board) {
    removeFromSrc();
    S.board.push([id]);
    if (src === 'rack') playedIds.add(id);
    done = true;
  }

  if (done) S.board = S.board.filter(s => s.length > 0);
  drag = null;
  renderAll();
});

document.addEventListener('pointercancel', () => {
  if (!drag) return;
  drag.ghost.remove();
  drag.el.classList.remove('dragging');
  document.querySelectorAll('.droptarget').forEach(el => el.classList.remove('droptarget'));
  clearJokerHints();
  drag = null;
});

/* ---------------- Sortieren ---------------- */

function sortRack(byNum) {
  const p = S.players[0];
  p.rack.sort((a, b) => {
    const ta = T[a], tb = T[b];
    if (ta.joker !== tb.joker) return ta.joker ? 1 : -1;
    if (byNum) return (ta.n - tb.n) || (ta.c - tb.c);
    return (ta.c - tb.c) || (ta.n - tb.n);
  });
  renderRack();
}

/* ---------------- Bedienung ---------------- */

document.getElementById('btn-sort-num').addEventListener('click', () => sortRack(true));
document.getElementById('btn-sort-col').addEventListener('click', () => sortRack(false));
document.getElementById('btn-undo').addEventListener('click', undoTurn);
document.getElementById('btn-draw').addEventListener('click', drawTile);
document.getElementById('btn-keep').addEventListener('click', keepAll);
document.getElementById('btn-end').addEventListener('click', endTurn);

document.querySelectorAll('.choice .opt').forEach(b => {
  b.addEventListener('click', () => {
    b.parentElement.querySelectorAll('.opt').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    if (b.dataset.ai) aiCount = +b.dataset.ai;
    if (b.dataset.swap !== undefined) swapRule = b.dataset.swap === '1';
    if (b.dataset.joker !== undefined) jokerRule = b.dataset.joker === '1';
  });
});

document.getElementById('btn-start').addEventListener('click', () => {
  document.getElementById('overlay').classList.remove('show');
  newGame(aiCount, swapRule, jokerRule);
});

document.getElementById('btn-again').addEventListener('click', () => {
  document.getElementById('end-panel').classList.add('hidden');
  document.getElementById('start-panel').classList.remove('hidden');
});
