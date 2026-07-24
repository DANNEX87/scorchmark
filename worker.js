// Cloudflare Worker — serves the static site (via the ASSETS binding) and
// answers POST /api/quote by sending the quote email through Resend.
// Secrets/vars are set in the Cloudflare dashboard, never committed:
//   RESEND_API_KEY (required), TO_EMAIL (required), FROM_EMAIL (optional)

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });

const esc = (s = "") =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );

async function handleQuote(request, env) {
  let data = {};
  try {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      data = await request.json();
    } else {
      const fd = await request.formData();
      data = Object.fromEntries(fd.entries());
    }
  } catch {
    return json({ ok: false, error: "Could not read the form. Please try again." }, 400);
  }

  // Honeypot — bots fill hidden fields; humans don't. Pretend success.
  if (data.company) return json({ ok: true });

  const email = String(data.email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json({ ok: false, error: "Please enter a valid email so we can send your quote." }, 400);
  }

  if (!env.RESEND_API_KEY || !env.TO_EMAIL) {
    return json(
      { ok: false, error: "The form isn't finished being set up yet. Please email us directly for now." },
      503
    );
  }

  const f = {
    item: data.item || "—",
    material: data.material || "—",
    detail: String(data.detail || "").trim(),
    detailLabel: String(data.detailLabel || "Detail").trim() || "Detail",
    qty: data.qty || "—",
    date: data.date || "—",
    text: data.text || "—",
    sub: data.sub || "—",
    artwork: data.artwork === "yes" || data.artwork === true ? "Yes — will send the file" : "No",
    notes: String(data.notes || "").trim() || "—",
  };

  const subject = `New quote request — ${f.item}${f.material !== "—" ? " (" + f.material + ")" : ""}`;

  const text =
`New quote request from scorchmark.co

Item:            ${f.item}
Material:        ${f.material}${f.detail ? `\n${f.detailLabel}: ${f.detail}` : ""}
Quantity:        ${f.qty}
Need it by:      ${f.date}
Personalization: ${f.text}
Sub-line:        ${f.sub}
Has artwork:     ${f.artwork}

Notes:
${f.notes}

Reply to: ${email}`;

  const row = (label, val) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#8b7d6e;font:13px/1.5 monospace;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 0;color:#1a1a1a;font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif">${esc(val)}</td></tr>`;

  const html =
`<div style="max-width:560px;margin:0 auto;font-family:-apple-system,Segoe UI,Arial,sans-serif">
  <div style="background:#0d0b09;border-radius:12px 12px 0 0;padding:20px 24px">
    <span style="color:#ff6a1a;font:700 18px/1 -apple-system,Segoe UI,Arial,sans-serif;letter-spacing:.06em">SCORCH<span style="color:#f6efe6">MARK</span></span>
    <div style="color:#c4b5a5;font:12px monospace;margin-top:6px">New quote request</div>
  </div>
  <div style="border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px;padding:18px 24px">
    <table style="border-collapse:collapse;width:100%">
      ${row("Item", f.item)}
      ${row("Material", f.material)}
      ${f.detail ? row(f.detailLabel, f.detail) : ""}
      ${row("Quantity", f.qty)}
      ${row("Need it by", f.date)}
      ${row("Personalization", f.text)}
      ${row("Sub-line", f.sub)}
      ${row("Has artwork", f.artwork)}
      ${row("Notes", f.notes)}
    </table>
    <p style="margin:18px 0 0;padding-top:14px;border-top:1px solid #eee;font:14px -apple-system,Segoe UI,Arial,sans-serif;color:#444">
      Reply directly to this email to reach <a href="mailto:${esc(email)}" style="color:#e2480a">${esc(email)}</a>.
    </p>
  </div>
</div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL || "Scorchmark <onboarding@resend.dev>",
        to: [env.TO_EMAIL],
        reply_to: email,
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) {
      return json({ ok: false, error: "We couldn't send that right now. Please try again in a bit." }, 502);
    }
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "Network hiccup on our end. Please try again." }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/quote") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
      }
      return handleQuote(request, env);
    }
    // Everything else: serve the static site.
    return env.ASSETS.fetch(request);
  },
};
