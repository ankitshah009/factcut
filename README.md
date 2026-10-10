# Factcut

A Cala query cuts a video into two scores: the quality of the picture, and the quality of the information.

Picture comes from the file. Height, frame rate, audio, duration, bitrate. Information comes from `POST /v1/knowledge/query`. Claims you type, one per line, count as supported only when their words and numbers show up in those rows. `knowledge/search` adds the source links. Krea cuts one still from the digit-free fields in the first row, and only when `KREA_API_KEY` is set. Numbers stay in the ledger. They are not painted into the picture.

This is the step before a publishability check. Aubric asks whether an ad is allowed to ship. Factcut asks whether the file is fit to run and whether the claim is in the query result at all.

## Run

```bash
cp .env.example .env.local
# put CALA_API_KEY in .env.local
# KREA_API_KEY is optional
npm install
npm test
npm run dev
```

Open http://localhost:3000. Pick a preset, or paste a Cala query. Drop a short mp4 if you want the picture score. Leave the video off and the information score still runs.

The Cala key stays in `.env.local`. That file is gitignored.

## What the scores mean

Picture grades are `airable`, `fixable`, and `weak`. They describe the file, not the taste of the edit.

Information grades are `grounded`, `partial`, and `unsupported`. With no claims, the score measures how much typed material and how many sources came back. It does not listen to the video. Paste the lines the video actually says.

Factcut does not give legal, medical, or advertising clearance. A human makes the ship call.
