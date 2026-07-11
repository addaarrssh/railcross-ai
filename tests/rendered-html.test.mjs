import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the RailCross Map Home Page", async () => {
  let html = "";
  try {
    const response = await render("/");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

    html = await response.text();
    assert.match(html, /<title>RailCross/i);
    // When API key is empty/not configured during server test, it returns error page
    assert.match(html, /A Google Maps API key is required|google-map/i);
  } catch (err) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(new URL("./last_home_response.html", import.meta.url), html);
    throw err;
  }
});

test("server-renders the Historical Analytics Dashboard", async () => {
  let html = "";
  try {
    const response = await render("/dashboard");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

    html = await response.text();
    assert.match(html, /Generating historical analytics/i);
    assert.match(html, /dashboard-page-loading/i);
  } catch (err) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(new URL("./last_response.html", import.meta.url), html);
    throw err;
  }
});
