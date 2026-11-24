// Minimal GitHub REST client (used inside GitHub Actions with GITHUB_TOKEN).
export function github() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // owner/name
  if (!token || !repo) return null;
  const api = async (method, path, body) => {
    const res = await fetch(`https://api.github.com${path.replace('{repo}', repo)}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  };
  const all = async (path) => {
    const out = [];
    for (let page = 1; page < 20; page++) {
      const batch = await api('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      out.push(...batch);
      if (batch.length < 100) break;
    }
    return out;
  };
  return {
    repo,
    api,
    openIssues: (label) => all(`/repos/{repo}/issues?state=open${label ? `&labels=${encodeURIComponent(label)}` : ''}`).then((l) => l.filter((i) => !i.pull_request)),
    openPulls: () => all('/repos/{repo}/pulls?state=open'),
    comment: (n, body) => api('POST', `/repos/{repo}/issues/${n}/comments`, { body }),
    addLabels: (n, labels) => api('POST', `/repos/{repo}/issues/${n}/labels`, { labels }),
    removeLabel: (n, label) => api('DELETE', `/repos/{repo}/issues/${n}/labels/${encodeURIComponent(label)}`).catch(() => null),
    ensureLabel: (name, color, description) => api('POST', '/repos/{repo}/labels', { name, color, description }).catch(() => null),
  };
}

// Slack and Microsoft Teams incoming webhooks both accept {"text": "..."}.
export async function notifyChat(text) {
  const hooks = [process.env.SLACK_WEBHOOK_URL, process.env.TEAMS_WEBHOOK_URL].filter(Boolean);
  for (const url of hooks) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (!res.ok) console.error(`Webhook failed: ${res.status}`);
  }
  return hooks.length;
}
