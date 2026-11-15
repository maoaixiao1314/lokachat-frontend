/**
 * The twin, end to end: register, then talk.
 *
 * Two regions, after the voice assistant this is modelled on. The stage holds only this
 * moment: the orb, what you just said in small type, and what it is saying now in large type,
 * appearing as it is said -- subtitles, not a chat log. Everything else lives on the preview
 * desk beside it: what it is looking at right now and what it learned from it, the whole
 * conversation, what it may read, and what it learned today.
 *
 * Every word the person reads about themselves comes from the backend -- the questions, the
 * retelling, the twin's own sentences, what it learned -- because the twin's voice is part of
 * the ledger, and a copy rephrased in the client would be a second, unsealed version of it.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  twinClient,
  type Digest,
  type DigestItem,
  type Dilemma,
  type RegistrationForm,
  type Stage,
  type Thread,
  type ThreadMessage,
  type TwinCreated,
  type TwinRecord,
  type Role,
  type Grants as GrantsBody,
  type Job,
  type Source,
} from "../api/twin";
import Orb, { type OrbMode } from "./Orb";
import "./twin.css";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Survives a refresh so a demo does not start over, and so does nothing else. */
const SAVED_TWIN = "loka.twin.id";

/** The proxy attaches the real credential, so nothing secret reaches the browser. */
const client = twinClient({ getToken: async () => "via-proxy" });

type Phase = "loading" | "register" | "retelling" | "thread" | "broken";

/** The preview desk's pages. */
type Tab = "preview" | "history" | "grants" | "digest" | "record";
const TABS: [Tab, string][] = [
  ["preview", "预览"],
  ["history", "对话记录"],
  ["grants", "授权"],
  ["digest", "今日学到"],
  ["record", "战绩"],
];

/** What the composer asks for when it is asking for something to read. */
const MATERIAL_HINT = "贴一个路径：代码仓库目录、.eml / .mbox 邮件、Telegram 的 result.json、.txt / .md";

/** What the composer asks for when it is asking what to read up on. */
const RESEARCH_HINT = "想让它查什么？比如：去查一下 Pearl 的 PoUW 是怎么做的";

/** What it is saying right now, before the thread is reloaded from the ledger. */
type Live = { said: string; reply: string; typing: boolean } | null;

export default function TwinScreen() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [form, setForm] = useState<RegistrationForm | null>(null);
  const [created, setCreated] = useState<TwinCreated | null>(null);
  const [twinId, setTwinId] = useState<string | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [record, setRecord] = useState<TwinRecord | null>(null);
  const [grants, setGrants] = useState<GrantsBody | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // Open beside the stage on a wide screen; on a phone it covers the stage, so it waits.
  const [deskOpen, setDeskOpen] = useState(() => window.innerWidth > 820);
  const [tab, setTab] = useState<Tab>("preview");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<OrbMode>("listen");
  const [level, setLevel] = useState<number | undefined>(undefined);
  const [live, setLive] = useState<Live>(null);
  const [hint, setHint] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const reading = jobs.some((j) => j.status === "reading");

  // While it is reading something in the background, look in on it every few seconds; when a
  // reading finishes, what it learned is on the desk, so the desk is refreshed with it.
  useEffect(() => {
    if (!twinId || !reading) return;
    const timer = setInterval(async () => {
      const next = await client.jobs(twinId).catch(() => null);
      if (!next) return;
      setJobs(next.jobs);
      if (!next.jobs.some((j) => j.status === "reading")) {
        const seen = await client.sources(twinId).catch(() => null);
        if (seen) setSources(seen.sources);
        const done = next.jobs.find((j) => j.status === "done" && j.context_id);
        if (done?.context_id) setPicked(done.context_id);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [twinId, reading]);

  const load = useCallback(async (id: string) => {
    const [next, onto, seen] = await Promise.all([
      client.messages(id),
      client.ontology(id).catch(() => null),
      client.sources(id).catch(() => null),
    ]);
    setThread(next);
    if (onto) setRoles(onto.roles);
    setSources(seen ? seen.sources : []);
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
        client.registrationForm().then((f) => {
          setForm(f);
          setPhase("register");
        });
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
      setMode("listen");
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
      sessionStorage.removeItem(DRAFT);
      setTwinId(made.twin_id);
      setCreated(made);
      setRoles(made.retelling.roles);
      setPhase("retelling");
    });

  const enter = () =>
    run(async () => {
      if (!twinId) return;
      // Give it a chance to speak first. A twin whose first screen is an empty stage waiting
      // for the person to start has not done anything yet.
      await client.tick(twinId).catch(() => undefined);
      await load(twinId);
    });

  /**
   * Say something. Your line goes up as the small subtitle at once; the orb turns to thinking;
   * then the reply is spoken onto the stage a character at a time, the orb rising and falling
   * with it -- the rhythm a voice will give it once there is one. Only then is the thread
   * reloaded from the ledger, which by now holds exactly what was shown.
   */
  const say = async (typed: string) => {
    if (!twinId || busy) return;
    // Asked what to look up, they may type just the topic; make it the request it is.
    const text = hint === RESEARCH_HINT && !/查|搜|学|研究|了解/.test(typed) ? `去查一下 ${typed}` : typed;
    setBusy(true);
    setError("");
    setHint("");
    setLive({ said: text, reply: "", typing: true });
    setMode("think");
    try {
      const res = await client.tell(twinId, text);
      const full = (res.bubbles?.length ? res.bubbles : [res.reply]).filter(Boolean).join("\n");
      if (res.job) {
        const next = await client.jobs(twinId).catch(() => null);
        if (next) setJobs(next.jobs);
        setTab("preview");
      }
      if (res.opened) {
        // It read something: open it on the desk while it talks about it.
        const seen = await client.sources(twinId).catch(() => null);
        if (seen) setSources(seen.sources);
        setPicked(res.opened);
        setTab("preview");
        setDeskOpen(true);
      }
      setMode("speak");
      // A beat per character, faster for long replies so nothing takes more than ~7s.
      const step = Math.max(18, Math.min(60, 7000 / Math.max(1, full.length)));
      for (let i = 1; i <= full.length; i++) {
        const ch = full[i - 1];
        setLive({ said: text, reply: full.slice(0, i), typing: true });
        // Louder on syllables, a dip on punctuation and line breaks: what a voice would do.
        setLevel(/[，。！？、\n,.!?]/.test(ch) ? 0.12 : 0.45 + Math.random() * 0.55);
        await sleep(/[。！？\n]/.test(ch) ? step * 5 : step);
      }
      setLive({ said: text, reply: full, typing: false });
      await load(twinId);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setLevel(undefined);
      setBusy(false);
      setMode("listen");
      setLive(null);
    }
  };

  const answer = (askId: string, option: string) =>
    run(async () => {
      if (!twinId) return;
      await client.answerAsk(askId, option);
      await load(twinId);
    });

  const askForMaterial = () => setHint(MATERIAL_HINT);

  const openTab = (which: Tab) => {
    setTab(which);
    setDeskOpen(true);
    if (!twinId) return;
    if (which === "record") client.record(twinId).then(setRecord).catch(() => undefined);
    if (which === "grants") client.grants(twinId).then(setGrants).catch(() => undefined);
    if (which === "digest") client.digest(twinId).then(setDigest).catch(() => undefined);
    if (which === "preview") client.sources(twinId).then((s) => setSources(s.sources)).catch(() => undefined);
  };
  const openSource = (contextId: string | null) => {
    if (contextId && sources.some((s) => s.context_id === contextId)) setPicked(contextId);
    openTab("preview");
  };

  // One scope per call, and the answer is the whole new state: whether a scope is open is the
  // service's to say, never this screen's.
  const setGrant = (scope: string, granted: boolean) =>
    run(async () => {
      if (!twinId) return;
      setGrants(await client.setGrant(twinId, scope, granted));
    });

  const mark = async (contextId: string | null, index: number, verdict: "right" | "wrong") => {
    if (!twinId || !contextId) return;
    try {
      const res = await client.markLearned(twinId, contextId, index, verdict);
      setSources((all) =>
        all.map((s) => (s.context_id === contextId ? { ...s, learned: res.learned } : s)),
      );
      if (tab === "digest") setDigest(await client.digest(twinId));
    } catch (e) {
      setError(String((e as Error)?.message || e));
    }
  };

  const startOver = () => {
    localStorage.removeItem(SAVED_TWIN);
    location.reload();
  };

  const bare = phase !== "thread";
  const stage = thread?.stage ?? created?.stage ?? null;

  return (
    <div className="twin-root">
      <div className={`win${bare ? " bare" : " talking"}${!bare && deskOpen ? " dock-open" : ""}`}>
        <header className="bar">
          <div className="bar-left">
            <div className="logo" title="Loka">
              <i />
            </div>
            <span className="bar-name">{phase === "thread" ? "我的分身" : "正在认识你"}</span>
            {phase === "thread" && stage && (
              <span className={`stage-badge${stage.can_assert ? " grown" : ""}`} title={stage.says}>
                {stage.name}
              </span>
            )}
          </div>
          <div className="wbtns">
            {phase === "thread" && (
              <>
                <button className="learned-pill" onClick={() => openTab("digest")}>
                  <i />
                  今天学到了什么
                </button>
                <button
                  className={`wb${deskOpen ? " on" : ""}`}
                  title="预览台"
                  aria-label="预览台"
                  onClick={() => setDeskOpen(!deskOpen)}
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

        <main className="stage">
          {phase !== "thread" && <Orb className="orb" mode={mode} />}

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
              <VoiceStage
                thread={thread}
                busy={busy}
                mode={mode}
                level={level}
                live={live}
                error={error}
                hint={hint}
                setHint={setHint}
                opened={sources.find((s) => s.context_id === picked) ?? null}
                reading={jobs.filter((j) => j.status === "reading")}
                onSay={say}
                onAnswer={answer}
                onAddMaterial={askForMaterial}
                onOpen={openTab}
                onOpenSource={openSource}
              />
            )}
          </div>
        </main>

        {phase === "thread" && (
          <section className="dock" aria-label="预览台">
            <Desk
              onResearch={() => setHint(RESEARCH_HINT)}
              jobs={jobs}
              tab={tab}
              setTab={openTab}
              thread={thread}
              record={record}
              grants={grants}
              sources={sources}
              digest={digest}
              picked={picked}
              setPicked={setPicked}
              roles={roles}
              busy={busy}
              onAnswer={answer}
              onGrant={setGrant}
              onMark={mark}
              onAddMaterial={askForMaterial}
              onOpenSource={openSource}
              onRefreshDigest={() =>
                twinId && client.digest(twinId, true).then(setDigest).catch(() => undefined)
              }
              onClose={() => setDeskOpen(false)}
            />
          </section>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────── the stage ────────────────────────────────

const STATUS: Record<OrbMode, string> = { listen: "在听", think: "在想", speak: "在说" };

const dayOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("zh-CN", { month: "long", day: "numeric" }) : "—";
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });

type AskMsg = Extract<ThreadMessage, { kind: "asked_by_twin" }>;
const actionOf = (m: AskMsg, i: number) => {
  const a = m.actions?.[i];
  return typeof a === "string" ? a : a?.id;
};

/**
 * This moment, and nothing else: the orb, your last line small, its line large.
 *
 * A subtitle card rather than a log, because a voice is heard once -- what was said before is
 * on the desk under 对话记录 for anyone who wants it. The orb is the only thing always moving:
 * green and slowly breathing while it listens, purple while it works an answer out, blue and
 * pulsing with each character while it speaks.
 */
function VoiceStage({
  thread,
  busy,
  mode,
  level,
  live,
  error,
  hint,
  setHint,
  opened,
  reading,
  onSay,
  onAnswer,
  onAddMaterial,
  onOpen,
  onOpenSource,
}: {
  reading: Job[];
  thread: Thread;
  busy: boolean;
  mode: OrbMode;
  level: number | undefined;
  live: Live;
  error: string;
  hint: string;
  setHint: (h: string) => void;
  opened: Source | null;
  onSay: (text: string) => void;
  onAnswer: (askId: string, option: string) => void;
  onAddMaterial: () => void;
  onOpen: (tab: Tab) => void;
  onOpenSource: (contextId: string | null) => void;
}) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const msgs = thread.messages;

  useEffect(() => {
    if (!busy) input.current?.focus();
  }, [busy, hint]);

  const lastUser = [...msgs].reverse().find((m) => m.kind === "said_by_user");
  const lastTwin = [...msgs].reverse().find((m) => m.kind !== "said_by_user");
  const ask = lastTwin?.kind === "asked_by_twin" && !lastTwin.answer ? lastTwin : null;

  const said = live ? live.said : lastUser?.text ?? "";
  const speaking = live ? live.reply : lastTwin?.text ?? "";
  const kept = !live && lastTwin?.kind === "said_by_twin" ? lastTwin : null;

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSay(text);
  };
  const choose = (m: AskMsg, i: number) => {
    const action = actionOf(m, i);
    if (action === "point_repo") return onAddMaterial();
    if (action === "tell_me") return setHint("说说你最近在忙什么…");
    onAnswer(m.ask_id, m.options[i]);
  };

  return (
    <div className="vstage">
      <div className="vstatus" data-mode={mode}>
        <i />
        {STATUS[mode]}
      </div>

      <div className="vorb">
        <Orb className="orb" mode={mode} level={level} />
      </div>

      <div className="subs" aria-live="polite">
        {said && <p className="said">你：{said}</p>}
        {speaking ? (
          <p className="speaking">
            {speaking}
            {live?.typing && <span className="caret" />}
          </p>
        ) : (
          <p className="speaking idle">它在等你开口。今天怎么样？</p>
        )}
        {ask && !live && (
          <>
            {ask.why && <small className="why">{ask.why}</small>}
            <div className="quick">
              {ask.options.map((o, j) => (
                <button key={o} disabled={busy} onClick={() => choose(ask, j)}>
                  {o}
                </button>
              ))}
            </div>
          </>
        )}
        {kept && (
          <button className="kept" onClick={() => onOpen("record")}
                  title={`这句里有个判断：「${kept.conclusion}」。它记在账本上，到期回头看说没说对。`}>
            {kept.settlement
              ? kept.settlement.correct ? "后来说对了" : "后来说错了"
              : `记下了 · ${dayOf(kept.due_at)}回头看`}
          </button>
        )}
        {reading.length > 0 && (
          <button className="opened-link" onClick={() => onOpen("preview")}>
            {reading.map((j) => `${j.kind === "research" ? "后台在查" : "后台在看"}：${j.name}`).join(" · ")}…
          </button>
        )}
        {opened && live && (
          <button className="opened-link" onClick={() => onOpenSource(opened.context_id)}>
            已在右边打开：{opened.title}
          </button>
        )}
      </div>

      {error && <p className="err" role="alert">{error}</p>}

      <form
        className="vcomposer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <button type="button" className="mic" title="语音即将接入" aria-label="按住说话（语音即将接入）" disabled>
          <Icon name="mic" />
        </button>
        <label htmlFor="twin-say" className="sr">跟它说</label>
        <input
          id="twin-say"
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={hint || "打字也行，Enter 发送"}
          autoComplete="off"
        />
        <button className="ic" type="submit" disabled={busy || !draft.trim()} aria-label="发送">
          <Icon name="send" />
        </button>
      </form>
      <p className="vnote">语音即将接入 · 现在先打字</p>
    </div>
  );
}

// ──────────────────────────────── the preview desk ────────────────────────────────

function Desk({
  onResearch,
  jobs,
  tab,
  setTab,
  thread,
  record,
  grants,
  sources,
  digest,
  picked,
  setPicked,
  roles,
  busy,
  onAnswer,
  onGrant,
  onMark,
  onAddMaterial,
  onOpenSource,
  onRefreshDigest,
  onClose,
}: {
  onResearch: () => void;
  jobs: Job[];
  tab: Tab;
  setTab: (t: Tab) => void;
  thread: Thread | null;
  record: TwinRecord | null;
  grants: GrantsBody | null;
  sources: Source[];
  digest: Digest | null;
  picked: string | null;
  setPicked: (id: string) => void;
  roles: Role[];
  busy: boolean;
  onAnswer: (askId: string, option: string) => void;
  onGrant: (scope: string, granted: boolean) => void;
  onMark: (contextId: string | null, index: number, verdict: "right" | "wrong") => void;
  onAddMaterial: () => void;
  onOpenSource: (contextId: string | null) => void;
  onRefreshDigest: () => void;
  onClose: () => void;
}) {
  return (
    <div className="dockx">
      <div className="tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
        <span className="tabs-gap" />
        <button className="wb" aria-label="收起预览台" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div className="dbody">
        {tab === "preview" && (
          <Preview onResearch={onResearch} jobs={jobs} sources={sources} picked={picked} setPicked={setPicked} onMark={onMark}
                   onAddMaterial={onAddMaterial} />
        )}
        {tab === "history" && <History thread={thread} busy={busy} onAnswer={onAnswer} />}
        {tab === "grants" && (
          <GrantsPage grants={grants} sources={sources} busy={busy} onGrant={onGrant}
                      onOpenSource={onOpenSource} />
        )}
        {tab === "digest" && (
          <DigestPage digest={digest} onMark={onMark} onOpenSource={onOpenSource}
                      onRefresh={onRefreshDigest} />
        )}
        {tab === "record" && <RecordPage record={record} roles={roles} thread={thread} />}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  mail: "邮件", chat: "聊天记录", docs: "文档", git: "代码仓库", observed: "观察", conversation: "今天的聊天",
  web: "网上查的",
};

/** The excerpt with the words it learned from marked, so the quote is visible on the page. */
function Highlighted({ text, quotes }: { text: string; quotes: string[] }) {
  const marks = quotes.filter(Boolean);
  if (!marks.length) return <>{text}</>;
  const pattern = new RegExp(`(${marks.map((q) => q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
  return (
    <>
      {text.split(pattern).map((part, i) =>
        marks.includes(part) ? <mark key={i}>{part}</mark> : <React.Fragment key={i}>{part}</React.Fragment>,
      )}
    </>
  );
}

/**
 * What it is looking at, the words themselves, and what it took from them -- each line with a
 * right / wrong the person can settle on the spot. Lines marked wrong are greyed here and
 * never used again.
 */
function Preview({
  onResearch,
  jobs,
  sources,
  picked,
  setPicked,
  onMark,
  onAddMaterial,
}: {
  onResearch: () => void;
  jobs: Job[];
  sources: Source[];
  picked: string | null;
  setPicked: (id: string) => void;
  onMark: (contextId: string | null, index: number, verdict: "right" | "wrong") => void;
  onAddMaterial: () => void;
}) {
  const doc = sources.find((s) => s.context_id === picked) ?? sources[0];
  const pending = jobs.filter((j) => j.status !== "done").slice(0, 4);
  const strip = pending.length > 0 && (
    <div className="jobs">
      {pending.map((j) => (
        <p key={j.job_id} className={`job ${j.status}`}>
          {j.status === "reading"
            ? <><i />{j.kind === "research" ? "在网上查" : "后台在看"}「{j.name}」…</>
            : <>{j.kind === "research" ? "没查成" : "没读成"}「{j.name}」：{j.error}</>}
        </p>
      ))}
    </div>
  );
  if (!doc && strip) return <div className="preview-wait">{strip}<p className="gnote">看完了会打开在这里。</p></div>;
  if (!doc)
    return (
      <div className="empty preview-empty">
        <p>它还什么都没看过。</p>
        <p className="gnote">
          在下面的输入框里贴一个路径给它：代码仓库目录、导出的邮件（.eml / .mbox）、
          Telegram 导出的 result.json、微信导出的 .txt，或者一份 .md 笔记。它会打开在这里，
          边看边学。
        </p>
        <span className="pbtns">
          <button className="primary" onClick={onAddMaterial}>给它看点东西</button>
          <button className="primary" onClick={onResearch}>让它去网上查</button>
        </span>
      </div>
    );
  return (
    <div className="preview">
      <div className="plist" role="navigation" aria-label="它看过的">
        <p>它看过的</p>
        {sources.map((s) => (
          <button key={s.context_id} className={s.context_id === doc.context_id ? "on" : ""}
                  onClick={() => setPicked(s.context_id)}>
            <span className={`pk k-${s.kind}`}>{KIND_LABEL[s.kind] ?? s.kind} · {clock(s.at)}</span>
            <span className="pt">{s.title}</span>
          </button>
        ))}
        <button className="padd" onClick={onAddMaterial}>+ 给它看点东西</button>
        <button className="padd" onClick={onResearch}>+ 让它去网上查</button>
      </div>
      <article className="pdoc">
        {strip}
        <div className="pmeta">
          <span className="ro">只读</span>
          <span>{KIND_LABEL[doc.kind] ?? doc.kind}{doc.meta ? ` · ${doc.meta}` : ""}</span>
        </div>
        <h2>{doc.title}</h2>
        <div className="ptext">
          <Highlighted text={doc.excerpt} quotes={doc.learned.filter((l) => l.verdict !== "wrong").map((l) => l.quote)} />
        </div>
        {!!doc.links?.length && (
          <div className="plinks">
            <p>它读了这些网页</p>
            {doc.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener">{l.title}</a>
            ))}
          </div>
        )}
        <section className="plearn">
          <h3>它从这里学到</h3>
          {doc.learned.length ? (
            doc.learned.map((l, i) => (
              <div key={i} className={`lrow${l.verdict === "wrong" ? " wrong" : ""}`}>
                <p>{l.text}</p>
                {l.verdict ? (
                  <span className="lv">{l.verdict === "right" ? "你说对" : "你说不对，不会再用"}</span>
                ) : (
                  <span className="lbtns">
                    <button onClick={() => onMark(doc.context_id, i, "right")}>对</button>
                    <button onClick={() => onMark(doc.context_id, i, "wrong")}>不对</button>
                  </span>
                )}
              </div>
            ))
          ) : (
            <p className="gnote">这份里没看出什么关于你的新东西。</p>
          )}
        </section>
      </article>
    </div>
  );
}

const partsOf = (m: { text: string; bubbles?: string[] }) =>
  m.bubbles?.length ? m.bubbles : m.text.split("\n").filter((l) => l.trim());

/** The whole conversation, in order. The stage only ever shows the last exchange. */
function History({
  thread,
  busy,
  onAnswer,
}: {
  thread: Thread | null;
  busy: boolean;
  onAnswer: (askId: string, option: string) => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  // Braces, not an expression: newer browsers return a Promise from scrollIntoView, and React
  // takes whatever an effect returns as its cleanup -- it crashed the whole screen on the next
  // tab switch.
  useEffect(() => {
    bottom.current?.scrollIntoView();
  }, [thread?.messages.length]);
  if (!thread || !thread.messages.length) return <div className="empty">还没说过话。</div>;
  return (
    <div className="chat history">
      {thread.messages.map((m, i) => {
        const prev = thread.messages[i - 1];
        const time = !prev || new Date(m.at).getTime() - new Date(prev.at).getTime() > 600_000
          ? <time className="when">{clock(m.at)}</time> : null;
        if (m.kind === "said_by_user")
          return <React.Fragment key={i}>{time}<div className="bubble mine">{m.text}</div></React.Fragment>;
        if (m.kind === "asked_by_twin")
          return (
            <React.Fragment key={i}>
              {time}
              <div className="bubble theirs">{m.text}</div>
              {m.answer && m.options.includes(m.answer) && <div className="bubble mine">{m.answer}</div>}
              {!m.answer && (
                <div className="quick">
                  {m.options.map((o) => (
                    <button key={o} disabled={busy} onClick={() => onAnswer(m.ask_id, o)}>{o}</button>
                  ))}
                </div>
              )}
            </React.Fragment>
          );
        return (
          <React.Fragment key={i}>
            {time}
            {partsOf(m).map((p, j) => <div key={j} className="bubble theirs">{p}</div>)}
          </React.Fragment>
        );
      })}
      <div ref={bottom} />
    </div>
  );
}

/**
 * What it may read, by source -- mail, chats, calendar, code, notes, browsing -- each with
 * what it reads, what it never reads, and how it gets it today. A source with no reader yet
 * says so: the switch records consent, and implying it moves data would be the one thing a
 * permission screen must not do.
 */
function GrantsPage({
  grants,
  sources,
  busy,
  onGrant,
  onOpenSource,
}: {
  grants: GrantsBody | null;
  sources: Source[];
  busy: boolean;
  onGrant: (scope: string, granted: boolean) => void;
  onOpenSource: (contextId: string | null) => void;
}) {
  if (!grants) return <div className="empty">正在读权限…</div>;
  return (
    <div className="grants">
      <div>
        <h2 className="ph">它能看什么</h2>
        <p className="gnote">你打开哪个，它才看哪个。都是只读，随时能关。把文件贴给它，也会自动打开对应的这一项。</p>
      </div>
      {grants.may_request.map((s) => {
        const latest = sources.find((x) => x.kind === s.id);
        return (
          <article className={`scope${s.granted ? " on" : ""}`} key={s.id}>
            <div className="srow">
              <div className="sname">
                <b>{s.label}</b>
                {s.via && <span>{s.via}</span>}
                <small className={s.granted ? "ok" : ""}>
                  {s.granted
                    ? s.observer ? `已授权${latest ? ` · 最近看了「${latest.title}」` : ""}` : "已授权 · 读取还没接上，暂时看不到"
                    : "没授权 · 它看不到"}
                </small>
              </div>
              {s.granted && latest && (
                <button className="sopen" onClick={() => onOpenSource(latest.context_id)}>在预览台打开</button>
              )}
              <button
                role="switch"
                aria-checked={s.granted}
                aria-label={s.label}
                className={`toggle${s.granted ? " on" : ""}`}
                disabled={busy}
                onClick={() => onGrant(s.id, !s.granted)}
              >
                <i />
              </button>
            </div>
            {(s.will || s.wont) && (
              <div className="swill">
                <p><em className="yes">会看</em>{s.will}</p>
                <p><em className="no">不看</em>{s.wont}</p>
              </div>
            )}
          </article>
        );
      })}
      <article className="scope never-box">
        <b>它永远不会做</b>
        <p>{grants.never.map((n) => n.label).join(" · ")}</p>
        <p className="gnote">这几条没有开关，服务端直接拒绝。它只看、只学、只跟你说。</p>
      </article>
    </div>
  );
}

/** Tonight's summary: what it learned today, grouped, each line traceable to where it read it. */
function DigestPage({
  digest,
  onMark,
  onOpenSource,
  onRefresh,
}: {
  digest: Digest | null;
  onMark: (contextId: string | null, index: number, verdict: "right" | "wrong") => void;
  onOpenSource: (contextId: string | null) => void;
  onRefresh: () => void;
}) {
  if (!digest) return <div className="empty">正在整理今天学到的…</div>;
  const line = (it: DigestItem, key: number) => (
    <div className="drow" key={key}>
      <p>{it.text}</p>
      <button onClick={() => onOpenSource(it.source.context_id)}>
        {KIND_LABEL[it.source.kind] ?? it.source.title} ›
      </button>
    </div>
  );
  return (
    <div className="digest">
      <div className="dhead2">
        <div>
          <p className="gnote">{digest.day} · 每晚 10 点整理一次，打开这页时也会更新</p>
          <h2 className="ph">{digest.headline}</h2>
        </div>
        <p className="gnote right">
          {digest.seen}
          {digest.skipped && <><br />{digest.skipped}</>}
        </p>
      </div>
      {digest.groups.map((g) => (
        <article className="dgroup" key={g.about}>
          <p className={`dg dg-${g.about}`}>{g.head}</p>
          {g.items.map((it, i) => line(it, i))}
        </article>
      ))}
      {digest.unsure && (
        <article className="dunsure">
          <p className="dg">这条我拿不准，你帮我对一下</p>
          <p>{digest.unsure.text}</p>
          <div className="quick">
            <button onClick={() => onMark(digest.unsure!.source.context_id, digest.unsure!.index, "right")}>对</button>
            <button onClick={() => onMark(digest.unsure!.source.context_id, digest.unsure!.index, "wrong")}>不对</button>
          </div>
        </article>
      )}
      {!digest.total && (
        <p className="gnote">给它看点东西，或者跟它多聊几句，晚上这里就会有内容。</p>
      )}
      <button className="ghost refresh" onClick={onRefresh}>现在重新整理</button>
    </div>
  );
}

/** The ledger: what it said it could be held to, and how that is going. */
function RecordPage({ record, roles, thread }: { record: TwinRecord | null; roles: Role[]; thread: Thread | null }) {
  return (
    <div className="grants">
      {!record ? (
        <div className="empty">正在读账本…</div>
      ) : !record.domains.length ? (
        <div className="empty">还没有判断。它说出口、能事后查证的话，都会记在这儿。</div>
      ) : (
        [...record.domains].sort((a, b) => b.judged - a.judged).map((d) => (
          <article className="dom" key={d.domain}>
            <b>{d.domain}</b>
            <div className="g4">
              <div>已判断<i>{d.judged}</i></div>
              <div>已对账<i>{d.settled}</i></div>
              <div>说对<i>{d.hit_rate === null ? "—" : `${Math.round(d.hit_rate * 100)}%`}</i></div>
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
      <h2 className="ph">你心里那几个声音</h2>
      <Voices roles={roles} wonId={wonRole(thread, roles)} />
    </div>
  );
}

// ──────────────────────────────── shared bits ────────────────────────────────

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

// ──────────────────────────────── status ────────────────────────────────

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

/** Kept for the tab's lifetime, so a reload or a hot update does not wipe what was typed. */
const DRAFT = "loka.twin.draft";

type Draft = {
  about: string;
  name: string;
  current: string;
  years: string;
  age: string;
  background: string;
  picks: Record<string, string>;
  quiet: string;
};

/**
 * One page, then talk.
 *
 * It was four screens -- who you are, four dilemmas, what you are on, when not to disturb --
 * before you could say a word to it, which is a form and not an introduction. Two things are
 * enough to start: what you do and what you are on. The rest is still here, folded, for
 * whoever wants to say more; and the twin asks for what it is missing in the conversation,
 * which is where a person would ask too.
 */
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
  const [d, setD] = useState<Draft>(() => {
    const blank: Draft = {
      about: "", name: "", current: "", background: "", picks: {}, quiet: "",
      years: form.years_bands[2] ?? form.years_bands[0],
      age: form.age_bands[1] ?? form.age_bands[0],
    };
    try {
      return { ...blank, ...JSON.parse(sessionStorage.getItem(DRAFT) || "{}") };
    } catch {
      return blank;
    }
  });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    const next = { ...d, [k]: v };
    setD(next);
    try {
      sessionStorage.setItem(DRAFT, JSON.stringify(next));
    } catch {
      /* private mode: the draft just is not kept */
    }
  };

  function submit() {
    onDone({
      display_name: d.name.trim() || "我",
      about: d.about.trim(),
      years_in_field: d.years,
      age_band: d.age,
      background: d.background.trim(),
      dilemmas: d.picks,
      current_thing: d.current.trim(),
      quiet_text: d.quiet.trim(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }

  return (
    <>
      <Status title="先认识一下" sub="两句话就够，剩下的聊着聊着它就知道了" stage={null} />

      <div className="form">
        <label>你是做什么的</label>
        <div className="chips">
          {form.field_suggestions.map((s) => (
            <button key={s} type="button" className="chip"
                    onClick={() => set("about", d.about ? `${d.about}，${s}` : s)}>
              {s}
            </button>
          ))}
        </div>
        <textarea className="field" rows={2} value={d.about}
                  onChange={(e) => set("about", e.target.value)}
                  placeholder="做审计的，自己也炒币，最近仓位跌得厉害" />
        <div className="row">
          <div>
            <label>怎么称呼你</label>
            <input value={d.name} onChange={(e) => set("name", e.target.value)} maxLength={24}
                   placeholder="阿哲" />
          </div>
        </div>
        <label>最近手头在忙什么（可以不填）</label>
        <textarea className="field" rows={2} value={d.current}
                  onChange={(e) => set("current", e.target.value)}
                  placeholder="仓位又跌了 5 个点，在犹豫要不要补仓" />

        <details className="more-about">
          <summary>多说一点（都可以不填）</summary>
          <div className="row">
            <div>
              <label>干了多久</label>
              <select value={d.years} onChange={(e) => set("years", e.target.value)}>
                {form.years_bands.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label>年龄段</label>
              <select value={d.age} onChange={(e) => set("age", e.target.value)}>
                {form.age_bands.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <label>还有什么它该知道的</label>
          <textarea className="field" rows={2} value={d.background}
                    onChange={(e) => set("background", e.target.value)}
                    placeholder="大所出来的，习惯先查账再下结论" />
          <label>{form.copy.dilemmas}</label>
          {form.dilemmas.map((q: Dilemma) => (
            <article key={q.id} className="dilemma">
              <p>{q.text}</p>
              <div className="pair">
                {q.options.map((o) => (
                  <button key={o.id} type="button"
                          className={d.picks[q.id] === o.id ? "pick on" : "pick"}
                          onClick={() => set("picks", { ...d.picks, [q.id]: o.id })}>
                    {o.label}
                  </button>
                ))}
              </div>
            </article>
          ))}
          <label>{form.copy.quiet}</label>
          <textarea className="field" rows={2} value={d.quiet}
                    onChange={(e) => set("quiet", e.target.value)}
                    placeholder={form.copy.quiet_placeholder} />
        </details>
      </div>

      {error && <p className="err" role="alert">{error}</p>}

      <div className="actions">
        <button className="primary" disabled={busy || !d.about.trim()} onClick={submit}>
          {busy ? "正在读你写的东西…" : "开始聊"}
        </button>
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
              <span className="face" style={{ background: faceColour(i) }} />
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
        <details className="note">
          <summary>它的身份（技术信息）</summary>
          <p className="addr">{made.identity.npub}</p>
          <p className="addr">{made.identity.eth_address}</p>
        </details>
        <p className="sub">{made.retelling.promise}</p>
      </div>
      <div className="actions">
        <button className="primary" disabled={busy} onClick={onEnter}>
          {busy ? "它正在想…" : "开始聊"}
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────── the desk: 声音 ───────────────────────────────

function Voices({ roles, wonId }: { roles: Role[]; wonId: string | null }) {
  if (!roles.length) return <div className="empty">还没读出你的声音。</div>;
  return (
    <div className="grants">
      <p className="gnote">
        这是我从你填的那几道两难题里读出来的，不是我编的。每次开口前它们会吵一架，
        赢的那个就是它说出口的话。读错了就直接跟它说。
      </p>
      {roles.map((r, i) => (
        <article className={`scope${r.id === wonId ? " on" : ""}`} key={r.id}>
          <div className="srow">
            <b>
              <span className="face" style={{ background: faceColour(i) }} /> {r.label}
            </b>
            {r.id === wonId && <span className="sw on">刚才是它赢了</span>}
          </div>
          <p className="swhy">「{r.stance}」</p>
          {r.loud_when && <p className="snone">什么时候最大声：{r.loud_when}</p>}
        </article>
      ))}
    </div>
  );
}
