(() => {
  "use strict";

  // The handbook doesn't state the exam format, so check these against the official BTT booking
  // page and change them here if they differ.
  // mockOptions: the real BTT shows 3 choices (A/B/C) per question; practice shows all 4 for extra drilling.
  const CFG = { mockCount: 50, passMark: 45, mockMinutes: 30, quickCount: 20, mockOptions: 3 };
  const KEY = "btt-quiz-v1";
  const LETTERS = ["A", "B", "C", "D"];

  const app = document.getElementById("app");

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const shuffle = (list) => {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const hash = (s) => {
    let h = 5381;
    for (const c of s) h = ((h * 33) ^ c.codePointAt(0)) >>> 0;
    return h.toString(36);
  };

  // Ids are derived from the content so progress survives reordering the question list.
  const BANK = QUESTIONS.map((q) => ({ ...q, id: `${q.t}-${hash(q.q + "|" + q.o[0])}` }));
  const BY_ID = new Map(BANK.map((q) => [q.id, q]));
  const CORRECT = 0; // the first option in the data is always the right one

  // ------------------------------------------------------------------ storage
  const store = {
    d: { missed: [], mocks: [] },
    load() {
      try {
        const d = JSON.parse(localStorage.getItem(KEY) || "null");
        if (d) {
          this.d.missed = (d.missed || []).filter((id) => BY_ID.has(id));
          this.d.mocks = d.mocks || [];
        }
      } catch (_) {
        /* private mode or corrupt data: start fresh */
      }
    },
    save() {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.d));
      } catch (_) {
        /* ignore */
      }
    },
    record(q, ok) {
      const i = this.d.missed.indexOf(q.id);
      if (ok && i >= 0) this.d.missed.splice(i, 1);
      if (!ok && i < 0) this.d.missed.push(q.id);
    },
  };

  // ------------------------------------------------------------------ session
  let S = null; // current session
  let last = null; // what "Try again" should restart
  let timer = null;

  const isMock = () => S.mode === "mock";
  const passFor = (n) => (n === CFG.mockCount ? CFG.passMark : Math.ceil((n * CFG.passMark) / CFG.mockCount));
  const fmt = (ms) => {
    const s = Math.ceil(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  const stopTimer = () => {
    clearInterval(timer);
    timer = null;
  };

  // Option indexes in display order. In exam mode keep the correct answer plus random wrong ones.
  function pickOptions(q, examStyle) {
    const wrong = shuffle(q.o.map((_, k) => k).filter((k) => k !== CORRECT));
    const keep = examStyle ? wrong.slice(0, CFG.mockOptions - 1) : wrong;
    return shuffle([CORRECT, ...keep]);
  }

  function begin(mode, topic = "all") {
    stopTimer();
    let pool, label;
    if (mode === "mock") {
      pool = shuffle(BANK).slice(0, CFG.mockCount);
      label = "Mock test";
    } else if (mode === "review") {
      pool = shuffle(store.d.missed.map((id) => BY_ID.get(id)));
      label = "Review mistakes";
    } else if (topic === "pictures") {
      pool = shuffle(BANK.filter((q) => q.p));
      label = "Picture questions";
    } else if (topic === "all") {
      pool = shuffle(BANK).slice(0, CFG.quickCount);
      label = `Quick practice (${CFG.quickCount})`;
    } else {
      pool = shuffle(BANK.filter((q) => q.t === topic));
      label = TOPICS[topic];
    }
    if (!pool.length) return home();

    last = { mode, topic };
    S = {
      mode,
      label,
      i: 0,
      done: false,
      startedAt: Date.now(),
      endAt: mode === "mock" ? Date.now() + CFG.mockMinutes * 60000 : 0,
      items: pool.map((q) => ({ q, order: pickOptions(q, mode === "mock"), pick: null })),
    };
    if (S.endAt) timer = setInterval(tick, 500);
    renderQuiz("#qtext");
    window.scrollTo(0, 0);
  }

  function tick() {
    if (!S || S.done) return stopTimer();
    const left = Math.max(0, S.endAt - Date.now());
    const el = document.getElementById("timer");
    if (el) {
      el.textContent = fmt(left);
      el.classList.toggle("warn", left < 60000);
    }
    if (left === 0) finish();
  }

  function choose(p) {
    const it = S.items[S.i];
    if (p >= it.order.length) return;
    if (!isMock() && it.pick !== null) return; // practice answers are final
    it.pick = it.order[p];
    if (!isMock()) {
      store.record(it.q, it.pick === CORRECT);
      store.save();
    }
    renderQuiz(isMock() ? `[data-p="${p}"]` : "#fb");
  }

  function go(i) {
    if (i < 0 || i >= S.items.length) return;
    S.i = i;
    renderQuiz("#qtext");
    window.scrollTo(0, 0);
  }

  function next() {
    if (!isMock() && S.items[S.i].pick === null) return;
    if (S.i === S.items.length - 1) return finish(true);
    go(S.i + 1);
  }

  function finish(confirmFirst) {
    if (!S || S.done) return;
    const unanswered = S.items.filter((it) => it.pick === null).length;
    if (confirmFirst && unanswered && !confirm(`${unanswered} question(s) unanswered. Submit anyway?`)) return;
    stopTimer();
    S.done = true;
    S.finishedAt = Date.now();
    const score = S.items.filter((it) => it.pick === CORRECT).length;
    S.score = score;
    if (isMock()) {
      S.items.forEach((it) => it.pick !== null && store.record(it.q, it.pick === CORRECT));
      store.d.mocks.push({ ts: Date.now(), score, total: S.items.length, pass: score >= passFor(S.items.length) });
      store.d.mocks = store.d.mocks.slice(-20);
    }
    store.save();
    renderResult();
    window.scrollTo(0, 0);
  }

  function quit() {
    if (S && !S.done && S.items.some((it) => it.pick !== null) && !confirm("Leave this quiz? Your progress in it will be lost.")) return;
    home();
  }

  // -------------------------------------------------------------------- views
  function view(html, focusSel) {
    app.innerHTML = html;
    const el = focusSel && app.querySelector(focusSel);
    if (el) el.focus({ preventScroll: true });
  }

  function home() {
    stopTimer();
    S = null;
    const counts = {};
    BANK.forEach((q) => (counts[q.t] = (counts[q.t] || 0) + 1));
    const pics = BANK.filter((q) => q.p).length;
    const notes = BANK.filter((q) => q.n).length;
    const missed = store.d.missed.length;
    const mocks = store.d.mocks;
    const best = mocks.length ? Math.max(...mocks.map((m) => m.score)) : null;
    const passed = mocks.filter((m) => m.pass).length;

    const topicButtons = Object.keys(TOPICS)
      .map(
        (t) =>
          `<button class="topic" data-act="topic" data-topic="${t}"><b>${esc(TOPICS[t])}</b><small>${counts[t] || 0} questions</small></button>`
      )
      .join("");
    const recent = mocks
      .slice(-5)
      .reverse()
      .map((m) => `<li class="${m.pass ? "p" : "f"}">${m.score}/${m.total} <span>${m.pass ? "pass" : "fail"}</span></li>`)
      .join("");

    view(`
      <section class="hero">
        <h1>Ready for your Basic Theory Test?</h1>
        <p>Multiple-choice practice built from the Traffic Police's <i>Basic Theory of Driving</i> handbook, with pictures for signs, lights and road markings, and a warning for every trap people fall into.</p>
      </section>

      <section class="card">
        <h2>Mock test</h2>
        <p>${CFG.mockCount} random questions with ${CFG.mockOptions} choices each (like the real test), ${CFG.mockMinutes} minutes, no hints until the end. Pass mark: ${CFG.passMark}/${CFG.mockCount}.</p>
        <button class="btn primary" data-act="mock">Start mock test</button>
      </section>

      <section class="card">
        <h2>Practice</h2>
        <p>You get the answer, the explanation and the common-mistake warning straight after each question.</p>
        <div class="row">
          <button class="btn primary" data-act="topic" data-topic="all">Quick ${CFG.quickCount} (mixed)</button>
          <button class="btn" data-act="topic" data-topic="pictures">Picture questions (${pics})</button>
          <button class="btn" data-act="review" ${missed ? "" : "disabled"}>Review mistakes (${missed})</button>
        </div>
        <h3>By topic</h3>
        <div class="topics">${topicButtons}</div>
      </section>

      <section class="card">
        <h2>Tricky points</h2>
        <p>${notes} traps people commonly fall for (3-second vs 2-second, 6 m vs 9 m vs 3 m, 13 vs 24 points ...) on one page.</p>
        <button class="btn" data-act="notes">Open cheat sheet</button>
      </section>

      <section class="card stats">
        <h2>Your progress</h2>
        ${
          mocks.length
            ? `<p>${mocks.length} mock test${mocks.length > 1 ? "s" : ""} taken · best ${best}/${mocks[mocks.length - 1].total} · ${passed} passed</p><ul class="recent">${recent}</ul>`
            : "<p>No mock tests yet. Your results are saved on this device only.</p>"
        }
        ${mocks.length || missed ? `<button class="link" data-act="reset">Reset my progress</button>` : ""}
      </section>`);
  }

  function renderQuiz(focus) {
    const it = S.items[S.i];
    const q = it.q;
    const n = S.items.length;
    const mock = isMock();
    const locked = !mock && it.pick !== null;
    const ok = it.pick === CORRECT;

    const opts = it.order
      .map((orig, p) => {
        const picked = it.pick === orig;
        let cls = "opt";
        let mark = "";
        let sr = "";
        if (locked) {
          if (orig === CORRECT) {
            cls += " correct";
            mark = "✓";
            sr = "Correct answer. ";
          } else if (picked) {
            cls += " wrong";
            mark = "✗";
            sr = "Your answer, incorrect. ";
          }
        } else if (picked) cls += " sel";
        return `<button class="${cls}" data-act="pick" data-p="${p}" ${mock ? `aria-pressed="${picked}"` : ""} ${locked ? 'aria-disabled="true"' : ""}>
          <span class="key" aria-hidden="true">${LETTERS[p]}</span><span class="txt"><span class="sr">${sr}</span>${esc(q.o[orig])}</span><span class="mark" aria-hidden="true">${mark}</span></button>`;
      })
      .join("");

    const feedback = locked
      ? `<div id="fb" class="feedback ${ok ? "ok" : "bad"}" tabindex="-1">
          <strong>${ok ? "Correct!" : "Not quite."}</strong> ${esc(q.e)}
          ${q.n ? `<p class="note"><b>⚠ Common mistake:</b> ${esc(q.n)}</p>` : ""}
        </div>`
      : "";

    const isLast = S.i === n - 1;
    let nav;
    if (mock) {
      const grid = S.items
        .map(
          (x, i) =>
            `<button class="qn${x.pick !== null ? " done" : ""}${i === S.i ? " cur" : ""}" data-act="go" data-i="${i}" aria-label="Question ${i + 1}${x.pick !== null ? ", answered" : ""}">${i + 1}</button>`
        )
        .join("");
      nav = `<div class="nav">
          <button class="btn" data-act="prev" ${S.i === 0 ? "disabled" : ""}>← Previous</button>
          ${isLast ? `<button class="btn primary" data-act="finish">Finish test</button>` : `<button class="btn primary" data-act="next">Next →</button>`}
        </div>
        <div class="grid" aria-label="Question navigator">${grid}</div>
        ${isLast ? "" : `<button class="link" data-act="finish">Finish test now</button>`}`;
    } else {
      nav = `<div class="nav"><span></span><button class="btn primary" data-act="next" ${locked ? "" : "disabled"}>${isLast ? "See results" : "Next →"}</button></div>`;
    }

    view(
      `<section class="quiz">
        <div class="bar">
          <button class="link" data-act="quit">← Quit</button>
          <span class="meta">${esc(S.label)}</span>
          ${mock ? `<span id="timer" class="timer" role="timer">${fmt(Math.max(0, S.endAt - Date.now()))}</span>` : "<span></span>"}
        </div>
        <div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${S.i + 1}"><span style="width:${((S.i + 1) / n) * 100}%"></span></div>
        <p class="count">Question ${S.i + 1} of ${n} · ${esc(TOPICS[q.t])}</p>
        <h2 id="qtext" tabindex="-1">${esc(q.q)}</h2>
        ${q.p ? `<div class="pic">${PICS[q.p]}</div>` : ""}
        <div class="opts" role="group" aria-labelledby="qtext">${opts}</div>
        ${feedback}
        ${nav}
      </section>`,
      focus
    );
  }

  function renderResult() {
    const n = S.items.length;
    const mock = isMock();
    const pass = mock && S.score >= passFor(n);
    const pct = Math.round((S.score / n) * 100);
    const secs = Math.round((S.finishedAt - S.startedAt) / 1000);

    const byTopic = {};
    S.items.forEach((it) => {
      const b = (byTopic[it.q.t] = byTopic[it.q.t] || { right: 0, total: 0 });
      b.total++;
      if (it.pick === CORRECT) b.right++;
    });
    const topicRows = Object.keys(byTopic)
      .map((t) => {
        const b = byTopic[t];
        return `<li><span>${esc(TOPICS[t])}</span><span class="tbar"><i style="width:${(b.right / b.total) * 100}%"></i></span><b>${b.right}/${b.total}</b></li>`;
      })
      .join("");

    const wrong = S.items.filter((it) => it.pick !== CORRECT);
    const wrongCards = wrong
      .map(
        (it) => `<article class="rev">
          <p class="count">${esc(TOPICS[it.q.t])}</p>
          <h3>${esc(it.q.q)}</h3>
          ${it.q.p ? `<div class="pic small">${PICS[it.q.p]}</div>` : ""}
          <p class="yours">${it.pick === null ? "Not answered" : `Your answer: ${esc(it.q.o[it.pick])}`}</p>
          <p class="right">Correct: ${esc(it.q.o[CORRECT])}</p>
          <p>${esc(it.q.e)}</p>
          ${it.q.n ? `<p class="note"><b>⚠ Common mistake:</b> ${esc(it.q.n)}</p>` : ""}
        </article>`
      )
      .join("");

    view(
      `<section class="result">
        <h2 id="rtitle" tabindex="-1">${mock ? (pass ? "You passed! 🎉" : "Not this time") : "Practice complete"}</h2>
        <p class="score ${mock ? (pass ? "p" : "f") : ""}">${S.score}<small>/${n}</small></p>
        <p>${pct}%${mock ? ` · pass mark ${passFor(n)}/${n}` : ""} · ${Math.floor(secs / 60)}m ${secs % 60}s</p>
        <ul class="topicrows">${topicRows}</ul>
        <div class="row">
          <button class="btn primary" data-act="retry">Try again</button>
          ${store.d.missed.length ? `<button class="btn" data-act="review">Review mistakes (${store.d.missed.length})</button>` : ""}
          <button class="btn" data-act="home">Home</button>
        </div>
        ${wrong.length ? `<h3>What to revisit (${wrong.length})</h3>${wrongCards}` : "<p>Perfect score. Nothing to revisit.</p>"}
      </section>`,
      "#rtitle"
    );
  }

  function renderNotes() {
    const groups = Object.keys(TOPICS)
      .map((t) => {
        const items = BANK.filter((q) => q.t === t && q.n);
        if (!items.length) return "";
        return `<section class="card"><h2>${esc(TOPICS[t])}</h2>${items
          .map(
            (q) => `<article class="rev">
              <h3>${esc(q.q)}</h3>
              ${q.p ? `<div class="pic small">${PICS[q.p]}</div>` : ""}
              <p class="right">${esc(q.o[CORRECT])}</p>
              <p class="note"><b>⚠</b> ${esc(q.n)}</p>
            </article>`
          )
          .join("")}</section>`;
      })
      .join("");
    view(
      `<div class="bar"><button class="link" data-act="home">← Home</button><span class="meta">Tricky points</span><span></span></div>
       <h1 id="ntitle" tabindex="-1">Tricky points</h1>
       <p>Mistakes people often make, drawn from the questions in this quiz. Verify against the latest handbook.</p>${groups}`,
      "#ntitle"
    );
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------------- events
  app.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || el.disabled) return;
    switch (el.dataset.act) {
      case "mock": begin("mock"); break;
      case "topic": begin("practice", el.dataset.topic); break;
      case "review": begin("review"); break;
      case "notes": renderNotes(); break;
      case "home": home(); window.scrollTo(0, 0); break;
      case "quit": quit(); break;
      case "pick": choose(+el.dataset.p); break;
      case "next": next(); break;
      case "prev": go(S.i - 1); break;
      case "go": go(+el.dataset.i); break;
      case "finish": finish(true); break;
      case "retry": begin(last.mode, last.topic); break;
      case "reset":
        if (confirm("Reset your saved mock results and mistakes list?")) {
          store.d = { missed: [], mocks: [] };
          store.save();
          home();
        }
        break;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!S || S.done || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key >= "1" && e.key <= "4") choose(+e.key - 1);
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft" && isMock()) go(S.i - 1);
    else if (e.key === "Enter" && !/^(BUTTON|A|SUMMARY)$/.test(document.activeElement.tagName)) next();
  });

  store.load();
  home();
})();
