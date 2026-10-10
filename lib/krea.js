function urlsFrom(job) {
  const buckets = [
    job?.result?.urls,
    job?.data?.urls,
    job?.output?.urls,
    job?.urls,
  ];
  for (const bucket of buckets) {
    if (Array.isArray(bucket) && bucket[0]) return bucket[0];
  }
  return job?.result?.url || job?.url || null;
}

async function readJob(id, key) {
  const response = await fetch(`https://api.krea.ai/jobs/${id}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || `Krea job returned ${response.status}`);
  }
  return body;
}

export async function kreaStill(prompt) {
  const key = process.env.KREA_API_KEY;
  if (!key) {
    return {
      url: null,
      prompt,
      skipped: "KREA_API_KEY is not set. The Cala rows still score the information.",
    };
  }

  const created = await fetch(
    "https://api.krea.ai/generate/image/krea/krea-2/medium",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        aspect_ratio: "4:5",
        resolution: "1K",
        creativity: "low",
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  const job = await created.json().catch(() => ({}));
  if (!created.ok) {
    return {
      url: null,
      prompt,
      error: job.message || job.detail || `Krea returned ${created.status}`,
    };
  }

  const immediate = urlsFrom(job);
  if (immediate) return { url: immediate, prompt };

  const id = job.job_id || job.id;
  if (!id) return { url: null, prompt, error: "Krea did not return a job id." };

  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const current = await readJob(id, key);
    const status = String(current.status || "").toLowerCase();
    const url = urlsFrom(current);
    if (url) return { url, prompt };
    if (status === "failed" || status === "error" || status === "cancelled") {
      return {
        url: null,
        prompt,
        error: current.error || current.message || "Krea generation failed.",
      };
    }
  }
  return { url: null, prompt, error: "Krea is still rendering. Run the cut again." };
}
