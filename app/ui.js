"use client";

import { useEffect, useState } from "react";
import { CLIP_ASPECTS, CLIP_LENGTHS, CLIP_MOTIONS } from "../lib/clip.js";

const PRESETS = [
  {
    label: "Holding companies",
    query:
      "Largest advertising holding companies. Return name, headquarters, and founding year. Limit 4.",
    claims: "WPP is headquartered in London.\nPublicis was founded in France.",
  },
  {
    label: "Synthetic ads",
    query:
      "What does the EU AI Act require for disclosure of AI-generated advertising and synthetic media?",
    claims:
      "Sellers must disclose realistic synthetic commercial media.\nThe EU AI Act bans all advertising.",
  },
  {
    label: "Sunscreen",
    query:
      "Major consumer sunscreen brands in the United States. Return brand, owner, and headquarters. Limit 5.",
    claims: "Neutrogena is a sunscreen brand.\nSPF 100 blocks every ultraviolet ray.",
  },
];

function showValue(value) {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const text = JSON.stringify(value);
    return text.length > 160 ? `${text.slice(0, 157)}…` : text;
  } catch {
    return String(value);
  }
}

function rowEntries(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return [["value", row]];
  return Object.entries(row);
}

function frameSrc(frame) {
  if (typeof frame === "string") return frame;
  if (frame && typeof frame === "object") return frame.url || frame.src || "";
  return "";
}

function sourceHref(source) {
  if (typeof source === "string") return source;
  if (source && typeof source === "object") return source.url || source.href || source.link || "";
  return "";
}

function sourceLabel(source) {
  if (typeof source === "string") return source;
  if (source && typeof source === "object") {
    return source.title || source.name || source.url || source.href || "source";
  }
  return "source";
}

function sourceHost(href, title, sources) {
  if (!href) return "";
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "");
    const twins = sources.filter((item) => sourceLabel(item) === title).length;
    if (twins < 2) return host;
    const path = url.pathname === "/" ? "" : url.pathname.slice(0, 36);
    return `${host}${path}`;
  } catch {
    return "";
  }
}

function inlineBits(text, keyPrefix) {
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  return String(text)
    .split(pattern)
    .filter((part) => part !== "")
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (link) {
        return (
          <a key={key} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>
        );
      }
      return part;
    });
}

function NoteBody({ text }) {
  const blocks = String(text).replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks.flatMap((block, index) => {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (!lines.length) return [];
    const heading = lines[0].match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      const nodes = [<h3 key={`${index}-h`}>{inlineBits(heading[1], `${index}-h`)}</h3>];
      const rest = lines.slice(1);
      if (rest.length) nodes.push(<p key={`${index}-p`}>{inlineBits(rest.join(" "), `${index}-p`)}</p>);
      return nodes;
    }
    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      return [
        <ul key={index}>
          {lines.map((line, lineIndex) => (
            <li key={lineIndex}>{inlineBits(line.replace(/^[-*]\s+/, ""), `${index}-${lineIndex}`)}</li>
          ))}
        </ul>,
      ];
    }
    if (lines.length >= 2 && lines.every((line) => (line.match(/\|/g) || []).length >= 2)) {
      return [
        <pre className="note-table" key={index}>
          {lines.join("\n")}
        </pre>,
      ];
    }
    return [<p key={index}>{inlineBits(lines.join(" "), index)}</p>];
  });
}

function Score({ label, value, grade, detail, span }) {
  const numeric = typeof value === "number" || (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value));
  const mark = numeric ? Math.max(0, Math.min(100, Number(value))) : 0;
  const classes = [grade ? `grade-${grade}` : "", span ? "score-span" : ""].filter(Boolean).join(" ");
  return (
    <article className={classes || undefined}>
      <h2 className="score-label">{label}</h2>
      <p className={numeric ? "score-value" : "score-value words"}>
        {value}
        {numeric ? <span className="denom">/100</span> : null}
      </p>
      <p className="grade">{grade || "\u00a0"}</p>
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${mark}%` }} />
      </div>
      {detail ? <p className="score-detail">{detail}</p> : null}
    </article>
  );
}

function pictureDetail(picture) {
  if (!picture || picture.score == null) return "";
  const bits = [];
  if (picture.width && picture.height) bits.push(`${picture.width}×${picture.height}`);
  if (picture.fps) bits.push(`${Math.round(picture.fps * 100) / 100} fps`);
  if (picture.duration) bits.push(`${Math.round(picture.duration * 10) / 10}s`);
  bits.push(picture.hasAudio ? "audio on" : "silent");
  return bits.join("   ");
}

export default function Factcut() {
  const [query, setQuery] = useState("");
  const [claims, setClaims] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [krea, setKrea] = useState(null);
  const [subject, setSubject] = useState("Documentary shot of a quiet cutting room, natural light");
  const [subjectTouched, setSubjectTouched] = useState(false);
  const [motion, setMotion] = useState("dolly_in");
  const [clipLength, setClipLength] = useState(6);
  const [aspect, setAspect] = useState("16:9");
  const [clipAudio, setClipAudio] = useState(true);
  const [startFromStill, setStartFromStill] = useState(true);
  const [clipBusy, setClipBusy] = useState(false);
  const [clip, setClip] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("krea") === "denied") {
      setError("Krea sign-in did not finish. Connect again.");
      params.delete("krea");
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState(null, "", next);
    }
    let gone = false;
    fetch("/api/krea/status")
      .then((response) => response.json())
      .then((data) => {
        if (!gone) setKrea(Boolean(data?.connected));
      })
      .catch(() => {
        if (!gone) setKrea(false);
      });
    return () => {
      gone = true;
    };
  }, []);

  useEffect(() => {
    const prompt = result?.still?.prompt;
    if (!prompt || subjectTouched) return;
    const next = String(prompt).replace(/\bphotos?\b/gi, (word) =>
      word.toLowerCase() === "photos" ? "shots" : "shot",
    );
    setSubject(next);
  }, [result, subjectTouched]);

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        body: new FormData(form),
      });
      const raw = await response.text();
      let data = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = {};
        }
      }
      const messages = [];
      const seen = new Set();
      const pushMessage = (value) => {
        if (typeof value !== "string") return;
        const message = value.trim();
        if (!message || seen.has(message)) return;
        seen.add(message);
        messages.push(message);
      };
      pushMessage(data?.error);
      if (Array.isArray(data?.errors)) data.errors.forEach(pushMessage);
      const message = messages.join("\n");

      if (!response.ok || !data || typeof data !== "object" || Array.isArray(data)) {
        setError(message || `Analyze failed (${response.status})`);
        setResult(null);
        return;
      }
      setError(message);
      setResult(data);
      if (data?.still?.url) setKrea(true);
      if (data?.still?.code === "auth") setKrea(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  async function cutClip() {
    if (busy || clipBusy) return;
    setClipBusy(true);
    setClip(null);
    try {
      const response = await fetch("/api/krea/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          motion,
          duration: Number(clipLength),
          aspect,
          audio: clipAudio,
          startImage: startFromStill ? result?.still?.url || "" : "",
        }),
      });
      const raw = await response.text();
      let data = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = {};
        }
      }
      if (!response.ok || !data || typeof data !== "object") {
        setClip({ error: data?.error || `Clip failed (${response.status})` });
        return;
      }
      setClip({ ...data, aspect });
      if (data.url) setKrea(true);
      if (data.code === "auth") setKrea(false);
    } catch (err) {
      setClip({ error: err instanceof Error ? err.message : "Network error" });
    } finally {
      setClipBusy(false);
    }
  }

  const picture = result?.video ?? result?.picture ?? null;
  const information = result?.information ?? null;
  const pictureValue = !result ? "—" : !picture || picture.score == null ? "No file" : picture.score;
  const pictureGrade = picture && picture.score != null ? picture.grade || "" : "";
  const infoValue = information && information.score != null ? information.score : "—";
  const infoGrade = information && information.score != null ? information.grade || "" : "";
  const notes = [
    ...(Array.isArray(information?.notes) ? information.notes : []),
    ...(Array.isArray(picture?.notes) ? picture.notes : []),
  ];
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const sources = Array.isArray(result?.sources) ? result.sources : [];
  const frames = Array.isArray(result?.frames)
    ? result.frames
    : Array.isArray(picture?.frames)
      ? picture.frames
      : [];
  const rawNote = result?.searchNote ?? result?.note ?? "";
  const searchNote = typeof rawNote === "string" ? rawNote.trim() : "";
  const judged = Array.isArray(information?.claims) ? information.claims : [];
  const clipPicture = clip?.picture && clip.picture.score != null ? clip.picture : null;
  const clipValue = !clip ? "—" : clipPicture ? clipPicture.score : clip.gradeError ? "No grade" : "—";
  const clipGrade = clipPicture ? clipPicture.grade || "" : "";
  const clipDetail = clipPicture ? pictureDetail(clipPicture) : clip?.gradeError || "";
  const stillUrl = typeof result?.still?.url === "string" ? result.still.url : "";
  const stillIsStart = startFromStill && stillUrl.startsWith("https://");

  return (
    <main className="bench">
      <header className="slate">
        <div className="clapper" aria-hidden="true" />
        <div className="slate-body">
          <p className="eyebrow">Edit bay / knowledge cut</p>
          <h1>FACTCUT</h1>
          <p className="lede">
            Picture quality and information quality for a video, cut from a Cala query.
          </p>
        </div>
      </header>

      <div className="stage">
        <form className="paper" onSubmit={onSubmit} aria-busy={busy}>
          <fieldset className="presets">
            <legend>Presets</legend>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                aria-pressed={query === preset.query && claims === preset.claims}
                onClick={() => {
                  setQuery(preset.query);
                  setClaims(preset.claims);
                }}
              >
                {preset.label}
              </button>
            ))}
          </fieldset>

          <label className="field">
            Cala query
            <textarea
              name="query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask Cala in a sentence, or ask for a table."
              required
            />
          </label>

          <label className="field">
            Claims the video makes, one per line
            <textarea
              name="claims"
              value={claims}
              onChange={(event) => setClaims(event.target.value)}
              placeholder="One claim per line. Leave this blank to score the query only."
            />
          </label>

          <label className="field">
            Video
            <input name="video" type="file" accept="video/*" />
          </label>

          <button className="submit" type="submit" disabled={busy}>
            {busy ? "Cutting…" : "Make the cut"}
          </button>
          <p className="status" role="status">
            {busy
              ? "Cala is running. The Krea still is painted after the rows come back."
              : "The still uses the first Cala row and leaves numbers out of the picture. The clip is a separate cut."}
          </p>
          <p className="status">
            {krea
              ? "Krea is signed in. The still spends this workspace's compute units."
              : krea === false
                ? <>
                    Sign in to Krea and pick the Pro workspace.{" "}
                    <a href="/api/krea/connect">Connect Krea</a>
                  </>
                : "Checking the Krea sign-in."}
          </p>
        </form>

        <section className="scoreboard" aria-label="Scores">
          <h2 className="meter-title">Light meter</h2>
          <Score
            label="Picture"
            value={pictureValue}
            grade={pictureGrade}
            detail={pictureDetail(picture)}
          />
          <Score label="Information" value={infoValue} grade={infoGrade} />
          <Score
            label="Clip"
            value={clipValue}
            grade={clipGrade}
            detail={clipDetail}
            span
          />
          <div className="meter-foot">
            {result || clip ? null : <p className="score-wait">Scores land here after the cut.</p>}
            <p className="scale">
              <span className="ok">airable / grounded</span>
              <span className="mid">fixable / partial</span>
              <span className="bad">weak / unsupported</span>
            </p>
          </div>
        </section>
      </div>

      <section className="paper clip-bay" aria-busy={clipBusy}>
        <h2 className="section-kicker">Clip</h2>
        <p className="clip-lead">
          Subject, camera, length, frame, and sound. The clip meter grades the file Krea returns.
        </p>
        <div className="clip-grid">
          <label className="field subject">
            Subject
            <textarea
              value={subject}
              onChange={(event) => {
                setSubjectTouched(true);
                setSubject(event.target.value);
              }}
              placeholder="Documentary shot of a quiet cutting room, natural light"
            />
          </label>
          <label className="field">
            Camera
            <select value={motion} onChange={(event) => setMotion(event.target.value)}>
              {CLIP_MOTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Length
            <select
              value={clipLength}
              onChange={(event) => setClipLength(Number(event.target.value))}
            >
              {CLIP_LENGTHS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds} seconds
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Frame
            <select value={aspect} onChange={(event) => setAspect(event.target.value)}>
              {CLIP_ASPECTS.map((ratio) => (
                <option key={ratio} value={ratio}>
                  {ratio}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="checks">
          <label>
            <input
              type="checkbox"
              checked={clipAudio}
              onChange={(event) => setClipAudio(event.target.checked)}
            />
            Sound
          </label>
          <label>
            <input
              type="checkbox"
              checked={startFromStill}
              onChange={(event) => setStartFromStill(event.target.checked)}
            />
            Start from the still
          </label>
        </div>
        <button className="submit" type="button" disabled={busy || clipBusy} onClick={cutClip}>
          {clipBusy ? "Cutting the clip…" : "Cut the clip"}
        </button>
        <p className="status" role="status">
          {clipBusy
            ? "Krea is rendering the clip. This spends compute units on the signed-in workspace."
            : stillIsStart
              ? "The clip starts from the still. Length, frame, and sound stay settings, so the subject line can stay free of numbers."
              : startFromStill
                ? "No still yet. The clip starts from the subject."
                : "Length, frame, and sound stay settings. The subject line stays free of numbers."}
        </p>
        {clip?.error ? (
          <p className="clip-error" role="alert">
            {clip.error}{" "}
            {clip.code === "auth" ? <a href="/api/krea/connect">Connect Krea</a> : null}
          </p>
        ) : null}
        {clip?.url ? (
          <figure className="clip-player">
            <video
              src={clip.url}
              controls
              playsInline
              style={{ aspectRatio: clip.aspect === "9:16" || aspect === "9:16" ? "9 / 16" : "16 / 9" }}
            />
            {clip.prompt ? <figcaption>{clip.prompt}</figcaption> : null}
          </figure>
        ) : null}
      </section>

      {error ? (
        <p className="alert" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="evidence">
          <section className="bay">
            <figure className="gate">
              {result.still?.url ? (
                <img src={result.still.url} alt="Krea still from the first Cala row" />
              ) : (
                <div className="gate-empty">
                  <p className="gate-mark">Still</p>
                  <p>{result.still?.error || result.still?.skipped || "No still yet."}</p>
                  {result.still?.code === "auth" ? (
                    <a href="/api/krea/connect">Connect Krea</a>
                  ) : null}
                </div>
              )}
              {result.still?.prompt ? <figcaption>{result.still.prompt}</figcaption> : null}
            </figure>
            <div className="reel">
              <h2 className="section-kicker">Frames</h2>
              {frames.length ? (
                <div className="frames">
                  {frames.map((frame, index) => {
                    const src = frameSrc(frame);
                    if (!src) return null;
                    return (
                      <figure className="frame" key={`${index}`}>
                        <img src={src} alt={`Extracted frame ${index + 1}`} />
                        <figcaption>{String(index + 1).padStart(2, "0")}</figcaption>
                      </figure>
                    );
                  })}
                </div>
              ) : (
                <p className="quiet">No frames. Add a video to score the picture.</p>
              )}
            </div>
          </section>

          {notes.length ? (
            <section>
              <h2 className="section-kicker">Notes</h2>
              <ul className="notes">
                {notes.map((note, index) => (
                  <li key={`${note}-${index}`}>{note}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {judged.length ? (
            <section>
              <h2 className="section-kicker">Claims</h2>
              <ol className="claim-list">
                {judged.map((claim, index) => (
                  <li key={`${claim.text}-${index}`}>
                    <span className={`claim-status claim-${claim.status || "unknown"}`}>{claim.status}</span>
                    <span>{claim.text}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section>
            <h2 className="section-kicker">Cala rows</h2>
            {rows.length ? (
              rows.map((row, index) => (
                <article className="log" key={index}>
                  <p className="log-index">{String(index + 1).padStart(2, "0")}</p>
                  <dl className="row">
                    {rowEntries(row).map(([key, value]) => (
                      <div className="pair" key={key}>
                        <dt>{key}</dt>
                        <dd>{showValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))
            ) : (
              <p className="quiet">
                {searchNote ? "No rows returned. The answer is in the search note." : "No rows returned."}
              </p>
            )}
          </section>

          <section className="source-board">
            <h2 className="section-kicker">Sources</h2>
            {sources.length ? (
              <ul className="source-list">
                {sources.map((source, index) => {
                  const href = sourceHref(source);
                  const title = sourceLabel(source);
                  const host = sourceHost(href, title, sources);
                  return (
                    <li key={`${href || title}-${index}`}>
                      {href ? (
                        <a className="source-link" href={href} rel="noreferrer" target="_blank">
                          <span className="source-title">{title}</span>
                          {host ? <span className="source-host">{host}</span> : null}
                        </a>
                      ) : (
                        <span>
                          <span className="source-title">{title}</span>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="quiet">No sources returned.</p>
            )}
          </section>

          {searchNote ? (
            <section className="search-block">
              <h2 className="section-kicker search-label">Search note</h2>
              <div className="search-note">
                <NoteBody text={searchNote} />
              </div>
            </section>
          ) : null}

        </div>
      ) : null}
    </main>
  );
}
