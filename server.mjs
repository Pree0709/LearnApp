import http from "node:http";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ID = "learn-app-public-client";

// In-memory stores keep the example easy to inspect. Production systems need
// encrypted persistence, expiration, rotation, audit controls and PHI-safe logs.
const pending = new Map();
const authorizationCodes = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();
const connections = new Map();
const audit = [];

const patient = {
  resourceType: "Patient",
  id: "patient-123",
  meta: { lastUpdated: "2026-10-01T15:00:00Z" },
  name: [{ use: "official", family: "Sharma", given: ["Priya"] }],
  birthDate: "1988-04-12"
const cfg = {
  payerName: process.env.PAYER_NAME || "Configured payer",
  fhirBase: (process.env.FHIR_BASE_URL || "").replace(/\/+$/, ""),
  clientId: process.env.CLIENT_ID || "",
  clientSecret: process.env.CLIENT_SECRET || "",
  redirectUri: process.env.REDIRECT_URI || `http://localhost:${PORT}/oauth/callback`,
  authMethod: process.env.TOKEN_AUTH_METHOD || "none",
  scope: process.env.SMART_SCOPE || "openid fhirUser launch/patient offline_access patient/*.rs"
};
const pending = new Map(), connections = new Map(), audit = [];
const b64 = value => Buffer.from(value).toString("base64url");
const secret = (bytes = 32) => b64(randomBytes(bytes));
const challenge = verifier => b64(createHash("sha256").update(verifier, "ascii").digest());
const log = (event, details = {}) => audit.push({ id: randomUUID(), event, at: new Date().toISOString(), ...details });

const coverage = {
  resourceType: "Coverage",
  id: "coverage-1",
  status: "active",
  beneficiary: { reference: "Patient/patient-123" },
  subscriberId: "MEMBER-10001",
  payor: [{ reference: "Organization/payer-a", display: "Payer A" }],
  class: [
    { type: { text: "Group" }, value: "GRP-44", name: "Example Employer" },
    { type: { text: "Plan" }, value: "PLAN-GOLD", name: "Gold PPO" }
  ]
};

const claims = [
  {
    resourceType: "ExplanationOfBenefit",
    id: "eob-1",
    status: "active",
    outcome: "complete",
    patient: { reference: "Patient/patient-123" },
    created: "2026-08-20",
    provider: { reference: "Organization/provider-1", display: "Lakeview Clinic" },
    type: { text: "Professional" },
    total: [
      { category: { coding: [{ code: "submitted" }] }, amount: { value: 240, currency: "USD" } },
      { category: { coding: [{ code: "eligible" }] }, amount: { value: 180, currency: "USD" } },
      { category: { coding: [{ code: "benefit" }] }, amount: { value: 135, currency: "USD" } },
      { category: { coding: [{ code: "memberliability" }] }, amount: { value: 45, currency: "USD" } }
    ]
  },
  {
    resourceType: "ExplanationOfBenefit",
    id: "eob-2",
    status: "active",
    outcome: "complete",
    patient: { reference: "Patient/patient-123" },
    created: "2026-09-14",
    provider: { reference: "Organization/provider-2", display: "City Imaging" },
    type: { text: "Outpatient" },
    total: [
      { category: { coding: [{ code: "submitted" }] }, amount: { value: 900, currency: "USD" } },
      { category: { coding: [{ code: "benefit" }] }, amount: { value: 620, currency: "USD" } },
      { category: { coding: [{ code: "memberliability" }] }, amount: { value: 120, currency: "USD" } }
    ]
  }
];

const clinical = {
  Condition: [{
    resourceType: "Condition", id: "condition-1",
    subject: { reference: "Patient/patient-123" },
    clinicalStatus: { text: "Active" }, code: { text: "Example condition" }
  }],
  Observation: [{
    resourceType: "Observation", id: "observation-1", status: "final",
    subject: { reference: "Patient/patient-123" }, code: { text: "Example measurement" },
    valueQuantity: { value: 118, unit: "mmHg" }
  }]
};

function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${req.headers.host}`;
}

function json(res, status, value, headers = {}) {
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(value, null, 2));
  res.end(JSON.stringify(body, null, 2));
}

function html(res, status, value) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(value);
function go(res, location) { res.writeHead(302, { location }); res.end(); }
function problems() {
  const result = [];
  if (!cfg.fhirBase) result.push("FHIR_BASE_URL is missing");
  if (!cfg.clientId) result.push("CLIENT_ID is missing");
  if (!new Set(["none", "client_secret_basic", "client_secret_post"]).has(cfg.authMethod)) result.push("Unsupported TOKEN_AUTH_METHOD");
  if (cfg.authMethod.startsWith("client_secret") && !cfg.clientSecret) result.push("CLIENT_SECRET is missing");
  return result;
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
async function upstream(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { accept: "application/json, application/fhir+json", ...options.headers } });
  const text = await response.text();
  let value; try { value = text ? JSON.parse(text) : null; } catch { value = { raw: text }; }
  if (!response.ok) { const error = new Error(`Payer returned HTTP ${response.status}`); error.status = response.status; error.details = value; throw error; }
  return value;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  const type = req.headers["content-type"] || "";
  if (type.includes("application/json")) return raw ? JSON.parse(raw) : {};
  if (type.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  return raw;
function tokenRequest(parameters) {
  const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  const body = new URLSearchParams(parameters);
  if (cfg.authMethod === "client_secret_basic") headers.authorization = `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`;
  else if (cfg.authMethod === "client_secret_post") { body.set("client_id", cfg.clientId); body.set("client_secret", cfg.clientSecret); }
  else body.set("client_id", cfg.clientId);
  return { headers, body };
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64url");
async function discover() {
  const [smart, metadata] = await Promise.all([
    upstream(`${cfg.fhirBase}/.well-known/smart-configuration`),
    upstream(`${cfg.fhirBase}/metadata`)
  ]);
  const oauth = metadata?.rest?.[0]?.security?.extension?.find(x => x.url === "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris");
  const legacy = Object.fromEntries((oauth?.extension || []).map(x => [x.url, x.valueUri]));
  smart.authorization_endpoint ||= legacy.authorize;
  smart.token_endpoint ||= legacy.token;
  smart.revocation_endpoint ||= legacy.revoke;
  if (!smart.authorization_endpoint || !smart.token_endpoint) throw new Error("Payer did not advertise authorization and token endpoints");
  return { smart, metadata };
}

function challengeFor(verifier) {
  return base64url(createHash("sha256").update(verifier, "ascii").digest());
async function fhir(connection, url) {
  return upstream(new URL(url, `${cfg.fhirBase}/`).toString(), { headers: { authorization: `Bearer ${connection.accessToken}` } });
}

function randomSecret(bytes = 32) {
  return base64url(randomBytes(bytes));
}

function log(event, details = {}) {
  audit.push({ id: randomUUID(), event, at: new Date().toISOString(), ...details });
}

function operationOutcome(status, code, diagnostics) {
  return {
    status,
    body: {
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code, diagnostics }]
    }
  };
}

function bearer(req) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

function requireToken(req, res) {
  const token = bearer(req);
  const record = token && accessTokens.get(token);
  if (!record || record.revoked || record.expiresAt < Date.now()) {
    json(res, 401, operationOutcome(401, "login", "A valid bearer token is required").body, {
      "www-authenticate": 'Bearer error="invalid_token"'
    });
    return null;
async function pages(connection, url) {
  const resources = []; let next = url, count = 0;
  while (next && count++ < 50) {
    const bundle = await fhir(connection, next);
    for (const entry of bundle.entry || []) if (entry.resource) resources.push(entry.resource);
    next = (bundle.link || []).find(x => x.relation === "next")?.url;
  }
  return { token, record };
  return resources;
}

function bundle(type, resources, self, next = null) {
  const links = [{ relation: "self", url: self }];
  if (next) links.push({ relation: "next", url: next });
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: resources.length,
    link: links,
    entry: resources.map(resource => ({ fullUrl: `${self.split(`/${type}`)[0]}/${type}/${resource.id}`, resource }))
  };
}

function discovery(origin) {
  return {
    issuer: `${origin}/mock-payer`,
    authorization_endpoint: `${origin}/mock-payer/authorize`,
    token_endpoint: `${origin}/mock-payer/token`,
    revocation_endpoint: `${origin}/mock-payer/revoke`,
    introspection_endpoint: `${origin}/mock-payer/introspect`,
    grant_types_supported: ["authorization_code", "refresh_token"],
    response_types_supported: ["code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [
      "openid", "fhirUser", "launch/patient", "offline_access",
      "patient/Patient.rs", "patient/Coverage.rs", "patient/ExplanationOfBenefit.rs",
      "patient/Condition.rs", "patient/Observation.rs"
    ],
    capabilities: [
      "launch-standalone", "client-public", "context-standalone-patient",
      "permission-patient", "permission-v2", "permission-offline", "sso-openid-connect"
    ]
  };
}

function capabilityStatement(origin) {
  return {
    resourceType: "CapabilityStatement",
    id: "payer-a-capability",
    status: "active",
    date: "2026-10-01",
    kind: "instance",
    fhirVersion: "4.0.1",
    format: ["json"],
    rest: [{
      mode: "server",
      security: { service: [{ coding: [{ code: "SMART-on-FHIR" }] }] },
      resource: [
        { type: "Patient", interaction: [{ code: "read" }] },
        { type: "Coverage", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }] },
        { type: "ExplanationOfBenefit", interaction: [{ code: "read" }, { code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }, { name: "_lastUpdated", type: "date" }] },
        { type: "Condition", interaction: [{ code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }] },
        { type: "Observation", interaction: [{ code: "search-type" }], searchParam: [{ name: "patient", type: "reference" }] }
      ]
    }]
  };
}

async function serveStatic(res, file) {
async function serve(res, file) {
  try {
    const content = await readFile(path.join(ROOT, "public", file));
    const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html";
    res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    res.end(content);
  } catch {
    json(res, 404, { error: "not_found" });
  }
    res.writeHead(200, { "content-type": `${type}; charset=utf-8` }); res.end(content);
  } catch { send(res, 404, { error: "not_found" }); }
}

const server = http.createServer(async (req, res) => {
  try {
    const origin = baseUrl(req);
    const url = new URL(req.url, origin);
    const pathname = url.pathname;
    const url = new URL(req.url, `http://${req.headers.host}`), p = url.pathname;
    if (req.method === "GET" && p === "/") return serve(res, "index.html");
    if (req.method === "GET" && p === "/app.js") return serve(res, "app.js");
    if (req.method === "GET" && p === "/styles.css") return serve(res, "styles.css");

    if (req.method === "GET" && pathname === "/") return serveStatic(res, "index.html");
    if (req.method === "GET" && pathname === "/app.js") return serveStatic(res, "app.js");
    if (req.method === "GET" && pathname === "/styles.css") return serveStatic(res, "styles.css");
    if (req.method === "GET" && p === "/api/config/status") return send(res, 200, {
      ready: !problems().length, problems: problems(), payerName: cfg.payerName,
      fhirBaseUrl: cfg.fhirBase || null, redirectUri: cfg.redirectUri,
      tokenAuthMethod: cfg.authMethod, scope: cfg.scope
    });

    // App-owned API endpoints -------------------------------------------------
    if (req.method === "GET" && pathname === "/api/payers") {
      return json(res, 200, [{ id: "payer-a", name: "Payer A", fhirBaseUrl: `${origin}/mock-payer/fhir` }]);
    }

    if (req.method === "POST" && pathname === "/api/connections/start") {
      const body = await readBody(req);
      if (body.payerId !== "payer-a") return json(res, 400, { error: "unknown_payer" });

      // Calls 1 and 2: discovery and CapabilityStatement.
      const smart = discovery(origin);
      const metadata = capabilityStatement(origin);
      if (!smart.code_challenge_methods_supported.includes("S256")) {
        return json(res, 400, { error: "payer_does_not_support_s256" });
      }

      const state = randomSecret(24);
      const verifier = randomSecret(48);
      const challenge = challengeFor(verifier);
      const redirectUri = `${origin}/oauth/callback`;
      const scope = "openid fhirUser launch/patient offline_access patient/*.rs";

      pending.set(state, {
        state, verifier, challenge, redirectUri, payerId: body.payerId,
        fhirBaseUrl: `${origin}/mock-payer/fhir`, smart, metadata,
        createdAt: Date.now()
      });

    if (req.method === "POST" && p === "/api/connections/start") {
      if (problems().length) return send(res, 400, { error: "configuration_incomplete", problems: problems() });
      const { smart, metadata } = await discover();
      const methods = smart.code_challenge_methods_supported || [];
      if (methods.length && !methods.includes("S256")) return send(res, 400, { error: "s256_not_supported", advertised: methods });
      const state = secret(24), verifier = secret(48);
      pending.set(state, { verifier, smart, createdAt: Date.now() });
      const authorize = new URL(smart.authorization_endpoint);
      authorize.search = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: redirectUri,
        scope,
        state,
        aud: `${origin}/mock-payer/fhir`,
        code_challenge: challenge,
        code_challenge_method: "S256"
      });

      log("connection_started", { payerId: body.payerId, state });
      return json(res, 201, {
        authorizationUrl: authorize.toString(),
        discovered: smart,
        capabilityStatement: metadata
      });
      authorize.search = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: cfg.redirectUri, scope: cfg.scope, state, aud: cfg.fhirBase, code_challenge: challenge(verifier), code_challenge_method: "S256" });
      log("connection_started", { payerName: cfg.payerName });
      return send(res, 201, { authorizationUrl: authorize.toString(), discovered: smart, fhirVersion: metadata.fhirVersion });
    }

    if (req.method === "GET" && pathname === "/oauth/callback") {
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      const session = pending.get(state);

      if (!session) return json(res, 400, { error: "invalid_state" });
      if (error) {
        log("authorization_failed", { state, error });
        pending.delete(state);
        return redirect(res, `/?error=${encodeURIComponent(error)}`);
      }

      const codeRecord = authorizationCodes.get(code);
      if (!codeRecord || codeRecord.used || codeRecord.expiresAt < Date.now()) {
        return json(res, 400, { error: "invalid_authorization_code" });
      }
      if (challengeFor(session.verifier) !== codeRecord.codeChallenge) {
        return json(res, 400, { error: "pkce_verification_failed" });
      }

      // Call 5: token exchange. Done inline so the teaching server stays dependency-free.
      codeRecord.used = true;
      const accessToken = randomSecret(32);
      const refreshToken = randomSecret(32);
      accessTokens.set(accessToken, { patient: "patient-123", scope: codeRecord.scope, expiresAt: Date.now() + 3600_000, revoked: false });
      refreshTokens.set(refreshToken, { patient: "patient-123", scope: codeRecord.scope, revoked: false });

      const connectionId = randomUUID();
      connections.set(connectionId, {
        id: connectionId, payerId: session.payerId, patientId: "patient-123",
        fhirBaseUrl: session.fhirBaseUrl, accessToken, refreshToken,
        scope: codeRecord.scope, connectedAt: new Date().toISOString(),
        lastSyncAt: null, status: "connected", resources: {}
      });
      pending.delete(state);
      log("token_received", { connectionId, payerId: session.payerId });
      return redirect(res, `/?connection=${connectionId}`);
    if (req.method === "GET" && p === "/oauth/callback") {
      const state = url.searchParams.get("state"), session = pending.get(state);
      if (!session || Date.now() - session.createdAt > 600000) return send(res, 400, { error: "invalid_or_expired_state" });
      if (url.searchParams.get("error")) { pending.delete(state); return go(res, `/?error=${encodeURIComponent(url.searchParams.get("error"))}`); }
      const request = tokenRequest({ grant_type: "authorization_code", code: url.searchParams.get("code"), redirect_uri: cfg.redirectUri, code_verifier: session.verifier });
      const tokens = await upstream(session.smart.token_endpoint, { method: "POST", ...request });
      if (!tokens.access_token || !tokens.patient) return send(res, 502, { error: "invalid_token_response", required: ["access_token", "patient"] });
      const id = randomUUID();
      connections.set(id, { id, payerName: cfg.payerName, patientId: tokens.patient, accessToken: tokens.access_token, refreshToken: tokens.refresh_token || null, scope: tokens.scope || cfg.scope, tokenEndpoint: session.smart.token_endpoint, revocationEndpoint: session.smart.revocation_endpoint || null, connectedAt: new Date().toISOString(), lastSyncAt: null, resources: {} });
      pending.delete(state); log("token_received", { connectionId: id }); return go(res, `/?connection=${id}`);
    }

    if (req.method === "GET" && pathname === "/api/connections") {
      const safe = [...connections.values()].map(({ accessToken, refreshToken, ...item }) => item);
      return json(res, 200, safe);
    }

    const connectionMatch = pathname.match(/^\/api\/connections\/([^/]+)(?:\/(sync|refresh|resources))?$/);
    if (connectionMatch) {
      const [, id, action] = connectionMatch;
      const connection = connections.get(id);
      if (!connection) return json(res, 404, { error: "connection_not_found" });

      if (req.method === "GET" && !action) {
        const { accessToken, refreshToken, ...safe } = connection;
        return json(res, 200, safe);
      }

    if (req.method === "GET" && p === "/api/connections") return send(res, 200, [...connections.values()].map(({ accessToken, refreshToken, ...safe }) => safe));
    const match = p.match(/^\/api\/connections\/([^/]+)(?:\/(sync|refresh|resources))?$/);
    if (match) {
      const [, id, action] = match, connection = connections.get(id);
      if (!connection) return send(res, 404, { error: "connection_not_found" });
      if (req.method === "GET" && !action) { const { accessToken, refreshToken, ...safe } = connection; return send(res, 200, safe); }
      if (req.method === "POST" && action === "sync") {
        connection.resources = {
          Patient: [patient], Coverage: [coverage], ExplanationOfBenefit: claims,
          Condition: clinical.Condition, Observation: clinical.Observation
        };
        connection.lastSyncAt = new Date().toISOString();
        log("fhir_sync_completed", { connectionId: id, counts: Object.fromEntries(Object.entries(connection.resources).map(([k, v]) => [k, v.length])) });
        return json(res, 200, { connectionId: id, lastSyncAt: connection.lastSyncAt, resources: connection.resources });
        const patientId = encodeURIComponent(connection.patientId);
        const resources = { Patient: [await fhir(connection, `${cfg.fhirBase}/Patient/${patientId}`)] };
        for (const type of ["Coverage", "ExplanationOfBenefit", "Condition", "Observation"]) {
          try { resources[type] = await pages(connection, `${cfg.fhirBase}/${type}?patient=${patientId}`); }
          catch (error) { resources[type] = { error: error.message, details: error.details || null }; }
        }
        connection.resources = resources; connection.lastSyncAt = new Date().toISOString(); log("fhir_sync_completed", { connectionId: id });
        return send(res, 200, { lastSyncAt: connection.lastSyncAt, resources });
      }

      if (req.method === "GET" && action === "resources") {
        const type = url.searchParams.get("type");
        if (!type) return json(res, 200, connection.resources);
        return json(res, 200, connection.resources[type] || []);
      }

      if (req.method === "GET" && action === "resources") return send(res, 200, url.searchParams.get("type") ? connection.resources[url.searchParams.get("type")] || [] : connection.resources);
      if (req.method === "POST" && action === "refresh") {
        const saved = refreshTokens.get(connection.refreshToken);
        if (!saved || saved.revoked) return json(res, 400, { error: "invalid_grant" });
        const accessToken = randomSecret(32);
        accessTokens.set(accessToken, { patient: saved.patient, scope: saved.scope, expiresAt: Date.now() + 3600_000, revoked: false });
        connection.accessToken = accessToken;
        log("token_refreshed", { connectionId: id });
        return json(res, 200, { tokenType: "Bearer", expiresIn: 3600, scope: saved.scope });
        if (!connection.refreshToken) return send(res, 400, { error: "refresh_token_not_issued" });
        const request = tokenRequest({ grant_type: "refresh_token", refresh_token: connection.refreshToken });
        const tokens = await upstream(connection.tokenEndpoint, { method: "POST", ...request });
        connection.accessToken = tokens.access_token; if (tokens.refresh_token) connection.refreshToken = tokens.refresh_token; log("token_refreshed", { connectionId: id });
        return send(res, 200, { tokenType: tokens.token_type, expiresIn: tokens.expires_in, scope: tokens.scope || connection.scope });
      }

      if (req.method === "DELETE" && !action) {
        const access = accessTokens.get(connection.accessToken);
        const refresh = refreshTokens.get(connection.refreshToken);
        if (access) access.revoked = true;
        if (refresh) refresh.revoked = true;
        connections.delete(id);
        log("connection_revoked_and_deleted", { connectionId: id });
        return json(res, 200, { disconnected: true, deletedLocalData: true });
        let revocation = { attempted: false, reason: "not_advertised" };
        if (connection.revocationEndpoint) {
          const request = tokenRequest({ token: connection.refreshToken || connection.accessToken });
          const response = await fetch(connection.revocationEndpoint, { method: "POST", ...request });
          if (!response.ok) throw new Error(`Revocation failed with HTTP ${response.status}`);
          revocation = { attempted: true, success: true };
        }
        connections.delete(id); log("connection_deleted", { connectionId: id, revocation });
        return send(res, 200, { disconnected: true, localDataDeleted: true, revocation });
      }
    }

    if (req.method === "GET" && pathname === "/api/audit") return json(res, 200, audit);

    // Mock payer OAuth endpoints ---------------------------------------------
    if (req.method === "GET" && pathname === "/mock-payer/fhir/.well-known/smart-configuration") {
      return json(res, 200, discovery(origin));
    }

    if (req.method === "GET" && pathname === "/mock-payer/fhir/metadata") {
      return json(res, 200, capabilityStatement(origin));
    }

    if (req.method === "GET" && pathname === "/mock-payer/authorize") {
      const required = ["response_type", "client_id", "redirect_uri", "scope", "state", "aud", "code_challenge", "code_challenge_method"];
      const missing = required.filter(name => !url.searchParams.get(name));
      if (missing.length) return json(res, 400, { error: "invalid_request", missing });
      if (url.searchParams.get("code_challenge_method") !== "S256") return json(res, 400, { error: "invalid_request", error_description: "S256 is required" });

      const hidden = [...url.searchParams.entries()].map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join("");
      return html(res, 200, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Payer A authorization</title><style>body{font:16px/1.5 system-ui;background:#f3f6f4;color:#10211f;margin:0}.card{max-width:620px;margin:48px auto;padding:32px;background:white;border:1px solid #ccd7d3;border-radius:18px}.scope{padding:14px;background:#eef4f2;border-radius:10px;overflow-wrap:anywhere}.actions{display:flex;gap:12px;margin-top:24px}button{padding:12px 18px;border:1px solid #0c3b36;border-radius:9px;font:inherit;font-weight:700}button[value=approve]{background:#0c3b36;color:white}</style></head><body><main class="card"><p>Payer A</p><h1>Allow LearnApp to access your data?</h1><p>Signed in as Priya Sharma. The app is requesting:</p><p class="scope">${escapeHtml(url.searchParams.get("scope"))}</p><form method="post" action="/mock-payer/authorize">${hidden}<div class="actions"><button name="decision" value="deny">Deny</button><button name="decision" value="approve">Approve access</button></div></form></main></body></html>`);
    }

    if (req.method === "POST" && pathname === "/mock-payer/authorize") {
      const body = await readBody(req);
      const callback = new URL(body.redirect_uri);
      callback.searchParams.set("state", body.state);
      if (body.decision !== "approve") {
        callback.searchParams.set("error", "access_denied");
        return redirect(res, callback.toString());
      }
      const code = randomSecret(24);
      authorizationCodes.set(code, {
        clientId: body.client_id, redirectUri: body.redirect_uri,
        codeChallenge: body.code_challenge, scope: body.scope,
        expiresAt: Date.now() + 300_000, used: false
      });
      callback.searchParams.set("code", code);
      log("payer_authorization_approved", { clientId: body.client_id });
      return redirect(res, callback.toString());
    }

    if (req.method === "POST" && pathname === "/mock-payer/token") {
      const body = await readBody(req);
      if (body.grant_type === "authorization_code") {
        const code = authorizationCodes.get(body.code);
        if (!code || code.used || code.expiresAt < Date.now()) return json(res, 400, { error: "invalid_grant" });
        if (challengeFor(body.code_verifier || "") !== code.codeChallenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE verification failed" });
        code.used = true;
        const accessToken = randomSecret(32);
        const refreshToken = randomSecret(32);
        accessTokens.set(accessToken, { patient: "patient-123", scope: code.scope, expiresAt: Date.now() + 3600_000, revoked: false });
        refreshTokens.set(refreshToken, { patient: "patient-123", scope: code.scope, revoked: false });
        return json(res, 200, { access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshToken, patient: "patient-123", scope: code.scope });
      }
      if (body.grant_type === "refresh_token") {
        const saved = refreshTokens.get(body.refresh_token);
        if (!saved || saved.revoked) return json(res, 400, { error: "invalid_grant" });
        const accessToken = randomSecret(32);
        accessTokens.set(accessToken, { patient: saved.patient, scope: saved.scope, expiresAt: Date.now() + 3600_000, revoked: false });
        return json(res, 200, { access_token: accessToken, token_type: "Bearer", expires_in: 3600, scope: saved.scope });
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }

    if (req.method === "POST" && pathname === "/mock-payer/revoke") {
      const body = await readBody(req);
      const access = accessTokens.get(body.token);
      const refresh = refreshTokens.get(body.token);
      if (access) access.revoked = true;
      if (refresh) refresh.revoked = true;
      res.writeHead(200); return res.end();
    }

    if (req.method === "POST" && pathname === "/mock-payer/introspect") {
      const body = await readBody(req);
      const token = accessTokens.get(body.token);
      return json(res, 200, token && !token.revoked && token.expiresAt > Date.now()
        ? { active: true, scope: token.scope, patient: token.patient, exp: Math.floor(token.expiresAt / 1000) }
        : { active: false });
    }

    // Mock payer FHIR R4 endpoints -------------------------------------------
    if (pathname.startsWith("/mock-payer/fhir/")) {
      const auth = requireToken(req, res);
      if (!auth) return;
      const fhirBase = `${origin}/mock-payer/fhir`;

      if (req.method === "GET" && pathname === `/mock-payer/fhir/Patient/${patient.id}`) return json(res, 200, patient);
      if (req.method === "GET" && pathname === `/mock-payer/fhir/Patient/${patient.id}/$everything`) {
        return json(res, 200, bundle("Patient", [patient, coverage, ...claims, ...clinical.Condition, ...clinical.Observation], url.toString()));
      }
      if (req.method === "GET" && pathname === "/mock-payer/fhir/Coverage") return json(res, 200, bundle("Coverage", [coverage], url.toString()));
      if (req.method === "GET" && pathname === "/mock-payer/fhir/ExplanationOfBenefit") {
        const page = Number(url.searchParams.get("page") || 1);
        const pageClaims = page === 1 ? claims.slice(0, 1) : claims.slice(1, 2);
        const next = page === 1 ? `${fhirBase}/ExplanationOfBenefit?patient=patient-123&page=2` : null;
        return json(res, 200, bundle("ExplanationOfBenefit", pageClaims, url.toString(), next));
      }
      if (req.method === "GET" && pathname === "/mock-payer/fhir/Condition") return json(res, 200, bundle("Condition", clinical.Condition, url.toString()));
      if (req.method === "GET" && pathname === "/mock-payer/fhir/Observation") return json(res, 200, bundle("Observation", clinical.Observation, url.toString()));
      return json(res, 404, operationOutcome(404, "not-found", "FHIR resource or operation not found").body);
    }

    return json(res, 404, { error: "not_found", path: pathname });
    if (req.method === "GET" && p === "/api/audit") return send(res, 200, audit);
    return send(res, 404, { error: "not_found", path: p });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: "server_error", message: error.message });
    console.error(error); return send(res, error.status || 500, { error: "request_failed", message: error.message, upstream: error.details || null });
  }
});

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

server.listen(PORT, () => {
  console.log(`Patient Access learning sandbox: http://localhost:${PORT}`);
});
server.listen(PORT, "127.0.0.1", () => console.log(`Real payer connector: http://localhost:${PORT}`));
