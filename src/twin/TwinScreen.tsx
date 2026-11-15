/**
 * The twin, end to end: register, then the conversation.
 *
 * Three regions, following the prototype. The rail holds the voices this person argues with —
 * the roles the twin read out of what they wrote — and lights the one that won the last
 * judgment, which is the only place the ontology is visible at all and the only answer on
 * screen to "why did it say that". The stage carries the orb, what the twin is doing, and the
 * thread. The dock opens onto the record: settled counts, calibration, and what it held back.
 *
 * Every word the person reads about themselves comes from the backend — the questions, the
 * retelling, the twin's own sentences — because the twin's voice is part of the ledger, and a
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
  type TwinRecord,
  type Role,
} from "../api/twin";
import Orb, { type OrbMode } from "./Orb";
import "./twin.css";

/** Survives a refresh so a demo does not start over, and so does nothing else. */
const SAVED_TWIN = "loka.twin.id";

/** The proxy attaches the real credential, so nothing secret reaches the browser. */
const client = twinClient({ getToken: async () => "via-proxy" });

type Phase = "loading" | "register" | "retelling" | "thread" | "broken";

export default function TwinScreen() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [form, setForm] = useState<RegistrationForm | null>(null);
  const [created, setCreated] = useState<TwinCreated | null>(null);
  const [twinId, setTwinId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [record, setRecord] = useState<TwinRecord | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [tab, setTab] = useState<"thread" | "record">("thread");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<OrbMode>("listen");

  const load = useCallback(async (id: string) => {
    const [next, onto] = await Promise.all([
      client.messages(id),
      client.ontology(id).catch(() => null),
    ]);
    setThread(next);
    if (onto) setRoles(onto.roles);
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

  async function run(work: () => Promise<void>, working: OrbMode = "think") {
    if (busy) return;
    setBusy(true);
    setMode(working);
    setError("");
    try {
      await work();
      setMode("speak");
      setTimeout(() => setMode("listen"), 2400);
    } catch (e) {
      setError(String((e as Error)?.message || e));
      setMode("listen");
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
      setRoles(made.retelling.roles);
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

  const openDock = (which: "thread" | "record") => {
    setTab(which);
    setDockOpen(true);
    if (which === "record" && twinId)
      client.record(twinId).then(setRecord).catch(() => undefined);
  };
  const toggleDock = () => {
    if (dockOpen) return setDockOpen(false);
    openDock(tab);
  };

  const startOver = () => {
    localStorage.removeItem(SAVED_TWIN);
    location.reload();
  };

  const bare = phase !== "thread";
  const stage = thread?.stage ?? created?.stage ?? null;

  return (
    <div className="twin-root">
      <div className={`win${bare ? " bare" : ""}${dockOpen ? " dock-open" : ""}`}>
        <header className="bar">
          <div className="bar-left">
            <div className="logo" title="Loka">
              <i />
            </div>
            <span className="bar-name">
              {phase === "thread" ? "我的分身" : "正在认识你"}
            </span>
          </div>
          <div className="wbtns">
            {phase === "thread" && (
              <>
                <button
                  className={`wb${dockOpen ? " on" : ""}`}
                  title="工作台"
                  aria-label="工作台"
                  onClick={toggleDock}
                >
                  <Icon name="record" />
                </button>
                <button className="wb" title="重来" aria-label="重来" onClick={startOver}>
                  <Icon name="reset" />
                </button>
              </>
            )}
          </div>
        </header>

        {!bare && (
          <Rail roles={roles} wonId={wonRole(thread, roles)} />
        )}

        <main className="stage">
          <Orb className="orb" mode={mode} />

          <div className="col">
            {phase === "loading" && <Status title="正在连接" sub="" stage={null} />}

            {phase === "broken" && (
              <>
                <Status title="连不上" sub={error} stage={null} />
                <div className="actions">
                  <button className="primary" onClick={() => location.reload()}>
                    重试
                  </button>
                </div>
              </>
            )}

            {phase === "register" && form && (
              <Register form={form} busy={busy} error={error} onDone={register} />
            )}

            {phase === "retelling" && created && (
              <Retelling made={created} busy={busy} onEnter={enter} />
            )}

            {phase === "thread" && thread && (
              <Conversation
                thread={thread}
                stage={stage}
                busy={busy}
                mode={mode}
                error={error}
                onSay={say}
                onAnswer={answer}
                onTick={enter}
                onOpenThread={() => openDock("thread")}
              />
            )}
          </div>
        </main>

        <section className="dock" aria-label="工作台">
          <Dock
            tab={tab}
            setTab={(t) => {
              setTab(t);
              if (t === "record" && twinId)
                client.record(twinId).then(setRecord).catch(() => undefined);
            }}
            thread={thread}
            record={record}
            busy={busy}
            onAnswer={answer}
            onClose={() => setDockOpen(false)}
          />
        </section>
      </div>
    </div>
  );
}

/** Which voice won the last thing the twin said, by matching its conclusion against stances. */
function wonRole(thread: Thread | null, roles: Role[]): string | null {
  const spoken = [...(thread?.messages ?? [])]
    .reverse()
    .find((m) => m.kind === "said_by_twin");
  if (!spoken || spoken.kind !== "said_by_twin") return null;
  const said = spoken.text;
  const hit = roles.find((r) => r.stance && said.includes(r.stance));
  return hit?.id ?? null;
}

const PALETTE = ["#6fe3bd", "#9cc0ff", "#b9a6ff", "#f2c94c", "#f58aa0", "#7ad7f0"];
const faceColour = (i: number) => PALETTE[i % PALETTE.length];

function Icon({ name }: { name: "record" | "reset" | "send" | "mic" | "close" }) {
  const paths: Record<string, React.ReactNode> = {
    record: <path d="M3 13l3-4 3 3 4-7" />,
    reset: <path d="M3 8a5 5 0 1 1 1.6 3.7M3 5v3h3" />,
    close: <path d="m5 5 6 6M11 5l-6 6" />,
    send: <path d="M2.5 8L13.5 3 10 13.5 7.5 8.5z" />,
    mic: (
      <>
        <rect x="6" y="2.5" width="4" height="7" rx="2" />
        <path d="M3.8 7.6a4.2 4.2 0 0 0 8.4 0M8 11.8v1.7" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

// ──────────────────────────────── rail: the voices ────────────────────────────────

function Rail({ roles, wonId }: { roles: Role[]; wonId: string | null }) {
  return (
    <aside className="rail" aria-label="你心里的声音">
      <h4>声音</h4>
      <span className="bp">{roles.length} 个</span>
      <div className="voices">
        {roles.map((r, i) => (
          <button
            key={r.id}
            className={`voice${r.id === wonId ? " won" : ""}`}
            title={`${r.label}${r.loud_when ? `\n什么时候最大声：${r.loud_when}` : ""}`}
          >
            <span className="face" style={{ background: faceColour(i) }}>
              {r.label.slice(0, 1)}
            </span>
            <span className="nm">{r.label.slice(0, 5)}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Status({
  title,
  sub,
  stage,
}: {
  title: string;
  sub: string;
  stage: Stage | null;
}) {
  return (
    <div className="status">
      <h1>{title}</h1>
      <p>{sub}</p>
      {stage && (
        <span className={`stage-badge${stage.can_assert ? " grown" : ""}`} title={stage.says}>
          {stage.name}
        </span>
      )}
    </div>
  );
}

// ───────────────────────────────── registration ─────────────────────────────────

const STEPS = ["你是谁", "怎么做事", "手头的事", "什么时候别打扰"];

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
  const titles = [form.copy.about, form.copy.dilemmas, form.copy.current_thing, form.copy.quiet];
  const subs = [form.copy.about_hint, "", form.copy.current_thing_hint, form.copy.quiet_hint];

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
      <Status title={titles[step]} sub={subs[step]} stage={null} />
      <ol className="steps" aria-label="注册进度">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined}
              className={i < step ? "done" : ""}>
            {label}
          </li>
        ))}
      </ol>

      <div className="form">
        {step === 0 && (
          <>
            <div className="chips">
              {form.field_suggestions.map((s) => (
                <button key={s} type="button" className="chip"
                        onClick={() => setAbout(about ? `${about}，${s}` : s)}>
                  {s}
                </button>
              ))}
            </div>
            <textarea className="field" rows={3} value={about}
                      onChange={(e) => setAbout(e.target.value)}
                      placeholder="做审计的，自己也炒币，最近仓位跌得厉害" />
            <label>怎么称呼你</label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24}
                   placeholder="阿哲" />
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
            <textarea className="field" rows={2} value={background}
                      onChange={(e) => setBackground(e.target.value)}
                      placeholder="大所出来的，习惯先查账再下结论" />
          </>
        )}

        {step === 1 &&
          form.dilemmas.map((d: Dilemma) => (
            <article key={d.id} className="dilemma">
              <p>{d.text}</p>
              <div className="pair">
                {d.options.map((o) => (
                  <button key={o.id} type="button"
                          className={picks[d.id] === o.id ? "pick on" : "pick"}
                          onClick={() => setPicks({ ...picks, [d.id]: o.id })}>
                    {o.label}
                  </button>
                ))}
              </div>
            </article>
          ))}

        {step === 2 && (
          <textarea className="field" rows={3} value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    placeholder="仓位又跌了 5 个点，在犹豫要不要补仓" />
        )}

        {step === 3 && (
          <textarea className="field" rows={2} value={quiet}
                    onChange={(e) => setQuiet(e.target.value)}
                    placeholder={form.copy.quiet_placeholder} />
        )}
      </div>

      {error && <p className="err" role="alert">{error}</p>}

      <div className="actions">
        {step > 0 && (
          <button className="ghost" onClick={() => setStep(step - 1)}>上一步</button>
        )}
        {step < 3 ? (
          <button className="primary"
                  disabled={(step === 0 && !about.trim()) || (step === 1 && !answeredAll)}
                  onClick={() => setStep(step + 1)}>
            下一步
          </button>
        ) : (
          <button className="primary" disabled={busy} onClick={submit}>
            {busy ? "正在读你写的东西…" : "生成我的分身"}
          </button>
        )}
      </div>
    </>
  );
}

// ───────────────────────────── what it heard back ─────────────────────────────

function Retelling({
  made,
  busy,
  onEnter,
}: {
  made: TwinCreated;
  busy: boolean;
  onEnter: () => void;
}) {
  return (
    <>
      <Status title="我听成这样" sub="读错了就直接跟它说" stage={made.stage} />
      <div className="retelling">
        <p className="heard">{made.retelling.heard}</p>

        <p className="sub">我听出你心里有这几个声音</p>
        <ul className="roles">
          {made.retelling.roles.map((r, i) => (
            <li key={r.id}>
              <span className="face" style={{ background: faceColour(i) }}>
                {r.label.slice(0, 1)}
              </span>
              <span>
                <b>{r.label}</b>
                <span>{r.loud_when}</span>
              </span>
            </li>
          ))}
        </ul>

        <article className="note">
          <h3>什么时候不打扰你</h3>
          {made.quiet_understood}
        </article>
        <article className="note">
          <h3>它的身份</h3>
          <p className="addr">{made.identity.npub}</p>
          <p className="addr">{made.identity.eth_address}</p>
        </article>
        <p className="sub">{made.retelling.promise}</p>
      </div>
      <div className="actions">
        <button className="primary" disabled={busy} onClick={onEnter}>
          {busy ? "它正在想…" : "开始"}
        </button>
      </div>
    </>
  );
}

// ──────────────────────────────── the current turn ────────────────────────────────

const SAYING: Record<OrbMode, [string, string]> = {
  listen: ["我在听", "说点什么，它会先判断再开口"],
  think: ["正在判断", "它在想该不该说、有多大把握"],
  speak: ["正在说", "说出口的每一句都会被封存"],
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

/**
 * The stage carries one turn: what was just said, and what the twin said back. The thread is
 * in the dock, because a scrolling log in front of the orb turns the screen into a transcript
 * with an ornament on top — the orb is there to say what is happening right now, and that only
 * works if it has the room to.
 *
 * The exception is an open question. That is the one thing on screen waiting on the person, so
 * it takes the twin's half of the stage until it is answered.
 */
function Conversation({
  thread,
  stage,
  busy,
  mode,
  error,
  onSay,
  onAnswer,
  onTick,
  onOpenThread,
}: {
  thread: Thread;
  stage: Stage | null;
  busy: boolean;
  mode: OrbMode;
  error: string;
  onSay: (text: string) => void;
  onAnswer: (askId: string, option: string) => void;
  onTick: () => void;
  onOpenThread: () => void;
}) {
  const [draft, setDraft] = useState("");

  const asking = [...thread.messages]
    .reverse()
    .find((m) => m.kind === "asked_by_twin" && !m.answer);
  const lastUser = [...thread.messages].reverse().find((m) => m.kind === "said_by_user");
  const lastTwin = [...thread.messages]
    .reverse()
    .find((m) => m.kind === "said_by_twin" || m.kind === "replied_by_twin");

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSay(text);
  };

  return (
    <>
      <Status title={SAYING[mode][0]} sub={SAYING[mode][1]} stage={stage} />

      {/* It reached a view during the hours you told it not to interrupt, and kept it. Showing
          the conclusion is the point: the restriction delayed it, it did not delete it. */}
      {thread.while_you_were_away && (
        <article className="away">
          <p className="lead">{thread.while_you_were_away.lead}</p>
          <p className="conclusion">{thread.while_you_were_away.conclusion}</p>
        </article>
      )}

      <div className="turn">
      {asking && asking.kind === "asked_by_twin" ? (
        <div className="asking">
          <p className="q">{asking.text}</p>
          <small>{asking.why}</small>
          <div className="options">
            {asking.options.map((o) => (
              <button key={o} disabled={busy} onClick={() => onAnswer(asking.ask_id, o)}>
                {o}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="cards">
          <article className={`card${lastUser ? "" : " empty-card"}`}>
            <div className="h">
              <span>你</span>
              {lastUser && <time>{clock(lastUser.at)}</time>}
            </div>
            <div className="t">{lastUser?.text ?? "还没说什么"}</div>
          </article>
          <article className={`card${lastTwin ? "" : " empty-card"}`}>
            <div className="h">
              <span>它</span>
              {lastTwin && <time>{clock(lastTwin.at)}</time>}
            </div>
            <div className="t">{lastTwin?.text ?? "等你开口"}</div>
            {lastTwin?.kind === "said_by_twin" && (
              <div className="seal">
                {lastTwin.settlement ? (
                  <span className={lastTwin.settlement.correct ? "right" : "wrong"}>
                    {lastTwin.settlement.correct ? "说对了" : "说错了"}
                  </span>
                ) : (
                  <span>还没到期</span>
                )}
                <span title={`封存哈希 ${lastTwin.seal_hash}`}>
                  🔒 {lastTwin.seal_hash.slice(0, 8)}
                </span>
              </div>
            )}
          </article>
        </div>
      )}
      </div>

      <div className="ready">
        <span className="lead">
          {/* The silence is part of the record: a twin graded only on what it said would
              learn that staying quiet is never wrong. */}
          {thread.held_today > 0
            ? `今天它忍住没说 ${thread.held_today} 条`
            : `${thread.messages.length} 条记录`}
        </span>
        <button className="more" onClick={onOpenThread}>
          看完整对话 →
        </button>
        <em>SEALED</em>
      </div>

      {error && <p className="err" role="alert">{error}</p>}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <button type="button" className="ic" title="语音（还没接）" disabled>
          <Icon name="mic" />
        </button>
        <textarea
          rows={1}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="跟它说点什么…（Enter 发送）"
        />
        <span className="model">qwen3.5-9b</span>
        <button type="button" className="ic" title="让它自己看一眼" disabled={busy}
                onClick={onTick}>
          <Icon name="record" />
        </button>
        <button className="ic" type="submit" disabled={busy || !draft.trim()} aria-label="发送">
          <Icon name="send" />
        </button>
      </form>
    </>
  );
}

// ──────────────────────────────────── the dock ────────────────────────────────────

/** The workbench: the whole thread, and the record it adds up to. */
function Dock({
  tab,
  setTab,
  thread,
  record,
  busy,
  onAnswer,
  onClose,
}: {
  tab: "thread" | "record";
  setTab: (t: "thread" | "record") => void;
  thread: Thread | null;
  record: TwinRecord | null;
  busy: boolean;
  onAnswer: (askId: string, option: string) => void;
  onClose: () => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tab === "thread") bottom.current?.scrollIntoView();
  }, [tab, thread?.messages.length]);

  return (
    <div className="dockx">
      <div className="tabs">
        <button className={`tab${tab === "thread" ? " on" : ""}`} onClick={() => setTab("thread")}>
          对话
        </button>
        <button className={`tab${tab === "record" ? " on" : ""}`} onClick={() => setTab("record")}>
          战绩
        </button>
      </div>
      <div className="dhead">
        <b>{tab === "thread" ? "全部说过的话" : "它说对了多少"}</b>
        <button className="wb" aria-label="收起" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="dbody">
        {tab === "thread" ? (
          !thread || !thread.messages.length ? (
            <div className="empty">还没说过话。</div>
          ) : (
            <div className="thread">
              {thread.messages.map((m, i) => {
                if (m.kind === "said_by_user")
                  return <div key={i} className="bubble mine">{m.text}</div>;

                // No footer: there is no stake, no date and no seal, because nothing was
                // sealed. Dressing a remark up as a judgment is what the footer prevents.
                if (m.kind === "replied_by_twin")
                  return <div key={i} className="bubble theirs">{m.text}</div>;

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
                            <button key={o} disabled={busy}
                                    onClick={() => onAnswer(m.ask_id, o)}>
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
          )
        ) : !record ? (
          <div className="empty">正在读账本…</div>
        ) : !record.domains.length ? (
          <div className="empty">
            还没有判断。{"\n"}跟它说点什么，它说出口的每一句都会记在这儿。
          </div>
        ) : (
          record.domains.map((d) => (
            <article className="dom" key={d.domain}>
              <b>{d.domain}</b>
              <div className="g4">
                <div>已判断<i>{d.judged}</i></div>
                <div>已对账<i>{d.settled}</i></div>
                <div>说对<i>{d.hit_rate === null ? "—" : `${Math.round(d.hit_rate * 100)}%`}</i></div>
                {/* The one nobody else can show: it kept quiet and was right anyway. */}
                <div>忍住说对<i className="gold">{d.held_back.right_anyway}</i></div>
              </div>
              <p className="bar-to">
                离校准还差 {Math.max(0, d.threshold.min_settled - d.settled)} 条
                <span className="track">
                  <i style={{ width: `${Math.min(100, (d.settled / d.threshold.min_settled) * 100)}%` }} />
                </span>
              </p>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
