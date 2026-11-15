/**
 * The twin, end to end: register, then the conversation.
 *
 * One screen rather than several because the whole claim of the product fits in one: it guesses,
 * it says how sure it is, it names a day you can hold it to, and it seals the guess so neither
 * side can move it afterwards. A card feed showed the same data and read as a dashboard.
 *
 * Every word the person reads about themselves comes from the backend -- the questions, the
 * retelling, the twin's own sentences -- because the twin's voice is part of the ledger and a
 * copy of it rephrased in the client would be a second, unsealed version of what it said.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  twinClient,
  type Dilemma,
  type RegistrationForm,
  type Stage,
  type Thread,
  type TwinCreated,
} from "../api/twin";
import "./twin.css";

/** Survives a refresh so a demo does not start over, and so does nothing else. */
const SAVED_TWIN = "loka.twin.id";

/**
 * The proxy attaches the real credential, so nothing secret reaches the browser. twin.ts needs
 * a non-empty token to proceed, and this stands in for one.
 */
const client = twinClient({ getToken: async () => "via-proxy" });

type Phase = "loading" | "register" | "retelling" | "thread" | "broken";

export default function TwinScreen() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [form, setForm] = useState<RegistrationForm | null>(null);
  const [created, setCreated] = useState<TwinCreated | null>(null);
  const [twinId, setTwinId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (id: string) => {
    const next = await client.messages(id);
    setThread(next);
    setPhase("thread");
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(SAVED_TWIN);
    if (saved) {
      setTwinId(saved);
      load(saved).catch(() => {
        // The twin is gone (a wiped database, a different host). Start over rather than
        // sitting on a screen that cannot load.
        localStorage.removeItem(SAVED_TWIN);
        setTwinId(null);
        setPhase("register");
      });
      return;
    }
    client
      .registrationForm()
      .then((f) => {
        setForm(f);
        setPhase("register");
      })
      .catch((e) => {
        setError(String(e?.message || e));
        setPhase("broken");
      });
  }, [load]);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const register = (draft: Parameters<typeof client.create>[0]) =>
    run(async () => {
      const made = await client.create(draft);
      localStorage.setItem(SAVED_TWIN, made.twin_id);
      setTwinId(made.twin_id);
      setCreated(made);
      setPhase("retelling");
    });

  const enter = () =>
    run(async () => {
      if (!twinId) return;
      // Give it a chance to speak first. A twin whose first screen is an empty thread waiting
      // for the person to start has not done anything yet.
      await client.tick(twinId).catch(() => undefined);
      await load(twinId);
    });

  const say = (text: string) =>
    run(async () => {
      if (!twinId) return;
      await client.tell(twinId, text);
      await load(twinId);
    });

  const answer = (askId: string, option: string) =>
    run(async () => {
      if (!twinId) return;
      await client.answerAsk(askId, option);
      await load(twinId);
    });

  const startOver = () => {
    localStorage.removeItem(SAVED_TWIN);
    location.reload();
  };

  if (phase === "loading") return <Shell><p className="muted">正在连接…</p></Shell>;

  if (phase === "broken")
    return (
      <Shell>
        <h1>连不上分身服务</h1>
        <p className="muted">{error}</p>
        <button className="primary" onClick={() => location.reload()}>重试</button>
      </Shell>
    );

  if (phase === "register" && form)
    return <Shell><Register form={form} busy={busy} error={error} onDone={register} /></Shell>;

  if (phase === "retelling" && created)
    return <Shell><Retelling made={created} busy={busy} onEnter={enter} /></Shell>;

  if (phase === "thread" && thread)
    return (
      <Conversation
        thread={thread}
        busy={busy}
        error={error}
        onSay={say}
        onAnswer={answer}
        onTick={enter}
        onReset={startOver}
      />
    );

  return <Shell><p className="muted">正在连接…</p></Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="twin-shell">{children}</main>;
}

function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={`stage stage-${stage.level}`} title={stage.says}>
      {stage.name}
    </span>
  );
}

// ───────────────────────────────── registration ─────────────────────────────────

function Register({
  form,
  busy,
  error,
  onDone,
}: {
  form: RegistrationForm;
  busy: boolean;
  error: string;
  onDone: (draft: Parameters<typeof client.create>[0]) => void;
}) {
  const [step, setStep] = useState(0);
  const [about, setAbout] = useState("");
  const [name, setName] = useState("");
  const [years, setYears] = useState(form.years_bands[2] ?? form.years_bands[0]);
  const [age, setAge] = useState(form.age_bands[1] ?? form.age_bands[0]);
  const [background, setBackground] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState("");
  const [quiet, setQuiet] = useState("");

  const answeredAll = form.dilemmas.every((d) => picks[d.id]);
  const steps = ["你是谁", "怎么做事", "手头的事", "什么时候别打扰"];

  function submit() {
    onDone({
      display_name: name.trim() || "我",
      about: about.trim(),
      years_in_field: years,
      age_band: age,
      background: background.trim(),
      dilemmas: picks,
      current_thing: current.trim(),
      quiet_text: quiet.trim(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }

  return (
    <>
      <ol className="steps" aria-label="注册进度">
        {steps.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : ""}>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section>
          <h1>{form.copy.about}</h1>
          <p className="muted">{form.copy.about_hint}</p>
          <div className="chips">
            {form.field_suggestions.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => setAbout(about ? `${about}，${s}` : s)}>
                {s}
              </button>
            ))}
          </div>
          <textarea
            rows={3}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            placeholder="做审计的，自己也炒币，最近仓位跌得厉害"
          />
          <label>怎么称呼你</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="阿哲" />
          <div className="row">
            <div>
              <label>干了多久</label>
              <select value={years} onChange={(e) => setYears(e.target.value)}>
                {form.years_bands.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label>年龄段</label>
              <select value={age} onChange={(e) => setAge(e.target.value)}>
                {form.age_bands.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <label>还有什么它该知道的</label>
          <textarea
            rows={2}
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            placeholder="大所出来的，习惯先查账再下结论"
          />
          <button className="primary" disabled={!about.trim()} onClick={() => setStep(1)}>
            下一步
          </button>
        </section>
      )}

      {step === 1 && (
        <section>
          <h1>{form.copy.dilemmas}</h1>
          {form.dilemmas.map((d: Dilemma) => (
            <article key={d.id} className="dilemma">
              <p>{d.text}</p>
              <div className="pair">
                {d.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={picks[d.id] === o.id ? "pick on" : "pick"}
                    onClick={() => setPicks({ ...picks, [d.id]: o.id })}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </article>
          ))}
          <div className="row">
            <button className="quiet" onClick={() => setStep(0)}>上一步</button>
            <button className="primary" disabled={!answeredAll} onClick={() => setStep(2)}>下一步</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section>
          <h1>{form.copy.current_thing}</h1>
          <p className="muted">{form.copy.current_thing_hint}</p>
          <textarea
            rows={3}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="仓位又跌了 5 个点，在犹豫要不要补仓"
          />
          <div className="row">
            <button className="quiet" onClick={() => setStep(1)}>上一步</button>
            <button className="primary" onClick={() => setStep(3)}>下一步</button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section>
          <h1>{form.copy.quiet}</h1>
          <p className="muted">{form.copy.quiet_hint}</p>
          <textarea
            rows={2}
            value={quiet}
            onChange={(e) => setQuiet(e.target.value)}
            placeholder={form.copy.quiet_placeholder}
          />
          <div className="row">
            <button className="quiet" onClick={() => setStep(2)}>上一步</button>
            <button className="primary" disabled={busy} onClick={submit}>
              {busy ? "正在生成…" : "生成我的分身"}
            </button>
          </div>
        </section>
      )}

      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}

// ───────────────────────────── what it heard back ─────────────────────────────

function Retelling({ made, busy, onEnter }: { made: TwinCreated; busy: boolean; onEnter: () => void }) {
  return (
    <section className="retelling">
      <small>分身已生成 <StageBadge stage={made.stage} /></small>
      <h1>我听成这样。</h1>
      <p className="heard">{made.retelling.heard}</p>

      <h2>我听出你心里有这几个声音</h2>
      <ul className="roles">
        {made.retelling.roles.map((r) => (
          <li key={r.id}>
            <b>{r.label}</b>
            <span>{r.loud_when}</span>
          </li>
        ))}
      </ul>

      <article className="quiet-card">
        <h3>什么时候不打扰你</h3>
        <p>{made.quiet_understood}</p>
      </article>

      <p className="promise">{made.retelling.promise}</p>

      <article className="identity">
        <h3>它的身份</h3>
        <p className="address">{made.identity.npub}</p>
        <p className="address">{made.identity.eth_address}</p>
      </article>

      <button className="primary" disabled={busy} onClick={onEnter}>
        {busy ? "它正在想…" : "开始"}
      </button>
    </section>
  );
}

// ──────────────────────────────── the conversation ────────────────────────────────

function Conversation({
  thread,
  busy,
  error,
  onSay,
  onAnswer,
  onTick,
  onReset,
}: {
  thread: Thread;
  busy: boolean;
  error: string;
  onSay: (text: string) => void;
  onAnswer: (askId: string, option: string) => void;
  onTick: () => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.messages.length]);

  return (
    <main className="twin-chat">
      <header>
        <div>
          <b>我的分身</b>
          <StageBadge stage={thread.stage} />
        </div>
        <button className="quiet small" onClick={onReset}>重来</button>
      </header>

      <p className="says">{thread.stage.says}</p>
      {/* It reached a view during the hours you told it not to interrupt, and kept it. Showing
          the conclusion here is the point: the restriction delayed it, it did not delete it. */}
      {thread.while_you_were_away && (
        <article className="away">
          <p className="lead">{thread.while_you_were_away.lead}</p>
          <p className="conclusion">{thread.while_you_were_away.conclusion}</p>
        </article>
      )}

      <div className="thread">
        {thread.messages.map((m, i) => {
          if (m.kind === "said_by_user")
            return <div key={i} className="bubble mine">{m.text}</div>;

          if (m.kind === "asked_by_twin")
            return (
              <div key={i} className="bubble theirs ask">
                <p className="q">{m.text}</p>
                <small>{m.why}</small>
                {m.answer ? (
                  <p className="answered">你答了：{m.answer}</p>
                ) : (
                  <div className="options">
                    {m.options.map((o) => (
                      <button key={o} disabled={busy} onClick={() => onAnswer(m.ask_id, o)}>
                        {o}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );

          return (
            <div key={i} className="bubble theirs">
              <p>{m.text}</p>
              {/* The sentence already says how sure it is and by when, in its own words, and
                  rounds the stake to tenths while the ledger seals the exact figure -- so
                  repeating either here put two numbers for one fact on the screen. What is
                  left is what the sentence cannot carry: whether it has been marked yet, and
                  the seal that stops anyone moving it afterwards. */}
              <footer>
                {m.confidence_state === "provisional" && <span>把握还没校准</span>}
                {m.settlement ? (
                  <span className={m.settlement.correct ? "right" : "wrong"}>
                    {m.settlement.correct ? "说对了" : "说错了"}
                  </span>
                ) : (
                  <span className="pending">还没到期</span>
                )}
                <code title={`封存哈希 ${m.seal_hash}`}>🔒 {m.seal_hash.slice(0, 8)}</code>
              </footer>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {/* The silence is part of the record: a twin graded only on what it said would learn
          that staying quiet is never wrong. */}
      {thread.held_today > 0 && (
        <p className="held">今天它忍住没说 {thread.held_today} 条</p>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          const text = draft.trim();
          if (!text || busy) return;
          setDraft("");
          onSay(text);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="跟它说点什么"
          disabled={busy}
        />
        <button className="primary" disabled={busy || !draft.trim()}>
          {busy ? "…" : "发送"}
        </button>
      </form>
      <button className="quiet small full" disabled={busy} onClick={onTick}>
        让它自己看一眼
      </button>
    </main>
  );
}
