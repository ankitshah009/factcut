"use client";

import { useState } from "react";

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

function Score({ label, score, grade, empty }) {
  const shown = score == null ? "–" : score;
  return (
    <article className="score">
      <div className="kicker">{label}</div>
      <div className="num">{shown}</div>
      <div className={`grade ${grade || "missing"}`}>{grade || empty}</div>
    </article>
  );
}

function primitives(row) {
  return Object.entries(row).flatMap(([key, value]) => {
    if (value == null) return [];
    if (typeof value === "object") {
      return [[key, JSON.stringify(value).slice(0, 180)]];
    }
    return [[key, String(value)]];
  });
}

export default function Factcut() {
  const [query, setQuery] = useState(PRESETS[0].query);
  const [claims, setClaims] = useState(PRESETS[0].claims);
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const body = new FormData();
    body.set("query", query);
    body.set("claims", claims);
    if (file) body.set("video", file);
    try {
      const response = await fetch("/api/analyze", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "The cut failed.");
        setResult(null);
      } else {
        setResult(data);
        if (data.errors?.length) setError(data.errors.join(" "));
      }
    } catch (err) {
      setError(err.message || "The cut failed.");
    } finally {
      setBusy(false);
    }
  }

  const info = result?.information;
  const video = result?.video;

  return (
    <main className="app">
      <form className="panel" onSubmit={onSubmit}>
        <header className="mast">
          <span>Creative data</span>
          <h1>Factcut</h1>
          <p>One Cala query. A picture score for the file. An information score for the claims.</p>
        </header>
        <div className="presets">
          {PRESETS.map((preset) => (
            <button
              className="preset"
              type="button"
              key={preset.label}
              onClick={() => {
                setQuery(preset.query);
                setClaims(preset.claims);
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <label htmlFor="query">Cala query</label>
        <textarea
          id="query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          required
        />
        <label htmlFor="claims">Claims the video makes, one per line</label>
        <textarea
          id="claims"
          value={claims}
          onChange={(event) => setClaims(event.target.value)}
        />
        <label htmlFor="video">Video</label>
        <input
          id="video"
          type="file"
          accept="video/*"
          onChange={(event) => {
            const next = event.target.files?.[0] || null;
            setFile(next);
            setFileName(next?.name || "");
          }}
        />
        {fileName ? <p className="meta">{fileName}</p> : null}
        <button className="go" type="submit" disabled={busy}>
          {busy ? "Cutting…" : "Cut"}
        </button>
      </form>
      <section className="stage">
        {error ? <p className="error">{error}</p> : null}
        <div className="scores">
          <Score
            label="Picture"
            score={video ? video.score : null}
            grade={video?.grade}
            empty="No file"
          />
          <Score
            label="Information"
            score={info ? info.score : null}
            grade={info?.grade}
            empty="Run a query"
          />
        </div>
        {result ? (
          <>
            <ul className="notes">
              {(video?.notes || []).map((note) => (
                <li key={note}>{note}</li>
              ))}
              {(info?.notes || []).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            {info?.claims?.length ? (
              <div className="block">
                <h2>Claims</h2>
                {info.claims.map((claim) => (
                  <div className="claim" key={claim.text}>
                    <div className={`key ${claim.status}`}>{claim.status}</div>
                    <div className="val">{claim.text}</div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="block">
              <h2>Query rows</h2>
              {result.rows?.length ? (
                result.rows.map((row, index) => (
                  <div key={index}>
                    {primitives(row).map(([key, value]) => (
                      <div className="row" key={`${index}-${key}`}>
                        <div className="key">{key}</div>
                        <div className="val">{value}</div>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                <p className="note">No structured rows.</p>
              )}
            </div>
            {result.sources?.length ? (
              <div className="block">
                <h2>Sources</h2>
                {result.sources.map((source) => (
                  <a className="src" key={source.url} href={source.url}>
                    {source.name}
                  </a>
                ))}
              </div>
            ) : null}
            {result.note ? (
              <div className="block">
                <h2>Cala note</h2>
                <p className="note">{result.note.slice(0, 700)}</p>
              </div>
            ) : null}
            {result.frames?.length ? (
              <div className="block">
                <h2>Frames</h2>
                <div className="frames">
                  {result.frames.map((src) => (
                    <img key={src.slice(0, 48)} alt="Frame pulled from the video" src={src} />
                  ))}
                </div>
              </div>
            ) : null}
            {result.still ? (
              <div className="block">
                <h2>Krea still</h2>
                {result.still.url ? (
                  <div className="still">
                    <img alt="Still cut from the query row" src={result.still.url} />
                  </div>
                ) : (
                  <p className="note">{result.still.skipped || result.still.error}</p>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <p className="note">
            The picture score reads the file. The information score reads the Cala query. Paste the
            lines the video says, or the second number is only about the rows.
          </p>
        )}
      </section>
    </main>
  );
}
